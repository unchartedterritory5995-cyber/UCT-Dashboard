// OSCR RICH / OSCR CHEAP (2026-11-22): the argument kind that opens OSCR's IV rank list, and the code's registry.
//
// args.js keeps its own small copy of the vocabulary the panel model owns (so the panel's code stays out of the
// shell's first-open bytes). This rail pins the copy to its owner, and checks the two words collide with nothing.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { ARG_KINDS, OSCR_VIEW_WORDS, applyArgs } from './args'
import { BY_CODE, FUNCTIONS, codesForWords, exampleFor, isCode, variantFor } from './functions'
import parseCommand from './parseCommand'
import { writeBackCommand } from './panels/commandWriteBack'
import { COT_WORDS } from './panels/cotModel'
import { OSCR_VIEWS, OSCR_VIEW_ARG_WORDS, oscrViewCommandArgs, parseOscrView } from './panels/ivRankModel'

describe('the view words match the panel that owns them', () => {
  it('the copy equals the model, word for word', () => {
    expect(OSCR_VIEW_WORDS).toEqual(OSCR_VIEW_ARG_WORDS)
    expect(Object.keys(OSCR_VIEW_ARG_WORDS).sort()).toEqual(['CHEAP', 'RICH'])
    for (const [word, value] of Object.entries(OSCR_VIEW_ARG_WORDS)) {
      expect(ARG_KINDS.oscrView.parse(word.toLowerCase()), word).toBe(value)
      expect(parseOscrView(word), word).toBe(value)
    }
    for (const v of Object.values(OSCR_VIEWS)) expect(ARG_KINDS.oscrView.parse(v.token)).toBeTruthy()
    for (const no of ['NVDA', 'toString', 'constructor', '', 'RICHER', 'HIGH', 'LOW', 'IVR']) expect(ARG_KINDS.oscrView.parse(no), no).toBeNull()
    expect(ARG_KINDS.oscrView.describe('rich')).toBe('highest IV rank')
    expect(ARG_KINDS.oscrView.describe('cheap')).toBe('lowest IV rank')
    expect(ARG_KINDS.oscrView.takes).toBe('RICH or CHEAP')
  })

  it('the registry applies the word to the prop the panel reads, and bare OSCR stays the screener', () => {
    const run = (tokens) => applyArgs(BY_CODE.OSCR.market, tokens)
    expect(run([]).props).toEqual({})
    expect(run(['rich']).props).toEqual({ view: 'rich' })
    expect(run(['CHEAP']).props).toEqual({ view: 'cheap' })
    expect(run(['banana']).ignored).toEqual(['banana'])
    expect(run(['RICH', 'CHEAP']).ignored).toEqual(['CHEAP'])
    // what the panel writes back is read as the same view, and the screener is the bare command
    expect(oscrViewCommandArgs({ view: 'rich' })).toEqual(['RICH'])
    expect(writeBackCommand('OSCR', ['CHEAP'])).toBe('OSCR CHEAP')
    expect(writeBackCommand('OSCR', ['RICH'])).toBe('OSCR RICH')
    expect(writeBackCommand('OSCR', [])).toBe('OSCR')
  })
})

describe('the code', () => {
  it('OSCR keeps its label, group, panel, page and switch; the market variant takes the view word', () => {
    expect(BY_CODE.OSCR.market).toEqual({ panel: 'OptionsScreener', full: '/screener?tab=options', flag: 'optionsScreenerEnabled',
      args: [{ kind: 'oscrView', prop: 'view' }] })
    expect(BY_CODE.OSCR.ticker).toBeUndefined()
    expect([BY_CODE.OSCR.label, BY_CODE.OSCR.group]).toEqual(['Options screener', 'Options'])
    expect(variantFor('OSCR', false)).toMatchObject({ scope: 'market' })
    expect(exampleFor(BY_CODE.OSCR)).toBe('OSCR RICH')
    expect(BY_CODE.OSCR.note).toContain('OSCR RICH and OSCR CHEAP')
  })

  it('the bare code and each view word parse as the market function', () => {
    expect(parseCommand('OSCR')).toMatchObject({ ok: true, type: 'function', code: 'OSCR', sym: null, args: [] })
    expect(parseCommand('oscr rich')).toMatchObject({ ok: true, type: 'function', code: 'OSCR', sym: null, args: ['RICH'] })
    expect(parseCommand('OSCR CHEAP')).toMatchObject({ ok: true, type: 'function', code: 'OSCR', sym: null, args: ['CHEAP'] })
  })

  it('no view word is a function code, a COT market word, or a word another kind takes', () => {
    for (const word of Object.keys(OSCR_VIEW_ARG_WORDS)) {
      expect(isCode(word), word).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(COT_WORDS, word), word).toBe(false)
      for (const [kind, spec] of Object.entries(ARG_KINDS)) {
        if (kind === 'oscrView') continue
        // a kind that takes any ticker-shaped token (it takes NVDA too: symbol, FUND's peers) is not a word dictionary
        const tickerKind = spec.parse('NVDA', { today: '2026-11-22' }) != null
        expect(spec.parse(word, { today: '2026-11-22' }) == null || tickerKind || /Name|Query|code/i.test(kind), `${kind} takes ${word}`).toBe(true)
      }
    }
    expect(isCode('OSCR')).toBe(true)                               // the control: isCode can say yes
  })

  it('no view word is in another function\'s title, and a one-word search on either finds nothing new', () => {
    for (const f of FUNCTIONS) {
      for (const word of ['rich', 'cheap']) expect(String(f.label).toLowerCase().split(/[^a-z]+/), `${f.code} ${word}`).not.toContain(word)
    }
    expect(codesForWords('rich')).not.toContain('OSCR')
    expect(codesForWords('cheap')).not.toContain('OSCR')
    // OSCR carries no keyword: "rank" stays RSL's, "iv" and "implied volatility" IVH's
    expect(codesForWords('rank')[0]).toBe('RSL')
    expect(codesForWords('implied volatility')[0]).toBe('IVH')
    expect(codesForWords('iv rank')).not.toContain('OSCR')
  })

  it('the view words are not stocks the site follows', () => {
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.size).toBeGreaterThan(3000)
    expect(universe.has('NVDA')).toBe(true)                         // the control: the list is the ticker list
    for (const word of Object.keys(OSCR_VIEW_ARG_WORDS)) expect(universe.has(word), word).toBe(false)
  })
})
