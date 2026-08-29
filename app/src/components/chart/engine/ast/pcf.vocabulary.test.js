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
import { parsePcf, detectDialect, pcfCoverage, PCF_DIFFERENT_FORMULA, PCF_DIALOG_INDICATORS } from './pcf.js'
import { astHash } from './parse.js'
import TABLE from './closedTable.json'
import { maxLookback } from './interpret.js'
import { evaluateFormula } from '../../builder/FormulaField.jsx'
import { BUILDER_INPUT_SCOPE } from '../../builder/builderInputs.js'

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
  logical: 7, crossing: 2,
  // 5 -> 6 (2026-08-29): `HAVGC20` reads now that `hma` is declared. The
  // seventh, `FAVG`, stays refused — Worden publishes no weighting for the
  // front-weighted average, and inventing one would be a wrong formula
  // wearing a vendor's name. This census is a MEASUREMENT of the vocabulary
  // this reader can say, so it moves when the reader really moves.
  'moving averages': 6, aggregates: 7, oscillators: 10,
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
    // table gained, and `BOP` EXPANDED rather than mapped.
    // ⚰️ THAT LAST CLAUSE ENDED "-- there is no `bop` function to point at, and
    // inventing one to hold four lines of arithmetic would put a second authority
    // on a formula the table can already say." W2a.7 declared `bop` and repointed
    // this spelling at it. The reasoning was right about the DANGER and wrong about
    // which artifact removes it: an expansion HERE plus an entry THERE is what puts
    // the formula in two places. One does, and the entry is bound to the shipped
    // rolling mean so it cannot drift from the `sma` it is defined as.
    //
    // ⭐ 40 → 57 IS THIRTEEN SPELLINGS AND *NO* NEW JUDGEMENT. `^ MOD \`, the five
    // math functions and the five trig functions are deterministic mathematics —
    // there is no formula to get subtly wrong, which is exactly why they were the
    // right block to take first. The four logical operators are DERIVED from `&&`
    // `||` `!`, so they added no vocabulary either.
    //
    // ⛔ WHAT REMAINS IS NOT ALL "MISSING", AND THE CEILING IS 65 — MEASURED.
    // SIX spellings are principled refusals that must never close, and W2a.7
    // measured them one at a time rather than trusting the roster:
    //   `RSI14` + `RSI(14, 1, 0)` — Worden says outright its RSI is NOT Wilder's
    //   `WSTOC14.3.0` — a RANK, `(100/n-1)(Rank)`; this table declares no rank
    //   `MS20` / `TSV20`   — Worden-proprietary, formula unpublished
    //   `OBV20`            — an SMA of a CUMULATIVE running total
    // ⚰️ THE OLD LIST NAMED FOUR OF THOSE AND SAID SIX. `OBV20` was the one it
    // missed, which matters because A5 was written as "66/71 read; MS/TSV/non-Wilder
    // RSI refuse" — five names — and a sixth permanent refusal makes 66 unreachable
    // by construction. The reachable ceiling is 71 - 6 = 65, and the two still open
    // are `FAVGC20` and `HAVGC20`: two moving averages this table does not declare.
    // A reading of 71 would mean this table had started answering the six with
    // something they are not — worse than refusing, and the whole reason the total
    // is pinned in both directions.
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
    // ⭐ 61: `STOC14.3`, and it cost NO new vocabulary either — the smoothing is a
    // moving average OVER the stochastic, which this table already spells, so the
    // tree is hash-identical to `sma(stoch(c,h,l,14), 3)`. It was the last spelling
    // refused in a 16-column sweep of real TC2000 scans. ⛔ `WSTOC` stays refused
    // beside it on purpose: Worden's own stochastic is a DIFFERENT formula, and
    // the two sitting one line apart is the distinction this file exists to keep.
    // ⭐ 63: `AROONUP25` + `AROONDOWN25` (W2a.7). The syntax is Worden's and the
    // FORMULA IS CHANDE'S — the Worden table publishes the spelling with NO formula,
    // so the maths is cited to `((25 - Days Since 25-day High)/25) x 100` and built
    // on task 5's `highestbars`/`lowestbars`, whose most-recent-bar tie-break IS
    // "days since". `BOP20` did not move the number: it already read as an
    // expansion and now reads as a declared entry.
    // ⭐ 64: `HAVG` (2026-08-29). It cost NO new vocabulary either — `hma` was
    // declared in the manifest that morning for Pine and thinkorswim, and TC2000's
    // Hull average IS the same published formula (Alan Hull's), so this reader
    // gained a SPELLING rather than a maths. That is the third time this table has
    // moved without inventing anything: `STOC14.3`, `AROONUP25`, and now this.
    // ⛔ `FAVG` STAYS REFUSED ONE LINE AWAY, and the pairing is the point — same
    // family, same shape, and Worden publishes no weighting for the front-weighted
    // average. A row for it would be a formula we made up wearing a vendor's name,
    // which is exactly the `MIN`/`lowest` trap this file exists to keep out.
    expect(expected).toBe(64)
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
    // 2026-08-27: the reason was upgraded from the un-actionable "is a different
    // formula" (true of any two formulas) to the CITED one. The phrase asserted
    // here moved with it deliberately -- a look-alike rail that kept matching the
    // old words would have gone green against a reason nobody could act on.
    'WSTOC14.3.0 < 20': 'RANK',
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

// ─── TC2000'S SMOOTHED STOCHASTIC ───────────────────────────────────────────
//
// `STOC<period>.<smoothing>` is the one spelling in a 16-column sweep of real
// TC2000 scans that this reader turned away. Worden's published scans use it
// constantly, and the smoothing is not an argument to the stochastic — it is a
// moving average OVER it, which this table already spells.
describe('`STOC14.3` — the smoothing is a wrapper, not an argument', () => {
  // ⛔ BOTH SIDES GO THROUGH THE DIALECT-DETECTING FRONT DOOR. Half of these
  // comparisons are NATIVE spellings, and `parsePcf` is the TC2000 reader — using
  // it for both would have compared a tree against a parse failure.
  const tree = (src) => {
    const ev = evaluateFormula(src, BUILDER_INPUT_SCOPE)
    expect(ev.ok, ev.error || src).toBe(true)
    return ev.ast
  }

  it('⭐ IS THE TABLE`S OWN SPELLING, proved by tree identity', () => {
    // ⛔ The whole basis for admitting this. If the expansion were a judgement
    // about what Worden meant rather than an exact identity, it would belong in
    // PCF_DIFFERENT_FORMULA refusing by name. Hash equality is what makes it a
    // translation instead of an interpretation — and it compares TREES, so
    // whitespace and spelling differences cannot make it pass for free.
    expect(astHash(tree('STOC14.3 < 30')))
      .toBe(astHash(tree('sma(stoch(close, high, low, 14), 3) < 30')))
  })

  it('a smoothing of 1 adds NOTHING — the old trees are unchanged', () => {
    // ⛔ The compatibility half. Every `STOC14.1` already saved by a member must
    // keep hashing to what it hashed before, or their stored scans silently
    // become different formulas on deploy.
    const raw = astHash(tree('stoch(close, high, low, 14) < 30'))
    expect(astHash(tree('STOC14.1 < 30'))).toBe(raw)
    expect(astHash(tree('STOC14 < 30'))).toBe(raw)
  })

  it('🔴 the smoothing is COUNTED in the warm-up, not lost', () => {
    // ⚠️ Under-stating a lookback is the only direction that corrupts: it
    // becomes `bars_wanted` for a live alert, so a window read as 14 when it
    // needs 17 answers from data that was never fetched. The tree-sum walker
    // gives 14+3; one bar over is deliberate and safe.
    expect(maxLookback(tree('STOC14.1 < 30'))).toBe(14)
    expect(maxLookback(tree('STOC14.3 < 30'))).toBe(17)
  })

  it('an offset wraps the SMOOTHED value, not the raw one', () => {
    // `STOC14.3.1` is the smoothed stochastic as it stood a bar ago. Smoothing a
    // shifted series instead is a different number, and it would be silent.
    expect(astHash(tree('STOC14.3.1 < 30')))
      .toBe(astHash(tree('sma(stoch(close, high, low, 14), 3)[1] < 30')))
    expect(maxLookback(tree('STOC14.3.1 < 30'))).toBe(18)
  })

  it('a smoothing that is not a whole number ≥ 1 still refuses', () => {
    for (const src of ['STOC14.0 < 30', 'STOC14.-2 < 30']) {
      expect(parsePcf(src).ok, src).toBe(false)
    }
  })
})

// ─── THE COVERAGE MAP MUST AGREE WITH THE READER ────────────────────────────
//
// `pcfCoverage` is what an engineer reads to decide what to build next, and it
// used to MODEL the reader's argument-filling rather than ask it. It therefore
// disagreed with the shipped reader in the worst direction: `BOP` was reported
// as "the table does not declare `undefined`" and `ADX` as a signature mismatch,
// while `BOP14 > 0` and `ADX14.14 > 25` both parsed fine. A map that understates
// support sends someone to build a thing that already works.
describe('the coverage map does not disagree with the reader', () => {
  it('🔴 nothing is reported blocked while its own spelling reads', () => {
    const cov = pcfCoverage()
    // ⛔ THE NAMES AND THEIR STATED REASONS, IN THE MESSAGE. A blocked family is
    // allowed to exist — it just must not be one the reader is quietly handling.
    const lying = cov.blocked.filter((b) => VOCABULARY.oscillators.some(
      (src) => reads(src) && src.toUpperCase().startsWith(b.spelling.split('<')[0])))
    expect(lying.map((b) => `${b.spelling}: ${b.reason}`)).toEqual([])
  })

  it('a MAPPED family is reported as covered, not as a missing function', () => {
    // 2026-08-27: `BOP` was the only `expand: true` family, and W2a.7 repointed it
    // at the declared `bop` entry -- so the EXPANDED list is now empty and the
    // question this case asks moved from "is the expansion reported?" to "is the
    // mapping reported?". The fact under test is unchanged: a family the reader
    // READS must never appear in `blocked`.
    const cov = pcfCoverage()
    expect(cov.blocked.map((b) => b.spelling).join(' | ')).not.toContain('BOP')
    expect(cov.blocked.map((b) => b.spelling).join(' | ')).not.toContain('AROONUP')
    // …and they are genuinely readable, which is the fact the report matches.
    expect(reads('BOP20 > 0')).toBe(true)
    expect(reads('AROONUP25 > 70')).toBe(true)
    // ⛔ AND THE EXPANSION MACHINERY IS NOW UNUSED, said out loud rather than
    // left as a silently-dead branch: if a future family needs it, it still
    // works; if none ever does, this is the line that says it can go.
    expect(cov.expanded).toEqual([])
  })

  it('…and the control proves a REAL block is still reported', () => {
    // ⛔ Without this, the two assertions above pass just as happily on a
    // `blocked` list that had been hard-wired to empty.
    const without = JSON.parse(JSON.stringify(TABLE))
    delete without.functions.stoch
    const cov = pcfCoverage(without)
    expect(cov.blocked.map((b) => b.spelling).join(' | ')).toContain('STOC')
    expect(reads('STOC14.3 < 20')).toBe(true)
  })
})
