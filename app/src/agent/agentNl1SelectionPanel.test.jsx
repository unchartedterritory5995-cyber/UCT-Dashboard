// NL-1 HYBRID ACTION SELECTION through the REAL panel (AgentPanel → useAgent → planner → runtime → Undo), with a
// SCRIPTED model: each test decides what the model "returns" from the request it was sent (no paid call, no network).
//
// Holds the browser to (owner 2026-10-20):
//   • each NL-1 request carries the core first and at most 60 actions; every other group is named;
//   • the model may ask for groups it was not given (`need_groups`): ONE reroute, inside the 2-call ceiling, that
//     carries them — nothing runs in between; it takes priority over the repair, which a rerouted plan never gets;
//   • when the groups cannot be supplied (too many, no call left, they would not fit beside the core) or the
//     reroute asks again: nothing runs and the member is told — never a third call, never a stand-in action;
//   • a plan made while the member's words pointed at a group that could not be sent is only PROPOSED;
//   • a waiting proposal's, the last change's and a pending question's groups ride along with the next message;
//   • flag OFF: the legacy request is unchanged (no NL-1 field, no `stable`).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { NL1_KEY } from './nl1/interpreter'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

let turns, script, serverNl1
const answer = (o, usage = {}) => ({ conversationId: 'c1', envelope: { disposition: 'answer', reply: '', question: null, ops: [], unsupported_category: null, correction: null, ...o }, usage })
// what the SERVER returns when the model asks for groups (sanitize_envelope: it plans nothing)
const needs = (groups, usage = { model_calls: 1 }) => answer({ disposition: 'clarify', question: { text: 'Looking at more of UCT…', choices: [] }, need_groups: groups }, usage)
beforeEach(() => {
  turns = []
  serverNl1 = { stream: false, nl1: true }
  script = () => answer({ reply: 'ok' })
  _resetAgentConfig()
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } })
    const body = init.body ? JSON.parse(init.body) : null
    if (url === '/api/agent/turn' || url === '/api/agent/turn/stream') { turns.push(body); return json(script(body, turns.length)) }
    if (url === '/api/agent/record') return json({ conversationId: 'c1' })
    if (url === '/api/agent/config') return json(serverNl1)
    if (String(url).startsWith('/api/live-prices')) return json({})
    // every ticker resolves, so a stand-in symbol change WOULD run if the panel let it
    if (String(url).startsWith('/api/ticker-search')) return json({ results: [{ ticker: new URL(String(url), 'http://x').searchParams.get('q') }] })
    return json({ conversations: [] })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const nl1On = async () => { localStorage.setItem(NL1_KEY, '1'); await loadAgentConfig() }
const LISTS = { watchlists: [{ id: 'm1', name: 'Momentum', symbols: ['NVDA'] }, { id: 's1', name: 'Swing', symbols: ['AMD'] }] }
const oneChart = (opts = {}) => makeBoard([{ id: 'L', type: 'chart', x: 0, y: 0, w: 12, h: 20 }], { A: 'NVDA' }, opts)
const charts = (b) => b.state.widgets.filter(w => w.type === 'chart').length
const tf = (b, id) => b.host.charts.read(id).tf
const sym = (b, id) => b.host.charts.read(id).symbol
const refOf = (body) => body.context.charts[0].ref
const WS = (body) => body.context.workspace[0].ref
const names = (body) => body.capabilities.map(c => c.name)
const addChart = (body) => answer({ disposition: 'apply', ops: [{ action: 'widget.add', target: WS(body), args: { type: 'chart', as: null } }] })
const setTf = (body, timeframe) => answer({ disposition: 'apply', ops: [{ action: 'chart.setTimeframe', target: refOf(body), args: { timeframe } }] })

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
  const transcript = () => screen.getByTestId('agent-transcript').textContent
  return { say, transcript }
}
const settle = () => new Promise(r => setTimeout(r, 250))

describe('each NL-1 request: the core first, ≤ 60 actions, every other group named', () => {
  it('the request carries the core whole and first (`routing.stable`), names the rest, and stays under the limit', async () => {
    await nl1On()
    const b = oneChart()
    const { say } = mount(b)
    script = (body) => setTf(body, 'W')
    await say('flip it to the weekly')
    await waitFor(() => expect(tf(b, 'L')).toBe('W'))
    const t = turns[0]
    expect(t.capabilities.length).toBeLessThanOrEqual(60)
    // the core, whole and first: every charts / indicators / screener / agent action this member may use HERE
    // (this board's charts do not manage indicators, so that group holds only what is available)
    const core = names(t).slice(0, t.routing.stable)
    const coreDomains = new Set(['chart', 'volume', 'indicator', 'screener', 'agent'])
    expect(core.every(n => coreDomains.has(n.split('.')[0]))).toBe(true)
    expect(names(t).slice(t.routing.stable).some(n => coreDomains.has(n.split('.')[0]))).toBe(false)
    expect(core.length).toBeLessThanOrEqual(45)
    expect(core.some(n => n.startsWith('screener.')) && core.some(n => n.startsWith('chart.')) && core.includes('agent.capabilities')).toBe(true)
    expect(t.routing.groups.map(g => g.id).filter(g => !t.routing.selected.includes(g)).length).toBeGreaterThan(0)
  })

  it('flag OFF: the legacy request is unchanged — no NL-1 field and no `stable`', async () => {
    const b = oneChart()
    const { say } = mount(b)
    script = () => answer({ reply: 'An EMA weights recent prices more.' })
    await say('how is an ema different from an sma?')
    expect(turns).toHaveLength(1)
    expect(turns[0].interpreter).toBeUndefined()
    expect(turns[0].routing?.stable).toBeUndefined()
  })
})

describe('the ONE reroute (need_groups), inside the 2-call ceiling', () => {
  it('the model asks for a group it was not given: one more call carries it, nothing runs in between, then the plan runs', async () => {
    await nl1On()
    const b = oneChart()
    const { say } = mount(b)
    let between = null
    script = (body, n) => {
      if (n === 1) {
        expect(names(body)).not.toContain('widget.add')
        expect(body.routing.selected).not.toContain('workspace')
        return needs(['workspace'])
      }
      between = charts(b)
      return addChart(body)
    }
    await say('give me one more of these')
    await waitFor(() => expect(charts(b)).toBe(2))
    expect(between).toBe(1)                                             // nothing ran between the two calls
    expect(turns).toHaveLength(2)
    expect(turns[1]).toMatchObject({ reroute: true, interpreter: 'nl1', message: 'give me one more of these' })
    expect(names(turns[1])).toContain('widget.add')
    expect(turns[1].routing.selected).toEqual(expect.arrayContaining(['charts', 'indicators', 'screener', 'agent', 'workspace']))
    expect(turns[1].capabilities.length).toBeLessThanOrEqual(60)
    expect(turns[1].repair).toBeUndefined()
  })

  it('groups that would not fit beside the core under the limit: no second call, nothing runs, the member is told', async () => {
    await nl1On()
    const b = oneChart(LISTS)
    const { say, transcript } = mount(b)
    script = () => needs(['workspace', 'layouts', 'lists'])
    await say('rebuild everything for me')
    await settle()
    expect(turns).toHaveLength(1)
    expect(transcript()).toMatch(/too many parts of UCT/)
    expect(charts(b)).toBe(1)
  })

  it('more groups than a reroute may add (3): no second call', async () => {
    await nl1On()
    const b = oneChart()
    const { say, transcript } = mount(b)
    script = () => needs(['workspace', 'layouts', 'lists', 'alerts'])
    await say('do all the things')
    await settle()
    expect(turns).toHaveLength(1)
    expect(transcript()).toMatch(/too many parts of UCT/)
  })

  it('no call left (the first answer already used two): no reroute', async () => {
    await nl1On()
    const b = oneChart()
    const { say, transcript } = mount(b)
    script = () => needs(['workspace'], { model_calls: 2, repaired: 'server' })
    await say('give me one more of these')
    await settle()
    expect(turns).toHaveLength(1)
    expect(transcript()).toMatch(/too many parts of UCT/)
    expect(charts(b)).toBe(1)
  })

  it('the reroute asks AGAIN: never a third call, nothing runs', async () => {
    await nl1On()
    const b = oneChart()
    const { say, transcript } = mount(b)
    script = (body, n) => (n === 1 ? needs(['workspace']) : needs(['alerts']))
    await say('give me one more of these')
    await settle()
    expect(turns).toHaveLength(2)
    expect(transcript()).toMatch(/needs more of UCT/)
    expect(charts(b)).toBe(1)
  })

  it('a rerouted plan the planner refuses is NOT repaired (the reroute took the second call): nothing changes', async () => {
    await nl1On()
    const b = oneChart()
    const { say } = mount(b)
    script = (body, n) => (n === 1 ? needs(['workspace']) : setTf(body, '7'))
    await say('make it the 7 minute')
    await settle()
    expect(turns).toHaveLength(2)
    expect(turns.some(t => t.repair)).toBe(false)
    expect(tf(b, 'L')).toBe('D')
  })
})

describe('no substitution', () => {
  it('"add a new chart": the add-chart action is IN the request (the member\'s words add its group)', async () => {
    await nl1On()
    const b = oneChart()
    const { say } = mount(b)
    script = (body) => addChart(body)
    await say('add a new chart')
    await waitFor(() => expect(charts(b)).toBe(2))
    expect(names(turns[0])).toContain('widget.add')
    expect(sym(b, 'L')).toBe('NVDA')                                       // the existing chart is untouched
  })

  it('words that point at a group the request could not carry: a stand-in change is only PROPOSED, never run', async () => {
    await nl1On()
    const b = oneChart(LISTS)
    const { say, transcript } = mount(b)
    // add a chart (workspace, 12) + draw (drawings, 4) + watchlist (lists, 9): beside the core, the workspace
    // group does not fit the budget — the model (scripted) "substitutes" a symbol change on the existing chart,
    // which WOULD run (every ticker resolves here) if the panel let it
    script = (body) => {
      expect(names(body)).not.toContain('widget.add')
      return answer({ disposition: 'apply', ops: [{ action: 'chart.setSymbol', target: refOf(body), args: { symbol: 'AMD' } }] })
    }
    await say('add another chart with AMD, draw a line at 100 and put AMD on my watchlist')
    await waitFor(() => expect(transcript()).toMatch(/AMD/))
    await settle()
    expect(sym(b, 'L')).toBe('NVDA')                                       // proposed, not run
    expect(turns).toHaveLength(1)
    await say('cancel')
    expect(sym(b, 'L')).toBe('NVDA')
  })

  it('the same words with a plan made from the groups that WERE sent still needs the member\'s approval, and runs on it', async () => {
    await nl1On()
    const b = oneChart(LISTS)
    const { say } = mount(b)
    script = (body) => answer({ disposition: 'apply', ops: [{ action: 'chart.setTimeframe', target: refOf(body), args: { timeframe: 'W' } }] })
    await say('add another chart with AMD, draw a line at 100 and put AMD on my watchlist')
    await settle()
    expect(tf(b, 'L')).toBe('D')
    await say('do it')
    await waitFor(() => expect(tf(b, 'L')).toBe('W'))
  })
})

describe('pinned groups ride along', () => {
  it('a pending question: its request\'s groups come with the answer ("2" alone names none)', async () => {
    await nl1On()
    const b = oneChart(LISTS)
    const { say } = mount(b)
    script = (body, n) => (n === 1
      ? answer({ disposition: 'clarify', question: { text: 'Which list?', choices: body.context.watchlists.map(l => ({ label: l.name, ref: l.ref })) } })
      : answer({ reply: 'ok' }))
    await say('put NVDA on a watchlist')
    expect(turns[0].routing.selected).toContain('lists')
    await say('2')
    expect(turns).toHaveLength(2)
    expect(turns[1].routing.selected).toContain('lists')
    expect(turns[1].context.pending_question.text).toBe('Which list?')
  })

  it('a waiting proposal: its groups come with the next message, whatever groups its words name', async () => {
    await nl1On()
    const b = oneChart()
    const { say } = mount(b)
    script = (body, n) => (n === 1
      ? answer({ disposition: 'propose', reply: 'Two more charts?', ops: [{ action: 'widget.add', target: WS(body), args: { type: 'chart', as: null } }, { action: 'widget.add', target: WS(body), args: { type: 'chart', as: null } }] })
      : answer({ reply: 'ok' }))
    await say('set me up with more charts')
    await settle()
    expect(charts(b)).toBe(1)
    // its words name other groups (which then fill the request): only the pin can bring the proposal's group
    await say('only one of them, then put NVDA on my watchlist, draw a level and set an alert')
    expect(turns[1].routing.selected).toContain('workspace')
    expect(turns[1].pending.ops[0].action).toBe('widget.add')
  })

  it('the last change: its group comes with a follow-up whose words name other groups', async () => {
    await nl1On()
    const b = oneChart()
    const { say } = mount(b)
    script = (body, n) => (n === 1 ? addChart(body) : answer({ reply: 'ok' }))
    await say('add a new chart')
    await waitFor(() => expect(charts(b)).toBe(2))
    await say('once more, then put NVDA on my watchlist, draw a level and set an alert')
    expect(turns[1].routing.selected).toContain('workspace')
    expect(turns[1].context.conversation_memory.last_change).toEqual(['widget.add'])
  })
})
