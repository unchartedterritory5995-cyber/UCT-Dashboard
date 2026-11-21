// app/src/components/chart/builder/authoring/derivedSettings.captions.test.js
//
// A SETTINGS ROW SAYS A FUNCTION IN PLAIN WORDS (2026-11-20). Seen in a live run: "WILLIAMSR 9 (High, Low)",
// "HIGHESTBARS 60", "PERCENTRANK 19" as the captions of a built indicator's numbers.
//
// ⛔ CAPTIONS ONLY. An indicator's NAME keeps its wording: a saved name is recognised as automatic by
// comparing it with the wording it was derived in (`namingSnapshot`), so these words must never reach a name.
import { describe, it, expect } from 'vitest'
import { parseFormula } from '../../engine/ast/parse'
import TABLE from '../../engine/ast/closedTable.json'
import { applyPatch } from './index'
import { settingsOf } from './derivedSettings'
import { nameOfTree, namingSnapshot, CAPTION_CALL_WORDS, PLAIN_CALL_WORDS } from './derivedName'
import { modelOf } from './model'

const P = (src) => { const r = parseFormula(src); if (!r.ok) throw new Error(`${src}: ${r.error}`); return r.ast }
const C = 'uct.authoring.patch/1'
const build = (src, name = 'x') => {
  const r = applyPatch(null, { contract: C, baseRevision: 0, assumptions: [], ops: [{ op: 'create', name, outputs: [{ key: 'v', label: 'v', tree: P(src) }] }] }, { gateCtx: { tf: 'D', symbol: 'AAPL' } })
  expect(r.status, `${src}: ${JSON.stringify(r.errors)}`).toBe('applied')
  return r.definition
}
const captions = (src) => settingsOf(build(src)).map((s) => s.caption)

/** formula → [the caption of its first setting, the same expression AS A NAME (unchanged)] */
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

describe('a settings row says its function in plain words', () => {
  it.each(ROWS)('%s', (src, caption, name) => {
    expect(captions(src)[0]).toBe(caption)
    expect(nameOfTree(P(src))).toBe(name)                                // the NAME is word for word what it was
  })

  it('the words carry into a caption that wraps the function, and into a level beside it', () => {
    expect(captions('ema(williamsR(high, low, close, 9), 9)')).toEqual(['Williams %R 9 (High, Low)', 'EMA 9 (Williams %R 9 (High, Low))'])
    expect(captions('barssince(close < sma(close, 50), 500)')).toEqual(['SMA 50', 'Bars since 500 (Close below SMA 50)'])
    expect(captions('sum(volume, 20) / 20')).toEqual(['Sum 20 (Volume)', 'Sum 20 (Volume) divided by 20'])
    expect(captions('cum(volume) / 1000000')).toEqual(['Running total (Volume) divided by 1000000'])
  })

  it('what a chart already says as an acronym is left alone', () => {
    expect(captions('sma(volume, 50)')).toEqual(['SMA 50 (Volume)'])
    expect(captions('rsi(close, 14) > 70')).toEqual(['RSI 14', 'RSI 14 above 70'])
    expect(captions('atr(high, low, close, 14)')).toEqual(['ATR 14 (High, Low)'])
    for (const fn of ['sma', 'ema', 'rsi', 'atr', 'wma', 'rma', 'hma', 'vwap', 'macd', 'adx', 'cci', 'mfi']) {
      expect(CAPTION_CALL_WORDS[fn], fn).toBeUndefined()
    }
  })

  it('a word never hides a difference: the TradingView form of a calculation says so', () => {
    expect(captions('atrPine(high, low, close, 14)')).toEqual(['ATR (TradingView) 14 (High, Low)'])
    expect(captions('stochPine(high, low, close, 14)')).toEqual(['Stochastic (TradingView) 14 (High, Low)'])
    expect(captions('mfiPine(high, low, close, volume, 14)')).toEqual(['MFI (TradingView) 14 (High, Low, Volume)'])
    for (const [ours, theirs] of [['atr(high, low, close, 14)', 'atrPine(high, low, close, 14)'], ['stoch(high, low, close, 14)', 'stochPine(high, low, close, 14)']]) {
      expect(captions(ours)[0]).not.toBe(captions(theirs)[0])
    }
    // and no two functions share a caption word unless they are forms of ONE idea, listed here by name
    const SAME_IDEA = [['valuewhen', 'valuewhenOccurrence'], ['accum2', 'accum3', 'accum4']]
    const byWord = new Map()
    for (const [fn, word] of Object.entries(CAPTION_CALL_WORDS)) byWord.set(word, [...(byWord.get(word) || []), fn])
    const shared = [...byWord.values()].filter((fns) => fns.length > 1).map((fns) => fns.sort())
    expect(shared.sort()).toEqual(SAME_IDEA.map((g) => [...g].sort()).sort())
  })

  it('every word is for a function the table really has, and is words (no engine name, no formula symbol)', () => {
    for (const [fn, word] of Object.entries(CAPTION_CALL_WORDS)) {
      expect(TABLE.functions[fn], `${fn} is not a function of the closed table`).toBeTruthy()
      expect(word).toMatch(/^[A-Z+-]/)                                   // starts like a caption
      expect(word, fn).not.toMatch(/[<>=?:[\]]/)
      expect(word.toUpperCase() === word && word.length > 4, `${fn}: "${word}" is still an upper-cased name`).toBe(false)
    }
    expect(Object.isFrozen(CAPTION_CALL_WORDS)).toBe(true)
  })
})

// 2026-11-21 (coordinator ruling on the ledger row): TWO word tables live in `derivedName.js`. `PLAIN_CALL_WORDS`
// is a function's word in a NAME and in a settings row; `CAPTION_CALL_WORDS` is a function's word in a settings
// row only. With a function in both, a row and a name could call it two different things.
describe('one word per function, across both word tables', () => {
  const call = (fn) => ({ type: 'call', name: fn, args: [{ type: 'num', value: 9 }] })

  it('no function is in both tables, and no word is used by both', () => {
    expect(Object.keys(PLAIN_CALL_WORDS).length).toBeGreaterThan(5)       // the name table is really read here
    expect(Object.keys(CAPTION_CALL_WORDS).filter((fn) => fn in PLAIN_CALL_WORDS)).toEqual([])
    const plainWords = new Set(Object.values(PLAIN_CALL_WORDS))
    expect(Object.entries(CAPTION_CALL_WORDS).filter(([, word]) => plainWords.has(word)).map(([fn]) => fn)).toEqual([])
  })

  it('a settings row says a function of the name table with that table\'s own word', () => {
    for (const [fn, word] of Object.entries(PLAIN_CALL_WORDS)) {
      const asName = nameOfTree(call(fn), 0, 'plain'), asCaption = nameOfTree(call(fn), 0, 'caption')
      expect(asName.startsWith(word), `${fn}: the name "${asName}" does not say "${word}"`).toBe(true)
      expect(asCaption, fn).toBe(asName)
    }
  })

  it('and a function of the caption table reads differently in a row than in a name (the table is doing something)', () => {
    for (const [fn, word] of Object.entries(CAPTION_CALL_WORDS)) {
      expect(nameOfTree(call(fn), 0, 'caption').startsWith(word), fn).toBe(true)
      expect(nameOfTree(call(fn), 0, 'plain').startsWith(word), `${fn}: the caption word reached a name`).toBe(false)
    }
  })
})

describe('⛔ the words never reach a name', () => {
  it('a name derived in either naming mode carries none of the caption words', () => {
    for (const [src, caption, name] of ROWS) {
      const word = caption.slice(0, caption.search(/ \d/))               // "Williams %R", "Bars since the highest", ...
      expect(word.length, caption).toBeGreaterThan(3)
      for (const mode of ['plain', 'formula']) {
        const got = nameOfTree(P(src), 0, mode)
        expect(got, `${src} in ${mode}`).not.toContain(word)
        expect(got, `${src} in ${mode}`).not.toBe(caption)
      }
      expect(nameOfTree(P(src))).toBe(name)                              // the default wording is the name's, as before
      expect(nameOfTree(P(src), 0, 'caption')).toBe(caption)             // and only the caption wording says the word
    }
  })

  it('a saved indicator whose name was derived before this change is still recognised as automatic', () => {
    const model = modelOf(build('williamsR(high, low, close, 9)'))
    // the name the product derives for this formula (and has been saving), word for word
    model.name = 'WILLIAMSR 9 (High, Low)'
    expect(namingSnapshot(model).nameAuto, 'a saved automatic name would be frozen as if the member had typed it').toBe(true)
    // CONTROL: the caption's wording is NOT a name the product ever derived, and a name a member typed is not automatic
    model.name = 'Williams %R 9 (High, Low)'
    expect(namingSnapshot(model).nameAuto).toBe(false)
    model.name = 'My oscillator'
    expect(namingSnapshot(model).nameAuto).toBe(false)
  })
})
