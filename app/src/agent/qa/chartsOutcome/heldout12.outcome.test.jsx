// CHARTS OUTCOME — the 12 rows that were named ONLY by held-out routing phrasings (agentExecHeldOut*.test.js, which execute
// nothing): C1-065, C1-066 (a chart's list settings, chart.setSetting header.barInfo | header.fields) and C3-125, C3-133,
// C3-151, C3-159, C3-164, C3-165, C3-166, C3-194, C3-195, C3-206 (one control of one widget, widget.setOption). Same standard
// as chartSettings / widgetControls / widgetDoorRows: the REAL Agent panel (outcomeHarness: AgentPanel + useAgent + registry,
// policy, runtime, receipts, Undo) over one fixture board that holds a chart AND every widget type these rows name. Each case
// says the member's words (the held-out phrasing, and a tune phrasing only where a filter has no held-out one), the plan a
// correct planner sends FROM THAT REQUEST (the widget id is read off body.context.board, the chart off its `selected` flag, and
// the key must be in the request's own widgetControls section), and the end state, read back from the board's stored opts /
// the chart blob through the product's own resolver (headerFieldKeys, barInfoFieldsOf over mergeChartSettings). Never from
// the plan or a receipt alone. Then: every OTHER widget and the chart are byte-identical, and Undo restores the exact opts.
//
// A case also FAILS if the scripted plan was never consulted (the envelope must be consumed: a pre-model fast path that
// answered on its own would leave it queued), the same check as multiChart.outcome.test.jsx.
//
// The widgets are NOT mounted here: the read-back is the opts each widget reads (NewsWidget.jsx:178 filter,
// CalendarWidget.jsx:317 econStars, BreadthWidget.jsx:449 view, OptionsFlowWidget.jsx:145-149 lead/scope/filters,
// VolumeScanWidget.jsx:151 showLogos, ScatterWidget.jsx:272/:300 followList/labelMode, PeriodSortWidget.jsx:37 group);
// that the mounted widget reads each key is agent/settingsLiveness.test.js's job, not this file's.
//
// ⛔ THE MODEL IS SCRIPTED. Evidence: LOCAL native Windows Node, vitest, jsdom/panel, SIMULATED — not a real browser, no paid
// model, no backend. Rows with no capability path are it.todo with the missing piece (docs/agent/program/EXEC-HELDOUT12.md).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { open, outcomeSuite, afterEachOutcome, chart, must, selectedChart, boardRef, waitFor, proposalsNow } from './outcomeHarness'
import { bareSettings } from '../../testing/panelHarness'
import { mergeChartSettings } from '../../../components/chart/chartDefaults'
import { headerFieldKeys } from '../../../components/chart/headerFields'
import { barInfoFieldsOf } from '../../../components/chart/barInfoFields'
import { FLOW_WIDGET_REFUSAL } from '../../useAgent'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await outcomeSuite()
afterEach(() => afterEachOutcome())

// ── the board: one chart (selected) and one widget of every type the rows name ──
const wgt = (id, type, x, y, opts = {}) => ({ id, type, x, y, w: 6, h: 8, color: 'N', opts })
const board = (seed = {}) => [
  chart('c1', 0, 0, 12, 16, { opts: { settings: { ...bareSettings(), ...(seed.c1 || {}) } } }),
  wgt('vs', 'volumescan', 12, 0, seed.vs), wgt('nw', 'news', 18, 0, seed.nw),
  wgt('ca', 'calendar', 12, 8, seed.ca), wgt('br', 'breadth', 18, 8, seed.br),
  wgt('of', 'optionsflow', 0, 16, seed.of), wgt('sc', 'scatter', 6, 16, seed.sc),
  wgt('ps', 'periodsort', 12, 16, { start: 20260105, end: 20260227, ...(seed.ps || {}) }),
]
const SYMS = { 'N:c1': 'NVDA' }
const on = (m, id) => m.board.state.widgets.find(w => w.id === id)
const othersThan = (m, id) => JSON.stringify(m.board.state.widgets.filter(w => w.id !== id))
const at = (opts, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), opts)

/** The plan a correct planner sends from THIS request: the widget of `type` on the board entry, a key the request's own
 *  widgetControls section offers for that type. Throws (failing the case) when the request does not carry either. */
const setOptionPlan = (type, key, value) => (c) => {
  const id = must((c.board?.[0]?.widgets || []).find(w => w.type === type), `a ${type} widget`).id
  const offered = c.widgetControls?.[0]?.controls?.[type]
  must(typeof offered === 'string' && offered.split(', ').some(x => x.startsWith(`${key}(`)), `widgetControls.${type} offering ${key}`)
  return [{ action: 'widget.setOption', target: boardRef(c), args: { widget: id, key, value } }]
}

// row, request, widget id + type, key/value the plan sends, the opts path the widget reads, the value it must hold, seed
const W = [
  { row: 'C3-125', text: 'show logos in the volume surge', id: 'vs', type: 'volumescan', key: 'showLogos', value: true, path: 'showLogos', want: true },
  { row: 'C3-125', text: 'volume-surge logos on', id: 'vs', type: 'volumescan', key: 'showLogos', value: true, path: 'showLogos', want: true },
  { row: 'C3-133', text: 'news widget: only bullish catalysts', id: 'nw', type: 'news', key: 'filter', value: 'up', path: 'filter', want: 'up' },
  { row: 'C3-151', text: 'show only 3 star economic events', id: 'ca', type: 'calendar', key: 'econStars', value: 3, path: 'econStars', want: 3, seed: { ca: { econStars: 1 } }, gap: 'routed' },
  { row: 'C3-151', text: 'calendar widget: only 3 star economic events', id: 'ca', type: 'calendar', key: 'econStars', value: 3, path: 'econStars', want: 3, seed: { ca: { econStars: 1 } }, gap: 'routed' },
  // a phrasing that names the widget AND a change ('change … filter') routes the board-edit group: the capability itself works
  { row: 'C3-151', text: 'change the calendar widget filter to 3 stars', id: 'ca', type: 'calendar', key: 'econStars', value: 3, path: 'econStars', want: 3, seed: { ca: { econStars: 1 } }, tune: true },
  { row: 'C3-159', text: 'show the ratio view on breadth', id: 'br', type: 'breadth', key: 'view', value: 'ratio', path: 'view', want: 'ratio' },
  { row: 'C3-159', text: 'switch the breadth widget back to the heatmap', id: 'br', type: 'breadth', key: 'view', value: 'heatmap', path: 'view', want: 'heatmap', seed: { br: { view: 'ratio' } } },
  { row: 'C3-164', text: 'switch options flow to just this symbol', id: 'of', type: 'optionsflow', key: 'scope', value: 'symbol', path: 'scope', want: 'symbol' },
  { row: 'C3-164', text: 'put the options flow back on the whole market', id: 'of', type: 'optionsflow', key: 'scope', value: 'market', path: 'scope', want: 'market', seed: { of: { scope: 'symbol', symbol: 'NVDA' } } },
  { row: 'C3-165', text: 'lead with the biggest trades in options flow', id: 'of', type: 'optionsflow', key: 'lead', value: 'biggest', path: 'lead', want: 'biggest' },
  { row: 'C3-166', text: 'only show sweeps in the options flow', id: 'of', type: 'optionsflow', key: 'printType', value: 'SWEEP', path: 'filters.type', want: 'SWEEP', gap: 'refused' },
  { row: 'C3-166', text: 'options flow: sweeps only', id: 'of', type: 'optionsflow', key: 'printType', value: 'SWEEP', path: 'filters.type', want: 'SWEEP' },
  { row: 'C3-166', text: 'options flow: puts only', id: 'of', type: 'optionsflow', key: 'callPut', value: 'P', path: 'filters.cp', want: 'P' },
  { row: 'C3-166', text: 'options-flow: calls only', id: 'of', type: 'optionsflow', key: 'callPut', value: 'C', path: 'filters.cp', want: 'C' },
  // premium and direction have no held-out phrasing; these two are agentExecTune.js's (labelled TUNE in the doc)
  { row: 'C3-166', text: 'options flow minimum premium 1 million', id: 'of', type: 'optionsflow', key: 'minPremium', value: 1000000, path: 'filters.minPrem', want: 1000000, tune: true },
  { row: 'C3-166', text: 'show only bearish flow', id: 'of', type: 'optionsflow', key: 'direction', value: 'BEAR', path: 'filters.dir', want: 'BEAR', tune: true },
  { row: 'C3-194', text: 'have the market map follow my watchlist', id: 'sc', type: 'scatter', key: 'followList', value: true, path: 'followList', want: true },
  { row: 'C3-195', text: 'turn off labels on the market map', id: 'sc', type: 'scatter', key: 'labelMode', value: 'off', path: 'labelMode', want: 'off' },
  { row: 'C3-195', text: 'set the market-map labels off', id: 'sc', type: 'scatter', key: 'labelMode', value: 'off', path: 'labelMode', want: 'off' },
  { row: 'C3-195', text: 'label every dot on the market map', id: 'sc', type: 'scatter', key: 'labelMode', value: 'all', path: 'labelMode', want: 'all' },
  { row: 'C3-206', text: 'group period sort by industry', id: 'ps', type: 'periodsort', key: 'group', value: 'industry', path: 'group', want: 'industry' },
]

// ── KNOWN GAPS (measured 2026-11-10 on master 5fed0561f1): the outcome is it.fails, and a plain it pins today's exact wrong output ──
// 'routed': the request reaches the model WITHOUT the board-edit group — no widgetControls section, no widget.setOption, only
//   calendar.day (the economic-calendar words route the calendar read, never the widget control) — so no correct plan exists.
// 'refused': the screener fast path reads "sweeps" as an options-flow SCREEN filter and, because the message names the Options
//   Flow widget, answers FLOW_WIDGET_REFUSAL (useAgent.js:2299-2305) before the model — although widget.setOption printType now
//   sets that very chip ("options flow: sweeps only" does).
async function runGapNow(r) {
  const m = open(board(r.seed), SYMS, { selected: 'c1' })
  const all = JSON.stringify(m.board.state.widgets)
  let seen = null
  const turns0 = m.p.turns()
  const out = await m.say(r.text, (c, body) => { seen = { offered: c.widgetControls?.[0]?.controls?.[r.type] ?? null, caps: (body.capabilities || []).map(x => x.name) }; return [] })
  if (r.gap === 'routed') {
    expect(seen, 'the request reached the (scripted) model').not.toBe(null)
    expect(seen.offered, 'no widgetControls section for the widget').toBe(null)
    expect(seen.caps.includes('widget.setOption'), 'widget.setOption not offered').toBe(false)
    expect(seen.caps.includes('calendar.day'), 'the calendar read is').toBe(true)
  } else {
    expect(m.p.turns() - turns0, 'answered before the model').toBe(0)
    expect(out).toContain(FLOW_WIDGET_REFUSAL)
  }
  expect(JSON.stringify(m.board.state.widgets), 'nothing on the board changed').toBe(all)
}

async function runWidget(r) {
  const m = open(board(r.seed), SYMS, { selected: 'c1' })
  const blob = JSON.stringify(on(m, r.id).opts), rest = othersThan(m, r.id)
  expect(at(on(m, r.id).opts, r.path), `${r.row}: the seed does not already hold ${r.path}=${r.want}`).not.toEqual(r.want)
  const out = await m.say(r.text, setOptionPlan(r.type, r.key, r.value))
  // the scripted model was asked and its plan consumed (a pre-model shortcut would leave it queued)
  expect(m.p.st.envelopes, `"${r.text}" reached the (scripted) model`).toEqual([])
  if (proposalsNow().length) await m.apply()
  await waitFor(() => expect(at(on(m, r.id).opts, r.path), `${r.row} ${r.path} — ${out}`).toEqual(r.want))
  expect(othersThan(m, r.id), `${r.row}: the chart and every other widget are untouched`).toBe(rest)
  await m.say('undo')
  await waitFor(() => expect(JSON.stringify(on(m, r.id).opts), `${r.row}: Undo restores the widget`).toBe(blob))
  expect(othersThan(m, r.id)).toBe(rest)
}

// ── Family L: the selected chart's list settings, read back through the product's own readers ──
const fieldsOf = (m) => headerFieldKeys(mergeChartSettings(on(m, 'c1').opts.settings || null).header)
const barInfoOf = (m) => barInfoFieldsOf(mergeChartSettings(on(m, 'c1').opts.settings || null))
const L = [
  { row: 'C1-066', text: 'put the dollar volume in the info row', setting: 'header.fields', value: '+dolvol', read: fieldsOf, member: 'dolvol', present: true },
  { row: 'C1-066', text: 'take market cap off the header stats', setting: 'header.fields', value: '-mcap', read: fieldsOf, member: 'mcap', present: false },
  { row: 'C1-066', text: 'remove the UCT rating from the info row', setting: 'header.fields', value: '-rating', read: fieldsOf, member: 'rating', present: false },
  { row: 'C1-066', text: 'info row: add 30 day change', setting: 'header.fields', value: '+perf30d', read: fieldsOf, member: 'perf30d', present: true },
  { row: 'C1-066', text: 'add RVOL to the stat strip above the chart', setting: 'header.fields', value: '+rvol', read: fieldsOf, member: 'rvol', present: true },
  { row: 'C1-065', text: "I don't need the open price in the bar readout", setting: 'header.barInfo', value: '-open', read: barInfoOf, member: 'open', present: false },
  { row: 'C1-065', text: 'show the percent change in the OHLC strip', setting: 'header.barInfo', value: '+changePct', read: barInfoOf, member: 'changePct', present: true,
    seed: { c1: { header: { ...bareSettings().header, barInfo: ['date', 'open', 'high', 'low', 'close'] } } } },
  { row: 'C1-065', text: 'drop the date from the bar info', setting: 'header.barInfo', value: '-date', read: barInfoOf, member: 'date', present: false },
]

async function runList(r) {
  const m = open(board(r.seed), SYMS, { selected: 'c1' })
  const blob = JSON.stringify(on(m, 'c1').opts), rest = othersThan(m, 'c1')
  const before = r.read(m)
  expect(before.includes(r.member), `${r.row}: the seed does not already ${r.present ? 'show' : 'hide'} ${r.member}`).toBe(!r.present)
  const out = await m.say(r.text, (c) => [{ action: 'chart.setSetting', target: selectedChart(c).ref, args: { setting: r.setting, value: r.value } }])
  expect(m.p.st.envelopes, `"${r.text}" reached the (scripted) model`).toEqual([])
  if (proposalsNow().length) await m.apply()
  await waitFor(() => expect(r.read(m).includes(r.member), `${r.row} ${r.setting} ${r.value} — ${out}`).toBe(r.present))
  // only that member moved: the rest of the list is as it was, in the product's order
  expect(r.read(m).filter(k => k !== r.member), `${r.row}: the other fields stay`).toEqual(before.filter(k => k !== r.member))
  expect(othersThan(m, 'c1'), `${r.row}: every widget is untouched`).toBe(rest)
  await m.say('undo')
  await waitFor(() => expect(JSON.stringify(on(m, 'c1').opts), `${r.row}: Undo restores the chart`).toBe(blob))
  expect(othersThan(m, 'c1')).toBe(rest)
}

describe('held-out-only rows, executed through the real panel (widget.setOption over the board)', () => {
  for (const r of W) {
    const name = `${r.row} "${r.text}"${r.tune ? ' (tune phrasing)' : ''}: ${r.id}.opts.${r.path} = ${r.want}; the chart and the other widgets keep theirs; Undo restores it`
    if (!r.gap) { it(name, () => runWidget(r), 40000); continue }
    it.fails(`KNOWN GAP (${r.gap}): ${name}`, () => runWidget(r), 40000)
    it(`KNOWN GAP pinned (${r.gap}): ${r.row} "${r.text}" — ${r.gap === 'routed' ? 'the request carries no widget.setOption / widgetControls.' + r.type + ', only calendar.day' : 'refused before the model with FLOW_WIDGET_REFUSAL'}; nothing changes`, () => runGapNow(r), 40000)
  }
  // ── GAPS: the half of a row with no capability path (the missing piece is the todo's text) ──
  it.todo('C3-195 (zoom half) market map zoom in / out / reset — GAP: ScatterWidget.jsx:463 zoom and :476 resetZoom dispatch an echarts dataZoom on the instance; nothing is in opts and the widget has no door for it (pages/charts/widgetDoors.js), so widget.setOption has no row (widgets/widgetControls.js:51-59 scatter)')
  it.todo('C3-206 (start-mark half) period sort "mark the start date" (line / candle) — GAP: PeriodSortConfig.jsx:18 markStart is the dialog\'s local state, handed to ChartsWorkspace.jsx:4164-4174 onSort → setStartMarker / setStartMarkerStyle (:1230-1231); no capability writes startMarker')
  it.todo('C3-206 (replay half) period sort "replay to the end date" — GAP as this row\'s control: PeriodSortConfig.jsx:17 replay is dialog state → ChartsWorkspace.jsx:4169 setReplayCutoff; no period-sort capability. The same cutoff is chart.replay (capabilities/chart.js:925) when the member names the date; that is the Replay row, not tested here')
  it.todo('C3-206 (grouping back to stocks) "ungroup period sort" — GAP: registry periodsort.group options are theme|sector|industry only (widgets/registry.js:755); the dialog\'s "US Common Stocks" (PeriodSortConfig.jsx:38, group null) has no value widget.setOption accepts')
})

describe('held-out-only rows, executed through the real panel (chart.setSetting list settings on the selected chart)', () => {
  for (const r of L) {
    it(`${r.row} "${r.text}": ${r.setting} ${r.present ? 'shows' : 'no longer shows'} ${r.member}, the other fields stay; the widgets keep theirs; Undo restores it`, () => runList(r), 40000)
  }
})
