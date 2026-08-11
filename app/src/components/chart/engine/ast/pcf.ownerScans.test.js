// ⭐⭐ THE FIRM'S REAL TC2000 SCANS — the ones a member actually pastes.
//
// Three columns copied verbatim from their TC2000 Edit Column dialogs, plus the
// unit contract that makes two of them mean what the owner meant. Companion to
// `pcf.slingshot.test.js`; the reasoning about why real scans belong in the gates
// lives in that file's header and is not repeated.
//
// ⛔ THE UNIT IS THE LOAD-BEARING PART OF THIS FILE. TC2000 states capitalisation
// in MILLIONS — a $250M company reads `250` — and this table's `market_cap` is
// float USD. A name-only mapping would read `Capitalization > 250` as "bigger
// than two hundred and fifty dollars", pass the entire universe, and report a
// market-cap floor that is not there. Nothing refuses and nothing looks wrong, so
// the only thing that can catch it is a test that puts a KNOWN company through
// BOTH sides of a threshold.

import { describe, it, expect } from 'vitest'
import { evaluateFormula, canSaveFormula } from '../../builder/FormulaField.jsx'
import { BUILDER_INPUT_SCOPE } from '../../builder/builderInputs.js'
import { interpret } from './interpret.js'
import { detectDialect } from './pcf.js'

const read = (src) => evaluateFormula(src, BUILDER_INPUT_SCOPE)

// ── the three columns ────────────────────────────────────────────────────────

/** "Recent reclaim of the 200SMA". ⚠️ Row 1 carries the dialog's
 *  `True: x bars ago = 5`, which is NOT in the formula text — so the reclaim is
 *  written here with the offsets that setting means. See the contradiction case
 *  below for what happens to a member who pastes the text alone. */
const RECLAIM = 'C5<avgc200.5 and c>avgc200 and minv3.1>600000'

/** "Anticipation" — two alternative thrust tests, ORed, then the filters. */
const ANTICIPATION = '((c/c5>=1.13 and c>3) or (c/c5>1.06 and c>50))'
  + ' and minv3.1>600000 and c>avgc50 and Capitalization > 250'

/** "26 wk HV" — today's volume is the highest in 130 sessions, on an up day. */
const HV26 = 'v>=maxv130 and v>250000 and c/c1>0 and Capitalization > 200 and c>c1'

describe('the firm`s real TC2000 columns read, and save', () => {
  for (const [name, src] of Object.entries({ RECLAIM, ANTICIPATION, HV26 })) {
    it(`${name} reads as TC2000 and saves`, () => {
      const ev = read(src)
      expect(ev.ok, ev.error || '').toBe(true)
      expect(ev.dialect).toBe('pcf')
      expect(canSaveFormula(ev, false)).toBe(true)
      expect(ev.verdict.mode).toBe('non-repainting')
    })
  }

  it('each one`s distinctive idea survives into the read-back', () => {
    expect(read(RECLAIM).readback, 'the 200-bar average, offset five bars')
      .toMatch(/200-bar average of close\) 5 bars ago/)
    expect(read(ANTICIPATION).readback, 'the OR of two thrust tests')
      .toContain('close 5 bars ago')
    expect(read(HV26).readback, 'highest volume over 130 bars')
      .toContain('the highest volume of the last 130 bars')
  })
})

// ── the unit contract ────────────────────────────────────────────────────────

describe('🔴 Capitalization is in MILLIONS, and that is proven by behaviour', () => {
  /** A $300M company. The only fact the cases below turn on. */
  const THREE_HUNDRED_MILLION = { market_cap: 300e6 }
  const BARS = Array.from({ length: 5 }, () => ({ o: 10, h: 11, l: 9, c: 10, v: 1e6 }))
  // ⚠️ SCALARS ARE THE FIFTH ARGUMENT. Passing them as the third puts them in the
  // INPUTS slot, where `interpret` correctly refuses a name that shadows a table
  // name — a good error, and one that would otherwise read as "the mapping is
  // broken" rather than "the harness called it wrong".
  const fires = (src, scalars) => {
    const ev = read(src)
    expect(ev.ok, ev.error || '').toBe(true)
    return [...interpret(ev.ast, BARS, undefined, undefined, scalars)].at(-1) === 1
  }

  it('a $300M company PASSES a 250 floor', () => {
    expect(fires('Capitalization > 250', THREE_HUNDRED_MILLION)).toBe(true)
  })

  it('⛔ …and FAILS a 400 floor — the case a raw-dollars bug cannot fail', () => {
    // ⭐ THIS IS THE WHOLE FILE. Without the divide, the comparison is
    // `300000000 > 400`, which is TRUE — so a broken build passes the test above
    // and only this one goes red. A single-sided threshold test would have
    // shipped the bug.
    expect(fires('Capitalization > 400', THREE_HUNDRED_MILLION)).toBe(false)
  })

  it('the read-back SAYS the conversion out loud', () => {
    // A member has to be able to confirm we read their threshold as they meant
    // it; a silent unit change is how the wrong scan looks right.
    expect(read('Capitalization > 250').readback).toContain('divided by 1000000')
  })

  it('`MarketCap` is the same value under TC2000`s other spelling', () => {
    expect(read('MarketCap > 250').readback).toBe(read('Capitalization > 250').readback)
  })

  it('⛔ a fundamental takes NO bar offset', () => {
    // `Capitalization.1` has no bar to be offset from, and answering it with
    // today's value would fabricate a history this data does not have.
    const ev = read('c>avgc50 and Capitalization.1 > 200')
    expect(ev.ok).toBe(false)
    expect(ev.guard).toBe('pcf:offset')
    expect(ev.error).toMatch(/fundamental/)
  })

  it('⛔ the fundamentals are DIALECT MARKERS, or they reach the wrong reader', () => {
    // `Capitalization > 250` has no price letter and no fused indicator. Without
    // a marker it detects as native and refuses for a reason that has nothing to
    // do with the member's formula — the `BOP` failure, exactly.
    expect(detectDialect('Capitalization > 250')).toBe('pcf')
    expect(detectDialect('MarketCap > 250')).toBe('pcf')
    // ⛔ AND THE CONTROL: an ordinary native formula is still native.
    expect(detectDialect('close > sma(close, 50)')).toBe('native')
  })
})

// ── the trap that costs a member a whole scan ────────────────────────────────

describe('🔴 the TC2000 dialog carries meaning the formula TEXT does not', () => {
  it('pasting the reclaim`s text WITHOUT its `x bars ago` can never be true', () => {
    // The dialog says row 1 is true `5 bars ago`. Copy just the text and you get
    // `below the 200 AND above the 200` on the SAME bar. It parses, it lints, it
    // saves, it scans — and it matches nothing, which reads as a quiet market.
    const ev = read('C<avgc200 and c>avgc200')
    expect(ev.ok, 'it parses cleanly, which is the whole problem').toBe(true)

    const bars = []
    for (let i = 0; i < 250; i++) { const p = 100 - i * 0.2; bars.push({ o: p, h: p + 0.3, l: p - 0.3, c: p, v: 8e5 }) }
    let p = bars.at(-1).c
    for (let i = 0; i < 10; i++) { p *= 1.05; bars.push({ o: p * 0.99, h: p * 1.01, l: p * 0.98, c: p, v: 9e5 }) }

    expect([...interpret(ev.ast, bars, {})].filter((x) => x === 1).length).toBe(0)

    // ⭐ AND THE CORRECT WRITING OF THE SAME INTENT DOES FIRE, on the same bars.
    // That pairing is what makes this a documented trap rather than a mystery.
    const good = read(RECLAIM)
    expect([...interpret(good.ast, bars, {})].filter((x) => x === 1).length).toBeGreaterThan(0)
  })
})
