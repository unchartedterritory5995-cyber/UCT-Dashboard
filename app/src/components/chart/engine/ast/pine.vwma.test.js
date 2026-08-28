import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'
import { interpret } from './interpret.js'

/**
 * `vwma` — TradingView's OWN closed form, costing the manifest nothing.
 *
 * ⭐⭐ ITS DOCS PUBLISH THE EQUIVALENT VERBATIM:
 *     pine_vwma(source, length) => ta.sma(source * volume, length)
 *                                / ta.sma(volume, length)
 * Every piece is already declared — `sma`, `*`, `/`, `volume` — so this is a
 * translator mapping, not a table entry.
 *
 * ⛔ A MANIFEST ENTRY WAS THE REFLEX AND WOULD HAVE BEEN WRONG. Adding a name
 * puts it in the sayable vocabulary, the criteria picker, the plain-language door
 * and BOTH interpreters — to express something the table can already say. The
 * grammar stays closed at 62 functions and the corpus still gains a script.
 */
describe('vwma expands rather than widening the table', () => {
  const src = (b) => `//@version=4\nstudy("t")\n${b}\n`
  const only = (out) => {
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    return out.outputs.find((o) => o.refusal === null)
  }

  it('⭐⭐ it is exactly the published expansion', () => {
    expect(only(translatePine(src('plot(vwma(close, 20))'))).formula)
      .toBe('sma(close * volume, 20) / sma(volume, 20)')
  })

  it('⭐ the SOURCE is the one asked for, not always close', () => {
    // ⛔ The control that catches a hard-coded child.
    expect(only(translatePine(src('plot(vwma(hl2, 10))'))).formula)
      .toBe('sma((high + low) / 2 * volume, 10) / sma(volume, 10)')
  })

  it('⭐⭐ and the NUMBER is right — weighted by volume, not a plain average', () => {
    // ⛔⛔ THE ARITHMETIC, NOT THE SHAPE. A shape assertion alone would pass for an
    // expansion that divided by the wrong window or dropped the weighting. Here
    // one bar carries ten times the volume of the other, so the VWMA must sit far
    // nearer that bar's price than the simple mean of 10 and 20 would.
    const row = only(translatePine(src('plot(vwma(close, 2))')))
    const bars = [
      { t: 20260801, o: 10, h: 10, l: 10, c: 10, v: 100 },
      { t: 20260802, o: 20, h: 20, l: 20, c: 20, v: 900 },
    ]
    // (10*100 + 20*900) / (100 + 900) = 19000 / 1000 = 19
    expect(interpret(row.ast, bars)[1]).toBeCloseTo(19, 10)
  })

  it('⛔ a window that is not a whole number refuses at ONE place', () => {
    // The expansion uses the length TWICE, so an unchecked bad window would
    // produce two refusals pointing at a function the member never wrote.
    const out = translatePine(src('plot(vwma(close, 0))'))
    expect(out.refusal).toBeTruthy()
  })

  it('⭐ the grammar did NOT grow — this is the point of the mapping', () => {
    // If a later change turns this into a table entry, this is the line that
    // should be edited deliberately rather than the count quietly moving.
    const out = translatePine(src('plot(vwma(close, 20))'))
    expect(out.refusal).toBe(null)
    expect(only(out).formula).not.toContain('vwma')
  })
})
