// app/src/components/chart/engine/ast/pine.armRuns.test.js
//
// ─── C45 (plot lane) — THE PIECES OF THE ARM-RUNS STAMP, ONE BY ONE ─────────────
//
// `vendorHarness.c45ArmRuns.test.js` holds the whole thing to the capture through
// the member door. This file holds the three helpers it is built from to their own
// contracts, on hand-built trees — including the one case no Pine source this
// engine translates reaches today (a stamped arm inside a multi-state recurrence),
// which is how a guard that drops a gate it cannot make standalone is proved to
// fire.
import { describe, it, expect } from 'vitest'
import {
  printFormula, bindTimeConstantTree, armHistoryCallOf, armRunGates, stampArmRuns, seedAndUpdateOf,
} from './pine'
import { TABLE } from './parse'

const num = (value) => ({ type: 'num', value })
const series = (name) => ({ type: 'series', name })
const op = (name, ...args) => ({ type: 'op', name, args })
const call = (name, ...args) => ({ type: 'call', name, args })
const declared = (name, def) => {
  const leaf = series(name)
  Object.defineProperty(leaf, 'inputName', { value: name, enumerable: false })
  Object.defineProperty(leaf, 'inputDefault', { value: def, enumerable: false })
  return leaf
}
const RUN = { negate: false, what: 'that arm', why: 'W' }

describe('C45 — bindTimeConstantTree: decided before bar 0, per binding', () => {
  it('⭐ literals, `na`, the chart\'s timeframe flags, declared inputs and operators over them', () => {
    expect(bindTimeConstantTree(num(1))).toBe(true)
    expect(bindTimeConstantTree(op('/', num(0), num(0)))).toBe(true)        // `na`: the false arm, every bar
    expect(bindTimeConstantTree(op('>', num(5), num(3)))).toBe(true)
    expect(bindTimeConstantTree(series('isdaily'))).toBe(true)
    expect(bindTimeConstantTree(op('&&', series('isintraday'), op('==', declared('ma', 0), num(1))))).toBe(true)
  })

  it('⛔ a bar value, a call, an offset, an undeclared name, a moving clock', () => {
    expect(bindTimeConstantTree(series('close'))).toBe(false)
    expect(bindTimeConstantTree(series('dayofweek'))).toBe(false)
    expect(bindTimeConstantTree(series('ma'))).toBe(false)                   // a name, not a DECLARED input
    expect(bindTimeConstantTree(call('nz', num(1)))).toBe(false)
    expect(bindTimeConstantTree({ type: 'offset', value: 1, args: [num(1)] })).toBe(false)
    expect(bindTimeConstantTree(op('>', series('close'), declared('k', 0)))).toBe(false)
    expect(bindTimeConstantTree(null)).toBe(false)
  })
})

describe('C45 — armHistoryCallOf: a call WRITTEN in the arm, read off the source', () => {
  it('⭐ a `ta.*` call anywhere in the arm\'s own expression', () => {
    const sma = { type: 'call', name: 'ta.sma', args: [{ name: null, value: { type: 'name', name: 'close' } }, { name: null, value: { type: 'number', value: 5 } }] }
    expect(armHistoryCallOf(sma, null)).toEqual({ name: 'ta.sma', udf: false })
    expect(armHistoryCallOf({ type: 'binary', op: '+', left: { type: 'name', name: 'close' }, right: sma }, null)).toEqual({ name: 'ta.sma', udf: false })
    expect(armHistoryCallOf({ type: 'offset', arg: sma, n: 1 }, null)).toEqual({ name: 'ta.sma', udf: false })
    expect(armHistoryCallOf({ type: 'call', name: 'math.max', args: [{ name: null, value: sma }] }, null)).toEqual({ name: 'ta.sma', udf: false })
    expect(armHistoryCallOf({ type: 'ternary', test: sma, yes: { type: 'number', value: 1 }, no: { type: 'number', value: 0 } }, null))
      .toEqual({ name: 'ta.sma', udf: false })
  })

  it('⭐ a call to a script function that reads its own history — and its method form', () => {
    const fns = new Set(['f'])
    expect(armHistoryCallOf({ type: 'call', name: 'f', args: [] }, fns)).toEqual({ name: 'f', udf: true })
    expect(armHistoryCallOf({ type: 'call', name: 'src.f', args: [] }, fns)).toEqual({ name: 'src.f', udf: true })
    expect(armHistoryCallOf({ type: 'method', recv: { type: 'number', value: 1 }, name: 'f', args: [] }, fns)).toEqual({ name: 'f', udf: true })
    // under one of Pine's own namespaces it is Pine's, never the script's
    expect(armHistoryCallOf({ type: 'call', name: 'math.f', args: [] }, fns)).toBeNull()
    expect(armHistoryCallOf({ type: 'call', name: 'g', args: [] }, fns)).toBeNull()
  })

  it('⛔ a NAME (bound elsewhere, so run where it is written), a BOUND node (an `if` fold\'s), `request.*`', () => {
    const sma = { type: 'call', name: 'ta.sma', args: [] }
    expect(armHistoryCallOf({ type: 'name', name: 's' }, null)).toBeNull()
    expect(armHistoryCallOf({ type: 'bound', binding: { kind: 'expr', node: sma }, name: 'v' }, null)).toBeNull()
    expect(armHistoryCallOf({ type: 'call', name: 'request.security', args: [{ name: null, value: sma }] }, null)).toBeNull()
    expect(armHistoryCallOf({ type: 'number', value: 1 }, null)).toBeNull()
    expect(armHistoryCallOf(null, null)).toBeNull()
  })
})

describe('C45 — armRunGates: the guard each stamp carries, read off the finished tree', () => {
  it('⭐ the stamped node\'s own test — negated for a false arm', () => {
    const test = op('>', series('close'), series('open'))
    const node = stampArmRuns(op('?:', test, call('sma', series('close'), num(5)), series('close')),
      [RUN, { ...RUN, negate: true, why: 'N' }])
    const gates = armRunGates([op('*', node, num(2))], TABLE)
    expect(gates.map((g) => [g.why, g.what, printFormula(g.guard)])).toEqual([
      ['W', 'that arm', 'close > open'], ['N', 'that arm', '!(close > open)']])
  })

  it('⭐ a test that reads its recurrence\'s own previous value is read one bar back, standalone', () => {
    const test = call('na', series('self'))
    const node = stampArmRuns(op('?:', test, call('sma', series('close'), num(7)), series('self')), [RUN])
    const accum = call('accum', op('/', num(0), num(0)), node, num(250))
    const [gate] = armRunGates([accum], TABLE)
    expect(printFormula(gate.guard)).toBe(`na(${printFormula(accum)}[1])`)
  })

  it('⛔ a guard that would read a multi-state bind free carries NO gate — never refused, never guessed', () => {
    const name = Object.keys(TABLE.functions).find((k) => TABLE.functions[k] && TABLE.functions[k].multiState)
    expect(name).toBeTruthy()
    const bind = TABLE.functions[name].multiState.binds[0]
    const free = stampArmRuns(op('?:', op('>', series(bind), num(0)), call('sma', series('close'), num(3)), num(0)), [RUN])
    expect(armRunGates([free], TABLE)).toEqual([])
    // 🔴 CONTROL — the same stamp over a test that reads no bind keeps its gate
    const bound = stampArmRuns(op('?:', op('>', series('close'), num(0)), call('sma', series('close'), num(3)), num(0)), [RUN])
    expect(armRunGates([bound], TABLE)).toHaveLength(1)
  })

  it('⭐ a rewrite that COPIES a stamped node keeps the stamp: `nz(x[1], seed)` read as the seed (`seedAndUpdateOf`)', () => {
    // `x = f(nz(x[1], 0))` — the DSP spelling: every self read wrapped in the one seed
    const selfRead = call('nz', { type: 'offset', value: 1, args: [series('self')] }, num(0))
    const node = stampArmRuns(op('?:', op('>', selfRead, series('close')), call('sma', series('close'), num(5)),
      op('*', num(0.5), selfRead)), [RUN])
    const parts = seedAndUpdateOf(node, TABLE)
    expect(parts).toBeTruthy()
    expect(printFormula(parts.seed)).toBe('0')
    expect(parts.update).not.toBe(node)                                       // the substitution copied it
    const [gate] = armRunGates([call('accum', parts.seed, parts.update, num(250))], TABLE)
    expect(gate && printFormula(gate.guard)).toMatch(/^accum\(0, .*\)\[2\] > close$/)
  })

  it('a stamp reached twice through a shared subtree is one gate', () => {
    const node = stampArmRuns(op('?:', op('>', series('close'), series('open')), call('ema', series('close'), num(5)), num(0)), [RUN])
    expect(armRunGates([op('+', node, node), node], TABLE)).toHaveLength(1)
  })
})
