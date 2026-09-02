// app/src/components/chart/engine/ast/pine.sourceAdapters.test.js
//
// ─── ⭐⭐ PINE PASSES A SOURCE WHERE THIS TABLE TAKES PRICE FIELDS ─────────────
//
//     ta.cci(source, length)   →   cci(high, low, close, length)
//     ta.mfi(source, length)   →   mfi(high, low, close, volume, length)
//
// Both refused `pine:role-order` — correctly, under the rule that a function with
// several price arguments and no MEASURED order must fail closed rather than be
// matched up by position. What was missing is the measurement.
//
// ⭐ AND IT IS A MEASUREMENT, NOT A JUDGEMENT. `indicators.js::computeCCI` and
// `computeMFI` each open with `tp[i] = (bars[i].h + bars[i].l + bars[i].c) / 3` —
// the typical price. So when the source a member passes IS `hlc3`, filling
// high/low/close is the same column, exactly.
//
// ⛔⛔ AND WHEN IT IS NOT, IT REFUSES. `ta.cci(close, 20)` is a real and different
// indicator — CCI of the close rather than of the typical price. A shape alone
// could not say that: `build` has no slot for the source, so it would have
// answered with the typical-price column regardless — a plausible number, on the
// right scale, wrong on every bar, with nothing refusing. `sourceMustBe` is what
// makes dropping that argument admissible instead of a silent loss.

import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'

const screen = (body, head = '') =>
  translatePine(`//@version=6\nindicator("s")\n${head}plot(${body} ? 1 : 0)\n`)
const formulaOf = (out) => {
  expect(out.ok, out.ok ? '' : `${out.refusal.guard}: ${out.refusal.message}`).toBe(true)
  return out.outputs[out.selected].formula
}

describe('the typical-price adapters', () => {
  it('⭐⭐ `hlc3` maps onto the table’s own price fields', () => {
    expect(formulaOf(screen('ta.cci(hlc3, 20) < -100')))
      .toBe('cci(high, low, close, 20) < -100 ? 1 : 0')
    expect(formulaOf(screen('ta.mfi(hlc3, 14) < 20')))
      .toBe('mfi(high, low, close, volume, 14) < 20 ? 1 : 0')
  })

  it('⛔⛔ ANY OTHER SOURCE REFUSES, and the refusal says what to write', () => {
    const out = screen('ta.cci(close, 20) < -100')
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:role-order')
    expect(out.refusal.message).toMatch(/typical/)
    expect(out.refusal.message).toMatch(/DIFFERENT indicator/)
    expect(out.refusal.message).toMatch(/TO UNBLOCK/)
    expect(out.refusal.message).toContain('ta.cci(hlc3')
  })

  it('⭐⭐ the check RESOLVES the source — a binding that holds `hlc3` works', () => {
    // ⭐ THE REASON THIS IS NOT A SPELLING TEST. Comparing the written argument to
    // the identifier `hlc3` would have been simpler and would refuse the very
    // common `src = hlc3` … `ta.mfi(src, 14)`. The comparison is against
    // `derivedSeriesTree`, the same function the door uses to expand `hlc3`, so
    // anything that resolves to that tree is accepted however it was spelled.
    expect(formulaOf(screen('ta.mfi(src, 14) < 20', 'src = hlc3\n')))
      .toBe('mfi(high, low, close, volume, 14) < 20 ? 1 : 0')
  })

  it('⛔ a binding that holds something ELSE still refuses', () => {
    // ⚠️ THE OTHER HALF OF THE CASE ABOVE. Resolving through a binding must not
    // mean accepting whatever the binding holds.
    const out = screen('ta.cci(src, 20) < -100', 'src = close\n')
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:role-order')
  })

  it('⛔ the adapters did not widen anything else', () => {
    // `atr` and `wpr` fill their series implicitly from a measured order and take
    // no source at all; they must be untouched by a field added for two others.
    expect(formulaOf(screen('ta.atr(14) / close > 0.03')))
      .toBe('atr(high, low, close, 14) / close > 0.03 ? 1 : 0')
    expect(formulaOf(screen('ta.wpr(14) < -80')))
      .toBe('williamsR(high, low, close, 14) < -80 ? 1 : 0')
  })

  it('⛔⛔ bare `ta.vwap` still resolves — the deliberate exclusion', () => {
    // ⚠️ `ta.vwap` WANTS THIS ADAPTER AND CANNOT HAVE IT YET. `computeVWAP`
    // weights by the same typical price, so `ta.vwap(hlc3)` really is our
    // `vwap()` — but a shape carries ONE `pineArity`, and bare `ta.vwap` is a
    // zero-argument VARIABLE. Declaring the one-argument form would refuse the
    // spelling members actually write, which is the worse trade. This case is
    // here so that trade stays visible rather than being quietly reversed.
    expect(formulaOf(screen('close > ta.vwap'))).toBe('close > vwap() ? 1 : 0')
    expect(screen('close > ta.vwap(hlc3)').ok).toBe(false)
  })
})
