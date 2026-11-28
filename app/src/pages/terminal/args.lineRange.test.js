// LIQ / OIL (settings pass, 2026-11-28): the line's span as a typed argument. `LIQ 5Y`, `OIL 1Y`; bare is two years.
//
// args.js keeps its own copy of the words both panel models own (so neither panel's code rides the shell's
// first-open bytes); this rail pins the copy to both owners, word for word, checks no word is a function code, a
// stock the site follows or COT's market word, and that a chip's write-back is a command the registry applies.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { ARG_KINDS, LINE_RANGE_WORDS, applyArgs, argsEcho } from './args'
import { BY_CODE, isCode } from './functions'
import parseCommand from './parseCommand'
import { writeBackCommand } from './panels/commandWriteBack'
import { COT_WORDS } from './panels/cotModel'
import * as liq from './panels/liquidityModel'
import * as oil from './panels/oilModel'

const universe = () => new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))

describe('the line span words', () => {
  it('args.js keeps an exact copy of both models\' words, and the two models agree on the spans', () => {
    expect(LINE_RANGE_WORDS).toEqual(liq.LINE_RANGE_ARG_WORDS)
    expect(LINE_RANGE_WORDS).toEqual(oil.LINE_RANGE_ARG_WORDS)
    expect(liq.LINE_RANGES).toEqual(oil.LINE_RANGES)
    expect(liq.DEFAULT_LINE_RANGE).toBe('2y')
    expect(oil.DEFAULT_LINE_RANGE).toBe('2y')
    // the default span is today's line: the same weeks and the same 25-month read as before
    expect(liq.LINE_RANGES['2y'].weeks).toBe(liq.LINE_WEEKS)
    expect(oil.LINE_RANGES['2y'].weeks).toBe(oil.LINE_WEEKS)
    expect(liq.historyUrls('2026-11-28')).toEqual(liq.historyUrls('2026-11-28', '2y'))
    expect(oil.historyUrls('2026-11-28')).toEqual(oil.historyUrls('2026-11-28', '2y'))
  })

  it('no word is a function code or a stock the site follows; 2Y and 5Y are also COT market words, and that is safe', () => {
    const u = universe()
    expect(u.has('NVDA')).toBe(true)
    for (const w of Object.keys(LINE_RANGE_WORDS)) expect([w, isCode(w), u.has(w)]).toEqual([w, false, false])
    // COT's words are read only by COT's own argument kind (args.js cotMarket), never by another variant, so `COT 2Y`
    // stays the 2-year note futures and `LIQ 2Y` is the two-year line (and the same for 5Y).
    expect(Object.keys(LINE_RANGE_WORDS).filter((w) => Object.prototype.hasOwnProperty.call(COT_WORDS, w))).toEqual(['2Y', '5Y'])
    expect(parseCommand('LIQ 2Y')).toMatchObject({ ok: true, code: 'LIQ', args: ['2Y'] })
    expect(applyArgs(BY_CODE.LIQ.market, ['2Y']).props).toEqual({ range: '2y' })
    expect(applyArgs(BY_CODE.COT.market, ['2Y']).ignored).toEqual([])
    expect(applyArgs(BY_CODE.COT.market, ['5Y']).ignored).toEqual([])
    expect(applyArgs(BY_CODE.OIL.market, ['5Y']).props).toEqual({ range: '5y' })
  })

  it('the kind parses each word, refuses others, and says what it applied', () => {
    const k = ARG_KINDS.lineRange
    expect(k.parse('5y')).toBe('5y')
    expect(k.parse('1Y')).toBe('1y')
    expect(k.parse('3Y')).toBeNull()
    expect(k.parse('')).toBeNull()
    for (const code of ['LIQ', 'OIL']) {
      const out = applyArgs(BY_CODE[code].market, ['5Y'])
      expect(out.props).toEqual({ range: '5y' })
      expect(out.ignored).toEqual([])
      expect(argsEcho(code, out)).toBe(`${code}: applied a line of 5 years.`)
      expect(applyArgs(BY_CODE[code].market, ['10Y']).ignored).toEqual(['10Y'])
    }
  })

  it('the command line reads `LIQ 5Y` and `oil 1y`; a chip writes back a command the registry applies', () => {
    expect(parseCommand('LIQ 5Y')).toMatchObject({ ok: true, code: 'LIQ', sym: null, args: ['5Y'] })
    expect(parseCommand('oil 1y')).toMatchObject({ ok: true, code: 'OIL', sym: null, args: ['1Y'] })
    for (const code of ['LIQ', 'OIL']) {
      const m = code === 'LIQ' ? liq : oil
      expect(m.lineRangeArgs('2y')).toEqual([])                 // the default keeps the command bare
      expect(writeBackCommand(code, m.lineRangeArgs('2y'))).toBe(code)
      expect(writeBackCommand(code, m.lineRangeArgs('5y'))).toBe(`${code} 5Y`)
      expect(writeBackCommand(code, m.lineRangeArgs('1y'))).toBe(`${code} 1Y`)
      expect(m.normLineRange(null)).toBe('2y')
      expect(m.normLineRange('5y')).toBe('5y')
      expect(m.normLineRange('bogus')).toBe('2y')
    }
  })

  it('five years reads 61 months back; one year reads the same 25 months as the default', () => {
    expect(liq.historyUrls('2026-11-28', '5y').USFEDBAL).toBe('/api/econ/series/USFEDBAL?start=2021-10-01')
    expect(liq.historyUrls('2026-11-28', '1y').USFEDBAL).toBe(liq.historyUrls('2026-11-28').USFEDBAL)
    expect(liq.historyUrls('2026-11-28', '5y').USSOFR).toBe(liq.historyUrls('2026-11-28').USSOFR)   // the daily parts: unchanged
    expect(oil.historyUrls('2026-11-28', '5y').USCRUDEINV).toBe('/api/econ/series/USCRUDEINV?start=2021-10-01')
    expect(oil.historyUrls('2026-11-28', '5y').USGASINV).toBe(oil.historyUrls('2026-11-28').USGASINV)
  })
})
