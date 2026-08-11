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
import { parsePcf, detectDialect, PCF_DIFFERENT_FORMULA, PCF_DIALOG_INDICATORS } from './pcf.js'

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
  'price letters': 6, 'math operators': 5, 'math functions': 8, relational: 4,
  logical: 7, crossing: 2, 'moving averages': 5, aggregates: 7, oscillators: 7,
  conditional: 1, stateful: 3, 'trig and hyperbolic': 5,
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
    // ⚰️ 35 at the first measurement, 37 with three oscillator spellings, 40 once
    // `CountTrue`/`SinceTrue`/`TrueInRow` were built on the recurrence, 44 with the
    // four derived logical operators, and 57 with the pure-math block, then 59: `SUM` wired to the rolling sum the
    // table gained, and `BOP` EXPANDED rather than mapped -- there is no `bop`
    // function to point at, and inventing one to hold four lines of arithmetic
    // would put a second authority on a formula the table can already say.
    //
    // ⭐ 40 → 57 IS THIRTEEN SPELLINGS AND *NO* NEW JUDGEMENT. `^ MOD \`, the five
    // math functions and the five trig functions are deterministic mathematics —
    // there is no formula to get subtly wrong, which is exactly why they were the
    // right block to take first. The four logical operators are DERIVED from `&&`
    // `||` `!`, so they added no vocabulary either.
    //
    // ⛔ WHAT REMAINS IS NOT ALL "MISSING". Of the 14 short, SIX are principled
    // refusals that must never close: `RSI`/`WSTOC` are different formulas wearing
    // familiar names, and `MS`/`TSV` are Worden-proprietary and unpublished. A
    // reading of 71 would mean this table had started answering those with
    // something they are not — which is worse than refusing, and is the whole
    // reason the total is pinned in both directions.
    //
    // ⚠️ Raising it is a deliberate edit, never a side effect — see the header on
    // why a high score is not the goal.
    // ⭐ 60: `ADX14.14`. The blocker was never the maths — both lanes already
    // shipped a bar-aligned ADX and `plusDI`/`minusDI` were declared off it. It
    // was the `lookback` GRAMMAR: ADX's window is 2 x period and the table could
    // only say "one of my arguments", so declaring it would have UNDER-stated the
    // warm-up. `2*arg3` closed that, mirrored in both lanes.
    // ⛔ AND THE DOTTED NUMBER IS SMOOTHING, NOT AN OFFSET — `ADX14.20` REFUSES
    // rather than quietly returning a 14/14 ADX.
    expect(expected).toBe(60)
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

// ─── THE DIALOG INDICATORS ROUTE TO THE READER THAT KNOWS THEM ───────────────
//
// A TC2000 dialog indicator arrives as multi-word English, so it has to be named
// BEFORE tokenizing or the member gets "a formula is one expression, and this is
// several" about a row they picked from a list. Two things must agree for that to
// work: the phrase is in `PCF_DIALOG_INDICATORS`, and `detectDialect` routes it to
// the TC2000 reader. They were two hand-written copies of one fact until 2026-08-11.
describe('a TC2000 dialog indicator is named, never tokenized', () => {
  it('every entry is reachable by its own name', () => {
    // Establishes that the probe below is legitimate: these tests drive each
    // indicator using its `name`, which is only meaningful if the entry's own
    // pattern matches it. An entry that failed here would make every later
    // assertion pass against a string the reader never sees.
    for (const d of PCF_DIALOG_INDICATORS) expect(d.re.test(d.name), d.name).toBe(true)
  })

  it('⭐ every entry routes to the TC2000 reader — DERIVED, never re-typed', () => {
    // ⛔ This loop is the whole reason the marker list stopped restating these
    // patterns. Add a fourth indicator and it is covered the moment it lands.
    for (const d of PCF_DIALOG_INDICATORS) {
      expect(detectDialect(`${d.name} > 10`), d.name).toBe('pcf')
    }
  })

  it('…and a native formula still reads as native, so that probe can tell them apart', () => {
    // Without this the loop above would pass just as happily if `detectDialect`
    // answered 'pcf' to everything.
    expect(detectDialect('close > sma(close, 20)')).toBe('native')
  })

  it('each one refuses BY NAME and says what to write instead', () => {
    for (const d of PCF_DIALOG_INDICATORS) {
      const ev = parsePcf(`${d.name} > 10`)
      expect(ev.ok, d.name).toBe(false)
      expect(ev.guard, d.name).toBe('pcf:name')
      expect(ev.token, d.name).toBe(d.name)
      expect(ev.error, d.name).toContain(d.why)
    }
  })

  it('🔴 the dollar-volume refusal states the CONVERTED number, not just the formula', () => {
    // ⛔ THE UNIT IS THE DEFECT HERE, and it is the quiet kind: TC2000 quotes
    // dollar volume in THOUSANDS, so a row copied across unchanged reads
    // `> 10000` — ten thousand dollars — and admits the entire tape. The scan
    // returns a full list and looks like it worked. Naming the formula without
    // naming the conversion would leave that trap fully armed.
    const ev = parsePcf('Volume (Dollars) 20-Day > 10000')
    expect(ev.ok).toBe(false)
    expect(ev.error).toContain('AVG(C * V, 20)')
    expect(ev.error).toContain('10000000')
  })
})
