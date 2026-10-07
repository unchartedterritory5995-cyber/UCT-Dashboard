// SLICE 2 — the deterministic half: turn outcomes, the dirty authority, the
// browser pre-flight. ASKED / CLAIMED / DID per case.
import { describe, it, expect } from 'vitest'
import CASES from './authoring/preflightCases.json'
import { preflight, GATE_SYMBOL, GATE_TIMEFRAME } from './authoring/preflight'
import { classifyTurn, OUTCOMES } from './authoring/turnOutcome'
import { newAuthoringState, openAuthoringState, applyTurn, undo, isDirty } from './authoring/authoringState'
import { converseBody } from './authoring/converseClient'

const C = 'uct.authoring.patch/1'
const close = { type: 'series', name: 'close' }
const ema = (n) => ({ type: 'call', name: 'ema', args: [close, { type: 'num', value: n }] })
const create = (n) => ({ contract: C, baseRevision: 0, ops: [{ op: 'create', name: `EMA ${n}`, placement: 'price', outputs: [{ key: 'value', tree: ema(n), label: `EMA ${n}` }] }] })

describe('pre-flight — the SAME verdicts the server gives (shared case table)', () => {
  it.each(CASES.cases.map((c) => [c.message, c.chart, c.gate]))('%s @ %j → %s', (message, chart, gate) => {
    const got = preflight(message, chart)
    expect(got ? got.gate : null).toBe(gate)
  })
  it('the refusal copy is member-safe: the ticker, never a node name or a code', () => {
    const r = preflight('Can it compare AAPL with SPY?', { sym: 'XRPN', tf: 'D' })
    expect(r.gate).toBe(GATE_SYMBOL)
    expect(r.reason).toMatch(/AAPL/)
    expect(r.reason).not.toMatch(/unsupported:|\bsym\b|node|\{/)
    const t = preflight('on the 5 minute timeframe', { sym: 'AAPL', tf: 'D' })
    expect(t.gate).toBe(GATE_TIMEFRAME)
    expect(t.reason).toBe("This asks for the 5-minute timeframe. Conversational authoring draws on the chart's own bars only, so it can't read 5-minute bars while this chart is daily.")
  })
  it('the request body carries the chart for the server pre-flight (sym + tf only)', () => {
    const body = converseBody({ message: 'x', state: newAuthoringState(), gateCtx: { symbol: 'AAPL', tf: 'D' } })
    expect(body.chart).toEqual({ sym: 'AAPL', tf: 'D' })
  })
})

describe('turn outcomes — only CHANGE ever reaches the engine', () => {
  const ok = (disposition, envelope, reply = '') => ({ ok: true, disposition, reply, envelope })
  it('answer: a reply, no envelope handed on', () => {
    const t = classifyTurn(ok('answer', { contract: C, baseRevision: 1, ops: [] }, 'It is the 20-bar EMA.'))
    expect(t).toEqual({ outcome: OUTCOMES.ANSWER, reply: 'It is the 20-bar EMA.' })
  })
  it('unsupported (model): a reply, no envelope', () => {
    expect(classifyTurn(ok('unsupported', { contract: C, baseRevision: 1, ops: [] }, 'No tables yet.')).outcome).toBe('unsupported')
  })
  it('unsupported (pre-flight / server refusal): no envelope, flagged', () => {
    const t = classifyTurn({ ok: false, gate: 'unsupported:other-symbol', reason: 'r', disposition: 'unsupported', preflight: true })
    expect(t.outcome).toBe('unsupported')
    expect(t.preflight).toBe(true)
  })
  it('clarify: questions, no ops', () => {
    const t = classifyTurn(ok('clarify', { contract: C, baseRevision: 1, ops: [], questions: [{ id: 'q', text: 'Which?' }] }))
    expect(t.outcome).toBe('clarify')
  })
  it('change: the envelope', () => {
    const env = create(20)
    expect(classifyTurn(ok('change', env, 'Added it.')).envelope).toBe(env)
  })
  it.each([
    ['answer WITH ops', ok('answer', create(20), 'x')],
    ['change WITHOUT ops', ok('change', { contract: C, baseRevision: 0, ops: [] })],
    ['answer without a reply', ok('answer', { contract: C, baseRevision: 0, ops: [] }, '  ')],
    ['unknown disposition', ok('mutate', create(20))],
  ])('a mismatch is REFUSED, never guessed: %s', (_n, res) => {
    const t = classifyTurn(res)
    expect(t.outcome).toBe(OUTCOMES.REFUSED)
    expect(t.envelope).toBeUndefined()
  })
})

describe('the dirty authority — the definition, never the transcript', () => {
  it('a new conversation is clean until a definition exists, then dirty', () => {
    const s0 = newAuthoringState()
    expect(isDirty(s0)).toBe(false)
    const s1 = applyTurn(s0, create(20)).state
    expect(isDirty(s1)).toBe(true)
  })
  it('an opened (persisted) definition is clean; a change dirties it; undo back is clean again', () => {
    const made = applyTurn(newAuthoringState(), create(20)).state.working
    const stored = { ...made, id: 'u_aaaaaaaaaaaa', version: 3 }
    const opened = openAuthoringState(stored, { defId: stored.id, version: 3 })
    expect(isDirty(opened)).toBe(false)
    const patched = applyTurn(opened, { contract: C, baseRevision: opened.revision, ops: [{ op: 'set_output_tree', output: 'value', tree: ema(50) }] }).state
    expect(isDirty(patched)).toBe(true)
    expect(isDirty(undo(patched))).toBe(false)
  })
  it('a clarify turn keeps the SAME working object (no mutation, not dirty)', () => {
    const made = applyTurn(newAuthoringState(), create(20)).state.working
    const opened = openAuthoringState({ ...made, id: 'u_b', version: 1 }, { defId: 'u_b', version: 1 })
    const q = applyTurn(opened, { contract: C, baseRevision: opened.revision, ops: [], questions: [{ id: 'q', text: 'Which?' }] })
    expect(q.result.status).toBe('question')
    expect(q.state.working).toBe(opened.working)
    expect(q.state.revision).toBe(opened.revision)
    expect(isDirty(q.state)).toBe(false)
  })
  it('a refused patch returns the SAME state object', () => {
    const s = applyTurn(newAuthoringState(), create(20)).state
    const r = applyTurn(s, { contract: C, baseRevision: 999, ops: [{ op: 'set_output_tree', output: 'value', tree: ema(50) }] })
    expect(r.result.status).toBe('refused')
    expect(r.state).toBe(s)
  })
})

describe('object programs / Pine stamps — an answer never touches them; a change carries them', () => {
  const C2 = 'uct.authoring.patch/1'
  const rsiDef = () => {
    const made = applyTurn(newAuthoringState(), { contract: C2, baseRevision: 0, ops: [{ op: 'create', name: 'RSI overbought',
      outputs: [{ key: 'value', tree: { type: 'op', name: '>', args: [{ type: 'call', name: 'rsi', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 14 }] }, { type: 'num', value: 70 }] } }] }] }).state.working
    return {
      ...made, id: 'u_objobjobjobj', version: 4,
      objects: { programVersion: 1, regs: [], colls: [], trees: [{ type: 'op', name: '>', args: [{ type: 'call', name: 'rsi', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 14 }] }, { type: 'num', value: 70 }] }], ops: [{ k: 'create', family: 'label', site: 's1', into: null, when: { v: 'tree', tree: 0 }, props: { x: { v: 'bar' }, y: { v: 'const', value: 1 } } }] },
      meta: { ...made.meta, pine: { dialect: 'pine', stamp: 'v5:abc' } },
    }
  }
  it('opened with its object program and Pine stamp, the definition is clean (nothing to save)', () => {
    const def = rsiDef()
    expect(isDirty(openAuthoringState(def, { defId: def.id, version: 4 }))).toBe(false)
  })
  it('a representable edit (70 → 80) carries the object program and the Pine stamp byte-for-byte', () => {
    const def = rsiDef()
    const opened = openAuthoringState(def, { defId: def.id, version: 4 })
    const out = applyTurn(opened, { contract: C2, baseRevision: opened.revision, ops: [{ op: 'set_slot', slot: 'value#1', value: 80 }] })
    expect(out.result.status).toBe('applied')
    expect(JSON.stringify(out.state.working.objects)).toBe(JSON.stringify(def.objects))
    expect(out.state.working.meta.pine).toEqual(def.meta.pine)
    expect(isDirty(out.state)).toBe(true)
  })
})
