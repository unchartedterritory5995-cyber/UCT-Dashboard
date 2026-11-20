// app/src/components/chart/builder/authoring/browserRepair.test.js
//
// ⭐ 2026-11-17 — THE BROWSER'S OWN REFUSAL, SENT BACK FOR ONE REPAIR.
//
// The door checks a patch's structure; this engine applies it and holds rules of its own. Six
// times in one day a request the assistant had built ended in "Nothing was changed" because the
// door offered a patch this engine refused, and a sweep then measured the class at about a third
// of schema-valid one-operation patches. So the refused turn goes back ONCE with the patch and
// this engine's own words, and the member reads the repaired result.
//
// Pinned here: the second request carries the refused patch and the engine's words; the repaired
// patch is applied in the same member turn; there is never a third request; a stopped turn, an
// ordinary door refusal and a turn that needed no repair are untouched; and when the repair
// itself cannot be had, the member reads this engine's refusal, not the door's.
import { describe, it, expect } from 'vitest'
import { newAuthoringState } from './index'
import { modelTurn, NOTHING_CHANGED } from './authoringSession'
import { converseBody, browserRefusalBlock, BROWSER_REFUSAL_LIMITS } from './converseClient'

const num = (value) => ({ type: 'num', value })
const S = (name) => ({ type: 'series', name })
const EMA = { type: 'call', name: 'ema', args: [S('close'), num(10)] }
const ABOVE = { type: 'op', name: '>', args: [S('close'), EMA] }
const env = (ops, rev = 0) => ({ contract: 'uct.authoring.patch/1', baseRevision: rev, disposition: 'change', reply: 'Done.', ops })
const change = (ops, rev = 0) => ({ ok: true, disposition: 'change', reply: 'Done.', turn: 'patch', envelope: env(ops, rev), notUnderstood: [], unavailable: [] })
const LINE = { op: 'create', name: 'Average', placement: 'price', outputs: [{ key: 'ema', tree: EMA }] }
// the door accepts this; this engine refuses it: a candle colour reads a yes/no
const BAD = [LINE, { op: 'set_paint', output: 'ema', channel: 'barcolor', color: '#089981' }]
const GOOD = [
  { op: 'create', name: 'Average', placement: 'price', outputs: [{ key: 'ema', tree: EMA }, { key: 'above', tree: ABOVE, hidden: true }] },
  { op: 'set_paint', output: 'above', channel: 'barcolor', color: '#089981' },
]
const CTX = { symbol: 'TEST', tf: 'D' }
const WORDS = 'A 10 EMA, and colour the candles green above it'

/** A door that answers from a list and records what it was asked. */
function door(answers) {
  const asked = []
  const converse = async (args) => {
    asked.push(args)
    if (!answers.length) throw new Error(`the door was asked ${asked.length} times; armed fewer`)
    const next = answers.shift()
    return typeof next === 'function' ? next(args) : next
  }
  return { converse, asked }
}

const turn = (st, d, extra = {}) => modelTurn(st, () => st, WORDS, { gateCtx: CTX, converse: d.converse, ...extra })

describe('the premise', () => {
  it('this engine refuses the patch, with words of its own', async () => {
    const st = newAuthoringState()
    const d = door([change(BAD), { ok: false, gate: 'network', reason: 'offline' }])
    const out = await turn(st, d)
    expect(out).toMatchObject({ ok: false, state: null, changed: false })
    expect(out.entries[0].kind).toBe('refusal')
    expect(out.entries[0].lines.at(-1)).toBe(NOTHING_CHANGED)
    expect(out.entries[0].lines[0]).toMatch(/yes\/no/)
  })
})

describe('one repair, with this engine\'s own words', () => {
  it('the refused turn goes back once and the repaired patch is applied', async () => {
    const st = newAuthoringState()
    const d = door([change(BAD), change(GOOD)])
    const out = await turn(st, d)
    expect(d.asked).toHaveLength(2)
    expect(out).toMatchObject({ ok: true, changed: true, repairedAfterRefusal: true })
    expect(out.entries[0].kind).toBe('created')
    expect(out.state.revision).toBe(1)                                       // ONE revision: the refused patch left no trace
    expect(JSON.stringify(out.state.working)).toContain('"above"')
    // the first request carried no refusal; the second carries the patch and the engine's words
    expect(d.asked[0].browserRefusal).toBeUndefined()
    const sent = d.asked[1].browserRefusal
    expect(sent.envelope.ops).toEqual(BAD)
    expect(sent.errors).toHaveLength(1)
    expect(sent.errors[0]).toMatch(/^[a-z:_-]+: .*yes\/no/i)                 // code: the engine's sentence
    // the same member words, the same starting state
    expect(d.asked[1].message).toBe(WORDS)
    expect(d.asked[1].state).toBe(st)
  })

  it('never a third request: a repair this engine refuses too is what the member reads', async () => {
    const st = newAuthoringState()
    const worse = [LINE, { op: 'set_fill', output: 'ema', with: 'missing', color: '#089981' }]
    const d = door([change(BAD), change(worse)])
    const out = await turn(st, d)
    expect(d.asked).toHaveLength(2)
    expect(out).toMatchObject({ ok: false, state: null, changed: false })
    expect(out.entries[0].kind).toBe('refusal')
    expect(out.entries[0].lines.at(-1)).toBe(NOTHING_CHANGED)
    expect(out.repairedAfterRefusal).toBe(true)
  })

  it('when the repair cannot be had, the member reads this engine\'s refusal, not the door\'s', async () => {
    for (const refusedRepair of [
      { ok: false, gate: 'cost:user', reason: 'allowance used' },
      { ok: false, gate: 'network', reason: 'offline' },
      { ok: false, gate: 'http:429', reason: 'slow down' },
    ]) {
      const st = newAuthoringState()
      const d = door([change(BAD), refusedRepair])
      const out = await turn(st, d)
      expect(d.asked).toHaveLength(2)
      expect(out).toMatchObject({ ok: false, state: null, changed: false })
      expect(out.entries[0].kind).toBe('refusal')
      expect(out.entries[0].lines[0]).toMatch(/yes\/no/)
      expect(out.entries[0].lines.join(' ')).not.toMatch(/allowance|offline|slow down/)
      expect(out.gate).toBeUndefined()
    }
  })

  it('a repair turn that asks or explains instead is what the member reads', async () => {
    const st = newAuthoringState()
    const d = door([change(BAD), { ok: true, disposition: 'unsupported', reply: 'Candles can only be coloured by a yes/no.', turn: 'noop', envelope: null }])
    const out = await turn(st, d)
    expect(d.asked).toHaveLength(2)
    expect(out.entries[0].kind).toBe('unsupported')
    expect(out.entries[0].lines[0]).toBe('Candles can only be coloured by a yes/no.')
  })

  it('a member who stopped waiting is not asked again', async () => {
    const st = newAuthoringState()
    const gone = new AbortController()
    const d = door([() => { const a = change(BAD); gone.abort(); return a }])
    const out = await turn(st, d, { signal: gone.signal })
    expect(d.asked).toHaveLength(1)
    expect(out).toMatchObject({ stopped: true, changed: false })
  })
})

describe('what is not repaired', () => {
  it('a patch this engine applies costs one request', async () => {
    const st = newAuthoringState()
    const d = door([change(GOOD)])
    const out = await turn(st, d)
    expect(d.asked).toHaveLength(1)
    expect(out).toMatchObject({ ok: true, changed: true })
    expect(out.repairedAfterRefusal).toBeUndefined()
  })
  it('the door\'s own refusal, an answer and a question each cost one request', async () => {
    for (const answer of [
      { ok: false, gate: 'envelope:reference', reason: 'the assistant\'s change named a part that does not exist' },
      { ok: true, disposition: 'answer', reply: 'An EMA is an average.', turn: 'noop', envelope: null },
    ]) {
      const st = newAuthoringState()
      const d = door([answer])
      await turn(st, d)
      expect(d.asked).toHaveLength(1)
    }
  })
})

describe('what goes on the wire', () => {
  const st = newAuthoringState()
  it('an ordinary turn has no refusal block', () => {
    expect('browser_refusal' in converseBody({ message: WORDS, state: st, gateCtx: CTX })).toBe(false)
    for (const junk of [null, undefined, 'no', {}, { envelope: env(BAD) }, { envelope: env(BAD), errors: [] }, { envelope: env(BAD), errors: [7, '   '] }, { errors: ['x'] }]) {
      expect(browserRefusalBlock(junk)).toBeNull()
      expect('browser_refusal' in converseBody({ message: WORDS, state: st, gateCtx: CTX, browserRefusal: junk })).toBe(false)
    }
  })
  it('the block is the patch and bounded, flattened words', () => {
    const many = ['line one\nline two\t\ttabbed   spaced', 'x'.repeat(5000), ...Array.from({ length: 9 }, (_, i) => `extra ${i}`)]
    const body = converseBody({ message: WORDS, state: st, gateCtx: CTX, browserRefusal: { envelope: env(BAD), errors: many } })
    expect(body.browser_refusal.envelope.ops).toEqual(BAD)
    expect(body.browser_refusal.errors).toHaveLength(BROWSER_REFUSAL_LIMITS.maxErrors)
    expect(body.browser_refusal.errors[0]).toBe('line one line two tabbed spaced')
    expect(body.browser_refusal.errors[1]).toBe('x'.repeat(BROWSER_REFUSAL_LIMITS.maxChars))
    expect(BROWSER_REFUSAL_LIMITS).toEqual({ maxErrors: 4, maxChars: 300 })
  })
})
