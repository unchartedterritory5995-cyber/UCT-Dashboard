/**
 * V2-2 · W2-1 — one panel per unit family. The whole of A-05.
 *
 * ⛔⛔ THE DEFECT. V1 resolves at most TWO y-axes and folds everything else onto one of
 * them (`chartMetrics.resolveAxes` returns `axisByKey` over {0, 1}), so a selection
 * spanning three families draws two unrelated scales in one frame and a third squeezed
 * onto one of those. The audit measured what that produces: *"Volume Thrust's parity
 * (ratio 1.0) sits exactly on Net Advancers −500 and the lines 'cross' wherever the axes
 * happen to align"* (`01-audit.md:70-76`). The crossing is an artefact of axis
 * alignment. A reader cannot tell it from a real one, which is why `dataviz` calls a
 * dual-axis chart the #1 charting mistake and why the fix is a different chart rather
 * than a tweak to this one.
 *
 * ⭐ THE SPLIT IS DERIVED FROM THE REGISTRY, NEVER TYPED. `unitOf(key)` already owns
 * "what is this measured in", so a metric added tomorrow lands in the right panel on the
 * day it lands. A hand-typed family list here would be a second authority over one
 * value — the defect this file's own programme has now found four times.
 *
 * ⛔ ORDER IS STABLE AND DOES NOT DEPEND ON THE SELECTION'S ORDER. Panels are emitted in
 * `PANEL_ORDER`, a fixed sequence, so re-picking the same metrics in a different order
 * cannot reshuffle the stack under the reader. (Same disease as the colour one, one
 * level up — see `stickyColours.js`.)
 *
 * This module is PURE: no React, no ECharts. The chart consumes it, and the rails can
 * exercise every branch without rendering anything.
 */
import { UNIT, UNIT_LABEL, unitOf, scaleForUnit } from '../chartMetrics'

/**
 * The order families stack in, top to bottom.
 *
 * ⭐ Bounded percentages lead because they are the ones a reader anchors on (0–100 needs
 * no explanation), then counts, then the unitless and the price-like. ⛔ Any family NOT
 * named here still gets a panel — appended in registry order — so an unlisted unit can
 * never be silently dropped. A metric that vanishes because nobody listed its unit is
 * the "projection drops what it does not name" defect, and it looks like a flat line.
 */
export const PANEL_ORDER = [
  UNIT.PCT, UNIT.COUNT, UNIT.OSC, UNIT.RATIO, UNIT.SPREAD, UNIT.CUM,
  UNIT.VIX, UNIT.INDEX,
]

/** Panel height weights. Count/percent panels carry the reading; price-like are context. */
const WEIGHT = { [UNIT.PCT]: 1.25, [UNIT.COUNT]: 1, [UNIT.INDEX]: 0.8, [UNIT.VIX]: 0.8 }

/**
 * Split a selection into panels.
 *
 * @returns [{ unit, label, keys, scaled, weight }] — stable order, no empty panels.
 */
export function panelsFor(selected) {
  const keys = (selected ?? []).filter(Boolean)
  const byUnit = new Map()
  for (const key of keys) {
    const u = unitOf(key)
    if (!byUnit.has(u)) byUnit.set(u, [])
    byUnit.get(u).push(key)
  }
  // Listed families first in their fixed order, then anything unlisted in the order it
  // was encountered — so a new unit appears rather than disappearing.
  const ordered = [
    ...PANEL_ORDER.filter(u => byUnit.has(u)),
    ...[...byUnit.keys()].filter(u => !PANEL_ORDER.includes(u)),
  ]
  return ordered.map(unit => ({
    unit,
    label: UNIT_LABEL[unit] ?? unit,
    keys: byUnit.get(unit),
    // Framed vs anchored at zero: an index or a VIX level framed at 0 is unreadable.
    scaled: scaleForUnit(unit),
    weight: WEIGHT[unit] ?? 1,
  }))
}

/**
 * ECharts `grid` rectangles for a stack of panels, in percent of the chart box.
 *
 * ⛔ THE GAP IS NOT DECORATION. Adjacent fills need a visible surface gap or two panels
 * read as one continuous plot — and two families reading as one plot is the very
 * confusion A-05 is about, reintroduced by layout after being fixed by structure.
 *
 * @param panels  from `panelsFor`
 * @param opts    { top, bottom, gap } in percent
 */
export function gridFor(panels, { top = 6, bottom = 14, gap = 4 } = {}) {
  const n = panels.length
  if (!n) return []
  const totalWeight = panels.reduce((s, p) => s + p.weight, 0)
  const usable = 100 - top - bottom - gap * (n - 1)
  let y = top
  return panels.map(p => {
    const h = (usable * p.weight) / totalWeight
    const rect = { top: `${round(y)}%`, height: `${round(h)}%`, left: 56, right: 72 }
    y += h + gap
    return rect
  })
}

const round = v => Math.round(v * 100) / 100

/**
 * Which panel index a metric draws in, for a given split.
 *
 * ⭐ Returned as a lookup so the chart never re-derives it — one computation, one answer.
 * A series whose key is not in the selection returns `-1` rather than `0`: silently
 * defaulting to the first panel would draw a ratio on the percentage axis, which is the
 * bug in a new costume.
 */
export function panelIndexByKey(panels) {
  const out = {}
  panels.forEach((p, i) => { for (const k of p.keys) out[k] = i })
  return { indexOf: key => (key in out ? out[key] : -1), map: out }
}
