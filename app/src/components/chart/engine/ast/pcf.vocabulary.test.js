// ⭐⭐ THE YARDSTICK. TC2000's coverage was unmeasurable until this file existed,
// and that was the real defect — not the missing spellings.
//
// The corpus is **Worden's own Personal Criteria Formula syntax table**
// (help.tc2000.com/m/69445/l/745531), not expressions this repo invented. That
// distinction is the whole point: an 8-case corpus we wrote ourselves reported
// "0 blocked" and told us nothing, because we could only fail at things we had
// already thought of.
//
// ⛔ THE TOTAL IS PINNED IN BOTH DIRECTIONS. A change that lowers it is a
// regression; a change that RAISES it must move the number here deliberately, so
// coverage cannot drift upward on an accident either.
//
// ⚠️ AND A HIGH SCORE IS NOT THE GOAL. Twenty-three trigonometric functions sit in
// this vocabulary and no published TC2000 screen in evidence uses one; declaring
// them would move this number and buy nothing. Read `EXPECTED` as a map of where
// the reader stands, never as a target to maximise.

import { describe, it, expect } from 'vitest'
import { parsePcf, PCF_DIFFERENT_FORMULA } from './pcf.js'

/** Worden's vocabulary, one representative expression per spelling. */
const VOCABULARY = {
  'price letters': ['C > O', 'H > L', 'V > 1000000', 'C1 > C2', 'C(1) > C(2)', 'O1 < C1'],
  'math operators': ['C * 2 > O', 'C / O > 1.02', 'C ^ 2 > 100', 'C MOD 2 = 0', 'C \\ 2 > 10'],
  'math functions': ['ABS(C - O) > 1', 'SQR(C) > 5', 'LOG(C) > 2', 'CLG(C) > 1', 'EXP(C) > 1',
    'SGN(C - O) = 1', 'GREATEST(C, O) > 50', 'LEAST(C, O) < 50'],
  relational: ['C >= O', 'C <= O', 'C = O', 'C <> O'],
  logical: ['C > O AND V > 1000', 'C > O OR V > 1000', 'NOT(C > O)', 'C > O XOR V > 1000',
    'C > O NAND V > 1000', 'C > O NOR V > 1000', 'C > O XNOR V > 1000'],
  crossing: ['XUP(C, AVGC50, 1)', 'XDOWN(C, AVGC50, 1)'],
  'moving averages': ['AVGC50 > AVGC200', 'AVGC50.1 > AVGC50.2', 'AVG(C, 50) > AVG(C, 200)',
    'XAVGC12 > XAVGC26', 'XAVG(C, 12) > XAVG(C, 26)', 'FAVGC20 > C', 'HAVGC20 > C'],
  aggregates: ['C > MAXH252', 'C < MINL252', 'C > MAXH252.1', 'MAX(H, 20) > 100',
    'MIN(L, 20) < 10', 'SUM(V, 5) > 5000000', 'STDDEV20 > 1'],
  oscillators: ['RSI14 < 30', 'RSI(14, 1, 0) < 30', 'WRSI14 < 30', 'MACD12.26 > 0',
    'STOC14.3 < 20', 'WSTOC14.3.0 < 20', 'CCI20 > 100', 'ATR14 > 1', 'ADX14.14 > 25',
    'DIPLUS14 > DIMINUS14', 'AROONUP25 > 70', 'AROONDOWN25 < 30', 'BOP20 > 0', 'MS20 > 0',
    'OBV20 > 0', 'TSV20 > 0'],
  conditional: ['IIF(C > O, 1, 0) = 1'],
  stateful: ['CountTrue(C > O, 20) > 10', 'SinceTrue(C > O, 20) < 5', 'TrueInRow(C > O, 10) >= 3'],
  'trig and hyperbolic': ['SIN(C) > 0', 'COS(C) > 0', 'TAN(C) > 0', 'ARCTAN(C) > 0', 'SINH(C) > 0'],
}

/** Where the reader stands, per group. ⛔ A LIST PER GROUP, NOT ONE TOTAL: a total
 *  alone would let a gain in one group hide a loss in another, and this file's
 *  entire reason for existing is that a single reassuring number hid the truth
 *  once already. */
const EXPECTED = {
  'price letters': 6, 'math operators': 2, 'math functions': 3, relational: 4,
  logical: 3, crossing: 2, 'moving averages': 5, aggregates: 6, oscillators: 5,
  conditional: 1, stateful: 0, 'trig and hyperbolic': 0,
}

const reads = (src) => {
  try {
    const r = parsePcf(src)
    return !!(r && r.ok)
  } catch {
    return false
  }
}

describe('the TC2000 vocabulary, measured against Worden`s own syntax table', () => {
  it('the corpus IS the vocabulary — 71 expressions, and the groups match', () => {
    // ⛔ NON-VACUITY FIRST. Everything below is `0/0 === 0` on an empty corpus.
    const total = Object.values(VOCABULARY).reduce((n, v) => n + v.length, 0)
    expect(total).toBe(71)
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.keys(VOCABULARY).sort())
  })

  for (const [group, exprs] of Object.entries(VOCABULARY)) {
    it(`${group}: ${EXPECTED[group]}/${exprs.length}`, () => {
      const ok = exprs.filter(reads)
      const no = exprs.filter((e) => !reads(e))
      // ⛔ THE NAMES, BUILT INTO THE MESSAGE. Vitest abbreviates arrays, and a rail
      // whose job is to say WHICH spelling moved must not report through a differ.
      expect(ok.length,
        `${group} moved. reads: [${ok.join(' | ')}] — refuses: [${no.join(' | ')}]`)
        .toBe(EXPECTED[group])
    })
  }

  it('🔴 THE TOTAL, pinned in BOTH directions', () => {
    const reading = Object.values(VOCABULARY).flat().filter(reads).length
    const expected = Object.values(EXPECTED).reduce((a, b) => a + b, 0)
    expect(reading).toBe(expected)
    // The baseline this file was created at. ⚠️ Raising it is a deliberate edit,
    // never a side effect — see the header on why a high score is not the goal.
    expect(expected).toBe(37)
  })
})

describe('a look-alike refuses with WHY, not with a typo`s message', () => {
  // ⛔ THESE FOUR WOULD PARSE, LINT, SAVE AND SCAN IF POINTED AT THEIR NEAREST
  // NEIGHBOUR, AND WOULD BE WRONG — the `MIN`/`lowest` failure the translator's
  // header warns about, which no refusal surface can catch because nothing
  // refuses. So the reader must say the reason out loud.
  const CASES = {
    'RSI14 < 30': 'WRSI',
    'RSI(14, 1, 0) < 30': 'WRSI',
    'MS20 > 0': 'not published',
    'TSV20 > 0': 'not published',
    'WSTOC14.3.0 < 20': 'different formula',
  }

  for (const [src, fragment] of Object.entries(CASES)) {
    it(`${src} names its reason`, () => {
      const r = parsePcf(src)
      expect(r.ok).toBe(false)
      expect(r.error, `${src} refused without saying why`).toContain(fragment)
    })
  }

  it('…and an ordinary unknown name does NOT get a look-alike sentence', () => {
    // ⭐ THE CONTROL. Without it, the five above would pass for a reader that
    // appended the same explanation to every refusal.
    const r = parsePcf('ZZNOPE9 > 1')
    expect(r.ok).toBe(false)
    for (const reason of Object.values(PCF_DIFFERENT_FORMULA)) {
      expect(r.error).not.toContain(reason)
    }
  })

  it('every declared look-alike is REACHABLE, and every reachable one is declared', () => {
    // ⛔ BOTH DIRECTIONS. An entry nobody can trigger is a comment; a look-alike
    // that fires without a declaration is a sentence with no owner.
    for (const name of Object.keys(PCF_DIFFERENT_FORMULA)) {
      const r = parsePcf(`${name}14 > 0`)
      expect(r.ok, `${name} stopped being a look-alike — is it supported now?`).toBe(false)
      expect(r.error, `${name} is declared and never reached`)
        .toContain(PCF_DIFFERENT_FORMULA[name])
    }
  })
})
