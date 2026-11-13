// CHARTS OUTCOME — execution family CHART DISPLAY SETTINGS (pl-auto): the C1 Settings / Volume / Chart type / Themes rows that
// were IMPLEMENTED / UNVERIFIED, through the REAL Agent panel (outcomeHarness: AgentPanel + useAgent + registry, policy,
// runtime, receipts, Undo) over the fixture board's real chart writer. ONE table: each row says the request, the plan a correct
// planner sends from THAT request (the target is the chart the member selected, read off body.context), and the setting it must
// leave on the chart. Every assertion reads the chart's stored blob back through the product's own resolver (settingValue over
// mergeChartSettings — what Chart Settings shows), never the plan or a receipt alone. Then Undo, which must restore the exact
// blob, and the other three charts on the board, which must not move.
//
// Rows with no capability path are it.todo with the missing piece (see docs/agent/program/EXEC-CHART-SETTINGS.md).
// ⛔ THE MODEL IS SCRIPTED. Evidence: LOCAL native Windows Node, jsdom, BROWSER-MOCK-MODEL / SIMULATED — not a real browser.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { open, outcomeSuite, afterEachOutcome, chart, QUAD_SYMS, selectedChart, boardRef, waitFor, proposalsNow } from './outcomeHarness'
import { bareSettings } from '../../testing/panelHarness'
import { mergeChartSettings, CHART_DEFAULTS } from '../../../components/chart/chartDefaults'
import { settingDescriptor, settingValue } from '../../../components/chart/chartSettingsDescriptors'
import { CHART_THEMES, CHART_THEME_BY_ID, themeAllChartWidgets } from '../../../components/chart/chartThemes'
import { __setBreadthSymbolsForTest } from '../../../hooks/useBreadthSymbols'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await outcomeSuite()
afterEach(() => afterEachOutcome())

// ── the board: four charts, the member selected the top-right one (QQQ) ──
const TARGET = 'tr'
const board = ({ settings = {}, opts = {} } = {}) => [
  chart('tl', 0, 0, 12, 10), chart('tr', 12, 0, 12, 10, { opts: { settings: { ...bareSettings(), ...settings }, ...opts } }),
  chart('bl', 0, 10, 12, 10), chart('br', 12, 10, 12, 10),
]
const on = (m, id) => m.board.state.widgets.find(w => w.id === id)
const csOf = (m, id) => mergeChartSettings(on(m, id).opts.settings || null)
/** What Chart Settings shows for `id` on that chart: the product's resolver over the stored blob (a `store` row reads its own state). */
const read = (m, wid, id) => {
  const d = settingDescriptor(id)
  if (d?.store === 'watermarkPos') return on(m, wid).opts.watermarkPos?.[id.split('.')[1]] ?? settingValue(csOf(m, wid), d)
  return d ? settingValue(csOf(m, wid), d) : id.split('.').reduce((o, k) => o?.[k], csOf(m, wid))
}
const others = (m) => JSON.stringify(m.board.state.widgets.filter(w => w.id !== TARGET))
const set = (setting, value) => ({ action: 'chart.setSetting', args: { setting, value } })

// row, request, ops (on the SELECTED chart), expect [[setting id, value]], optional board seed
const ROWS = [
  { row: 'C1-016', text: 'switch this chart to heikin ashi candles', ops: [set('heikinAshi', true)], expect: [['heikinAshi', true]] },
  { row: 'C1-017', text: 'color the candles by open vs close', ops: [set('candleColorMode', 'openclose')], expect: [['candleColorMode', 'openclose']] },
  { row: 'C1-018', text: 'make the bars thicker on this chart', seed: { settings: { chartType: 'bars' } }, ops: [set('candles.thinBars', false)], expect: [['candles.thinBars', false]] },
  { row: 'C1-024', text: 'flip the price scale upside down', ops: [set('invertScale', true)], expect: [['invertScale', true]] },
  { row: 'C1-050', text: 'give this chart a gradient background with a navy top', ops: [set('bgMode', 'gradient'), set('bgGradient.top', '#1a2b4c')],
    expect: [['bgMode', 'gradient'], ['bgGradient.top', '#1a2b4c']] },
  { row: 'C1-051', text: 'only show the crosshair while I hold the mouse', ops: [set('crosshair.mode', 'hold')], expect: [['crosshair.mode', 'hold']] },
  { row: 'C1-052', text: 'make the crosshair red, 2px and dashed', ops: [set('crosshair.color', '#ff0000'), set('crosshair.width', 2), set('crosshair.style', 'dashed')],
    expect: [['crosshair.color', '#ff0000'], ['crosshair.width', 2], ['crosshair.style', 2]] },
  { row: 'C1-053', text: 'turn on the magnet crosshair', ops: [set('crosshair.magnet', true)], expect: [['crosshair.magnet', true]] },
  // C1-054: "…the price label ON THE AXIS…" never reaches the model: a pre-model resolver reads "axis" as a ticker and asks
  // which instrument it means (NL finding, reported to pl-exec; the capability itself passes with the phrasing below)
  { row: 'C1-054', text: 'hide the last price label and show the moving average labels', ops: [set('showPriceLabels', false), set('showMaLabels', true)],
    expect: [['showPriceLabels', false], ['showMaLabels', true]] },
  { row: 'C1-055', text: 'bump the scale text up to 14', ops: [set('textSize', 14)], expect: [['textSize', 14]] },
  { row: 'C1-056', text: 'hide the watermark on this chart', ops: [set('watermark.visible', false)], expect: [['watermark.visible', false]] },
  { row: 'C1-057', text: 'take the company name off the watermark and add the logo', ops: [set('watermark.lines.company', false), set('watermark.lines.logo', true)],
    expect: [['watermark.lines.company', false], ['watermark.lines.logo', true]] },
  { row: 'C1-059', text: 'make the watermark bigger, bold, blue and 30% opacity', ops: [set('watermark.sizeScale', 2), set('watermark.weight', 700), set('watermark.color', '#336699'), set('watermark.opacity', 0.3)],
    expect: [['watermark.sizeScale', 2], ['watermark.weight', 700], ['watermark.color', '#336699'], ['watermark.opacity', 0.3]] },
  { row: 'C1-061', text: 'put the watermark back in the middle', seed: { opts: { watermarkPos: { x: 0.2, y: 0.8, anchor: null } } },
    ops: [set('watermark.x', 0.5), set('watermark.y', 0.5)], expect: [['watermark.x', 0.5], ['watermark.y', 0.5]],
    note: 'two watermark.x/y writes to 0.5; the product\'s own Reset writes watermarkPos: null (ChartWidget resetWatermark)' },
  { row: 'C1-062', text: 'show the ticker and the company name in the title', ops: [set('header.titleMode', 'both')], expect: [['header.titleMode', 'both']] },
  { row: 'C1-063', text: 'hide the day change next to the title', ops: [set('header.showChange', false)], expect: [['header.showChange', false]] },
  { row: 'C1-064', text: 'only show the legend when I hold the crosshair', ops: [set('header.legendMode', 'hold')], expect: [['header.legendMode', 'hold']] },
  { row: 'C1-068', text: 'turn on swing labels with high sensitivity', ops: [set('swingLabels.enabled', true), set('swingLabels.sensitivity', 'high')],
    expect: [['swingLabels.enabled', true], ['swingLabels.sensitivity', 'high']] },
  { row: 'C1-069', text: 'swing labels on, tinted by high and low, green highs, red lows, dark grey background', seed: { settings: { swingLabels: { ...CHART_DEFAULTS.swingLabels, enabled: true } } },
    ops: [set('swingLabels.tintByType', true), set('swingLabels.upColor', '#00ff00'), set('swingLabels.downColor', '#ff0000'), set('swingLabels.bg', '#222222')],
    expect: [['swingLabels.tintByType', true], ['swingLabels.upColor', '#00ff00'], ['swingLabels.downColor', '#ff0000'], ['swingLabels.bg', '#222222']] },
  { row: 'C1-070', text: 'show earnings and news markers', ops: [set('markers.earnings', true), set('markers.news', true)], expect: [['markers.earnings', true], ['markers.news', true]] },
  { row: 'C1-071', text: 'earnings beats in green, misses in red, and a yellow IPO badge', seed: { settings: { markers: { ...CHART_DEFAULTS.markers, earnings: true } } },
    ops: [set('markers.earningsBeat', '#00aa00'), set('markers.earningsMiss', '#aa0000'), set('markers.ipoColor', '#ffcc00')],
    expect: [['markers.earningsBeat', '#00aa00'], ['markers.earningsMiss', '#aa0000'], ['markers.ipoColor', '#ffcc00']] },
  { row: 'C1-072', text: 'turn off the previous day high line', seed: { opts: { tf: '5' } }, ops: [set('prevDayLevels.high.enabled', false)], expect: [['prevDayLevels.high.enabled', false]] },
  { row: 'C1-073', text: 'make the prior day low line solid, 3px and magenta', seed: { opts: { tf: '5' } },
    ops: [set('prevDayLevels.low.style', 'solid'), set('prevDayLevels.low.width', 3), set('prevDayLevels.low.color', '#ff00ff')],
    expect: [['prevDayLevels.low.style', 'solid'], ['prevDayLevels.low.width', 3], ['prevDayLevels.low.color', '#ff00ff']] },
  { row: 'C1-075', text: 'show the bar close countdown', seed: { opts: { tf: '5' } }, ops: [set('countdown', true)], expect: [['countdown', true]] },
  { row: 'C1-090', text: 'stop highlighting the highest volume candle', ops: [set('volume.hvcEnabled', false)], expect: [['volume.hvcEnabled', false]] },
  { row: 'C1-091', text: 'volume bars blue up and orange down, a 50 period volume average in white, hide the volume label, histogram bars',
    ops: [set('volume.upColor', '#2962ff'), set('volume.downColor', '#ff9800'), set('volume.maPeriod', 50), set('volume.maColor', '#ffffff'), set('volume.labelVisible', false), set('volume.barStyle', 'histogram')],
    expect: [['volume.upColor', '#2962ff'], ['volume.downColor', '#ff9800'], ['volume.maPeriod', 50], ['volume.maColor', '#ffffff'], ['volume.labelVisible', false], ['volume.barStyle', 'histogram']] },
  { row: 'C1-144', text: 'set my position calculator to a 25k account risking half a percent', ops: [set('positionCalc.accountSize', 25000), set('positionCalc.riskPct', 0.5)],
    expect: [['positionCalc.accountSize', 25000], ['positionCalc.riskPct', 0.5]], note: 'the calculator\'s inputs only; placing the position-calculator DRAWING is the drawing family' },
  { row: 'C2-013', text: 'turn on Chart IQ pattern recognition', ops: [set('showChartIq', true)], expect: [['showChartIq', true]] },
  // other capabilities over the same chart blob
  { row: 'C1-087', text: 'remove volume from this chart', ops: [{ action: 'volume.setState', args: { state: 'removed' } }], expect: [['volume.removed', true]] },
]

async function runRow(r) {
  const m = open(board(r.seed), QUAD_SYMS, { selected: TARGET })
  const blob = JSON.stringify(on(m, TARGET).opts)
  const rest = others(m)
  for (const [id, v] of r.expect) expect(read(m, TARGET, id), `${r.row} seed already holds ${id}`).not.toEqual(v)
  const out = await m.say(r.text, (c) => { const ref = selectedChart(c).ref; return r.ops.map(o => ({ ...o, target: ref })) })
  if (proposalsNow().length) await m.apply()
  await waitFor(() => { for (const [id, v] of r.expect) expect(read(m, TARGET, id), `${r.row} ${id} — ${out}`).toEqual(v) })
  expect(others(m), `${r.row}: the other charts are untouched`).toBe(rest)
  await m.say('undo')
  await waitFor(() => expect(JSON.stringify(on(m, TARGET).opts), `${r.row}: Undo restores the chart`).toBe(blob))
  expect(others(m)).toBe(rest)
}

describe('chart display settings, through the real panel (one table)', () => {
  for (const r of ROWS) it(`${r.row} "${r.text}": the selected chart reads ${r.expect.map(([k, v]) => `${k}=${v}`).join(', ')}; the other charts keep theirs; Undo restores it`, () => runRow(r), 40000)

  it('C1-015 "show the breadth chart as a line": a breadth series writes breadthChartType (the key its canvas reads), chartType untouched; Undo', async () => {
    __setBreadthSymbolsForTest([{ symbol: 'UCTA50' }])
    const m = open(board({ settings: { chartType: 'bars' } }), { ...QUAD_SYMS, 'N:tr': 'UCTA50' }, { selected: TARGET })
    const blob = JSON.stringify(on(m, TARGET).opts), rest = others(m)
    expect(csOf(m, TARGET).breadthChartType || 'candles').toBe('candles')
    await m.say('show the breadth chart as a line', (c) => [{ action: 'chart.setType', target: selectedChart(c).ref, args: { type: 'line' } }])
    await waitFor(() => expect(csOf(m, TARGET).breadthChartType).toBe('line'))
    expect(csOf(m, TARGET).chartType).toBe('bars')
    expect(others(m)).toBe(rest)
    await m.say('undo')
    await waitFor(() => expect(JSON.stringify(on(m, TARGET).opts)).toBe(blob))
  }, 40000)

  it('C1-055 (colour half) "make the scale text yellow": refused as inert (the axes pick their ink from the canvas); nothing is written', async () => {
    const m = open(board(), QUAD_SYMS, { selected: TARGET })
    const all = JSON.stringify(m.board.state.widgets)
    const out = await m.say('make the scale text yellow', (c) => [{ ...set('textColor', '#ffff00'), target: selectedChart(c).ref }])
    if (proposalsNow().length) await m.apply()
    expect(out).toMatch(/text color from the chart background automatically/)
    expect(JSON.stringify(m.board.state.widgets)).toBe(all)
  }, 40000)

  it('C1-076 "restore this chart to the default look": colours/markers go back to CHART_DEFAULTS, the chart\'s own overlays (indicator-owned) stay; Undo', async () => {
    const m = open(board({ settings: { background: '#123456', grid: { ...CHART_DEFAULTS.grid, visible: false }, invertScale: true } }), QUAD_SYMS, { selected: TARGET })
    const blob = JSON.stringify(on(m, TARGET).opts), rest = others(m)
    const overlays = JSON.stringify(csOf(m, TARGET).overlays)
    await m.say('restore this chart to the default look', (c) => [{ action: 'chart.resetDefaults', target: selectedChart(c).ref, args: {} }])
    if (proposalsNow().length) await m.apply()
    await waitFor(() => expect(csOf(m, TARGET).background).toBe(CHART_DEFAULTS.background))
    expect(read(m, TARGET, 'grid.visible')).toBe(CHART_DEFAULTS.grid.visible)
    expect(read(m, TARGET, 'invertScale')).toBe(false)
    expect(JSON.stringify(csOf(m, TARGET).overlays)).toBe(overlays)
    expect(others(m)).toBe(rest)
    await m.say('undo')
    await waitFor(() => expect(JSON.stringify(on(m, TARGET).opts)).toBe(blob))
  }, 40000)

  it('C1-080 "apply a theme to all my charts": every chart takes the gallery\'s all-charts result (themeAllChartWidgets); the news widget is untouched; Undo', async () => {
    const theme = CHART_THEMES.find(t => t.id !== 'dark' && t.id !== 'sunrise') || CHART_THEMES[1]
    const news = { id: 'nw', type: 'news', x: 0, y: 20, w: 6, h: 4, color: 'N', opts: {} }
    const m = open([...board(), news], QUAD_SYMS, { selected: TARGET })
    // the workspace's own writer for "all charts" (ChartsWorkspace widgetOps.themeAll), seeded with the product defaults
    m.board.widgetOps.themeAll = (ws, id) => (CHART_THEME_BY_ID[id] ? themeAllChartWidgets(ws, CHART_THEME_BY_ID[id], mergeChartSettings(null)) : null)
    const before = JSON.stringify(m.board.state.widgets), newsBefore = JSON.stringify(on(m, 'nw'))
    const want = themeAllChartWidgets(m.board.state.widgets, theme, mergeChartSettings(null)).widgets
    await m.say(`apply the ${theme.name} theme to all my charts`, (c) => [{ action: 'chart.applyThemeAll', target: boardRef(c), args: { theme: theme.id } }])
    if (proposalsNow().length) await m.apply()
    for (const id of ['tl', 'tr', 'bl', 'br']) {
      await waitFor(() => expect(JSON.stringify(on(m, id).opts.settings), `${id} has the theme`).toBe(JSON.stringify(want.find(w => w.id === id).opts.settings)))
    }
    expect(csOf(m, 'tl').background).not.toBe(mergeChartSettings(JSON.parse(before).find(w => w.id === 'tl').opts.settings).background)
    expect(JSON.stringify(on(m, 'nw'))).toBe(newsBefore)
    await m.say('undo')
    await waitFor(() => expect(JSON.stringify(m.board.state.widgets.map(w => w.opts))).toBe(JSON.stringify(JSON.parse(before).map(w => w.opts))))
  }, 40000)

  // ── GAPS: no capability path today (the missing piece is the todo's text) ──
  it.todo('C1-058 watermark alignment — GAP: no alignment key in CHART_DEFAULTS.watermark and no ELIGIBLE row (chartSettingsDescriptors.js:98-193); nothing to write')
  it.todo('C1-067 header colours — GAP: `header.colors.*` is KNOWN, not eligible (chartSettingsDescriptors.js:243); chart.setSetting refuses it')
  it.todo('C1-077 save / delete a custom colour — GAP: no capability writes the colour picker\'s saved swatches')
  it.todo('C1-078 light/dark palette (Shift+T) — GAP: `theme` is KNOWN, not eligible (chartSettingsDescriptors.js:246); no chart.setSetting row or dedicated capability')
  it.todo('C1-081 apply a theme to all widgets — GAP: chart.applyThemeAll (board.js:1414) themes chart widgets only; no capability calls mapThemeToWidgetSettings (chartThemes.js:528)')
  it.todo('C1-092 overlay an indicator on the volume pane — GAP: `volumeOverlayIndicators` is owned:indicator (chartSettingsDescriptors.js:226); not this family')
  it.todo('C1-127 open Chart Settings (Alt+, / gear) — GAP: no capability opens the dialog (none in capabilities/chart.js or chartSetup.js)')
})

// ── HELD-OUT ROUTING (pl-exec routing family): a chart noun is never a ticker ──
// A display-settings request that carries a price word ("price label", "price scale") is read by the pre-model price
// fast path (capabilities/marketDataPhrases.js parsePriceSentence: QUOTE_FRAME / PRICE_CTX) and every word that is not
// grammar or in its NOT_A_TICKER list becomes a ticker candidate; the resolver then answers with
// capabilities/marketDataResolve.js clarifyText: "I'm not sure which instrument "axis" means …" — the request never
// reaches the model or a plan (seen live in this file's C1-054 first phrasing). The rule held out here: a sentence whose
// only candidate is a chart noun is not a price question (parsePriceSentence → null, so it goes on to the model).
// Every case holds since pl-exec's chart-noun fix (marketDataPhrases.js CHART_PART: a lower-case sentence that names a
// chart part is not a price question); the wider family is held out in agent/chartNounNotTicker.test.js.
import { parsePriceSentence } from '../../capabilities/marketDataPhrases'
const NOUN_HELD_OUT = [
  { noun: 'axis', text: 'hide the price label on the axis' },
  { noun: 'scale', text: 'show me the price scale' },
  { noun: 'crosshair', text: 'show the price on the crosshair' },
  { noun: 'legend', text: 'show the price legend' },
  { noun: 'watermark', text: 'show the price in the watermark' },
  { noun: 'grid', text: 'show the grid lines at the price' },
  { noun: 'label', text: 'hide the price labels' },
]
describe('held-out routing: chart nouns are never ticker symbols (pre-model price fast path)', () => {
  for (const c of NOUN_HELD_OUT) {
    const name = `ROUTE-NOUN ${c.noun} "${c.text}": not read as a price question for ${c.noun.toUpperCase()} (reaches the model)`
    const body = () => expect(parsePriceSentence(c.text), `${c.text} → ${JSON.stringify(parsePriceSentence(c.text))}`).toBeNull()
    it(name, body)
  }
})
