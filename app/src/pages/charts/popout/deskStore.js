/**
 * Desk store: widget config for popped-out boards, kept so a reload or crash
 * does not lose them.
 *
 * One record per key, `uct.desk.v1:<userId>:<recordId>`. A record is ORPHANED
 * when the Web Lock of the tab that wrote it (`uct.desk.owner:<userId>:<tabId>`)
 * is free: that tab is gone. Holds widget config only, never market data.
 *
 * The caller passes the user id (from prefsUser()); a null id refuses every
 * call. `storage`, `locks`, `granted` and `tabId` options exist for tests; the
 * defaults are the real localStorage and navigator.locks, resolved lazily inside
 * a guard so a blocked or missing storage returns false/[] instead of throwing.
 *
 * saveRecord needs this page's owner lock to be GRANTED first (when Web Locks
 * exists). Otherwise another tab could see the record's tabId with no held lock
 * and report a live board as an orphan.
 *
 * Where Web Locks is missing, or the owner's lock cannot be determined,
 * nothing is treated as orphaned: restoring over a live board is worse than
 * leaving a stale record.
 */

export const KEY_PREFIX = 'uct.desk.v1:'
const LOCK_PREFIX = 'uct.desk.owner:'

// One id per page load. Not crypto.randomUUID: that is secure-context-only.
const PAGE_TAB_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const WINDOW_ID = /^[A-Za-z0-9_-]{1,64}$/

/** The desktop shell's name for a board's window: uct-board-<id>, or '' for an id it would reject. */
export const boardWindowName = (id) => (WINDOW_ID.test(String(id)) ? `uct-board-${id}` : '')

/** The desktop shell's name for one widget's window: uct-widget-<id>, or '' for an id it would reject. */
export const widgetWindowName = (id) => (WINDOW_ID.test(String(id)) ? `uct-widget-${id}` : '')

const lockName = (uid, tabId) => `${LOCK_PREFIX}${uid}:${tabId}`

// uids whose owner lock this page currently holds.
const GRANTED = new Set()

/** navigator.locks, or null when absent or access throws. */
function resolveLocks(opts) {
  if ('locks' in opts) return opts.locks || null
  try {
    return (typeof navigator !== 'undefined' && navigator.locks) || null
  } catch {
    return null
  }
}

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

/**
 * Write one record, stamped with its owner tab. Returns false on refusal or
 * failure, including when Web Locks exists and this page's owner lock for uid
 * has not been granted yet.
 */
export function saveRecord(uid, record, opts = {}) {
  if (!uid) return false
  const clean = pick(record)
  if (!clean) return false
  try {
    const locks = resolveLocks(opts)
    const granted = opts.granted ?? GRANTED
    if (locks && !granted.has(uid)) return false
    const store = opts.storage ?? localStorage
    store.setItem(`${KEY_PREFIX}${uid}:${clean.id}`, JSON.stringify({ ...clean, tabId: opts.tabId ?? PAGE_TAB_ID }))
    return true
  } catch {
    return false
  }
}

function readRecords(uid, store) {
  const prefix = `${KEY_PREFIX}${uid}:`
  const out = []
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i)
      if (!key || !key.startsWith(prefix)) continue
      try {
        // Rebuilt from the constant (not the enumerated key) so the persistence census can read it.
        const rec = JSON.parse(store.getItem(`${KEY_PREFIX}${uid}:${key.slice(prefix.length)}`))
        if (rec && typeof rec === 'object' && typeof rec.id === 'string') out.push(rec)
      } catch { /* corrupt record: skip, never delete */ }
    }
  } catch {
    return []
  }
  return out
}

/** Any record for this member, read or unread: the cheap launch check. Never throws. */
export function hasDeskRecords(uid, opts = {}) {
  if (!uid) return false
  try {
    const store = opts.storage ?? localStorage
    const prefix = `${KEY_PREFIX}${uid}:`
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i)
      if (key && key.startsWith(prefix)) return true
    }
  } catch { /* blocked storage reads as nothing to restore */ }
  return false
}

/** Records whose owner tab is gone. Read-only. */
export async function listOrphans(uid, opts = {}) {
  if (!uid) return []
  const tabId = opts.tabId ?? PAGE_TAB_ID
  const locks = resolveLocks(opts)
  if (!locks || typeof locks.query !== 'function') return []
  let records
  try {
    const store = opts.storage ?? localStorage
    records = readRecords(uid, store)
  } catch {
    return []
  }
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

/**
 * What the desktop app does with this launch's orphans. A pure decision over the records and the
 * ids on the loaded board, so the board can be re-checked without a window in sight.
 *   boards:    re-pop into their named windows, without any widget now on the main board.
 *   widgetIds: re-pop singly, each still in the layout.
 *   drop:      record ids with nothing left to bring back. Unknown kinds are left alone.
 */
export function planDeskRepop(orphans, boardWidgetIds) {
  const onBoard = new Set(boardWidgetIds)
  const placed = new Set(boardWidgetIds)
  const boards = []
  const widgetIds = []
  const drop = []
  for (const rec of orphans) {
    if (rec.kind === 'widget') {
      if (onBoard.has(rec.widgetId) && !widgetIds.includes(rec.widgetId)) widgetIds.push(rec.widgetId)
      else drop.push(rec.id)
    } else if (rec.kind === 'board' && Array.isArray(rec.widgets)) {
      const widgets = rec.widgets.filter((w) => {
        if (!w?.id || placed.has(w.id)) return false
        placed.add(w.id)
        return true
      })
      if (widgets.length) boards.push({ id: rec.id, widgets })
      else drop.push(rec.id)
    }
  }
  return { boards, widgetIds, drop }
}

/** The only deleter: call once a record has been restored. */
export function confirmRestored(uid, id, opts = {}) {
  if (!uid || !id) return
  try {
    const store = opts.storage ?? localStorage
    store.removeItem(`${KEY_PREFIX}${uid}:${id}`)
  } catch { /* nothing to do */ }
}

/**
 * Hold this page's owner lock for the life of the page (or until the returned
 * release is called). Resolves once the lock is granted, or at once with a
 * no-op release if locks are unavailable. Granting is what unlocks saveRecord.
 */
export function holdOwnerLock(uid, opts = {}) {
  const noop = () => {}
  const locks = resolveLocks(opts)
  if (!uid || !locks || typeof locks.request !== 'function') return Promise.resolve(noop)
  const tabId = opts.tabId ?? PAGE_TAB_ID
  const granted = opts.granted ?? GRANTED
  return new Promise((resolve) => {
    let release = noop
    const held = new Promise((r) => { release = r })
    try {
      Promise.resolve(locks.request(lockName(uid, tabId), () => {
        granted.add(uid)
        resolve(() => { granted.delete(uid); release() })
        return held
      })).catch(() => resolve(noop))
    } catch {
      resolve(noop)
    }
  })
}
