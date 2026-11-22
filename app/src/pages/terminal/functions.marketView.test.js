// DVD MARKET, MNA MARKET, IDXC MARKET (2026-11-21): the market view word in the registry, how it parses, and the
// words that find DVD.
//
// A panel that follows a group's stock is handed that stock by the shell even for a bare market command
// (boardModel.panelSym, TerminalShell resolvePanel), so it resolves to the per-stock variant. The word MARKET is
// what asks for the whole market there, so BOTH variants of each code declare it, and args.js keeps a copy of the
// shared word (so the panels' code stays out of the shell's first-open bytes). This rail pins the copy to its owner.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { ARG_KINDS, MARKET_VIEW_WORDS, applyArgs } from './args'
import { BY_CODE, codesForWords, isCode } from './functions'
import { isTickerCollision } from './grammar'
import parseCommand, { formatCommand } from './parseCommand'
import { resolvePanel } from './TerminalShell'
import { writeBackCommand } from './panels/commandWriteBack'
import { COT_WORDS } from './panels/cotModel'
import { DVD_VIEW_ARG_WORDS, dvdViewCommandArgs } from './panels/marketDividendsModel'
import { MARKET_VIEW_ARG_WORDS, MARKET_VIEW_WORD, marketViewArgs, parseMarketView } from './panels/marketViewModel'

const universe = () => new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
const CODES = ['DVD', 'MNA', 'IDXC']

describe('the market view word matches the model that owns it', () => {
  it('the copy is the model\'s map, and both read a token the same way', () => {
    expect(MARKET_VIEW_WORDS).toEqual(MARKET_VIEW_ARG_WORDS)
    expect(DVD_VIEW_ARG_WORDS).toBe(MARKET_VIEW_ARG_WORDS)
    expect(MARKET_VIEW_WORD).toBe('MARKET')
    for (const tok of ['MARKET', 'market', 'MKT', ' mkt ', 'ALL', 'MINE', 'NVDA', '', null, undefined]) {
      expect(ARG_KINDS.marketView.parse(tok), String(tok)).toBe(parseMarketView(tok))
    }
    expect(ARG_KINDS.marketView.describe('market')).toBe('the whole market')
    expect(ARG_KINDS.marketView.takes).toBe('MARKET')
    expect(marketViewArgs(true)).toEqual(['MARKET'])
    expect(marketViewArgs(false)).toEqual([])
  })

  it('both variants of each code take the word, so a panel that follows a stock still gets it', () => {
    for (const code of CODES) {
      for (const scope of ['ticker', 'market']) {
        const v = BY_CODE[code][scope]
        expect(v.args.find((a) => a.kind === 'marketView'), `${code} ${scope}`).toEqual({ kind: 'marketView', prop: 'view' })
        expect(applyArgs(v, ['MARKET']).props, `${code} ${scope}`).toMatchObject({ view: 'market' })
        expect(applyArgs(v, ['MARKET', 'MKT']).ignored, `${code} ${scope}`).toEqual(['MKT'])
      }
    }
    expect(applyArgs(BY_CODE.IDXC.ticker, ['MARKET', 'NASDAQ100']).props).toEqual({ view: 'market', index: 'nasdaq100' })
  })

  it('a stored market command on a panel that follows a stock resolves to the stock variant and keeps the word', () => {
    for (const code of CODES) {
      const linked = resolvePanel({ id: 'p1', code, args: ['MARKET'], channel: 'A' }, { A: 'QQZA' }, null)
      expect(linked, code).toMatchObject({ state: 'ready', sym: 'QQZA', props: { view: 'market' } })
      expect(linked.variant, code).toBe(BY_CODE[code].ticker)
      const bare = resolvePanel({ id: 'p1', code, args: [], channel: 'A' }, { A: 'QQZA' }, null)
      expect(bare, code).toMatchObject({ state: 'ready', sym: 'QQZA' })
      expect(bare.props.view, code).toBeUndefined()
      const unlinked = resolvePanel({ id: 'p1', code, args: ['MARKET'], channel: 'A' }, { A: null }, null)
      expect(unlinked, code).toMatchObject({ state: 'ready', sym: null, props: { view: 'market' } })
    }
  })

  it('what the chips write back runs as the same view, with or without the panel\'s stock', () => {
    expect(writeBackCommand('DVD', dvdViewCommandArgs({ view: 'market' }))).toBe('DVD MARKET')
    expect(writeBackCommand('DVD', dvdViewCommandArgs({ view: 'mine' }))).toBe('DVD')
    expect(writeBackCommand('DVD', ['MARKET'], 'QQZA')).toBe('QQZA DVD MARKET')
    expect(writeBackCommand('MNA', ['MARKET'], 'QQZA')).toBe('QQZA MNA MARKET')
    expect(writeBackCommand('MNA', [], 'QQZA')).toBe('QQZA MNA')
    expect(writeBackCommand('IDXC', ['MARKET', 'DOW30'], 'QQZA')).toBe('QQZA IDXC MARKET DOW30')
  })
})

describe('the market view word parses', () => {
  it('is an argument, never a ticker; a ticker stays one stock', () => {
    for (const code of CODES) {
      expect(parseCommand(`${code} MARKET`), code).toMatchObject({ ok: true, type: 'function', code, sym: null, args: ['MARKET'] })
      expect(formatCommand(parseCommand(`${code.toLowerCase()} mkt`)), code).toBe(`${code} MKT`)
      expect(parseCommand(`QQZA ${code} MARKET`), code).toMatchObject({ ok: true, code, sym: 'QQZA', args: ['MARKET'] })
      expect(parseCommand(`${code} QQZA`), code).toMatchObject({ ok: true, code, sym: 'QQZA' })
    }
    // ALL is a stock the site follows (the reason the view word is not ALL): `DVD ALL` is that stock
    expect(parseCommand('DVD ALL')).toMatchObject({ ok: true, code: 'DVD', sym: 'ALL', args: [] })
  })

  it('the view words are not stocks, function codes or another dictionary\'s words', () => {
    const u = universe()
    expect(u.has('NVDA') && u.has('ALL')).toBe(true)                      // the control: the list is the ticker list
    for (const w of Object.keys(MARKET_VIEW_ARG_WORDS)) {
      expect(u.has(w), w).toBe(false)
      expect(isCode(w), w).toBe(false)
      expect(isTickerCollision(w), w).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(COT_WORDS, w), w).toBe(false)
    }
  })
})

describe('words find DVD', () => {
  it('the market words find DVD first', () => {
    const first = (q) => codesForWords(q, 1)[0]
    for (const q of ['market dividends', 'ex dividend this week', 'splits this week', 'dividend calendar', 'dividends']) expect(first(q), q).toBe('DVD')
    expect(BY_CODE.DVD.note).toContain('DVD MARKET')
    expect(BY_CODE.MNA.note).toContain('MNA MARKET')
    expect(BY_CODE.IDXC.note).toContain('IDXC MARKET')
  })
})
