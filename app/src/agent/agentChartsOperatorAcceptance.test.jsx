// UCT Agent — CHARTS OPERATOR P1 ACCEPTANCE through the REAL panel (AgentPanel + useAgent + the registry,
// planner, policy, runtime, receipts and Undo) on a fixture board. Legacy lane: no model call is made unless
// a test scripts one (the model stand-in below), and then the same request runs in the NL-1 lane too.
//   A1  "NVDA on the left and AMD on the right" → both charts, ONE receipt, ONE Undo
//   A2  "show TSLA and AAPL side by side" → the two charts are reused (no new chart)
//   A3  "make the left chart look like the right one" → proposal → do it → applied → Undo
//   A4  "switch the second chart to weekly" → exactly that chart
//   A5  one chart + "side by side" → it shows the first; a new chart for the second is PROPOSED
//   A6  a model question with malformed choices never crashes the panel (both lanes)
//   A7  a model plan over 12 changes is refused before anything runs (both lanes)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { NL1_KEY } from './nl1/interpreter'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { setOwnedDefinitionSource, _resetProposedPlans } from './capabilities/indicatorEdits'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { adoptOverlayAverages } from '../components/chart/maAdoption'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

let turns, script, server, errors
const answer = (o) => ({ conversationId: 'c1', envelope: { disposition: 'answer', reply: '', question: null, ops: [], unsupported_category: null, correction: null, ...o }, usage: {} })
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } })
const onErr = (e) => errors.push(e?.reason || e?.error || e)
beforeEach(() => {
  turns = []; errors = []
  server = { stream: false, nl1: false }
  script = () => answer({ reply: 'ok' })
  _resetAgentConfig()
  try { localStorage.clear() } catch { /* */ }
  window.addEventListener('error', onErr); window.addEventListener('unhandledrejection', onErr)
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    if (url === '/api/agent/turn' || url === '/api/agent/turn/stream') { turns.push(body); return json(await script(body, turns.length)) }
    if (url === '/api/agent/record') return json({ conversationId: 'c1' })
    if (url === '/api/agent/config') return json(server)
    const q = /ticker-search\?q=([^&]+)/.exec(String(url))
    if (q) return json({ results: [{ ticker: decodeURIComponent(q[1]) }] })
    if (String(url).startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks()
  window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onErr)
})

const nl1On = async () => { server = { ...server, nl1: true }; localStorage.setItem(NL1_KEY, '1'); await loadAgentConfig() }
const LR = () => makeBoard([
  { id: 'L', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'N', opts: { settings: { background: '#000000' } } },
  { id: 'R', type: 'chart', x: 12, y: 0, w: 12, h: 20, color: 'N', opts: { settings: { background: '#224466', chartType: 'bars' } } },
], { 'N:L': 'SPY', 'N:R': 'QQQ' })
const sym = (b, id) => b.host.charts.read(id).symbol
const tf = (b, id) => b.host.charts.read(id).tf

function mount(b) {
  render(<AgentPanel host={b.host} onClose={() => {}} />)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => {
    await waitFor(() => { expect(box.disabled).toBe(false); expect(document.querySelector('[data-testid=agent-typing]')).toBeNull() }, { timeout: 8000 })
    fireEvent.change(box, { target: { value: t } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(box.value).toBe(''), { timeout: 4000 })
    await waitFor(() => expect(document.querySelector('[data-testid=agent-typing]')).toBeNull(), { timeout: 8000 })
  }
  return { say, transcript: () => screen.getByTestId('agent-transcript').textContent }
}

describe('Charts operator P1 — through the real panel (legacy lane, no model)', () => {
  it('A1 · "NVDA on the left and AMD on the right" → both charts, one receipt, one Undo', async () => {
    const b = LR()
    const { say, transcript } = mount(b)
    await say('NVDA on the left and AMD on the right')
    await waitFor(() => { expect(sym(b, 'L')).toBe('NVDA'); expect(sym(b, 'R')).toBe('AMD') })
    expect(turns).toHaveLength(0)
    expect(transcript()).toMatch(/Changed symbol to NVDA/)
    expect(transcript()).toMatch(/Changed symbol to AMD/)
    await say('undo')
    await waitFor(() => { expect(sym(b, 'L')).toBe('SPY'); expect(sym(b, 'R')).toBe('QQQ') })
    expect(errors).toEqual([])
  })

  it('A2 · "show TSLA and AAPL side by side" → the two charts are reused, nothing created', async () => {
    const b = LR()
    const { say } = mount(b)
    await say('show TSLA and AAPL side by side, both weekly')
    await waitFor(() => { expect(sym(b, 'L')).toBe('TSLA'); expect(sym(b, 'R')).toBe('AAPL') })
    expect(tf(b, 'L')).toBe('W'); expect(tf(b, 'R')).toBe('W')
    expect(b.state.widgets.filter(w => w.type === 'chart')).toHaveLength(2)
    expect(turns).toHaveLength(0)
  })

  it('A3 · "make the left chart look like the right one" → proposal → do it → applied → Undo', async () => {
    const b = LR()
    const { say, transcript } = mount(b)
    await say('make the left chart look like the right one')
    await screen.findByTestId('agent-proposal')
    expect(b.host.charts.read('L').cs.background).toBe('#000000')                   // nothing yet
    expect(transcript()).toMatch(/Copy the look of Chart R/)                          // pending wording on the card
    await say('do it')
    await waitFor(() => expect(b.host.charts.read('L').cs.background).toBe('#224466'))
    expect(b.host.charts.read('L').cs.chartType).toBe('bars')
    expect(b.host.charts.read('R').cs.background).toBe('#224466')                     // the source is untouched
    await say('undo')
    await waitFor(() => expect(b.host.charts.read('L').cs.background).toBe('#000000'))
    expect(turns).toHaveLength(0)
  })

  it('A4 · "switch the second chart to weekly" → exactly that chart', async () => {
    const b = makeBoard([
      { id: 'A', type: 'chart', x: 0, y: 0, w: 8, h: 20, color: 'N' }, { id: 'B', type: 'chart', x: 8, y: 0, w: 8, h: 20, color: 'N' },
      { id: 'C', type: 'chart', x: 16, y: 0, w: 8, h: 20, color: 'N' },
    ], { 'N:A': 'SPY', 'N:B': 'QQQ', 'N:C': 'IWM' })
    const { say } = mount(b)
    await say('switch the second chart to weekly')
    await waitFor(() => expect(tf(b, 'B')).toBe('W'))
    expect(tf(b, 'A')).toBe('D'); expect(tf(b, 'C')).toBe('D')
    await say('make the middle chart monthly')
    await waitFor(() => expect(tf(b, 'B')).toBe('M'))
    expect(turns).toHaveLength(0)
  })

  it('A5 · one chart + "side by side" → it shows the first symbol; a new chart for the second is proposed', async () => {
    const b = makeBoard([{ id: 'L', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'N' }], { 'N:L': 'SPY' })
    const { say, transcript } = mount(b)
    await say('NVDA and AMD side by side')
    await waitFor(() => expect(sym(b, 'L')).toBe('NVDA'))
    await screen.findByTestId('agent-proposal')
    expect(transcript()).toMatch(/Create .*AMD/)
    expect(b.state.widgets.filter(w => w.type === 'chart')).toHaveLength(1)          // nothing created before approval
    await say('do it')
    await waitFor(() => expect(b.state.widgets.filter(w => w.type === 'chart')).toHaveLength(2))
    const added = b.state.widgets.find(w => w.type === 'chart' && w.id !== 'L')
    expect(b.state.groupSyms[`N:${added.id}`]).toBe('AMD')
  })
})

// ── indicators across every chart (the real Indicators interface, setInputs) ──
const loadCs = (cs) => { const m = mergeChartSettings(JSON.stringify(cs || {})); return adoptOverlayAverages(m) || m }
function twoIndicatorCharts() {
  const store = { c1: {}, c2: {} }                     // default charts: EMA 9, EMA 20, SMA 50, SMA 200 (ovl:*)
  const read = (ref) => (ref in store ? { ref, label: `Chart ${ref}`, position: ref === 'c1' ? 'left' : 'right', symbol: ref === 'c1' ? 'QQQ' : 'SPY', tf: 'D', stored: store[ref], cs: loadCs(store[ref]), linkedCount: 0 } : null)
  return {
    store,
    host: {
      charts: { list: () => Object.keys(store).map(read), read, commit: (ref, p) => { if ('settings' in p) store[ref] = JSON.parse(JSON.stringify(p.settings)); return true }, canManageIndicators: () => true },
      persist: async () => ({ ok: true }), widgetInSync: async () => ({ ok: true }), otherWidgets: () => [],
    },
  }
}
const periodOf = (store, ref, id) => loadCs(store[ref]).indicatorInstances.find(i => i.instanceId === id)?.inputs?.period

describe('Charts operator P1 — one indicator change on every chart', () => {
  beforeEach(() => { setOwnedDefinitionSource(() => []); _resetProposedPlans() })
  // (an indicator change runs one chart at a time — `sequential`, each with its own receipt and Undo — so two
  // Undos put both charts back, newest first)
  it('A8 · "swap the 9 for a 10 on every chart" → each chart\'s EMA 9 becomes a 10 in place; Undo puts both back', async () => {
    const b = twoIndicatorCharts()
    const { say } = mount({ host: b.host })
    expect(periodOf(b.store, 'c1', 'ovl:0')).toBe(9)
    await say('swap the 9 for a 10 on every chart')
    await waitFor(() => { expect(periodOf(b.store, 'c1', 'ovl:0')).toBe(10); expect(periodOf(b.store, 'c2', 'ovl:0')).toBe(10) })
    expect(loadCs(b.store.c1).indicatorInstances.filter(i => i.defId === 'movingAverage' && !i.deleted)).toHaveLength(4)   // in place: no second average
    expect(turns).toHaveLength(0)
    await say('undo')
    await waitFor(() => expect([periodOf(b.store, 'c1', 'ovl:0'), periodOf(b.store, 'c2', 'ovl:0')].sort()).toEqual([10, 9].sort()))
    await say('undo')
    await waitFor(() => { expect(periodOf(b.store, 'c1', 'ovl:0')).toBe(9); expect(periodOf(b.store, 'c2', 'ovl:0')).toBe(9) })
  })
})

for (const lane of ['legacy', 'NL-1']) {
  describe(`Charts operator P1 hardening (${lane})`, () => {
    beforeEach(async () => { if (lane === 'NL-1') await nl1On() })

    it('A6 · a model question with malformed choices (null, numbers, objects) never crashes the panel', async () => {
      const b = LR()
      const { say, transcript } = mount(b)
      script = () => answer({ disposition: 'clarify', reply: 'Which chart?', question: { text: 'Which chart?', choices: [null, 7, { label: 'Left', ref: 'zz' }, 'Right', { nope: 1 }] } })
      await say('change the chart somehow')
      await waitFor(() => expect(transcript()).toMatch(/Which chart\?/))
      const buttons = [...document.querySelectorAll('button')].map(x => x.textContent)
      expect(buttons).toEqual(expect.arrayContaining(['Left', 'Right']))
      // the panel still works afterwards
      script = (body) => {
        const ref = Object.entries(body.__refs || {}).find(([, v]) => v === 'L')?.[0] || body.context.charts.find(c => c.label === 'Chart L')?.ref
        return answer({ disposition: 'apply', ops: [{ action: 'chart.setTimeframe', target: ref, args: { timeframe: 'W' } }] })
      }
      await say('make the left chart weekly please')
      await waitFor(() => expect(tf(b, 'L')).toBe('W'))
      expect(errors).toEqual([])
    })

    it('A7 · a model plan over 12 changes is refused before anything runs; a 12-change plan still runs', async () => {
      const b = LR()
      const { say, transcript } = mount(b)
      const refOf = (body) => Object.entries(body.__refs || {}).find(([, v]) => v === 'L')?.[0] || body.context.charts.find(c => c.label === 'Chart L')?.ref
      script = (body) => answer({ disposition: 'apply', ops: Array.from({ length: 13 }, () => ({ action: 'chart.setTimeframe', target: refOf(body), args: { timeframe: 'W' } })) })
      await say('set the left chart up for swing trading')
      await waitFor(() => expect(transcript()).toMatch(/more than 12 changes/))
      expect(tf(b, 'L')).toBe('D')
      script = (body) => answer({ disposition: 'apply', ops: [{ action: 'chart.setTimeframe', target: refOf(body), args: { timeframe: 'W' } }] })
      await say('ok just make the left chart weekly')
      await waitFor(() => expect(tf(b, 'L')).toBe('W'))
      expect(errors).toEqual([])
    })
  })
}
