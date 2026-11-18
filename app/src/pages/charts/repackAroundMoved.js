// The board's DROP rule, on its own so a board can use it without loading the Charts workspace.
//
// Moved out of ChartsWorkspace.jsx unchanged (2026-11-18). The Screener's scan board runs the same
// rule (pages/screener/focus/board/ScanBoard.jsx) and used to load the whole Charts workspace
// module, several thousand lines and everything it imports, for this one function. Now it loads
// this file. ChartsWorkspace imports the rule from here and re-exports it, so every existing
// import keeps working.
//
// Pure: no React, no DOM. The only inputs are the widget registry's min sizes and the grid's size.
import { WIDGET_REGISTRY } from '../../widgets/registry'
import { FIXED_ROWS } from './rowHeight'

/** The board's column count at every breakpoint (see the note on COLS in ChartsWorkspace.jsx). */
export const GRID_COLS = 24

// The id -> defaults view of the widget registry: the same view ChartsWorkspace builds.
const WIDGET_DEFAULTS = Object.fromEntries(
  Object.entries(WIDGET_REGISTRY).map(([id, w]) => [id, w.defaults]),
)

/** One widget clamped fully inside a cols x rows grid, never below its type's min size. */
export function clampOne(w, cols, rows) {
  const def = WIDGET_DEFAULTS[w.type] || {}
  const minH = def.minH || 3, minW = def.minW || 2
  const x = Math.max(0, Math.min(w.x | 0, cols - minW))
  let cw = Math.max(minW, Math.min(w.w | 0, cols)); if (x + cw > cols) cw = cols - x
  const y = Math.max(0, Math.min(w.y | 0, rows - minH))
  let h = Math.max(minH, Math.min(w.h | 0, rows)); if (y + h > rows) h = rows - y
  return { ...w, x, y, w: cw, h }
}

// On-DROP re-pack (the grid uses allowOverlap so NOTHING moves while you drag — the
// board only rearranges once, here, when you let go). The moved widget keeps exactly
// the slot it was dropped on (clamped inside the grid). Every OTHER widget is then
// re-tiled around it, BIGGEST-first — so the large chart claims the big open region
// and small panels tuck into the leftover corners. Each keeps its native size when it
// fits; otherwise it shrinks (height preserved, width first) to the largest size that
// does, landing as close to where it already was as possible. Every widget is placed
// STRICTLY inside the grid (a full 2-D fit test, not a vertical push), so a displaced
// widget can never overlap the newcomer or shoot off the visible canvas. `rect` is the
// dropped {x,y,w,h}; `movedId` the dragged widget's id.
export function repackAroundMoved(widgets, movedId, rect, cols = GRID_COLS, rows = FIXED_ROWS) {
  const moved0 = widgets.find(w => w.id === movedId)
  if (!moved0) return widgets
  const moved = clampOne({ ...moved0, x: rect.x, y: rect.y, w: rect.w, h: rect.h }, cols, rows)
  // AUTO-SHRINK the dropped widget so it fits BELOW whatever it was dropped under,
  // instead of getting stuck: the board is height-locked, so a tall widget dragged
  // low simply caps its height to the rows left beneath its top. A normal drop (it
  // already fits) is untouched — this only bites when y sits near the bottom.
  const movedMinH = (WIDGET_DEFAULTS[moved.type] || {}).minH || 3
  moved.h = Math.max(movedMinH, Math.min(moved.h, rows - moved.y))

  // Cell-occupancy grid. Seed it with the moved widget; everything else fits around it.
  const occ = Array.from({ length: rows }, () => new Array(cols).fill(false))
  const fill = (r) => {
    for (let y = r.y; y < r.y + r.h && y < rows; y++)
      for (let x = r.x; x < r.x + r.w && x < cols; x++) occ[y][x] = true
  }
  const freeAt = (x, y, w, h) => {
    if (x < 0 || y < 0 || x + w > cols || y + h > rows) return false
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) if (occ[yy][xx]) return false
    return true
  }
  fill(moved)

  const rest = widgets.filter(w => w.id !== movedId).map(w => clampOne(w, cols, rows))
  rest.sort((a, b) => (b.w * b.h) - (a.w * a.h) || (a.y - b.y) || (a.x - b.x))

  const placed = [moved]
  for (const w of rest) {
    const def = WIDGET_DEFAULTS[w.type] || {}
    const minW = def.minW || 2, minH = def.minH || 3
    let best = null
    // Keep native size if it fits; otherwise shrink height LAST (a chart stays tall,
    // narrowing first). Among the free spots at the chosen size, land nearest to where
    // the widget already was so it doesn't teleport across the board.
    for (let th = Math.min(w.h, rows); th >= minH && !best; th--) {
      for (let tw = Math.min(w.w, cols); tw >= minW && !best; tw--) {
        let spot = null
        for (let y = 0; y <= rows - th; y++) {
          for (let x = 0; x <= cols - tw; x++) {
            if (!freeAt(x, y, tw, th)) continue
            const d = Math.abs(x - w.x) + Math.abs(y - w.y)
            if (!spot || d < spot.d) spot = { x, y, d }
          }
        }
        if (spot) best = { x: spot.x, y: spot.y, w: tw, h: th }
      }
    }
    if (!best) best = { x: 0, y: Math.max(0, rows - minH), w: minW, h: minH } // grid full — unreachable with a handful of widgets
    fill(best)
    placed.push({ ...w, x: best.x, y: best.y, w: best.w, h: best.h })
  }
  const byId = Object.fromEntries(placed.map(p => [p.id, p]))
  return widgets.map(w => byId[w.id] || w)
}
