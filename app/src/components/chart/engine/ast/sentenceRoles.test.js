// THE READ-BACK NAMES A BAR-FIELD ARGUMENT BY ITS ROLE (NUMBER PENDING, studio, 2026-11-18).
//
// ⚰️ `stoch`, `atr`, `adx`, `cci`, `mfi` and the Donchian lines take the bar's fields by POSITION:
// high, low, close. `stoch(close, high, low, 14)`, another vendor's order written from habit,
// computed a different number on every bar and read "the 14-bar stochastic %K of close, high and
// low": a natural sentence, shown to the member as what they had asked for.
//
// Held here, on cases shared with the server's writer (`tests/fixtures/ast/sentence_roles.json`,
// read by `tests/test_sentence_roles.py` too, so the two lanes cannot part):
//   * arguments that ARE the bar's fields in the table's order read exactly as they always did;
//   * anything else names each argument by the place it fills, so a slip reads wrong.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFormula, TABLE } from './parse'
import { sentenceFor, barFieldLead } from './sentence'

const here = path.dirname(fileURLToPath(import.meta.url))
const DOC = JSON.parse(fs.readFileSync(path.resolve(here, '../../../../../../tests/fixtures/ast/sentence_roles.json'), 'utf8'))

describe('a function that takes the bar\'s fields by position', () => {
  it.each(DOC.cases.map((c) => [c.formula, c]))('%s', (_f, c) => {
    expect(sentenceFor(c.tree)).toBe(c.sentence)                       // the same words as the server's writer
    const parsed = parseFormula(c.formula)
    if (parsed.ok) expect(sentenceFor(parsed.ast)).toBe(c.sentence)    // and for the formula as a member types it
    if (c.kind === 'unchanged') expect(c.sentence).not.toMatch(/ from /)
    else expect(c.sentence).toMatch(/(highs|lows|closes) from /)
  })

  it('⛔ the order that computes another number no longer reads like the request', () => {
    const right = sentenceFor(parseFormula('stoch(high, low, close, 14)').ast)
    const wrong = sentenceFor(parseFormula('stoch(close, high, low, 14)').ast)
    expect(right).toBe('the 14-bar stochastic %K of high, low and close')
    expect(wrong).toBe('the 14-bar stochastic %K of highs from close, lows from high and closes from low')
    expect(wrong).not.toBe(DOC.before['stoch(close, high, low, 14)'])   // what it read before
    // CONTROL: the two were one comma-list apart before; now only the wrong one names roles
    expect(right).not.toMatch(/ from /)
  })

  it('covers every function of the table whose first arguments are bar fields, and no other', () => {
    const fields = new Set(['open', 'high', 'low', 'close', 'volume'])
    const covered = Object.entries(TABLE.functions).filter(([, spec]) => {
      const roles = spec.argRoles || []
      return roles.length >= 2 && fields.has(roles[0]) && fields.has(roles[1])
    }).map(([name]) => name)
    expect(covered).toEqual(expect.arrayContaining(['stoch', 'atr', 'adx', 'cci', 'mfi', 'plusDI', 'minusDI', 'williamsR', 'donchianUpper']))
    // ONE bar field has no order to get wrong: a rule needs two or more, each once
    const series = { high: {}, low: {}, close: {}, open: {}, volume: {} }
    expect(barFieldLead({ argRoles: ['high', 'period'] }, { series })).toBeNull()
    expect(barFieldLead({ argRoles: ['high', 'high', 'period'] }, { series })).toBeNull()
    expect(barFieldLead({ argRoles: ['source', 'period'] }, { series })).toBeNull()
    expect(barFieldLead({ argRoles: ['high', 'low', 'close', 'period'] }, { series })).toEqual(['high', 'low', 'close'])
    // a function with one series is never touched, whatever that series is
    expect(sentenceFor(parseFormula('ema(high, 20)').ast)).not.toMatch(/ from /)
    expect(sentenceFor(parseFormula('rsi(volume, 14)').ast)).not.toMatch(/ from /)
  })
})
