// The seasonality board (2026-11-20): the argument kind of SEASB, and the code's shape.
//
// args.js keeps its own small copy of the vocabulary the panel model owns (so the panel's code
// stays out of the shell's first-open bytes). This rail pins the copy to its owner.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ARG_KINDS, SEAS_MEASURE_WORDS, applyArgs } from './args'
import { BY_CODE, FUNCTIONS, isCode, variantFor } from './functions'
import parseCommand from './parseCommand'
import { writeBackCommand } from './panels/commandWriteBack'
import {
  SEASB_CODE, SEAS_MEASURES, SEAS_MEASURE_ARG_WORDS, parseSeasMeasure, seasonalityBoardCommandArgs,
} from './panels/seasonalityBoardModel'

describe('the measure matches the panel that owns the words', () => {
  it('the copy equals the model, word for word, and every menu token is taken', () => {
    expect(SEAS_MEASURE_WORDS).toEqual(SEAS_MEASURE_ARG_WORDS)
    expect(Object.keys(SEAS_MEASURE_ARG_WORDS).sort()).toEqual(['AVERAGE', 'AVG', 'MEAN', 'MEDIAN'])
    for (const [word, value] of Object.entries(SEAS_MEASURE_ARG_WORDS)) {
      expect(ARG_KINDS.seasMeasure.parse(word.toLowerCase()), word).toBe(value)
      expect(parseSeasMeasure(word), word).toBe(value)
    }
    for (const [key, spec] of Object.entries(SEAS_MEASURES)) if (spec.token) expect(ARG_KINDS.seasMeasure.parse(spec.token), key).toBe(key)
    for (const no of ['NVDA', 'toString', 'constructor', '', 'MED', 'UP']) expect(ARG_KINDS.seasMeasure.parse(no), no).toBeNull()
    expect(ARG_KINDS.seasMeasure.describe('average')).toBe('the average month')
    expect(ARG_KINDS.seasMeasure.describe('median')).toBe('the median month')
    expect(ARG_KINDS.seasMeasure.takes).toBe('AVG or MEDIAN')
  })

  it('the registry applies the word to the prop the panel reads, and says what it did not take', () => {
    const run = (tokens) => applyArgs(BY_CODE.SEASB.market, tokens)
    expect(run(['avg']).props).toEqual({ measure: 'average' })
    expect(run(['MEAN']).props).toEqual({ measure: 'average' })
    expect(run(['MEDIAN']).props).toEqual({ measure: 'median' })
    expect(run(['banana']).ignored).toEqual(['banana'])
    expect(run(['AVG', 'MEDIAN']).ignored).toEqual(['MEDIAN'])     // one measure: the second is said, not dropped
    // what the panel writes back is read as the same pick, and the default is the bare command
    for (const key of Object.keys(SEAS_MEASURES)) {
      const tokens = seasonalityBoardCommandArgs({ measure: key })
      expect(run(tokens).props).toEqual(key === 'median' ? {} : { measure: key })
      expect(writeBackCommand('SEASB', tokens)).toBe(['SEASB', ...tokens].join(' '))
    }
    expect(seasonalityBoardCommandArgs({ measure: 'average' })).toEqual(['AVG'])
    expect(seasonalityBoardCommandArgs({ measure: 'nonsense' })).toEqual([])
  })
})

describe('the code', () => {
  it('SEASB is market-wide, in the Market group, behind the switch SEAS uses, and the model names it', () => {
    expect(SEASB_CODE).toBe('SEASB')
    expect(BY_CODE.SEASB.market).toEqual({ panel: 'SeasonalityBoard', flag: 'seasonalityEnabled', args: [{ kind: 'seasMeasure', prop: 'measure' }] })
    expect(BY_CODE.SEASB.ticker).toBeUndefined()
    expect(BY_CODE.SEASB.group).toBe('Market')
    expect(BY_CODE.SEASB.label).toBe('Seasonality board (index and sector funds, month by month)')
    expect(BY_CODE.SEASB.example).toBe('SEASB')
    expect(variantFor('SEASB', false)).toMatchObject({ scope: 'market' })
    // the one-stock view keeps its own code, panel and the same switch
    expect(BY_CODE.SEAS.ticker).toMatchObject({ panel: 'Seasonality', flag: 'seasonalityEnabled' })
    expect(BY_CODE.SEAS.market).toBeUndefined()
  })

  it('the words a member would type find it', () => {
    for (const words of ['seasonality board', 'sector seasonality', 'best months']) {
      expect(BY_CODE.SEASB.keywords, words).toContain(words)
    }
  })

  it('the bare code and a measure after it both parse as the market function', () => {
    expect(parseCommand('SEASB')).toMatchObject({ ok: true, type: 'function', code: 'SEASB', sym: null, args: [] })
    expect(parseCommand('seasb avg')).toMatchObject({ ok: true, type: 'function', code: 'SEASB', sym: null, args: ['AVG'] })
    expect(parseCommand('SEASB MEDIAN')).toMatchObject({ ok: true, type: 'function', code: 'SEASB', sym: null, args: ['MEDIAN'] })
    // a fund's own seasonality, which a row of the board opens
    expect(parseCommand('XLK SEAS')).toMatchObject({ ok: true, type: 'function', code: 'SEAS', sym: 'XLK' })
  })

  it('no measure word is a function code, and the code is not a word another code takes', () => {
    // a code in second place makes the first token a ticker, so a measure word that was a code
    // would turn `SEASB AVG` into "the AVG function on a ticker called SEASB"
    for (const word of Object.keys(SEAS_MEASURE_ARG_WORDS)) expect(isCode(word), word).toBe(false)
    expect(isCode('SEAS')).toBe(true)                               // the control: isCode can say yes
    for (const [kind, spec] of Object.entries(ARG_KINDS)) {
      expect(spec.parse('SEASB', { today: '2026-11-20' }) == null || kind === 'symbol' || /Name|Query|code/i.test(kind), `${kind} takes SEASB`).toBe(true)
    }
  })

  it('the code and its measure words are not stocks the site follows', () => {
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.size).toBeGreaterThan(3000)
    expect(universe.has('NVDA')).toBe(true)                         // the control: the list is the ticker list
    expect(universe.has('SEASB')).toBe(false)
    for (const word of Object.keys(SEAS_MEASURE_ARG_WORDS)) expect(universe.has(word), word).toBe(false)
    expect(FUNCTIONS.filter((f) => f.code === 'SEASB')).toHaveLength(1)
    expect('SEASB').toMatch(/^[A-Z]{2,6}$/)
  })
})
