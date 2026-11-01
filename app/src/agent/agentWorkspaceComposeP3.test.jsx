// UCT Agent PHASE 3 — LIVE ACCEPTANCE (2026-10-31): the whole-workspace request, exactly as typed in production —
// "make me a workspace with four daily charts for NVDA AMD AVGO and MU, a watchlist, and RSI beneath each chart".
// Through the REAL panel (panelHarness: AgentPanel + useAgent, planner, policy, runtime, receipts, Undo, the board writer and
// the Indicators mutation interface), from a POPULATED board. Production went to the model (a card was still waiting), which
// asked "Which charts should it go on?", then offered Replace / New layout, then failed with "widget.add doesn't apply to
// that", "There are no widgets to arrange" and "There isn't enough open space to add 9 widgets". Here:
//   · no "which charts?" — the request is read locally, as ONE coordinated plan (the grid, then RSI on each of ITS charts)
//   · a populated board → asked once: Replace current board / New layout
//   · Replace → the explicit approval card (it removes widgets), then the WHOLE request — 4 charts, daily, RSI 14 below each,
//     the Watchlist on the right — and Undo puts the board back exactly
//   · New layout → the layout is created (approved) and opened, the workspace built there; the old board untouched
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE, TWO, FOUR, bareSettings } from './testing/panelHarness'
import { makeBoard } from './__fixtures__/board'
import { screenModelOps } from './capabilities/indicatorAuthoring'
import { screenChartGrid } from './multiChart'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const EXACT = 'make me a workspace with four daily charts for NVDA AMD AVGO and MU, a watchlist, and RSI beneath each chart'
const WRONG = /Which charts should it go on|doesn't apply to that|There are no widgets to arrange|enough open space|source chart|copy .*indicators from/i
const ch = (id, x, y, w, h) => ({ id, type: 'chart', x, y, w, h, color: 'N', opts: { settings: bareSettings() } })
// a member's working board: a chart, a Watchlist in the MIDDLE, a News feed and a Screener — no room for four more charts
const POPULATED = () => [[ch('c', 0, 0, 12, 20), { id: 'wl', type: 'watchlist', x: 12, y: 0, w: 6, h: 20, color: 'N', opts: { watchKey: 'core' } },
  { id: 'nw', type: 'news', x: 18, y: 0, w: 6, h: 10, color: 'N', opts: {} }, { id: 'sc', type: 'screener', x: 18, y: 10, w: 6, h: 10, color: 'N', opts: {} }], { 'N:c': 'BRCB' }]
const shape = (board) => JSON.stringify(board.state.widgets.map(w => [w.id, w.type, w.x, w.y, w.w, w.h, w.color, JSON.stringify(w.opts ?? null)]).sort())
const charts = (board) => board.state.widgets.filter(w => w.type === 'chart').sort((a, b) => (a.y - b.y) || (a.x - b.x))
const transcript = () => screen.getByTestId('agent-transcript').textContent
const rsiOn = (board, id) => p.instancesOn(board, id).filter(i => i.defId === 'rsi')

function expectWorkspace(board, h) {
  const cs = charts(board)
  expect(cs).toHaveLength(4)                                                    // exactly the four asked for
  expect(cs.map(w => [h.charts.read(w.id).symbol, h.charts.read(w.id).tf])).toEqual([['NVDA', 'D'], ['AMD', 'D'], ['AVGO', 'D'], ['MU', 'D']])
  expect(cs.map(w => [w.x, w.y, w.w, w.h])).toEqual([[0, 0, 9, 10], [9, 0, 9, 10], [0, 10, 9, 10], [9, 10, 9, 10]])   // an even 2×2
  for (const w of cs) {
    const rsi = rsiOn(board, w.id)
    expect(rsi).toHaveLength(1)                                                 // RSI as an indicator, not a widget
    expect(String(rsi[0].inputs?.length ?? rsi[0].inputs?.period ?? 14)).toBe('14')
  }
  const lists = board.state.widgets.filter(w => w.type === 'watchlist')
  expect(lists).toHaveLength(1)
  expect(lists[0]).toMatchObject({ x: 18, y: 0, w: 6, h: 20 })                 // on the right, full height
  expect(board.state.widgets.filter(w => !['chart', 'watchlist'].includes(w.type))).toEqual([])
}

describe('the whole-workspace request (live acceptance 2026-10-31)', () => {
  it('populated board → asked Replace / New layout (no "which charts?") → Replace: approved, the whole request, Undo exact', async () => {
    const { say, click, board, h } = p.mount(...POPULATED())
    const before = shape(board)
    const asked = await say(EXACT)
    expect(asked).not.toMatch(WRONG)
    expect(asked).toMatch(/Your board already has a Watchlist, a News.* and a Screener on it\. Should I replace the current board/)
    expect(screen.getByRole('button', { name: 'Replace current board' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New layout' })).toBeTruthy()
    expect(shape(board)).toBe(before)                                           // a question changes nothing
    // the pick → the explicit approval card: it says exactly what goes; still nothing changed
    const card = await click('Replace current board')
    expect(card).toMatch(/replacing your board: removed the News.* and the Screener.*\(Undo puts them back\)/)
    expect(card).toMatch(/When you approve the card above, I'll carry on with the rest: “RSI beneath each chart”/)
    expect(shape(board)).toBe(before)
    // approved → the WHOLE request, one coordinated plan
    const done = await click('Apply')
    expect(done).not.toMatch(WRONG)
    expectWorkspace(board, h)
    expect(board.state.widgets.find(w => w.type === 'watchlist').id).toBe('wl')   // the member's own Watchlist, moved — its list kept
    expect(charts(board)[0].id).toBe('c')                                       // their chart reused, not replaced
    // the receipt says what was done, truthfully
    expect(transcript()).toMatch(/Set up four daily charts for NVDA, AMD, AVGO and MU in a 2×2 grid \(1 reused, 3 new\), with your Watchlist on the right/)
    for (const s of ['NVDA', 'AMD', 'AVGO', 'MU']) expect(transcript()).toMatch(new RegExp(`Added RSI \\(14\\) on Chart \\(${s}\\)`))
    expect(p.turns()).toBe(0)
    // Undo: the board exactly as it was — every removed widget back, the chart back on BRCB
    for (let i = 0; i < 8 && shape(board) !== before; i++) await say('undo')
    expect(shape(board)).toBe(before)
    expect(h.charts.read('c').symbol).toBe('BRCB')
    expect(p.turns()).toBe(0)
  }, 90000)

  it('populated board → New layout: created (approved) and opened, the workspace built there, the old board untouched', async () => {
    const [widgets, syms] = POPULATED()
    const { say, click, board, h } = p.mount(widgets, syms, { layouts: { entries: [{ id: 1, name: 'Main' }], active: 1, boards: { 1: widgets } } })
    const before = shape(board)
    await say(EXACT)
    const card = await click('New layout')
    expect(card).toMatch(/Create a new empty layout “NVDA AMD AVGO MU workspace” — your current board is unchanged/)
    expect(card).toMatch(/When you approve the card above, I.ll carry on with the rest: “open NVDA AMD AVGO MU workspace”/)
    expect(shape(board)).toBe(before)                                           // creating is approved first; nothing yet
    const done = await click('Apply')
    expect(done).not.toMatch(WRONG)
    expect(done).toMatch(/Opened “NVDA AMD AVGO MU workspace”/)
    expectWorkspace(board, h)
    expect(board.state.layouts.boards[1].map(w => w.id).sort()).toEqual(['c', 'nw', 'sc', 'wl'])   // "Main" as it was
    expect(p.turns()).toBe(0)
    // Undo, step by step: the RSI, the grid, the switch (back on "Main", exactly as it was), then the new layout deleted
    const lib = board.state.layouts
    for (let i = 0; i < 10 && lib.entries.length > 1; i++) await say('undo')
    expect(lib.activeId).toBe(1)
    expect(shape(board)).toBe(before)
    expect(lib.entries.map(e => e.name)).toEqual(['Main'])
    expect(p.turns()).toBe(0)
  }, 90000)

  it('typed while an earlier card is still waiting: read locally (not the model), the card set aside — production\'s path', async () => {
    const { say, board, h } = p.mount(...TWO())
    await say('make the left chart look like the right one')                    // a copyLook card, left waiting
    expect(screen.getAllByTestId('agent-proposal').length).toBe(1)
    const out = await say(EXACT)
    expect(out).toMatch(/I set the earlier proposal aside — nothing from it was applied/)
    expect(out).not.toMatch(WRONG)
    expect(p.turns()).toBe(0)
    expectWorkspace(board, h)                                                   // two charts only: built in place, no question
  }, 90000)

  it('the MODEL path, if it is reached: RSI aimed at the charts its own plan creates → no "which charts?", ONE grid + RSI on those charts', () => {
    const board = makeBoard(...ONE('BRCB'))
    const syms = ['NVDA', 'AMD', 'AVGO', 'MU']
    const ops = [
      ...syms.map((_, i) => ({ action: 'widget.add', target: 'workspace', args: { type: 'chart', as: `n${i}` } })),
      ...syms.map((s, i) => ({ action: 'chart.setSymbol', target: `n${i}`, args: { symbol: s } })),
      { action: 'widget.add', target: 'workspace', args: { type: 'watchlist', as: null } },
      ...syms.map((_, i) => ({ action: 'indicator.add', target: `n${i}`, args: { defId: 'rsi', inputs: null } })),
    ]
    const text = 'yo set me up with four charts for NVDA AMD AVGO and MU, a watchlist, and RSI beneath each chart'
    const screened = screenModelOps(board.host, ops, text, { surface: 'charts' })
    expect(screened.ask).toBeFalsy()                                            // production's "Which charts should it go on?"
    const g = screenChartGrid(screened.ops, text, board.host)
    expect(g.corrected).toBe(true)
    expect(g.ops).toEqual([{ action: 'chartGrid.set', target: 'board', args: { symbols: syms, timeframe: null, layout: null, new_charts: null, watchlist: true, replace: null } }])
    expect(g.then.map(t => [t.symbol, t.op.action, t.op.args.defId])).toEqual(syms.map(s => [s, 'indicator.add', 'rsi']))
    // and "each chart" about charts ALREADY on the board still asks when they aren't all named (F5 unchanged)
    const two = makeBoard(...TWO())
    const onBoard = screenModelOps(two.host, [{ action: 'indicator.add', target: 'ind:cl', args: { defId: 'rsi', inputs: null } }], 'add rsi to each chart', { surface: 'charts' })
    expect(onBoard.ask?.text).toBe('Which charts should it go on?')
  })

  it('a board of charts only: built in place, no question — one chart, and four (an even 2×2 beside the rail)', async () => {
    for (const fx of [ONE('BRCB'), FOUR()]) {
      cleanup(); p = setupPanel()
      const { say, board, h } = p.mount(...fx)
      const out = await say(EXACT)
      expect(out).not.toMatch(WRONG)
      expect(out).not.toMatch(/replace the current board/i)
      expectWorkspace(board, h)
      expect(p.turns()).toBe(0)
    }
  }, 90000)
})
