// UCT Agent Phase 2 — LIVE ACCEPTANCE FAILURES, 2026-10-29 (authenticated production Charts workspace). Through the REAL
// panel (panelHarness: AgentPanel + useAgent, planner, policy, runtime, receipts, Undo, the board writer and the
// Indicators mutation interface). The Agent model is a stand-in; no paid model call. Assertions are on the BOARD.
//
//   D1  "throw the 9 and 20 ema on my chart. make the fast one green and the other one yellow" answered "I don't know
//       that indicator for your account". Root causes: (a) the multi-step reader did not cut at a sentence boundary, so
//       the request went to the model; (b) the model's context carried the indicator catalog only after
//       add/put/apply/insert/load/plot, so it planned without the catalog's ids and invented one; (c) "the other one"
//       ignored the indicator named earlier in the same instruction; (d) a colour look routed only as "make the 9 green".
//   D2  "open daily charts for AAPL MSFT NVDA, each with a 50sma" answered "There isn't enough open space…". Root causes:
//       (a) the chart-grid reader needed a count or a layout word, and "each with a 50sma" read as nothing, so it went to
//       the model; (b) the model's plan (new charts + an indicator on each) was not the grid shape screenChartGrid turns
//       into the board's one re-tiling change, so it ran as plain adds into a full board.
//   (D3, the timeframe tutorial's highlight, is agentGuideTarget.test.jsx.)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE, bareSettings } from './testing/panelHarness'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { selectGroups } from './routing'
import { canonicalIndicatorAdds } from './capabilities/indicatorEdits'
import { planCompound } from './compound'
import { gridTickers } from './multiChart'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const GREEN = '#2faf68'
const YELLOW = '#facc15'
const emas = (board, id = 'c') => p.instancesOn(board, id).filter(i => i.defId === 'movingAverage' && i.inputs?.maType === 'ema')
  .map(i => [i.inputs.period, i.inputs.color])
const charts = (board) => board.state.widgets.filter(w => w.type === 'chart')
const cells = (board) => charts(board).map(w => [w.x, w.y, w.w, w.h])
const undoAll = async (say, done, max = 6) => { for (let i = 0; i < max && !done(); i++) await say('undo') }

describe('D1 · two EMAs and their colours, in one message', () => {
  it.each([
    'throw the 9 and 20 ema on my chart. make the fast one green and the other one yellow',     // exactly as typed live
    'Throw the 9 and 20 EMA on my chart! Make the fast one green and the other one yellow.',
    'put the 9 and 20 ema on this chart, then make the fast one green and the slow one yellow',
    'slap the 9 and 20 ema on my chart; make the 9 green and the 20 yellow',
    'add the 9 and 20 ema to my chart. Colour the fast one green and the other one yellow',
  ])('%s → EMA 9 green, EMA 20 yellow; receipts; no model call', async (q) => {
    const { say, board } = p.mount(...ONE('CYPH'))
    const out = await say(q)
    await waitFor(() => expect(emas(board)).toEqual([[9, GREEN], [20, YELLOW]]), { timeout: 8000 })
    expect(p.turns()).toBe(0)
    expect(out).toMatch(/Added EMA 9 on Chart \(CYPH\).*Added EMA 20 on Chart \(CYPH\)/)
    expect(out).toMatch(/Changed EMA 9's colour on Chart \(CYPH\) to #2faf68.*Changed EMA 20's colour on Chart \(CYPH\) to #facc15/)
    expect(out).toMatch(/All 2 steps done/)
  }, 30000)

  // what the chart DRAWS: every live indicator, its settings and look, and the widget's cell. (The Indicators interface's
  // own Undo of an add leaves bookkeeping in the stored settings — a removed instance's tombstone, renumbered ids, the
  // style preset marked "custom" — exactly as a plain "add rsi" → "undo" does on master; nothing the member sees.)
  const drawn = (board) => JSON.stringify(board.state.widgets.map(w => [w.id, w.x, w.y, w.w, w.h,
    p.instancesOn(board, w.id).map(i => [i.defId, i.inputs, i.presentation ?? null, !!i.hidden])]))
  it('Undo takes it all back: the chart draws exactly what it did', async () => {
    const { say, board } = p.mount(...ONE('CYPH'))
    const before = drawn(board)
    const stored = () => JSON.stringify(board.state.widgets[0].opts.settings ?? null)
    const storedBefore = stored()
    await say('throw the 9 and 20 ema on my chart. make the fast one green and the other one yellow')
    await waitFor(() => expect(emas(board)).toHaveLength(2), { timeout: 8000 })
    await say('undo')
    expect(emas(board)).toEqual([[9, GREEN], [20, '#f0b90b']])                   // each change its own Undo: the newest first
    await undoAll(say, () => !emas(board).length)
    expect(emas(board)).toEqual([])
    expect(drawn(board)).toBe(before)
    expect(stored()).toBe(storedBefore)                                         // and STORED exactly (Indicators #517 exact Undo)
  }, 40000)

  it('the 9 and 20 already on the chart are REUSED (no duplicates) and coloured', async () => {
    const { say, board } = p.mount(...ONE('CYPH'))
    await say('add the 9 and 20 ema')
    await waitFor(() => expect(emas(board)).toHaveLength(2), { timeout: 8000 })
    const out = await say('throw the 9 and 20 ema on my chart. make the fast one green and the other one yellow')
    await waitFor(() => expect(emas(board)).toEqual([[9, GREEN], [20, YELLOW]]), { timeout: 8000 })
    expect(out).toMatch(/already on Chart \(CYPH\), so there was nothing to add/)
    expect(p.turns()).toBe(0)
  }, 40000)

  it('an explicit copy still makes one: "add another 9 ema"', async () => {
    const { say, board } = p.mount(...ONE('CYPH'))
    await say('throw the 9 and 20 ema on my chart. make the fast one green and the other one yellow')
    await waitFor(() => expect(emas(board)).toHaveLength(2), { timeout: 8000 })
    await say('add another 9 ema')
    await waitFor(() => expect(emas(board).filter(([n]) => n === 9)).toHaveLength(2), { timeout: 8000 })
  }, 40000)

  it('as two messages: the follow-up colours each one (not "Which one?")', async () => {
    const { say, board } = p.mount(...ONE('CYPH'))
    await say('throw the 9 and 20 ema on my chart')
    const out = await say('make the fast one green and the other one yellow')
    expect(out).not.toMatch(/Which one/)
    await waitFor(() => expect(emas(board)).toEqual([[9, GREEN], [20, YELLOW]]), { timeout: 8000 })
    expect(p.turns()).toBe(0)
  }, 40000)

  it('a step that cannot run is said plainly — what was done, what was not', async () => {
    const { say, board } = p.mount(...ONE('CYPH'))
    const out = await say('throw the 9 and 20 ema on my chart. make the 50 green')
    await waitFor(() => expect(emas(board)).toHaveLength(2), { timeout: 8000 })
    expect(emas(board).every(([, c]) => c === '#f0b90b')).toBe(true)
    expect(out).toMatch(/Done 1 of 2 steps, then stopped at “make the 50 green”/)
    expect(out).not.toMatch(/All 2 steps done/)
  }, 30000)

  // the MODEL path (a phrasing no instant reader takes): what it is shown, and what it may send
  it('the model is shown the catalog and the indicator-look actions for an add with no add verb', async () => {
    const { say } = p.mount(...ONE('CYPH'))
    await say('could you chuck a nine and twenty period ema on here, the quicker one in green and the slower in yellow')
    expect(p.turns()).toBe(1)
    const body = p.lastTurnBody()
    expect((body.context.indicatorCatalog || []).some(r => r.defId === 'movingAverage')).toBe(true)
    expect(body.capabilities.map(c => c.name)).toEqual(expect.arrayContaining(['indicator.add', 'indicatorStyle.set']))
    expect(selectGroups('throw the 9 and 20 ema on my chart. make the fast one green and the other one yellow').selected).toEqual(expect.arrayContaining(['indicators', 'indicatorSetup']))
    expect(selectGroups('open daily charts for AAPL MSFT NVDA, each with a 50sma').selected).toEqual(expect.arrayContaining(['chartGrid', 'indicators']))
  }, 30000)

  it('a model add that names the built-in instead of its id ("ema", period 9) adds the canonical Moving Average', async () => {
    const { say, board } = p.mount(...ONE('CYPH'))
    const ixe = (b) => b.context.indicatorEdits[0].ref
    p.st.envelopes.push(b => p.env('apply', [
      { action: 'indicator.add', target: ixe(b), args: { defId: 'ema', inputs: [{ key: 'period', value: 9 }] } },
      { action: 'indicator.add', target: ixe(b), args: { defId: 'EMA 20', inputs: null } },
    ]))
    await say('could you chuck a nine and twenty period ema on here please')
    await waitFor(() => expect(emas(board).map(([n]) => n)).toEqual([9, 20]), { timeout: 8000 })
    expect(p.transcript()).not.toMatch(/I don’t know that indicator/)
    // an id that names nothing exactly is left alone — the check refuses it by name, as before
    expect(canonicalIndicatorAdds([{ action: 'indicator.add', args: { defId: 'zigzagzoom', inputs: null } }])[0].args.defId).toBe('zigzagzoom')
    expect(canonicalIndicatorAdds([{ action: 'indicator.add', args: { defId: 'rsi', inputs: null } }])[0].args.defId).toBe('rsi')
  }, 30000)
})

// one CYPH daily chart filling the board, as in the live workspace
const FULL = () => [[{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: { settings: { ...bareSettings(), tf: 'D' } } }], { 'N:c': 'CYPH' }]
const sma50On = (board, id) => {
  const w = board.state.widgets.find(x => x.id === id)
  const cs = mergeChartSettings(w?.opts?.settings ? JSON.stringify(w.opts.settings) : null)
  const inst = (cs.indicatorInstances || []).some(i => !i.deleted && i.defId === 'movingAverage' && i.inputs?.period === 50 && i.inputs?.maType === 'sma')
  const ovl = (cs.overlays || []).some(o => o && !o.removed && Number(o.period) === 50 && String(o.type || '').toLowerCase() === 'sma')
  return inst || ovl
}

describe('D2 · several new charts on a full board, each with an indicator', () => {
  it.each([
    'open daily charts for AAPL MSFT NVDA, each with a 50sma',                                   // exactly as typed live
    'Open daily charts for AAPL, MSFT and NVDA, each with a 50 SMA.',
    'open daily charts for AAPL, MSFT and NVDA and put a 50 sma on each',
  ])('%s → CYPH kept, three new daily charts, an equal 2×2, SMA 50 on each; no model call', async (q) => {
    const { say, board, h } = p.mount(...FULL())
    const cyph = JSON.stringify(board.state.widgets[0].opts.settings)
    const out = await say(q)
    await waitFor(() => expect(charts(board)).toHaveLength(4), { timeout: 8000 })
    expect(p.turns()).toBe(0)
    expect(out).not.toMatch(/enough open space/)
    expect(cells(board)).toEqual([[0, 0, 12, 10], [12, 0, 12, 10], [0, 10, 12, 10], [12, 10, 12, 10]])
    const [first, ...added] = charts(board)
    expect(h.charts.read(first.id).symbol).toBe('CYPH')
    expect(JSON.stringify(first.opts.settings)).toBe(cyph)                         // its settings and indicators untouched
    expect(added.map(w => [h.charts.read(w.id).symbol, h.charts.read(w.id).tf])).toEqual([['AAPL', 'D'], ['MSFT', 'D'], ['NVDA', 'D']])
    expect(added.every(w => sma50On(board, w.id))).toBe(true)
    expect(out).toMatch(/Added three new daily charts for AAPL, MSFT and NVDA beside your chart, re-tiled evenly/)
    expect(out).toMatch(/All 2 steps done/)
  }, 30000)

  it('an indicator the new charts do not already show is ADDED to each ("each with RSI"), and Undo restores the board exactly', async () => {
    const { say, board, h } = p.mount(...FULL())
    const before = JSON.stringify(board.state.widgets)
    await say('open daily charts for AAPL MSFT NVDA, each with RSI')
    await waitFor(() => expect(charts(board)).toHaveLength(4), { timeout: 8000 })
    const added = charts(board).slice(1)
    await waitFor(() => expect(added.every(w => p.instancesOn(board, w.id).some(i => i.defId === 'rsi'))).toBe(true), { timeout: 8000 })
    expect(p.instancesOn(board, 'c').some(i => i.defId === 'rsi')).toBe(false)     // never the chart already there
    expect(h.charts.read('c').symbol).toBe('CYPH')
    await undoAll(say, () => charts(board).length === 1)
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 40000)

  it('other numbers of charts: two weekly charts with the 9 and 20 ema', async () => {
    const { say, board, h } = p.mount(...FULL())
    await say('open weekly charts for AAPL and MSFT, each with the 9 and 20 ema')
    await waitFor(() => expect(charts(board)).toHaveLength(3), { timeout: 8000 })
    expect(charts(board).slice(1).map(w => [h.charts.read(w.id).symbol, h.charts.read(w.id).tf])).toEqual([['AAPL', 'W'], ['MSFT', 'W']])
    expect(p.turns()).toBe(0)
  }, 30000)

  it('past the grid limit nothing changes, said plainly', async () => {
    const { say, board } = p.mount(...FULL())
    const before = JSON.stringify(board.state.widgets)
    const out = await say('open daily charts for AAPL MSFT NVDA AMD TSLA META GOOG AMZN NFLX ORCL, each with a 50sma')
    expect(out).toMatch(/more than 9 charts|at most|ask for fewer/i)
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 30000)

  it('the planner reads it as two steps: the grid, then the add on those charts', () => {
    const { board } = p.mount(...FULL())
    expect(planCompound('open daily charts for AAPL MSFT NVDA, each with a 50sma', { host: board.host })?.steps?.map(s => s.kind)).toEqual(['grid', 'fast'])
  })

  it('the MODEL\'s plan (new charts, their tickers and timeframe, an indicator on each) becomes the grid, then the adds', async () => {
    const { say, board, h } = p.mount(...FULL())
    const ws = (b) => b.context.workspace[0].ref
    p.st.envelopes.push(b => p.env('apply', [
      ...['new1', 'new2', 'new3'].map(as => ({ action: 'widget.add', target: ws(b), args: { type: 'chart', as } })),
      ...[['new1', 'AAPL'], ['new2', 'MSFT'], ['new3', 'NVDA']].flatMap(([as, s]) => [
        { action: 'chart.setSymbol', target: as, args: { symbol: s } },
        { action: 'chart.setTimeframe', target: as, args: { timeframe: 'D' } },
        { action: 'indicator.add', target: as, args: { defId: 'rsi', inputs: null } },
      ]),
    ]))
    const out = await say('could you open apple, microsoft and nvidia daily charts and give each of them rsi')
    await waitFor(() => expect(charts(board)).toHaveLength(4), { timeout: 8000 })
    expect(out).not.toMatch(/enough open space/)
    expect(cells(board)).toEqual([[0, 0, 12, 10], [12, 0, 12, 10], [0, 10, 12, 10], [12, 10, 12, 10]])
    const added = charts(board).slice(1)
    expect(added.map(w => h.charts.read(w.id).symbol)).toEqual(['AAPL', 'MSFT', 'NVDA'])
    await waitFor(() => expect(added.every(w => p.instancesOn(board, w.id).some(i => i.defId === 'rsi'))).toBe(true), { timeout: 8000 })
    expect(h.charts.read('c').symbol).toBe('CYPH')
  }, 30000)
})

describe('unchanged: instant explanations, and Explain / Show me never change the board', () => {
  it.each(['What is RSI?', 'What is MACD?', 'What is an EMA?'])('%s', async (q) => {
    const { say, board } = p.mount(...ONE('CYPH'))
    const before = JSON.stringify(board.state.widgets)
    const out = await say(q)
    expect(p.turns()).toBe(0)
    expect(out).toMatch(/RSI \(Relative Strength Index\)|MACD — |EMA is one of the types of UCT’s Moving Average/)
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 20000)
})

// ⭐ FINAL LIVE ACCEPTANCE, 2026-10-29 (authenticated production, one BRCB daily chart filling the board):
// "open daily charts for aapl msft nvda, each with a 50sma" answered "UCT Agent returned something unreadable". Root cause:
// the chart-grid reader took only tickers typed in CAPITALS (or $-prefixed), so the lowercase tickers left it nothing to
// read and the whole request went to the model, whose reply the server refused (a 400 before any plan reached the
// browser — nothing on the board changed). A grid's tickers may now be lowercase words, under the shared N4 rule.
describe('D2 · the tickers typed in lowercase, exactly as typed live', () => {
  const BRCB = () => { const [w] = FULL(); return [w, { 'N:c': 'BRCB' }] }
  it.each([
    'open daily charts for aapl msft nvda, each with a 50sma',                                   // exactly as typed live
    'open daily charts for aapl, msft and nvda and put a 50 sma on each',
    'Open daily charts for AAPL msft nvda. Each with a 50 SMA',
  ])('%s → BRCB kept, three new daily charts, an equal 2×2, SMA 50 on each; no model call; Undo restores the board', async (q) => {
    const { say, board, h } = p.mount(...BRCB())
    const before = JSON.stringify(board.state.widgets)
    const brcb = JSON.stringify(board.state.widgets[0].opts.settings)
    const out = await say(q)
    await waitFor(() => expect(charts(board)).toHaveLength(4), { timeout: 8000 })
    expect(p.turns()).toBe(0)
    expect(out).not.toMatch(/unreadable|enough open space/)
    expect(cells(board)).toEqual([[0, 0, 12, 10], [12, 0, 12, 10], [0, 10, 12, 10], [12, 10, 12, 10]])
    const [first, ...added] = charts(board)
    expect(h.charts.read(first.id).symbol).toBe('BRCB')
    expect(JSON.stringify(first.opts.settings)).toBe(brcb)
    expect(added.map(w => [h.charts.read(w.id).symbol, h.charts.read(w.id).tf])).toEqual([['AAPL', 'D'], ['MSFT', 'D'], ['NVDA', 'D']])
    expect(added.every(w => sma50On(board, w.id))).toBe(true)
    expect(out).toMatch(/Added three new daily charts for AAPL, MSFT and NVDA beside your chart, re-tiled evenly/)
    expect(out).toMatch(/All 2 steps done/)
    await undoAll(say, () => charts(board).length === 1)
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 40000)

  it('the planner reads the lowercase sentence as the grid, then the add — the same plan as in capitals', () => {
    const { board } = p.mount(...BRCB())
    const kinds = (q) => planCompound(q, { host: board.host })?.steps?.map(s => s.kind)
    expect(kinds('open daily charts for aapl msft nvda, each with a 50sma')).toEqual(['grid', 'fast'])
    expect(kinds('open daily charts for aapl msft nvda, each with a 50sma')).toEqual(kinds('open daily charts for AAPL MSFT NVDA, each with a 50sma'))
  })

  it('a lowercase word that is not a ticker is refused by the ticker search: nothing changes, nothing is called done', async () => {
    const { say, board } = p.mount(...BRCB())
    const before = JSON.stringify(board.state.widgets)
    const base = globalThis.fetch
    globalThis.fetch = vi.fn((url, init) => (/ticker-search\?q=ZQXV/i.test(String(url))
      ? Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
      : base(url, init)))
    const out = await say('open daily charts for aapl zqxv nvda, each with a 50sma')
    expect(out).toMatch(/UCT has no symbol “ZQXV”/)
    expect(out).not.toMatch(/All 2 steps done|Added three/)
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 30000)

  it('words that are not tickers stay out of it: company names, pronouns, words UCT knows and short typos go on as before', () => {
    const { board } = p.mount(...BRCB())
    expect(gridTickers('open daily charts for apple and microsoft', board.host)).toEqual([])        // a name is the model's
    expect(gridTickers('open charts for it and them', board.host)).toEqual([])
    expect(gridTickers('open charts for teh SPY', board.host)).toEqual(['SPY'])
    expect(gridTickers('open daily charts for AAPL msft, and nvda', board.host)).toEqual(['AAPL', 'MSFT', 'NVDA'])  // the member's order
    expect(gridTickers('show me charts for nvda and amd side by side', board.host)).toEqual(['NVDA', 'AMD'])
  })

  it('a model reply the server refuses shows its sentence and changes nothing (never a success)', async () => {
    const { say, board } = p.mount(...BRCB())
    const before = JSON.stringify(board.state.widgets)
    const base = globalThis.fetch
    globalThis.fetch = vi.fn((url, init) => (url === '/api/agent/turn'
      ? Promise.resolve(new Response(JSON.stringify({ detail: 'UCT Agent returned something unreadable. Try rephrasing.' }), { status: 400, headers: { 'content-type': 'application/json' } }))
      : base(url, init)))
    const out = await say('could you open apple, microsoft and nvidia daily charts and give each of them a 50 sma')
    expect(out).toMatch(/returned something unreadable/)
    expect(out).not.toMatch(/All \d steps done|Added/)
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 30000)
})
