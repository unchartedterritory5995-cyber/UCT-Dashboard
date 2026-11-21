// OIL (2026-11-21): the weekly oil report's code in the registry, how it parses, and the words that find it.
//
// OIL is market-wide and takes no argument. It is not a stock or fund in the site's universe. Its words must
// find it without taking a word another function already answers to.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { ARG_KINDS, applyArgs } from './args'
import { BY_CODE, FUNCTIONS, FUNCTION_GROUPS, codesForWords, exampleFor, isCode, variantFor } from './functions'
import parseCommand from './parseCommand'
import { wordCommand } from './paletteGrammar'
import { PANEL_IMPORTERS } from './panels'
import { OIL_CODE } from './panels/oilModel'

const OIL_WORDS = ['oil', 'crude', 'crude inventories', 'eia', 'oil inventories', 'gasoline', 'distillates', 'refinery', 'spr']

describe('OIL in the registry', () => {
  it('no keyword is a generic phrase ("gas prices" would make the word "prices" a keyword hit; the label words "pump prices" still find it)', () => {
    expect(BY_CODE.OIL.keywords).toEqual(OIL_WORDS)
    expect(BY_CODE.OIL.keywords).not.toContain('gas prices')
  })

  it('the model names the code, it is registered once, in the Market group, market-wide, with no argument', () => {
    expect(OIL_CODE).toBe('OIL')
    expect(FUNCTIONS.filter((f) => f.code === 'OIL')).toHaveLength(1)
    expect(FUNCTION_GROUPS).toContain(BY_CODE.OIL.group)
    expect(BY_CODE.OIL.group).toBe('Market')
    expect(BY_CODE.OIL.label).toBe('Weekly oil report (EIA: crude, gasoline, distillate stocks, production, refining, pump prices)')
    expect(BY_CODE.OIL.market).toEqual({ panel: 'Oil' })
    expect(BY_CODE.OIL.ticker).toBeUndefined()
    expect(BY_CODE.OIL.market.flag).toBeUndefined()             // it says "switched off" itself, in words
    expect(exampleFor(BY_CODE.OIL)).toBe('OIL')
    expect(variantFor('OIL', false)).toMatchObject({ scope: 'market' })
    expect(applyArgs(BY_CODE.OIL.market, ['WTI']).ignored).toEqual(['WTI'])      // no argument: said, never guessed at
    expect(typeof PANEL_IMPORTERS.Oil).toBe('function')
  })

  it('OIL is not a stock or fund the site knows, nor are its short words', () => {
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.has('NVDA')).toBe(true)                         // the control: the list is the ticker list
    for (const w of ['OIL', 'EIA', 'SPR', 'GAS']) expect([w, universe.has(w)]).toEqual([w, false])
  })

  it('is not a word another code takes as its argument', () => {
    for (const [kind, spec] of Object.entries(ARG_KINDS)) {
      expect(spec.parse('OIL', { today: '2026-11-21' }) == null || /Name|Query|code/i.test(kind), `${kind} takes OIL`).toBe(true)
    }
  })
})

describe('OIL parses', () => {
  it('bare, in either case, and a ticker before it is ignored rather than read as a stock', () => {
    expect(isCode('oil')).toBe(true)
    expect(parseCommand('OIL')).toMatchObject({ ok: true, type: 'function', code: 'OIL', sym: null, args: [] })
    expect(parseCommand('oil')).toMatchObject({ ok: true, type: 'function', code: 'OIL', sym: null })
    expect(variantFor('OIL', true)).toMatchObject({ scope: 'market', ignoredTicker: true })
  })
})

describe('a plain word finds the report', () => {
  it('its words find it first, in the palette too (a short word only by an exact keyword)', () => {
    for (const w of OIL_WORDS) expect([w, codesForWords(w)[0]]).toEqual([w, 'OIL'])
    for (const w of ['eia', 'spr', 'crude']) expect([w, wordCommand(w)]).toEqual([w, 'OIL'])
    expect(BY_CODE.OIL.keywords).toEqual(OIL_WORDS)
  })

  it('the words other functions answer to stay theirs', () => {
    expect(codesForWords('economy')[0]).toBe('SENT')
    expect(codesForWords('cpi')[0]).toBe('ECON')
    expect(codesForWords('cot')[0]).toBe('COT')
    expect(codesForWords('seasonality')[0]).toBe('SEAS')
    expect(codesForWords('compare')[0]).toBe('CMP')
    expect(codesForWords('spread')[0]).toBe('RATES')
    expect(codesForWords('spr')).toContain('RATES')                  // RATES still follows OIL for "spr"
    expect(codesForWords('price')[0]).toBe('GP')
  })
})
