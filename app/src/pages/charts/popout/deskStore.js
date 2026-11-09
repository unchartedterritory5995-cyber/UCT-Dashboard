/**
 * Desk store: widget config for popped-out boards, kept so a reload or crash
 * does not lose them.
 *
 * One record per key, `uct.desk.v1:<userId>:<recordId>`. A record is ORPHANED
 * when the Web Lock of the tab that wrote it (`uct.desk.owner:<userId>:<tabId>`)
 * is free: that tab is gone. Holds widget config only, never market data.
 *
 * The caller passes the user id (from prefsUser()); a null id refuses every
 * call. `storage`, `locks` and `tabId` options exist for tests; the defaults
 * are the real localStorage and navigator.locks.
 *
 * Where Web Locks is missing, or the owner's lock cannot be determined,
 * nothing is treated as orphaned: restoring over a live board is worse than
 * leaving a stale record.
 */

export const KEY_PREFIX = 'uct.desk.v1:'
const LOCK_PREFIX = 'uct.desk.owner:'

// One id per page load. Not crypto.randomUUID: that is secure-context-only.
const PAGE_TAB_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const defaultLocks = () => (typeof navigator !== 'undefined' ? navigator.locks : undefined)

const lockName = (uid, tabId) => `${LOCK_PREFIX}${uid}:${tabId}`

function pick(record) {
  if (!record || typeof record.id !== 'string' || !record.id) return null
  if (record.kind === 'board') {
    return { kind: 'board', id: record.id, widgets: record.widgets, windowName: record.windowName }
  }
  if (record.kind === 'widget') {
    return { kind: 'widget', id: record.id, widgetId: record.widgetId, windowName: record.windowName }
  }
  return null
}

/** Write one record, stamped with its owner tab. Returns false on refusal or failure. */
export function saveRecord(uid, record, { storage = localStorage, tabId = PAGE_TAB_ID } = {}) {
  if (!uid) return false
  const clean = pick(record)
  if (!clean) return false
  try {
    storage.setItem(`${KEY_PREFIX}${uid}:${clean.id}`, JSON.stringify({ ...clean, tabId }))
    return true
  } catch {
    return false
  }
}

function readRecords(uid, storage) {
  const prefix = `${KEY_PREFIX}${uid}:`
  const out = []
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i)
      if (!key || !key.startsWith(prefix)) continue
      try {
        // Rebuilt from the constant (not the enumerated key) so the persistence census can read it.
        const rec = JSON.parse(storage.getItem(`${KEY_PREFIX}${uid}:${key.slice(prefix.length)}`))
        if (rec && typeof rec === 'object' && typeof rec.id === 'string') out.push(rec)
      } catch { /* corrupt record: skip, never delete */ }
    }
  } catch {
    return []
  }
  return out
}

/** Records whose owner tab is gone. Read-only. */
export async function listOrphans(uid, { storage = localStorage, locks = defaultLocks(), tabId = PAGE_TAB_ID } = {}) {
  if (!uid) return []
  if (!locks || typeof locks.query !== 'function') return []
  const records = readRecords(uid, storage)
  if (records.length === 0) return []
  let held
  try {
    const snapshot = await locks.query()
    held = new Set((snapshot?.held || []).map((l) => l.name))
  } catch {
    return []
  }
  return records.filter((rec) => (
    typeof rec.tabId === 'string' && rec.tabId
    && rec.tabId !== tabId
    && !held.has(lockName(uid, rec.tabId))
  ))
}

/** The only deleter: call once a record has been restored. */
export function confirmRestored(uid, id, { storage = localStorage } = {}) {
  if (!uid || !id) return
  try {
    storage.removeItem(`${KEY_PREFIX}${uid}:${id}`)
  } catch { /* nothing to do */ }
}

/**
 * Hold this page's owner lock for the life of the page (or until the returned
 * release is called). Resolves once the lock is granted, or at once with a
 * no-op release if locks are unavailable.
 */
export function holdOwnerLock(uid, { locks = defaultLocks(), tabId = PAGE_TAB_ID } = {}) {
  const noop = () => {}
  if (!uid || !locks || typeof locks.request !== 'function') return Promise.resolve(noop)
  return new Promise((resolve) => {
    let release = noop
    const held = new Promise((r) => { release = r })
    try {
      Promise.resolve(locks.request(lockName(uid, tabId), () => {
        resolve(() => release())
        return held
      })).catch(() => resolve(noop))
    } catch {
      resolve(noop)
    }
  })
}
