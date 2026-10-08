// ── Board arrangement helpers (pure) ────────────────────────────────────────────────────
//
// Geometry for "arrange these widgets" requests, in the workspace's own grid units (24
// columns × the viewport-locked row count). Pure: they return new {id → {x, y, w, h}} maps
// and never touch React state; the workspace writes the result through its own layout
// writer (clamped, auto-saved) exactly like a drop. `boardProblems` is the single validity
// check (in bounds, no overlap, min sizes) every arrangement must pass before it is applied.
//
//   fill     — every listed widget grows into the empty space next to it (right, then down,
//              then left, then up), keeping the arrangement; nothing else moves.
//   grid     — the listed widgets are re-tiled as an even grid over the area they span.
//   columns  — side by side, full height of that area.
//   rows     — stacked, full width of that area.

const area = (r) => r.w * r.h
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Problems with a board: [] when every widget is inside the grid, at least its min size, and none overlap. */
export function boardProblems(widgets, cols, rows, minOf = () => ({ minW: 2, minH: 3 })) {
  const out = []
  for (const w of widgets) {
    const { minW = 2, minH = 3 } = minOf(w) || {}
    if (w.x < 0 || w.y < 0 || w.x + w.w > cols || w.y + w.h > rows) out.push({ id: w.id, problem: 'outside' })
    else if (w.w < minW || w.h < minH) out.push({ id: w.id, problem: 'too-small' })
  }
  for (let i = 0; i < widgets.length; i++) {
    for (let j = i + 1; j < widgets.length; j++) {
      if (overlaps(widgets[i], widgets[j])) out.push({ id: widgets[i].id, other: widgets[j].id, problem: 'overlap' })
    }
  }
  return out
}

/** Grow each target widget into adjacent empty space. Returns {id → rect} for the widgets that changed. */
export function fillGaps(widgets, targetIds, cols, rows) {
  const board = widgets.map(w => ({ ...w }))
  const free = (r, self) => r.x >= 0 && r.y >= 0 && r.x + r.w <= cols && r.y + r.h <= rows
    && board.every(o => o.id === self || !overlaps(r, o))
  const order = board.filter(w => targetIds.includes(w.id)).sort((a, b) => (a.y - b.y) || (a.x - b.x))
  for (const w of order) {
    let grew = true
    while (grew) {
      grew = false
      for (const step of [{ w: 1 }, { h: 1 }, { x: -1, w: 1 }, { y: -1, h: 1 }]) {
        const r = { x: w.x + (step.x || 0), y: w.y + (step.y || 0), w: w.w + (step.w || 0), h: w.h + (step.h || 0) }
        if (free(r, w.id)) { Object.assign(w, r); grew = true }
      }
    }
  }
  const changed = {}
  for (const w of board) {
    const o = widgets.find(x => x.id === w.id)
    if (o.x !== w.x || o.y !== w.y || o.w !== w.w || o.h !== w.h) changed[w.id] = { x: w.x, y: w.y, w: w.w, h: w.h }
  }
  return changed
}

/** Re-tile the target widgets over the bounding area they occupy. Order: top-to-bottom, left-to-right. */
export function tileWidgets(widgets, targetIds, pattern, cols, rows) {
  const ts = widgets.filter(w => targetIds.includes(w.id)).sort((a, b) => (a.y - b.y) || (a.x - b.x))
  if (!ts.length) return {}
  // The area: the targets' bounding box, grown over any empty space the others leave.
  const others = widgets.filter(w => !targetIds.includes(w.id))
  let box = {
    x: Math.min(...ts.map(w => w.x)), y: Math.min(...ts.map(w => w.y)),
    w: 0, h: 0,
  }
  box.w = Math.max(...ts.map(w => w.x + w.w)) - box.x
  box.h = Math.max(...ts.map(w => w.y + w.h)) - box.y
  if (others.some(o => overlaps(o, box))) return null               // others sit inside the area: not tileable
  const grown = fillGaps([...others, { id: '__box', ...box }], ['__box'], cols, rows).__box
  if (grown) box = grown
  const n = ts.length
  let nc, nr
  if (pattern === 'columns') { nc = n; nr = 1 } else if (pattern === 'rows') { nc = 1; nr = n } else { nc = Math.ceil(Math.sqrt(n)); nr = Math.ceil(n / nc) }
  if (nc > box.w || nr > box.h) return null
  const ys = Array.from({ length: nr + 1 }, (_, i) => box.y + Math.round((box.h * i) / nr))
  const out = {}
  ts.forEach((w, i) => {
    const r = Math.floor(i / nc), c = i % nc
    // the last row's widgets share its full width when the grid is not full
    const inRow = r === nr - 1 ? n - r * nc : nc
    const rx = Array.from({ length: inRow + 1 }, (_, k) => box.x + Math.round((box.w * k) / inRow))
    out[w.id] = { x: rx[c], y: ys[r], w: rx[c + 1] - rx[c], h: ys[r + 1] - ys[r] }
  })
  return out
}

export const ARRANGE_PATTERNS = ['fill', 'grid', 'columns', 'rows']
export { area as rectArea }
