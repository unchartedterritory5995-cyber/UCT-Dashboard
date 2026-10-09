// useMyTickers (wave 3 lane 13, product item #6): "my names" is the calendar's My Stocks set, the
// union of the sources the member counts, upper-cased; and the explainer says how it is built.
import { describe, it, expect } from 'vitest'
import { MY_SOURCES_DEFAULT, myNamesExplainer, mySymbols } from './useMyTickers'
import { ARG_KINDS, MINE_MARKER, applyArgs, argsEcho } from '../pages/terminal/args'
import { BY_CODE } from '../pages/terminal/functions'

describe('mySymbols', () => {
  const sets = { watchlist: ['nvda', 'AMD'], flagged: ['AAPL', 'NVDA'], positions: ['TSLA'], uct20: ['SMCI'], weight_buckets: [] }
  it('unions the counted sources, upper-cased and de-duplicated', () => {
    expect([...mySymbols(sets)].sort()).toEqual(['AAPL', 'AMD', 'NVDA', 'SMCI', 'TSLA'])
  })
  it('honours the member\'s narrowed source list (the calendar Filters choice)', () => {
    expect([...mySymbols(sets, ['positions'])]).toEqual(['TSLA'])
  })
  it('is empty, never a throw, on a missing or odd payload', () => {
    expect(mySymbols(null).size).toBe(0)
    expect(mySymbols({ watchlist: 'NVDA' }).size).toBe(0)
  })
})

describe('myNamesExplainer', () => {
  it('names every counted source in plain words', () => {
    const t = myNamesExplainer(MY_SOURCES_DEFAULT)
    expect(t).toMatch(/your watchlists, names you flagged, your broker positions and the UCT 20/)
    expect(t).toMatch(/calendar's My Stocks/)
  })
  it('a single source reads as one phrase', () => {
    expect(myNamesExplainer(['flagged'])).toMatch(/"Your names" are names you flagged/)
  })
})

describe('the MINE argument', () => {
  it('parses only the marker word', () => {
    expect(MINE_MARKER).toBe('MINE')
    expect(ARG_KINDS.mine.parse('mine')).toBe(true)
    expect(ARG_KINDS.mine.parse('MINES')).toBeNull()
  })
  it('every Mine-capable function takes it, and it is echoed as applied', () => {
    for (const [code, side] of [['CAL', 'market'], ['MOST', 'market'], ['FREC', 'market'], ['CN', 'ticker'], ['FEED', 'ticker']]) {
      const r = applyArgs(BY_CODE[code][side], ['MINE'])
      expect(r.props, code).toEqual({ mine: true })
      expect(argsEcho(code, r)).toBe(`${code}: applied only your names.`)
    }
  })
  it('a function that does not take it says so (never silent)', () => {
    expect(applyArgs(BY_CODE.FA.ticker, ['MINE']).ignored).toEqual(['MINE'])
  })
})
