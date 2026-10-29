// ⭐ THE NATIVE FORMULA'S SURFACE SPELLINGS — `and` / `or` / `not`, `if(c, a, b)` and
// `na` — each canonicalise to a node the table ALREADY declares, so the stored tree
// (and its `astHash`, Python's walker, the budget and the linter) is the one the
// symbolic spelling produces. These rails pin "same tree", the precedence, the
// refusals, and the dialect door that used to send `and` to the TC2000 reader.
import { describe, it, expect } from 'vitest'
import { parseFormula, astHash, WORD_OPERATORS } from './parse.js'
import { interpret } from './interpret.js'
import { detectDialect } from './dialect.js'
import { readFormulaSource } from './pcf.js'
import { evaluateFormula } from '../../builder/FormulaField.jsx'

const tree = (s) => {
  const r = parseFormula(s)
  expect(r.ok, `${s}: ${r.error}`).toBe(true)
  return r.ast
}
const sameTree = (a, b) => {
  expect(tree(a)).toEqual(tree(b))
  expect(astHash(tree(a))).toBe(astHash(tree(b)))
}

const BARS = Array.from({ length: 120 }, (_, i) => {
  const c = 100 + 8 * Math.sin(i / 7) + i * 0.1
  return { t: 1700000000 + i * 86400, o: c - 0.5 + (i % 3) * 0.4, h: c + 1, l: c - 1, c, v: 1e6 + (i % 11) * 2e5 }
})

describe('and / or / not', () => {
  it.each([
    ['close > open and volume > 1000', 'close > open && volume > 1000'],
    ['close > open AND volume > 1000', 'close > open && volume > 1000'],
    ['close > open or close < open', 'close > open || close < open'],
    ['close > open OR close < open', 'close > open || close < open'],
    ['not (close > open)', '!(close > open)'],
    ['NOT (close > open)', '!(close > open)'],
    ['not close > open', '!close > open'],
  ])('%s is the same tree as %s', sameTree)

  it('binds exactly as && and || do', () => {
    sameTree('close > 1 or close > 2 and close > 3', 'close > 1 || close > 2 && close > 3')
    sameTree('(close > 1 or close > 2) and close > 3', '(close > 1 || close > 2) && close > 3')
    sameTree('close > 1 and close > 2 or close > 3', 'close > 1 && close > 2 || close > 3')
  })

  it('a word inside a name is still a name', () => {
    expect(tree('android > 1')).toEqual({ type: 'op', name: '>', args: [{ type: 'series', name: 'android' }, { type: 'num', value: 1 }] })
    expect(tree('notable > 1').args[0]).toEqual({ type: 'series', name: 'notable' })
    expect(tree('orders > 1').args[0]).toEqual({ type: 'series', name: 'orders' })
  })

  it('every alias names a table operator', () => {
    for (const op of Object.values(WORD_OPERATORS)) expect(['&&', '||']).toContain(op)
  })
})

describe('if(condition, a, b)', () => {
  it('is the ternary', () => {
    sameTree('if(close > open, 1, -1)', 'close > open ? 1 : -1')
    sameTree('if(close > open, close, if(close < open, open, na))', 'close > open ? close : (close < open ? open : na)')
  })
  it.each(['if(close > open, 1)', 'if(close > open, 1, 2, 3)', 'if()'])('%s is refused by its own sentence', (s) => {
    const r = parseFormula(s)
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('canonicalise:if')
    expect(r.error).toMatch(/exactly three parts/)
  })
})

describe('na — no value', () => {
  it('is 0 / 0, the spelling the Pine translator writes for Pine\'s `na`', () => {
    expect(tree('na')).toEqual({ type: 'op', name: '/', args: [{ type: 'num', value: 0 }, { type: 'num', value: 0 }] })
    sameTree('close > open ? close : na', 'close > open ? close : 0 / 0')
  })

  it('the FUNCTION na(x) is untouched', () => {
    expect(tree('na(close)')).toEqual({ type: 'call', name: 'na', args: [{ type: 'series', name: 'close' }] })
  })

  it('"show the close only when it is above its 50 SMA" — a value exactly where the condition holds', () => {
    const out = Array.from(interpret(tree('close > sma(close, 50) ? close : na'), BARS, {}))
    const sma = Array.from(interpret(tree('sma(close, 50)'), BARS, {}))
    let shown = 0
    let hidden = 0
    for (let i = 49; i < BARS.length; i += 1) {
      if (BARS[i].c > sma[i]) { expect(out[i]).toBe(BARS[i].c); shown += 1 } else { expect(out[i]).toBeNaN(); hidden += 1 }
    }
    expect(shown).toBeGreaterThan(5)
    expect(hidden).toBeGreaterThan(5)
  })
})

describe('the dialect door — a native formula with `and` is read as native', () => {
  it.each([
    ['close > open and volume > 1000', 'formula'],
    ['close > open AND volume > 1000', 'formula'],
    ['ema(close, 9) > ema(close, 20) and rsi(close, 14) > 50', 'formula'],
    ['not (close > open)', 'formula'],
    // TC2000 keeps its own door — these never write a whole lower-case price word
    ['c > avgc50 and v > 1000000', 'pcf'],
    ['C > AVGC20 AND V > 100000', 'pcf'],
    ['XAVGC9 > XAVGC20', 'pcf'],
  ])('%s → %s', (source, dialect) => {
    expect(detectDialect(source)).toBe(dialect)
  })

  it('the native door reads it to the && tree (it used to answer "`close` is not a TC2000 name")', () => {
    const { result } = readFormulaSource('close > open and volume > 1000', 'native')
    expect(result.ok).toBe(true)
    expect(result.ast.name).toBe('&&')
  })

  it('end to end at the formula sheet: saveable, with an and/or read-back', () => {
    const r = evaluateFormula('ema(close, 9) > ema(close, 20) and rsi(close, 14) > 50', {})
    expect(r.ok).toBe(true)
    expect(r.error).toBeNull()
  })
})
