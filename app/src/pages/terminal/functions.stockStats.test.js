// STAT (2026-11-21): the code's shape in the registry, the words that find it (and the words that stay
// other functions'), and that it is not a stock.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { BY_CODE, FUNCTIONS, FUNCTION_GROUPS, codesForWords, exampleFor, isCode, variantFor } from './functions'
import { isTickerCollision } from './grammar'
import parseCommand from './parseCommand'
import { PANEL_IMPORTERS } from './panels'
import { terminalCommandRow } from './paletteGrammar'
import { STAT_CODE } from './panels/stockStatsModel'

describe('STAT in the registry', () => {
  it('the model names the code; it is registered once, in the Security group, per ticker, with no argument and no switch', () => {
    expect(STAT_CODE).toBe('STAT')
    expect(FUNCTIONS.filter((f) => f.code === 'STAT')).toHaveLength(1)
    expect(FUNCTION_GROUPS).toContain(BY_CODE.STAT.group)
    expect(BY_CODE.STAT.group).toBe('Security')
    expect(BY_CODE.STAT.label).toBe('Stock statistics (volatility, beta, returns, drawdowns, how it acted in every market correction)')
    expect(BY_CODE.STAT.ticker).toEqual({ panel: 'StockStats' })
    expect(BY_CODE.STAT.market).toBeUndefined()
    expect(exampleFor(BY_CODE.STAT)).toBe('NVDA STAT')
    expect(variantFor('STAT', true)).toMatchObject({ scope: 'ticker' })
    expect(typeof PANEL_IMPORTERS.StockStats).toBe('function')
  })

  it('STAT parses as the function in either order and lower case; STAT alone waits for the linked security', () => {
    expect(isCode('stat')).toBe(true)
    expect(parseCommand('NVDA STAT')).toMatchObject({ ok: true, type: 'function', code: 'STAT', sym: 'NVDA', args: [] })
    expect(parseCommand('stat nvda')).toMatchObject({ ok: true, type: 'function', code: 'STAT', sym: 'NVDA', args: [] })
    expect(parseCommand('STAT')).toMatchObject({ ok: true, type: 'function', code: 'STAT', sym: null })
    expect(parseCommand('STAT').collision).toBeUndefined()
  })

  it('its words find it first, and the words other functions answer to stay theirs', () => {
    for (const w of ['stock statistics', 'statistics', 'stock stats', 'atr', 'beta', 'max drawdown', 'up capture', 'down capture']) {
      expect([w, codesForWords(w)[0]]).toEqual([w, 'STAT'])
    }
    // the brief's words another function already answers first: left with it
    expect(codesForWords('correlation')[0]).toBe('CORR')
    expect(codesForWords('drawdowns')[0]).toBe('MKTH')
    expect(codesForWords('volatility')[0]).toBe('IVH')
    expect(codesForWords('volatility', 6)).toContain('STAT')                       // offered after OVS and VOL
    // no generic single word finds it first
    for (const w of ['stock', 'stats', 'max', 'down', 'returns', 'range', 'average', 'each', 'market', 'history', 'risk', 'size']) {
      expect([w, codesForWords(w)[0]]).not.toEqual([w, 'STAT'])
    }
    // a ticker-shaped word that is a keyword offers STAT in the palette; the ticker stays the command line's
    expect(terminalCommandRow('atr').row.command).toBe('STAT')
    expect(parseCommand('ATR')).toMatchObject({ ok: true, code: 'DES', sym: 'ATR' })
    expect(parseCommand('BETA')).toMatchObject({ ok: true, code: 'DES', sym: 'BETA' })
  })

  it('the code is not a stock the site follows', () => {
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.size).toBeGreaterThan(3000)
    expect(universe.has('NVDA')).toBe(true)                          // the control: the list is the ticker list
    expect(universe.has('STAT')).toBe(false)
    expect(isTickerCollision('STAT')).toBe(false)
  })
})
