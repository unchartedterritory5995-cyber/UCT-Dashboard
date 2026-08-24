// Smart adaptive placement engine — decides WHERE and at what SIZE a newly added
// widget lands, given the widgets already in the /charts workspace.
//
// Strategy (owner-decided, see docs/superpowers/plans/2026-08-23-smart-adaptive-
// widget-placement.md):
//   1. Affinity region — the column-band whose dominant family matches the newcomer
//      (chart→chart region, panel→sidebar rail).
//   2. Fill empty space IN that region — drop into its tallest gap at the region's
//      width (a panel adopts the rail width; a chart adopts the region width).
//   3. Fill empty space ANYWHERE — best-fit first-fit fallback (reuses findPlacement).
//   4. Resize existing (fallback) — no empty space, so make room by splitting the
//      region's dominant widget 50/50 (charts split vertically; a panel stacks into
//      its rail, or carves a rail by side-splitting the widest widget).
//   5. Last resort — a full-width slot the caller bottom-packs.
//
// PURE: no DOM, no React. Returns { place:{x,y,w,h}, mutations:[{id,...}] } where
// `mutations` are geometry changes to apply to EXISTING widgets (empty unless a
// resize happened). The caller merges mutations then adds the new widget at `place`.

import { WIDGET_REGISTRY } from '../../../widgets/registry'
import { findPlacement } from '../findOpenSlot'
import { inferRegions, tallestGap, familyOf, overlapRatio } from './regions'

function defOf(type) {
  return WIDGET_REGISTRY[type]?.defaults || { w: 6, h: 8, minW: 2, minH: 3 }
}

function clampPlace(p, d, cols, rows) {
  const minW = d.minW || 2
  const minH = d.minH || 3
  let x = Math.max(0, Math.min(p.x | 0, cols - minW))
  let w = Math.max(minW, Math.min(p.w | 0, cols - x))
  let y = Math.max(0, Math.min(p.y | 0, rows - minH))
  let h = Math.max(minH, Math.min(p.h | 0, rows - y))
  return { x, y, w, h }
}

// Choose the region whose dominant family matches `family`. Prefer one that has a
// usable gap (so we can fill empty space); otherwise the largest by member area
// (so a resize split targets the biggest widget). Null when none match.
function pickAffinityRegion(regions, family, minGapH) {
  const matching = regions.filter(r => r.dominantFamily === family)
  if (!matching.length) return null
  const withGap = matching
    .map(r => ({ r, gap: tallestGap(r.gaps) }))
    .filter(x => x.gap && x.gap.h >= minGapH)
    .sort((a, b) => b.gap.h - a.gap.h)
  if (withGap.length) return withGap[0].r
  const area = r => r.members.reduce((s, m) => s + (m.w | 0) * (m.h | 0), 0)
  return [...matching].sort((a, b) => area(b) - area(a))[0]
}

function largestMember(region, family = null) {
  const pool = family ? region.members.filter(m => familyOf(m.type) === family) : region.members
  const list = pool.length ? pool : region.members
  return list.reduce((a, b) => (!a || (b.w | 0) * (b.h | 0) > (a.w | 0) * (a.h | 0) ? b : a), null)
}

const tallest = arr => (arr || []).reduce((a, b) => (!a || b.h > a.h ? b : a), null)
const widest = arr => (arr || []).reduce((a, b) => (!a || b.w > a.w ? b : a), null)

// Vertical split: `target` keeps the top, the newcomer takes the bottom at the
// target's full width. `newHArg` sets the newcomer's height (clamped so neither half
// drops below its min); omitted → a 50/50 split. Returns { place, mutations } or null.
function splitVertical(d, target, newHArg) {
  if (!target) return null
  const targetMinH = defOf(target.type).minH || 3
  const dMinH = d.minH || 3
  let newH = newHArg != null ? newHArg : Math.floor(target.h / 2)
  newH = Math.max(dMinH, Math.min(newH, target.h - targetMinH))
  const shrunkH = target.h - newH
  if (newH < dMinH || shrunkH < targetMinH) return null
  return {
    place: { x: target.x, y: target.y + shrunkH, w: target.w, h: newH },
    mutations: [{ id: target.id, h: shrunkH }],
  }
}

// The chart region with the most chart area (a widget that docks below "the chart"
// targets this one). Null when the board has no chart.
function chartRegionOf(regions) {
  const charts = regions.filter(r => r.dominantFamily === 'chart')
  if (!charts.length) return null
  const area = r => r.members.reduce((s, m) => s + (m.w | 0) * (m.h | 0), 0)
  return [...charts].sort((a, b) => area(b) - area(a))[0]
}

// The bottom-most chart in a region (what a below-chart dock sits under).
function bottomChart(region) {
  const charts = region.members.filter(m => familyOf(m.type) === 'chart')
  return (charts.length ? charts : region.members)
    .reduce((a, b) => (!a || (b.y + b.h) > (a.y + a.h) ? b : a), null)
}

// Horizontal split: newcomer takes the LEFT slice at the target's full height, target
// shrinks to the right. `newWArg` sets the newcomer's width (a rail carved beside a
// chart adopts the existing rail's width); omitted → a 50/50 split. When a rail width
// is requested it may go below the newcomer's own minW (the rail width is authoritative,
// matching the panel rail-match rule); the target must still keep its minW.
function splitHorizontal(d, target, newWArg) {
  if (!target) return null
  const targetMinW = defOf(target.type).minW || 2
  const floorW = newWArg != null ? 1 : (d.minW || 2)
  let newW = newWArg != null ? newWArg : Math.floor(target.w / 2)
  newW = Math.max(floorW, Math.min(newW, target.w - targetMinW))
  const shrunkW = target.w - newW
  if (newW < floorW || shrunkW < targetMinW) return null
  return {
    place: { x: target.x, y: target.y, w: newW, h: target.h },
    mutations: [{ id: target.id, x: target.x + newW, w: shrunkW }],
  }
}

// Final fallback: reserve a full-width strip across the BOTTOM, shrinking every widget
// that crosses into it so the newcomer sits below on-screen (never off the bottom).
// Returns { place, mutations } or null when a widget already occupies the strip or
// can't shrink enough — the true last resort then places bare.
function bottomStripWithMutations(widgets, d, cols, rows) {
  const stripH = Math.max(d.minH || 3, Math.min(d.h, Math.floor(rows / 2)))
  const cutY = rows - stripH
  const mutations = []
  for (const w of widgets || []) {
    const wy = w.y | 0, wh = w.h | 0
    if (wy >= cutY) return null
    if (wy + wh > cutY) {
      const nh = cutY - wy
      if (nh < (defOf(w.type).minH || 3)) return null
      mutations.push({ id: w.id, h: nh })
    }
  }
  return { place: { x: 0, y: cutY, w: cols, h: stripH }, mutations }
}

export function planPlacement(widgets, type, cols = 24, rows = 20) {
  const d = defOf(type)
  const family = familyOf(type)
  const minGapH = d.minH || 3
  const regions = inferRegions(widgets, cols, rows)

  // 1. Dock-below-chart widgets (e.g. Fundamentals) ALWAYS sit under a chart when one
  // exists — a short strip at the chart's width, filling the bottom gap or splitting a
  // strip off the bottom of the chart. Falls through to normal panel logic if no chart.
  const dock = WIDGET_REGISTRY[type]?.placement?.dock
  if (dock === 'below-chart') {
    const cr = chartRegionOf(regions)
    if (cr) {
      const gap = tallestGap(cr.gaps)
      if (gap && gap.h >= minGapH) {
        return { place: clampPlace({ x: cr.x, y: gap.y, w: cr.w, h: gap.h }, d, cols, rows), mutations: [] }
      }
      const split = splitVertical(d, bottomChart(cr), d.h)
      if (split) return { place: clampPlace(split.place, d, cols, rows), mutations: split.mutations }
    }
  }

  const affinity = pickAffinityRegion(regions, family, minGapH)

  // 2. Fill empty space in the affinity region (adopt its width — rail-match).
  if (affinity) {
    const gap = tallestGap(affinity.gaps)
    if (gap && gap.h >= minGapH) {
      return { place: clampPlace({ x: affinity.x, y: gap.y, w: affinity.w, h: gap.h }, d, cols, rows), mutations: [] }
    }
  }

  // 3. Fill empty space anywhere (best-fit first-fit, shrink toward min).
  const fit = findPlacement(widgets, d, cols, rows)
  if (Number.isFinite(fit.y) && fit.y + fit.h <= rows) {
    return { place: fit, mutations: [] }
  }

  // 4. Resize an existing widget to make room.
  if (family === 'chart') {
    // Split the chart region's dominant chart 50/50 (stack a second chart).
    const target = affinity ? largestMember(affinity, 'chart') : tallest(widgets)
    const split = splitVertical(d, target)
    if (split) return { place: clampPlace(split.place, d, cols, rows), mutations: split.mutations }
  } else {
    // Panel: first try to stack into a matching rail (split one of its widgets). When
    // the rail is FULL (splitVertical can't halve any member without going below its
    // min), carve a NEW rail beside the widest chart at the existing rail's width — the
    // "the right side is full, put it on the left" case — instead of overflowing.
    const railW = affinity ? affinity.w : undefined
    let split = affinity ? splitVertical(d, largestMember(affinity)) : null
    if (!split) {
      const charts = widgets.filter(w => familyOf(w.type) === 'chart')
      const target = widest(charts.length ? charts : widgets)
      split = splitHorizontal(d, target, railW)
    }
    if (split) return { place: clampPlace(split.place, d, cols, rows), mutations: split.mutations }
  }

  // 5. Last resort — reserve a bottom strip, shrinking crossers so the newcomer stays
  // on-screen (a bare overlapping placement would let RGL shove it off the bottom).
  const strip = bottomStripWithMutations(widgets, d, cols, rows)
  if (strip) return { place: clampPlace(strip.place, d, cols, rows), mutations: strip.mutations }
  return { place: { x: 0, y: Math.max(0, rows - d.h), w: Math.min(cols, d.w), h: d.h }, mutations: [] }
}

// ── Ghost-mode directional nudge ─────────────────────────────────────────────
// While the placement ghost is open, arrows let the user move the proposed widget
// around the board before committing. Each nudge returns a fresh { place, mutations }
// (or null when the move isn't possible → that arrow is hidden).

function applyMutations(orig, muts) {
  const byId = Object.fromEntries((muts || []).map(m => [m.id, m]))
  return (orig || []).map(w => (byId[w.id] ? { ...w, ...byId[w.id] } : { ...w }))
}

// Complete geometry diff of `proposed` vs `orig` → the mutation list for widgets
// whose x/y/w/h changed (the ghost itself is not a widget and isn't included).
function diffMutations(orig, proposed) {
  const pById = Object.fromEntries(proposed.map(w => [w.id, w]))
  const out = []
  for (const o of orig || []) {
    const p = pById[o.id]
    if (!p) continue
    const patch = {}
    for (const k of ['x', 'y', 'w', 'h']) if ((p[k] | 0) !== (o[k] | 0)) patch[k] = p[k]
    if (Object.keys(patch).length) out.push({ id: o.id, ...patch })
  }
  return out
}

// dir ∈ 'up' | 'down' | 'left' | 'right'. `cur` = the current { place, mutations }.
// up/down swap the ghost with the flush neighbor in its column band; left/right carve
// a fresh full-height rail at that edge of the widest chart (recomputed from original,
// discarding prior displacement). Returns { place, mutations } or null.
export function nudgePlan(widgets, cur, dir) {
  const orig = (widgets || []).filter(w => w && Number.isFinite(w.x) && Number.isFinite(w.y))
  const g = cur?.place
  if (!g) return null

  if (dir === 'up' || dir === 'down') {
    const proposed = applyMutations(orig, cur.mutations)
    const band = proposed.filter(w => overlapRatio(w, g) >= 0.5)
    if (dir === 'down') {
      const below = band.find(w => (w.y | 0) === g.y + g.h)
      if (!below) return null
      below.y = g.y                                   // neighbor rises into the ghost's slot
      const place = { ...g, y: g.y + below.h }        // ghost drops below it
      return { place, mutations: diffMutations(orig, proposed) }
    }
    const above = band.filter(w => (w.y | 0) + (w.h | 0) === g.y).sort((a, b) => b.y - a.y)[0]
    if (!above) return null
    const place = { ...g, y: above.y }                // ghost rises to the neighbor's slot
    above.y = above.y + g.h                           // neighbor drops below the ghost
    return { place, mutations: diffMutations(orig, proposed) }
  }

  // left / right — carve a full-height rail at that edge of the widest chart.
  const charts = orig.filter(w => familyOf(w.type) === 'chart')
  const target = widest(charts.length ? charts : orig)
  if (!target) return null
  const targetMinW = defOf(target.type).minW || 2
  const railW = Math.max(1, Math.min(g.w, target.w - targetMinW))
  if (target.w - railW < targetMinW) return null
  const proposed = orig.map(w => ({ ...w }))
  const t = proposed.find(w => w.id === target.id)
  let place
  if (dir === 'left') {
    place = { x: t.x, y: t.y, w: railW, h: t.h }
    t.x = t.x + railW; t.w = t.w - railW
  } else {
    t.w = t.w - railW
    place = { x: t.x + t.w, y: t.y, w: railW, h: t.h }
  }
  // Don't offer a move that lands the ghost where it already sits.
  if (place.x === g.x && place.y === g.y && place.w === g.w && place.h === g.h) return null
  return { place, mutations: diffMutations(orig, proposed) }
}
