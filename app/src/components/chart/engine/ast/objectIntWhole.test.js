// app/src/components/chart/engine/ast/objectIntWhole.test.js
//
// ⭐⭐ `int(x)` WHERE x IS A WHOLE NUMBER OR `na` ON EVERY BAR IS x.
//
// Pine's `int()` of an int-typed series is the identity and of `na` is `na` —
// no rounding rule is involved, so none is invented (`wholeValued` in pine.js).
// The FRACTIONAL case still refuses: TradingView does not publish whether it
// truncates, rounds or floors. Found on `contraction-box-doji-lines`, whose box
// edge is `int(condition ? bar_index - 5 : na)`.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine'

const LF = String.fromCharCode(10)
const host = (lines) => translatePine(['//@version=5', 'indicator("t", overlay=true)', ...lines].join(LF),
  { strict: true })

describe('⭐⭐ `int(x)` where x is whole or `na` on every bar is x', () => {
  it('`int(cond ? bar_index - 5 : na)` resolves — the contraction-box edge', () => {
    const t = host(['left = close > open ? bar_index - 5 : na',
      'box.new(left = int(left), right = bar_index, top = high, bottom = low)'])
    expect(t.objectDiagnostics.droppedOps, JSON.stringify(t.objectDiagnostics.dropReasons)).toBe(0)
  })
  it('⛔ CONTROL — `int(close)` still refuses: a fraction needs a rounding rule nobody published', () => {
    const t = host(['box.new(left = int(close), right = bar_index, top = high, bottom = low)'])
    expect(t.objectDiagnostics.dropReasons['create:box']).toBe(1)
  })
})
