// app/src/components/chart/engine/ast/pine.tupleBuiltins.test.js
//
// ─── ⭐⭐ THE TWO TUPLES A SCREENER ACTUALLY DESTRUCTURES ──────────────────────
//
//     [mid, upper, lower] = ta.bb(close, 20, 2)
//     [macdLine, signal, hist] = ta.macd(close, 12, 26, 9)
//
// are how anyone writes a Bollinger or MACD screen in modern Pine, and both
// refused `pine:tuple` while the hand-expanded spellings translated fine. The
// machinery was already here — `ta.dmi` destructures — it just had two members.
//
// ⛔ NOTHING NEW IS DECLARED AND NOTHING IS COMPUTED IN THE DOOR. Each part is an
// ordinary Pine expression over the caller's own argument nodes, handed to the
// same resolver every other expression goes through, so the arity, the roles,
// the lookback and the read-back all still come from the table.
//
// ⭐⭐ AND BOTH EXPANSIONS ARE THE REPO'S OWN RULINGS RATHER THAN NEW CLAIMS —
// which is why this file asserts the exact sentences they were ruled in:
//
//   bb   — `interpret.js::windowStdev` is population "so a user's
//          `sma(close,20) + 2*stdev(close,20)` draws the same band the native
//          Bollinger definition draws".
//   macd — `closedTable.json::_functions_excluded` writes it out: "the signal
//          line is `ema(macd(close, 12, 26), 9)` and the histogram is
//          `macd(close, 12, 26) - ema(macd(close, 12, 26), 9)`".

import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'

const screen = (head, body) =>
  translatePine(`//@version=6\nindicator("s")\n${head}\nplot(${body} ? 1 : 0)\n`)
const formulaOf = (out) => {
  expect(out.ok, out.ok ? '' : `${out.refusal.guard}: ${out.refusal.message}`).toBe(true)
  return out.outputs[out.selected].formula
}
const BB = '[mid, up, lo] = ta.bb(close, 20, 2)'
const MACD = '[m, sig, hist] = ta.macd(close, 12, 26, 9)'

describe('ta.bb and ta.macd destructure into the table’s own vocabulary', () => {
  it('⭐⭐ every band is the repo’s stated Bollinger identity', () => {
    expect(formulaOf(screen(BB, 'close > mid'))).toBe('close > sma(close, 20) ? 1 : 0')
    expect(formulaOf(screen(BB, 'close > up')))
      .toBe('close > sma(close, 20) + 2 * stdev(close, 20) ? 1 : 0')
    expect(formulaOf(screen(BB, 'close < lo')))
      .toBe('close < sma(close, 20) - 2 * stdev(close, 20) ? 1 : 0')
  })

  it('⛔ the three bands are DIFFERENT — not one part handed out three times', () => {
    // ⚠️ THE FAILURE THIS GUARDS IS THE ONE THE DESTRUCTURE COMMENT ALREADY NAMES:
    // "`request.security` would hand its FIRST element to a name expecting its
    // third: a translation that parses, lints, saves, scans and is silently
    // WRONG." Three assertions that each pass alone would not catch it.
    const seen = new Set([
      formulaOf(screen(BB, 'close > mid')),
      formulaOf(screen(BB, 'close > up')),
      formulaOf(screen(BB, 'close < lo')),
    ])
    expect(seen.size).toBe(3)
  })

  it('⭐⭐ the MACD parts are `_functions_excluded`’s sentence, verbatim', () => {
    expect(formulaOf(screen(MACD, 'm > 0'))).toBe('macd(close, 12, 26) > 0 ? 1 : 0')
    expect(formulaOf(screen(MACD, 'sig > 0')))
      .toBe('ema(macd(close, 12, 26), 9) > 0 ? 1 : 0')
    expect(formulaOf(screen(MACD, 'hist > 0')))
      .toBe('macd(close, 12, 26) - ema(macd(close, 12, 26), 9) > 0 ? 1 : 0')
  })

  it('⛔⛔ the MACD line is the TABLE’s `macd`, never a composed ema pair', () => {
    // ⛔ `interpret.js` binds `macd` to the shipped `computeMACD` — "BOUND TO THE
    // SHIPPED IMPLEMENTATION, NEVER COMPOSED" — because that is the number the
    // chart draws. Building the line as `ema(close,12) - ema(close,26)` would
    // give a plausible column that is a SECOND AUTHORITY over the charted one,
    // and nothing about the output would say so.
    const line = formulaOf(screen(MACD, 'm > 0'))
    expect(line).toContain('macd(close, 12, 26)')
    expect(line).not.toContain('ema(close, 12)')
    expect(line).not.toContain('ema(close, 26)')
  })

  it('⭐ it composes the way a screen is actually written', () => {
    expect(formulaOf(screen(MACD, 'ta.crossover(m, sig)')))
      .toBe('crossOver(macd(close, 12, 26), ema(macd(close, 12, 26), 9)) ? 1 : 0')
  })

  it('⛔ `ta.dmi` still destructures — the older member of this family', () => {
    expect(formulaOf(screen('[p, mi, adxv] = ta.dmi(14, 14)', 'adxv > 25')))
      .toBe('adx(high, low, close, 14) > 25 ? 1 : 0')
  })

  it('⛔⛔ a NAMED argument refuses rather than being taken by position', () => {
    // `ta.bb(mult = 2, series = close)` taken positionally would build a band out
    // of the wrong two arguments. This map carries no parameter names, so it
    // declines and the tuple guard says so.
    const out = screen('[mid, up, lo] = ta.bb(series = close, length = 20, mult = 2)', 'close > up')
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:tuple')
  })

  it('⛔ a wrong part count refuses instead of dropping one', () => {
    const out = screen('[a, b] = ta.bb(close, 20, 2)', 'close > a')
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:tuple')
  })
})
