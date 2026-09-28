// app/src/components/chart/engine/ast/pineOffsetChain.test.js
//
// ─── AN OFFSET OF AN OFFSET IS ONE OFFSET: (x[m])[n] ≡ x[m+n] ───────────────
//
// Pine writes it through a name all the time (`h = high[1]` … `h[1]`), and the
// canonical grammar has exactly one spelling for it (`parse.js` refuses the
// chain as `canonicalise:offset-chained`). The translator emitted the chain, the
// round trip refused it, and — measured against TradingView (vendor harness,
// RDDT 1D 2026-09-28) — Ultimate Pivot Points' PD_H/PD_L colour rule
// `h == nz(h[1]) ? color.new(c, 10) : na` fell back to the pane's gold on 631
// bars where TradingView drew nothing; a plain `plot(h == h[1] ? 1 : 0)` refused.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'

const V5 = '//@version=5\nindicator("t")\n'
const out0 = (src) => {
  const t = translatePine(src)
  expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
  return t.outputs[0]
}

describe('(x[m])[n] folds to x[m+n]', () => {
  it('⭐ through a name — the value lane', () => {
    expect(out0(`${V5}h = high[1]\nplot(h == h[1] ? 1 : 0)\n`).formula).toBe('high[1] == high[2] ? 1 : 0')
    expect(out0(`${V5}h = high[2]\nplot(h[3])\n`).formula).toBe('high[5]')
  })

  it('⭐ through a name — the colour lane (the PD_H shape)', () => {
    const p = out0(`${V5}h = high[1]\nplot(h, color = h == nz(h[1]) ? color.new(color.green, 10) : color.red)\n`).presentation
    expect(p.colorCondition.formula).toBe('high[1] == nz(high[2], 0)')
  })

  it('⛔ CONTROL — a single offset, and an offset of a COMPOUND, are untouched', () => {
    expect(out0(`${V5}plot(high[3])\n`).formula).toBe('high[3]')
    expect(out0(`${V5}p = (high + low) / 2\nplot(p[1])\n`).formula).toBe('((high + low) / 2)[1]')
  })
})
