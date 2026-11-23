// FCTX (2026-11-22): the code's shape in the registry, the words that find it (and the words that stay other
// functions'), that no member word is within the command line's close-spelling reach of it, and that it is not
// a stock.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { ARG_KINDS } from './args'
import { BY_CODE, FUNCTIONS, FUNCTION_GROUPS, codesForWords, editDistance, exampleFor, isCode, suggest, variantFor } from './functions'
import { isTickerCollision } from './grammar'
import parseCommand from './parseCommand'
import { PANEL_IMPORTERS } from './panels'
import { terminalCommandRow } from './paletteGrammar'
import { rankCandidates } from './ranking'
import { COT_WORDS } from './panels/cotModel'
import { FCTX_CODE } from './panels/factorExposureModel'

const FCTX_WORDS = ['factor exposure', 'factor exposures', 'factor loadings', 'factors', 'style', 'style factors', 'momentum exposure']

describe('FCTX in the registry', () => {
  it('the model names the code; it is registered once, in the Security group, per ticker, with no argument and no switch', () => {
    expect(FCTX_CODE).toBe('FCTX')
    expect(FUNCTIONS.filter((f) => f.code === 'FCTX')).toHaveLength(1)
    expect(FUNCTION_GROUPS).toContain(BY_CODE.FCTX.group)
    expect(BY_CODE.FCTX.group).toBe('Security')
    expect(BY_CODE.FCTX.label).toBe('Factor exposure (market, size, growth vs value, momentum, quality, low volatility)')
    expect(BY_CODE.FCTX.ticker).toEqual({ panel: 'FactorExposure' })
    expect(BY_CODE.FCTX.market).toBeUndefined()
    expect(exampleFor(BY_CODE.FCTX)).toBe('NVDA FCTX')
    expect(variantFor('FCTX', true)).toMatchObject({ scope: 'ticker' })
    expect(typeof PANEL_IMPORTERS.FactorExposure).toBe('function')
  })

  it('FCTX parses as the function in either order and lower case; FCTX alone waits for the linked security', () => {
    expect(isCode('fctx')).toBe(true)
    expect(parseCommand('NVDA FCTX')).toMatchObject({ ok: true, type: 'function', code: 'FCTX', sym: 'NVDA', args: [] })
    expect(parseCommand('fctx nvda')).toMatchObject({ ok: true, type: 'function', code: 'FCTX', sym: 'NVDA', args: [] })
    expect(parseCommand('FCTX')).toMatchObject({ ok: true, type: 'function', code: 'FCTX', sym: null })
    expect(parseCommand('FCTX').collision).toBeUndefined()
  })

  it('its words find it first, and the words other functions answer to stay theirs', () => {
    for (const w of FCTX_WORDS) expect([w, codesForWords(w)[0]]).toEqual([w, 'FCTX'])
    expect(codesForWords('factor')[0]).toBe('FCTX')
    expect(codesForWords('loadings')[0]).toBe('FCTX')                      // no other function answers it
    // the brief's words another function already answers first: left with it
    expect(codesForWords('exposure')[0]).toBe('REGM')
    expect(codesForWords('growth')[0]).toBe('GRPS')
    expect(codesForWords('value')[0]).toBe('PEER')
    expect(codesForWords('size')[0]).toBe('SIZE')
    expect(codesForWords('beta')[0]).toBe('STAT')
    expect(codesForWords('volatility')[0]).not.toBe('FCTX')
    // no generic single word finds it first
    for (const w of ['stock', 'market', 'trades', 'low', 'spread', 'funds', 'regression', 'year', 'earlier', 'small', 'large', 'sensitivity']) {
      expect([w, codesForWords(w)[0]]).not.toEqual([w, 'FCTX'])
    }
    // a ticker-shaped keyword offers FCTX in the palette; the ticker stays the command line's
    expect(terminalCommandRow('style').row.command).toBe('FCTX')
    expect(parseCommand('STYLE')).toMatchObject({ ok: true, code: 'DES', sym: 'STYLE' })
  })

  it('no argument word, COT word or other code is FCTX, and no member word is within close-spelling reach of it', () => {
    const parses = (k, w) => { try { return k.parse(w) ?? null } catch { return null } }
    let dictionaries = 0
    for (const [kind, k] of Object.entries(ARG_KINDS)) {
      if (typeof k.parse !== 'function' || parses(k, 'STAT') != null || parses(k, 'ZZQX') != null) continue
      dictionaries += 1
      expect([kind, parses(k, 'FCTX')]).toEqual([kind, null])
    }
    expect(dictionaries).toBeGreaterThan(20)
    expect(parses(ARG_KINDS.code, 'FCTX')).not.toBeNull()                       // the control: FCTX is a code
    expect(Object.keys(COT_WORDS)).not.toContain('FCTX')
    const near = []
    for (const f of FUNCTIONS) {
      const words = new Set([...(f.keywords || []).flatMap((k) => [k, ...k.split(/\s+/)]), ...String(f.label).split(/[^A-Za-z0-9]+/)])
      for (const w of words) {
        const t = String(w).toUpperCase()
        if (t.length < 2 || f.code === 'FCTX') continue
        if ('FCTX'.startsWith(t) || editDistance(t, 'FCTX') <= (t.length >= 4 ? 2 : 1)) near.push(`${f.code}:${w}`)
      }
    }
    expect(near).toEqual([])
    expect(suggest('FCTX')).toEqual(['FCTX'])
    expect(rankCandidates('FCTX')[0]).toMatchObject({ kind: 'function', value: 'FCTX', rank: 'verb' })
  })

  it('the code is not a stock the site follows', () => {
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.size).toBeGreaterThan(3000)
    expect(universe.has('NVDA')).toBe(true)                          // the control: the list is the ticker list
    expect(universe.has('FCTX')).toBe(false)
    expect(isTickerCollision('FCTX')).toBe(false)
  })
})
