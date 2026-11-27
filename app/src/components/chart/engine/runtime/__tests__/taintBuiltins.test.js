// app/src/components/chart/engine/runtime/__tests__/taintBuiltins.test.js
//
// ─── START-TAINT PART 3: the built-ins' tags, one family per describe (`../taintTags.js`, `docs/pine/START-TAINT.md`) ─
//
// A built-in is clean once it has forgotten the run's first bar: a finite window once `span` clean observations have
// arrived since the last tainted one; `barssince` / `fixnan` / `valuewhen` from their clean events; the cross family
// (and a column's `change`) one clean step on; a recurrence (`ema`, `rma`, ...) and an unknown built-in never. ONE
// table (`builtinRuleOf`) drives both the taint loop (per plan entry) and the columns (per tree node). Every rule has a
// mutant (`ci/mutants/e105-taint-builtins.json`). Every fixture is also a VALUE rail: each run is made by `execute` and
// by `executeTainted`, and the values must be the same. Tags read: C clean, O offset, T tainted.
import { describe, it, expect } from 'vitest'

import { execute, executeTainted } from '../vm.js'
import { OP } from '../program.js'
import { contextForProgram } from '../lower.js'
import { lowerIrProgram } from '../lowerIr.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { interpret, FINITE_WINDOW, CARRIED_PINE, CARRIED2 } from '../../ast/interpret.js'
import { builtinRuleOf, ruleCodeOf, RULE, FORGET, columnTaintOf, cleanFromOf } from '../taintTags.js'

const N = 12
/** close > open on bars 3, 6, 7, 9, 10, 11 (bars 0-2 close below open) */
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: i < 3 ? 12 : 10 + (i % 3), h: 12 + i, l: 9 + i, c: i < 3 ? 11 : 11 + (i % 4), v: 100,
}))
const tags = (u8) => Array.from(u8, (t) => 'COT'[t]).join('')
/** `x` is C except on bars 3, 6 and 7, where it reads `v[9]` before the run's first bar (T, and `na`) */
const X = 'var float v = na\nv := close\nx = v[close > open ? 9 : 0]\n'
const X_TAGS = 'CCCTCCTTCCCC'

/** Real lowered Pine over BARS, its columns tagged by `columnTaintOf` (each window's child evaluated as the build did). */
function pine(src) {
  const trees = []
  let valuesOf = null
  const built = buildRuntimeIr(`//@version=5\nindicator("t")\n${src}`, { bars: BARS, inputs: {},
    columnInterpret: (t, b, i, o) => {
      trees.push(t)
      valuesOf = (n) => interpret(n, b, i, undefined, undefined, o)
      return interpret(t, b, i, undefined, undefined, o)
    } })
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const ctx = contextForProgram(program, BARS)
  const plain = execute(program, ctx)
  const res = executeTainted(program, ctx, undefined, { taint: columnTaintOf(trees, (n) => valuesOf(n)) })
  for (let k = 0; k < plain.outputs.length; k += 1) expect(Array.from(res.outputs[k])).toEqual(Array.from(plain.outputs[k]))
  const ops = new Set()
  for (let pc = 0; pc < program.code.length / 3; pc += 1) ops.add(program.code[pc * 3])
  return { res, ops, out: (k) => tags(res.taint.outputs[k]) }
}

describe('ONE table: every rule is derived or written once', () => {
  it('every FINITE_WINDOW member is a window under its own na policy (derived, never listed)', () => {
    for (const [fn, spec] of Object.entries(FINITE_WINDOW)) expect(builtinRuleOf(fn)).toEqual({ kind: 'window', policy: spec.na })
  })
  it('every carried member is a written forget rule or T for ever; a recurrence and an unknown name are T', () => {
    for (const fn of [...Object.keys(CARRIED_PINE), ...Object.keys(CARRIED2)]) {
      const r = builtinRuleOf(fn)
      expect(r === null || r === FORGET[fn], fn).toBe(true)
    }
    for (const fn of ['ema', 'rma', 'rsiPine', 'cumPine', 'vwapPine', 'stochPine', 'pivotHighPine', 'no-such-builtin']) {
      expect(builtinRuleOf(fn), fn).toBe(null)
      expect(ruleCodeOf(fn), fn).toBe(RULE.T)
    }
    expect([ruleCodeOf('barssincePine'), ruleCodeOf('fixnanPine'), ruleCodeOf('valuewhen'), ruleCodeOf('crossOver')])
      .toEqual([RULE.FIRES, RULE.FINITE, RULE.OCCURRENCE, RULE.LAG])
  })
})

describe('window: C once `span` clean observations have arrived since the last tainted one', () => {
  it('ta.sma(x, 3) in the VM (a function body) is C from bar 2', () => {
    const { out, ops } = pine('f(x) => ta.sma(x, 3)\nplot(f(close))')
    expect(ops.has(OP.WINDOW), 'non-vacuity: the VM window').toBe(true)
    expect(out(0)).toBe('TTCCCCCCCCCC')
  })
  it('a tainted observation restarts the count: sma(x, 3) is T until 3 clean ones follow it', () => {
    const { out } = pine(`f(x) => ta.sma(x, 3)\n${X}plot(x)\nplot(f(x))`)
    expect(out(0)).toBe(X_TAGS)
    expect(out(1)).toBe('TTCTTTTTTTCC')
  })
  it('a propagate window (ta.dev) reads its ring: C only where the last 3 committed bars are clean', () => {
    const { out } = pine(`f(x) => ta.dev(x, 3)\n${X}plot(x)\nplot(f(x))`)
    expect(out(0)).toBe(X_TAGS)
    expect(out(1)).toBe('TTCTTTTTTTCC')
  })
  it('a window the arm not taken would have stepped (a T branch) restarts its count', () => {
    const { out, ops } = pine(`${X}float s = na\nif x > 0\n    s := ta.sma(close, 3)\nplot(x)\nplot(s)`)
    expect(ops.has(OP.WINDOW) && ops.has(OP.JUMP_IF_FALSE), 'non-vacuity: a VM window under a branch').toBe(true)
    // bars 3, 6, 7: x is na (the arm is not taken here) and T (another start took it)
    expect(out(1)).toBe('TTCTTTTTTTCC')
  })
})

describe('event: barssince / fixnan from their first clean event, valuewhen from its occurrence + 1-th', () => {
  it('ta.barssince(close > open) is C from the first firing (bar 3)', () => {
    const { out, ops } = pine('f(c) => ta.barssince(c)\nplot(f(close > open))')
    expect(ops.has(OP.CARRIED), 'non-vacuity: the VM carried store').toBe(true)
    expect(out(0)).toBe('TTTCCCCCCCCC')
  })
  it('a tainted condition forgets the event: barssince(x > 11) is C from bar 5 and T from bar 6 on (no clean firing after)', () => {
    const { out } = pine(`f(c) => ta.barssince(c)\n${X}plot(x)\nplot(f(x > 11))`)
    expect(out(1)).toBe('TTTTTCTTTTTT')
  })
  it('fixnan(x) is C from the first clean finite value', () => {
    const { out } = pine('f(x) => fixnan(x)\nplot(f(close > open ? close : na))')
    expect(out(0)).toBe('TTTCCCCCCCCC')
  })
  it('ta.valuewhen(close > open, close, 1) is C from the second clean firing (bar 6)', () => {
    const { out, ops } = pine('f(c, x) => ta.valuewhen(c, x, 1)\nplot(f(close > open, close))')
    expect(ops.has(OP.CARRIED2), 'non-vacuity: the VM two-input store').toBe(true)
    expect(out(0)).toBe('TTTTTTCCCCCC')
  })
})

describe('lag: the cross family (and a column\'s change) one clean step on', () => {
  it('ta.crossover(close, open) in the VM is C from bar 1', () => {
    const { out } = pine('f(a, b) => ta.crossover(a, b)\nplot(f(close, open) ? 1 : 0)')
    expect(out(0)).toBe('TCCCCCCCCCCC')
  })
  it('the columns: ta.change(close) and ta.crossover(close, open) are C from bar 1', () => {
    const { out } = pine('plot(ta.change(close))\nplot(ta.crossover(close, open) ? 1 : 0)')
    expect(out(0)).toBe('TCCCCCCCCCCC')
    expect(out(1)).toBe('TCCCCCCCCCCC')
  })
})

describe('recurrences and unknown built-ins: T for ever (ruling 1, fail closed)', () => {
  it('ta.ema in the VM and as a column is T on every bar', () => {
    const { out } = pine('f(x) => ta.ema(x, 3)\nplot(f(close))\nplot(ta.ema(close, 3))')
    expect(out(0)).toBe('TTTTTTTTTTTT')
    expect(out(1)).toBe('TTTTTTTTTTTT')
  })
})

describe('columns: each clean from its own first clean bar (`cleanFrom`)', () => {
  it('sma(close, 3) and dev(close, 3) are C from bar 2', () => {
    const { out } = pine('plot(ta.sma(close, 3))\nplot(ta.dev(close, 3))')
    expect(out(0)).toBe('TTCCCCCCCCCC')
    expect(out(1)).toBe('TTCCCCCCCCCC')
  })
  it('a skip window counts its child\'s FINITE values: sma(close > open ? close : na, 2) is C from the 2nd (bar 6)', () => {
    const { out } = pine('plot(ta.sma(close > open ? close : na, 2))')
    expect(out(0)).toBe('TTTTTTCCCCCC')
  })
  it('an offset is clean k bars on; a tree without its values cannot count, and fails closed', () => {
    const s = (name) => ({ type: 'series', name })
    const num = (value) => ({ type: 'num', value })
    expect(cleanFromOf({ type: 'offset', value: 3, args: [s('close')] })).toBe(3)
    expect(cleanFromOf({ type: 'call', name: 'dev', args: [s('close'), num(4)] })).toBe(3)
    expect(cleanFromOf({ type: 'call', name: 'sma', args: [s('close'), num(4)] })).toBe(Infinity)
    expect(cleanFromOf({ type: 'call', name: 'ema', args: [s('close'), num(4)] })).toBe(Infinity)
    expect(cleanFromOf({ type: 'call', name: 'no-such-builtin', args: [s('close')] })).toBe(Infinity)
  })
})
