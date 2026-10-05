// UCT Terminal — recents SPLIT BY KIND (IA §14.2, lane T2 / V11): three lists, never one feed.
//
//   entities   per channel, in the board document (`channel.history`, boardModel.js)
//   functions  the codes this viewer ran, most recent first — a per-viewer convenience, so it
//              lives in localStorage with every access wrapped (private windows throw)
//   saved      boards, by when they were last opened (`recentBoards`, boardModel.js)
//
// Favourites are the member's pinned function codes, in the board library (cross-device).
// The command line's ↑ history (CommandLine.jsx) stays what it is: what was TYPED.
export const FUNCTION_RECENTS_KEY = 'uct.terminal.recentFunctions'
export const FUNCTION_RECENTS_MAX = 12

export function readFunctionRecents() {
  try {
    const v = JSON.parse(window.localStorage.getItem(FUNCTION_RECENTS_KEY) || '[]')
    return Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s) : []
  } catch { return [] }
}

export function pushFunctionRecent(code) {
  const c = String(code || '').trim().toUpperCase()
  if (!c) return readFunctionRecents()
  const next = [c, ...readFunctionRecents().filter((x) => x !== c)].slice(0, FUNCTION_RECENTS_MAX)
  try { window.localStorage.setItem(FUNCTION_RECENTS_KEY, JSON.stringify(next)) } catch { /* storage off */ }
  return next
}
