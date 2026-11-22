import { WL_COLS_LS } from '../../watchlist/watchlistTemplates'

// Where the drill list keeps its column layouts. Namespaced off the watchlist
// key the same way the scanner namespaces its own. Table mode has its OWN key,
// so arranging Table never rearranges the compact list (and vice versa).
export const DRILL_COLS_KEY = `${WL_COLS_LS}.breadthDrill.focus7`
export const DRILL_TABLE_COLS_KEY = `${WL_COLS_LS}.breadthDrill.table`

/** Every time the window opens it starts sorted by % Chg, biggest gain first
 *  (owner, 2026-11-09). A sort the user picks then holds until the window
 *  closes; their column widths and order are kept as they are. */
export function resetDrillSort() {
  for (const key of [DRILL_COLS_KEY, DRILL_TABLE_COLS_KEY]) {
    try {
      const cfg = JSON.parse(localStorage.getItem(key) || 'null')
      if (cfg && typeof cfg === 'object') localStorage.setItem(key, JSON.stringify({ ...cfg, sort: { key: 'chg', dir: 'desc' } }))
    } catch { /* storage unavailable: the default sort applies anyway */ }
  }
}
