// UCT Agent — P2-A2: the turn-reply boundary (owner authorization 2026-10-25).
// A 2xx from /api/agent/turn is not a turn: an empty or non-JSON body, a reply with no envelope, an unknown
// disposition or ops that are not a list of actions used to reach useAgent as `{ok: true}` and throw a
// TypeError there (the panel went quiet, nothing said). agentClient.turnReply now fails such a reply as an
// ordinary failed turn: the member sees UCT's error, NOTHING runs from it, and the next message works.
// No paid model: the "server" is scripted through the real panel (AgentPanel → useAgent → planner → runtime).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { NL1_KEY } from './nl1/interpreter'
import { loadAgentConfig, _resetAgentConfig, turnReply, agentTurn, agentTurnStream } from './agentClient'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

const FAILED = /couldn't complete that request\. No changes were made/
let turns, script, server
const answer = (o) => ({ conversationId: 'c1', envelope: { disposition: 'answer', reply: '', question: null, ops: [], unsupported_category: null, correction: null, ...o }, usage: {} })
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } })
const sse = (events) => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } })
beforeEach(() => {
  turns = []
  server = { stream: false, nl1: false }
  script = () => answer({ reply: 'ok' })
  _resetAgentConfig()
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    if (url === '/api/agent/turn' || url === '/api/agent/turn/stream') {
      turns.push(body)
      const out = await script(body, turns.length, url)
      if (out instanceof Response) return out
      return url === '/api/agent/turn/stream' ? sse([{ t: 'final', ...out }]) : json(out)
    }
    if (url === '/api/agent/record') return json({ conversationId: 'c1' })
    if (url === '/api/agent/config') return json(server)
    if (String(url).startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const nl1On = async () => { server = { ...server, nl1: true }; localStorage.setItem(NL1_KEY, '1'); await loadAgentConfig() }
const streamOn = async () => { server = { ...server, stream: true }; await loadAgentConfig() }
const oneChart = () => makeBoard([{ id: 'L', type: 'chart', x: 0, y: 0, w: 24, h: 20 }], { A: 'NVDA' })
const tf = (b, id) => b.host.charts.read(id).tf
const refOf = (body, id) => Object.entries(body.__refs || {}).find(([, v]) => v === id)?.[0]
  || body.context.charts.find(c => c.label === `Chart ${id}`)?.ref
const weeklyOp = (body) => ({ action: 'chart.setTimeframe', target: refOf(body, 'L'), args: { timeframe: 'W' } })
const setTf = (body, timeframe) => answer({ disposition: 'apply', ops: [{ ...weeklyOp(body), args: { timeframe } }] })

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
  return { say, transcript, box }
}

// Each reply a real UCT server never sends (its gate, turn.sanitize_envelope, always sends a disposition
// from its list and ops as a list of actions) — but an edge page, a proxy or a broken deploy can.
const BAD = {
  'an empty 200 body': () => new Response('', { status: 200, headers: { 'content-type': 'application/json' } }),
  'an HTML page with 200': () => new Response('<!doctype html><title>UCT</title>', { status: 200, headers: { 'content-type': 'text/html' } }),
  'JSON null': () => json(null),
  'JSON with no envelope (the plan at the top level)': (body) => json({ conversationId: 'c1', disposition: 'apply', ops: [weeklyOp(body)] }),
  'an envelope that is null': () => json({ conversationId: 'c1', envelope: null }),
  'an envelope that is a list': (body) => json({ conversationId: 'c1', envelope: [weeklyOp(body)] }),
  'an unknown disposition carrying a plan': (body) => json(answer({ disposition: 'execute', ops: [weeklyOp(body)] })),
  'no disposition carrying a plan': (body) => json(answer({ disposition: undefined, ops: [weeklyOp(body)] })),
  'ops that are one object, not a list': (body) => json(answer({ disposition: 'apply', ops: weeklyOp(body) })),
  'a null op inside the plan': (body) => json(answer({ disposition: 'apply', ops: [weeklyOp(body), null] })),
  'an op with no action': (body) => json(answer({ disposition: 'apply', ops: [{ target: refOf(body, 'L'), args: { timeframe: 'W' } }] })),
  'question choices that are not a list': () => json(answer({ disposition: 'clarify', question: { text: 'Which?', choices: 'L' } })),
}

describe('turnReply — the boundary, case by case (deterministic)', () => {
  const ok = (data) => turnReply({ ok: true, data })
  it('a valid reply of every disposition passes through untouched', () => {
    for (const d of ['answer', 'clarify', 'apply', 'propose', 'unsupported']) {
      const r = answer({ disposition: d, reply: 'x', ops: d === 'apply' || d === 'propose' ? [{ action: 'chart.setTimeframe', target: 'c1', args: {} }] : [] })
      expect(ok(r)).toEqual({ ok: true, data: r })
    }
    // the server's "needs more of UCT" reply and a clarify with no question are valid too
    expect(ok(answer({ disposition: 'clarify', reply: '', question: { text: 'Looking at more of UCT…', choices: [] }, need_groups: ['alerts'] })).ok).toBe(true)
    expect(ok(answer({ disposition: 'clarify', reply: 'Which one?', question: null })).ok).toBe(true)
  })
  it('a genuine server failure is returned as it was (status and detail kept)', () => {
    const fail = { ok: false, status: 429, error: 'You have used today\'s Agent allowance.' }
    expect(turnReply(fail)).toBe(fail)
  })
  it.each([
    ['no data', undefined], ['null data', null], ['a string', 'ok'], ['no envelope', { conversationId: 'c1' }],
    ['an envelope string', { envelope: 'apply' }], ['an unknown disposition', answer({ disposition: 'run' })],
    ['ops as an object', answer({ disposition: 'apply', ops: { action: 'chart.setTimeframe' } })],
    ['an op without an action', answer({ disposition: 'apply', ops: [{ target: 'c1' }] })],
    ['a reply that is not text', answer({ reply: { text: 'hi' } })],
    ['a question that is text', answer({ disposition: 'clarify', question: 'Which?' })],
    ['need_groups that are not a list', answer({ disposition: 'clarify', need_groups: 'alerts' })],
    ['a conversation id that is not text', { ...answer({ reply: 'x' }), conversationId: 7 }],
  ])('%s → a failed turn, with UCT\'s own words', (_, data) => {
    const r = ok(data)
    expect(r).toMatchObject({ ok: false, malformed: true })
    expect(r.error).toMatch(FAILED)
  })
  it('both transports apply it: /turn and the stream\'s final event', async () => {
    script = () => json({ conversationId: 'c1' })
    expect(await agentTurn({})).toMatchObject({ ok: false, malformed: true })
    script = () => sse([{ t: 'status', stage: 'thinking' }, { t: 'final', conversationId: 'c1', envelope: { disposition: 'apply', ops: 'x' } }])
    expect(await agentTurnStream({})).toMatchObject({ ok: false, malformed: true })
    script = () => sse([{ t: 'final', ...answer({ reply: 'fine' }) }])
    expect(await agentTurnStream({})).toMatchObject({ ok: true, data: { envelope: { reply: 'fine' } } })
  })
})

describe('through the real panel: an invalid reply fails safely and changes nothing', () => {
  for (const lane of ['legacy', 'NL-1', 'streaming']) {
    describe(lane, () => {
      beforeEach(async () => {
        if (lane === 'NL-1') await nl1On()
        if (lane === 'streaming') await streamOn()
      })
      it.each(Object.keys(BAD))('%s → UCT\'s error, the chart untouched, and the next message works', async (kind) => {
        const b = oneChart()
        const { say, transcript, box } = mount(b)
        script = (body) => {
          const r = BAD[kind](body)
          // the streamed lane receives the same body inside the stream's final event
          if (lane !== 'streaming') return r
          return r.headers.get('content-type') === 'application/json'
            ? r.text().then(t => { let d; try { d = JSON.parse(t) } catch { d = undefined } return sse([{ t: 'final', ...(d && typeof d === 'object' && !Array.isArray(d) ? d : { envelope: d }) }]) })
            : r
        }
        await say('set this chart up for swing trading')
        await waitFor(() => expect(transcript()).toMatch(FAILED))
        expect(turns.length).toBeGreaterThanOrEqual(1)
        expect(tf(b, 'L')).toBe('D')                          // nothing ran from the invalid reply
        expect(transcript()).not.toMatch(/Undo/)              // no receipt, nothing to undo
        expect(box.disabled).toBe(false)                      // the panel is not stuck
        // a valid reply right after is planned, applied, receipted and undoable as always
        script = (body) => setTf(body, 'W')
        await say('make it weekly please')
        await waitFor(() => expect(tf(b, 'L')).toBe('W'))
        await say('undo')
        await waitFor(() => expect(tf(b, 'L')).toBe('D'))
      })
    })
  }

  it('a valid apply still runs exactly once, with its receipt (no behaviour change)', async () => {
    const b = oneChart()
    const { say } = mount(b)
    script = (body) => setTf(body, 'W')
    await say('set this chart up for swing trading')
    await waitFor(() => expect(tf(b, 'L')).toBe('W'))
    expect(turns).toHaveLength(1)
  })

  it('a valid proposal still waits for approval', async () => {
    const b = oneChart()
    const { say } = mount(b)
    script = (body) => answer({ disposition: 'propose', ops: [weeklyOp(body)] })
    await say('set this chart up for swing trading')
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Apply|Confirm/ }).length).toBeGreaterThan(0))
    expect(tf(b, 'L')).toBe('D')
  })

  it('NL-1 repair: an invalid repair reply keeps the refused first plan refused — nothing changes, no crash', async () => {
    await nl1On()
    const b = oneChart()
    const { say, transcript } = mount(b)
    // the first plan asks for a timeframe UCT refuses (so the browser asks for ONE repair); the repair is garbage
    script = (body, n) => (n === 1 ? setTf(body, '7') : json({ conversationId: 'c1', envelope: { disposition: 'apply', ops: [null] } }))
    await say('make it 7')
    await waitFor(() => expect(transcript()).toMatch(/didn't change anything/i))
    expect(turns).toHaveLength(2)                             // still the two-call ceiling
    expect(tf(b, 'L')).toBe('D')
  })

  it('NL-1 reroute: an invalid reply to the reroute is a failed turn, not a crash', async () => {
    await nl1On()
    const b = oneChart()
    const { say, transcript } = mount(b)
    script = (body, n) => (n === 1
      // the model asks for a group it was not given (the server's sanitize_envelope reply) — then garbage
      ? { ...answer({ disposition: 'clarify', reply: '', question: { text: 'Looking at more of UCT…', choices: [] }, need_groups: ['workspace'] }), usage: { model_calls: 1 } }
      : new Response('', { status: 200, headers: { 'content-type': 'application/json' } }))
    await say('give me one more of these')
    await waitFor(() => expect(transcript()).toMatch(FAILED))
    expect(turns).toHaveLength(2)
    expect(turns[1]).toMatchObject({ reroute: true })
    expect(b.state.widgets.filter(w => w.type === 'chart')).toHaveLength(1)    // no chart was added
    expect(tf(b, 'L')).toBe('D')
  })
})
