// ── CHART FEATURES: the Company Info panel and the Earnings Strip (Charts execution family, 2026-11-12) ─────────────────
//
// A chart widget's two host features (pages/charts/widgets/chartFeatures.js), through the SAME pure dock transforms a
// member's clicks run — never a hand-built dock:
//
//   chartFeatures.companyPanel  Company Info (the side panel: Overview · Financials · Earnings · Ownership · News).
//                               open     = Indicators → Add to Chart's add (addFeature: added, expanded, default width), or
//                                          the edge rail's expand (setFeatureOpen true) when it is added but collapsed
//                               collapse = the header chevron (setFeatureOpen false): it STAYS on the chart as the edge rail
//                               remove   = Add to Chart's remove (removeFeature)
//                               tab      = the panel's own tab strip (ChartDetailDock setTab), normalised by normalizeDock —
//                                          a legacy "valuation" lands on Ownership, exactly as the product maps it. A tab
//                                          on a chart without the panel adds it first, in the SAME write (one Undo).
//   chartFeatures.earningsStrip the Earnings Strip under the chart (EARNINGS_STRIP: opts.dock.strip). "Fundamentals strip"
//                               means THIS: chartDock.DOCK_PANELS' 'fundamentals' (dock.bottom) is rendered by nothing,
//                               so it is never written here. It has no collapsed state: "collapse / close" is refused
//                               (never a silent remove).
//
// State is the widget's opts.dock (per WIDGET, shared by every chart tab): ONE onOptsChange per action through the
// ChartWidget adapter (chartKind.commit → host.charts.commit), read back exactly; Undo writes the RAW dock snapshot from
// before (a removed panel's own width, the strip's own height, its tab) — addFeature lands at the default width, so no
// transform inverse is exact. A Multi Chart cell / pop-out has no dock: "not available here", nothing is written.
// Targeting is the chart kind's (the clicked chart, deixis, a relation, every chart, "Which chart?"), never its own.

import { registerCapability } from '../capabilities'
import { COMPANY_TABS, normalizeDock } from '../../pages/charts/widgets/chartDock'
import { COMPANY_INFO, EARNINGS_STRIP, addFeature, removeFeature, setFeatureOpen } from '../../pages/charts/widgets/chartFeatures'

const onCharts = (ctx) => ctx.surface === 'charts'
const chartCommon = { target: 'chart', surfaces: ['charts'], available: onCharts }

export const COMPANY_PANEL_ACTION = 'chartFeatures.companyPanel'
export const EARNINGS_STRIP_ACTION = 'chartFeatures.earningsStrip'
const OPS = ['open', 'collapse', 'remove']
const TAB_ARGS = [...COMPANY_TABS.map(t => t.key), 'valuation']
const tabLabel = (key) => COMPANY_TABS.find(t => t.key === key)?.label || key
// the tab a word lands on, as the panel itself would show it (normalizeDock: valuation → ownership)
const tabOf = (raw) => normalizeDock({ tab: raw }).tab

export const NO_DOCK = 'The Company Info panel and the Earnings Strip aren’t available on that chart here — they belong to a chart on the Charts board (a Multi Chart cell or a pop-out chart has neither).'
const NO_PANEL_TO_COLLAPSE = 'This chart has no Company Info panel to collapse. Say “add the company panel” to add it.'
const REMOVE_WITH_TAB = 'Removing the Company Info panel leaves no tab to show. Remove it, or pick a tab to show?'
const STRIP_NO_COLLAPSE = 'The Earnings Strip has no collapsed state. Say “remove the earnings strip” to take it off this chart.'
const ASK_PANEL = 'Open, collapse or remove the Company Info panel — or which tab should it show?'
const VALUATION_NOTE = ' (Valuation is now the Ownership tab; valuation figures are in Overview)'
// the dock is per WIDGET: a change on one tab shows on every tab of that chart widget, and the receipt says so
const sharedNote = (st) => (st.dockTabs > 1 ? ` — shared by all ${st.dockTabs} tabs of this chart widget` : '')

/** The Company Info dock after `op` / `tab`, through the product's own transforms (the SAME object when nothing changes). */
export function companyPanelDock(dock, { op, tab } = {}) {
  let d = dock
  const want = op || (tab ? 'open' : null)
  if (want === 'open') d = d.company ? setFeatureOpen(d, COMPANY_INFO, true) : addFeature(d, COMPANY_INFO)
  else if (want === 'collapse') d = setFeatureOpen(d, COMPANY_INFO, false)
  else if (want === 'remove') d = removeFeature(d, COMPANY_INFO)
  if (tab && want !== 'remove') {
    const key = tabOf(tab)
    if (normalizeDock(d).tab !== key) d = normalizeDock({ ...d, tab: key })   // ChartDetailDock setTab, normalised
  }
  return d
}

/** The Earnings Strip dock after `op` (addFeature / removeFeature on EARNINGS_STRIP — never dock.bottom). */
export function earningsStripDock(dock, op) {
  if (op === 'open') return addFeature(dock, EARNINGS_STRIP)
  if (op === 'remove') return removeFeature(dock, EARNINGS_STRIP)
  return dock
}

function describeCompany(b, a, args) {
  const B = b.dock, A = a.dock
  if (!B || !A || B === A) return null
  const note = (args?.tab === 'valuation' ? VALUATION_NOTE : '') + sharedNote(a)
  if (B.company && !A.company) return `Removed the Company Info panel from this chart${sharedNote(a)}`
  if (!A.company) return null
  if (!B.company) return `Added the Company Info panel, open on ${tabLabel(A.tab)}${note}`
  const opened = !B.open && A.open, collapsed = B.open && !A.open, tabbed = B.tab !== A.tab
  if (opened) return `Expanded the Company Info panel${tabbed ? ` on ${tabLabel(A.tab)}` : ''}${note}`
  if (collapsed) return `Collapsed the Company Info panel to its edge rail (it stays on the chart${tabbed ? `, on ${tabLabel(A.tab)}` : ''})${note}`
  if (tabbed) return `Switched the Company Info panel to ${tabLabel(A.tab)}${note}`
  return null
}

let registered = false
export function registerChartFeatureCapabilities() {
  if (registered) return
  registered = true

  registerCapability({
    ...chartCommon,
    name: COMPANY_PANEL_ACTION,
    summary: 'ONE chart\'s Company Info panel (side panel: Overview, Financials, Earnings, Ownership, News): add/expand it, collapse it to its edge rail (it stays), remove it, or show a tab — as Add to Chart, its chevron and its tabs do. Undo restores it exactly.',
    hints: 'target = the chart. op: open (add, or expand a collapsed one) | collapse (hide / minimise / bare "close" — it stays on the chart) | remove (only for remove / take off / get rid of). tab = overview | financials | earnings | ownership | news: pass it HERE, also with op open ("add the company panel on News" = one call); a tab alone opens the panel. Company/profile/info panel = this. The strip under the chart (earnings or "fundamentals" strip) = chartFeatures.earningsStrip.',
    args: { type: 'object', properties: { op: { type: ['string', 'null'], enum: [...OPS, null] }, tab: { type: ['string', 'null'], enum: [...TAB_ARGS, null] } }, required: ['op', 'tab'], additionalProperties: false },
    check(st, { op, tab } = {}) {
      if (!st.canDock || !st.dock) return NO_DOCK
      if (!op && !tab) return ASK_PANEL
      if (op && !OPS.includes(op)) return ASK_PANEL
      if (tab && !TAB_ARGS.includes(tab)) return `The Company Info panel's tabs are ${COMPANY_TABS.map(t => t.label).join(', ')}.`
      if (op === 'remove' && tab) return REMOVE_WITH_TAB
      if (op === 'collapse' && !st.dock.company) return NO_PANEL_TO_COLLAPSE
      return null
    },
    apply(st, args = {}) {
      const dock = companyPanelDock(st.dock, args)
      return dock === st.dock ? st : { ...st, dock }
    },
    describe: describeCompany,
    noop: (st, _a, { op, tab } = {}) => {
      if (op === 'remove') return 'This chart has no Company Info panel, so there is nothing to remove'
      if (op === 'collapse') return 'The Company Info panel is already collapsed to its edge rail'
      return `The Company Info panel is already open${tab ? ` on ${tabLabel(tabOf(tab))}` : ''} on this chart`
    },
  })

  registerCapability({
    ...chartCommon,
    name: EARNINGS_STRIP_ACTION,
    summary: 'Add or remove ONE chart\'s Earnings Strip (quarterly EPS and revenue in a strip under the chart; also called the fundamentals strip), as Add to Chart does. Undo restores it exactly (its height too).',
    hints: 'target = the chart. op: open (add / show) | remove (only for remove / take off / get rid of) | collapse (hide / minimise / bare "close": it has no collapsed state, so this asks). The side panel is chartFeatures.companyPanel.',
    args: { type: 'object', properties: { op: { type: 'string', enum: OPS } }, required: ['op'], additionalProperties: false },
    check(st, { op } = {}) {
      if (!st.canDock || !st.dock) return NO_DOCK
      if (op === 'collapse') return STRIP_NO_COLLAPSE
      if (op !== 'open' && op !== 'remove') return 'Add or remove the Earnings Strip?'
      return null
    },
    apply(st, { op } = {}) {
      const dock = earningsStripDock(st.dock, op)
      return dock === st.dock ? st : { ...st, dock }
    },
    describe: (b, a) => {
      if (!b.dock || !a.dock || !!b.dock.strip === !!a.dock.strip) return null
      return a.dock.strip ? `Added the Earnings Strip under this chart${sharedNote(a)}` : `Removed the Earnings Strip from this chart${sharedNote(a)}`
    },
    noop: (_st, _a, { op } = {}) => (op === 'remove' ? 'This chart has no Earnings Strip, so there is nothing to remove' : 'The Earnings Strip is already under this chart'),
  })
}
