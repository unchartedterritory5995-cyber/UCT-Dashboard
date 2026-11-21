// LIQ (2026-11-21): the liquidity panel's code in the registry, how it parses, and the words that find it.
//
// LIQ is market-wide and takes no argument. It is not a stock in the site's universe. Its words must find it
// without taking a word another function already answers to: 'fed' and 'federal reserve' stay with FED,
// 'treasury' with RATES, 'economy' with SENT, 'cpi' with ECON.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { ARG_KINDS, applyArgs } from './args'
import { BY_CODE, FUNCTIONS, FUNCTION_GROUPS, codesForWords, exampleFor, isCode, variantFor } from './functions'
import parseCommand from './parseCommand'
import { PANEL_IMPORTERS } from './panels'
import { LIQ_CODE } from './panels/liquidityModel'

describe('LIQ in the registry', () => {
  it('the model names the code, it is registered once, in the Market group, market-wide, with no argument', () => {
    expect(LIQ_CODE).toBe('LIQ')
    expect(FUNCTIONS.filter((f) => f.code === 'LIQ')).toHaveLength(1)
    expect(FUNCTION_GROUPS).toContain(BY_CODE.LIQ.group)
    expect(BY_CODE.LIQ.group).toBe('Market')
    expect(BY_CODE.LIQ.label).toBe('Liquidity (Fed balance sheet, TGA, reverse repo, net liquidity)')
    expect(BY_CODE.LIQ.market).toEqual({ panel: 'Liquidity' })
    expect(BY_CODE.LIQ.ticker).toBeUndefined()
    expect(BY_CODE.LIQ.market.flag).toBeUndefined()             // it says "switched off" itself, in words
    expect(exampleFor(BY_CODE.LIQ)).toBe('LIQ')
    expect(variantFor('LIQ', false)).toMatchObject({ scope: 'market' })
    expect(applyArgs(BY_CODE.LIQ.market, ['TGA']).ignored).toEqual(['TGA'])   // no argument: said, never guessed at
    expect(typeof PANEL_IMPORTERS.Liquidity).toBe('function')
  })

  it('LIQ is not a stock in the site\'s universe', () => {
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.has('NVDA')).toBe(true)                         // the control: the list is the ticker list
    expect(universe.has('LIQ')).toBe(false)
  })

  it('is not a word another code takes as its argument', () => {
    for (const [kind, spec] of Object.entries(ARG_KINDS)) {
      expect(spec.parse('LIQ', { today: '2026-11-21' }) == null || /Name|Query|code/i.test(kind), `${kind} takes LIQ`).toBe(true)
    }
  })
})

describe('LIQ parses', () => {
  it('bare, in either case, and a ticker before it is ignored rather than read as a stock', () => {
    expect(isCode('liq')).toBe(true)
    expect(parseCommand('LIQ')).toMatchObject({ ok: true, type: 'function', code: 'LIQ', sym: null, args: [] })
    expect(parseCommand('liq')).toMatchObject({ ok: true, type: 'function', code: 'LIQ', sym: null })
    expect(variantFor('LIQ', true)).toMatchObject({ scope: 'market', ignoredTicker: true })
  })
})

describe('a plain word finds the panel', () => {
  it('its words find it first', () => {
    for (const w of ['liquidity', 'net liquidity', 'fed balance sheet', 'reverse repo', 'rrp', 'tga',
      'quantitative tightening', 'money supply', 'reserves']) {
      expect([w, codesForWords(w)[0]]).toEqual([w, 'LIQ'])
    }
    expect(BY_CODE.LIQ.keywords).toEqual(['liquidity', 'net liquidity', 'fed balance sheet', 'reverse repo', 'rrp', 'tga',
      'qt', 'quantitative tightening', 'm2', 'money supply', 'reserves'])
    // no keyword whose single words are generic: "treasury general account" made "account" and "general" find LIQ
    expect(codesForWords('account')).not.toContain('LIQ')
    expect(codesForWords('general')).not.toContain('LIQ')
  })

  it('two of its words are under the word search\'s three-letter floor, so they find nothing on their own', () => {
    expect(codesForWords('qt')).toEqual([])
    expect(codesForWords('m2')).toEqual([])
  })

  it('the words other functions answer to stay theirs', () => {
    expect(codesForWords('fed')[0]).toBe('FED')
    expect(codesForWords('federal reserve')[0]).toBe('FED')
    expect(codesForWords('treasury')[0]).toBe('RATES')
    expect(codesForWords('treasury yields')[0]).toBe('RATES')
    expect(codesForWords('economy')[0]).toBe('SENT')
    expect(codesForWords('cpi')[0]).toBe('ECON')
    expect(codesForWords('balance sheet')[0]).toBe('FA')
    expect(codesForWords('yield curve')[0]).toBe('RATES')
  })
})
