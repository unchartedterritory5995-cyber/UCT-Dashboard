// VFP (2026-11-22): the code's shape in the registry, the words that find it (and the words that stay other
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
import { VFP_CODE } from './panels/volumeFootprintModel'

const VFP_WORDS = ['volume footprint', 'accumulation days', 'distribution days', 'pocket pivots', 'pocket pivot', 'gap history',
  'gaps', 'unfilled gaps', 'up down volume']

describe('VFP in the registry', () => {
  it('the model names the code; it is registered once, in the Security group, per ticker, with no argument and no switch', () => {
    expect(VFP_CODE).toBe('VFP')
    expect(FUNCTIONS.filter((f) => f.code === 'VFP')).toHaveLength(1)
    expect(FUNCTION_GROUPS).toContain(BY_CODE.VFP.group)
    expect(BY_CODE.VFP.group).toBe('Security')
    expect(BY_CODE.VFP.label).toBe('Volume footprint and gaps (accumulation and distribution days, pocket pivots, every gap of 3% or more)')
    expect(BY_CODE.VFP.ticker).toEqual({ panel: 'VolumeFootprint' })
    expect(BY_CODE.VFP.market).toBeUndefined()
    expect(exampleFor(BY_CODE.VFP)).toBe('NVDA VFP')
    expect(variantFor('VFP', true)).toMatchObject({ scope: 'ticker' })
    expect(typeof PANEL_IMPORTERS.VolumeFootprint).toBe('function')
  })

  it('VFP parses as the function in either order and lower case; VFP alone waits for the linked security', () => {
    expect(isCode('vfp')).toBe(true)
    expect(parseCommand('NVDA VFP')).toMatchObject({ ok: true, type: 'function', code: 'VFP', sym: 'NVDA', args: [] })
    expect(parseCommand('vfp nvda')).toMatchObject({ ok: true, type: 'function', code: 'VFP', sym: 'NVDA', args: [] })
    expect(parseCommand('VFP')).toMatchObject({ ok: true, type: 'function', code: 'VFP', sym: null })
    expect(parseCommand('VFP').collision).toBeUndefined()
  })

  it('its words find it first, and the words other functions answer to stay theirs', () => {
    for (const w of VFP_WORDS) expect([w, codesForWords(w)[0]]).toEqual([w, 'VFP'])
    expect(codesForWords('footprint')[0]).toBe('VFP')
    // the brief's words another function already answers first: left with it
    expect(codesForWords('volume')[0]).toBe('LEAD')
    expect(codesForWords('volume').slice(0, 2)).toEqual(['LEAD', 'UNVOL'])
    expect(codesForWords('accumulation')[0]).toBe('ACCUM')
    expect(codesForWords('gap')[0]).toBe('MOST')
    expect(codesForWords('pivot')[0]).toBe('BRKO')
    // no generic single word finds it first
    for (const w of ['stock', 'days', 'down', 'up', 'fill', 'filled', 'history', 'every', 'more', 'market', 'biggest', 'average', 'volumes']) {
      expect([w, codesForWords(w)[0]]).not.toEqual([w, 'VFP'])
    }
    // a ticker-shaped word that is a keyword offers VFP in the palette; the ticker stays the command line's
    expect(terminalCommandRow('gaps').row.command).toBe('VFP')
    expect(parseCommand('GAPS')).toMatchObject({ ok: true, code: 'DES', sym: 'GAPS' })
  })

  it('no argument word, COT word or other code is VFP, and no member word is within close-spelling reach of it', () => {
    // a word dictionary (it refuses another function's code and a made-up word) must refuse VFP too; the kinds that
    // take any code (HELP's) or any text take VFP as they take every other code, which is right
    const parses = (k, w) => { try { return k.parse(w) ?? null } catch { return null } }
    let dictionaries = 0
    for (const [kind, k] of Object.entries(ARG_KINDS)) {
      if (typeof k.parse !== 'function' || parses(k, 'STAT') != null || parses(k, 'ZZQX') != null) continue
      dictionaries += 1
      expect([kind, parses(k, 'VFP')]).toEqual([kind, null])
    }
    expect(dictionaries).toBeGreaterThan(20)
    expect(parses(ARG_KINDS.code, 'VFP')).not.toBeNull()                        // the control: VFP is a code
    expect(Object.keys(COT_WORDS)).not.toContain('VFP')
    // every keyword and label word of every function: none is a prefix of VFP or a close spelling of it
    const near = []
    for (const f of FUNCTIONS) {
      const words = new Set([...(f.keywords || []).flatMap((k) => [k, ...k.split(/\s+/)]), ...String(f.label).split(/[^A-Za-z0-9]+/)])
      for (const w of words) {
        const t = String(w).toUpperCase()
        if (t.length < 2 || f.code === 'VFP') continue
        if ('VFP'.startsWith(t) || editDistance(t, 'VFP') <= (t.length >= 4 ? 2 : 1)) near.push(`${f.code}:${w}`)
      }
    }
    expect(near).toEqual([])
    expect(suggest('VFP')).toEqual(['VFP'])
    expect(rankCandidates('VFP')[0]).toMatchObject({ kind: 'function', value: 'VFP', rank: 'verb' })
  })

  it('the code is not a stock the site follows', () => {
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.size).toBeGreaterThan(3000)
    expect(universe.has('NVDA')).toBe(true)                          // the control: the list is the ticker list
    expect(universe.has('VFP')).toBe(false)
    expect(isTickerCollision('VFP')).toBe(false)
  })
})
