// Data wave 4 (2026-11-17): the argument kinds of CONFL, ACCUM, PCHG and TSRC.
//
// args.js keeps its own small copies of vocabularies the panel models own (so the panels' code
// stays out of the shell's first-open bytes). This rail pins each copy to its owner.
import { describe, it, expect } from 'vitest'
import {
  ARG_KINDS, CONFLUENCE_LEAN_WORDS, REPEAT_ORDER_WORDS, PERIOD_RANGE_WORDS, PERIOD_SIDE_WORDS, PERIOD_UNIT_WORDS, ROTATION_SIDE_ARG_WORDS, applyArgs,
} from './args'
import { BY_CODE } from './functions'
import { CONFLUENCE_LEAN_ARG_WORDS, CONFLUENCE_LEANS, parseConfluenceLean } from './panels/confluenceModel'
import { REPEAT_ORDER_ARG_WORDS, REPEAT_ORDERS, parseRepeatOrder } from './panels/repeatContractsModel'
import {
  PERIOD_RANGE_ARG_WORDS, PERIOD_SIDE_ARG_WORDS, PERIOD_UNIT_ARG_WORDS, PERIOD_RANGES, PERIOD_SIDES, PERIOD_UNITS,
  parsePeriodRange, parsePeriodSide, parsePeriodUnit, parsePeriodDate, periodChangeCommandArgs,
} from './panels/periodChangeModel'
import { callSearchCommandArgs, parseCallQuery } from './panels/callSearchModel'
import { ROTATION_SIDE_WORDS, ROTATION_SIDES, parseRotationSide } from './panels/themeRotationModel'

const TODAY = { today: '2026-11-17' }

describe('data wave 4 argument kinds match the panels that own the words', () => {
  it.each([
    ['confluenceLean', CONFLUENCE_LEAN_WORDS, CONFLUENCE_LEAN_ARG_WORDS, parseConfluenceLean, CONFLUENCE_LEANS],
    ['repeatOrder', REPEAT_ORDER_WORDS, REPEAT_ORDER_ARG_WORDS, parseRepeatOrder, REPEAT_ORDERS],
    ['periodRange', PERIOD_RANGE_WORDS, PERIOD_RANGE_ARG_WORDS, parsePeriodRange, PERIOD_RANGES],
    ['periodSide', PERIOD_SIDE_WORDS, PERIOD_SIDE_ARG_WORDS, parsePeriodSide, PERIOD_SIDES],
    ['periodUnit', PERIOD_UNIT_WORDS, PERIOD_UNIT_ARG_WORDS, parsePeriodUnit, PERIOD_UNITS],
    ['rotationSide', ROTATION_SIDE_ARG_WORDS, ROTATION_SIDE_WORDS, parseRotationSide, ROTATION_SIDES],
  ])('%s: the copy equals the model, word for word, and every chip token is taken', (kind, copy, owner, parse, chips) => {
    expect(copy).toEqual(owner)
    for (const [word, value] of Object.entries(owner)) {
      expect(ARG_KINDS[kind].parse(word.toLowerCase()), word).toBe(value)
      expect(parse(word), word).toBe(value)
    }
    for (const [value, spec] of Object.entries(chips)) {
      if (spec.token) expect(ARG_KINDS[kind].parse(spec.token), value).toBe(value)
    }
    expect(ARG_KINDS[kind].parse('NVDA')).toBeNull()
    expect(ARG_KINDS[kind].describe(Object.values(owner)[0])).toBeTruthy()
  })

  it('PCHG: the date kind reads a date exactly as the panel model does', () => {
    for (const word of ['2026-01-02', '2026-1-2', '20260102', '1/2/2026', '12/31/1999', '2026-02-30', '2026-13-01', '1/2', 'YTD', '', 'NVDA',
      '1899-12-31', '2201-01-01', '2024-02-29', '2023-02-29']) {
      expect(ARG_KINDS.periodDate.parse(word), word).toBe(parsePeriodDate(word))
    }
    expect(ARG_KINDS.periodDate.parse('1/2/2026')).toBe('2026-01-02')
  })

  it('the registry applies each argument to the prop its panel reads', () => {
    const run = (code, tokens) => applyArgs(BY_CODE[code].market, tokens, TODAY)
    expect(run('CONFL', ['bear']).props).toEqual({ lean: 'bearish' })
    expect(run('CONFL', ['banana']).ignored).toEqual(['banana'])
    expect(run('TROT', ['out']).props).toEqual({ side: 'out' })
    expect(run('ACCUM', ['11/14', 'latest']).props).toEqual({ date: '2026-11-14', order: 'latest' })
    expect(run('ACCUM', ['latest']).props).toEqual({ order: 'latest' })
    expect(run('PCHG', ['qtd', 'losers']).props).toEqual({ range: 'qtd', side: 'losers' })
    // what to rank: sectors, industries or themes over the same dates
    expect(run('PCHG', ['qtd', 'sectors', 'losers']).props).toEqual({ range: 'qtd', unit: 'sector', side: 'losers' })
    expect(run('PCHG', ['themes']).props).toEqual({ unit: 'theme' })
    // two dates: the first typed is the start, the second the end
    expect(run('PCHG', ['2026-01-02', '2026-06-30']).props).toEqual({ start: '2026-01-02', end: '2026-06-30' })
    expect(run('PCHG', ['2026-01-02']).props).toEqual({ start: '2026-01-02' })
    expect(run('PCHG', ['2026-01-02', '2026-06-30', '2026-07-01']).ignored).toEqual(['2026-07-01'])
  })

  it('what each panel writes back is read as the same pick', () => {
    const run = (code, tokens) => applyArgs(BY_CODE[code].market, tokens, TODAY).props
    expect(run('PCHG', periodChangeCommandArgs({ range: 'qtd', side: 'losers' }))).toEqual({ range: 'qtd', side: 'losers' })
    expect(run('PCHG', periodChangeCommandArgs({ range: 'qtd', unit: 'industry', side: 'losers' }))).toEqual({ range: 'qtd', unit: 'industry', side: 'losers' })
    const dated = run('PCHG', periodChangeCommandArgs({ start: '2026-01-02', end: '2026-06-30' }))
    expect(dated.start).toBe('2026-01-02')
    expect(dated.end).toBe('2026-06-30')
  })

  it('TSRC: every typed word reaches the panel as one query, one-letter words included', () => {
    const run = (tokens) => applyArgs(BY_CODE.TSRC.market, tokens)
    expect(run(['pricing', 'power']).props).toEqual({ q: 'pricing power' })
    expect(run(['plan', 'b']).props).toEqual({ q: 'plan b' })
    expect(run(['plan', 'b']).ignored).toEqual([])
    expect(run([]).props).toEqual({})
    // the shell upper-cases what is typed: the words come back in lower case, so a plain "and"
    // is never handed to the search as the operator AND
    expect(run(['PRICING', 'AND', 'POWER']).props).toEqual({ q: 'pricing and power' })
    // the panel's own write-back is read as the same query, and the model accepts it
    expect(run(callSearchCommandArgs({ q: 'pricing  power' })).props).toEqual({ q: 'pricing power' })
    expect(parseCallQuery(run(['pricing', 'power']).props.q)).toBe('pricing power')
  })
})
