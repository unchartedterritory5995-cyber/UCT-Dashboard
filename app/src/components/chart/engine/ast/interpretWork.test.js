// app/src/components/chart/engine/ast/interpretWork.test.js
//
// ─── ⭐⭐ C12r — THE WORK A RECURRENCE COSTS IS LINEAR IN WHAT IT READS ───────
//
// ⚰️ MEASURED on `rsi-swing-indicator` (632 bars): its object trees took 3–32 s
// EACH and the program 388 s, over two distinct `var` accumulators. Three
// independent causes, each railed here with the control that fails without it:
//   1. `structuralMaps` counted a recurrence body's OWN `self` as free, so no
//      accumulator — nor any ancestor of one — was ever memoised (99 references
//      ran 299 recurrences where 2 were distinct);
//   2. a step walked its spine as a TREE, so a DAG spine (a `var` written in
//      several blocks) paid once per path — exponential in the blocks;
//   3. `crossMemo` crossed a `tf`/`sym` bar-set boundary: once node objects
//      are shared (the V2 read-back, or the object lane's interning) a child
//      read on WEEKLY bars was answered with the CHART's column.
import { describe, it, expect } from 'vitest'
import { interpret } from './interpret'

const bars = Array.from({ length: 60 }, (_, i) => {
  const d = new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  return { t: d, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i + (i % 3), v: 1 }
})
const num = (value) => ({ type: 'num', value })
const series = (name) => ({ type: 'series', name })
const op = (name, ...args) => ({ type: 'op', name, args })
const accum = (seed, body, w) => ({ type: 'call', name: 'accum', args: [seed, body, num(w)] })

describe('C12r — an accumulator is a column, memoised like any other', () => {
  it('⭐ two references to one accumulator shape run it ONCE', () => {
    const mk = () => accum(num(0), op('+', series('self'), series('close')), 20)
    const tree = op('+', mk(), op('*', mk(), num(2)))
    const sink = []
    const col = interpret(tree, bars, {}, undefined, undefined, { tf: 'D', stepSink: sink })
    expect(sink).toHaveLength(1)
    expect(Number.isFinite(col[59])).toBe(true)
  })
})

describe('C12r — one step evaluates each spine node once', () => {
  it('⭐ a 14-deep shared DAG in a body steps in linear time and gives the exact value', () => {
    // s0 = self, s(k+1) = (s(k) + s(k)) / 2 — the value stays `self`, but a
    // tree walk pays 2^14 node visits per step, and this body steps 12,500
    // times (50 bars x a 250-bar warm-up): over 200M visits, far past the test
    // timeout, where the one-step memo pays 43 per step.
    let s = series('self')
    for (let k = 0; k < 14; k += 1) s = op('/', op('+', s, s), num(2))
    const long = Array.from({ length: 300 }, (_, i) => bars[i % bars.length])
    const col = interpret(accum(num(1), s, 250), long, {}, undefined, undefined, { tf: 'D' })
    expect(col[299]).toBe(1)
    expect(col[250]).toBe(1)
  })
})

describe('C12r — a nested `tf` read gets its own memo', () => {
  it('⭐ `close` shared by the chart read and a weekly read answers each on its own bars', () => {
    const close = series('close')
    const shared = op('-', close, { type: 'tf', value: 'W', args: [close] })
    const apart = op('-', series('close'), { type: 'tf', value: 'W', args: [series('close')] })
    const a = interpret(shared, bars, {}, undefined, undefined, { tf: 'D', crossMemo: new Map() })
    const b = interpret(apart, bars, {}, undefined, undefined, { tf: 'D', crossMemo: new Map() })
    const c = interpret(apart, bars, {}, undefined, undefined, { tf: 'D' })
    let finite = 0
    for (let i = 0; i < bars.length; i += 1) {
      expect(Object.is(a[i], b[i]) || (Number.isNaN(a[i]) && Number.isNaN(b[i]))).toBe(true)
      expect(Object.is(b[i], c[i]) || (Number.isNaN(b[i]) && Number.isNaN(c[i]))).toBe(true)
      if (Number.isFinite(a[i])) finite += 1
    }
    expect(finite).toBeGreaterThan(40)
  })
  it('⭐ …and a memo still SHARES within one bar set: a repeated weekly read is one child pass', () => {
    const memo = new Map()
    const weekly = () => ({ type: 'tf', value: 'W', args: [accum(num(0), op('+', series('self'), series('close')), 3)] })
    const sink = []
    interpret(op('+', weekly(), weekly()), bars, {}, undefined, undefined, { tf: 'D', crossMemo: memo, stepSink: sink })
    expect(sink).toHaveLength(1)
  })
})
