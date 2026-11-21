// ECON (2026-11-21): the economy board's code in the registry, how it parses, and the words that find it.
//
// ECON is market-wide and takes no argument. ECO, the code the brief asked for first, is a real stock
// in the site's universe, so the code is ECON. Its words must find it without taking a word another
// function already answers to: "economy" stays with SENT.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { ARG_KINDS, applyArgs } from './args'
import { BY_CODE, FUNCTIONS, FUNCTION_GROUPS, codesForWords, exampleFor, isCode, variantFor } from './functions'
import parseCommand from './parseCommand'
import { PANEL_IMPORTERS } from './panels'
import { ECON_CODE } from './panels/economyModel'

describe('ECON in the registry', () => {
  it('the model names the code, it is registered once, in the Market group, market-wide, with no argument', () => {
    expect(ECON_CODE).toBe('ECON')
    expect(FUNCTIONS.filter((f) => f.code === 'ECON')).toHaveLength(1)
    expect(FUNCTION_GROUPS).toContain(BY_CODE.ECON.group)
    expect(BY_CODE.ECON.group).toBe('Market')
    expect(BY_CODE.ECON.label).toBe('Economy dashboard (CPI, jobs, GDP, spending, housing: last print, prior, next release)')
    expect(BY_CODE.ECON.market).toEqual({ panel: 'Economy' })
    expect(BY_CODE.ECON.ticker).toBeUndefined()
    expect(BY_CODE.ECON.market.flag).toBeUndefined()            // it says "switched off" itself, in words
    expect(exampleFor(BY_CODE.ECON)).toBe('ECON')
    expect(variantFor('ECON', false)).toMatchObject({ scope: 'market' })
    expect(applyArgs(BY_CODE.ECON.market, ['CPI']).ignored).toEqual(['CPI'])      // no argument: said, never guessed at
    expect(typeof PANEL_IMPORTERS.Economy).toBe('function')
  })

  it('neither ECON nor ECO is free to be read as a stock: ECO is one, ECON is not', () => {
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.has('NVDA')).toBe(true)                         // the control: the list is the ticker list
    expect(universe.has('ECO')).toBe(true)                          // why the code is not ECO
    expect(universe.has('ECON')).toBe(false)
  })

  it('is not a word another code takes as its argument', () => {
    for (const [kind, spec] of Object.entries(ARG_KINDS)) {
      expect(spec.parse('ECON', { today: '2026-11-21' }) == null || /Name|Query|code/i.test(kind), `${kind} takes ECON`).toBe(true)
    }
  })
})

describe('ECON parses', () => {
  it('bare, in either case, and a ticker before it is ignored rather than read as a stock', () => {
    expect(isCode('econ')).toBe(true)
    expect(parseCommand('ECON')).toMatchObject({ ok: true, type: 'function', code: 'ECON', sym: null, args: [] })
    expect(parseCommand('econ')).toMatchObject({ ok: true, type: 'function', code: 'ECON', sym: null })
    expect(variantFor('ECON', true)).toMatchObject({ scope: 'market', ignoredTicker: true })
  })
})

describe('a plain word finds the board', () => {
  it('its words find it first', () => {
    for (const w of ['economic data', 'cpi', 'inflation', 'jobs report', 'payrolls', 'unemployment', 'gdp', 'retail sales',
      'jobless claims', 'pce', 'housing starts']) {
      expect([w, codesForWords(w)[0]]).toEqual([w, 'ECON'])
    }
  })

  it('the words other functions answer to stay theirs', () => {
    expect(codesForWords('economy')[0]).toBe('SENT')
    expect(codesForWords('fomc')[0]).toBe('FED')
    expect(codesForWords('yield curve')[0]).toBe('RATES')
    expect(codesForWords('earnings')[0]).toBe('CAL')
  })
})
