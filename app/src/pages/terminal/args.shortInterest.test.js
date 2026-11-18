// Short interest (2026-11-18): the argument kind of SHRTS, and the two codes' shapes.
//
// args.js keeps its own small copies of vocabularies the panel model owns (so the panel's code
// stays out of the shell's first-open bytes). This rail pins the copy to its owner.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ARG_KINDS, SHORT_RANK_WORDS, applyArgs } from './args'
import { BY_CODE, FUNCTIONS, isCode, variantFor } from './functions'
import parseCommand from './parseCommand'
import { describeCommand } from './grammar'
import { writeBackCommand } from './panels/commandWriteBack'
import { SHORT_INTEREST_CODE } from './panels/shortInterestModel'
import { SHORT_LIST_CODE, SHORT_RANKS, SHORT_RANK_ARG_WORDS, parseShortRank, shortListCommandArgs } from './panels/shortListModel'

describe('the short interest argument kind matches the panel that owns the words', () => {
  it('the copy equals the model, word for word, and every chip token is taken', () => {
    expect(SHORT_RANK_WORDS).toEqual(SHORT_RANK_ARG_WORDS)
    for (const [word, value] of Object.entries(SHORT_RANK_ARG_WORDS)) {
      expect(ARG_KINDS.shortRank.parse(word.toLowerCase()), word).toBe(value)
      expect(parseShortRank(word), word).toBe(value)
    }
    for (const [key, spec] of Object.entries(SHORT_RANKS)) {
      if (spec.token) expect(ARG_KINDS.shortRank.parse(spec.token), key).toBe(key)
      expect(ARG_KINDS.shortRank.describe(key), key).toBeTruthy()
    }
    for (const no of ['NVDA', 'toString', 'constructor', '', '4X']) expect(ARG_KINDS.shortRank.parse(no), no).toBeNull()
    expect(ARG_KINDS.shortRank.describe('float')).toBe('highest percent of float first')
  })

  it('the registry applies the word to the prop the panel reads, and says what it did not take', () => {
    const run = (tokens) => applyArgs(BY_CODE.SHRTS.market, tokens)
    expect(run(['up']).props).toEqual({ rank: 'up' })
    expect(run(['FLOAT']).props).toEqual({ rank: 'float' })
    expect(run(['covering']).props).toEqual({ rank: 'down' })
    expect(run(['banana']).ignored).toEqual(['banana'])
    expect(run(['up', 'down']).ignored).toEqual(['down'])      // one rank: the second is said, not dropped
    // what the panel writes back is read as the same pick, and the default is the bare command
    for (const key of Object.keys(SHORT_RANKS)) {
      const tokens = shortListCommandArgs({ rank: key })
      expect(run(tokens).props).toEqual(key === 'dtc' ? {} : { rank: key })
      expect(writeBackCommand('SHRTS', tokens)).toBe(['SHRTS', ...tokens].join(' '))
    }
  })
})

describe('the two codes', () => {
  it('SHINT is one stock, SHRTS is the market list, and each model names its own code', () => {
    expect(SHORT_INTEREST_CODE).toBe('SHINT')
    expect(SHORT_LIST_CODE).toBe('SHRTS')
    expect(BY_CODE.SHINT.ticker).toEqual({ panel: 'ShortInterest' })
    expect(BY_CODE.SHINT.market).toBeUndefined()
    expect(BY_CODE.SHRTS.ticker).toBeUndefined()
    expect(BY_CODE.SHRTS.market.panel).toBe('ShortList')
    expect(variantFor('SHINT', true)).toMatchObject({ scope: 'ticker' })
    // with no ticker typed it is still a per-stock code: the shell uses the panel's linked stock
    expect(variantFor('SHINT', false)).toEqual({ variant: null, reason: 'needs-ticker' })
    expect(parseCommand('NVDA SHINT')).toMatchObject({ ok: true, type: 'function', code: 'SHINT', sym: 'NVDA' })
    expect(parseCommand('SHINT NVDA')).toMatchObject({ ok: true, type: 'function', code: 'SHINT', sym: 'NVDA' })
    expect(parseCommand('SHINT')).toMatchObject({ ok: true, type: 'function', code: 'SHINT', sym: null })
    expect(parseCommand('SHRTS UP')).toMatchObject({ ok: true, type: 'function', code: 'SHRTS', sym: null, args: ['UP'] })
    // UP and DTC are real tickers too: after SHRTS each is the rank, in either case
    expect(parseCommand('shrts dtc')).toMatchObject({ ok: true, code: 'SHRTS', sym: null, args: ['DTC'] })
  })

  it('a ticker in front of the market list is said as ignored, with the code for that stock', () => {
    const cmd = parseCommand('NVDA SHRTS')
    expect(cmd).toMatchObject({ ok: true, type: 'function', code: 'SHRTS', sym: 'NVDA' })
    expect(variantFor('SHRTS', true)).toMatchObject({ scope: 'market', ignoredTicker: true })
    const echo = describeCommand(cmd)
    expect(echo.tone).toBe('warn')
    expect(echo.text).toContain('SHRTS is market-wide; NVDA is ignored. NVDA SHINT opens short interest history (every report, days to cover, daily short volume).')
  })

  it('SHORT stays what it was: CONFL\'s word for bearish, and never a code', () => {
    // a code in second place makes the first token a ticker, so SHORT as a code would have turned
    // `CONFL SHORT` into "the SHORT function on a ticker called CONFL"
    expect(isCode('SHORT')).toBe(false)
    const cmd = parseCommand('CONFL SHORT')
    expect(cmd).toMatchObject({ ok: true, type: 'function', code: 'CONFL', sym: null, args: ['SHORT'] })
    expect(applyArgs(BY_CODE.CONFL.market, cmd.args).props).toEqual({ lean: 'bearish' })
    // and no word any other code takes as an argument is one of the two new codes
    for (const [kind, spec] of Object.entries(ARG_KINDS)) {
      for (const code of ['SHINT', 'SHRTS']) expect(spec.parse(code, { today: '2026-11-18' }) == null || kind === 'symbol' || /Name|Query|code/i.test(kind), `${kind} takes ${code}`).toBe(true)
    }
  })

  it('neither code is a stock the site follows, and SHRT (a real fund) is not a code', () => {
    const read = (name) => JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', name), 'utf8'))
    const universe = new Set(read('cap_universe.json'))
    expect(universe.size).toBeGreaterThan(3000)
    expect(universe.has('NVDA')).toBe(true)                    // the control: the list is the ticker list
    for (const code of ['SHINT', 'SHRTS']) {
      expect(universe.has(code), code).toBe(false)
      expect(FUNCTIONS.filter((f) => f.code === code)).toHaveLength(1)
      expect(code).toMatch(/^[A-Z]{2,5}$/)                      // functions.rail.test.js: a code is 2 to 5 characters
    }
    expect(isCode('SHRT')).toBe(false)
    expect(isCode('SHORTS')).toBe(false)
  })
})
