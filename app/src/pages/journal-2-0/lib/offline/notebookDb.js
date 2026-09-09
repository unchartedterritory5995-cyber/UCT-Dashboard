/**
 * Wave Q1 — the Notebook's durable offline store. A THIN ADAPTER, deliberately.
 *
 * ⛔⛔ ONE DATABASE PER ACCOUNT, BY NAME. `uct_notebook_{accountId}` rather than
 * one database with an `accountId` predicate on every read. A wrong database
 * name yields NO DATA; a forgotten `WHERE` yields another member's research.
 * Cross-account leakage is a release blocker, so the safe failure is the one
 * the architecture makes structural.
 *
 * ⛔⛔ `onversionchange` IS INSTALLED ON EVERY CONNECTION, FROM VERSION 1, AND
 * THAT IS NOT OPTIONAL. Measured in Chrome 152 on the production origin:
 *
 *     v2 upgrade, a v1 connection open WITHOUT a handler → still blocked at 2s
 *     the same, with the connection closing on versionchange → upgrades cleanly
 *
 * ⚰️ This corrects what `barsIDB` recorded. That store froze `DB_VERSION` at 2
 * because "the v3 bump caused a deadlock", and the lesson was written down as
 * *version bumps are dangerous*. The measurement says otherwise: the deadlock
 * was a MISSING HANDLER. Bumps are survivable — but only if every connection
 * already in the wild closes when asked, and a handler cannot be added
 * retroactively to a connection another tab opened last week. Hence: from v1.
 *
 * ⛔ CORRECTNESS DOES NOT DEPEND ON `navigator.storage.persist()`. A grant
 * improves retention; it is never the only thing standing between a member and
 * losing work. It is feature-detected and RECORDED, never required.
 *
 * ⛔ AND `deleteDatabase()` IS NOT A RECOVERY STRATEGY. Once this store can hold
 * unsynced member work, clearing it is data loss wearing the word "repair".
 */

export const DB_VERSION = 1
export const STORE_NOTES = 'notes'
export const STORE_OUTBOX = 'outbox'
export const STORE_CONFLICTS = 'conflicts'
export const STORE_META = 'meta'

/** ⛔ The account is part of the NAME, not a column. */
export function dbNameFor(accountId) {
  if (!accountId) throw new Error('notebookDb: an accountId is required')
  return `uct_notebook_${accountId}`
}

export class OfflineUnavailable extends Error {}
export class UpgradeBlocked extends Error {}

/** Is a durable store even possible here? Private modes and old browsers say no,
 *  and the product must degrade truthfully rather than pretend. */
export function offlineStorageAvailable(idbFactory = globalThis.indexedDB) {
  return Boolean(idbFactory && typeof idbFactory.open === 'function')
}

/** What the platform will tell us about retention. ⛔ Recorded, never required. */
export async function storagePosture(nav = globalThis.navigator) {
  const out = { persisted: null, quotaBytes: null, usageBytes: null, canRequestPersist: false }
  try {
    if (nav?.storage?.persisted) out.persisted = await nav.storage.persisted()
    if (nav?.storage?.persist) out.canRequestPersist = true
    if (nav?.storage?.estimate) {
      const e = await nav.storage.estimate()
      out.quotaBytes = e?.quota ?? null
      out.usageBytes = e?.usage ?? null
    }
  } catch { /* a posture we cannot read is a posture we do not claim */ }
  return out
}

function createStores(db) {
  if (!db.objectStoreNames.contains(STORE_NOTES)) {
    const s = db.createObjectStore(STORE_NOTES, { keyPath: 'noteId' })
    s.createIndex('byDirty', 'dirty')
  }
  if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
    const s = db.createObjectStore(STORE_OUTBOX, { keyPath: 'mutationId' })
    s.createIndex('byNote', 'noteId')
  }
  if (!db.objectStoreNames.contains(STORE_CONFLICTS)) {
    db.createObjectStore(STORE_CONFLICTS, { keyPath: 'conflictId' })
  }
  if (!db.objectStoreNames.contains(STORE_META)) {
    db.createObjectStore(STORE_META, { keyPath: 'name' })
  }
}

/**
 * Open this account's database.
 *
 * `onBlocked` is called when an upgrade cannot proceed because another
 * connection is still open. ⛔ The caller must SURFACE that, never resolve it by
 * deleting anything: "another UCT tab needs to close" is a sentence a member can
 * act on; a wiped database is not.
 */
export function openNotebookDb(accountId, {
  idbFactory = globalThis.indexedDB,
  version = DB_VERSION,
  onVersionChange = null,
  onBlocked = null,
} = {}) {
  if (!offlineStorageAvailable(idbFactory)) {
    return Promise.reject(new OfflineUnavailable('IndexedDB is not available here'))
  }
  const name = dbNameFor(accountId)
  return new Promise((resolve, reject) => {
    let req
    try {
      req = idbFactory.open(name, version)
    } catch (e) {
      reject(new OfflineUnavailable(String(e && e.message ? e.message : e)))
      return
    }
    req.onupgradeneeded = () => createStores(req.result)
    req.onblocked = () => {
      // ⛔ NOT an error we resolve by force. Tell the caller; keep the data.
      if (onBlocked) onBlocked(new UpgradeBlocked('another tab is holding an older connection'))
    }
    req.onsuccess = () => {
      const db = req.result
      // ⛔⛔ THE HANDLER, ON EVERY CONNECTION, ALWAYS. A future migration can
      // only proceed if the connections already open agree to get out of the
      // way — and this is the only moment we can make them agree.
      db.onversionchange = () => {
        try { db.close() } catch { /* already closing */ }
        if (onVersionChange) onVersionChange()
      }
      resolve(db)
    }
    req.onerror = () => reject(req.error || new Error('indexedDB open failed'))
  })
}

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve()
  tx.onerror = () => reject(tx.error || new Error('transaction failed'))
  tx.onabort = () => reject(tx.error || new Error('transaction aborted'))
})

/**
 * ⛔⛔ THE WORKING COPY AND ITS SYNC INTENT MOVE TOGETHER, IN ONE TRANSACTION.
 *
 * A crash between "the note now says B" and "the outbox still asks to send A"
 * leaves the member's durable state and what we will tell the server about it
 * disagreeing — the worst shape available to an offline system, because both
 * halves look healthy on their own. IndexedDB gives us a multi-store
 * transaction; this uses it rather than two awaits in a row.
 *
 * `outboxEntry === null` removes any queued entry for that note (a note that
 * caught up with the server has nothing left to say).
 */
export async function putNoteWithIntent(db, noteRecord, outboxEntry) {
  const tx = db.transaction([STORE_NOTES, STORE_OUTBOX], 'readwrite')
  const notes = tx.objectStore(STORE_NOTES)
  const outbox = tx.objectStore(STORE_OUTBOX)
  notes.put(noteRecord)
  if (outboxEntry) {
    outbox.put(outboxEntry)
  } else {
    const idx = outbox.index('byNote')
    const cursorReq = idx.openCursor(IDBKeyRange.only(noteRecord.noteId))
    cursorReq.onsuccess = () => {
      const cur = cursorReq.result
      if (cur) { cur.delete(); cur.continue() }
    }
  }
  await done(tx)
  return noteRecord
}

export function getNote(db, noteId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NOTES, 'readonly')
    const req = tx.objectStore(STORE_NOTES).get(noteId)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}

export function listOutbox(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readonly')
    const req = tx.objectStore(STORE_OUTBOX).getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}

export async function clearOutboxEntry(db, mutationId) {
  const tx = db.transaction(STORE_OUTBOX, 'readwrite')
  tx.objectStore(STORE_OUTBOX).delete(mutationId)
  await done(tx)
}

export async function putConflict(db, record) {
  const tx = db.transaction(STORE_CONFLICTS, 'readwrite')
  tx.objectStore(STORE_CONFLICTS).put(record)
  await done(tx)
}

export async function putMeta(db, name, value) {
  const tx = db.transaction(STORE_META, 'readwrite')
  tx.objectStore(STORE_META).put({ name, value })
  await done(tx)
}

export function getMeta(db, name) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readonly')
    const req = tx.objectStore(STORE_META).get(name)
    req.onsuccess = () => resolve(req.result ? req.result.value : null)
    req.onerror = () => reject(req.error)
  })
}
