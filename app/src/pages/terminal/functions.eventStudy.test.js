// EVST (2026-11-22): the code's shape in the registry, the words that find it (and the words that stay
// other functions'), and that it is not a stock.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { BY_CODE, FUNCTIONS, FUNCTION_GROUPS, codesForWords, exampleFor, isCode, variantFor } from './functions'
import { isTickerCollision } from './grammar'
import parseCommand from './parseCommand'
import { PANEL_IMPORTERS } from './panels'
import { EVST_CODE } from './panels/eventStudyModel'

describe('EVST in the registry', () => {
  it('the model names the code; it is registered once, in the Market group, for the market and per ticker, with no argument', () => {
    expect(EVST_CODE).toBe('EVST')
    expect(FUNCTIONS.filter((f) => f.code === 'EVST')).toHaveLength(1)
    expect(FUNCTION_GROUPS).toContain(BY_CODE.EVST.group)
    expect(BY_CODE.EVST.group).toBe('Market')
    expect(BY_CODE.EVST.label).toBe('What happened next (build your own historical study)')
    expect(BY_CODE.EVST.market).toEqual({ panel: 'EventStudy' })
    expect(BY_CODE.EVST.ticker).toEqual({ panel: 'EventStudy' })
    expect(exampleFor(BY_CODE.EVST)).toBe('EVST')
    expect(variantFor('EVST', false)).toMatchObject({ scope: 'market' })
    expect(variantFor('EVST', true)).toMatchObject({ scope: 'ticker' })
    expect(typeof PANEL_IMPORTERS.EventStudy).toBe('function')
  })

  it('EVST parses alone and with a ticker in either order, in lower case too', () => {
    expect(isCode('evst')).toBe(true)
    expect(parseCommand('EVST')).toMatchObject({ ok: true, type: 'function', code: 'EVST', args: [] })
    expect(parseCommand('EVST').collision).toBeUndefined()
    expect(parseCommand('NVDA EVST')).toMatchObject({ ok: true, type: 'function', code: 'EVST', sym: 'NVDA', args: [] })
    expect(parseCommand('evst qqq')).toMatchObject({ ok: true, type: 'function', code: 'EVST', sym: 'QQQ', args: [] })
  })

  it('its words find it first, and the words other functions answer to stay theirs', () => {
    for (const w of ['event study', 'event studies', 'historical study', 'build a study', 'study builder', 'what happened after']) {
      expect([w, codesForWords(w)[0]]).toEqual([w, 'EVST'])
    }
    // the phrase in its title that ANLG (days like today) already answers stays ANLG's
    expect(codesForWords('what happened next')[0]).toBe('ANLG')
    expect(codesForWords('seasonality')[0]).toBe('SEAS')
    // "study", "historical" and "build" are words of its own label (the brief's title) that no other function
    // answers (the Desk's Study course has no Terminal code), so each finds EVST alone
    for (const w of ['study', 'historical', 'build']) expect([w, codesForWords(w)]).toEqual([w, ['EVST']])
    // no generic single word another function answers finds it first
    for (const w of ['event', 'history', 'what', 'next', 'happened', 'returns', 'return', 'forward',
      'market', 'breadth', 'stock', 'after', 'own', 'your', 'condition', 'series']) {
      expect([w, codesForWords(w)[0]]).not.toEqual([w, 'EVST'])
    }
  })

  it('the code is not a stock the site follows', () => {
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.size).toBeGreaterThan(3000)
    expect(universe.has('NVDA')).toBe(true)                          // the control: the list is the ticker list
    expect(universe.has('EVST')).toBe(false)
    expect(isTickerCollision('EVST')).toBe(false)
  })
})
