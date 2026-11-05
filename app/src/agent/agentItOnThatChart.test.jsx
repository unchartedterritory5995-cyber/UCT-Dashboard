// IT-ON-THAT-CHART (11-04, pre-existing v1 wrong-target, NLM-1 off): with RSI on two charts, "make it orange on that
// chart" recoloured BOTH — the shared normaliser drops a trailing "on that chart", and "it" meant every chart's RSI.
// An explicit chart phrase now narrows the pronoun to THAT chart's instance; an ambiguous phrase asks which chart and
// changes nothing. Through the REAL panel on the REAL board writer; the model scripted (no paid call).
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

const TWO = () => [['c1', 'c2'].map((id, i) => ({ id, type: 'chart', x: i * 12, y: 0, w: 12, h: 20, color: 'N', opts: settings() })), { 'N:c1': 'SPY', 'N:c2': 'QQQ' }]
const FOUR = () => [['c1', 'c2', 'c3', 'c4'].map((id, i) => ({ id, type: 'chart', x: (i % 2) * 12, y: Math.floor(i / 2) * 10, w: 12, h: 10, color: 'N', opts: settings() })), { 'N:c1': 'SPY', 'N:c2': 'QQQ', 'N:c3': 'NVDA', 'N:c4': 'TSLA' }]
const raw = (board) => JSON.stringify(board.state.widgets)
const rsiOf = (board, id) => (board.state.widgets.find(w => w.id === id).opts?.settings?.indicatorInstances || []).find(i => i.defId === 'rsi' && !i.deleted)
const ORANGE = '#f59e0b'
const orangeOn = (board) => chartsOf(board).filter(w => rsiOf(board, w.id)?.inputs?.color === ORANGE).map(w => w.id)

describe('IT-ON-THAT-CHART · a chart phrase narrows a pronoun to THAT chart\'s instance — or asks; never several', () => {
  for (const [name, board0, add, ids] of [['2 charts', TWO, 'add rsi to both charts', ['c1', 'c2']], ['4 charts', FOUR, 'add rsi to all four charts', ['c1', 'c2', 'c3', 'c4']]]) {
    it(`${name}, RSI on every chart: "make it orange on that chart" asks which chart (naming them); nothing changes, no model turn`, async () => {
      const { board, say } = mount(...board0())
      await say(add)
      await waitFor(() => expect(ids.every(id => rsiOf(board, id))).toBe(true), { timeout: 8000 })
      const before = raw(board)
      for (const t of ['make it orange on that chart', 'make it orange on that one', 'make it orange on the chart', 'make it orange on it']) {
        await say(t)
        expect(raw(board)).toBe(before)
      }
      expect(transcript().match(/Which chart — the SPY chart(?:,| or) the QQQ chart/g)).toHaveLength(4)
      expect(turnBodies()).toHaveLength(0)
    }, 40000)
    it(`${name}: "make it orange on the QQQ chart" → ONLY the QQQ chart's RSI; Undo is exact`, async () => {
      const { board, say } = mount(...board0())
      await say(add)
      await waitFor(() => expect(ids.every(id => rsiOf(board, id))).toBe(true), { timeout: 8000 })
      const before = raw(board)
      await say('make it orange on the QQQ chart')
      await waitFor(() => expect(orangeOn(board)).toEqual(['c2']), { timeout: 8000 })
      expect(turnBodies()).toHaveLength(0)
      await say('undo')
      await waitFor(() => expect(raw(board)).toBe(before), { timeout: 8000 })
    }, 30000)
  }
  it('2 charts: "make it orange on the left one" → only the left chart', async () => {
    const { board, say } = mount(...TWO())
    await say('add rsi to both charts')
    await waitFor(() => expect(rsiOf(board, 'c2')).toBeTruthy(), { timeout: 8000 })
    await say('make it orange on the left one')
    await waitFor(() => expect(orangeOn(board)).toEqual(['c1']), { timeout: 8000 })
  }, 30000)
  it('4 charts: "the left one" is TWO charts → asks (names them); "the top left one" → only that chart; Undo is exact', async () => {
    const { board, say } = mount(...FOUR())
    await say('add rsi to all four charts')
    await waitFor(() => expect(rsiOf(board, 'c4')).toBeTruthy(), { timeout: 8000 })
    const before = raw(board)
    await say('make it orange on the left one')
    expect(transcript()).toMatch(/Which chart — the SPY chart or the NVDA chart\?/)
    expect(raw(board)).toBe(before)
    await say('make it orange on the top left one')
    await waitFor(() => expect(orangeOn(board)).toEqual(['c1']), { timeout: 8000 })
    await say('undo')
    await waitFor(() => expect(raw(board)).toBe(before), { timeout: 8000 })
  }, 40000)
  it('"that chart" after a ONE-chart change is that chart: RSI on SPY, then on QQQ → "make it orange on that chart" → only QQQ', async () => {
    const { board, say } = mount(...FOUR())
    await say('add rsi to the SPY chart')
    await waitFor(() => expect(rsiOf(board, 'c1')).toBeTruthy(), { timeout: 8000 })
    await say('add rsi to the QQQ chart')
    await waitFor(() => expect(rsiOf(board, 'c2')).toBeTruthy(), { timeout: 8000 })
    await say('make it orange on that chart')
    await waitFor(() => expect(orangeOn(board)).toEqual(['c2']), { timeout: 8000 })
  }, 30000)
  it('one chart on the board: "make it orange on that chart" is that chart (unchanged)', async () => {
    const { board, say } = mount([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: settings() }], { 'N:c1': 'SPY' })
    await say('add rsi')
    await waitFor(() => expect(rsiOf(board, 'c1')).toBeTruthy(), { timeout: 8000 })
    await say('make it orange on that chart')
    await waitFor(() => expect(orangeOn(board)).toEqual(['c1']), { timeout: 8000 })
  }, 30000)
})
