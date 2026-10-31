// UCT Agent PHASE 3 — WORKSTREAM 2, ADVANCED WORKSPACE OPERATION. Through the REAL panel (panelHarness: AgentPanel +
// useAgent, planner, policy, runtime, receipts, Undo and the board writer over a fixture board). The model is a stand-in
// that none of these requests needs (p.turns() === 0). Assertions are on the BOARD: cells, tickers, timeframes, widgets.
//
//   board.swap            "swap the watchlist and the chart", "move my watchlist to the right" — each keeps its size
//   widget.resize         "make the watchlist wider" (the existing action; its local reading is new)
//   board.duplicateChart  "duplicate this chart" — its cell split, the copy born with its settings, ticker and timeframe
//   chartGrid.set         `watchlist: true` — "…four daily charts for …, a watchlist, and RSI beneath each chart"
//   timeframe sync        "make all my charts match the top left timeframe" (chart.setTimeframe on each other chart)
// (Verified in the real ChartsWorkspace too — agent-harness — see docs/agent/PHASE3-WORKSPACE.md.)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE, FOUR, bareSettings } from './testing/panelHarness'
import { fastParse } from './fastPath'
import { planChartGrid } from './chartGrid'
import { swapped } from './capabilities/board'
import { selectGroups } from './routing'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const chartW = (id, x, w) => ({ id, type: 'chart', x, y: 0, w, h: 20, color: 'N', opts: { settings: bareSettings() } })
const wl = (x) => ({ id: 'wl', type: 'watchlist', x, y: 0, w: 6, h: 20, color: 'N', opts: {} })
const WL_LEFT = () => [[wl(0), chartW('c', 6, 18)], { 'N:c': 'BRCB' }]
const WL_RIGHT = () => [[chartW('c', 0, 18), wl(18)], { 'N:c': 'BRCB' }]
const cells = (board) => Object.fromEntries(board.state.widgets.map(w => [w.id, [w.x, w.y, w.w, w.h]]))
const charts = (board) => board.state.widgets.filter(w => w.type === 'chart')

describe('board.swap — two widgets trade places, each keeping its size', () => {
  it.each([
    ['move my watchlist to the right', WL_LEFT],
    ['swap the watchlist and the chart', WL_LEFT],
    ['move the watchlist to the left', WL_RIGHT],
  ])('"%s"', async (q, B) => {
    const { say, board } = p.mount(...B())
    const before = JSON.stringify(board.state.widgets)
    const out = await say(q)
    expect(out).toMatch(/Swapped the Watchlist .* and the Chart|Swapped the Chart .* and the Watchlist/)
    const c = cells(board)
    expect(c.wl[2]).toBe(6)                                                  // the rail stays a rail
    expect(c.c[2]).toBe(18)
    expect(c.wl[0]).toBe(B === WL_LEFT ? 18 : 0)
    await say('undo')
    expect(JSON.stringify(board.state.widgets)).toBe(before)
    expect(p.turns()).toBe(0)
  }, 30000)

  it('"swap the top left and bottom right charts" — same-sized charts trade cells; nothing else moves', async () => {
    const { say, board, h } = p.mount(...FOUR())
    await say('swap the top left and bottom right charts')
    expect(cells(board)).toMatchObject({ c0: [12, 10, 12, 10], c3: [0, 0, 12, 10], c1: [12, 0, 12, 10], c2: [0, 10, 12, 10] })
    expect(h.charts.read('c0').symbol).toBe('SPY')                         // the chart moves with its ticker
    expect(p.turns()).toBe(0)
  }, 30000)

  it('two widgets neither beside each other nor the same size are not swapped (the rule, pure)', () => {
    const board = [{ id: 'a', x: 0, y: 0, w: 12, h: 10 }, { id: 'b', x: 12, y: 0, w: 12, h: 20 }, { id: 'c', x: 0, y: 10, w: 12, h: 10 }]
    expect(swapped(board, board[0], board[1])).toBeNull()                   // beside, but different rows
    expect(swapped(board, board[0], board[2])).toEqual([{ id: 'a', x: 0, y: 10, w: 12, h: 10 }, board[1], { id: 'c', x: 0, y: 0, w: 12, h: 10 }])
  })

  it('a widget name that is not on the board is not read here (→ the model, which sees the board)', () => {
    const { board } = p.mount(...WL_LEFT())
    expect(fastParse('swap the news and the chart', { host: board.host })).toBeNull()
  })
})

describe('widget.resize — read locally', () => {
  it.each([
    ['make the watchlist wider', { widget: 'wl', edge: 'left', by: 2 }],
    ['make the watchlist a little narrower', { widget: 'wl', edge: 'left', by: -1 }],
    ['make the watchlist wider by 3', { widget: 'wl', edge: 'left', by: 3 }],
  ])('"%s" → the edge toward its neighbour', (q, args) => {
    const { board } = p.mount(...WL_RIGHT())
    const f = fastParse(q, { host: board.host })
    expect(f.ops).toEqual([{ action: 'widget.resize', target: 'board', args }])
  })
})

describe('board.duplicateChart — a copy with the chart\'s settings, beside it', () => {
  it('"duplicate this chart" on a one-chart board: halves, the copy has its ticker, timeframe and indicators; one Undo', async () => {
    const { say, board, h } = p.mount(...ONE('BRCB'))
    await say('add rsi')
    const before = JSON.stringify(board.state.widgets)
    const out = await say('duplicate this chart')
    expect(out).toMatch(/Duplicated the Chart — the copy \(BRCB, not linked\) is beside it/)
    const [orig, copy] = charts(board)
    expect([orig.x, orig.w, copy.x, copy.w]).toEqual([0, 12, 12, 12])
    expect(h.charts.read(copy.id).symbol).toBe('BRCB')
    expect(copy.color).toBe('N')
    expect(p.instancesOn(board, copy.id).map(i => i.defId)).toEqual(p.instancesOn(board, orig.id).map(i => i.defId))
    expect(p.instancesOn(board, copy.id).some(i => i.defId === 'rsi')).toBe(true)
    await say('undo')
    expect(JSON.stringify(board.state.widgets)).toBe(before)
    expect(p.turns()).toBe(0)
  }, 30000)

  it('"make a copy of the NVDA chart" on four charts — only that chart\'s cell is split', async () => {
    const { say, board, h } = p.mount(...FOUR())
    await say('make a copy of the NVDA chart')
    expect(cells(board)).toMatchObject({ c0: [0, 0, 12, 10], c1: [12, 0, 12, 10], c2: [0, 10, 6, 10], c3: [12, 10, 12, 10] })
    const copy = charts(board).find(w => !['c0', 'c1', 'c2', 'c3'].includes(w.id))
    expect([copy.x, copy.y, copy.w, copy.h]).toEqual([6, 10, 6, 10])
    expect(h.charts.read(copy.id).symbol).toBe('NVDA')
  }, 30000)

  it('"clone the watchlist" is not a chart copy (→ the model, as before)', () => {
    const { board } = p.mount(...WL_RIGHT())
    expect(fastParse('clone the watchlist', { host: board.host })).toBeNull()
  })
})

describe('timeframes across charts', () => {
  it('"make all my charts match the top left timeframe" — every other chart takes the timeframe it shows; one Undo', async () => {
    const { say, board, h } = p.mount(...FOUR())
    await say('make the top left weekly')
    await say('make all my charts match the top left timeframe')
    expect(charts(board).map(w => h.charts.read(w.id).tf)).toEqual(['W', 'W', 'W', 'W'])
    await say('undo')
    expect(charts(board).map(w => h.charts.read(w.id).tf)).toEqual(['W', 'D', 'D', 'D'])
    expect(p.turns()).toBe(0)
  }, 30000)

  it('"make these charts use the same timeframe" names no winner: it asks, with each chart\'s timeframe, and nothing changes', async () => {
    const { say, board, h } = p.mount(...FOUR())
    await say('make the top left weekly')
    const out = await say('make these charts use the same timeframe')
    expect(out).toMatch(/Which timeframe should they share — Chart \(SPY\) is on Weekly, Chart \(QQQ\) is on Daily.*Nothing has changed/)
    expect(charts(board).map(w => h.charts.read(w.id).tf)).toEqual(['W', 'D', 'D', 'D'])
  }, 30000)
})

describe('workspace composition — charts, a watchlist rail and an indicator on each, in one request', () => {
  const Q = 'Make me a momentum trading workspace with four daily charts for NVDA, AMD, AVGO and MU, a watchlist, and RSI beneath each chart.'
  it('the board: a 2×2 of the four tickers, a Watchlist on the right, RSI on each chart; repeated Undo restores the board', async () => {
    const { say, board, h } = p.mount(...ONE('BRCB'))
    const before = JSON.stringify(board.state.widgets.map(w => [w.id, w.x, w.y, w.w, w.h]))
    const out = await say(Q)
    expect(out).toMatch(/Set up four daily charts for NVDA, AMD, AVGO and MU in a 2×2 grid \(1 reused, 3 new\), with a new Watchlist on the right/)
    expect(out).toMatch(/All 2 steps done/)
    const cs = charts(board)
    expect(cs.map(w => [h.charts.read(w.id).symbol, h.charts.read(w.id).tf])).toEqual([['NVDA', 'D'], ['AMD', 'D'], ['AVGO', 'D'], ['MU', 'D']])
    expect(cs.map(w => [w.x, w.y, w.w, w.h])).toEqual([[0, 0, 9, 10], [9, 0, 9, 10], [0, 10, 9, 10], [9, 10, 9, 10]])
    const rail = board.state.widgets.find(w => w.type === 'watchlist')
    expect([rail.x, rail.y, rail.w, rail.h]).toEqual([18, 0, 6, 20])
    for (const w of cs) expect(p.instancesOn(board, w.id).some(i => i.defId === 'rsi')).toBe(true)
    for (let i = 0; i < 6 && charts(board).length > 1; i++) await say('undo')
    expect(JSON.stringify(board.state.widgets.map(w => [w.id, w.x, w.y, w.w, w.h]))).toBe(before)
    expect(h.charts.read('c').symbol).toBe('BRCB')
    expect(p.turns()).toBe(0)
  }, 60000)

  it('a board that already has a Watchlist gets no second one (the rail is ignored)', async () => {
    const { say, board } = p.mount(...WL_RIGHT())
    const out = await say('make me a workspace with four daily charts for NVDA, AMD, AVGO and MU, and a watchlist')
    expect(board.state.widgets.filter(w => w.type === 'watchlist')).toHaveLength(1)
    expect(out).not.toMatch(/new Watchlist/)
  }, 30000)

  it('a NAMED list ("my momentum watchlist") is not a rail — it is the model\'s (open that list)', async () => {
    const { say } = p.mount(...ONE('BRCB'))
    await say('open daily charts for NVDA and AMD and my momentum watchlist')
    expect(p.turns()).toBe(1)
  }, 30000)

  it('the rail is refused, never forced, when a widget other than a chart is in its column (planner, pure)', () => {
    const board = [{ id: 'c', type: 'chart', x: 0, y: 0, w: 18, h: 20 }, { id: 'n', type: 'news', x: 18, y: 0, w: 6, h: 20 }]
    const r = planChartGrid({ board, charts: new Map([['c', { ref: 'c', symbol: 'SPY', tf: 'D' }]]), symbols: ['NVDA', 'AMD'], cols: 24, rows: 20,
      minOf: () => ({ minW: 2, minH: 3 }), maxWidgets: 16, rail: { type: 'watchlist', label: 'Watchlist' } })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/no room for a Watchlist on the right without moving the news/)
  })
})

describe('the model path is offered the new actions when the words need them (routing group boardEdit)', () => {
  it.each(['swap the chart and the scanner widget', 'could you duplicate the AMD chart', 'make a copy of this chart', 'move the news widget to the right'])('%s', (q) => {
    expect(selectGroups(q).selected).toContain('boardEdit')
  })
  it('…and only then (a plain chart change does not carry them)', () => {
    expect(selectGroups('make the chart weekly').selected).not.toContain('boardEdit')
  })
})
