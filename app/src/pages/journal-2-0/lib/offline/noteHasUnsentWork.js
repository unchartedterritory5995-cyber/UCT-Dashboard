/**
 * ⛔⛔ MITIGATION, NOT ROOT CAUSE.
 *
 * Five production cells on the append route lose a member's offline words: the
 * embed reaches the server, the typed words do not, the durable record is
 * reconciled clean, and nothing marks the note as pending. Q1 fix 4 and Q1 fix 5
 * are both live and neither closed it. The writer that clears the record is still
 * UNNAMED — see `docs/notebook/q1-red-cells-investigation.md`, Q1/Q2.
 *
 * This predicate exists so a member cannot REACH that route while work is unsent.
 * It is a door guard. Deleting it without naming the defect re-opens a silent
 * data-loss path on a live member surface.
 *
 * ⭐ TWO SOURCES, OR-ed, because either alone is incomplete:
 *   · the durable record's `dirty` flag — the editor holds unsent edits
 *   · a queued outbox entry for that note — the drain has not delivered them
 * The five RED cells show a record reconciled CLEAN while an entry was still
 * queued (`store trail: [(1, True, …, True), (0, False, 'None', False)]` with
 * `queued 1 entry(s)`), so `dirty` ALONE would answer "no unsent work" on exactly
 * the shape this guard exists for.
 *
 * ⛔ UNKNOWN IS NOT SAFE — it returns TRUE. If the store cannot be opened or read,
 * the door defers. The cost of a false defer is one "try again in a moment"; the
 * cost of a false pass is the member's words. This layer has twice published a
 * finding where an unreadable thing was scored as an empty one, and that is the
 * same mistake with the sign flipped.
 */
import { offlineEnabled } from './offlineFlag'
import { offlineStorageAvailable, STORE_NOTES, STORE_OUTBOX } from './notebookDb'
import { getCurrentAccountId } from './currentAccount'

/** @typedef {{unsent: boolean, why: 'dirty'|'queued'|'both'|'unreadable'|'wave-off'|null}} UnsentVerdict */

/**
 * ⛔ ONE AUTHORITY. The guard, its rail and its control all call THIS. A control
 * that re-implements the predicate agrees with itself and says nothing about the
 * product — R-05, committed twice in this repo in one week.
 *
 * @returns {Promise<UnsentVerdict>} `why` names WHICH source fired, so a deferral
 *   can be diagnosed without adding a second instrument.
 */
export async function noteHasUnsentWork(noteId, { accountId, connect } = {}) {
  // ⭐ The wave being off is not "no unsent work" — it is "this layer is not
  // running", and with it off there is no durable store to lose anything from.
  // Distinguished so the caller can tell the two apart.
  if (!offlineEnabled() || !offlineStorageAvailable()) {
    return { unsent: false, why: 'wave-off' }
  }
  const acct = accountId || getCurrentAccountId()
  // ⛔ ABSENT IS NOT UNKNOWN, and conflating them defers doors that were never at
  // risk. The durable store is NAMED PER ACCOUNT and keyed per note, so with no
  // account there is no store, and with no note id there is nothing that could
  // hold a queued entry — in both cases no unsent work CAN exist. Returning TRUE
  // here deferred five legitimate door tests, which is the guard refusing to let a
  // member through a door that was never dangerous.
  //
  // ⭐ UNKNOWN -> TRUE still stands where it belongs: a store that cannot be
  // OPENED or READ (the catch below) defers, because there the answer is genuinely
  // not known and the cost of a wrong pass is the member's words.
  if (!noteId || !acct) return { unsent: false, why: 'no-store' }
  if (typeof connect !== 'function') return { unsent: true, why: 'unreadable' }

  try {
    const db = await connect(acct)
    const [rec, queued] = await Promise.all([
      readNote(db, noteId),
      hasQueuedEntry(db, noteId),
    ])
    // ⛔ A MISSING RECORD IS NOT A CLEAN ONE when an entry is queued for it.
    const dirty = Boolean(rec && rec.dirty)
    if (dirty && queued) return { unsent: true, why: 'both' }
    if (dirty) return { unsent: true, why: 'dirty' }
    if (queued) return { unsent: true, why: 'queued' }
    return { unsent: false, why: null }
  } catch {
    return { unsent: true, why: 'unreadable' }
  }
}

function readNote(db, noteId) {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE_NOTES, 'readonly').objectStore(STORE_NOTES).get(noteId)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
}

/** ⛔ Counts entries for THIS note only. A global outbox count would defer every
 *  door in the app because some other note is syncing. */
function hasQueuedEntry(db, noteId) {
  return new Promise((resolve) => {
    try {
      const store = db.transaction(STORE_OUTBOX, 'readonly').objectStore(STORE_OUTBOX)
      const idx = store.index('byNote')
      const req = idx.getKey(IDBKeyRange.only(noteId))
      req.onsuccess = () => resolve(req.result !== undefined && req.result !== null)
      req.onerror = () => resolve(false)
    } catch { resolve(false) }
  })
}

/** The member-facing sentence. ⛔ Exported so the rail asserts the RENDERED text
 *  and not a state flag: two toasts have shipped invisible in this repo — one
 *  passed `message` where the component reads `msg`, one was owned by the branch
 *  its own action unmounts. Both left every structural assertion green. */
export const STILL_SYNCING_MESSAGE = 'This note is still syncing — try again in a moment.'
