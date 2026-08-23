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

// 50/50 horizontal split: newcomer takes the LEFT half at the target's full height,
// target shrinks to the right. Used to carve a rail when no matching region exists.
function splitHorizontal(d, target) {
  if (!target) return null
  const targetMinW = defOf(target.type).minW || 2
  const newW = Math.floor(target.w / 2)
  const shrunkW = target.w - newW
  if (newW < (d.minW || 2) || shrunkW < targetMinW) return null
  return {
    place: { x: target.x, y: target.y, w: newW, h: target.h },
    mutations: [{ id: target.id, x: target.x + newW, w: shrunkW }],
  }
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
    const target = affinity ? largestMember(affinity, 'chart') : tallest(widgets)
    const split = splitVertical(d, target)
    if (split) return { place: clampPlace(split.place, d, cols, rows), mutations: split.mutations }
  } else if (affinity) {
    // Panel with a matching rail but no gap → stack into the rail (split its widget).
    const split = splitVertical(d, largestMember(affinity))
    if (split) return { place: clampPlace(split.place, d, cols, rows), mutations: split.mutations }
  } else {
    // Panel with no rail → carve one beside the widest widget.
    const split = splitHorizontal(d, widest(widgets))
    if (split) return { place: clampPlace(split.place, d, cols, rows), mutations: split.mutations }
  }

  // 5. Last resort — full-width slot the caller bottom-packs (mirrors old behavior).
  return { place: { x: 0, y: Math.max(0, rows - d.h), w: Math.min(cols, d.w), h: d.h }, mutations: [] }
}

// Close reflow — the symmetric inverse of add. When a widget is removed, the
// widget vertically adjacent to it WITHIN THE SAME COLUMN BAND reclaims the freed
// space (the theme tracker grows to fill the rail when the breadth panel below it
// closes; a split chart's sibling grows back to full height). Returns the new
// widgets array (removed widget gone, neighbor grown) — or just the removed-widget
// filtered list when nothing sits flush against the vacated slot.
export function reflowOnClose(widgets, removedId) {
  const removed = (widgets || []).find(w => w.id === removedId)
  const rest = (widgets || []).filter(w => w.id !== removedId)
  if (!removed) return rest
  // Same column band: members whose x-span substantially overlaps the removed one.
  const band = rest.filter(w => overlapRatio(w, removed) >= 0.5)
  if (!band.length) return rest
  const rTop = removed.y, rBot = removed.y + removed.h
  // Prefer the widget directly ABOVE (grows downward); else the one directly BELOW
  // (grows upward). "Directly" = its edge is flush against the vacated slot.
  const above = band.filter(w => w.y + w.h <= rTop).sort((a, b) => (b.y + b.h) - (a.y + a.h))[0]
  const below = band.filter(w => w.y >= rBot).sort((a, b) => a.y - b.y)[0]
  let grown = null
  if (above && above.y + above.h === rTop) {
    grown = { id: above.id, patch: { h: above.h + removed.h } }
  } else if (below && below.y === rBot) {
    grown = { id: below.id, patch: { y: below.y - removed.h, h: below.h + removed.h } }
  }
  if (!grown) return rest
  return rest.map(w => (w.id === grown.id ? { ...w, ...grown.patch } : w))
}
