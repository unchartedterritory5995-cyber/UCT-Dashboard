// app/src/components/chart/engine/runtime/__tests__/memberInputFold.test.js
//
// SETTINGS PARITY (2c): a member's value reaches every fold of an input, the reassigned one included.
//
// Measured on RS Rating (2026-11-16): `lookback2 = input.int(250, …)` is reassigned under
// `if (lookback2 == 250 and timeframe.isweekly)`, so its value is folded by the W4-T2 simple fold,
// which re-parsed the declaration's right side out of context and lost the bound name the resolver
// applies a member's value by. A member's 200 kept a 250-bar window, and a historical new-low dot the
// author's script draws on TradingView was missing on ours.
import { describe, it, expect } from 'vitest'
import { runtimeColumnsFor } from '../runtimeColumns.js'
import { runtimeInputSpecsOf } from '../runtimeInputs.js'

// a falling start then a slow rise: the lowest close over 250 bars and over 200 bars differ at bar 270
const BARS = Array.from({ length: 300 }, (_, i) => {
  const c = i < 60 ? 300 - i : 241 + (i - 59) * 0.5
  return { t: 1700000000 + i * 86400, o: c, h: c + 1, l: c - 1, c, v: 1 }
})
const AT = 270
const LOWEST_250 = 241
const LOWEST_200 = 241 + (AT - 199 - 59) * 0.5

let seq = 0
function at270(body, inputs) {
  const src = ['//@version=5', 'indicator("member fold")', ...body].join('\n')
  const def = { id: `u_mif${++seq}`, compute: { kind: 'runtime', fn: 'runtime:u_mif', rev: 1, source: src, outputs: { a: 0 } },
    inputs: runtimeInputSpecsOf(src).specs, meta: { runtimeHistory: 'listing' } }
  return runtimeColumnsFor(def, BARS, inputs, { tf: 'D', historyFromListing: true }).a[AT]
}

const REASSIGNED = ["lb = input.int(250, 'L', minval = 1, maxval = 252)", 'if (lb == 250 and timeframe.isweekly)',
  '    lb := 52', 'prev = lb', 'x = ta.lowest(close, prev)', 'plot(x, "a")']

describe('a reassigned input folds at the member\'s value', () => {
  it('CONTROL: at the default the window is the author\'s 250', () => {
    expect(at270(REASSIGNED, {})).toBe(LOWEST_250)
  })

  it('⭐ the member\'s 200 sizes the window (it kept 250 before the fix)', () => {
    expect(at270(REASSIGNED, { lb: 200 })).toBe(LOWEST_200)
  })

  it('and the RS Rating shape (a later per-bar write of the same name) is unaffected', () => {
    const rs = [...REASSIGNED.slice(0, 4), 'lb := math.min(lb - 1, bar_index)', ...REASSIGNED.slice(4)]
    expect(at270(rs, { lb: 200 })).toBe(LOWEST_200)
  })

  it('⛔ a value outside the author\'s bounds is refused by name, never folded', () => {
    expect(() => at270(REASSIGNED, { lb: 300 })).toThrow(/`lb` was given 300/)
  })

  it('CONTROL: an input that is never reassigned took the member\'s value before and still does', () => {
    expect(at270(["lb = input.int(250, 'L', minval = 1, maxval = 252)", 'x = ta.lowest(close, lb)', 'plot(x, "a")'], { lb: 200 }))
      .toBe(LOWEST_200)
  })
})
