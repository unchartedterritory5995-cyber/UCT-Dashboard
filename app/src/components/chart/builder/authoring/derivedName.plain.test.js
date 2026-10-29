// ⭐ 2026-10-29 — A DERIVED NAME IS WORDS, NOT A FORMULA (owner: "no formulas in chat").
// Pins the plain wording, that it is deterministic and total, and the property that keeps
// every document saved before it safe: a name in the OLD formula wording is still
// automatic, so it moves to the plain words on the next maths edit instead of freezing.
import { describe, it, expect } from 'vitest'
import { parseFormula } from '../../engine/ast/parse'
import { nameOfTree, namingSnapshot, applyDerivedNaming, derivedDefName } from './derivedName'

const P = (s) => { const r = parseFormula(s); if (!r.ok) throw new Error(`${s}: ${r.error}`); return r.ast }
const plain = (s) => nameOfTree(P(s))
const formula = (s) => nameOfTree(P(s), 0, 'formula')

describe('the plain wording', () => {
  it.each([
    ['ema(close, 9) > ema(close, 20)', 'EMA 9 above EMA 20'],
    ['rsi(close, 14) <= 30', 'RSI 14 at or below 30'],
    ['high < high[1] && low > low[1]', 'High below previous High and Low above previous Low'],
    ['(ema(close, 9) - ema(close, 20)) / ema(close, 20) * 100', 'EMA 9 vs EMA 20 %'],
    ['(close - sma(close, 50)) / sma(close, 50) * 100', 'Close vs SMA 50 %'],
    ['volume > 1.5 * sma(volume, 20)', 'Volume above 1.5 times SMA 20 (Volume)'],
    // `0 / 0` is “no value” (the native formula's `na` spelling lands with the expressiveness PR)
    ['close > sma(close, 50) ? close : 0 / 0', 'Close when Close above SMA 50'],
    ['close - close[5]', 'Close 5-bar change'],
    ['crossOver(ema(close, 9), ema(close, 20))', 'EMA 9 crosses above EMA 20'],
    ['!(close > open)', 'not (Close above Open)'],
  ])('%s → %s', (src, want) => {
    expect(plain(src)).toBe(want)
  })

  it('carries no comparison or arithmetic symbol a member would read as a formula', () => {
    for (const s of ['ema(close, 9) > ema(close, 20)', 'high < high[1] && low > low[1]',
      '(ema(close, 9) - ema(close, 20)) / ema(close, 20) * 100', 'close / sma(close, 50)',
      'rsi(close, 14) >= 70 || rsi(close, 14) <= 30', 'close > open ? 1 : -1']) {
      expect(plain(s), s).not.toMatch(/[<>≥≤÷]|\?:|\[\d+\]| − /)
    }
  })

  it('the formula wording is unchanged — it is what older saves stored', () => {
    expect(formula('ema(close, 9) > ema(close, 20)')).toBe('EMA 9 > EMA 20')
    expect(formula('high < high[1] && low > low[1]')).toBe('High < High[1] and Low > Low[1]')
  })
})

describe('a name saved in the formula wording is still automatic', () => {
  const model = (src, name) => ({
    name, scanKey: 'value',
    rows: [{ key: 'value', label: '', ast: P(src) }],
  })

  it('…so a maths edit moves it to the plain words, not freezes it as custom', () => {
    const before = namingSnapshot(model('rsi(close, 14) > 70', 'RSI 14 > 70'))
    expect(before.nameAuto).toBe(true)
    const after = model('rsi(close, 14) > 80', 'RSI 14 > 70')
    const changes = applyDerivedNaming(after, before, { renamedDefinition: false, renamedOutputs: new Set() })
    expect(after.name).toBe('RSI 14 above 80')
    expect(changes).toEqual([{ kind: 'name-derived', from: 'RSI 14 > 70', to: 'RSI 14 above 80' }])
  })

  it('…and a member\'s own name is still kept', () => {
    const before = namingSnapshot(model('rsi(close, 14) > 70', 'Overbought watch'))
    expect(before.nameAuto).toBe(false)
    const after = model('rsi(close, 14) > 80', 'Overbought watch')
    applyDerivedNaming(after, before, { renamedDefinition: false, renamedOutputs: new Set() })
    expect(after.name).toBe('Overbought watch')
  })

  it('a fresh create is named in the plain words', () => {
    expect(derivedDefName({ scanKey: 'value', rows: [{ key: 'value', ast: P('ema(close, 9) > ema(close, 20)') }] }))
      .toBe('EMA 9 above EMA 20')
  })
})
