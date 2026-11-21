// AUCT (2026-11-21): the Treasury auctions code's shape in the registry, how it parses, the words
// that find it, and the words that now find the real yield block inside RATES.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { ARG_KINDS, applyArgs } from './args'
import { BY_CODE, FUNCTIONS, FUNCTION_GROUPS, codesForWords, exampleFor, variantFor } from './functions'
import parseCommand from './parseCommand'
import { PANEL_IMPORTERS } from './panels'
import { AUCT_CODE } from './panels/treasuryAuctionsModel'

describe('AUCT in the registry', () => {
  it('the model names its own code, and it is registered once, market-wide, in the Market group', () => {
    expect(AUCT_CODE).toBe('AUCT')
    expect(FUNCTIONS.filter((f) => f.code === 'AUCT')).toHaveLength(1)
    expect(BY_CODE.AUCT.market).toEqual({ panel: 'TreasuryAuctions' })
    expect(BY_CODE.AUCT.ticker).toBeUndefined()
    expect(BY_CODE.AUCT.group).toBe('Market')
    expect(FUNCTION_GROUPS).toContain('Market')
    expect(BY_CODE.AUCT.label).toBe('Treasury auctions (upcoming and recent results)')
    expect(exampleFor(BY_CODE.AUCT)).toBe('AUCT')
    expect(variantFor('AUCT', false)).toMatchObject({ scope: 'market' })
    expect(applyArgs(BY_CODE.AUCT.market, ['BILLS']).ignored).toEqual(['BILLS'])     // no argument: said, never guessed at
  })

  it('its panel is one the shell can load, and it waits on no switch', () => {
    expect(typeof PANEL_IMPORTERS[BY_CODE.AUCT.market.panel]).toBe('function')
    expect(BY_CODE.AUCT.market.flag).toBeUndefined()
  })

  it('is not a stock the site follows', () => {
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.has('NVDA')).toBe(true)                         // the control: the list is the ticker list
    expect(universe.has('AUCT')).toBe(false)
  })

  it('is not a word another code takes as its argument', () => {
    for (const [kind, spec] of Object.entries(ARG_KINDS)) {
      expect(spec.parse('AUCT', { today: '2026-11-21' }) == null || /Name|Query|code/i.test(kind), `${kind} takes AUCT`).toBe(true)
    }
  })
})

describe('AUCT parses', () => {
  it('bare, in either case, and a ticker before it is ignored rather than read as a stock', () => {
    expect(parseCommand('AUCT')).toMatchObject({ ok: true, type: 'function', code: 'AUCT', sym: null, args: [] })
    expect(parseCommand('auct')).toMatchObject({ ok: true, type: 'function', code: 'AUCT', sym: null, args: [] })
    expect(variantFor('AUCT', true)).toMatchObject({ scope: 'market', ignoredTicker: true })
  })

  it('the door the panel opens is the RATES command', () => {
    expect(parseCommand('RATES')).toMatchObject({ ok: true, type: 'function', code: 'RATES', sym: null })
  })
})

describe('a plain word finds each screen', () => {
  it('auction words find AUCT', () => {
    const first = (q) => codesForWords(q, 1)[0]
    for (const q of ['treasury auctions', 'auctions', 'bond auction', 'auction results', 'bid to cover']) expect(first(q), q).toBe('AUCT')
  })

  it('real yield words find RATES, which carries the real yield block', () => {
    const first = (q) => codesForWords(q, 1)[0]
    for (const q of ['real yields', 'tips yields', 'breakeven inflation']) expect(first(q), q).toBe('RATES')
    for (const q of ['treasury yields', 'yield curve']) expect(first(q), q).toBe('RATES')     // the words RATES had stay its own
  })
})
