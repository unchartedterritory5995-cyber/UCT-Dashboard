// app/src/components/chart/labelDeclutter.js
//
// Anti-jumble placement for the Setup Library's free-form text annotations.
//
// Each label carries an AUTHORED home box (where the admin placed it) plus a
// leader anchor (the chart point it refers to — its own click point for free
// text, or the candle high/low for a "+X%" advance label). When the chart is
// zoomed out (Setup → Result) the home boxes pile onto candles and onto each
// other. This pass keeps every label exactly where it was placed WHEN THERE'S
// ROOM, and only nudges the crowded ones into the nearest blank space, drawing
// a thin leader line back to the anchor so the reference is never lost.
//
// It mirrors the nearest-blank-space search used by ChartCalloutOverlay (the
// Model Book catalyst labels) but, unlike that one, prefers the authored spot
// instead of always re-placing — free-form annotations carry intent.
//
// Pure + deterministic (no Date/Math.random) so it's safe to call every frame.

const DIRS = [
  { dx: -1, dy: -1 }, // up-left (preferred via the small bias below)
  { dx: 1, dy: -1 },  // up-right
  { dx: -1, dy: 1 },  // down-left
  { dx: 1, dy: 1 },   // down-right
]
// Outward search radii from the home box — nearest clear gap wins, but the range
// reaches far enough that a dense cluster always resolves to a readable spot.
const DISTS = [14, 22, 32, 44, 58, 76, 98, 126, 162, 206]

// Boxes overlap (with a little breathing room) — labels must never touch.
const rectsOverlap = (a, b) =>
  !(a.x + a.w < b.x - 6 || b.x + b.w < a.x - 6 || a.y + a.h < b.y - 4 || b.y + b.h < a.y - 4)

/**
 * @param {Object}   o
 * @param {Array}    o.items   [{ id, ax, ay, boxW, boxH, lines, lx, ly, kind, text }]
 *                             ax/ay = home box top-left; lx/ly = leader anchor (chart point).
 * @param {Array}    o.segs    visible candle pixel extents [{ x, top, bottom }]
 * @param {number}   o.plotLeft / o.plotRight   horizontal label bounds (price axis excluded)
 * @param {number}   o.top / o.bottom           vertical label bounds (price pane only)
 * @param {Map}      o.cache   id → { offX, offY } offset from the home anchor, reused while moving
 * @param {boolean}  o.useCache  true = ride cached offsets (smooth pan/zoom); false = re-search
 * @returns {Array}  [{ id, x, y, w, h, lines, kind, text, leader|null }]
 */
export function placeLabels({ items, segs, plotLeft, plotRight, top, bottom, cache, useCache }) {
  const hitsCandles = (r) => {
    for (const s of segs) {
      if (s.x < r.x - 2 || s.x > r.x + r.w + 2) continue
      if (s.bottom < r.y || s.top > r.y + r.h) continue
      return true
    }
    return false
  }
  const clamp = (r) => {
    r.x = Math.max(plotLeft, Math.min(Math.max(plotLeft, plotRight - r.w), r.x))
    r.y = Math.max(top, Math.min(Math.max(top, bottom - r.h), r.y))
    return r
  }

  // Place left-to-right so earlier (left) labels claim their spot first.
  const sorted = [...items].sort((a, b) => a.ax - b.ax)
  const placed = []   // boxes already committed this pass
  const out = []

  for (const it of sorted) {
    let rect
    const cached = useCache ? cache.get(it.id) : null
    if (cached) {
      // Ride the offset captured at the last settle so the label glides rigidly
      // with its candle through a pan/zoom instead of re-searching every frame.
      rect = clamp({ x: it.ax + cached.offX, y: it.ay + cached.offY, w: it.boxW, h: it.boxH })
    } else {
      const home = clamp({ x: it.ax, y: it.ay, w: it.boxW, h: it.boxH })
      const homeClear = !hitsCandles(home) && !placed.some(p => rectsOverlap(home, p))
      if (homeClear) {
        rect = home
      } else {
        // Search outward for the nearest blank gap; candle/label overlap is a hard
        // penalty so a clean spot always beats a graze, with a gentle up-left lean.
        let best = null, bestCost = Infinity
        for (const dist of DISTS) {
          for (const d of DIRS) {
            const cand = clamp({
              x: it.ax + d.dx * dist,
              y: it.ay + d.dy * dist,
              w: it.boxW, h: it.boxH,
            })
            let cost = dist + (d.dy < 0 ? -8 : 0) + (d.dx < 0 ? -4 : 0)
            if (placed.some(p => rectsOverlap(cand, p))) cost += 1e6
            if (hitsCandles(cand)) cost += 1e5
            if (cost < bestCost) { bestCost = cost; best = cand }
          }
        }
        rect = best || home
      }
      cache.set(it.id, { offX: rect.x - it.ax, offY: rect.y - it.ay })
    }
    placed.push(rect)

    // Draw a leader only when the box actually moved away from its anchor.
    let leader = null
    const movedX = Math.abs(rect.x - it.ax)
    const movedY = Math.abs(rect.y - it.ay)
    if (movedX > 3 || movedY > 3) {
      const nx = Math.max(rect.x, Math.min(rect.x + rect.w, it.lx))
      const ny = Math.max(rect.y, Math.min(rect.y + rect.h, it.ly))
      leader = { x0: it.lx, y0: it.ly, x1: nx, y1: ny }
    }
    out.push({ id: it.id, x: rect.x, y: rect.y, w: rect.w, h: rect.h, lines: it.lines, kind: it.kind, text: it.text, leader })
  }
  return out
}
