// GRID-REUSE (11-04, two pre-existing v1 wrong-action bugs, NLM-1 off) — through the REAL panel (AgentPanel + useAgent +
// registry, routing, runtime, receipts and Undo) on the REAL board writer (fixture board). Stand-in: the Agent model
// (/api/agent/turn), scripted. No paid model call.
//   #1  a COUNT of charts with tickers is THE grid: "add a 2x2 of SPY QQQ IWM DIA" on a one-chart board made FIVE charts —
//       the board's charts are reused (top-left first) and re-tiled; only words that SAY more ("new", "more") add
//   #2  a SINGULAR referent ("same for the other one") on a 4-chart board changed ALL THREE other charts — it is exactly
//       one chart: the only other one, else a question; never several
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { AuthContext } from '../context/AuthContext'

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

const ONE = () => [[{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: settings() }], { 'N:c1': 'AMD' }]
const TWO = () => [['c1', 'c2'].map((id, i) => ({ id, type: 'chart', x: i * 12, y: 0, w: 12, h: 20, color: 'N', opts: settings() })), { 'N:c1': 'AMD', 'N:c2': 'MU' }]
const FOUR = () => [['c1', 'c2', 'c3', 'c4'].map((id, i) => ({ id, type: 'chart', x: (i % 2) * 12, y: Math.floor(i / 2) * 10, w: 12, h: 10, color: 'N', opts: settings() })),
  { 'N:c1': 'SPY', 'N:c2': 'QQQ', 'N:c3': 'NVDA', 'N:c4': 'TSLA' }]
// the UCT Default board (ChartsWorkspace UCT_DEFAULT_LAYOUT)
const UCTD = () => [[
  { id: 'uctd-themes', type: 'themes', color: 'A', x: 0, y: 0, w: 3, h: 20, opts: {} },
  { id: 'uctd-chart', type: 'chart', color: 'A', x: 3, y: 0, w: 17, h: 17, opts: settings() },
  { id: 'uctd-fundamentals', type: 'fundamentals', color: 'A', x: 3, y: 17, w: 17, h: 3, opts: {} },
  { id: 'uctd-watchlist', type: 'watchlist', color: 'A', x: 20, y: 0, w: 4, h: 11, opts: {} },
  { id: 'uctd-aisearch', type: 'aisearch', color: 'A', x: 20, y: 11, w: 4, h: 9, opts: {} },
], { A: 'SPY' }]
const raw = (board) => JSON.stringify(board.state.widgets)
const syms = (board, h) => chartsOf(board).map(w => h.charts.read(w.id).symbol)
const rsiOn = (board) => chartsOf(board).filter(w => (w.opts?.settings?.indicatorInstances || []).some(i => i.defId === 'rsi' && !i.deleted)).map(w => w.id)
const emaOn = (board, len) => chartsOf(board).filter(w => (w.opts?.settings?.indicatorInstances || []).some(i => i.defId === 'movingAverage' && Number(i.inputs?.period) === len && i.inputs?.maType === 'ema' && !i.deleted)).map(w => w.id)

// ⛔ hotfix 2026-11-13 (owner + AUDIT: "adding charts must never silently replace existing charts"): an ADD with a count or a grid
// shape on a board that has charts is now ASKED — "Add 4 more charts" or "Replace my N charts with these 4" (shown first, as every
// replace). The GRID-REUSE ruling (the count IS the grid, never an extra chart) is kept on the member's pick: Replace reuses the
// board's charts top-left first, exactly as before; nothing is ever re-symbolled without that pick.
const pick = async (label) => { await waitFor(() => expect(screen.getAllByRole('button', { name: label }).length).toBeGreaterThan(0)); fireEvent.click(screen.getAllByRole('button', { name: label }).at(-1)); await waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 }) }
const applyCard = () => pick('Apply')
describe('GRID-REUSE #1 · a count of charts with tickers is THE grid — asked first (hotfix 11-13); on Replace the board\'s charts are reused, never an extra one', () => {
  const ADD_GRID = ['add a 2x2 of SPY QQQ IWM DIA', 'add a 2x2 grid of SPY, QQQ, IWM and DIA', 'add SPY, QQQ, IWM and DIA on four charts', 'add four charts for SPY QQQ IWM DIA']
  for (const [name, board0, kept] of [['one chart', ONE, ['c1']], ['two charts', TWO, ['c1', 'c2']]]) {
    for (const t of ADD_GRID) {
      it(`${name}: "${t}" → exactly 4 equal charts, ${kept.join(' + ')} reused in order; the receipt says so; Undo is exact`, async () => {
        const { board, h, say } = mount(...board0())
        const raw0 = raw(board)
        await say(t)
        // asked, nothing changed, no model call
        expect(raw(board)).toBe(raw0)
        expect(transcript()).toMatch(new RegExp(`You have ${kept.length} charts? here\\. Add these 4 \\(SPY, QQQ, IWM, DIA\\) beside them, or replace`))
        await pick(`Replace my ${kept.length} chart${kept.length === 1 ? '' : 's'} with these 4`)
        await applyCard()
        await waitFor(() => expect(chartsOf(board)).toHaveLength(4), { timeout: 8000 })
        expect(syms(board, h)).toEqual(['SPY', 'QQQ', 'IWM', 'DIA'])
        expect(chartsOf(board).slice(0, kept.length).map(w => w.id)).toEqual(kept)
        expect(new Set(chartsOf(board).map(w => `${w.w}x${w.h}`)).size).toBe(1)
        expect(turnBodies()).toHaveLength(0)
        expect(transcript()).toMatch(new RegExp(`Set up four charts for SPY, QQQ, IWM and DIA in a 2×2 grid \\(${kept.length} reused, ${4 - kept.length} new\\)`))
        expect(transcript()).not.toMatch(/beside your/)
        await say('undo')
        await waitFor(() => expect(raw(board)).toBe(raw0), { timeout: 8000 })
      }, 30000)
    }
  }
  it('the UCT Default board: the chart is reused, the other widgets stay exactly where they are; Undo is exact', async () => {
    const { board, h, say } = mount(...UCTD())
    const raw0 = raw(board)
    const others = () => JSON.stringify(board.state.widgets.filter(w => w.type !== 'chart'))
    const others0 = others()
    await say('add a 2x2 of SPY QQQ IWM DIA')
    expect(raw(board)).toBe(raw0)
    await pick('Replace my 1 chart with these 4')
    await applyCard()
    await waitFor(() => expect(chartsOf(board)).toHaveLength(4), { timeout: 8000 })
    expect(chartsOf(board)[0].id).toBe('uctd-chart')
    expect(syms(board, h)).toEqual(['SPY', 'QQQ', 'IWM', 'DIA'])
    expect(others()).toBe(others0)
    await say('undo')
    await waitFor(() => expect(raw(board)).toBe(raw0), { timeout: 8000 })
  }, 30000)
  it('held-out P08 (hotfix 11-13): "add a 2x2 of SPY QQQ IWM DIA and put the 21 ema on all of them" on a board with a chart — the add is never run as a silent re-symbol: nothing changes before the member picks', async () => {
    const { board, say } = mount(...ONE())
    const raw0 = raw(board)
    await say('add a 2x2 of SPY QQQ IWM DIA and put the 21 ema on all of them')
    expect(raw(board)).toBe(raw0)
    expect(emaOn(board, 21)).toHaveLength(0)
  }, 40000)
  for (const t of ['add two new charts for SPY and QQQ', 'add charts for SPY and QQQ']) {
    it(`words that SAY more still add: "${t}" → the AMD chart kept, two charts added; Undo is exact`, async () => {
      const { board, h, say } = mount(...ONE())
      const raw0 = raw(board)
      await say(t)
      await waitFor(() => expect(chartsOf(board)).toHaveLength(3), { timeout: 8000 })
      expect(chartsOf(board).map(w => w.id)).toContain('c1')
      expect(h.charts.read('c1').symbol).toBe('AMD')
      expect([...syms(board, h)].sort()).toEqual(['AMD', 'QQQ', 'SPY'])
      await say('undo')
      await waitFor(() => expect(raw(board)).toBe(raw0), { timeout: 8000 })
    }, 30000)
  }
})

describe('GRID-REUSE #2 · "the other one" is exactly ONE chart — never several', () => {
  it('a 4-chart board: "same for the other one" asks which chart (names them); nothing changes, no model turn; the answer by name changes ONLY that chart; Undo is exact', async () => {
    const { board, say } = mount(...FOUR())
    await say('add rsi to the SPY chart')
    await waitFor(() => expect(rsiOn(board)).toEqual(['c1']), { timeout: 8000 })
    const afterAdd = raw(board)
    for (const t of ['same for the other one', 'do the same on the other chart', 'same on the other']) {
      await say(t)
      expect(raw(board)).toBe(afterAdd)
    }
    expect(transcript().match(/Which chart — the QQQ chart, the NVDA chart or the TSLA chart\?/g)).toHaveLength(3)
    expect(turnBodies()).toHaveLength(0)
    await say('same for the QQQ chart')
    await waitFor(() => expect(rsiOn(board)).toEqual(['c1', 'c2']), { timeout: 8000 })
    await say('undo')
    await waitFor(() => expect(raw(board)).toBe(afterAdd), { timeout: 8000 })
  }, 40000)
  it('a 2-chart board: "same for the other one" IS the other chart; Undo is exact', async () => {
    const { board, say } = mount(...TWO())
    await say('add rsi to the AMD chart')
    await waitFor(() => expect(rsiOn(board)).toEqual(['c1']), { timeout: 8000 })
    const afterAdd = raw(board)
    await say('same for the other one')
    await waitFor(() => expect(rsiOn(board)).toEqual(['c1', 'c2']), { timeout: 8000 })
    expect(turnBodies()).toHaveLength(0)
    await say('undo')
    await waitFor(() => expect(raw(board)).toBe(afterAdd), { timeout: 8000 })
  }, 30000)
  it('the PLURAL is unchanged: "same for the other charts" on a 4-chart board → all three others', async () => {
    const { board, say } = mount(...FOUR())
    await say('add rsi to the SPY chart')
    await waitFor(() => expect(rsiOn(board)).toEqual(['c1']), { timeout: 8000 })
    await say('same for the other charts')
    await waitFor(() => expect(rsiOn(board)).toEqual(['c1', 'c2', 'c3', 'c4']), { timeout: 8000 })
  }, 30000)
})
