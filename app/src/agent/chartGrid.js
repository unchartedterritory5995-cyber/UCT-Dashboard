// ── CHART GRID (live test 2026-10-28): "create four charts for SPY, QQQ, NVDA and TSLA, all daily" ──
//
// One request that both REUSES the charts already on the board and ADDS the ones still needed, re-tiled
// into equal cells — planned here, PURELY, from the board as it is; written by the board kind as ONE
// change with ONE exact Undo (capabilities/board.js `grid`).
//
//   • reuse   the board's charts in reading order (top-left first) — the first N when there are more;
//   • add     one new chart per symbol still without one, born on its ticker and timeframe, not linked;
//   • tile    only when charts are added (or the member asked for a grid / columns / rows): the reused
//             charts' area, grown over the empty space around it (placement/arrange.tileWidgets — the
//             board's own even grid), split into equal cells. Every OTHER widget stays exactly where it is;
//             nothing is removed, ever;
//   • links   a reused chart that shares its link colour with another chart is unlinked (two charts in
//             one group always show the same symbol) — the first reused chart of a group keeps the link
//             when no chart outside this request follows it.
// When it cannot be done without moving or removing something the member did not mention, it says so in
// one sentence (and what to do) — never a partial grid.

import { tileWidgets, boardProblems } from '../pages/charts/placement/arrange'
import { planGroupPlacement, planPlacement } from '../pages/charts/placement/place'

export const GRID_PATTERNS = ['grid', 'columns', 'rows']
export const MAX_GRID_CHARTS = 9
const readingOrder = (a, b) => (a.y - b.y) || (a.x - b.x)
const RECT = ['x', 'y', 'w', 'h']
const sameRect = (a, b) => RECT.every(k => a[k] === b[k])

/**
 * @param board    the board's widgets as stored (id, type, x, y, w, h, color)
 * @param charts   Map widget id → { ref, symbol, tf } for the board's charts (what each shows now)
 * @param symbols  the tickers, in the order the member gave them (cell order: reading order)
 * @param timeframe a chart timeframe code, or null to keep each chart's own
 * @param layout   'grid' | 'columns' | 'rows' | null (null: a grid, and only when charts are added)
 * @param newCharts true when the member asked for NEW charts ("…in four new charts"): every chart already on
 *                 the board keeps its ticker and takes the first cells; one new chart per ticker follows
 * @returns `{ ok: false, reason }` | `{ ok: true, reuse, add, set, unlink, tiled, shape, noop }`
 *   reuse  [{ id, ref, symbol, tf, from: { symbol, tf } }]  — symbol / tf null = unchanged
 *   add    [{ rect, symbol, tf }]                          — new charts, in cell order
 *   set    { id: rect }                                     — reused charts whose cell moved
 *   unlink [id]                                             — reused charts taken out of their link group
 */
// ⭐ PHASE 3 (workspace composition): `rail` = { type: 'watchlist', w } — "four daily charts for …, and a watchlist": a
// column at the board's right edge, full height, is cleared of CHARTS (a chart reaching into it is narrowed to its left
// edge) and a new widget of that type is added there. Any other widget in that column → refused (nothing the member did not
// mention moves). A board that already has a widget of that type gets no rail (`rail` is then ignored).
export const RAIL_W = 6
export function planChartGrid({ board, charts, symbols, timeframe = null, layout = null, newCharts = false, cols, rows, minOf, maxWidgets, detached = [], rail = null }) {
  const syms = (symbols || []).map(s => String(s || '').trim().toUpperCase()).filter(Boolean)
  const n = syms.length
  if (!n) return { ok: false, reason: 'Which tickers?' }
  if (new Set(syms).size !== n) return { ok: false, reason: 'Each chart needs a different ticker — one of them is named twice.' }
  if (n > MAX_GRID_CHARTS) return { ok: false, reason: `That's more than ${MAX_GRID_CHARTS} charts in one grid — ask for fewer.` }
  const away = new Set((detached || []).map(String))
  let onGrid = board.filter(w => !away.has(String(w.id)))
  // the rail: cleared of charts first, then held by a stand-in so the tiling below grows nothing into it
  let railAdd = null
  const railSet = {}
  if (rail && !board.some(w => w.type === rail.type)) {
    const rw = rail.w || RAIL_W
    const rx = cols - rw
    const inRail = onGrid.filter(w => w.x + w.w > rx)
    const blocker = inRail.find(w => w.type !== 'chart' || w.x >= rx)
    if (blocker) return { ok: false, reason: `There's no room for a ${rail.label || rail.type} on the right without moving the ${blocker.type === 'chart' ? 'chart' : rail.labelOf?.(blocker.type) || blocker.type} there — make room first, or ask without it.` }
    const { minW } = minOf({ type: 'chart' })
    if (inRail.some(w => rx - w.x < minW)) return { ok: false, reason: `There's no room for a ${rail.label || rail.type} beside your charts — they would be narrower than a chart can be.` }
    if (board.length + 1 > maxWidgets) return { ok: false, reason: `The workspace already holds ${board.length} widgets — there's no room for a ${rail.label || rail.type} too.` }
    for (const w of inRail) railSet[String(w.id)] = { x: w.x, y: w.y, w: rx - w.x, h: w.h }
    onGrid = [...onGrid.map(w => (railSet[String(w.id)] ? { ...w, ...railSet[String(w.id)] } : w)), { id: '__rail', type: rail.type, x: rx, y: 0, w: rw, h: rows }]
    railAdd = { type: rail.type, rect: { x: rx, y: 0, w: rw, h: rows } }
  }
  const chartWs = onGrid.filter(w => w.type === 'chart' && charts.has(String(w.id))).sort(readingOrder)
  // the charts that take a cell: the first n (reused for the tickers), or with newCharts every chart (kept as they are)
  const reuseWs = newCharts ? chartWs : chartWs.slice(0, n)
  const k = reuseWs.length
  const needed = newCharts ? n : n - k
  if (board.length + needed + (railAdd ? 1 : 0) > maxWidgets) {
    const free = Math.max(0, maxWidgets - board.length)
    return { ok: false, reason: `That needs ${needed} more chart${needed === 1 ? '' : 's'}, but the workspace holds ${maxWidgets} widgets and has room for ${free} more. Close a widget you don't need, or ask for fewer charts.` }
  }
  const pattern = layout || 'grid'
  const tiled = needed > 0 || layout != null
  let set = {}
  let addRects = []
  let shape = null
  if (tiled && k === 0) {
    // no chart to build on: equal cells in ONE empty region (the product's group placement), nothing moved
    const one = n === 1 ? (() => { try { return planPlacement(onGrid, 'chart', cols, rows) } catch { return null } })() : null
    const cells = n === 1 ? (one?.place && !(one.mutations || []).length ? [one.place] : null) : planGroupPlacement(onGrid, 'chart', n, cols, rows)
    if (!cells || cells.length !== n) {
      return { ok: false, reason: `There's no empty space for ${n === 1 ? 'a chart' : `${n} charts`} and no chart on this board to rearrange — remove or shrink a widget first.` }
    }
    addRects = cells.map(c => ({ x: c.x, y: c.y, w: c.w, h: c.h }))
  } else if (tiled) {
    // the new charts stand in at the last reused chart's place: they extend its row of the grid
    const last = reuseWs[k - 1]
    const phantoms = Array.from({ length: needed }, (_, i) => ({ id: `__new${i}`, type: 'chart', x: last.x, y: last.y, w: last.w, h: last.h }))
    const ids = [...reuseWs.map(w => String(w.id)), ...phantoms.map(p => p.id)]
    const rects = tileWidgets([...onGrid.map(w => ({ ...w, id: String(w.id) })), ...phantoms], ids, pattern, cols, rows)
    if (!rects) {
      return { ok: false, reason: 'Your charts are separated by other widgets, so they can’t be re-tiled into one even grid without moving those widgets. Move the other widgets aside (or remove one), then ask again.' }
    }
    const { minW, minH } = minOf({ type: 'chart' })
    if (Object.values(rects).some(r => r.w < minW || r.h < minH)) {
      return { ok: false, reason: `There isn't room for ${k + needed} equal charts in the space your charts take up — each would be smaller than a chart can be. Ask for fewer, or make room first.` }
    }
    for (const w of reuseWs) {
      const r = rects[String(w.id)]
      // (compared with the board as it IS — a chart narrowed out of the rail has moved even if its tile is that cell)
      const orig = board.find(b => String(b.id) === String(w.id)) || w
      if (r && !sameRect(r, orig)) set[String(w.id)] = r
    }
    addRects = phantoms.map(p => rects[p.id])
    const ys = [...new Set(Object.values(rects).map(r => r.y))]
    shape = { rows: ys.length, cols: Math.max(...ys.map(y => Object.values(rects).filter(r => r.y === y).length)) }
  }
  // a chart narrowed out of the rail and not re-tiled keeps its narrowed cell
  for (const [id, r] of Object.entries(railSet)) if (!set[id] && !sameRect(r, board.find(w => String(w.id) === id))) set[id] = r
  if (tiled || railAdd) {
    // the resulting board must pass the board's own rules (inside the grid, minimum sizes, no overlap)
    const next = [...onGrid.map(w => (set[String(w.id)] ? { ...w, ...set[String(w.id)] } : w)), ...addRects.map((r, i) => ({ id: `__add${i}`, type: 'chart', ...r }))]
    const ps = boardProblems(next, cols, rows, minOf)
    if (ps.length) return { ok: false, reason: `Those ${k + needed} charts don't fit on this board without moving other widgets — make room first, or ask for fewer.` }
  }
  // link groups: two charts that share a colour always show the same symbol
  const unlink = []
  const groups = new Map()
  for (const w of reuseWs) {
    const g = w.color || 'A'
    if (g === 'N') continue
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(w)
  }
  const reusedIds = new Set(reuseWs.map(w => String(w.id)))
  if (newCharts) groups.clear()                    // kept charts keep their tickers, so their links too
  for (const [g, list] of groups) {
    const outside = chartWs.some(w => (w.color || 'A') === g && !reusedIds.has(String(w.id)))
    for (let i = 0; i < list.length; i++) if (outside || i > 0) unlink.push(String(list[i].id))
  }
  const reuse = reuseWs.map((w, i) => {
    const c = charts.get(String(w.id))
    if (newCharts) return { id: String(w.id), ref: c.ref, symbol: null, tf: null, from: { symbol: c.symbol ?? null, tf: c.tf ?? null } }
    const want = syms[i]
    return {
      id: String(w.id), ref: c.ref,
      symbol: String(c.symbol || '').toUpperCase() === want && !unlink.includes(String(w.id)) ? null : want,
      tf: timeframe && c.tf !== timeframe ? timeframe : null,
      from: { symbol: c.symbol ?? null, tf: c.tf ?? null },
    }
  })
  const add = addRects.map((rect, i) => ({ rect, symbol: syms[(newCharts ? 0 : k) + i], tf: timeframe || null }))
  if (railAdd) add.push({ type: railAdd.type, rect: railAdd.rect, opts: {} })
  const noop = !add.length && !Object.keys(set).length && !unlink.length && reuse.every(r => r.symbol == null && r.tf == null)
  return { ok: true, reuse: newCharts ? reuse.filter(r => r.id in set) : reuse, add, set, unlink, tiled, shape, noop, symbols: syms, timeframe, newCharts: !!newCharts, kept: newCharts ? k : 0, rail: railAdd ? railAdd.type : null }
}
