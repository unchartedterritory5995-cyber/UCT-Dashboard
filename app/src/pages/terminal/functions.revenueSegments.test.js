// SEG (2026-11-21): the revenue-by-segment code in the registry, its two argument kinds (pinned to the panel
// model that owns the words), how it parses, and the words that find it.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { ARG_KINDS, SEG_PERIOD_WORDS, SEG_VIEW_WORDS, applyArgs } from './args'
import { BY_CODE, FUNCTIONS, codesForWords, exampleFor, isCode, variantFor } from './functions'
import { isTickerCollision } from './grammar'
import parseCommand from './parseCommand'
import { PANEL_IMPORTERS } from './panels'
import { writeBackCommand } from './panels/commandWriteBack'
import { COT_WORDS } from './panels/cotModel'
import { SEG_CODE, SEG_PERIOD_ARG_WORDS, SEG_VIEW_ARG_WORDS, parseSegPeriod, parseSegView, segCommandArgs } from './panels/revenueSegmentsModel'

const universe = () => new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))

describe('SEG in the registry', () => {
  it('the model names its own code; registered once, per stock, in the Security group, on no switch', () => {
    expect(SEG_CODE).toBe('SEG')
    expect(FUNCTIONS.filter((f) => f.code === 'SEG')).toHaveLength(1)
    expect(BY_CODE.SEG.ticker).toEqual({ panel: 'RevenueSegments', args: [{ kind: 'segView', prop: 'view' }, { kind: 'segPeriod', prop: 'period' }] })
    expect(BY_CODE.SEG.market).toBeUndefined()
    expect(BY_CODE.SEG.ticker.flag).toBeUndefined()
    expect(BY_CODE.SEG.group).toBe('Security')
    expect(BY_CODE.SEG.label).toBe('Revenue by segment (product and region)')
    expect(exampleFor(BY_CODE.SEG)).toBe('NVDA SEG')
    expect(variantFor('SEG', true)).toMatchObject({ scope: 'ticker' })
    expect(typeof PANEL_IMPORTERS.RevenueSegments).toBe('function')
  })

  it('the argument copies are the model\'s words, and both read a token the same way', () => {
    expect(SEG_VIEW_WORDS).toEqual(SEG_VIEW_ARG_WORDS)
    expect(SEG_PERIOD_WORDS).toEqual(SEG_PERIOD_ARG_WORDS)
    for (const tok of ['product', 'REGION', ' regions ', 'GEOGRAPHY', 'GEO', 'ANNUAL', 'qtrly', 'QUARTER', 'YEAR', '', null]) {
      expect(ARG_KINDS.segView.parse(tok), String(tok)).toBe(parseSegView(tok))
      expect(ARG_KINDS.segPeriod.parse(tok), String(tok)).toBe(parseSegPeriod(tok))
    }
    expect([ARG_KINDS.segView.takes, ARG_KINDS.segPeriod.takes]).toEqual(['PRODUCT or REGION', 'ANNUAL or QUARTERLY'])
  })

  it('the registry applies each word to the prop the panel reads, in either order; what the chips write runs as the same pick', () => {
    const run = (tokens) => applyArgs(BY_CODE.SEG.ticker, tokens)
    expect(run(['REGION', 'QUARTERLY']).props).toEqual({ view: 'region', period: 'quarter' })
    expect(run(['QUARTERLY', 'REGION']).props).toEqual({ view: 'region', period: 'quarter' })
    expect(run(['REGION', 'PRODUCT']).ignored).toEqual(['PRODUCT'])
    expect(run(['MONTHLY']).ignored).toEqual(['MONTHLY'])
    for (const pick of [{ view: 'region', period: 'quarter' }, { view: 'product', period: 'quarter' }, { view: 'region', period: 'annual' }]) {
      const tokens = segCommandArgs(pick)
      expect(run(tokens).ignored).toEqual([])
      expect(writeBackCommand('SEG', tokens, 'QQZA')).toBe(['QQZA', 'SEG', ...tokens].join(' '))
    }
    expect(writeBackCommand('SEG', [], 'QQZA')).toBe('QQZA SEG')
  })
})

describe('SEG parses', () => {
  it('a ticker in either place, its words after it', () => {
    expect(parseCommand('NVDA SEG')).toMatchObject({ ok: true, type: 'function', code: 'SEG', sym: 'NVDA', args: [] })
    expect(parseCommand('seg nvda')).toMatchObject({ ok: true, code: 'SEG', sym: 'NVDA' })
    expect(parseCommand('NVDA SEG REGION QUARTERLY')).toMatchObject({ ok: true, code: 'SEG', sym: 'NVDA', args: ['REGION', 'QUARTERLY'] })
    // a word SEG declares is that word, never a ticker
    expect(parseCommand('SEG REGION')).toMatchObject({ ok: true, code: 'SEG', sym: null, args: ['REGION'] })
  })

  it('the code and its words are not stocks, other codes, or another dictionary\'s words', () => {
    const u = universe()
    expect(u.has('NVDA')).toBe(true)
    expect(u.has('SEG')).toBe(false)
    expect(isTickerCollision('SEG')).toBe(false)
    for (const w of [...Object.keys(SEG_VIEW_ARG_WORDS), ...Object.keys(SEG_PERIOD_ARG_WORDS)]) {
      expect(u.has(w), w).toBe(false)
      expect(isCode(w), w).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(COT_WORDS, w), w).toBe(false)
    }
    for (const [kind, spec] of Object.entries(ARG_KINDS)) {
      expect(spec.parse('SEG', { today: '2026-11-21' }) == null || /Name|Query|code/i.test(kind), `${kind} takes SEG`).toBe(true)
    }
  })

  it('segment words find SEG; revenue stays with FA', () => {
    const first = (q) => codesForWords(q, 1)[0]
    for (const q of ['revenue by segment', 'segments', 'revenue by region', 'product revenue', 'business segments']) expect(first(q), q).toBe('SEG')
    expect(first('revenue')).not.toBe('SEG')
  })
})
