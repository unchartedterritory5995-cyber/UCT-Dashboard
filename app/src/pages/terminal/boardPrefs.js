// UCT Terminal — the board-library preference, read WITHOUT the function registry.
//
// ⭐ WHY THIS FILE EXISTS (lane w9-10, terminal load performance). `/calendar`'s route wrapper
// (`TerminalRoutes.jsx`, imported by App.jsx) only needs two answers from the stored
// `terminal_boards` blob: is it readable, and did the member choose "keep classic calendar".
// Reading that through `boardModel.readLibrary` pulled `boardModel.js` and the whole
// `functions.js` registry into the APP ENTRY chunk, so every route on the site paid for the
// terminal's command vocabulary on first open. This module answers those two questions with no
// imports at all; `boardModel` builds `readLibrary` on top of it, so the parse rules have ONE home.
// Rail: `boardPrefs.entry.rail.test.js` (an AST walk of App.jsx's static imports).

export const TERMINAL_LAYOUT_PREF = 'terminal_layout'
export const TERMINAL_BOARDS_PREF = 'terminal_boards'
export const LIBRARY_VERSION = 1

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/** True when the stored blob must not be written over without the member's say-so. */
export const isGuardedStatus = (status) => status === 'unreadable' || status === 'newer'

/** `{ status, value }` for a stored library blob. `status` is absent · ok · unreadable · newer;
 *  `value` is the parsed object only when `status === 'ok'` (else null). */
export function parseLibraryBlob(raw) {
  if (raw == null || raw === '') return { status: 'absent', value: null }
  let v = raw
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw) } catch { return { status: 'unreadable', value: null } }
  }
  if (!isObj(v)) return { status: 'unreadable', value: null }
  if (v.v === LIBRARY_VERSION) return { status: 'ok', value: v }
  if (Number.isInteger(v.v) && v.v > LIBRARY_VERSION) return { status: 'newer', value: null }
  return { status: 'unreadable', value: null }
}

/** `{ status, keepCalendar }` — what `readLibrary(raw).library.keepCalendar` answers, without
 *  normalising the boards (which needs the registry). */
export function readKeepCalendar(raw) {
  const { status, value } = parseLibraryBlob(raw)
  return { status, keepCalendar: status === 'ok' && value.keepCalendar === true }
}
