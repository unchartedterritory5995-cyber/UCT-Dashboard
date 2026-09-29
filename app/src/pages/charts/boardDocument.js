// app/src/pages/charts/boardDocument.js
//
// TERM-021 read-new — a board change (open a layout template, New Layout, UCT Default)
// as ONE document write.
//
// Today a template apply is six to ten separate preference writes plus a localStorage
// write, with no transaction: a tab closed, a network drop or a pod restart in the middle
// leaves a board that is part one layout and part another. While the versioned workspace
// document is ARMED (`isWorkspaceDocArmed()`), the same change is sent as ONE
// compare-and-set write — `POST /api/workspace/doc/apply` — and lands whole or not at all.
//
// HOW THE CHANGE IS DESCRIBED ONCE AND RUN EITHER WAY. The workspace describes a board
// change by CALLING the writes it would make, in order, against a recorder
// (`recordBoardWrites`). The recorded steps are then either
//   * REPLAYED through the real `setPref` and localStorage, in the recorded order with the
//     recorded values — dark, and on a 404 from a store that went dark mid-session. This is
//     byte-for-byte what the board did before this module existed; or
//   * folded into ONE patch (`boardDocumentPatch`) and committed as one document version.
// One description, so the two paths cannot drift apart.
//
// ⛔ A STALE BASE (409) IS NEVER RETRIED AND NEVER FALLS BACK TO THE PER-KEY WRITES. The
// board changed after the head was read (another tab, a late autosave); writing anyway is
// the silent overwrite the compare-and-set exists to refuse. The caller re-reads and says so.
//
// The Watchlist column layout (`localStorage['uct.watchlist.cols']`, `WL_COLS_LS`) is part
// of a board change. Armed, it rides the same document write as `watchlist_columns`; the
// localStorage copy the Watchlist widget reads is still written, after the commit.

import { WL_COLS_LS } from '../watchlist/watchlistTemplates'
import { WORKSPACE_DOC_URL } from './VersionHistory'

export const WATCHLIST_COLUMNS_KEY = 'watchlist_columns'
export const BOARD_APPLY_URL = `${WORKSPACE_DOC_URL}/apply`
const BOARD = 'charts'

function serialize(value) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/**
 * Run `build(setPref, setWatchlistColumns)` against a recorder and return its steps, in
 * call order. `setWatchlistColumns(obj)` records "write this column layout";
 * `setWatchlistColumns(null)` records "clear it".
 */
export function recordBoardWrites(build) {
  const steps = []
  build(
    (key, value) => { steps.push({ kind: 'pref', key, value, serialized: serialize(value) }) },
    (cols) => { steps.push({ kind: 'cols', cols: cols && typeof cols === 'object' ? cols : null }) },
  )
  return steps
}

/** Apply ONE recorded column step to the localStorage copy the Watchlist widget reads. */
function applyColumnsStep(step) {
  try {
    if (step.cols) localStorage.setItem(WL_COLS_LS, JSON.stringify(step.cols))
    else localStorage.removeItem(WL_COLS_LS)
  } catch { /* quota / disabled storage: the widget falls back to its defaults */ }
}

/**
 * The per-key path: every recorded step, in order, through `write` (the real `setPref`)
 * and localStorage. What the board did before TERM-021's read-new phase, unchanged.
 */
export function replayBoardWrites(steps, write) {
  for (const step of steps) {
    if (step.kind === 'pref') write(step.key, step.value)
    else applyColumnsStep(step)
  }
}

/** After a committed document write: the localStorage half of the recorded steps only. */
export function applyColumnsSteps(steps) {
  for (const step of steps) if (step.kind === 'cols') applyColumnsStep(step)
}

/**
 * The recorded steps as ONE patch of stored TEXT, as the per-key path would have left it:
 * the last write to a key wins, exactly as sequential writes would. A column step becomes
 * `watchlist_columns` (`''` = cleared).
 */
export function boardDocumentPatch(steps) {
  const patch = {}
  for (const step of steps) {
    if (step.kind === 'pref') patch[step.key] = step.serialized
    else patch[WATCHLIST_COLUMNS_KEY] = step.cols ? JSON.stringify(step.cols) : ''
  }
  return patch
}

async function requestJson(url, init) {
  if (typeof fetch !== 'function') return { status: 0, ok: false, body: null }
  try {
    const res = await fetch(url, { credentials: 'include', ...(init || {}) })
    if (!res) return { status: 0, ok: false, body: null }
    let body = null
    try { body = await res.json() } catch { body = null }
    return { status: res.status, ok: !!res.ok, body }
  } catch {
    return { status: 0, ok: false, body: null }
  }
}

/**
 * Commit `patch` as ONE document version on the head as it is right now.
 *
 * Reads the head (`GET /api/workspace/doc`, which also makes the first copy of a board
 * that has none), then `POST …/apply` compare-and-set on it. Resolves to
 *   { status: 'applied',  body }  — every key is the member's board
 *   { status: 'conflict', body }  — the head moved; NOTHING was written
 *   { status: 'dark' }            — the store answered 404: use the per-key path
 *   { status: 'failed' }          — anything else; nothing is claimed
 */
export async function commitBoardDocument(patch) {
  const head = await requestJson(`${WORKSPACE_DOC_URL}?board=${BOARD}`)
  if (head.status === 404) return { status: 'dark' }
  if (!head.ok || !Number.isInteger(head.body?.version)) return { status: 'failed' }
  const r = await requestJson(BOARD_APPLY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ board: BOARD, base_version: head.body.version, prefs: patch }),
  })
  if (r.ok && r.body) return { status: 'applied', body: r.body }
  if (r.status === 409) return { status: 'conflict', body: r.body }
  if (r.status === 404) return { status: 'dark' }
  return { status: 'failed' }
}

/**
 * The one-time Watchlist-columns fold, decided from what each side holds.
 *
 *   stored  — the `watchlist_columns` preference (undefined when absent)
 *   local   — the raw `uct.watchlist.cols` localStorage string (null when absent)
 *
 * Returns `{ write, fill }`:
 *   write — a value to put in the document: localStorage holds a column layout the
 *           document does not (the first time, that is the one-time migration READ;
 *           after it, a column edit made in the widget since the last board save)
 *   fill  — a value to put in localStorage: it holds nothing and the document does
 *           (a new device)
 * ⛔ Never a removal, and never a replacement of a local value: the localStorage copy is
 * the widget's live one, so the fold only COPIES it, and fills it only where it is
 * ABSENT. An unreadable local value is left exactly as it is.
 */
export function planColumnsFold(stored, local) {
  const localObj = parseColumns(local)
  if (localObj) {
    const next = JSON.stringify(localObj)
    const storedObj = parseColumns(stored)
    return { write: storedObj && JSON.stringify(storedObj) === next ? null : next, fill: null }
  }
  if (local == null) {
    const storedObj = parseColumns(stored)
    if (storedObj) return { write: null, fill: JSON.stringify(storedObj) }
  }
  return { write: null, fill: null }
}

/** The raw column string if it holds a column object, else null. */
export function parseColumns(raw) {
  if (raw == null || raw === '') return null
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null
  } catch {
    return null
  }
}
