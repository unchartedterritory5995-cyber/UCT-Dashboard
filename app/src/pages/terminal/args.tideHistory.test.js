// Market Tide by day (2026-11-19): the argument kind of TIDEH, and the code's shape.
//
// args.js keeps its own small copy of the vocabulary the panel model owns (so the panel's code
// stays out of the shell's first-open bytes). This rail pins the copy to its owner.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ARG_KINDS, TIDE_SCOPE_WORDS, applyArgs } from './args'
import { BY_CODE, FUNCTIONS, isCode, variantFor } from './functions'
import parseCommand from './parseCommand'
import { writeBackCommand } from './panels/commandWriteBack'
import { TIDE_HISTORY_CODE, TIDE_SCOPES, TIDE_SCOPE_ARG_WORDS, parseTideScope, tideHistoryCommandArgs } from './panels/tideHistoryModel'

describe('the tide scope matches the panel that owns the words', () => {
  it('the copy equals the model, word for word, and every chip token is taken', () => {
    expect(TIDE_SCOPE_WORDS).toEqual(TIDE_SCOPE_ARG_WORDS)
    for (const [word, value] of Object.entries(TIDE_SCOPE_ARG_WORDS)) {
      expect(ARG_KINDS.tideScope.parse(word.toLowerCase()), word).toBe(value)
      expect(parseTideScope(word), word).toBe(value)
    }
    for (const [key, spec] of Object.entries(TIDE_SCOPES)) if (spec.token) expect(ARG_KINDS.tideScope.parse(spec.token), key).toBe(key)
    for (const no of ['NVDA', 'toString', 'constructor', '', 'ALL', 'ETF']) expect(ARG_KINDS.tideScope.parse(no), no).toBeNull()
    expect(ARG_KINDS.tideScope.describe('stocks')).toBe('stocks only')
    expect(ARG_KINDS.tideScope.describe('etfs')).toBe('ETFs and indexes only')
  })

  it('the registry applies the word to the prop the panel reads, and says what it did not take', () => {
    const run = (tokens) => applyArgs(BY_CODE.TIDEH.market, tokens)
    expect(run(['etfs']).props).toEqual({ scope: 'etfs' })
    expect(run(['STOCK']).props).toEqual({ scope: 'stocks' })
    expect(run(['banana']).ignored).toEqual(['banana'])
    expect(run(['STOCKS', 'ETFS']).ignored).toEqual(['ETFS'])     // one scope: the second is said, not dropped
    // what the panel writes back is read as the same pick, and the default is the bare command
    for (const key of Object.keys(TIDE_SCOPES)) {
      const tokens = tideHistoryCommandArgs({ scope: key })
      expect(run(tokens).props).toEqual(key === 'all' ? {} : { scope: key })
      expect(writeBackCommand('TIDEH', tokens)).toBe(['TIDEH', ...tokens].join(' '))
    }
  })
})

describe('the code', () => {
  it('TIDEH is market-wide, in the Options group, and the model names it', () => {
    expect(TIDE_HISTORY_CODE).toBe('TIDEH')
    expect(BY_CODE.TIDEH.market).toEqual({ panel: 'TideHistory', args: [{ kind: 'tideScope', prop: 'scope' }] })
    expect(BY_CODE.TIDEH.ticker).toBeUndefined()
    expect(BY_CODE.TIDEH.group).toBe('Options')
    expect(BY_CODE.TIDEH.label).toBe('Market Tide by day (net premium, each session)')
    expect(BY_CODE.TIDEH.example).toBe('TIDEH')
    expect(variantFor('TIDEH', false)).toMatchObject({ scope: 'market' })
    // today's tide keeps its own code and panel
    expect(BY_CODE.TIDE.market.panel).toBe('MarketTide')
  })

  it('the bare code and a scope after it both parse as the market function', () => {
    expect(parseCommand('TIDEH')).toMatchObject({ ok: true, type: 'function', code: 'TIDEH', sym: null, args: [] })
    expect(parseCommand('tideh etfs')).toMatchObject({ ok: true, type: 'function', code: 'TIDEH', sym: null, args: ['ETFS'] })
    expect(parseCommand('TIDEH STOCKS')).toMatchObject({ ok: true, type: 'function', code: 'TIDEH', sym: null, args: ['STOCKS'] })
  })

  it('no scope word is a function code, and the code is not a word another code takes', () => {
    // a code in second place makes the first token a ticker, so a scope word that was a code would
    // turn `TIDEH ETF` into "the ETF function on a ticker called TIDEH" (which is why ETF is not a word)
    for (const word of Object.keys(TIDE_SCOPE_ARG_WORDS)) expect(isCode(word), word).toBe(false)
    expect(isCode('ETF')).toBe(true)                                // the control: isCode can say yes
    for (const [kind, spec] of Object.entries(ARG_KINDS)) {
      expect(spec.parse('TIDEH', { today: '2026-11-19' }) == null || kind === 'symbol' || /Name|Query|code/i.test(kind), `${kind} takes TIDEH`).toBe(true)
    }
  })

  it('the code and its scope words are not stocks the site follows', () => {
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.size).toBeGreaterThan(3000)
    expect(universe.has('NVDA')).toBe(true)                         // the control: the list is the ticker list
    expect(universe.has('TIDEH')).toBe(false)
    for (const word of Object.keys(TIDE_SCOPE_ARG_WORDS)) expect(universe.has(word), word).toBe(false)
    expect(FUNCTIONS.filter((f) => f.code === 'TIDEH')).toHaveLength(1)
    expect('TIDEH').toMatch(/^[A-Z]{2,5}$/)
  })
})
