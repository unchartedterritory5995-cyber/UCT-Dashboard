// app/src/components/chart/builder/authoring/derivedSettings.captions.test.js
//
// A FUNCTION IS SAID IN PLAIN WORDS, THE SAME WORDS EVERYWHERE (2026-11-20, 2026-11-21).
//
// Seen in a live run: "WILLIAMSR 9 (High, Low)", "HIGHESTBARS 60", "PERCENTRANK 19" as the captions of a built
// indicator's numbers; and, once the builder's first answer opened with the names, "Built 1 line: PERCENTRANK
// 100." The settings rows got words on the first day and the names on the second, from ONE table
// (`derivedName.CALL_WORDS`): a row and a name can no longer call one function two different things.
//
// What a name SAVED in the older wording does is `derivedName.legacyWording.test.js`'s.
import { describe, it, expect } from 'vitest'
import { parseFormula } from '../../engine/ast/parse'
import TABLE from '../../engine/ast/closedTable.json'
import { applyPatch } from './index'
import { settingsOf } from './derivedSettings'
import { nameOfTree, CALL_WORDS, WORDED_BEFORE_2026_11_21 } from './derivedName'

const P = (src) => { const r = parseFormula(src); if (!r.ok) throw new Error(`${src}: ${r.error}`); return r.ast }
const C = 'uct.authoring.patch/1'
const build = (src, name = 'x') => {
  const r = applyPatch(null, { contract: C, baseRevision: 0, assumptions: [], ops: [{ op: 'create', name, outputs: [{ key: 'v', label: 'v', tree: P(src) }] }] }, { gateCtx: { tf: 'D', symbol: 'AAPL' } })
  expect(r.status, `${src}: ${JSON.stringify(r.errors)}`).toBe('applied')
  return r.definition
}
const captions = (src) => settingsOf(build(src)).map((s) => s.caption)

/** formula → the words of its first setting, which are also its NAME; and how the same formula read before */
const ROWS = [
  ['williamsR(high, low, close, 9)', 'Williams %R 9 (High, Low)', 'WILLIAMSR 9 (High, Low)'],
  ['highestbars(high, 60)', 'Bars since the highest 60 (High)', 'HIGHESTBARS 60 (High)'],
  ['percentrank(volume, 19)', 'Percent rank 19 (Volume)', 'PERCENTRANK 19 (Volume)'],
  ['stdev(close, 20)', 'Standard deviation 20', 'STDEV 20'],
  ['donchianUpper(high, low, 20)', 'Donchian upper 20 (High, Low)', 'DONCHIANUPPER 20 (High, Low)'],
  ['highest(high, 20)', 'Highest 20 (High)', 'HIGHEST 20 (High)'],
  ['median(close, 21)', 'Median 21', 'MEDIAN 21'],
  ['obvN(50)', 'On-balance volume change 50', 'OBVN 50'],
  ['stoch(high, low, close, 14)', 'Stochastic 14 (High, Low)', 'STOCH 14 (High, Low)'],
  ['valuewhen(close > high[1], close, 100)', 'Value when 100 (Close above previous High)', 'VALUEWHEN 100 (Close above previous High)'],
]

describe('a settings row and a name say a function in the same plain words', () => {
  it.each(ROWS)('%s', (src, words, before) => {
    expect(captions(src)[0]).toBe(words)                                 // the settings row
    expect(nameOfTree(P(src))).toBe(words)                               // the automatic name, the legend, the first answer
    expect(nameOfTree(P(src), 0, 'legacy')).toBe(before)                 // and the wording a name was SAVED in until 2026-11-21
    expect(words).not.toBe(before)
  })

  it('the words carry into a caption that wraps the function, and into a level beside it', () => {
    expect(captions('ema(williamsR(high, low, close, 9), 9)')).toEqual(['Williams %R 9 (High, Low)', 'EMA 9 (Williams %R 9 (High, Low))'])
    expect(captions('barssince(close < sma(close, 50), 500)')).toEqual(['SMA 50', 'Bars since 500 (Close below SMA 50)'])
    expect(captions('sum(volume, 20) / 20')).toEqual(['Sum 20 (Volume)', 'Sum 20 (Volume) divided by 20'])
    expect(captions('cum(volume) / 1000000')).toEqual(['Running total (Volume) divided by 1000000'])
    // and into a name built from more than one piece
    expect(nameOfTree(P('percentrank(close, 100) > 80'))).toBe('Percent rank 100 above 80')
    expect(nameOfTree(P('close / highest(high, 252)'))).toBe('Close divided by Highest 252 (High)')
  })

  it('what a chart already says as an acronym is left alone', () => {
    expect(captions('sma(volume, 50)')).toEqual(['SMA 50 (Volume)'])
    expect(captions('rsi(close, 14) > 70')).toEqual(['RSI 14', 'RSI 14 above 70'])
    expect(captions('atr(high, low, close, 14)')).toEqual(['ATR 14 (High, Low)'])
    for (const fn of ['sma', 'ema', 'rsi', 'atr', 'wma', 'rma', 'hma', 'vwap', 'macd', 'adx', 'cci', 'mfi']) {
      expect(CALL_WORDS[fn], fn).toBeUndefined()
      expect(nameOfTree({ type: 'call', name: fn, args: [{ type: 'num', value: 9 }] })).toBe(`${fn.toUpperCase()} 9`)
    }
  })

  it('a word never hides a difference: the TradingView form of a calculation says so', () => {
    expect(captions('atrPine(high, low, close, 14)')).toEqual(['ATR (TradingView) 14 (High, Low)'])
    expect(captions('stochPine(high, low, close, 14)')).toEqual(['Stochastic (TradingView) 14 (High, Low)'])
    expect(captions('mfiPine(high, low, close, volume, 14)')).toEqual(['MFI (TradingView) 14 (High, Low, Volume)'])
    for (const [ours, theirs] of [['atr(high, low, close, 14)', 'atrPine(high, low, close, 14)'], ['stoch(high, low, close, 14)', 'stochPine(high, low, close, 14)']]) {
      expect(captions(ours)[0]).not.toBe(captions(theirs)[0])
      expect(nameOfTree(P(ours))).not.toBe(nameOfTree(P(theirs)))
    }
    // and no two functions share a word unless they are forms of ONE idea, listed here by name
    const SAME_IDEA = [['valuewhen', 'valuewhenOccurrence'], ['accum2', 'accum3', 'accum4']]
    const byWord = new Map()
    for (const [fn, word] of Object.entries(CALL_WORDS)) byWord.set(word, [...(byWord.get(word) || []), fn])
    const shared = [...byWord.values()].filter((fns) => fns.length > 1).map((fns) => fns.sort())
    expect(shared.sort()).toEqual(SAME_IDEA.map((g) => [...g].sort()).sort())
  })

  it('every word is words (no engine name, no formula symbol), and every function given one since 2026-11-20 is in the closed table', () => {
    for (const [fn, word] of Object.entries(CALL_WORDS)) {
      // (the thirteen worded before that day name pieces of library indicators as well as table functions)
      if (!WORDED_BEFORE_2026_11_21.includes(fn)) expect(TABLE.functions[fn], `${fn} is not a function of the closed table`).toBeTruthy()
      expect(word).toMatch(/^[A-Z+-]/)                                    // starts like a caption
      expect(word, fn).not.toMatch(/[<>=?:[\]]/)
      expect(word.toUpperCase() === word && word.length > 4, `${fn}: "${word}" is still an upper-cased name`).toBe(false)
    }
    expect(Object.isFrozen(CALL_WORDS)).toBe(true)
    expect(Object.keys(CALL_WORDS).length).toBeGreaterThan(50)
  })
})

// ONE TABLE, so there is nothing for two tables to disagree about: what is held instead is that the two
// surfaces read it the same way, for every function it names.
describe('one word per function, in a name and in a settings row alike', () => {
  const call = (fn) => ({ type: 'call', name: fn, args: [{ type: 'num', value: 9 }] })

  it('every function of the table reads with its word in the default wording, which is the name\'s and the row\'s', () => {
    for (const [fn, word] of Object.entries(CALL_WORDS)) {
      expect(nameOfTree(call(fn)), fn).toBe(`${word} 9`)
      expect(nameOfTree(call(fn), 0, 'plain'), fn).toBe(`${word} 9`)
      expect(nameOfTree(call(fn), 0, 'formula'), fn).toBe(`${fn.toUpperCase()} 9`)      // the formula wording never had words
    }
  })

  it('the settings rows are derived in that same default wording (there is no separate caption wording any more)', () => {
    for (const [src] of ROWS) expect(captions(src)[0]).toBe(nameOfTree(P(src)))
    expect(ROWS.map(([, words]) => words).every((w) => typeof w === 'string')).toBe(true)
    // a wording nobody defines falls back to the default, never to a third vocabulary
    expect(nameOfTree(call('percentrank'), 0, 'caption')).toBe('Percent rank 9')
  })
})
