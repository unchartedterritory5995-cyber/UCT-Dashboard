// app/src/components/chart/engine/ast/arrayFromElements.test.js
//
// ─── ⛔⛔ H14 — `array.from(a, b, c)` LISTS ELEMENTS, IT IS NOT `(size, initial)` ───
//
// Measured on production `9b28d4fa4`, 2026-09-27: the plan-time vector reader
// handled `array.from` with the same two lines as `array.new(size, initial)`, so
//
//     lengths = array.from(10, 20, 50)
//     plot(ta.sma(close, array.get(lengths, 0)))   → drew sma(close, 20)  (TV: SMA 10)
//     plot(close * array.sum(array.from(1, 2, 3)))  → drew close * 2       (TV: close * 6)
//
// — wrong lines, drawn on a member's chart with no refusal. Found by the vendor
// capture `rtwalls-array-stats-na-rddt-1d-2026-09-27` (its all-finite control read
// 3333 where TradingView reads 3142).
//
// These drive the shipped door (`translatePine`), and every case compares the
// formula a member would see.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'

const HEAD = '//@version=5\nindicator("t", overlay=true)\n'
const formulas = (body) => {
  const t = translatePine(`${HEAD}${body}`)
  expect(t.ok, t.ok ? '' : `${t.refusal && t.refusal.guard}: ${t.refusal && t.refusal.message}`).toBe(true)
  return t.outputs.map((o) => o.formula)
}

describe('⛔⛔ array.from — every argument is an element, in order', () => {
  it('⭐ the measured case: `array.get(lengths, 0)` is the FIRST element', () => {
    expect(formulas('lengths = array.from(10, 20, 50)\nplot(ta.sma(close, array.get(lengths, 0)))\n'))
      .toEqual(['sma(close, 10)'])
  })

  it('⭐ each index reads its own element, and the last index is the last element', () => {
    expect(formulas('w = array.from(1, 2, 3)\n'
      + 'plot(close * array.get(w, 0))\nplot(close * array.get(w, 1))\nplot(close * array.get(w, 2))\n'))
      .toEqual(['close * 1', 'close * 2', 'close * 3'])
  })

  it('⭐ the reduces see EVERY element — sum, max, min, avg', () => {
    expect(formulas('w = array.from(1, 2, 3)\n'
      + 'plot(close * array.sum(w))\nplot(close * array.max(w))\n'
      + 'plot(close * array.min(w))\nplot(close * array.avg(w))\n'))
      .toEqual(['close * (1 + 2 + 3)', 'close * max(max(1, 2), 3)',
        'close * min(min(1, 2), 3)', 'close * ((1 + 2 + 3) / 3)'])
  })

  it('⭐ a SERIES element is an element too', () => {
    expect(formulas('a = array.from(open, close)\nplot(array.get(a, 1))\n')).toEqual(['close'])
  })

  it('⭐ a literal `na` element is SKIPPED by the reduces (vendor Q5: [1, na, 3] → 3 / 1 / 4 / 2)', () => {
    expect(formulas('a = array.from(1.0, na, 3.0)\n'
      + 'plot(close * array.max(a))\nplot(close * array.min(a))\n'
      + 'plot(close * array.sum(a))\nplot(close * array.avg(a))\n'))
      .toEqual(['close * max(1, 3)', 'close * min(1, 3)', 'close * (1 + 3)', 'close * ((1 + 3) / 2)'])
  })

  it('⛔ …but `array.get` of the `na` slot is still `na`, not the next element', () => {
    expect(formulas('a = array.from(1.0, na, 3.0)\nplot(close * array.get(a, 1))\n'))
      .toEqual(['close * (0 / 0)'])
  })

  it('⛔ CONTROL — `array.new(size, initial)` is unchanged: every slot holds the initial value', () => {
    expect(formulas('a = array.new_float(3, 5.0)\nplot(close * array.get(a, 2))\nplot(close * array.sum(a))\n'))
      .toEqual(['close * 5', 'close * (5 + 5 + 5)'])
  })

  it('⛔ CONTROL — an out-of-range read of an `array.from` still refuses by name', () => {
    const t = translatePine(`${HEAD}w = array.from(1, 2, 3)\nplot(close * array.get(w, 3))\n`)
    const refusals = [t.refusal, ...(t.refusals || [])].filter(Boolean)
    expect(refusals.map((r) => r.guard)).toContain('pine:collection')
  })
})
