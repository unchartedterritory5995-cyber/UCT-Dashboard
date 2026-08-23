// Region inference for smart adaptive widget placement.
//
// A "region" is a vertical column-band of the react-grid-layout workspace — a set
// of widgets that share (substantially overlapping) horizontal x-spans and are
// therefore stacked in the same column. The left "chart region" and the right
// "sidebar rail" in a typical /charts layout are two regions.
//
// This is the single geometric authority behind both smart ADD (place a newcomer
// into the region whose family it matches, filling empty space) and, later, smart
// CLOSE reflow (a survivor reclaims the freed gap). It is a PURE function — no
// DOM, no React — so the ghost preview and the real commit compute from the same
// result, and the two owner-screenshot scenarios can be pinned as unit fixtures.
//
// Grid units are react-grid-layout columns/rows (24 × 20 on /charts).

import { WIDGET_REGISTRY } from '../../../widgets/registry'

export function familyOf(type) {
  return WIDGET_REGISTRY[type]?.placement?.family || 'panel'
}

// Horizontal overlap of two widgets as a fraction of the NARROWER one's width.
// 1 = identical column span (a stacked rail); 0 = side-by-side, no shared column.
export function overlapRatio(a, b) {
  const lo = Math.max(a.x, b.x)
  const hi = Math.min(a.x + a.w, b.x + b.w)
  const ov = Math.max(0, hi - lo)
  const minW = Math.min(a.w, b.w)
  return minW > 0 ? ov / minW : 0
}

// A widget joins a region when it overlaps the region's current column span by at
// least this fraction. 0.5 keeps a full-width chart and a narrow side rail apart
// while collapsing casing/rounding differences between aligned, stacked widgets.
const JOIN_THRESHOLD = 0.5

// Vertical free segments (row-runs with NO member covering them) across a region's
// column band. Each becomes a candidate gap the full width of the band.
function computeGaps(members, regionX, regionW, rows) {
  const occupied = new Array(rows).fill(false)
  for (const m of members) {
    const y0 = Math.max(0, m.y | 0)
    const y1 = Math.min(rows, (m.y | 0) + (m.h | 0))
    for (let y = y0; y < y1; y++) occupied[y] = true
  }
  const gaps = []
  let run = -1
  for (let y = 0; y <= rows; y++) {
    const free = y < rows && !occupied[y]
    if (free && run < 0) run = y
    else if (!free && run >= 0) {
      gaps.push({ x: regionX, y: run, w: regionW, h: y - run })
      run = -1
    }
  }
  return gaps
}

// Most-common family among a region's members; ties broken by total occupied area
// (a big chart outweighs a small panel that happens to share the count).
function dominantFamily(members) {
  const byFam = new Map()
  for (const m of members) {
    const f = familyOf(m.type)
    const prev = byFam.get(f) || { count: 0, area: 0 }
    byFam.set(f, { count: prev.count + 1, area: prev.area + (m.w | 0) * (m.h | 0) })
  }
  let best = null, bestKey = 'panel'
  for (const [f, v] of byFam) {
    if (!best || v.count > best.count || (v.count === best.count && v.area > best.area)) {
      best = v; bestKey = f
    }
  }
  return bestKey
}

// Group the current widgets into column-band regions.
// Returns [{ x, w, yTop, yBottom, members[], dominantFamily, gaps[] }], left→right.
export function inferRegions(widgets, cols = 24, rows = 20) {
  const items = (widgets || []).filter(
    w => w && Number.isFinite(w.x) && Number.isFinite(w.y) && Number.isFinite(w.w) && Number.isFinite(w.h)
  )
  const regions = []
  // x-then-y order makes the greedy clustering deterministic (left rail first).
  for (const w of [...items].sort((a, b) => a.x - b.x || a.y - b.y)) {
    const region = regions.find(r => overlapRatio({ x: r.x, w: r.w }, w) >= JOIN_THRESHOLD)
    if (region) {
      region.members.push(w)
      // Grow the band to the tightest interval covering all members.
      const right = Math.max(region.x + region.w, w.x + w.w)
      region.x = Math.min(region.x, w.x)
      region.w = right - region.x
    } else {
      regions.push({ x: w.x, w: w.w, members: [w] })
    }
  }
  // A region can never extend past the grid edge.
  for (const r of regions) r.w = Math.min(r.w, cols - r.x)
  for (const r of regions) {
    r.yTop = Math.min(...r.members.map(m => m.y | 0))
    r.yBottom = Math.max(...r.members.map(m => (m.y | 0) + (m.h | 0)))
    r.dominantFamily = dominantFamily(r.members)
    r.gaps = computeGaps(r.members, r.x, r.w, rows)
  }
  return regions.sort((a, b) => a.x - b.x)
}

// Tallest gap in a list of gaps (or null).
export function tallestGap(gaps) {
  return (gaps || []).reduce((a, b) => (!a || b.h > a.h ? b : a), null)
}
