// ⭐ The one-line hint beside a refused formula. It is a READER of the refusal —
// these rails pin that it says something useful for the mistakes members actually
// make, that every formula it suggests really works, and that it stays silent
// rather than guessing.
import { describe, it, expect } from 'vitest'
import TABLE_JSON from './closedTable.json'
import { parseFormula } from './parse.js'
import { formulaHint, suggestedFormulas, signatureOf } from './formulaHints.js'
import { evaluateFormula, canSaveFormula } from '../../builder/FormulaField.jsx'

const hintFor = (source) => {
  const r = evaluateFormula(source, {})
  expect(r.ok, `${source} was expected to be refused`).toBe(false)
  return formulaHint(r)
}

describe('the mistakes members make get the fix', () => {
  it.each([
    ['hl2 > close', '(high + low) / 2'],
    ['hlc3', '(high + low + close) / 3'],
    ['ohlc4 > open', '(open + high + low + close) / 4'],
    ['avg(close, 20)', 'sma(close, 20)'],
    ['average(volume, 20)', 'sma(close, 20)'],
    ['smma(close, 10)', 'rma(close, 14)'],
    ['stddev(close, 20)', 'stdev(close, 20)'],
    ['variance(close, 20)', 'stdev(close, 20) * stdev(close, 20)'],
    ['cross(close, sma(close, 20))', 'crossOver(close, ema(close, 20)) || crossUnder(close, ema(close, 20))'],
    ['obv > 0', 'obvN(50)'],
    ['change(close, 5)', 'close - close[5]'],
    ['macd(close, 12, 26, 9)', 'ema(macd(close, 12, 26), 9)'],
    ['atr(14)', 'atr(high, low, close, period)'],
    ['rsi(14)', 'rsi(source, period)'],
    ['sma(close, len)', 'input you add under Inputs'],
    ['clse > 1', '`close`'],
    ['crossover(close, open)', '`crossOver`'],
  ])('%s → mentions %s', (source, fragment) => {
    const hint = hintFor(source)
    expect(hint, source).toBeTruthy()
    expect(hint).toContain(fragment)
    expect(hint.length).toBeLessThan(240)
  })

  it('sar is a formula now (2026-10-30), and the TradingView three-argument form is told how to write it', () => {
    // ⚰️ This said SAR was "not available as a formula yet". `sar(step, maxStep)` ships
    // over `accum4`; the refusal of the 3-argument form is the expansion's own sentence.
    const r = parseFormula('sar(0.02, 0.02, 0.2)')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/sar\(step, maxStep\).*ta\.sar\(start, increment, maximum\).*sar\(0\.02, 0\.2\)/)
    expect(parseFormula('sar(0.02, 0.2)').ok).toBe(true)
  })

  it('Bollinger Bands are a formula now (2026-11-01): bbUpper parses and needs no hint', () => {
    // ⚰️ This expected the "write it as sma + 2 * stdev" hint. `bbUpper` is now an
    // expansion that builds exactly that tree, so there is nothing to correct.
    expect(parseFormula('bbUpper(close, 20, 2)').ok).toBe(true)
    expect(parseFormula('bbLower(close, 20, 1.5)').ok).toBe(true)
    expect(evaluateFormula('bbUpper(close, 20, 2)', {}).ok).toBe(true) // the formula sheet accepts it
  })

  it('stays silent when it has nothing honest to say', () => {
    expect(formulaHint({ guard: 'resolve:function', error: 'unknown function "frobnicate" — this table declares abs' }))
      .toMatch(/not a function UCT formulas have/)
    expect(formulaHint({ guard: 'sentence:name', error: 'at $: "frobnicate" — this table declares close' })).toBeNull()
    expect(formulaHint({ guard: 'parser', error: 'Unexpected "=" at character 2' })).toBeNull()
    expect(formulaHint(null)).toBeNull()
    expect(formulaHint({ ok: true, error: null })).toBeNull()
  })
})

describe('every formula a hint can suggest really is a formula', () => {
  it('parses', () => {
    for (const f of suggestedFormulas()) {
      const r = parseFormula(f)
      expect(r.ok, `${f}: ${r.error}`).toBe(true)
    }
  })

  it('evaluates at the formula sheet and can be saved', () => {
    let checked = 0
    for (const f of suggestedFormulas()) {
      const r = evaluateFormula(f, {})
      expect(r.ok, `${f}: ${r.error}`).toBe(true)
      expect(canSaveFormula(r)).toBe(true)
      checked += 1
    }
    expect(checked).toBeGreaterThan(15)
  })

  it('a signature is read off the table\'s declared roles', () => {
    expect(signatureOf('stoch')).toBe('stoch(high, low, close, period)')
    expect(signatureOf('supertrend')).toBe('supertrend(factor, atrPeriod)')
    expect(signatureOf('nope')).toBeNull()
    for (const name of Object.keys(TABLE_JSON.functions)) expect(signatureOf(name)).toMatch(new RegExp(`^${name}\\(`))
  })
})
