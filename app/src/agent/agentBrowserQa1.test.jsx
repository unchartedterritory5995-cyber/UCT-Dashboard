// BROWSER-QA-1 (real-browser QA of production 29830442d0, 2026-11-04) — one regression per defect, through the REAL
// panel (AgentPanel + useAgent + registry, routing, runtime, receipts and Undo) on the REAL board writer (fixture board,
// the product's own planPlacement). Stand-in: the Agent model (/api/agent/turn), scripted. No paid model call.
//   #1  a full board: a new chart is never placed off-screen — the placement check is geometric, and it is said
//   #2  "hide / remove the 50 sma on the NVDA chart": the named chart is resolved, then the existing readers run on it
//   #3  "make the line red" names a DRAWING — never an indicator; with no line drawing it is said, nothing changes
//   #4  receipts name a colour ("to red"), never its hex, where the Agent has a name for it
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { AuthContext } from '../context/AuthContext'
import { onBoardAndFree } from './host'
import { planPlacement } from '../pages/charts/placement/place'
import { colorName } from './capabilities/chart'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()

let envelopes, calls
const env = (disposition, ops, reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })
beforeEach(() => {
  envelopes = []; calls = []
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push([init.method || 'GET', String(url), body])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') {
      const e = envelopes.shift()
      return json({ conversationId: 'ac_1', envelope: typeof e === 'function' ? e(body) : (e || env('answer', [], 'NO SCRIPTED MODEL TURN')), usage: { research_calls: 0, citations: [] } })
    }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    const q = /ticker-search\?q=([^&]+)/.exec(String(url))
    if (q) return json({ results: [{ ticker: decodeURIComponent(q[1]).toUpperCase() }] })
    if (String(url).startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const turnBodies = () => calls.filter(c => c[1] === '/api/agent/turn').map(c => c[2])
const transcript = () => screen.getByTestId('agent-transcript').textContent
const receipts = () => screen.queryAllByTestId('agent-receipt')
const idle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 })

function mount(widgets, groupSyms, extra = {}) {
  const board = makeBoard(widgets, groupSyms)
  const base = board.host.charts
  const h = {
    ...board.host,
    charts: { ...base, canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => null },
    persist: async () => ({ ok: true }),
    ...extra,
  }
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><AgentPanel host={h} onClose={() => {}} /></AuthContext.Provider>)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await idle(); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }); await idle() }
  return { board, h, say }
}
const chartsOf = (board) => board.state.widgets.filter(w => w.type === 'chart').sort((a, b) => (a.y - b.y) || (a.x - b.x))
const settings = () => ({ settings: mergeChartSettings(null) })

// the UCT Default board (ChartsWorkspace UCT_DEFAULT_LAYOUT) — QA's starting board
const UCTD = () => [[
  { id: 'uctd-themes', type: 'themes', color: 'A', x: 0, y: 0, w: 3, h: 20, opts: {} },
  { id: 'uctd-chart', type: 'chart', color: 'A', x: 3, y: 0, w: 17, h: 17, opts: settings() },
  { id: 'uctd-fundamentals', type: 'fundamentals', color: 'A', x: 3, y: 17, w: 17, h: 3, opts: {} },
  { id: 'uctd-watchlist', type: 'watchlist', color: 'A', x: 20, y: 0, w: 4, h: 11, opts: {} },
  { id: 'uctd-aisearch', type: 'aisearch', color: 'A', x: 20, y: 11, w: 4, h: 9, opts: {} },
], { A: 'SPY' }]
// four charts on their default settings (EMA 9/20, SMA 50/200 on each), the board full
const FOUR = () => [['c1', 'c2', 'c3', 'c4'].map((id, i) => ({ id, type: 'chart', x: (i % 2) * 12, y: Math.floor(i / 2) * 10, w: 12, h: 10, color: 'N', opts: settings() })),
  { 'N:c1': 'SPY', 'N:c2': 'QQQ', 'N:c3': 'NVDA', 'N:c4': 'TSLA' }]
const inst = (board, id, len, type) => (board.state.widgets.find(w => w.id === id).opts?.settings?.indicatorInstances || []).find(i => i.defId === 'movingAverage' && Number(i.inputs?.period) === len && i.inputs?.maType === type && !i.deleted)
const raw = (board) => JSON.stringify(board.state.widgets)
const onBoard = (w) => w.x >= 0 && w.y >= 0 && w.x + w.w <= 24 && w.y + w.h <= 20

describe('BROWSER-QA-1 #1 · a full board never takes a new chart off-screen', () => {
  it('the placement check is geometric: planPlacement\'s last resort (an OVERLAPPING place, no mutations) is not empty space', () => {
    const [ws] = UCTD()
    const full = [...ws.filter(w => w.type !== 'chart'), { id: 'a', type: 'chart', x: 3, y: 0, w: 9, h: 9 }, { id: 'b', type: 'chart', x: 12, y: 0, w: 8, h: 9 }, { id: 'c', type: 'chart', x: 3, y: 9, w: 9, h: 8 }, { id: 'd', type: 'chart', x: 12, y: 9, w: 8, h: 8 }]
    const plan = planPlacement(full, 'chart')
    expect(plan.mutations).toEqual([])                                    // the product says "no resize needed"…
    expect(onBoardAndFree(plan.place, full)).toBe(false)                  // …but the place overlaps the board
    expect(onBoardAndFree({ x: 0, y: 0, w: 4, h: 4 }, [])).toBe(true)
    expect(onBoardAndFree({ x: 0, y: 17, w: 4, h: 4 }, [])).toBe(false)  // below the visible rows
  })
  it('QA #3/#30: UCT Default → a 2×2 grid → "open AMD on a new chart and switch it to the weekly" is said honestly; nothing changes; Undo takes back the grid', async () => {
    const { board, say } = mount(...UCTD())
    const raw0 = raw(board)
    await say('Put SPY, QQQ, NVDA, and TSLA on four charts, all the same size.')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(4), { timeout: 8000 })
    const grid = raw(board)
    await say('open AMD on a new chart and switch it to the weekly')
    await waitFor(() => expect(transcript()).toMatch(/no empty space for a Chart without resizing other widgets/))
    expect(raw(board)).toBe(grid)
    expect(receipts()).toHaveLength(1)
    expect(board.state.widgets.every(onBoard)).toBe(true)
    await say('open AMD on a new chart')
    await waitFor(() => expect(transcript().match(/no empty space for a Chart/g)).toHaveLength(2))
    expect(raw(board)).toBe(grid)
    await say('undo')
    await waitFor(() => expect(raw(board)).toBe(raw0), { timeout: 8000 })
  }, 40000)
  it('the model\'s plan is refused by the same check (no chart created, no receipt claiming one)', async () => {
    const { board, say } = mount(...FOUR())
    const raw0 = raw(board)
    envelopes.push(b => env('apply', [
      { action: 'widget.add', target: b.context.workspace[0].ref, args: { type: 'chart', as: 'new1' } },
      { action: 'chart.setSymbol', target: 'new1', args: { symbol: 'AMD' } },
    ]))
    await say('could you squeeze one more chart in for AMD')
    await waitFor(() => expect(transcript()).toMatch(/no empty space for a Chart/))
    expect(raw(board)).toBe(raw0)
    expect(receipts()).toHaveLength(0)
  }, 30000)
  it('with room, a new chart still lands on the board in empty space (unchanged behaviour)', async () => {
    const { board, say } = mount([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'A', opts: settings() }], { A: 'SPY' })
    await say('open AMD on a new chart')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(2), { timeout: 8000 })
    const amd = chartsOf(board).find(w => w.id !== 'c1')
    expect(onBoard(amd)).toBe(true)
    expect(onBoardAndFree(amd, board.state.widgets.filter(w => w.id !== amd.id))).toBe(true)
  }, 30000)
})

describe('BROWSER-QA-1 #2 · a clause that names its chart: the chart is resolved, then the existing readers run on it', () => {
  for (const t of ['hide the 50 sma on the NVDA chart', 'hide the SMA 50 on the NVDA chart', 'turn off the 50 sma on the bottom-left chart']) {
    it(`"${t}" → the NVDA chart's SMA 50 hidden, no model turn, no other chart touched; Undo restores it`, async () => {
      const { board, say } = mount(...FOUR())
      const raw0 = raw(board)
      const others = () => JSON.stringify(board.state.widgets.filter(w => w.id !== 'c3'))
      const others0 = others()
      await say(t)
      await waitFor(() => expect(inst(board, 'c3', 50, 'sma')?.hidden).toBe(true), { timeout: 8000 })
      expect(turnBodies()).toHaveLength(0)
      expect(others()).toBe(others0)
      await say('undo')
      await waitFor(() => expect(raw(board)).toBe(raw0), { timeout: 8000 })
    }, 30000)
  }
  it('"remove the 200 sma from the NVDA chart" → a proposal for THAT chart; nothing changes before approval; approved → removed there only; Undo restores it', async () => {
    const { board, say } = mount(...FOUR())
    const raw0 = raw(board)
    await say('remove the 200 sma from the NVDA chart')
    await waitFor(() => expect(screen.queryAllByTestId('agent-proposal').length).toBeGreaterThan(0), { timeout: 8000 })
    expect(turnBodies()).toHaveLength(0)
    expect(raw(board)).toBe(raw0)
    await say('do it')
    await waitFor(() => expect(inst(board, 'c3', 200, 'sma')).toBeFalsy(), { timeout: 8000 })
    for (const id of ['c1', 'c2', 'c4']) expect(inst(board, id, 200, 'sma')).toBeTruthy()
    await say('undo')
    await waitFor(() => expect(inst(board, 'c3', 200, 'sma')).toBeTruthy(), { timeout: 8000 })
  }, 30000)
  it('a phrase that names no chart on this board is not resolved to some other chart — nothing changes', async () => {
    const { board, say } = mount(...FOUR())
    const raw0 = raw(board)
    await say('hide the 50 sma on the AMZN chart')
    expect(raw(board)).toBe(raw0)
  }, 30000)
})

describe('BROWSER-QA-1 #3 · "the line" names a drawing — never an indicator', () => {
  it('QA #18: after an indicator change, "make the line red" with no drawing → said honestly, nothing changes, no Undo entry', async () => {
    const { board, say } = mount(...FOUR())
    const raw0 = raw(board)
    await say('hide the 50 sma on the NVDA chart')
    await waitFor(() => expect(inst(board, 'c3', 50, 'sma')?.hidden).toBe(true), { timeout: 8000 })
    const afterHide = raw(board)
    for (const t of ['make the line red', 'color that line red']) {
      await say(t)
      expect(raw(board)).toBe(afterHide)
    }
    expect(transcript().match(/There's no line drawing on the NVDA chart — nothing changed/g)).toHaveLength(2)
    expect(turnBodies()).toHaveLength(0)
    await say('undo')                                                            // the hide — the last REAL change
    await waitFor(() => expect(raw(board)).toBe(raw0), { timeout: 8000 })
  }, 40000)
  it('with a line drawing on that chart, "the line" is not an indicator reference: the drawing path / the model decides — no indicator recoloured', async () => {
    const drawings = { list: () => [{ ref: 'NVDA', symbol: 'NVDA', drawings: [{ id: 'd1', type: 'horizontal', points: [{ price: 1 }] }] }] }
    const { board, say } = mount(...FOUR(), { drawings })
    await say('hide the 50 sma on the NVDA chart')
    await waitFor(() => expect(inst(board, 'c3', 50, 'sma')?.hidden).toBe(true), { timeout: 8000 })
    const afterHide = raw(board)
    await say('make the line red')
    await waitFor(() => expect(turnBodies()).toHaveLength(1))
    expect(raw(board)).toBe(afterHide)
    expect(transcript()).not.toMatch(/no line drawing/)
  }, 30000)
})

describe('BROWSER-QA-1 #4 · receipts name the colour', () => {
  it('colorName: a named palette value → its name; anything else → as written', () => {
    expect(colorName('#df4646')).toBe('red')
    expect(colorName('#F59E0B')).toBe('orange')
    expect(colorName('#808080')).toBe('gray')
    expect(colorName('#123456')).toBe('#123456')
    expect(colorName('rgba(1,2,3,0.5)')).toBe('rgba(1,2,3,0.5)')
  })
  it('QA #11: "make the 20 ema on the NVDA chart red" → "…to red." (no hex); the stored colour is the palette red; Undo restores it', async () => {
    const { board, say } = mount(...FOUR())
    const raw0 = raw(board)
    await say('make the 20 ema on the NVDA chart red')
    await waitFor(() => expect(transcript()).toMatch(/Changed EMA 20's colour on .* to red\./), { timeout: 8000 })
    expect(transcript()).not.toMatch(/#df4646/i)
    expect(inst(board, 'c3', 20, 'ema').inputs.color).toBe('#df4646')
    await say('undo')
    await waitFor(() => expect(raw(board)).toBe(raw0), { timeout: 8000 })
  }, 30000)
  it('a custom colour with no name is said exactly ("#123456")', async () => {
    const { say } = mount(...FOUR())
    await say('make the 20 ema on the NVDA chart #123456')
    await waitFor(() => expect(transcript()).toMatch(/to #123456\./), { timeout: 8000 })
  }, 30000)
})
