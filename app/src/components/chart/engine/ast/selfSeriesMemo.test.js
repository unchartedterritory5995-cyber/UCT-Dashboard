// app/src/components/chart/engine/ast/selfSeriesMemo.test.js
//
// ─── ⭐⭐ e99 U1 — THE SELF-SERIES PREDICATES ARE MEMOISED BY NODE, PER TABLE ─────────────────────────
//
// `containsSelfSeries`, `containsFreeSelfSeries` and `selfOutsideTheStepLoop` (pine.js, `selfWalkMemoOf`) keep their
// answers by node ACROSS calls. A memo is only a speed change if every answer it gives is the answer the walk would
// give, so this file pins the three ways a memo could give a different one:
//   1. THE TABLE IS PART OF THE KEY: one node asked under two tables whose `accum` binds different names answers
//      for each table, in either order (a memo keyed on the node alone answers the second table with the first's);
//   2. A SUBTREE ASKED FIRST does not change its parent's answer (a memo filled from below must agree with a walk
//      from above), including `selfOutsideTheStepLoop`'s FIRST hit in depth-first order;
//   3. THE THREE PREDICATES KEEP SEPARATE ANSWERS for one node (their walks differ at a recurrence's body slot).
import { describe, it, expect } from 'vitest'
import { __selfSeriesPredicatesForTests as P } from './pine'
import { TABLE } from './parse'

// a table whose `accum` binds `own` instead of `self` (everything else is TABLE's)
const OWN_TABLE = {
  ...TABLE,
  functions: {
    ...TABLE.functions,
    accum: { ...TABLE.functions.accum, recurrence: { ...TABLE.functions.accum.recurrence, binds: 'own' } },
  },
}
const series = (name) => ({ type: 'series', name })
const num = (value) => ({ type: 'num', value })
const op = (name, ...args) => ({ type: 'op', name, args })
const call = (name, ...args) => ({ type: 'call', name, args })

describe('e99 U1: self-series memo', () => {
  it('1. answers per table, in either order', () => {
    const a = op('+', series('self'), num(1))
    expect(P.containsSelfSeries(a, TABLE)).toBe(true)
    expect(P.containsSelfSeries(a, OWN_TABLE)).toBe(false)
    expect(P.containsFreeSelfSeries(a, TABLE)).toBe(true)
    expect(P.containsFreeSelfSeries(a, OWN_TABLE)).toBe(false)
    const b = op('+', series('own'), num(1))
    expect(P.containsSelfSeries(b, OWN_TABLE)).toBe(true)
    expect(P.containsSelfSeries(b, TABLE)).toBe(false)
    expect(P.containsFreeSelfSeries(b, OWN_TABLE)).toBe(true)
    expect(P.containsFreeSelfSeries(b, TABLE)).toBe(false)
    const c = call('crossOver', series('close'), series('self'))
    expect(P.selfOutsideTheStepLoop(c, TABLE)).toBe('crossOver(…)')
    expect(P.selfOutsideTheStepLoop(c, OWN_TABLE)).toBe(null)
    const d = call('crossOver', series('close'), series('own'))
    expect(P.selfOutsideTheStepLoop(d, OWN_TABLE)).toBe('crossOver(…)')
    expect(P.selfOutsideTheStepLoop(d, TABLE)).toBe(null)
  })

  it('2. a subtree asked first does not change its parent\'s answer; the first hit is depth-first', () => {
    const inner = op('+', series('self'), num(1)) // pointwise: no hit of its own
    const window = call('crossUnder', series('close'), inner) // a window call over self: a hit
    const offsetOfExpr = { type: 'offset', value: 1, args: [op('*', series('self'), num(2))] } // also a hit
    const parent = op('?:', series('close'), window, offsetOfExpr)
    expect(P.selfOutsideTheStepLoop(inner, TABLE)).toBe(null)
    expect(P.selfOutsideTheStepLoop(offsetOfExpr, TABLE)).toBe('a bar offset of an expression')
    expect(P.selfOutsideTheStepLoop(parent, TABLE)).toBe('crossUnder(…)')
    const parentSwapped = op('?:', series('close'), offsetOfExpr, window)
    expect(P.selfOutsideTheStepLoop(parentSwapped, TABLE)).toBe('a bar offset of an expression')
    // a plain self offset is the step loop's own history: no hit
    expect(P.selfOutsideTheStepLoop({ type: 'offset', value: 1, args: [series('self')] }, TABLE)).toBe(null)
    // a shared subtree read twice answers the same both times
    const shared = op('-', series('self'), num(3))
    const twice = op('+', shared, call('max', shared, num(0)))
    expect(P.containsSelfSeries(shared, TABLE)).toBe(true)
    expect(P.containsSelfSeries(twice, TABLE)).toBe(true)
    expect(P.selfOutsideTheStepLoop(twice, TABLE)).toBe(null)
  })

  it('3. the predicates keep separate answers for one node (a recurrence\'s body binds its own self)', () => {
    // accum(seed, body, warmup): the body's `self` is the INNER accumulator's
    const nested = call('accum', num(0), op('+', series('self'), num(1)), num(250))
    expect(P.containsSelfSeries(nested, TABLE)).toBe(true)
    expect(P.containsFreeSelfSeries(nested, TABLE)).toBe(false)
    // asked in the other order on a fresh node of the same shape
    const nested2 = call('accum', num(0), op('+', series('self'), num(1)), num(250))
    expect(P.containsFreeSelfSeries(nested2, TABLE)).toBe(false)
    expect(P.containsSelfSeries(nested2, TABLE)).toBe(true)
    // the outer update reading the nested accumulator: a recurrence call over self is a hit for the step loop
    const outer = op('+', series('self'), call('accum', series('self'), num(1), num(250)))
    expect(P.selfOutsideTheStepLoop(outer, TABLE)).toBe('accum(…)')
  })
})
