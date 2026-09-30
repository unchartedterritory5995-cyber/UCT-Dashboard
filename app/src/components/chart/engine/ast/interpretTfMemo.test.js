// app/src/components/chart/engine/ast/interpretTfMemo.test.js
//
// ⛔⛔ H14 (2026-09-29): `crossMemo` crossed a `tf`/`sym` bar-set boundary. Once
// node objects are shared (the V2 graph read-back via `expandGraph`), a child
// read on WEEKLY bars was answered with the CHART's column. A nested read gets
// its own memo scope; within one bar set sharing still works.
import { describe, it, expect } from 'vitest'
import { interpret } from './interpret'

const bars = Array.from({ length: 60 }, (_, i) => {
  const d = new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  return { t: d, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i + (i % 3), v: 1 }
})
const series = (name) => ({ type: 'series', name })
const op = (name, ...args) => ({ type: 'op', name, args })
const same = (x, y) => Object.is(x, y) || (Number.isNaN(x) && Number.isNaN(y))

describe('H14 — a nested `tf` read gets its own memo', () => {
  it('`close` shared by the chart read and a weekly read answers each on its own bars', () => {
    const close = series('close')
    const shared = op('-', close, { type: 'tf', value: 'W', args: [close] })
    const apart = op('-', series('close'), { type: 'tf', value: 'W', args: [series('close')] })
    const a = interpret(shared, bars, {}, undefined, undefined, { tf: 'D', crossMemo: new Map() })
    const b = interpret(apart, bars, {}, undefined, undefined, { tf: 'D', crossMemo: new Map() })
    const c = interpret(apart, bars, {}, undefined, undefined, { tf: 'D' })
    let finite = 0
    let nonZero = 0
    for (let i = 0; i < bars.length; i += 1) {
      expect(same(a[i], b[i])).toBe(true)
      expect(same(b[i], c[i])).toBe(true)
      if (Number.isFinite(a[i])) finite += 1
      if (Number.isFinite(a[i]) && a[i] !== 0) nonZero += 1
    }
    // non-vacuity: the weekly column really differs from the daily one
    expect(finite).toBeGreaterThan(40)
    expect(nonZero).toBeGreaterThan(20)
  })
})
