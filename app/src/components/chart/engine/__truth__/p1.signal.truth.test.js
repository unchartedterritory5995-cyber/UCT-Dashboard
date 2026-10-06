/* global process */
// P1 truth matrix, slice "signal" — triggerPolicy + the alert arming gate.
//
// A signal alert is the server alert lane reading a CONDITION / EVENTS output of
// the ONE stored definition; `triggerPolicy.js` is the member's vocabulary for
// WHEN it notifies, compiled onto the existing alert grammar. The server half is
// `tests/test_p1_truth_signal.py` (it drives the REAL evaluator over a
// router-armed alert); the two are held equal by
// `tests/fixtures/ast/p1_trigger_policy.json` and `p1_evaluability_alert.json`.
//
// Every case states ASKED / CLAIMED / DID and its outcome class.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseFormula } from '../ast/parse'
import { interpret } from '../ast/interpret'
import * as registry from '../nativeRegistry'
import { outputTypeOf, OUTPUT_TYPES } from '../outputType'
import { evaluability, LANES, STATUS, GATE_GUARDS } from '../evaluability'
import {
  TRUTH_DECODER, TRIGGER_POLICIES, POLICY_OPTIONS, DEFAULT_POLICY, compileTriggerPolicy, policyOf,
  signalAlertGate, signalAlertRequest, outputTypeForAddress, takesTriggerPolicy,
} from '../triggerPolicy'

const FIX = path.resolve(process.cwd(), '..', 'tests/fixtures/ast')
const POLICY_FIXTURE = JSON.parse(fs.readFileSync(path.join(FIX, 'p1_trigger_policy.json'), 'utf8'))
const ALERT_FIXTURE = JSON.parse(fs.readFileSync(path.join(FIX, 'p1_evaluability_alert.json'), 'utf8'))

const P = (src) => {
  const r = parseFormula(src)
  if (!r.ok) throw new Error(`${src}: ${JSON.stringify(r)}`)
  return r.ast
}
const ID = 'u_51a1000000c1'
const one = (src, meta = { semantics: 2 }) => ({ id: ID, name: 'sig', version: 1,
  plots: [{ key: 'value', style: 'line' }], compute: { kind: 'ast', fn: 'sig', ast: P(src) }, meta })
const seqBars = (closes) => closes.map((c, i) => {
  const v = c === null ? NaN : c
  return { t: 1700100000 + i * 300, o: v, h: v, l: v, c: v, v: 1000 }
})
const wire = (col) => Array.from(col).map((v) => (Number.isFinite(v) ? v : null))

describe('P1 signal — the policy table is one vocabulary, held equal to the server', () => {
  it('17 ASKED what each policy compiles to; CLAIMED above / cross_above / cross_below @ 0.5 (the alert lane\'s decoder); DID equal to the shared fixture (server: test_p1_truth_signal.py) — EXACT', () => {
    expect(TRUTH_DECODER).toBe(POLICY_FIXTURE.decoder)
    const ours = Object.values(TRIGGER_POLICIES).map((policy) => ({ policy, ...compileTriggerPolicy(policy) }))
    expect(ours).toEqual(POLICY_FIXTURE.policies)
    for (const p of POLICY_FIXTURE.policies) expect(policyOf(p.condition, p.threshold)).toBe(p.policy)
    expect(policyOf('cross_above', 1)).toBe(null)
    expect(POLICY_OPTIONS.map((o) => o.value).sort()).toEqual(Object.values(TRIGGER_POLICIES).sort())
    expect(DEFAULT_POLICY).toBe(TRIGGER_POLICIES.BECOMES_TRUE)
    expect(() => compileTriggerPolicy('sometimes')).toThrow()
  })

  it('18 ASKED a policy on a numeric SERIES; CLAIMED refused `signal:numeric-output` with the SAME sentence the server door uses, never thresholded at 0.5; DID refused — REFUSAL', () => {
    const def = one('sma(close, 5)')
    const g = signalAlertGate(def, 'value', { tf: 'D' })
    expect(g).toMatchObject({ status: STATUS.REFUSED, guard: GATE_GUARDS.SIGNAL_NUMERIC })
    expect(GATE_GUARDS.SIGNAL_NUMERIC).toBe(POLICY_FIXTURE.numericGuard)
    expect(g.reason).toBe(POLICY_FIXTURE.numericSentence)
    const req = signalAlertRequest({ def, key: 'value', policy: 'becomes_true', sym: 'x', tf: 'D' })
    expect(req.ok).toBe(false)
  })

  it('0.5 is sound only because a CONDITION / EVENTS output is {0,1,unknown}: SAR\'s events are typed EVENTS and take a policy; its price markers plot is SERIES and does not — EXACT', () => {
    const sar = registry.getDefinition('sar')
    expect(outputTypeOf(sar, 'priceCrossedSar').type).toBe(OUTPUT_TYPES.EVENTS)
    expect(takesTriggerPolicy(outputTypeOf(sar, 'priceCrossedSar').type)).toBe(true)
    const plot = sar.plots.find((p) => p.style === 'markers') || sar.plots[0]
    expect(takesTriggerPolicy(outputTypeOf(sar, plot.key).type)).toBe(false)
  })
})

describe('P1 signal — 17 / 12: the P0 transition contract through a policy-armed alert (browser half)', () => {
  it('17/12 ASKED `close > 100` (semantics 2) over every fixture sequence; CLAIMED the column the alert lane reads is {0,1,unknown} exactly as the fixture (the server reproduces `fires` on it with the real evaluator); DID the chart\'s own computeFor column equals it — UNKNOWN / VALUE', () => {
    const def = one(POLICY_FIXTURE.source)
    expect(def.compute.ast).toEqual(P('close > 100'))
    for (const t of POLICY_FIXTURE.transitions) {
      const bars = seqBars(t.closes)
      const cols = registry.computeFor(def, bars, {}, { tf: '5' })
      expect(wire(cols.value), t.id).toEqual(t.column)
      expect(wire(interpret(def.compute.ast, bars, {}, undefined, undefined, { semantics: 2 })), t.id).toEqual(t.column)
    }
  })

  it('17 the five owner sequences are pinned (F→T fires; U→T, U→U→T, F→U→T do not; U→F→T fires on F→T) and unknown NEVER fires under any policy — UNKNOWN', () => {
    const by = Object.fromEntries(POLICY_FIXTURE.transitions.map((t) => [t.id, t]))
    for (const [id, last] of [['F-T', true], ['U-T', false], ['U-U-T', false], ['U-F-T', true], ['F-U-T', false]]) {
      const f = by[id].fires.becomes_true
      expect(f[f.length - 1], id).toBe(last)
      expect(f.slice(0, -1).some(Boolean), id).toBe(false)
    }
    for (const t of POLICY_FIXTURE.transitions) {
      for (const [policy, fires] of Object.entries(t.fires)) {
        fires.forEach((fire, i) => {
          if (t.column[i + 1] === null) expect(fire, `${t.id} ${policy} bar ${i + 1}`).toBe(false)
        })
      }
    }
  })

  it('12 legacy (semantics 1) is the DISCLOSED difference: the warm-up U is laundered to F, so U→T reads F→T — not migrated', () => {
    const legacy = one(POLICY_FIXTURE.source, {})
    const cols = registry.computeFor(legacy, seqBars([null, 101]), {}, { tf: '5' })
    expect(wire(cols.value)).toEqual([0, 1])
  })
})

describe('P1 signal — 18 / 10: arming needs the shared gate to approve THIS signal output', () => {
  it('18 ASKED becomes_true on a CONDITION; CLAIMED supported (non-final: the server decides at arm) and a payload naming the output by ADDRESS with the compiled rule; DID — VALUE', () => {
    const def = one('close > sma(close, 20)')
    const req = signalAlertRequest({ def, key: 'value', policy: 'becomes_true', sym: 'aapl', tf: 'D' })
    expect(req.ok).toBe(true)
    expect(req.gate).toMatchObject({ status: STATUS.SUPPORTED, lane: LANES.ALERT, authority: 'server', final: false })
    expect(req.payload).toEqual({ sym: 'AAPL', indicator: `${ID}.value`, trigger_policy: 'becomes_true',
      condition: 'cross_above', threshold: 0.5, tf: 'D' })
  })

  it('10 ASKED becomes_true on `close > sym("SPY", close)` EVEN WITH SPY supplied to the chart; CLAIMED refused by the alert lane (`withheld`, other-symbol:unsupplied) — the policy does not widen P0 sym supply-or-refuse; DID refused — REFUSAL', () => {
    const def = one("close > sym('SPY', close)")
    const spy = seqBars([400, 401, 402])
    const ctx = { tf: 'D', secondary: { SPY: { status: 'ok', bars: spy } } }
    const g = signalAlertGate(def, 'value', ctx)
    expect(g).toMatchObject({ status: STATUS.REFUSED, gate: 'withheld', final: true })
    expect(g.codes).toContain('other-symbol:unsupplied')
    expect(signalAlertRequest({ def, key: 'value', policy: 'becomes_true', sym: 'x', tf: 'D', ctx }).ok).toBe(false)
  })

  it('18 ltf and current-only scalar conditions are refused through policy arming (P0 ltf / scalar rules) — REFUSAL', () => {
    expect(signalAlertGate(one("ltf(close, '60') > close"), 'value', { tf: 'D' }))
      .toMatchObject({ status: STATUS.REFUSED, gate: 'withheld', codes: ['lower-tf:unsupplied'] })
    expect(signalAlertGate(one('market_cap > 1e9'), 'value', { tf: 'D' }))
      .toMatchObject({ status: STATUS.REFUSED, gate: 'scalar' })
  })

  it('18 over the shared alert fixture: a truth-typed case the server admits is approved for policy arming; a numeric one is refused numeric; every alert-lane refusal is kept verbatim — REFUSAL / VALUE', () => {
    let truthSupported = 0
    for (const c of ALERT_FIXTURE.cases) {
      const g = signalAlertGate(c.definition, c.plotKey, { tf: 'D' })
      const alert = evaluability(c.definition, c.plotKey, LANES.ALERT, { tf: 'D' })
      const type = outputTypeOf(c.definition, c.plotKey).type
      if (c.expect.status === 'refused') {
        expect(g.status, c.name).toBe(STATUS.REFUSED)
        expect(g.gate, c.name).toBe(c.expect.gate)
      } else if (type === OUTPUT_TYPES.SERIES) {
        expect(g.guard, c.name).toBe(GATE_GUARDS.SIGNAL_NUMERIC)
      } else if (type === OUTPUT_TYPES.CONDITION) {
        expect(g, c.name).toEqual(alert)
        truthSupported += 1
      }
    }
    expect(truthSupported).toBeGreaterThan(0)
  })
})

describe('P1 signal — 19 (alert part): one tree, no duplicated condition math', () => {
  it('19 ASKED a definition with a SERIES plot and a CONDITION plot, alert on the condition; CLAIMED the alert request carries no tree / source / formula (the server evaluates the STORED tree), and the gate reads THAT tree (edit it → the answer moves); DID — EXACT', () => {
    const trees = { line: P('sma(close, 20)'), sig: P('close > sma(close, 20)') }
    const def = { id: ID, name: 'both', version: 1, meta: { semantics: 2 },
      plots: [{ key: 'line', style: 'line' }, { key: 'sig', style: 'markers', marker: { shape: 'arrowUp' } }],
      compute: { kind: 'ast', fn: 'b', ast: trees.line, trees, scanPlot: 'line' } }
    const req = signalAlertRequest({ def, key: 'sig', policy: 'becomes_true', sym: 'X', tf: 'D' })
    expect(req.ok).toBe(true)
    const text = JSON.stringify(req.payload)
    expect(text).not.toMatch(/"type"|sma|close >|"ast"|"trees"|source/)
    expect(req.payload.indicator).toBe(`${ID}.sig`)
    // the line plot of the SAME definition is not a signal
    expect(signalAlertGate(def, 'line', { tf: 'D' }).guard).toBe(GATE_GUARDS.SIGNAL_NUMERIC)
    // the chart column for `sig` is the interpretation of THE tree object
    const bars = seqBars(Array.from({ length: 40 }, (_, i) => 100 + 5 * Math.sin(i / 3)))
    const cols = registry.computeFor(def, bars, {}, { tf: 'D' })
    expect(wire(cols.sig)).toEqual(wire(interpret(trees.sig, bars, {}, undefined, undefined, { semantics: 2 })))
    // edit the tree: the gate's answer follows it (it reads the definition, not a copy)
    const edited = { ...def, compute: { ...def.compute, trees: { ...trees, sig: P('sma(close, 5)') } } }
    expect(signalAlertGate(edited, 'sig', { tf: 'D' }).guard).toBe(GATE_GUARDS.SIGNAL_NUMERIC)
  })

  it('outputTypeForAddress reads the INSTALLED definition by address, never a label; a builtin address has none', () => {
    const def = one('close > open')
    const got = outputTypeForAddress((id) => (id === ID ? def : null), `${ID}.value`)
    expect(got).toMatchObject({ key: 'value', type: OUTPUT_TYPES.CONDITION })
    expect(outputTypeForAddress(() => def, 'rsi')).toBe(null)
    expect(outputTypeForAddress(() => null, `${ID}.value`)).toBe(null)
  })
})
