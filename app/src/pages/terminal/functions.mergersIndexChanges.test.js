// MNA and IDXC (2026-11-21): the two codes in the registry, IDXC's index word (pinned to the panel model that owns
// it), how each parses, and the words that find each.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { ARG_KINDS, IDXC_INDEX_WORDS, applyArgs } from './args'
import { BY_CODE, FUNCTIONS, codesForWords, exampleFor, isCode, variantFor } from './functions'
import { isTickerCollision } from './grammar'
import parseCommand from './parseCommand'
import { PANEL_IMPORTERS } from './panels'
import { writeBackCommand } from './panels/commandWriteBack'
import { COT_WORDS } from './panels/cotModel'
import { IDXC_CODE, IDXC_INDEX_ARG_WORDS, IDXC_INDEXES, idxcCommandArgs, parseIdxcIndex } from './panels/indexChangesModel'
import { MNA_CODE } from './panels/mergersModel'

const universe = () => new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))

describe('MNA and IDXC in the registry', () => {
  it('each model names its code; each is registered once, in the Market group, with a market and a stock variant, on no switch', () => {
    expect([MNA_CODE, IDXC_CODE]).toEqual(['MNA', 'IDXC'])
    for (const code of ['MNA', 'IDXC']) {
      expect(FUNCTIONS.filter((f) => f.code === code), code).toHaveLength(1)
      expect(BY_CODE[code].group, code).toBe('Market')
      expect(BY_CODE[code].market.flag, code).toBeUndefined()
      expect(variantFor(code, false), code).toMatchObject({ scope: 'market' })
      expect(variantFor(code, true), code).toMatchObject({ scope: 'ticker' })
      expect(typeof PANEL_IMPORTERS[BY_CODE[code].market.panel], code).toBe('function')
      expect(exampleFor(BY_CODE[code]), code).toBe(code)
      expect(parseCommand(BY_CODE[code].example), code).toMatchObject({ ok: true, type: 'function', code, sym: null })
    }
    // both variants take MARKET (functions.marketView.test.js): a panel that follows a stock resolves to the ticker one
    expect(BY_CODE.MNA.market).toEqual({ panel: 'Mergers', args: [{ kind: 'marketView', prop: 'view' }] })
    expect(BY_CODE.MNA.ticker).toEqual({ panel: 'Mergers', args: [{ kind: 'marketView', prop: 'view' }] })
    expect(BY_CODE.MNA.label).toBe('Mergers and acquisitions (latest deals)')
    const idxcArgs = [{ kind: 'marketView', prop: 'view' }, { kind: 'idxcIndex', prop: 'index' }]
    expect(BY_CODE.IDXC.market).toEqual({ panel: 'IndexChanges', args: idxcArgs })
    expect(BY_CODE.IDXC.ticker).toEqual({ panel: 'IndexChanges', args: idxcArgs })
    expect(BY_CODE.IDXC.label).toBe('Index changes (additions and removals)')
  })

  it('IDXC\'s index word: the copy is the model\'s map; the registry applies it; the chips write back the same pick', () => {
    expect(IDXC_INDEX_WORDS).toEqual(IDXC_INDEX_ARG_WORDS)
    for (const tok of ['S&P500', 's&p500', 'NASDAQ100', 'DOW30', 'SP500', 'NDX', 'DOW', '', null]) {
      expect(ARG_KINDS.idxcIndex.parse(tok), String(tok)).toBe(parseIdxcIndex(tok))
    }
    const run = (tokens) => applyArgs(BY_CODE.IDXC.market, tokens)
    expect(run(['NASDAQ100']).props).toEqual({ index: 'nasdaq100' })
    expect(run(['DOW30', 'NASDAQ100']).ignored).toEqual(['NASDAQ100'])
    for (const index of Object.keys(IDXC_INDEXES)) {
      const tokens = idxcCommandArgs({ index })
      expect(run(tokens).props).toEqual({ index })
      expect(writeBackCommand('IDXC', tokens)).toBe(`IDXC ${tokens[0]}`)
    }
    expect(writeBackCommand('IDXC', [])).toBe('IDXC')
    expect(ARG_KINDS.idxcIndex.takes).toBe('S&P500, NASDAQ100 or DOW30')
  })
})

describe('MNA and IDXC parse', () => {
  it('bare is the market view; a ticker in either place is one company or one stock', () => {
    expect(parseCommand('MNA')).toMatchObject({ ok: true, code: 'MNA', sym: null, args: [] })
    expect(parseCommand('QQZA MNA')).toMatchObject({ ok: true, code: 'MNA', sym: 'QQZA' })
    expect(parseCommand('mna qqza')).toMatchObject({ ok: true, code: 'MNA', sym: 'QQZA' })
    expect(parseCommand('IDXC')).toMatchObject({ ok: true, code: 'IDXC', sym: null, args: [] })
    expect(parseCommand('QQZA IDXC')).toMatchObject({ ok: true, code: 'IDXC', sym: 'QQZA' })
    expect(parseCommand('IDXC NASDAQ100')).toMatchObject({ ok: true, code: 'IDXC', sym: null, args: ['NASDAQ100'] })
    expect(parseCommand('idxc dow30')).toMatchObject({ ok: true, code: 'IDXC', sym: null, args: ['DOW30'] })
    expect(parseCommand('IDXC S&P500')).toMatchObject({ ok: true, code: 'IDXC', sym: null, args: ['S&P500'] })
  })

  it('the codes and the index words are not stocks, other codes, COT\'s words, or words another code takes', () => {
    const u = universe()
    expect(u.has('NVDA')).toBe(true)
    for (const code of ['MNA', 'IDXC']) {
      expect(u.has(code), code).toBe(false)
      expect(isTickerCollision(code), code).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(COT_WORDS, code), code).toBe(false)
      for (const [kind, spec] of Object.entries(ARG_KINDS)) {
        expect(spec.parse(code, { today: '2026-11-21' }) == null || kind === 'symbol' || /Name|Query|code/i.test(kind), `${kind} takes ${code}`).toBe(true)
      }
    }
    for (const w of Object.keys(IDXC_INDEX_ARG_WORDS)) {
      expect(u.has(w), w).toBe(false)
      expect(isCode(w), w).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(COT_WORDS, w), w).toBe(false)
    }
  })

  it('the words a member would type find each code first', () => {
    const first = (q) => codesForWords(q, 1)[0]
    for (const q of ['mergers', 'acquisitions', 'mergers and acquisitions', 'takeover', 'buyout']) expect(first(q), q).toBe('MNA')
    for (const q of ['index changes', 'index additions', 'index rebalance', 'index history']) expect(first(q), q).toBe('IDXC')
  })
})
