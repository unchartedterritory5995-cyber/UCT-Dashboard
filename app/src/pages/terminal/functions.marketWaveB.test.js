// IPO, DVD and CACT (2026-11-20): the three codes' shape in the registry, how each parses, and
// the one grammar rule IPO needed.
//
// IPO is also the word LEAD takes for its new-listings lens (`LEAD IPO`). A code in second place
// makes the first token a ticker, so registering IPO alone would have turned `LEAD IPO` into "the
// IPO calendar, on a ticker called LEAD". parseCommand.js reads a word a market-wide code declares
// as its argument AS that argument when the word is itself a market-wide code; this rail pins that,
// and names every command the rule reads differently (LEAD IPO, and TOPF LIVE which was already
// a word TOPF takes).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { ARG_KINDS, applyArgs } from './args'
import { BY_CODE, FUNCTIONS, FUNCTION_GROUPS, codesForWords, exampleFor, isCode, variantFor } from './functions'
import parseCommand from './parseCommand'
import { PANEL_IMPORTERS } from './panels'
import { IPO_CODE, IPO_LISTINGS_COMMAND } from './panels/ipoCalendarModel'
import { DVD_CODE, DVD_HISTORY_CODE, dvdHistoryCommand } from './panels/dividendCalendarModel'
import { CACT_CODE } from './panels/corporateActionsModel'

const CODES = ['IPO', 'DVD', 'CACT']

describe('the three codes', () => {
  it('each model names its own code, and each is registered once', () => {
    expect([IPO_CODE, DVD_CODE, CACT_CODE]).toEqual(CODES)
    for (const code of CODES) {
      expect(FUNCTIONS.filter((f) => f.code === code), code).toHaveLength(1)
      expect(code).toMatch(/^[A-Z]{2,6}$/)
      expect(FUNCTION_GROUPS).toContain(BY_CODE[code].group)
    }
  })

  it('IPO is market-wide, in the Calendar group, and takes no argument', () => {
    expect(BY_CODE.IPO.market).toEqual({ panel: 'IpoCalendar' })
    expect(BY_CODE.IPO.ticker).toBeUndefined()
    expect(BY_CODE.IPO.group).toBe('Calendar')
    expect(BY_CODE.IPO.label).toBe('IPO calendar (upcoming and priced deals)')
    expect(exampleFor(BY_CODE.IPO)).toBe('IPO')
    expect(variantFor('IPO', false)).toMatchObject({ scope: 'market' })
    expect(applyArgs(BY_CODE.IPO.market, ['YEAR']).ignored).toEqual(['YEAR'])       // said, never guessed at
  })

  it('DVD reads the member\'s own stocks alone and one stock with a ticker, in the Calendar group', () => {
    expect(BY_CODE.DVD.market).toEqual({ panel: 'DividendCalendar' })
    expect(BY_CODE.DVD.ticker).toEqual({ panel: 'DividendCalendar' })
    expect(BY_CODE.DVD.group).toBe('Calendar')
    expect(BY_CODE.DVD.label).toBe('Dividend calendar (next ex-dates and splits ahead)')
    expect(exampleFor(BY_CODE.DVD)).toBe('DVD')
    expect(variantFor('DVD', false)).toMatchObject({ scope: 'market' })
    expect(variantFor('DVD', true)).toMatchObject({ scope: 'ticker' })
  })

  it('CACT is one stock\'s, in the Security group, and needs a ticker', () => {
    expect(BY_CODE.CACT.ticker).toEqual({ panel: 'CorporateActions' })
    expect(BY_CODE.CACT.market).toBeUndefined()
    expect(BY_CODE.CACT.group).toBe('Security')
    expect(BY_CODE.CACT.label).toBe('Corporate actions (splits, dividends, name changes)')
    expect(exampleFor(BY_CODE.CACT)).toBe('NVDA CACT')
    expect(variantFor('CACT', true)).toMatchObject({ scope: 'ticker' })
    expect(variantFor('CACT', false)).toEqual({ variant: null, reason: 'needs-ticker' })
  })

  it('every panel the three name is one the shell can load', () => {
    for (const code of CODES) {
      for (const v of [BY_CODE[code].ticker, BY_CODE[code].market].filter(Boolean)) {
        expect(typeof PANEL_IMPORTERS[v.panel], `${code} -> ${v.panel}`).toBe('function')
        expect(v.flag, `${code} waits on no switch`).toBeUndefined()
      }
    }
  })

  it('none of the three is a stock the site follows', () => {
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.size).toBeGreaterThan(3000)
    expect(universe.has('NVDA')).toBe(true)                         // the control: the list is the ticker list
    for (const code of CODES) expect(universe.has(code), code).toBe(false)
  })
})

describe('how each parses', () => {
  it('the bare codes, in either case', () => {
    expect(parseCommand('IPO')).toMatchObject({ ok: true, type: 'function', code: 'IPO', sym: null, args: [] })
    expect(parseCommand('ipo')).toMatchObject({ ok: true, type: 'function', code: 'IPO', sym: null, args: [] })
    expect(parseCommand('DVD')).toMatchObject({ ok: true, type: 'function', code: 'DVD', sym: null, args: [] })
    expect(parseCommand('CACT')).toMatchObject({ ok: true, type: 'function', code: 'CACT', sym: null, args: [] })
  })

  it('a ticker before or after DVD and CACT is that stock', () => {
    expect(parseCommand('NVDA DVD')).toMatchObject({ ok: true, type: 'function', code: 'DVD', sym: 'NVDA' })
    expect(parseCommand('DVD NVDA')).toMatchObject({ ok: true, type: 'function', code: 'DVD', sym: 'NVDA' })
    expect(parseCommand('nvda cact')).toMatchObject({ ok: true, type: 'function', code: 'CACT', sym: 'NVDA' })
    expect(parseCommand('CACT BRK.B')).toMatchObject({ ok: true, type: 'function', code: 'CACT' })
  })

  it('the doors the panels open are commands that open the code they name', () => {
    expect(parseCommand(IPO_LISTINGS_COMMAND)).toMatchObject({ ok: true, type: 'function', code: 'LEAD', sym: null, args: ['IPO'] })
    expect(dvdHistoryCommand('NVDA')).toBe(`NVDA ${DVD_HISTORY_CODE}`)
    expect(parseCommand(dvdHistoryCommand('NVDA'))).toMatchObject({ ok: true, type: 'function', code: 'CACT', sym: 'NVDA' })
    expect(parseCommand('NVDA GP')).toMatchObject({ ok: true, type: 'function', code: 'GP', sym: 'NVDA' })   // CACT's "open the chart" door
  })
})

describe('LEAD IPO is still LEAD\'s new-listings lens', () => {
  it('IPO after LEAD is the lens, in every spelling LEAD takes, and the lens is applied', () => {
    for (const typed of ['LEAD IPO', 'lead ipo', 'LEAD IPO 20']) {
      const p = parseCommand(typed)
      expect(p, typed).toMatchObject({ ok: true, type: 'function', code: 'LEAD', sym: null })
      expect(String(p.args[0]).toUpperCase(), typed).toBe('IPO')
    }
    expect(applyArgs(BY_CODE.LEAD.market, ['IPO']).props).toEqual({ lens: 'IPO' })
    expect(parseCommand('LEAD IPOS')).toMatchObject({ ok: true, code: 'LEAD', sym: null })
    expect(parseCommand('LEAD 60D')).toMatchObject({ ok: true, code: 'LEAD', sym: null })
  })

  it('`$` still forces the ticker reading, and a real ticker before IPO is still IPO', () => {
    expect(parseCommand('$LEAD IPO')).toMatchObject({ ok: true, type: 'function', code: 'IPO', sym: 'LEAD' })
    expect(parseCommand('NVDA IPO')).toMatchObject({ ok: true, type: 'function', code: 'IPO', sym: 'NVDA' })
    expect(variantFor('IPO', true)).toMatchObject({ scope: 'market', ignoredTicker: true })
  })

  it('a code that takes a ticker in second place keeps the canonical order', () => {
    // GP takes a ticker, so `LEAD GP` is still the chart of a ticker called LEAD: the new rule is
    // only for two codes that both take none.
    expect(parseCommand('LEAD GP')).toMatchObject({ ok: true, type: 'function', code: 'GP', sym: 'LEAD' })
    expect(parseCommand('IPO LEAD')).toMatchObject({ ok: true, type: 'function', code: 'LEAD', sym: 'IPO' })
  })

  it('the rule reads exactly two pairs of codes differently, and both are named here', () => {
    // every (market-wide code, market-wide code) pair where the first declares the second as an
    // argument word. LEAD IPO is the one IPO made; TOPF LIVE was already in the registry (LIVE is
    // the Live flow door AND a word TOPF takes for its open picks) and used to open the door with a
    // ticker called TOPF. A new pair must be added here on purpose.
    const marketOnly = Object.keys(BY_CODE).filter((c) => BY_CODE[c] && !BY_CODE[c].ticker)
    expect(marketOnly.length).toBeGreaterThan(20)
    const pairs = []
    for (const first of marketOnly) {
      const specs = (BY_CODE[first].market?.args || []).filter((s) => s.kind !== 'code' && !s.rest)
      for (const second of marketOnly) {
        if (specs.some((s) => ARG_KINDS[s.kind]?.parse(second) != null)) pairs.push(`${first} ${second}`)
      }
    }
    expect(pairs.sort()).toEqual(['LEAD IPO', 'TOPF LIVE'])
    for (const typed of pairs) {
      const [first, second] = typed.split(' ')
      expect(parseCommand(typed), typed).toMatchObject({ ok: true, type: 'function', code: first, sym: null, args: [second] })
      expect(applyArgs(BY_CODE[first].market, [second]).ignored, typed).toEqual([])
    }
    expect(applyArgs(BY_CODE.TOPF.market, ['LIVE']).props).toEqual({ status: 'open' })
    expect(parseCommand('$TOPF LIVE')).toMatchObject({ ok: true, type: 'function', code: 'LIVE', sym: 'TOPF' })
  })

  it('DVD and CACT are not words another code takes', () => {
    for (const code of ['DVD', 'CACT']) {
      for (const [kind, spec] of Object.entries(ARG_KINDS)) {
        expect(spec.parse(code, { today: '2026-11-20' }) == null || /Name|Query|code/i.test(kind), `${kind} takes ${code}`).toBe(true)
      }
    }
    expect(isCode('IPOS')).toBe(false)                              // LEAD's other spelling stays a plain word
  })
})

describe('a plain word finds each code', () => {
  it('the words a trader types', () => {
    const first = (q) => codesForWords(q, 1)[0]
    for (const q of ['ipo calendar', 'new issues', 'upcoming ipos', 'ipos']) expect(first(q), q).toBe('IPO')
    for (const q of ['dividend calendar', 'ex dividend', 'ex-date', 'dividends', 'dividend']) expect(first(q), q).toBe('DVD')
    for (const q of ['corporate actions', 'stock split', 'splits', 'dividend history', 'name change']) expect(first(q), q).toBe('CACT')
  })

  it('"new listings" and "recent ipos" still find LEAD, which owned them first', () => {
    expect(codesForWords('new listings', 1)[0]).toBe('LEAD')
    expect(codesForWords('recent ipos', 1)[0]).toBe('LEAD')
    expect(BY_CODE.IPO.keywords).not.toContain('new listings')
  })
})
