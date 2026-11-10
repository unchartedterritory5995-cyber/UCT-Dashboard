// ⭐⭐ A TC2000 EDIT COLUMN, PASTED AS ITS ROWS — the owner's Anticipation scan.
//
// The dialog shows a column as ROWS: the first row bare, every later row opened
// by `and`/`or`, and a formula row closed by `Is True`. Until 2026-11-10 the
// reader refused four of this column's five rows: two for `Is True`, and two for
// `Price History`, which it misread as "a count of bars" when TC2000 uses it as
// the name of the PRICE data source. This file pins the column as the owner
// pasted it, and the one trap that makes rows more than whitespace.

import { describe, it, expect } from 'vitest'
import { evaluateFormula, canSaveFormula } from '../../builder/FormulaField.jsx'
import { BUILDER_INPUT_SCOPE } from '../../builder/builderInputs.js'
import { interpret } from './interpret.js'
import { astHash } from './parse.js'
import { detectDialect, readConditionRows } from './pcf.js'

const read = (src) => evaluateFormula(src, BUILDER_INPUT_SCOPE)

/** The column exactly as the Edit Column dialog shows it. */
const ANTICIPATION_ROWS = [
  'Price History > 3',
  'and (c/c5>=1.13 and c>3) or (c/c5>1.06 and c>50) Is True',
  'and MinV3.1>600000 Is True',
  'and Price History above Avg 50',
  'and Capitalization > 250',
].join('\n')

/** The same scan written out by hand, one row per parenthesised group. */
const ANTICIPATION_BY_HAND = '(C > 3)'
  + ' AND ((c/c5>=1.13 and c>3) or (c/c5>1.06 and c>50))'
  + ' AND (MinV3.1>600000) AND (C > AVGC50) AND (Capitalization > 250)'

describe('the Anticipation column, pasted row for row', () => {
  it('reads as TC2000, saves, and is non-repainting', () => {
    const ev = read(ANTICIPATION_ROWS)
    expect(ev.ok, ev.error || '').toBe(true)
    expect(ev.dialect).toBe('pcf')
    expect(canSaveFormula(ev, false)).toBe(true)
    expect(ev.verdict.mode).toBe('non-repainting')
  })

  it('is the SAME tree as the scan written out by hand', () => {
    expect(astHash(read(ANTICIPATION_ROWS).ast)).toBe(astHash(read(ANTICIPATION_BY_HAND).ast))
  })

  it('reads the same with the `Is True` endings left off', () => {
    const bare = ANTICIPATION_ROWS.replace(/ Is True/g, '')
    expect(astHash(read(bare).ast)).toBe(astHash(read(ANTICIPATION_ROWS).ast))
  })
})

describe('🔴 a row is ONE condition — the `or` inside a row never leaks out', () => {
  // 60 flat bars at $10 on 1M shares, then a five-bar run to $12: c/c5 = 1.2, so
  // the first thrust branch is true, price > 3, volume clears 600K and price is
  // above its 50-day average. ONLY the market-cap row decides the scan.
  const BARS = [
    ...Array.from({ length: 60 }, () => ({ o: 10, h: 10.2, l: 9.8, c: 10, v: 1e6 })),
    ...[10.4, 10.8, 11.2, 11.6, 12].map((c) => ({ o: c - 0.2, h: c + 0.1, l: c - 0.3, c, v: 1e6 })),
  ]
  const fires = (src, scalars) => {
    const ev = read(src)
    expect(ev.ok, ev.error || '').toBe(true)
    return [...interpret(ev.ast, BARS, undefined, undefined, scalars)].at(-1) === 1
  }
  const SMALL = { market_cap: 100e6 }   // fails the 250M row
  const LARGE = { market_cap: 300e6 }   // passes it

  it('a $100M stock is REFUSED by the cap row', () => {
    expect(fires(ANTICIPATION_ROWS, SMALL)).toBe(false)
  })

  it('⛔ …while the same text glued into one line WRONGLY passes it', () => {
    // ⭐ THIS IS THE TRAP THE ROW READER EXISTS FOR. Joined as plain text, `and`
    // binds tighter than `or`, so the line reads `(p and a) or (b and … and cap)`
    // and the cap filter only guards the second thrust branch. If this case ever
    // stops being TRUE, the fixture can no longer tell the two readings apart.
    const glued = ANTICIPATION_ROWS.replace(/ Is True/g, '').replace(/\n/g, ' ')
    expect(fires(glued, SMALL)).toBe(true)
  })

  it('THE CONTROL — a $300M stock passes, so the scan is not simply always false', () => {
    expect(fires(ANTICIPATION_ROWS, LARGE)).toBe(true)
  })
})

describe('`Price History` is the PRICE, as TC2000 uses it', () => {
  it('`Price History > 3` is a $3 price floor', () => {
    expect(astHash(read('Price History > 3').ast)).toBe(astHash(read('C > 3').ast))
  })

  it('`above Avg 50` is the simple 50-day average; `below` flips the side', () => {
    expect(astHash(read('Price History above Avg 50').ast)).toBe(astHash(read('C > AVGC50').ast))
    expect(astHash(read('Price History below Avg 200').ast)).toBe(astHash(read('C < AVGC200').ast))
  })

  it('`Exp Avg` is the exponential one, and it is NOT the simple one', () => {
    const exp = read('Price History above Exp Avg 21')
    expect(astHash(exp.ast)).toBe(astHash(read('C > XAVGC21').ast))
    expect(astHash(exp.ast)).not.toBe(astHash(read('C > AVGC21').ast))
  })

  it('⛔ a Price History phrase it does not know is refused at its own word, never guessed', () => {
    const ev = read('Price History crossed above Avg 50')
    expect(ev.ok).toBe(false)
    expect(ev.error).toMatch(/crossed/i)
  })
})

describe('row mode turns on only when the text IS rows', () => {
  it('`Is False` negates its row', () => {
    expect(astHash(read('MinV3.1>600000 Is False').ast))
      .toBe(astHash(read('NOT (MinV3.1>600000)').ast))
  })

  it('a failing row is named by its number and its own text', () => {
    const ev = read('Price History > 3\nand C >> 4 Is True')
    expect(ev.ok).toBe(false)
    expect(ev.error).toMatch(/^row 2 \(`and C >> 4 Is True`\)/)
  })

  it('⛔ mixed `and`/`or` rows are refused rather than grouped by a guess', () => {
    const ev = read('C > 3\nand V > 1000000\nor C > 50')
    expect(ev.ok).toBe(false)
    expect(ev.error).toMatch(/mix `and` and `or`/)
  })

  it('all-`or` rows join with OR', () => {
    expect(astHash(read('C > 50\nor V > 5000000').ast))
      .toBe(astHash(read('(C > 50) OR (V > 5000000)').ast))
  })

  it('⛔ THE CONTROL — a one-line formula, or one wrapped mid-expression, is not rows', () => {
    expect(readConditionRows('c > avgc50 and v > 1000000')).toBeNull()
    // A newline inside a hand-written formula is whitespace, as it is in TC2000.
    expect(readConditionRows('c > avgc50 and\nv > 1000000')).toBeNull()
    expect(read('c > avgc50 and\nv > 1000000').ok).toBe(true)
  })

  it('the dialog`s words route to the TC2000 reader; a native formula stays native', () => {
    expect(detectDialect('Price History > 3')).toBe('pcf')
    expect(detectDialect('MinV3.1>600000 Is True')).toBe('pcf')
    expect(detectDialect('close > sma(close, 50)')).toBe('native')
  })
})
