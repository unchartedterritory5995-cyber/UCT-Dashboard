// UCT Agent — period, session and study words are never tickers; a real symbol spelled the same still is.
// "show YTD" used to reach chart.setSymbol as the ticker YTD and came back "UCT has no symbol".
import { describe, it, expect } from 'vitest'
import process from 'node:process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { registerBuiltins } from './builtins'
import { fastParse } from './fastPath'
import { isReservedWord, RESERVED_WORDS } from './nl/tickers'
import { plainSymbolWord } from './nl/lexicon'
import { tickersIn } from './multiChart'
import { parseTickers } from './capabilities/watchlist'
import { newChartTicker, newChartRequest } from './capabilities/workspace'
import { parsePriceSentence } from './capabilities/marketDataPhrases'
import { tickerWordsOf } from './nlm1/capabilityIndex'
import { makeBoard } from './__fixtures__/board'

registerBuiltins()
const board = () => makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 }], { A: 'NVDA' }, { watchlists: [{ id: 's1', name: 'Swing', symbols: ['TSLA'] }] })
const ops = (text) => { const f = fastParse(text, { host: board().host }); return f?.kind === 'ops' ? f.ops.map(o => [o.action, o.args]) : f }
const setSymbol = (symbol) => [['chart.setSymbol', { symbol }]]
const listOf = (file) => JSON.parse(readFileSync(resolve(process.cwd(), '..', 'api', 'data', file), 'utf8')).map(s => String(s).toUpperCase())

describe('the reserved list holds only words no symbol carries (AUDIT rule: tested against UCT\'s symbol universe)', () => {
  const universe = new Set([...listOf('cap_universe.json'), ...listOf('prebuilt_etfs.json')])
  it('the universe was really read', () => expect(universe.size).toBeGreaterThan(3000))
  it.each([...RESERVED_WORDS])('%s is no symbol UCT lists', (w) => expect(universe.has(w.toUpperCase())).toBe(false))
  // the words left OUT on purpose: if one of these stops being a symbol, it can move to the reserved list
  it.each(['MTD', 'LTM', 'MAX'])('%s IS a real symbol, so it must not be reserved', (w) => {
    expect(universe.has(w)).toBe(true)
    expect(isReservedWord(w)).toBe(false)
  })
})

describe('isReservedWord', () => {
  it.each([['YTD', true], ['ytd', true], ['Ytd', true], ['MACD', true], ['$YTD', false], ['$ytd', false], ['MTD', false], ['NVDA', false], ['', false], [null, false]])(
    '%s → %s', (w, want) => expect(isReservedWord(w)).toBe(want))
})

describe('chart.setSymbol: a reserved word is left to the model, in every verb and spelling', () => {
  it.each(['show YTD', 'Show YTD', 'Show YTD.', 'show YTD on the chart', 'open YTD', 'load YTD', 'chart YTD', 'pull up YTD', 'put YTD',
    'go to YTD', 'switch to YTD', 'change to YTD', 'flip it to YTD', 'switch to ytd', 'chart ytd', 'pull up ytd',
    'show QTD', 'show WTD', 'show TTM', 'show NTM', 'show MONTH', 'show TODAY', 'show HOD', 'show ATH', 'show YOY', 'show MACD', 'show VWAP', 'show OHLC',
  ])('“%s” is not a ticker', (text) => expect(ops(text)).toBeNull())

  it.each([
    ['$YTD', 'YTD'], ['$ytd', 'YTD'], ['show $YTD', 'YTD'], ['open $QTD', 'QTD'],
    ['change the ticker to YTD', 'YTD'], ['change the symbol to ytd', 'YTD'], ['set ticker to TTM', 'TTM'], ['switch the ticker to macd', 'MACD'],
  ])('“%s” SAYS ticker, so %s is tried (and the ticker search decides)', (text, sym) => expect(ops(text)).toEqual(setSymbol(sym)))

  it.each([['show MTD', 'MTD'], ['open MTD', 'MTD'], ['chart LTM', 'LTM'], ['go to MAX', 'MAX'], ['$MTD', 'MTD'], ['$mtd', 'MTD'], ['change the ticker to mtd', 'MTD'], ['show NVDA', 'NVDA'], ['open AMD', 'AMD']])(
    'real symbol in capitals or with $: “%s” → %s', (text, sym) => expect(ops(text)).toEqual(setSymbol(sym)))

  it.each(['switch to mtd', 'change to ltm', 'switch to max', 'pull up max'])('a real symbol that is also a range, in lowercase: “%s” is not PLAINLY a symbol', (text) => {
    expect(ops(text)).toBeNull()
  })
  it('a lowercase ticker after a chart verb still works; so does the existing pronoun rule', () => {
    expect(ops('pull up nvda')).toEqual(setSymbol('NVDA'))
    expect(ops('chart amd')).toEqual(setSymbol('AMD'))
    expect(ops('open IT')).toEqual(setSymbol('IT'))
    expect(plainSymbolWord('nvda', board().host)).toBe(true)
    expect(plainSymbolWord('ytd', board().host)).toBe(false)
  })
})

describe('every other reader of a typed ticker follows the same rule', () => {
  it('a new chart', () => {
    for (const t of ['add a YTD chart', 'open a chart of YTD', 'open a new TTM chart']) {
      expect(newChartTicker(t)).toBeNull()
      expect(ops(t)).toBeNull()
    }
    expect(newChartRequest('open a chart of $YTD')).toMatchObject({ symbol: 'YTD' })
    expect(newChartRequest('show YTD in a new chart')).toBeNull()
    expect(newChartRequest('show $YTD in a new chart')).toMatchObject({ symbol: 'YTD' })
    expect(newChartRequest('show MTD in a new chart')).toMatchObject({ symbol: 'MTD' })
    expect(newChartTicker('add a MTD chart')).toBe('MTD')
    expect(newChartTicker('add a NVDA chart')).toBe('NVDA')
  })
  it('a watchlist list of symbols: never a partial list, $ and real symbols kept', () => {
    expect(parseTickers('YTD')).toBeNull()
    expect(parseTickers('AMD and ytd')).toBeNull()
    expect(parseTickers('$YTD')).toEqual(['YTD'])
    expect(parseTickers('MTD, mtd')).toEqual(['MTD', 'MTD'])
    expect(ops('add YTD to swing')).toBeNull()
    expect(ops('add MTD to swing')).toEqual([['watchlist.add', { symbols: ['MTD'] }]])
  })
  it('several tickers in one sentence', () => {
    expect(tickersIn('show NVDA YTD')).toEqual(['NVDA'])
    expect(tickersIn('NVDA and $YTD')).toEqual(['NVDA', 'YTD'])
    expect(tickersIn('NVDA and MTD')).toEqual(['NVDA', 'MTD'])
  })
  it('the follow-up and routing reader', () => {
    expect(tickerWordsOf('YTD')).toEqual([])
    expect(tickerWordsOf('$YTD')).toEqual(['YTD'])
    expect(tickerWordsOf('NVDA YTD')).toEqual(['NVDA'])
    expect(tickerWordsOf('(NVDA, $AMD)')).toEqual(['NVDA', 'AMD'])
    expect(tickerWordsOf('MTD')).toEqual(['MTD'])
  })
  it('a price question: a period word is a time the parser cannot resolve, never a quote for it or for the other ticker alone', () => {
    for (const t of ['how is ttm trading', 'what is NTM at', 'price of nvda ttm', 'price of nvda wtd', 'nvda ytd', 'ytd price']) expect(parsePriceSentence(t)).toBeNull()
    expect(parsePriceSentence('price of nvda')).toMatchObject({ intent: 'quote', candidates: [{ text: 'nvda' }] })
  })
})
