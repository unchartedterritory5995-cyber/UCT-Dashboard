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
import { loadAgentConfig, _resetAgentConfig } from './agentClient'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()

let envelopes, calls
// NLM-1 (on by default in production since #806): every case runs with it ON (server routing_v2 + the browser key) and OFF
let nlm1 = false
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
    if (url === '/api/agent/config') return json(nlm1 ? { conversations: [], routing_v2: true } : { conversations: [] })
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
  try { localStorage.setItem('uct.agent.routingV2', nlm1 ? '1' : '0') } catch { /* */ }
  _resetAgentConfig()
  if (nlm1) loadAgentConfig()
  const board = makeBoard(widgets, groupSyms)
  const base = board.host.charts
  const h = {
    ...board.host,
    charts: { ...base, canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: extra.selected || (() => null) },
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

// C1-103 (browser acceptance, 11-05): a follow-up guard refused "hide all indicators on this chart" before the model was asked,
// on any board of two charts, because the words share a shape with "them on this chart". Those words point at nothing earlier.
for (const on of [true, false]) describe(`a request that stands alone is not a follow-up [NLM-1 ${on ? 'on' : 'off'}]`, () => {
  beforeEach(() => { nlm1 = on })
  const clicked = { selected: () => 'c1' }
  for (const t of ['hide all indicators on this chart', 'hide all the indicators on this chart', 'remove all indicators from this chart', 'hide the indicators on this chart', 'show all the moving averages on this chart', 'hide all indicators on the SPY chart', 'please hide all of the studies on the left chart']) {
    it(`"${t}" with nothing changed yet reaches the model, unrefused`, async () => {
      const { say } = mount(...TWO(), clicked)
      envelopes.push(env('answer', [], 'THE MODEL READ IT'))
      await say(t)
      await waitFor(() => expect(transcript()).toMatch(/THE MODEL READ IT/))
      expect(transcript()).not.toMatch(/Nothing I changed/)
      expect(turnBodies()).toHaveLength(1)
    }, 20000)
  }
  it('...and it is not narrowed to what the conversation added, nor sent to another chart', async () => {
    const { board, say } = mount(...TWO(), clicked)
    await say('add rsi to the QQQ chart')
    await waitFor(() => expect(rsiOf(board, 'c2')).toBeTruthy(), { timeout: 8000 })
    const before = raw(board)
    envelopes.push(env('answer', [], 'THE MODEL READ IT'))
    await say('hide all indicators on this chart')
    await waitFor(() => expect(transcript()).toMatch(/THE MODEL READ IT/))
    expect(raw(board)).toBe(before)
  }, 20000)
  it('with its indicator gone: "hide all indicators" is still a request, not a report on what I added', async () => {
    const { board, say } = mount(...TWO(), clicked)
    await say('add rsi to the QQQ chart')
    await waitFor(() => expect(rsiOf(board, 'c2')).toBeTruthy(), { timeout: 8000 })
    await say('undo')
    await waitFor(() => expect(rsiOf(board, 'c2')).toBeFalsy(), { timeout: 8000 })
    envelopes.push(env('answer', [], 'THE MODEL READ IT'))
    await say('hide all indicators')
    await waitFor(() => expect(transcript()).toMatch(/THE MODEL READ IT/))
  }, 20000)
  it('a word that DOES point back still says so: "make it orange on the QQQ chart" with nothing to point at', async () => {
    const { say } = mount(...TWO(), clicked)
    await say('make it orange on the QQQ chart')
    await waitFor(() => expect(transcript()).toMatch(/Nothing I changed in this conversation is on the QQQ chart/))
    expect(turnBodies()).toHaveLength(0)
  }, 20000)
})

for (const on of [true, false]) describe(`IT-ON-THAT-CHART [NLM-1 ${on ? 'on' : 'off'}] · a chart phrase narrows a pronoun to THAT chart's instance — or asks; never several`, () => {
  beforeEach(() => { nlm1 = on })
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
