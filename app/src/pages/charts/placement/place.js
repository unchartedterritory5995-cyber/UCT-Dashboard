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

// ── Ghost-mode directional nudge (column-model state machine) ─────────────────
// While the placement ghost is open, arrows move the proposed widget around the
// board before committing. The board is modeled as ordered left→right COLUMNS
// (the same x-band clustering as inferRegions). The ghost has an ANCHOR describing
// where it currently sits:
//   { kind:'col',  gap }           — the ghost is its OWN full-height column,
//                                     inserted at gap index (0 = far left … N = far
//                                     right); the chart column flexes to make room.
//   { kind:'stack', colKey, pos }  — the ghost is stacked INTO a column (pos 'top'
//                                     or 'bottom'); one member of that column splits.
// Arrows step through anchors (nudgeAnchor); each anchor resolves to a concrete
// { place, mutations }. nudgePlan returns { place, mutations, anchor } (or null when
// the move isn't possible → that arrow is hidden). The anchor is threaded back onto
// pendingAdd so the next nudge continues from the current state, not geometry.

// Ordered left→right columns from the ORIGINAL widgets. `key` = a stable id for
// anchor addressing (the leftmost-then-topmost member's id).
function buildColumns(widgets, cols, rows) {
  const regions = inferRegions(widgets, cols, rows)
  return regions.map(r => {
    const members = [...r.members].sort((a, b) => (a.y | 0) - (b.y | 0))
    const keyMember = [...r.members].sort(
      (a, b) => (a.x | 0) - (b.x | 0) || (a.y | 0) - (b.y | 0)
    )[0]
    return {
      key: keyMember?.id, x: r.x, w: r.w, members,
      family: r.dominantFamily, yTop: r.yTop, yBottom: r.yBottom,
    }
  })
}

// A column's members top→bottom.
function colMembers(c) { return [...c.members].sort((a, b) => (a.y | 0) - (b.y | 0)) }

// A stacked ghost occupies one of 2·M "half-slots" in a column of M members:
// slot 2k = the TOP half of member k (ghost above it), slot 2k+1 = the BOTTOM half
// (ghost below it). UP/DOWN walk this list, so a ghost cycles through every half of
// every member of the column it's in (e.g. "upper half of theme tracker" → "bottom
// half" → stop) and never jumps to another column.
function slotCount(c) { return colMembers(c).length * 2 }

// The half-slot whose visual center is nearest `y`. `dir` biases the pick so DOWN
// enters at/below the cursor and UP at/above it (and each further press keeps moving
// that way). Returns a slot index in [0, 2M-1].
function slotNearestY(c, y, dir) {
  const ms = colMembers(c)
  const slots = []
  ms.forEach((m, mi) => {
    slots.push({ k: mi * 2, c: (m.y | 0) + (m.h | 0) / 4 })
    slots.push({ k: mi * 2 + 1, c: (m.y | 0) + 3 * (m.h | 0) / 4 })
  })
  let pool = slots
  if (dir === 'down') { const b = slots.filter(s => s.c >= y); if (b.length) pool = b }
  else if (dir === 'up') { const a = slots.filter(s => s.c <= y); if (a.length) pool = a }
  return pool.reduce((a, b) => (Math.abs(b.c - y) < Math.abs(a.c - y) ? b : a), pool[0]).k
}

// Infer the ghost's anchor from its place + the mutations that produced it. A
// horizontal mutation (an existing widget shifted/resized in x) means the ghost is a
// side column; otherwise it's stacked into the column it overlaps.
function deriveAnchor(place, columns, mutations) {
  const horiz = (mutations || []).some(m => m.x != null || m.w != null)
  if (!horiz) {
    let bestI = -1, bestOv = 0
    columns.forEach((c, i) => {
      const ov = overlapRatio({ x: c.x, w: c.w }, { x: place.x, w: place.w })
      if (ov >= 0.5 && ov > bestOv) { bestOv = ov; bestI = i }
    })
    if (bestI >= 0) {
      const c = columns[bestI]
      return { kind: 'stack', colKey: c.key, slot: slotNearestY(c, place.y + place.h / 2) }
    }
  }
  let gap = 0
  for (const c of columns) if (c.x + c.w <= place.x + 1) gap++
  return { kind: 'col', gap }
}

// Columns ordered by distance from a gap (both immediate neighbors are distance 0).
function colsByDistance(columns, gap) {
  return columns
    .map((c, i) => ({ c, d: i >= gap ? i - gap : gap - 1 - i }))
    .sort((a, b) => a.d - b.d)
    .map(x => x.c)
}

// The column a ghost at `gap` should stack into on UP/DOWN — the one it's next to. A
// CHART ghost seeks the nearest CHART column (a chart never crams into a narrow rail);
// a PANEL ghost takes the nearest column of any kind (usually the rail beside it, or
// the chart once it has stepped over the chart's own column).
function nearestCol(columns, gap, ghostFamily) {
  const ordered = colsByDistance(columns, gap)
  if (ghostFamily === 'chart') return ordered.find(c => c.family === 'chart') || ordered[0] || null
  return ordered[0] || null
}

// The ordered LEFT↔RIGHT sequence the ghost steps through: every column-gap (own
// column), interleaved — for a PANEL ghost only — with a "merge into this rail" stop
// after each panel column. A chart ghost never merges into a rail, so it just steps
// gap→gap. LEFT/RIGHT walk this list by ±1, which makes every horizontal move
// reversible by construction. (Vertical moves within a column are handled separately.)
function hSequence(columns, ghostFamily) {
  const H = []
  for (let k = 0; k < columns.length; k++) {
    H.push({ kind: 'col', gap: k })
    if (ghostFamily === 'panel' && columns[k].family === 'panel') {
      H.push({ kind: 'stack', colKey: columns[k].key, slot: 0 })
    }
  }
  H.push({ kind: 'col', gap: columns.length })
  return H
}

function hStep(columns, ghostFamily, anchor, dir) {
  const H = hSequence(columns, ghostFamily)
  const i = H.findIndex(e => e.kind === anchor.kind && (e.kind === 'col' ? e.gap === anchor.gap : e.colKey === anchor.colKey))
  if (i < 0) return null
  const j = dir === 'left' ? i - 1 : i + 1
  return (j < 0 || j >= H.length) ? null : H[j]
}

// Anchor → next anchor for a direction. Returns null when the move isn't available.
// `ghostCenterY` seeds where UP/DOWN drop the ghost when entering a column.
function nudgeAnchor(anchor, dir, columns, ghostFamily, ghostCenterY) {
  if (anchor.kind === 'stack') {
    const idx = columns.findIndex(c => c.key === anchor.colKey)
    if (idx < 0) return null
    // UP/DOWN walk the half-slots WITHIN this column — never jump to another column.
    if (dir === 'up' || dir === 'down') {
      const slot = (anchor.slot | 0) + (dir === 'down' ? 1 : -1)
      if (slot < 0 || slot >= slotCount(columns[idx])) return null
      return { kind: 'stack', colKey: anchor.colKey, slot }
    }
    // LEFT/RIGHT: a chart-stack pops out to an own column beside the chart; a
    // panel-stack (rail merge) walks the horizontal sequence.
    if (columns[idx].family === 'chart') return { kind: 'col', gap: dir === 'left' ? idx : idx + 1 }
    return hStep(columns, ghostFamily, anchor, dir)
  }
  // Own column at a gap: LEFT/RIGHT walk the sequence; UP/DOWN stack into the adjacent
  // column (the rail beside it, or the chart once the ghost has stepped over it).
  if (dir === 'left' || dir === 'right') return hStep(columns, ghostFamily, anchor, dir)
  const target = nearestCol(columns, anchor.gap, ghostFamily)
  if (!target) return null
  return { kind: 'stack', colKey: target.key, slot: slotNearestY(target, ghostCenterY, dir) }
}

// Lay the ghost out as its own full-height column at `gap`. The widest chart column
// (the flex column) gives up `gw` width; columns re-tile left→right with no gaps, so
// the chart shrinks/shifts while rails keep their width. Returns { place, mutations }.
function resolveOwnColumn(columns, gap, ghostType, cols, rows) {
  const d = defOf(ghostType)
  const isChart = familyOf(ghostType) === 'chart'
  const chartCols = columns.filter(c => c.family === 'chart')
  const pool = chartCols.length ? chartCols : columns
  const flex = pool.reduce((a, b) => (!a || b.w > a.w ? b : a), null)
  if (!flex) return null
  const flexMinW = Math.min(...flex.members.map(m => defOf(m.type).minW || 2))

  let gw
  if (isChart) gw = Math.max(d.minW || 2, Math.floor(flex.w / 2))
  else {
    const rail = columns.find(c => c.family === 'panel' && c.key !== flex.key)
    gw = rail ? rail.w : (d.minW || 2)
  }
  gw = Math.min(gw, flex.w - flexMinW)
  if (gw < 1 || flex.w - gw < flexMinW) return null

  const slots = columns.map(c => ({ col: c, w: c.key === flex.key ? c.w - gw : c.w }))
  slots.splice(gap, 0, { ghost: true, w: gw })

  let x = Math.max(0, columns.length ? Math.min(...columns.map(c => c.x)) : 0)
  let ghostPlace = null
  const mutations = []
  for (const s of slots) {
    if (s.ghost) { ghostPlace = { x, y: 0, w: s.w, h: rows }; x += s.w; continue }
    const c = s.col
    const dx = x - c.x
    const dw = s.w - c.w
    for (const m of c.members) {
      const mMinW = defOf(m.type).minW || 2
      const nx = (m.x | 0) + dx
      const nw = Math.max(mMinW, Math.min((m.w | 0) + dw, s.w))
      const patch = { id: m.id }
      if (nx !== (m.x | 0)) patch.x = nx
      if (nw !== (m.w | 0)) patch.w = nw
      if (patch.x != null || patch.w != null) mutations.push(patch)
    }
    x += s.w
  }
  if (!ghostPlace) return null
  return { place: clampPlace(ghostPlace, d, cols, rows), mutations }
}

// Stack the ghost into column `colKey` at half-slot `slot` by splitting the member at
// that boundary: even slot = above member[slot/2] (member shifts down), odd slot =
// below member[(slot-1)/2] (member stays, ghost takes its bottom half).
function resolveStack(columns, colKey, slot, ghostType, cols, rows) {
  const d = defOf(ghostType)
  const c = columns.find(col => col.key === colKey)
  if (!c) return null
  if ((d.minW || 2) > c.w) return null                 // a chart won't cram into a narrow rail
  const members = colMembers(c)
  if (!members.length) return null
  const si = Math.max(0, Math.min(slot | 0, members.length * 2 - 1))
  const target = members[Math.floor(si / 2)]
  const above = si % 2 === 0
  const tMinH = defOf(target.type).minH || 3
  const dMinH = d.minH || 3
  let gh = Math.floor((target.h | 0) / 2)
  gh = Math.max(dMinH, Math.min(gh, (target.h | 0) - tMinH))
  const shrunk = (target.h | 0) - gh
  if (gh < dMinH || shrunk < tMinH) return null
  let place, mut
  if (above) {
    place = { x: target.x, y: target.y, w: target.w, h: gh }
    mut = { id: target.id, y: (target.y | 0) + gh, h: shrunk }
  } else {
    place = { x: target.x, y: (target.y | 0) + shrunk, w: target.w, h: gh }
    mut = { id: target.id, h: shrunk }
  }
  return { place: clampPlace(place, d, cols, rows), mutations: [mut] }
}

// dir ∈ 'up' | 'down' | 'left' | 'right'. `cur` = the current pendingAdd
// { type, place, mutations, anchor? }. Returns { place, mutations, anchor } for the
// moved ghost, or null when the move isn't possible (→ that arrow is hidden).
export function nudgePlan(widgets, cur, dir, cols = 24, rows = 20) {
  const orig = (widgets || []).filter(
    w => w && Number.isFinite(w.x) && Number.isFinite(w.y) && Number.isFinite(w.w) && Number.isFinite(w.h)
  )
  if (!cur?.place || !cur.type) return null
  const columns = buildColumns(orig, cols, rows)
  if (!columns.length) return null

  const anchor = cur.anchor || deriveAnchor(cur.place, columns, cur.mutations)
  const ghostCenterY = (cur.place.y | 0) + (cur.place.h | 0) / 2
  const next = nudgeAnchor(anchor, dir, columns, familyOf(cur.type), ghostCenterY)
  if (!next) return null

  const resolved = next.kind === 'stack'
    ? resolveStack(columns, next.colKey, next.slot, cur.type, cols, rows)
    : resolveOwnColumn(columns, next.gap, cur.type, cols, rows)
  if (!resolved) return null

  // Don't offer a move that lands the ghost exactly where it already sits.
  const g = cur.place
  const p = resolved.place
  if (p.x === g.x && p.y === g.y && p.w === g.w && p.h === g.h) return null
  return { place: p, mutations: resolved.mutations, anchor: next }
}
