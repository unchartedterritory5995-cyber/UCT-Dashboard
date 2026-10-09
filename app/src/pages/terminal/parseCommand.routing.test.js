// W9-4: command-line routing edge cases, one probe per line a member might type. Each row is
// what parseCommand reads; TerminalShell.wave4.test.jsx runs the shell-side ones end to end.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import parseCommand from './parseCommand'
import { BY_CODE, FUNCTIONS } from './functions'
import { TICKER_COLLISIONS, describeCommand, marketWideNote } from './grammar'

const REPO = path.resolve(__dirname, '../../../..')
const fn = (code, sym = null, args = []) => ({ ok: true, type: 'function', code, sym, args })

describe('spelling: case, spaces, $ and share classes', () => {
  it.each([
    ['nvda', fn('DES', 'NVDA')],
    ['  nvda   gp  ', fn('GP', 'NVDA')],
    ['$nvda', fn('DES', 'NVDA')],
    ['GP $nvda', fn('GP', 'NVDA')],
    ['nvda gp 1w', fn('GP', 'NVDA', ['1W'])],
    ['BRK.B', fn('DES', 'BRK.B')],
    ['brk.b gp', fn('GP', 'BRK.B')],
    ['GP BRK.B', fn('GP', 'BRK.B')],
    ['BRK-B', fn('DES', 'BRK-B')],
    ['BRK/B', fn('DES', 'BRK.B')],
    ['$BRK.B', fn('DES', 'BRK.B')],
    ['nvda.', fn('DES', 'NVDA')],
  ])('%j', (line, want) => {
    expect(parseCommand(line)).toMatchObject(want)
  })

  it('a stray $ is refused with the next step, never a crash', () => {
    for (const line of ['$', 'NVDA$']) {
      const r = parseCommand(line)
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/Start with a ticker/)
    }
  })
})

describe('row numbers', () => {
  it.each([['3', 3], ['03', 3], ['0', 0]])('%j is a row pick', (line, n) => {
    expect(parseCommand(line)).toMatchObject({ ok: true, type: 'row', n })
  })
  it('four digits is not a row, and the refusal says what a line starts with', () => {
    expect(parseCommand('1000')).toMatchObject({ ok: false })
    expect(parseCommand('1000').error).toMatch(/Start with a ticker/)
  })
})

describe('unknown codes suggest the near miss', () => {
  it.each([['NVDA PERR', 'PEER'], ['NVDA GPP', 'GP'], ['nvda brk0', 'BRKO']])('%j suggests %s', (line, near) => {
    const r = parseCommand(line)
    expect(r).toMatchObject({ ok: false, sym: 'NVDA' })
    expect(r.suggestions).toContain(near)
  })
  it('a bare unknown word is a ticker (DES), by design: the symbol list does not settle it', () => {
    expect(parseCommand('PERR')).toMatchObject(fn('DES', 'PERR'))
  })
})

// Today's codes in every placement.
const SECURITY = ['PEER', 'ETF', 'TWT', 'CHK', 'PLAN']
// SCAT is not here: it takes a universe and axes (scatterArgs.js), so like THMS it says what it takes.
const MARKET = ['NEWS', 'REGM', 'INS', 'RSL', 'SENT', 'BRKO']

describe("today's codes, every placement", () => {
  it.each(SECURITY)('%s: NVDA X, X NVDA and lowercase all read X on NVDA; X alone waits for the linked security', (c) => {
    expect(parseCommand(`NVDA ${c}`)).toMatchObject(fn(c, 'NVDA'))
    expect(parseCommand(`${c} NVDA`)).toMatchObject(fn(c, 'NVDA'))
    expect(parseCommand(`${c.toLowerCase()} nvda`)).toMatchObject(fn(c, 'NVDA'))
    expect(parseCommand(c)).toMatchObject(fn(c, null))
    expect(BY_CODE[c].market).toBeUndefined()
  })

  it.each(MARKET)('%s: X alone is the market view; NVDA X and X NVDA both say NVDA is ignored', (c) => {
    expect(parseCommand(c)).toMatchObject(fn(c, null))
    expect(parseCommand(`NVDA ${c}`)).toMatchObject(fn(c, 'NVDA'))
    expect(parseCommand(`${c} NVDA`)).toMatchObject(fn(c, 'NVDA'))
    expect(describeCommand(parseCommand(`${c} NVDA`)).text).toContain(`${c} is market-wide; NVDA is ignored.`)
  })

  it('THMS takes a window, so THMS NVDA says what THMS takes instead', () => {
    expect(parseCommand('THMS 1W')).toMatchObject(fn('THMS', null, ['1W']))
    expect(parseCommand('THMS NVDA')).toMatchObject(fn('THMS', null, ['NVDA']))
    expect(describeCommand(parseCommand('THMS NVDA')).text).toMatch(/Not applied: "NVDA"/)
  })

  it('SCAT takes a universe and axes, so SCAT NVDA says NVDA was not applied', () => {
    expect(parseCommand('SCAT')).toMatchObject(fn('SCAT', null))
    expect(parseCommand('SCAT NVDA')).toMatchObject(fn('SCAT', null, ['NVDA']))
    expect(describeCommand(parseCommand('SCAT NVDA')).text).toMatch(/Not applied: "NVDA"/)
  })

  it('SIZE works with or without a ticker', () => {
    expect(parseCommand('SIZE')).toMatchObject(fn('SIZE', null))
    expect(parseCommand('SIZE NVDA')).toMatchObject(fn('SIZE', 'NVDA'))
    expect(parseCommand('NVDA SIZE')).toMatchObject(fn('SIZE', 'NVDA'))
  })

  it('PLAN carries its prices in either order', () => {
    expect(parseCommand('PLAN NVDA 203 195')).toMatchObject(fn('PLAN', 'NVDA', ['203', '195']))
    expect(parseCommand('NVDA PLAN 203 195')).toMatchObject(fn('PLAN', 'NVDA', ['203', '195']))
  })

  it("NEWS and INS point at the ticker's own view", () => {
    expect(marketWideNote('NEWS', 'NVDA')).toBe('NEWS is market-wide; NVDA is ignored. NVDA CN opens company news.')
    expect(marketWideNote('INS', 'NVDA')).toContain('NVDA PPL opens people')
    expect(marketWideNote('REGM', 'NVDA')).toBe('REGM is market-wide; NVDA is ignored.')
  })
})

describe('words that are both a code and a ticker', () => {
  it('every registered code that is a tracked symbol is on the collision list', () => {
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(REPO, 'api/data/cap_universe.json'), 'utf8')))
    const both = FUNCTIONS.map((f) => f.code).filter((c) => universe.has(c)).sort()
    expect(both.length).toBeGreaterThan(5)
    expect([...TICKER_COLLISIONS].sort()).toEqual(both)
  })

  it.each(['OBT', 'OSCR'])('bare %s runs the function and warns; the $ form is the stock', (c) => {
    expect(parseCommand(c)).toMatchObject({ ok: true, code: c, collision: c })
    expect(parseCommand(`$${c}`)).toMatchObject(fn('DES', c))
  })

  it.each([
    ['PEER CAL', fn('PEER', 'CAL')], // only CAL is a ticker: PEER on Caleres
    ['GP CAL', fn('GP', 'CAL')],
    ['CAL PEER', fn('PEER', 'CAL')], // canonical order: CAL is the ticker
    ['PEER $CAL', fn('PEER', 'CAL')],
    ['CF DES', fn('DES', 'CF')], // both are tickers: canonical order holds
    ['RES CF', fn('CF', 'RES')],
    ['ALL', fn('DES', 'ALL')], // ALL is not a code
    ['ALL GP', fn('GP', 'ALL')],
    ['ETF DES', fn('DES', 'ETF')],
    ['NEWS DES', fn('DES', 'NEWS')],
  ])('%j', (line, want) => {
    expect(parseCommand(line)).toMatchObject(want)
  })

  it('CAL alone is the calendar and says CAL is also a ticker', () => {
    expect(parseCommand('CAL')).toMatchObject({ ok: true, code: 'CAL', collision: 'CAL' })
  })
})
