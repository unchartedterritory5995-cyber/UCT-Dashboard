// ── THE CHARTS ONE CHANGE LANDS ON ─────────────────────────────────────────────────────────────────────────────────────
// A target snapshot names ONE chart (deixis.chartRefOf: a chart's own ref, or a chart-backed entry's `chartRef`). Some changes
// reach further than that chart, exactly as the member's own clicks do:
//   • a drawing lives on its SYMBOL (drawingsStore keys by drawSym), so a drawing change shows on EVERY chart of that symbol —
//     the target kind says so (`kind.sharedBy(snap, charts)`, capabilities/drawings.js);
//   • a symbol change on a color-LINKED chart retargets every chart in its link group (ChartWidget.handleSymbolChange; the
//     chart.setSymbol summary: "Widgets linked to the same color group follow") — the actions below.
// The excluded-chart gate (spatialCheck.withoutExcludedCharts) reads this, so a chart the words exclude is never changed through
// a chart it shares drawings or a link group with. Pure; never throws (an unreadable snapshot lands on its own chart only).
import { chartRefOf } from './deixis'

/** Actions whose change FOLLOWS the target chart's color link group onto every chart in it. (A rail —
 *  agentExcludedSharedLanding.test.js — fails when a chart capability says linked widgets follow and is not listed here.) */
export const LINK_FOLLOWING = new Set(['chart.setSymbol'])

/** A chart's link group key, or null when it is unlinked ('N' / 'N:<id>', as host.buildChartSource and the fixture board use). */
export const linkGroupOf = (c) => (typeof c?.group === 'string' && c.group && !c.group.startsWith('N') ? c.group : null)

/**
 * → Set of chart refs the op lands on: the snapshot's own chart, every chart the target kind says shares the object, and — for a
 * link-following action — every chart in the same link group as those.
 */
export function chartsLandedOn(cap, kind, snap, charts = []) {
  const out = new Set()
  const own = chartRefOf(kind, snap)
  if (own) out.add(own)
  try {
    if (typeof kind?.sharedBy === 'function') for (const r of kind.sharedBy(snap, charts) || []) if (r) out.add(r)
    if (cap?.name && LINK_FOLLOWING.has(cap.name)) {
      const groups = new Set(charts.filter(c => out.has(c?.ref)).map(linkGroupOf).filter(Boolean))
      if (groups.size) for (const c of charts) if (groups.has(linkGroupOf(c))) out.add(c.ref)
    }
  } catch { /* the snapshot's own chart only */ }
  return out
}
