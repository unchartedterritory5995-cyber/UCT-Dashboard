// MKTH (2026-11-21): the code's shape in the registry, its one argument (the index), how it parses,
// the words that find it, and that it is not a stock.
//
// args.js keeps its own copy of the panel model's index words (so the panel's code stays out of the
// shell's first-open bytes); this rail pins the copy to its owner.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { ARG_KINDS, MKTH_INDEX_ARG_WORDS, applyArgs } from './args'
import { BY_CODE, FUNCTIONS, FUNCTION_GROUPS, codesForWords, exampleFor, isCode, variantFor } from './functions'
import { isTickerCollision } from './grammar'
import parseCommand from './parseCommand'
import { PANEL_IMPORTERS } from './panels'
import { writeBackCommand } from './panels/commandWriteBack'
import { MKTH_CODE, MKTH_INDEX_WORDS, mkthCommandArgs, parseMkthIndex } from './panels/marketHistoryModel'

describe('MKTH in the registry', () => {
  it('the model names the code; it is registered once, in the Market group, market-wide, with one argument', () => {
    expect(MKTH_CODE).toBe('MKTH')
    expect(FUNCTIONS.filter((f) => f.code === 'MKTH')).toHaveLength(1)
    expect(FUNCTION_GROUPS).toContain(BY_CODE.MKTH.group)
    expect(BY_CODE.MKTH.group).toBe('Market')
    expect(BY_CODE.MKTH.label).toBe('Market history (every correction and bear market, the rallies and their leaders)')
    expect(BY_CODE.MKTH.market).toEqual({ panel: 'MarketHistory', args: [{ kind: 'mkthIndex', prop: 'index' }] })
    expect(BY_CODE.MKTH.market.flag).toBeUndefined()                 // no switch: the route has its own paid gate
    expect(BY_CODE.MKTH.ticker).toBeUndefined()
    expect(exampleFor(BY_CODE.MKTH)).toBe('MKTH')
    expect(variantFor('MKTH', false)).toMatchObject({ scope: 'market' })
    expect(typeof PANEL_IMPORTERS.MarketHistory).toBe('function')
  })

  it('the shell\'s copy of the index words is the model\'s, and both read a token the same way', () => {
    expect({ ...MKTH_INDEX_ARG_WORDS }).toEqual({ ...MKTH_INDEX_WORDS })
    for (const tok of [...Object.keys(MKTH_INDEX_WORDS), 'spx', ' ndx ', 'Qqq', 'DJX', 'RUT', '', 'S&P', null, undefined]) {
      expect(ARG_KINDS.mkthIndex.parse(tok), String(tok)).toBe(parseMkthIndex(tok))
    }
    expect(ARG_KINDS.mkthIndex.describe('NDX')).toBe('the Nasdaq-100')
    expect(ARG_KINDS.mkthIndex.describe('SPX')).toBe('the S&P 500')
    expect(ARG_KINDS.mkthIndex.takes).toBe('an index (SPX for the S&P 500, NDX for the Nasdaq-100)')
  })

  it('the registry applies the index to the prop the panel reads, says what it did not take, and the write-back reads the same', () => {
    const run = (tokens) => applyArgs(BY_CODE.MKTH.market, tokens)
    expect(run(['NDX']).props).toEqual({ index: 'NDX' })
    expect(run(['nasdaq']).props).toEqual({ index: 'NDX' })
    expect(run(['SPX']).applied).toEqual(['the S&P 500'])
    expect(run([]).props).toEqual({})
    expect(run(['DOW']).ignored).toEqual(['DOW'])
    expect(run(['NDX', 'SPX']).ignored).toEqual(['SPX'])             // one index: the second is said, not dropped
    expect(writeBackCommand('MKTH', mkthCommandArgs({ index: 'NDX' }))).toBe('MKTH NDX')
    expect(writeBackCommand('MKTH', mkthCommandArgs({ index: 'SPX' }))).toBe('MKTH')
    expect(parseCommand(writeBackCommand('MKTH', ['NDX']))).toMatchObject({ ok: true, code: 'MKTH', sym: null, args: ['NDX'] })
  })

  it('MKTH parses as the function, lower case too, and an index word after it is an argument, never a ticker', () => {
    expect(isCode('mkth')).toBe(true)
    expect(parseCommand('MKTH')).toMatchObject({ ok: true, type: 'function', code: 'MKTH', sym: null, args: [] })
    expect(parseCommand('mkth ndx')).toMatchObject({ ok: true, type: 'function', code: 'MKTH', sym: null, args: ['NDX'] })
    for (const word of Object.keys(MKTH_INDEX_WORDS)) {
      expect(isCode(word), word).toBe(false)
      expect(parseCommand(`MKTH ${word}`), word).toMatchObject({ ok: true, code: 'MKTH', sym: null, args: [word] })
    }
    expect(isCode('RATES')).toBe(true)                               // the control: isCode can say yes
    expect(parseCommand('MKTH').collision).toBeUndefined()
  })

  it('its words find it, and the words other functions answer to stay theirs', () => {
    for (const w of ['market history', 'corrections', 'bear market', 'drawdowns', 'rallies', 'past corrections', 'rally leaders']) {
      expect([w, codesForWords(w)[0]]).toEqual([w, 'MKTH'])
    }
    // its words take no word another function already answers to first
    expect(codesForWords('history')[0]).not.toBe('MKTH')
    expect(codesForWords('leaders')[0]).not.toBe('MKTH')
    expect(codesForWords('market')[0]).not.toBe('MKTH')
    expect(codesForWords('days like today')[0]).toBe('ANLG')
  })

  it('the code is not a stock the site follows', () => {
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.size).toBeGreaterThan(3000)
    expect(universe.has('NVDA')).toBe(true)                          // the control: the list is the ticker list
    expect(universe.has('MKTH')).toBe(false)
    expect(isTickerCollision('MKTH')).toBe(false)
  })
})
