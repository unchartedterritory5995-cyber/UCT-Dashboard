// CHARTS OUTCOME — round 4 (pl-exec): the board's own arrangement and two chart P0s, through the REAL Agent panel over the fixture
// board's real writer (the product's placement, its board writer, the chart-tab and widget-tab reducers, the layouts fixture
// server). These capabilities existed; their earlier evidence drove commitPlan with no panel. Each case here says the phrasing,
// lets the scripted model plan from the REQUEST the panel sent (outcomeHarness: a missing action is asked for with need_groups,
// as a real model would), and reads the board back; Undo where the product has one. The held-out phrasings (agentExecHeldOut4)
// are said as written; the others are this file's own.
// ⛔ THE MODEL IS SCRIPTED. Evidence: LOCAL native Windows Node, jsdom, BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { open, outcomeSuite, afterEachOutcome, chart, must, waitFor, proposalsNow } from './outcomeHarness'
import { BOARD_HELD_OUT, CHART_HELD_OUT } from '../../agentExecHeldOut4.test.js'
import { repackAroundMoved, resolveResize } from '../../../pages/charts/ChartsWorkspace'
// the workspace's own geometry for a drop and an edge drag, as ChartsWorkspace hands it to the Agent (agentWidgetOps)
const GEOMETRY = { geometry: { repack: (ws, id, rect) => repackAroundMoved(ws, id, rect), resize: (ws, id, rect, handle) => resolveResize(ws, { i: id, ...rect }, handle) } }

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await outcomeSuite()
afterEach(() => afterEachOutcome())

const H = Object.fromEntries([...BOARD_HELD_OUT, ...CHART_HELD_OUT].map(c => [c.row, c.text]))
const news = (x = 12, w = 6, h = 10, extra = {}) => ({ id: 'nw', type: 'news', x, y: 0, w, h, color: 'N', opts: {}, ...extra })
const boardRef = (c) => must(c.board?.[0]?.ref, 'board')
const wOf = (c, type) => must((c.board?.[0]?.widgets || []).find(w => w.type === type), `a ${type} widget`).id
const on = (m, id) => m.board.state.widgets.find(w => w.id === id)
const rect = (w) => [w.x, w.y, w.w, w.h]

describe('the board, through the real panel', () => {
  it(`C3-002 "${H['C3-002']}": the news widget moves to the right edge, the chart keeps its cell; Undo puts it back`, async () => {
    const m = open([chart('c1', 0, 0, 12, 20), news(12, 6, 10)], { 'N:c1': 'NVDA' }, { extra: GEOMETRY })
    const before = JSON.stringify(m.board.state.widgets)
    const out = await m.say(H['C3-002'], (c) => [{ action: 'widget.move', target: boardRef(c), args: { widget: wOf(c, 'news'), x: 18, y: 0, w: 6, h: null } }])
    if (proposalsNow().length) await m.apply()
    await waitFor(() => expect(rect(on(m, 'nw')), out).toEqual([18, 0, 6, 10]))
    expect(rect(on(m, 'c1'))).toEqual([0, 0, 12, 20])
    await m.say('undo')
    await waitFor(() => expect(JSON.stringify(m.board.state.widgets)).toBe(before))
  }, 40000)
  it(`C3-003 "${H['C3-003']}": the news widget's bottom edge moves down, the Terminal below gives up the rows; Undo puts both back`, async () => {
    // the product's resize moves a SHARED edge (resolveResize): the neighbour below gives up the space
    const m = open([chart('c1', 0, 0, 12, 20), news(12, 12, 10), { id: 'ca', type: 'calendar', x: 12, y: 10, w: 12, h: 10, color: 'N', opts: {} }], { 'N:c1': 'NVDA' }, { extra: GEOMETRY })
    const out = await m.say(H['C3-003'], (c) => [{ action: 'widget.resize', target: boardRef(c), args: { widget: wOf(c, 'news'), edge: 'bottom', by: 5 } }])
    if (proposalsNow().length) await m.apply()
    await waitFor(() => expect(on(m, 'nw').h, out).toBe(15))
    expect([on(m, 'ca').y, on(m, 'ca').h]).toEqual([15, 5])
    await m.say('undo')
    await waitFor(() => expect(on(m, 'nw').h).toBe(10))
  }, 40000)
  it(`C3-006 "${H['C3-006']}": the widget joins link group B (green); Undo unlinks it again`, async () => {
    const m = open([chart('c1', 0, 0, 12, 20), news(12, 6, 10)], { 'N:c1': 'NVDA' })
    await m.say(H['C3-006'], (c) => [{ action: 'widget.setLink', target: boardRef(c), args: { widget: wOf(c, 'news'), color: 'B' } }])
    await waitFor(() => expect(on(m, 'nw').color).toBe('B'))
    await m.say('undo')
    await waitFor(() => expect(on(m, 'nw').color).toBe('N'))
  }, 40000)
  it(`C3-016 / C3-017 / C3-019: add a Calendar as a tab on the news widget, switch to it, close it — each read off the widget's tabs`, async () => {
    const m = open([chart('c1', 0, 0, 12, 20), news(12, 12, 20)], { 'N:c1': 'NVDA' })
    const tabs = () => on(m, 'nw').wtabs || []
    const out = await m.say(H['C3-016'], (c) => [{ action: 'widget.addTab', target: boardRef(c), args: { widget: wOf(c, 'news'), type: 'calendar' } }])
    if (proposalsNow().length) await m.apply()
    await waitFor(() => expect(tabs().map(t => t.type), out).toEqual(['calendar']))
    // the product's add shows the new tab; switch back to the main tab, then to the calendar by its own tab entry
    const tabRef = (c, type) => must((c.board?.[0]?.widgets || []).find(w => w.type === 'news')?.widgetTabs?.find(t => t.type === type), `a ${type} tab`).tab
    await m.say('show the news on the news widget again', (c) => [{ action: 'widget.selectTab', target: boardRef(c), args: { widget: wOf(c, 'news'), tab: 'main' } }])
    await waitFor(() => expect(on(m, 'nw').activeWtab).toBe(0))
    await m.say(H['C3-017'], (c) => [{ action: 'widget.selectTab', target: boardRef(c), args: { widget: wOf(c, 'news'), tab: tabRef(c, 'UCT Terminal') } }])
    await waitFor(() => expect(on(m, 'nw').activeWtab).toBe(1))
    await m.say(H['C3-019'], (c) => [{ action: 'widget.closeTab', target: boardRef(c), args: { widget: wOf(c, 'news'), tab: tabRef(c, 'UCT Terminal') } }])
    await waitFor(() => expect(tabs().some(t => t.type === 'calendar')).toBe(false))
  }, 60000)
  it(`C3-063 "${H['C3-063']}": the watchlist widget shows the saved Swing list; Undo shows the list it had`, async () => {
    const m = open([chart('c1', 0, 0, 12, 20), { id: 'wl', type: 'watchlist', x: 12, y: 0, w: 12, h: 20, color: 'N', opts: { watchKey: 'user:w1', watchName: 'Momentum' } }], { 'N:c1': 'NVDA' },
      { extra: { watchlists: [{ id: 'w1', name: 'Momentum', symbols: ['NVDA'] }, { id: 'w2', name: 'Swing', symbols: ['AMD', 'TSLA'] }] } })
    await m.say(H['C3-063'], (c) => [{ action: 'widget.showList', target: boardRef(c), args: { widget: wOf(c, 'watchlist'), list: must((c.watchlists || []).find(l => l.name === 'Swing'), 'Swing list').ref } }])
    await waitFor(() => expect(on(m, 'wl').opts.watchName).toBe('Swing'))
    await m.say('undo')
    await waitFor(() => expect(on(m, 'wl').opts.watchName).toBe('Momentum'))
  }, 40000)
  it(`C3-030 "${H['C3-030']}": the open layout is saved with the board as it is now (read back from the layouts server)`, async () => {
    const m = open([chart('c1', 0, 0, 12, 20), news(12, 6, 10)], { 'N:c1': 'NVDA' },
      { extra: { layouts: { entries: [{ id: 1, name: 'Swing' }], boards: { 1: [chart('c1', 0, 0, 24, 20)] }, active: 1 } } })
    await m.say(H['C3-030'], (c) => [{ action: 'layout.saveCurrent', target: must((c.layouts || c.layoutLibrary || [])[0]?.ref, 'layouts entry'), args: {} }])
    if (proposalsNow().length) await m.apply()
    await waitFor(() => expect((m.board.state.server?.layouts?.boards?.[1] || m.board.state.layouts?.boards?.[1] || []).map(w => w.id)).toContain('nw'))
  }, 40000)
})

describe('chart P0s, through the real panel', () => {
  it(`C1-019 "${H['C1-019']}": a 5-minute chart shows the extended session; Undo turns it off`, async () => {
    const m = open([chart('c1', 0, 0, 24, 20, { opts: { tf: '5', settings: { extendedHoursShading: false } } })], { 'N:c1': 'NVDA' }, { selected: 'c1' })
    await m.say(H['C1-019'], (c) => [{ action: 'chart.setSession', target: must(c.charts?.[0]?.ref, 'chart'), args: { mode: 'extended' } }])
    await waitFor(() => expect(on(m, 'c1').opts.settings.extendedHoursShading).toBe(true))
    await m.say('undo')
    await waitFor(() => expect(on(m, 'c1').opts.settings.extendedHoursShading).toBe(false))
  }, 40000)
  it(`C1-022 "${H['C1-022']}": the chart goes to the percent scale; Undo goes back`, async () => {
    const m = open([chart('c1', 0, 0, 24, 20)], { 'N:c1': 'NVDA' }, { selected: 'c1' })
    await m.say(H['C1-022'], (c) => [{ action: 'chart.setScale', target: must(c.charts?.[0]?.ref, 'chart'), args: { scale: 'percent' } }])
    await waitFor(() => expect(on(m, 'c1').opts.settings.percentScale).toBe(true))
    await m.say('undo')
    await waitFor(() => expect(!!on(m, 'c1').opts.settings.percentScale).toBe(false))
  }, 40000)
  // C1-022's other two scales (pl-zoom): log and arithmetic BY NAME, each read back from the stored keys the A / L / % toggle
  // writes (logScale, percentScale), the other chart untouched, and Undo back to exactly what it was
  it('C1-022 "put this chart on a log scale": the chart goes to log (percent stays off), the other chart is untouched; Undo goes back', async () => {
    const m = open([chart('c1', 0, 0, 12, 20), chart('c2', 12, 0, 12, 20)], { 'N:c1': 'NVDA', 'N:c2': 'AMD' }, { selected: 'c1' })
    const other = JSON.stringify(on(m, 'c2'))
    await m.say('put this chart on a log scale', (c) => [{ action: 'chart.setScale', target: must(c.charts?.find(x => x.symbol === 'NVDA')?.ref, 'chart'), args: { scale: 'log' } }])
    await waitFor(() => expect(on(m, 'c1').opts.settings.logScale).toBe(true))
    expect(!!on(m, 'c1').opts.settings.percentScale).toBe(false)
    expect(JSON.stringify(on(m, 'c2'))).toBe(other)
    await m.say('undo')
    await waitFor(() => expect(!!on(m, 'c1').opts.settings.logScale).toBe(false))
  }, 40000)
  it('C1-022 "switch this chart back to the arithmetic scale": a log chart goes to arithmetic (log and percent off); Undo puts log back', async () => {
    const logged = chart('c1', 0, 0, 24, 20)
    logged.opts.settings = { ...logged.opts.settings, logScale: true, percentScale: false }
    const m = open([logged], { 'N:c1': 'NVDA' }, { selected: 'c1' })
    await m.say('switch this chart back to the arithmetic scale', (c) => [{ action: 'chart.setScale', target: must(c.charts?.[0]?.ref, 'chart'), args: { scale: 'linear' } }])
    await waitFor(() => expect(!!on(m, 'c1').opts.settings.logScale).toBe(false))
    expect(!!on(m, 'c1').opts.settings.percentScale).toBe(false)
    await m.say('undo')
    await waitFor(() => expect(on(m, 'c1').opts.settings.logScale).toBe(true))
  }, 40000)
})

// round 5 (pl-exec): two more P0s through the real panel. Held-out phrasings from agentExecHeldOut5.
import { SCAN_HELD_OUT, REPORTS_HELD_OUT } from '../../agentExecHeldOut5.test.js'
import { getCapability } from '../../capabilities'
describe('C3-107 a preset scan, C3-150 when a stock reports — from Charts', () => {
  it(`C3-107 "${SCAN_HELD_OUT[0].text}": the Scanner widget shows that preset (its picker's scanKey / scanName); Undo goes back`, async () => {
    const m = open([chart('c1', 0, 0, 12, 20), { id: 'sc', type: 'scanner', x: 12, y: 0, w: 12, h: 20, color: 'N', opts: {} }], { 'N:c1': 'NVDA' })
    const keys = getCapability('widget.showScan').args.properties.scan.enum
    const key = keys.find(k => /vol/i.test(k)) || keys[0]
    await m.say(SCAN_HELD_OUT[0].text, (c) => [{ action: 'widget.showScan', target: boardRef(c), args: { widget: wOf(c, 'scanner'), scan: key } }])
    await waitFor(() => expect(on(m, 'sc').opts.scanKey).toBe(key))
    expect(on(m, 'sc').opts.scanName).toBeTruthy()
    await m.say('undo')
    await waitFor(() => expect(on(m, 'sc').opts.scanKey ?? null).toBe(null))
  }, 40000)
  it.each(REPORTS_HELD_OUT.map(c => [c.text]))('C3-150 "%s" on /charts: the earnings read answers with the date, no change to the board', async (text) => {
    const m = open([chart('c1', 0, 0, 24, 20)], { 'N:c1': 'NVDA' })
    // the gateway's earnings kind (MD-1.0), invented fixture values: a next report date, one reported quarter. Both the gateway
    // read and the legacy route answer, whichever this build's config serves.
    const base = globalThis.fetch
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    const next = { report_date: '2026-11-19', quarter: 'Q3 FY2027', kind: 'scheduled' }
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url), body = init.body ? JSON.parse(init.body) : null
      if (u === '/api/agent/data' && body?.kind === 'earnings') return json({ contract: 'MD-1.0', kind: 'earnings', params_echo: body.params, status: 'ok', freshness: 'fresh', as_of: '2026-11-03', stale: false, notes: [], data: { reported: [{ quarter: 'Q2 FY2027', rev_actual: 1e9, eps_actual: 1 }], next_report: next, reported_through: 'Q2 FY2027' } })
      if (u.startsWith('/api/earnings-intel/')) return json({ quarters: [{ label: 'Q2 FY2027', revenue_actual: 1e9, eps_actual: 1 }], summary: { next_report_date: next.report_date } })
      return base(url, init)
    }
    const before = JSON.stringify(m.board.state.widgets)
    const sym = /AMD/.test(text) ? 'AMD' : 'NVDA'
    const out = await m.say(text, (c) => [{ action: 'stock.earnings', target: must(c.stockData?.[0]?.ref, 'stockData'), args: { symbol: sym } }])
    expect(out).toMatch(new RegExp(`${sym} earnings — next report: .*19`))
    expect(out).not.toMatch(/couldn't read/)
    expect(JSON.stringify(m.board.state.widgets)).toBe(before)
  }, 40000)
})
