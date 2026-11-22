// PUBR (2026-11-22): the public-records code in the registry, its argument kind (pinned to the panel model that owns
// the words), how it parses, and the words that find it.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { ARG_KINDS, PUBR_VIEW_WORDS, applyArgs } from './args'
import { BY_CODE, FUNCTIONS, codesForWords, exampleFor, isCode, variantFor } from './functions'
import { isTickerCollision } from './grammar'
import parseCommand from './parseCommand'
import { PANEL_IMPORTERS } from './panels'
import { writeBackCommand } from './panels/commandWriteBack'
import { COT_WORDS } from './panels/cotModel'
import { PUBR_CODE, PUBR_SECTIONS, PUBR_VIEW_ARG_WORDS, parsePubrView, pubrCommandArgs } from './panels/publicRecordsModel'

const universe = () => new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))

describe('PUBR in the registry', () => {
  it('the model names its own code; registered once, per stock, in the Security group, on no switch', () => {
    expect(PUBR_CODE).toBe('PUBR')
    expect(FUNCTIONS.filter((f) => f.code === 'PUBR')).toHaveLength(1)
    expect(BY_CODE.PUBR.ticker).toEqual({ panel: 'PublicRecords', args: [{ kind: 'pubrView', prop: 'view' }] })
    expect(BY_CODE.PUBR.market).toBeUndefined()
    expect(BY_CODE.PUBR.ticker.flag).toBeUndefined()
    expect(BY_CODE.PUBR.group).toBe('Security')
    expect(BY_CODE.PUBR.label).toBe('Public records (government contracts, clinical trials, FDA approvals, lobbying)')
    expect(exampleFor(BY_CODE.PUBR)).toBe('NVDA PUBR')
    expect(variantFor('PUBR', true)).toMatchObject({ scope: 'ticker' })
    expect(typeof PANEL_IMPORTERS.PublicRecords).toBe('function')
  })

  it('the argument copy is the model\'s words, and both read a token the same way', () => {
    expect(PUBR_VIEW_WORDS).toEqual(PUBR_VIEW_ARG_WORDS)
    for (const tok of ['contracts', 'AWARDS', ' trials ', 'FDA', 'approvals', 'LOBBYING', 'ALL', 'LOBBY', 'TRIAL', '', null]) {
      expect(ARG_KINDS.pubrView.parse(tok), String(tok)).toBe(parsePubrView(tok))
    }
    expect(ARG_KINDS.pubrView.takes).toBe('CONTRACTS, TRIALS, FDA or LOBBYING')
    expect(PUBR_SECTIONS.map((k) => ARG_KINDS.pubrView.describe(k))).toEqual(['federal contracts', 'clinical trials', 'FDA approvals', 'lobbying'])
  })

  it('the registry applies each word to the prop the panel reads; what the chips write runs as the same pick', () => {
    const run = (tokens) => applyArgs(BY_CODE.PUBR.ticker, tokens)
    expect(run(['TRIALS']).props).toEqual({ view: 'trials' })
    expect(run(['AWARDS']).props).toEqual({ view: 'contracts' })
    expect(run(['APPROVALS']).props).toEqual({ view: 'fda' })
    expect(run(['TRIALS', 'FDA']).ignored).toEqual(['FDA'])
    expect(run(['PATENTS']).ignored).toEqual(['PATENTS'])
    for (const view of PUBR_SECTIONS) {
      const tokens = pubrCommandArgs(view)
      expect(run(tokens).ignored).toEqual([])
      expect(run(tokens).props).toEqual({ view })
      expect(writeBackCommand('PUBR', tokens, 'QQZA')).toBe(['QQZA', 'PUBR', ...tokens].join(' '))
    }
    expect(pubrCommandArgs('all')).toEqual([])
    expect(writeBackCommand('PUBR', [], 'QQZA')).toBe('QQZA PUBR')
  })
})

describe('PUBR parses', () => {
  it('a ticker in either place, its word after it', () => {
    expect(parseCommand('NVDA PUBR')).toMatchObject({ ok: true, type: 'function', code: 'PUBR', sym: 'NVDA', args: [] })
    expect(parseCommand('pubr nvda')).toMatchObject({ ok: true, code: 'PUBR', sym: 'NVDA' })
    expect(parseCommand('NVDA PUBR LOBBYING')).toMatchObject({ ok: true, code: 'PUBR', sym: 'NVDA', args: ['LOBBYING'] })
    // a word PUBR declares is that word, never a ticker
    expect(parseCommand('PUBR FDA')).toMatchObject({ ok: true, code: 'PUBR', sym: null, args: ['FDA'] })
  })

  it('the code and its words are not stocks, other codes, or another dictionary\'s words', () => {
    const u = universe()
    expect(u.has('NVDA')).toBe(true)
    expect(u.has('PUBR')).toBe(false)
    expect(isTickerCollision('PUBR')).toBe(false)
    for (const w of Object.keys(PUBR_VIEW_ARG_WORDS)) {
      expect(u.has(w), w).toBe(false)
      expect(isCode(w), w).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(COT_WORDS, w), w).toBe(false)
    }
    for (const [kind, spec] of Object.entries(ARG_KINDS)) {
      expect(spec.parse('PUBR', { today: '2026-11-22' }) == null || /Name|Query|code/i.test(kind), `${kind} takes PUBR`).toBe(true)
    }
  })

  it('record words find PUBR; a word another panel owns (its keyword or its title) still finds that panel', () => {
    const first = (q) => codesForWords(q, 1)[0]
    for (const q of ['government contracts', 'clinical trials', 'fda approvals', 'drug approvals', 'lobbying', 'federal contracts', 'usaspending']) {
      expect(first(q), q).toBe('PUBR')
    }
    // measured before PUBR was added: 'records' found LEAD (its title), 'contract' and 'contracts' ACCUM, 'spend' ECON,
    // 'fed' and 'federal' FED, 'record' FREC
    for (const [q, owner] of [['records', 'LEAD'], ['contract', 'ACCUM'], ['contracts', 'ACCUM'], ['spend', 'ECON'], ['fed', 'FED'],
      ['federal', 'FED'], ['record', 'FREC']]) expect(first(q), q).toBe(owner)
  })
})
