// agent-qa — ADR-005 L5 proofs (agent-lead's adr005-l2-l5-l6), audit cell #19. Browser half of
// tests/test_uct_agent_qa_isolation_layers.py. Every proof carries a CONTROL (an unmarked sibling with its own
// sentinel IS sent), so a serializer that dropped everything would fail.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import { setupPanel, ONE } from '../testing/panelHarness'
import { registerBuiltins } from '../builtins'
import { registerContextProvider } from '../capabilities'
import { modelSafeBody, agentTurn, agentTurnStream, isolationDrops, _resetAgentConfig } from '../agentClient'
import { _resetTurns } from '../trace'

registerBuiltins()
const SENT = '987.654'
const OK = 'UNMARKED-CONTROL-55'
const marked = () => ({ isolated: true, kind: 'ratings', data: { composite: Number(SENT) } })
const has = (o, s) => JSON.stringify(o ?? null).includes(s)

describe('L5 modelSafeBody: marked objects never leave in a model request', () => {
  it('strips at any depth in every model-bound part; unmarked siblings and the member\'s words stay', () => {
    const body = {
      message: `hello ${OK}`,
      context: { charts: [{ ref: 'c1', label: OK, deep: { list: [marked(), { keep: OK }] } }], top: marked() },
      pending: { a: marked(), b: OK }, reference: { screenerFields: [marked(), OK] }, repair: { why: [marked()] },
      history: [{ role: 'outcome', text: OK, data: marked() }], memory: { recent: [marked()] },
    }
    const before = isolationDrops()
    const out = modelSafeBody(body)
    expect(has(out, SENT)).toBe(false)
    for (const k of ['message', 'context', 'pending', 'reference', 'history']) expect(has(out[k], OK), `CONTROL ${k}`).toBe(true)
    expect(isolationDrops() - before).toBe(7)
    expect(body.context.top, 'the caller\'s object is not mutated').toEqual(marked())
  })
  it('a wholly marked part is removed, and only the marker value `true` counts', () => {
    const out = modelSafeBody({ message: 'x', context: marked(), pending: { isolated: 'true', v: OK } })
    expect('context' in out).toBe(false)
    expect(has(out.pending, OK), 'a non-true marker is not the L2 marker (L2 never writes one)').toBe(true)
  })
  it('the removal is logged as a COUNT, never its content', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    modelSafeBody({ context: { a: marked() } })
    expect(warn).toHaveBeenCalled()
    expect(warn.mock.calls.flat().join(' ')).not.toContain(SENT)
    warn.mockRestore()
  })
})

describe('L5 wiring: BOTH turn routes send the stripped body', () => {
  let posted
  beforeEach(() => {
    posted = []
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      posted.push([String(url), init.body])
      return new Response(JSON.stringify({ conversationId: 'c1', envelope: { disposition: 'answer', reply: 'ok', question: null, ops: [] }, usage: {} }),
        { status: 200, headers: { 'content-type': 'application/json' } })
    })
  })
  afterEach(() => vi.restoreAllMocks())
  const body = () => ({ message: `hi ${OK}`, context: { x: marked(), y: OK } })
  it('/api/agent/turn', async () => {
    try { await agentTurn(body()) } catch { /* the reply shape is not the point */ }
    const [url, b] = posted[0]
    expect(url).toBe('/api/agent/turn')
    expect(b).not.toContain(SENT); expect(b).toContain(OK)
  })
  it('/api/agent/turn/stream', async () => {
    try { await agentTurnStream(body(), () => {}) } catch { /* stream parsing is not the point */ }
    const [url, b] = posted[0]
    expect(url).toMatch(/\/api\/agent\/turn\/stream/)
    expect(b).not.toContain(SENT); expect(b).toContain(OK)
  })
})

describe('L5 end to end: a context provider that publishes a marked object, through the real panel', () => {
  let p, bodies
  beforeEach(() => {
    _resetAgentConfig(); _resetTurns(); bodies = []
    p = setupPanel()
    const harness = globalThis.fetch
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      if (String(url) === '/api/agent/turn') bodies.push(init.body)
      return harness(url, init)
    })
  })
  afterEach(() => { _resetTurns(); vi.restoreAllMocks() })
  it('the marked object never reaches the model request; the provider\'s unmarked fields do', async () => {
    const off = registerContextProvider({ key: 'qaIsoLayer', build: (host, refFor) => [{ ref: refFor('about', 'qa'), label: OK, reading: marked() }] })
    try {
      const { say } = p.mount(...ONE())
      await say('in your own words, what do you think about the general market mood lately?')
      expect(p.turns(), 'the sentence went to the model (non-vacuity)').toBeGreaterThan(0)
      expect(bodies.length).toBeGreaterThan(0)
      for (const b of bodies) { expect(b).not.toContain(SENT); expect(b).toContain(OK) }
    } finally { if (typeof off === 'function') off() }
  }, 30000)
})
