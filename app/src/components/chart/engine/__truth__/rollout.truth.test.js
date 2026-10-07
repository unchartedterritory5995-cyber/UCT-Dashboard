// app/src/components/chart/engine/__truth__/rollout.truth.test.js
//
// ⭐ CONTROLLED MEMBER ROLLOUT — what a member sees when a turn cannot run, and
// proof that a temporary outage (the ~2-minute Railway swap 502s P3S measured) is
// SAFE: no partial patch, no revision move, no save, retry works.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { parseFormula } from '../ast/parse'
import { clearUserDefinitions } from '../nativeRegistry'
import { memberRefusal } from '../../builder/authoring/memberWords'
import { converseTurn } from '../../builder/authoring/converseClient'
import { newAuthoringState } from '../../builder/authoring/authoringState'
import useIndicatorConversation from '../../builder/studio/useIndicatorConversation'

const C = 'uct.authoring.patch/1'
const FORBIDDEN = /\b(429|5\d\d|500|502|503|anthropic|provider|ledger|reserve|schema|envelope|emit|formula assistant|budget|http)\b/i

describe('memberRefusal — every refusal a member can meet, in member words', () => {
  const SERVER = {
    'cost:user': 'you have used up today\'s allowance of the formula assistant',
    'cost:global': 'the formula assistant has reached its spending limit for today',
    'model:transport': 'the formula assistant could not be reached',
    'model:no-tool': 'the assistant replied without emitting a formula',
    'internal:error': 'the formula assistant hit an internal problem and drafted nothing',
    'envelope:schema': "the assistant's change did not follow the change format",
    'envelope:revision': "the assistant's change was written against a different version",
    'http:429': 'At most 40 indicator proposals per hour. Try again in 812s.',
    'http:502': 'The assistant could not answer (502).',
    'http:503': 'The assistant could not answer (503).',
    'http:500': 'The assistant could not answer (500).',
    'http:0': 'The assistant could not answer (0).',
    network: 'Could not reach the server — check your connection and try again.',
  }
  it.each(Object.entries(SERVER))('%s → no status code, provider, ledger or schema talk', (gate, reason) => {
    const words = memberRefusal(gate, reason)
    expect(words).toBeTruthy()
    expect(words).not.toMatch(FORBIDDEN)
    expect(words).not.toBe(reason)
  })
  it('the daily allowance never promises a precise time', () => {
    expect(memberRefusal('cost:user')).not.toMatch(/\d{1,2}(:\d\d)?\s?(am|pm)|midnight|in \d+ (hours|minutes)/i)
    expect(memberRefusal('cost:user')).toMatch(/renews each day/)
  })
  it("a gate whose reason is already member language keeps it (another symbol, an unknown concept)", () => {
    const r = 'This asks for SPY, another symbol. Conversational authoring draws on the chart\'s own symbol and bars only, so it can\'t read SPY here.'
    expect(memberRefusal('unsupported:other-symbol', r)).toBe(r)
  })
})

describe('a temporary outage is SAFE and RETRYABLE (studio hook)', () => {
  afterEach(() => { clearUserDefinitions() })
  const createEma = (rev) => ({ contract: C, baseRevision: rev, disposition: 'change', ops: [{ op: 'create', name: 'EMA 20', outputs: [{ key: 'ema20', tree: parseFormula('ema(close, 20)').ast }] }] })
  const setLen = (rev, n) => ({ contract: C, baseRevision: rev, disposition: 'change', ops: [{ op: 'set_slot', slot: 'ema20#1', value: n }] })

  it.each([
    ['a 502 during a deploy swap', { ok: false, status: 502, json: async () => ({ detail: 'Bad Gateway' }) }],
    ['a 503', { ok: false, status: 503, json: async () => { throw new Error('not json') } }],
    ['the network dropping', null],
    ['the daily allowance', { ok: true, status: 200, json: async () => ({ ok: false, gate: 'cost:user', reason: "you have used up today's allowance of the formula assistant" }) }],
    ['the shared capacity', { ok: true, status: 200, json: async () => ({ ok: false, gate: 'cost:global', reason: 'the formula assistant has reached its spending limit for today' }) }],
    ['the model failing twice', { ok: true, status: 200, json: async () => ({ ok: false, gate: 'envelope:schema', reason: "the assistant's change did not follow the change format" }) }],
  ])('%s: nothing changes, the member is told plainly, and the retry applies', async (_label, failure) => {
    let mode = 'ok'
    const fetchImpl = vi.fn(async (_u, init) => {
      const body = JSON.parse(init.body)
      if (mode === 'fail') {
        if (failure === null) throw new TypeError('Failed to fetch')
        return failure
      }
      const env = body.view.definition ? setLen(body.view.revision, 50) : createEma(body.view.revision)
      return { ok: true, status: 200, json: async () => ({ ok: true, disposition: 'change', reply: '', turn: 'patch', envelope: env }) }
    })
    const converse = (args) => converseTurn({ ...args, fetchImpl })
    const { result } = renderHook(() => useIndicatorConversation({ sym: 'XRPN', tf: 'D', converse }))
    await act(async () => { await result.current.send('Add a 20 EMA.') })
    const before = result.current.state
    mode = 'fail'
    await act(async () => { await result.current.send('Make it 50.') })
    expect(result.current.state).toBe(before)                       // ⛔ no partial patch, no revision move
    const entry = result.current.transcript.at(-1)
    expect(entry.lines.join(' ')).not.toMatch(FORBIDDEN)
    expect(entry.lines.join(' ')).toMatch(/Nothing on the chart changed/)
    mode = 'ok'
    await act(async () => { await result.current.send('Make it 50.') })   // the retry
    expect(result.current.transcript.at(-1).kind).toBe('patched')
    expect(result.current.state.revision).toBe(before.revision + 1)
    expect(JSON.stringify(result.current.state.working)).toContain('"value":50')
  })

  it('a failure never writes: no save request is made by a refused turn', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }))
    const state = newAuthoringState()
    const res = await converseTurn({ message: 'x', state, fetchImpl })
    expect(res.ok).toBe(false)
    expect(fetchImpl.mock.calls.every(([url]) => String(url).endsWith('/converse'))).toBe(true)
  })
})
