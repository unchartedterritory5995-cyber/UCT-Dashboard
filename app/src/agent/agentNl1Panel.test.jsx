// NL-1 through the REAL panel (AgentPanel → useAgent → planner → runtime → Undo), with a SCRIPTED model:
// each test decides what the model "returns" from the request it was sent (no paid call, no network).
//
// Holds the browser to:
//   • flag OFF (default): nothing changes — the instant path answers, no NL-1 field is ever sent;
//   • flag ON: every ordinary request goes to the model with the whole catalog and no routing; only EXACT
//     Undo / Confirm / Cancel stay instant;
//   • a CORRECTION reverses the Agent's previous change through the existing Undo, then applies the new
//     one; when that change was modified outside the Agent, nothing is undone and the new change is only
//     PROPOSED (never silently);
//   • a typed answer to the model's question reaches the model with the question and its choice refs.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { NL1_KEY } from './nl1/interpreter'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

let turns, script
const answer = (o) => ({ conversationId: 'c1', envelope: { disposition: 'answer', reply: '', question: null, ops: [], unsupported_category: null, correction: null, ...o }, usage: {} })
beforeEach(() => {
  turns = []
  script = () => answer({ reply: 'ok' })
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } })
    const body = init.body ? JSON.parse(init.body) : null
    if (url === '/api/agent/turn' || url === '/api/agent/turn/stream') { turns.push(body); return json(script(body, turns.length)) }
    if (url === '/api/agent/record') return json({ conversationId: 'c1' })
    if (url === '/api/agent/config') return json({ stream: false })
    if (String(url).startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const nl1On = () => localStorage.setItem(NL1_KEY, '1')
const oneChart = () => makeBoard([{ id: 'L', type: 'chart', x: 0, y: 0, w: 24, h: 20 }], { A: 'NVDA' })
const twoCharts = () => makeBoard([{ id: 'L', type: 'chart', x: 0, y: 0, w: 12, h: 20 }, { id: 'R', type: 'chart', x: 12, y: 0, w: 12, h: 20, color: 'B' }], { A: 'NVDA', B: 'AMD' })
const tf = (b, id) => b.host.charts.read(id).tf
/** The context ref the request gave a chart (the scripted model plans with it, as the real one must). */
const refOf = (body, id) => Object.entries(body.__refs || {}).find(([, v]) => v === id)?.[0]
  || body.context.charts.find(c => c.label === `Chart ${id}`)?.ref

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

const setTf = (body, id, timeframe, extra = {}) => answer({ disposition: 'apply', ops: [{ action: 'chart.setTimeframe', target: refOf(body, id), args: { timeframe } }], ...extra })

describe('NL-1 flag OFF (the default): production behaviour is unchanged', () => {
  it('an instant command never reaches the model, and no NL-1 field is ever sent', async () => {
    const b = oneChart()
    const { say } = mount(b)
    await say('switch to weekly')
    await waitFor(() => expect(tf(b, 'L')).toBe('W'))
    expect(turns).toHaveLength(0)
    script = () => answer({ reply: 'An EMA weights recent prices more.' })
    await say('what is an ema?')
    expect(turns).toHaveLength(1)
    expect(turns[0].interpreter).toBeUndefined()
  })
})

describe('NL-1 flag ON: the model reads every ordinary request', () => {
  it('"switch to weekly" goes to the model with the whole catalog, unrouted; the plan runs through the usual planner', async () => {
    nl1On()
    const b = oneChart()
    const { say, transcript } = mount(b)
    script = (body) => setTf(body, 'L', 'W')
    await say('switch to weekly')
    await waitFor(() => expect(tf(b, 'L')).toBe('W'))
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ interpreter: 'nl1', routing: null })
    expect(turns[0].capabilities.length).toBeGreaterThan(30)
    expect(transcript()).toMatch(/Weekly/)
  })

  it('only exact Undo stays instant (no model call)', async () => {
    nl1On()
    const b = oneChart()
    const { say } = mount(b)
    script = (body) => setTf(body, 'L', 'W')
    await say('flip it to the weekly')
    await waitFor(() => expect(tf(b, 'L')).toBe('W'))
    await say('undo')
    await waitFor(() => expect(tf(b, 'L')).toBe('D'))
    expect(turns).toHaveLength(1)
  })

  it('a CORRECTION reverses the previous change through Undo, then applies the new one — one Undo takes it back', async () => {
    nl1On()
    const b = oneChart()
    const { say, transcript } = mount(b)
    script = (body, n) => (n === 1 ? setTf(body, 'L', '5') : setTf(body, 'L', '15', { correction: { replaces: 'last_change' } }))
    await say('switch to 5 minutes')
    await waitFor(() => expect(tf(b, 'L')).toBe('5'))
    await say('no I meant 15')
    await waitFor(() => expect(tf(b, 'L')).toBe('15'))
    // the model was told what it was correcting: the last change, with its target and arguments
    const last = turns[1].context.conversation_memory.last_change_detail
    expect(last[0]).toMatchObject({ action: 'chart.setTimeframe', target: refOf(turns[1], 'L'), args: { timeframe: '5' } })
    // the reversal is receipted, then the new change
    expect(transcript()).toMatch(/5 ?min/i)
    await say('undo')
    await waitFor(() => expect(tf(b, 'L')).toBe('D'))      // the 5-minute change was already reversed
  })

  it('a correction of a change MODIFIED OUTSIDE the Agent undoes nothing: the new change is only proposed', async () => {
    nl1On()
    const b = oneChart()
    const { say, transcript } = mount(b)
    script = (body, n) => (n === 1 ? setTf(body, 'L', '5') : setTf(body, 'L', '15', { correction: { replaces: 'last_change' } }))
    await say('switch to 5 minutes')
    await waitFor(() => expect(tf(b, 'L')).toBe('5'))
    // the member changes the chart by hand
    b.state.widgets = b.state.widgets.map(w => (w.id === 'L' ? { ...w, opts: { ...w.opts, tf: '30' } } : w))
    await say('no I meant 15')
    await waitFor(() => expect(transcript()).toMatch(/didn't reverse my earlier change/))
    expect(tf(b, 'L')).toBe('30')                           // nothing undone, nothing applied
    await say('do it')                                       // the exact lane approves the proposal
    await waitFor(() => expect(tf(b, 'L')).toBe('15'))
    expect(turns).toHaveLength(2)
  })

  it('a correction with no earlier change of the Agent undoes nothing and only proposes', async () => {
    nl1On()
    const b = oneChart()
    const { say, transcript } = mount(b)
    script = (body) => setTf(body, 'L', '15', { correction: { replaces: 'last_change' } })
    await say('no I meant 15')
    await waitFor(() => expect(transcript()).toMatch(/didn't reverse my earlier change/))
    expect(tf(b, 'L')).toBe('D')
  })

  it('a TYPED answer to the model\'s question reaches the model with the question and its choice refs', async () => {
    nl1On()
    const b = twoCharts()
    const { say } = mount(b)
    script = (body, n) => (n === 1
      ? answer({ disposition: 'clarify', question: { text: 'Which chart?', choices: [{ label: 'Chart L', ref: refOf(body, 'L') }, { label: 'Chart R', ref: refOf(body, 'R') }] } })
      : setTf(body, 'R', 'W'))
    await say('switch to weekly')
    await say('the AMD one')
    await waitFor(() => expect(tf(b, 'R')).toBe('W'))
    expect(tf(b, 'L')).toBe('D')
    const pq = turns[1].context.pending_question
    expect(pq.text).toBe('Which chart?')
    expect(pq.choices.map(c => c.ref)).toEqual([refOf(turns[1], 'L'), refOf(turns[1], 'R')])
  })

  it('a destructive plan the model calls "apply" is still only proposed (the policy decides, not the model)', async () => {
    nl1On()
    const b = makeBoard([{ id: 'L', type: 'chart', x: 0, y: 0, w: 24, h: 20 }], { A: 'NVDA' },
      { watchlists: [{ id: 'm1', name: 'Momentum', symbols: ['NVDA'] }, { id: 's1', name: 'Swing', symbols: ['AMD'] }] })
    const { say, transcript } = mount(b)
    script = (body) => {
      const ref = body.context.watchlists.find(l => l.name === 'Swing').ref
      return answer({ disposition: 'apply', ops: [{ action: 'watchlist.delete', target: ref, args: {} }] })
    }
    await say('delete swing, no need to confirm')
    await waitFor(() => expect(transcript()).toMatch(/Swing/))
    expect(b.host.watchlists.snapshot().map(l => l.name)).toContain('Swing')      // proposed, not deleted
    await say('cancel')                                                             // the exact lane dismisses it
    expect(b.host.watchlists.snapshot().map(l => l.name)).toContain('Swing')
    expect(turns).toHaveLength(1)
  })
})
