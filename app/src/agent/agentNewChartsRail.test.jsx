// ⛔ NEW-CHARTS RAIL (2026-11-14, AUDIT review of #1251 item ii) — through the REAL panel (panelHarness: AgentPanel + useAgent +
// registry, routing, planner, policy, runtime, receipts and Undo) on the REAL board writer. Stand-in: the Agent model, scripted.
// Words about the charts UCT just created ("the new charts", "the new ones", "the charts you just added", "both new charts",
// "the new chart") with a plan that writes a chart that was ALREADY there: refused before any card or write (a known created
// set), or asked (none known). The created charts themselves, and an old chart the same words address by ticker / position /
// "the other charts", still change. The created set outlives later changes (here: one intervening change, so the instant
// created-set binding no longer applies and the MODEL plans — the gap the rail closes). LOCAL / SIMULATED (BROWSER-MOCK-MODEL).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, FOUR } from './testing/panelHarness'
import { refersToNewCharts, newChartsRefusal } from './newChartsRail'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const TWO_OLD = () => FOUR().map((x, i) => (i === 0 ? x.slice(0, 2) : x))          // SPY (c0, top-left), QQQ (c1, top-right)
const MAKE = { 0: [null, []], 1: ['open a chart for AAPL', ['AAPL']], 2: ['open charts for AAPL and MSFT', ['AAPL', 'MSFT']], 3: ['open charts for AAPL, MSFT and AMD', ['AAPL', 'MSFT', 'AMD']] }
const tfOf = (m) => Object.fromEntries(m.board.state.widgets.filter(w => w.type === 'chart').map(w => [m.h.charts.read(w.id).symbol, m.h.charts.read(w.id).tf]))
const chartOf = (b, sym) => b.context.charts.find(c => c.label === `Chart (${sym})`)?.ref
const weekly = (disp, syms) => (b) => p.env(disp, syms.map(s => ({ action: 'chart.setTimeframe', target: chartOf(b, s), args: { timeframe: 'W' } })))
const REFUSED = /I didn’t change anything: you asked about the new charts/
const ASKED = /Which charts do you mean by “the new charts”\?/
// a plan on ONE unnamed chart of several is asked about by the deictic screen before any rail (pre-existing; nothing runs)
const WHICH = /Which chart do you mean\?/
const either = (a, b) => new RegExp(`${a.source}|${b.source}`)

async function setUp(n) {
  const m = p.mount(...TWO_OLD())
  if (MAKE[n][0]) await m.say(MAKE[n][0])
  expect(Object.keys(tfOf(m))).toEqual(['SPY', 'QQQ', ...MAKE[n][1]])
  // an intervening change: the instant created-set binding no longer applies, so the phrase below goes to the model
  await m.say('make the QQQ chart a line chart')
  expect(p.turns()).toBe(0)
  return m
}
const approveIfCarded = async (m) => { if (p.proposals().length) await m.say('do it') }

const PHRASES = ['make the new charts weekly', 'switch the new ones to weekly', 'make the charts you just added weekly', 'put both new charts on the weekly', 'make the new chart weekly']
const DISPS = ['apply', 'propose']

describe('a known created set: a plan that writes an old chart under "new charts" words is refused before any card', () => {
  const CASES = [1, 2, 3].flatMap(n => PHRASES.flatMap(t => DISPS.flatMap(d => [[n, t, d, 'old'], [n, t, d, 'mixed']])))
  it.each(CASES)('%i created · "%s" · model %s · plan writes %s charts → refused, nothing written', async (n, t, d, which) => {
    const m = await setUp(n)
    const before = JSON.stringify(m.board.state.widgets)
    p.st.envelopes.push(weekly(d, which === 'old' ? ['SPY'] : [...MAKE[n][1], 'SPY']))
    const out = await m.say(t)
    expect(p.turns()).toBe(1)
    if (which === 'mixed') {
      expect(out).toMatch(REFUSED)
      expect(out).toContain('Chart (SPY)')
    } else expect(out).toMatch(either(REFUSED, WHICH))
    expect(p.proposals()).toHaveLength(0)
    expect(JSON.stringify(m.board.state.widgets)).toBe(before)
  }, 40000)
  const OK = [2, 3].flatMap(n => PHRASES.flatMap(t => DISPS.map(d => [n, t, d])))
  it.each(OK)('%i created · "%s" · model %s · plan writes only the created charts → it runs', async (n, t, d) => {
    const m = await setUp(n)
    p.st.envelopes.push(weekly(d, MAKE[n][1]))
    const out = await m.say(t)
    expect(out).not.toMatch(REFUSED)
    await approveIfCarded(m)
    expect(tfOf(m), p.transcript()).toEqual({ SPY: 'D', QQQ: 'D', ...Object.fromEntries(MAKE[n][1].map(s => [s, 'W'])) })
  }, 40000)
})

describe('a BOARD write (a chart removed) is a write of that chart too', () => {
  // widget = the board entry's widget id (the real id; fixture charts' refs are their widget ids)
  const idOf = (m, sym) => m.board.state.widgets.find(w => w.type === 'chart' && m.h.charts.read(w.id)?.symbol === sym)?.id
  const removing = (m, syms) => () => p.env('apply', syms.map(s => ({ action: 'widget.remove', target: 'board', args: { widget: idOf(m, s) } })))
  it('2 created · "close the charts you just opened" · the plan also removes SPY → refused, nothing removed', async () => {
    const m = await setUp(2)
    const before = JSON.stringify(m.board.state.widgets)
    p.st.envelopes.push(removing(m, ['AAPL', 'MSFT', 'SPY']))
    const out = await m.say('close the charts you just opened')
    expect(out).toMatch(REFUSED)
    expect(out).toContain('Chart (SPY)')
    expect(p.proposals()).toHaveLength(0)
    expect(JSON.stringify(m.board.state.widgets)).toBe(before)
  }, 40000)
  it('control: "close the charts you just opened" removing only them → they go', async () => {
    const m = await setUp(2)
    p.st.envelopes.push(removing(m, ['AAPL', 'MSFT']))
    const out = await m.say('close the charts you just opened')
    expect(out).not.toMatch(REFUSED)
    await approveIfCarded(m)
    expect(Object.keys(tfOf(m)), p.transcript()).toEqual(['SPY', 'QQQ'])
  }, 40000)
})

describe('one created chart: the plan on it is asked about first (deictic screen); the member\'s own pick is honoured', () => {
  it.each([['Chart (AAPL)', 'AAPL'], ['Chart (SPY)', 'SPY']])('"make the new chart weekly" → asked → picks %s → only that chart changes', async (label, sym) => {
    const m = await setUp(1)
    p.st.envelopes.push(weekly('apply', [sym]))
    const out = await m.say('make the new chart weekly')
    expect(out).toMatch(WHICH)
    await m.click(label)
    await approveIfCarded(m)
    expect(tfOf(m), p.transcript()).toEqual({ SPY: 'D', QQQ: 'D', AAPL: 'D', [sym]: 'W' })
  }, 40000)
})

describe('no created set known: "the new charts" over a plan on the board\'s charts is asked, never proposed or applied', () => {
  it.each(PHRASES.flatMap(t => DISPS.map(d => [t, d])))('"%s" · model %s', async (t, d) => {
    const m = await setUp(0)
    const before = JSON.stringify(m.board.state.widgets)
    p.st.envelopes.push(weekly(d, ['SPY', 'QQQ']))
    const out = await m.say(t)
    expect(out).toMatch(either(ASKED, WHICH))
    expect(p.proposals()).toHaveLength(0)
    expect(JSON.stringify(m.board.state.widgets)).toBe(before)
  }, 40000)
  it('a created set on ANOTHER layout is not known here (the board switched)', () => {
    const host = { charts: { list: () => [{ ref: 'c0', symbol: 'SPY', label: 'Chart (SPY)' }] } }
    const plan = { ok: true, plans: [{ kind: 'chart', changed: true, ref: 'c0', snap: { ref: 'c0' } }] }
    expect(newChartsRefusal(plan, { words: 'make the new charts weekly', host, created: ['w-chart-9'] })).toMatch(ASKED)
  })
})

describe('an old chart the SAME words address still changes beside the new ones', () => {
  // (panel) by position or "the other / all my charts": the rail lets the old chart through
  const ALSO = ['make the new charts and the top left one weekly', 'make the new charts weekly and the top left chart too',
    'make the new charts and the other charts weekly', 'make the new charts weekly, and all my charts too']
  it.each(ALSO)('2 created · "%s" · mixed plan → it runs', async (t) => {
    const m = await setUp(2)
    p.st.envelopes.push(weekly('apply', ['AAPL', 'MSFT', 'SPY']))
    const out = await m.say(t)
    expect(out).not.toMatch(REFUSED)
    await approveIfCarded(m)
    expect(tfOf(m), p.transcript()).toEqual({ SPY: 'W', QQQ: 'D', AAPL: 'W', MSFT: 'W' })
  }, 40000)
  // (panel) by TICKER: the existing target-ticker rail asks first ("You named SPY, but Chart (AAPL) shows AAPL") — pre-existing,
  // not this rail; nothing is written, no card. The new-charts rail's own reading of the same words is the pure case below.
  it.each(['make the new charts weekly and also the SPY one', 'make the new ones weekly, and SPY too'])('2 created · "%s" · mixed plan → asked by the target-ticker rail, nothing written', async (t) => {
    const m = await setUp(2)
    const before = JSON.stringify(m.board.state.widgets)
    p.st.envelopes.push(weekly('apply', ['AAPL', 'MSFT', 'SPY']))
    const out = await m.say(t)
    expect(out).not.toMatch(REFUSED)
    expect(out).toMatch(/You named SPY/)
    expect(p.proposals()).toHaveLength(0)
    expect(JSON.stringify(m.board.state.widgets)).toBe(before)
  }, 40000)
  // (pure) the rail itself: a ticker / "<sym> chart" / position / "the others" exempts exactly the old charts it addresses
  const host = { charts: { list: () => [
    { ref: 'c0', symbol: 'SPY', label: 'Chart (SPY)', position: 'top-left' }, { ref: 'c1', symbol: 'QQQ', label: 'Chart (QQQ)', position: 'top-right' },
    { ref: 'n1', symbol: 'AAPL', label: 'Chart (AAPL)', position: 'bottom-left' }, { ref: 'n2', symbol: 'MSFT', label: 'Chart (MSFT)', position: 'bottom-right' },
  ] } }
  const plan = (...refs) => ({ ok: true, plans: refs.map(ref => ({ kind: 'chart', changed: true, ref, snap: { ref } })) })
  it.each([
    ['make the new charts weekly and also the SPY one', ['n1', 'n2', 'c0'], null],
    ['make the new ones weekly, and SPY too', ['n1', 'n2', 'c0'], null],
    ['make the new charts weekly, the spy chart as well', ['n1', 'n2', 'c0'], null],
    ['make the new charts and the top left one weekly', ['n1', 'n2', 'c0'], null],
    ['make the new charts and the other charts weekly', ['n1', 'n2', 'c0', 'c1'], null],
    ['make the new charts weekly and also the SPY one', ['n1', 'n2', 'c0', 'c1'], 'Chart (QQQ)'],
    ['make the new charts weekly', ['n1', 'c0'], 'Chart (SPY)'],
    ['make the new charts weekly, spy is fine as it is', ['n1', 'n2', 'c1'], 'Chart (QQQ)'],
    ['make the new charts weekly', ['n1', 'n2'], null],
    // a position / ticker INSIDE the created-chart phrase describes the new charts — it never addresses an old one
    ['make the new top left ones weekly', ['n1', 'n2', 'c0'], 'Chart (SPY)'],
    ['make the newest SPY charts weekly', ['n1', 'n2', 'c0'], 'Chart (SPY)'],
    ['make the new charts weekly, the ones on the right too', ['n1', 'n2', 'c1'], null],
  ])('"%s" over %j → %s', (t, refs, refused) => {
    const r = newChartsRefusal(plan(...refs), { words: t, host, created: ['n1', 'n2'] })
    if (refused == null) expect(r).toBeNull()
    else { expect(r).toMatch(REFUSED); expect(r).toContain(refused) }
  })
})

describe('words that are not about the created charts are never touched by this rail', () => {
  it.each([
    ['add two new charts for AMD and AVGO', false], ['add a new chart for NVDA', false], ['make my charts weekly', false],
    ['make the new charts weekly', true], ['the charts you just added', true], ['that new one', true], ['both new charts', true],
    ['the charts I just added', false],
  ])('"%s" → %s', (t, v) => { expect(refersToNewCharts(t)).toBe(v) })
  // STRUCTURAL (AUDIT #1247 heads-up): phrasings no list above names, of the same shapes, are read too — generated
  const DETS = ['the', 'those', 'these', 'both', 'all of the', 'each of the', 'my']
  const FRESHW = ['new', 'fresh', 'newest', 'latest', 'brand new', 'newly added', 'recent']
  const MODSW = ['', 'AAPL and MSFT ', 'daily ', 'two ']
  const NOUNS = ['charts', 'ones', 'panes', 'panels', 'graphs']
  const A = DETS.flatMap(d => FRESHW.flatMap(f => MODSW.flatMap(m => NOUNS.map(n => `make ${d} ${f} ${m}${n} weekly`.replace(/\s+/g, ' ')))))
  const VERBS = ['added', 'opened', 'pulled up', 'set up', 'put up', 'made', 'created', 'brought up', 'loaded']
  const B = ['the charts', 'those ones', 'the panels that', 'both graphs', 'the AAPL and MSFT charts'].flatMap(np => ['you just', "you've", 'you', '', 'you recently']
    .flatMap(y => VERBS.map(v => `switch ${np} ${y} ${v} to weekly`.replace(/\s+/g, ' '))))
  const C = ['what you just added', "whatever you've opened", 'the charts from your last request', 'the ones from the previous step']
  it.each([...A, ...B, ...C].map(t => [t]))('reads "%s" as the created charts', (t) => { expect(refersToNewCharts(t)).toBe(true) })
  it.each([
    'add a new chart for NVDA', 'add two new charts for AMD and AVGO', 'open three fresh charts for AAPL MSFT AMD', 'give me a new pane with RSI',
    'make the charts I just added weekly', 'the ones I opened yesterday', 'make this one weekly', 'this one did great, make it weekly',
    'make my charts weekly', 'put RSI on all charts', 'what is new with NVDA', 'news on the new iPhone',
  ].map(t => [t]))('never reads "%s" as the created charts', (t) => { expect(refersToNewCharts(t)).toBe(false) })
  it('the instant created-set binding (no intervening change) still runs as before', async () => {
    const m = p.mount(...TWO_OLD())
    await m.say('open charts for AAPL and MSFT')
    await m.say('make the new charts weekly')
    expect(p.turns()).toBe(0)
    expect(tfOf(m)).toEqual({ SPY: 'D', QQQ: 'D', AAPL: 'W', MSFT: 'W' })
  }, 40000)
})
