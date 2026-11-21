// Market wave A (2026-11-20): the argument kinds of COT and ANLG, and the three codes' shape.
//
// args.js keeps its own small copies of two rules the panel models own (so the panels' code stays
// out of the shell's first-open bytes). This rail pins each copy to its owner, and pins the plain
// words COT takes to the markets the server lists.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { ANLG_COUNT_BOUNDS, ARG_KINDS, COT_MARKET_SHAPE, applyArgs } from './args'
import { BY_CODE, FUNCTIONS, codesForWords, isCode, variantFor } from './functions'
import { isTickerCollision } from './grammar'
import { PANEL_IMPORTERS } from './panels'
import parseCommand from './parseCommand'
import { writeBackCommand } from './panels/commandWriteBack'
import { ANLG_CODE, ANLG_COUNT_DEFAULT, ANLG_COUNT_MAX, ANLG_COUNT_MIN, anlgCommandArgs, parseAnlgCount } from './panels/analoguesModel'
import { COT_ARG_SHAPE, COT_CODE, COT_WORDS, cotCommandArgs, parseCotArg } from './panels/cotModel'
import { MKTS_CODE } from './panels/marketsBoardModel'

/** The market codes the server lists (`SYMBOL_GROUPS` in api/services/cot_service.py), read from the file. */
function serverMarketCodes() {
  const py = fs.readFileSync(path.join(process.cwd(), '..', 'api', 'services', 'cot_service.py'), 'utf8').split(/\r?\n/).join('\n')
  const start = py.indexOf('SYMBOL_GROUPS: dict')
  const block = py.slice(start, py.indexOf('\n}\n', start))
  const codes = new Set()
  for (const line of block.split('\n')) {
    const list = line.includes(':') ? line.slice(line.indexOf(':') + 1) : line       // drop the group's own name
    if (line.trim().startsWith('#')) continue
    for (const m of list.matchAll(/"([A-Z0-9]{1,5})"/g)) codes.add(m[1])
  }
  return codes
}

describe('the COT market word matches the panel that owns the rule', () => {
  it('the copy is the model\'s shape, and both read a token the same way', () => {
    expect(COT_MARKET_SHAPE.source).toBe(COT_ARG_SHAPE.source)
    expect(COT_MARKET_SHAPE.flags).toBe(COT_ARG_SHAPE.flags)
    for (const tok of ['gold', 'ES', '10y', 'S&P', 'B6', 'SR3', 'E-MINI', ' zn ', 'ABCDEFGHIJKL', ...Object.keys(COT_WORDS), ...Object.values(COT_WORDS)]) {
      expect(ARG_KINDS.cotMarketName.parse(tok), tok).toBe(parseCotArg(tok))
      expect(ARG_KINDS.cotMarketName.parse(tok), tok).toBe(tok.trim().toUpperCase())
    }
    for (const no of ['', ' ', 'A B', '-X', '.X', 'ABCDEFGHIJKLM', 'GOLD!', '$GC', 'W:3', null, undefined]) {
      expect(ARG_KINDS.cotMarketName.parse(no), String(no)).toBeNull()
      expect(parseCotArg(no), String(no)).toBeNull()
    }
    expect(ARG_KINDS.cotMarketName.describe('GOLD')).toBe('market "GOLD"')
    expect(ARG_KINDS.cotMarketName.takes).toBe('a futures market: its code or a plain word (COT GOLD, COT ES, COT 10Y)')
  })

  it('every plain word names a market the server lists, and every listed code is a word COT takes', () => {
    const codes = serverMarketCodes()
    expect(codes.size).toBeGreaterThanOrEqual(50)
    expect(codes.has('ES') && codes.has('GC') && codes.has('ZN') && codes.has('SR3')).toBe(true)     // the control: these are the market codes
    expect(codes.has('SOFTS') || codes.has('METALS')).toBe(false)                                    // a group's name is not a market
    for (const [word, code] of Object.entries(COT_WORDS)) expect(codes.has(code), `${word} -> ${code}`).toBe(true)
    for (const code of codes) expect(ARG_KINDS.cotMarketName.parse(code), code).toBe(code)
  })

  it('the registry applies the word to the prop the panel reads, and says what it did not take', () => {
    const run = (tokens) => applyArgs(BY_CODE.COT.market, tokens)
    expect(run(['gold']).props).toEqual({ market: 'GOLD' })
    expect(run(['10Y']).props).toEqual({ market: '10Y' })
    expect(run(['GOLD']).applied).toEqual(['market "GOLD"'])
    expect(run([]).props).toEqual({})
    expect(run(['GOLD', 'SILVER']).ignored).toEqual(['SILVER'])       // one market: the second is said, not dropped
    expect(run(['GOLD!']).ignored).toEqual(['GOLD!'])
    // what the panel writes back is read as the same pick, and the board is the bare command
    for (const code of ['GC', 'ES', 'SR3', 'B6']) {
      const tokens = cotCommandArgs({ market: code })
      expect(run(tokens).props).toEqual({ market: code })
      expect(writeBackCommand('COT', tokens)).toBe(`COT ${code}`)
      expect(parseCommand(writeBackCommand('COT', tokens))).toMatchObject({ ok: true, code: 'COT', sym: null, args: [code] })
    }
    expect(cotCommandArgs({ market: '' })).toEqual([])
    expect(writeBackCommand('COT', [])).toBe('COT')
  })
})

describe('the ANLG count matches the panel that owns the bounds', () => {
  it('the copy equals the model, and both read a token the same way', () => {
    expect([...ANLG_COUNT_BOUNDS]).toEqual([ANLG_COUNT_MIN, ANLG_COUNT_MAX])
    expect([ANLG_COUNT_MIN, ANLG_COUNT_MAX, ANLG_COUNT_DEFAULT]).toEqual([3, 10, 5])
    for (let n = 0; n <= 12; n += 1) expect(ARG_KINDS.anlgCount.parse(String(n)), String(n)).toBe(parseAnlgCount(String(n)))
    for (const n of [3, 4, 5, 6, 7, 8, 9, 10]) expect(ARG_KINDS.anlgCount.parse(String(n)), String(n)).toBe(n)
    for (const no of ['2', '11', '0', '-5', '5.5', '5X', 'FIVE', '', '007', '1e1', 'NVDA', null, undefined]) {
      expect(ARG_KINDS.anlgCount.parse(no), String(no)).toBeNull()
      expect(parseAnlgCount(no), String(no)).toBeNull()
    }
    expect(ARG_KINDS.anlgCount.describe(7)).toBe('7 similar sessions')
    expect(ARG_KINDS.anlgCount.takes).toBe('how many similar sessions (3 to 10)')
  })

  it('the registry applies the count to the prop the panel reads, and says what it did not take', () => {
    const run = (tokens) => applyArgs(BY_CODE.ANLG.market, tokens)
    expect(run(['7']).props).toEqual({ count: 7 })
    expect(run(['7']).applied).toEqual(['7 similar sessions'])
    expect(run(['12']).ignored).toEqual(['12'])
    expect(run(['12']).props).toEqual({})
    expect(run(['7', '8']).ignored).toEqual(['8'])                    // one count: the second is said, not dropped
    // what the panel writes back is read as the same pick, and the default is the bare command
    for (let n = ANLG_COUNT_MIN; n <= ANLG_COUNT_MAX; n += 1) {
      const tokens = anlgCommandArgs({ count: n })
      expect(run(tokens).props).toEqual(n === ANLG_COUNT_DEFAULT ? {} : { count: n })
      expect(writeBackCommand('ANLG', tokens)).toBe(['ANLG', ...tokens].join(' '))
    }
    expect(writeBackCommand('ANLG', anlgCommandArgs({ count: 5 }))).toBe('ANLG')
  })
})

describe('the three codes', () => {
  it('each is market-wide, in the Market group, registered once, and its model names it', () => {
    expect([COT_CODE, ANLG_CODE, MKTS_CODE]).toEqual(['COT', 'ANLG', 'MKTS'])
    expect(BY_CODE.COT.market).toEqual({ panel: 'Cot', args: [{ kind: 'cotMarketName', prop: 'market', open: true }] })
    expect(BY_CODE.ANLG.market).toEqual({ panel: 'Analogues', args: [{ kind: 'anlgCount', prop: 'count' }] })
    expect(BY_CODE.MKTS.market).toEqual({ panel: 'MarketsBoard' })
    expect(BY_CODE.COT.label).toBe('Futures positioning (Commitments of Traders)')
    expect(BY_CODE.ANLG.label).toBe('Days like today (breadth analogues)')
    expect(BY_CODE.MKTS.label).toBe('Markets board (index funds, volatility, rates, Bitcoin)')
    expect([BY_CODE.COT.example, BY_CODE.ANLG.example, BY_CODE.MKTS.example]).toEqual(['COT GOLD', 'ANLG', 'MKTS'])
    for (const code of ['COT', 'ANLG', 'MKTS']) {
      expect(BY_CODE[code].ticker, code).toBeUndefined()
      expect(BY_CODE[code].group, code).toBe('Market')
      expect(BY_CODE[code].market.flag, code).toBeUndefined()         // no new switch: each route has its own gate
      expect(variantFor(code, false), code).toMatchObject({ scope: 'market' })
      expect(FUNCTIONS.filter((f) => f.code === code), code).toHaveLength(1)
      expect(code).toMatch(/^[A-Z]{2,5}$/)
      expect(typeof PANEL_IMPORTERS[BY_CODE[code].market.panel], code).toBe('function')
      // every example runs as the function it documents
      expect(parseCommand(BY_CODE[code].example), code).toMatchObject({ ok: true, type: 'function', code, sym: null })
    }
  })

  it('the words a member would type find each code, and only that code', () => {
    for (const [code, words] of Object.entries({
      COT: ['cot', 'commitments of traders', 'futures positioning', 'commercials', 'large speculators', 'cftc'],
      ANLG: ['analogues', 'analogs', 'days like today', 'similar days', 'what happened next', 'breadth analogues'],
      MKTS: ['markets', 'cross asset', 'indexes', 'vix', 'bitcoin', 'markets board'],
    })) for (const w of words) expect(codesForWords(w), w).toEqual([code])
    // POS keeps its own word: COT's label holds "positioning" too, and POS still answers first
    expect(codesForWords('positioning')[0]).toBe('POS')
  })

  it('the bare code and an argument after it both parse as the market function', () => {
    expect(parseCommand('COT')).toMatchObject({ ok: true, type: 'function', code: 'COT', sym: null, args: [] })
    expect(parseCommand('cot gold')).toMatchObject({ ok: true, type: 'function', code: 'COT', sym: null, args: ['GOLD'] })
    expect(parseCommand('COT ES')).toMatchObject({ ok: true, type: 'function', code: 'COT', sym: null, args: ['ES'] })
    expect(parseCommand('COT 10Y')).toMatchObject({ ok: true, type: 'function', code: 'COT', sym: null, args: ['10Y'] })
    expect(parseCommand('COT S&P')).toMatchObject({ ok: true, type: 'function', code: 'COT', sym: null, args: ['S&P'] })
    // a market word is an argument, never a ticker COT is run on (COT takes no ticker)
    expect(parseCommand('COT GOLD').argNotTicker).toBeUndefined()
    expect(parseCommand('ANLG')).toMatchObject({ ok: true, type: 'function', code: 'ANLG', sym: null, args: [] })
    expect(parseCommand('anlg 8')).toMatchObject({ ok: true, type: 'function', code: 'ANLG', sym: null, args: ['8'] })
    expect(parseCommand('MKTS')).toMatchObject({ ok: true, type: 'function', code: 'MKTS', sym: null, args: [] })
    for (const code of ['COT', 'ANLG', 'MKTS']) expect(parseCommand(code).collision, code).toBeUndefined()
  })

  it('no market code or plain word is a function code, and the codes are not words another code takes', () => {
    // a code in second place makes the first token a ticker, so a market word that was a function
    // code would turn `COT XX` into "the XX function on a ticker called COT"
    // OIL is the one market word that is also a function code (the weekly oil report, 2026-11-21): COT's own
    // dictionary settles `COT OIL` as COT's (args.js `known`), so it is allowed here and pinned below
    const BOTH = new Set(['OIL'])
    for (const word of [...Object.keys(COT_WORDS), ...serverMarketCodes()]) {
      if (!BOTH.has(word)) expect(isCode(word), word).toBe(false)
      expect(parseCommand(`COT ${word}`), word).toMatchObject({ ok: true, code: 'COT', sym: null, args: [word] })
    }
    expect([...BOTH].every((w) => isCode(w))).toBe(true)
    expect(parseCommand('OIL')).toMatchObject({ ok: true, code: 'OIL', sym: null })
    // a code that is NOT one of COT's market words still reads as that code on a ticker called COT
    expect(parseCommand('COT CAL')).toMatchObject({ ok: true, code: 'CAL', sym: 'COT' })
    expect(isCode('RATES')).toBe(true)                               // the control: isCode can say yes
    for (const code of ['COT', 'ANLG', 'MKTS']) {
      for (const [kind, spec] of Object.entries(ARG_KINDS)) {
        expect(spec.parse(code, { today: '2026-11-20' }) == null || kind === 'symbol' || /Name|Query|code/i.test(kind), `${kind} takes ${code}`).toBe(true)
      }
    }
  })

  it('the codes are not stocks the site follows', () => {
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.size).toBeGreaterThan(3000)
    expect(universe.has('NVDA')).toBe(true)                          // the control: the list is the ticker list
    for (const code of ['COT', 'ANLG', 'MKTS']) {
      expect(universe.has(code), code).toBe(false)
      expect(isTickerCollision(code), code).toBe(false)
    }
  })
})
