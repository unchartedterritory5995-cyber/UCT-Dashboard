// ─── `ta.percentile_linear_interpolation` WAS ABSENT FROM THE ENGINE GRAMMAR
// ENTIRELY — NEITHER `closedTable.json` NOR `PINE_CALL_SHAPES` DECLARED IT, SO
// ANY SCRIPT CALLING IT REFUSED `pine:function` REGARDLESS OF WHAT ELSE IT DID ─
//
// TradingView's own page: "Calculates percentile using method of linear
// interpolation between the two nearest ranks" — `ta.percentile_linear_
// interpolation(source, length, percentage) -> series float`. Measured against
// the real 266-script committed corpus, 2026-09-20: two scripts name it
// (`volatility-coil-edge-bullbyte__604f0fd1c6.pine`,
// `artemis-oscillator-pro__ea1097ca9e.pine`).
//
// ⚰️ `artemis-oscillator-pro` is NOT used as a control anywhere below: it
// already translated `ok:true` BEFORE this fix existed at all (measured by
// stashing the four implementation files and re-probing) — its
// `obPct`/`osPct` declarations are never on the path the walker needs, so
// this script proves nothing about percentile either way.
//
// ⭐ `volatility-coil-edge-bullbyte` IS a real, measured before/after: WITHOUT
// this fix it refused `pine:function` at line 371, naming
// `ta.percentile_linear_interpolation` itself (measured the same way, by
// stashing the implementation files); WITH it, line 371 now translates and
// the walker proceeds to a LATER, wholly unrelated `pine:state` blocker
// (`compHigh`, a `var` seeded `na` that nothing in the script ever updates —
// its refusal message cites the `var` declaration at line 362 for context,
// even though the walker only needs to resolve it once it is READ, after
// line 371). This is the same shape `math.floor`'s renko script showed
// twice over: fixing one real blocker on a heavily-layered script reveals
// the next one, and the honest report is "percentile itself now clears; a
// separate, later blocker is what still refuses this script" — not a full
// host-lane accept, and not a claim that percentile was never the problem.
//
// The direct `FN.percentileLinearInterpolation` value checks in this file are
// the positive proof that percentile itself computes correctly, mirroring
// `pineMathFloorAccept.test.js`'s split between "does it translate/compute"
// and "is the real corpus fully unblocked."
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine'
import { FN } from './interpret.js'

const CORPUS = path.resolve(__dirname, '../../../../../../corpus/committed')

const S = (body) => `//@version=6\nindicator("t")\nplot(${body})\n`

describe('⭐ ta.percentile_linear_interpolation is a declared, window, cross-lane-guarded function', () => {
  it('a plain ta.percentile_linear_interpolation(series, length, percentage) call clears the host lane', () => {
    const t = translatePine(S('ta.percentile_linear_interpolation(close, 20, 75)'), { strict: true })
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
    expect(t.mode).toBe('host')
    expect(t.refusal).toBe(null)
  })

  it('routes onto the camelCase manifest entry, three arguments straight through', () => {
    const t = translatePine(S('ta.percentile_linear_interpolation(close, 20, 75)'), { strict: true })
    expect(t.outputs[t.selected].formula).toBe('percentileLinearInterpolation(close, 20, 75)')
  })

  // ⭐⭐ AT percentage=50 THIS IS ta.median, BY CONSTRUCTION — `interpret.js`'s
  // doc comment above `windowPercentileLinear` proves it algebraically (the
  // interpolation fraction lands exactly on the mean of the two middle ranks
  // for an even window); this MEASURES that identity, across both parities,
  // rather than trusting the proof alone.
  it('⭐⭐ at percentage=50 it EXACTLY matches ta.median, across even and odd windows', () => {
    const series = [12, 15, 11, 19, 22, 18, 25, 31, 27, 33, 29, 41, 38, 44, 40, 52, 9, 61, 3, 47]
    for (const n of [4, 5, 6, 7]) {
      const pct = FN.percentileLinearInterpolation(series, n, 50)
      const med = FN.median(series, n)
      for (let i = n - 1; i < series.length; i++) {
        expect(pct[i], `n=${n} i=${i}`).toBeCloseTo(med[i], 9)
      }
    }
  })

  it('⭐ percentage=0 is the MINIMUM of the window and percentage=100 is the MAXIMUM — hand-computable', () => {
    const series = [7, 2, 9, 4, 5, 1, 8, 3, 6]
    const n = 5
    const lo = FN.percentileLinearInterpolation(series, n, 0)
    const hi = FN.percentileLinearInterpolation(series, n, 100)
    for (let i = n - 1; i < series.length; i++) {
      const window = series.slice(i - n + 1, i + 1)
      expect(lo[i], `min at i=${i}`).toBe(Math.min(...window))
      expect(hi[i], `max at i=${i}`).toBe(Math.max(...window))
    }
  })

  it('⭐ linear interpolation lands BETWEEN two ranks — a hand-computable case where the answer is not one of the inputs', () => {
    // window sorts to [1,2,3,4,5]; pos = (5-1)*60/100 = 2.4 -> between sorted
    // rank 2 (value 3) and rank 3 (value 4): 3 + 0.4*(4-3) = 3.4, which is not
    // one of the five source values.
    const series = [5, 3, 1, 4, 2]
    const out = FN.percentileLinearInterpolation(series, 5, 60)
    expect(out[4]).toBeCloseTo(3.4, 9)
  })

  it('⛔ na PROPAGATES — one na in the window blanks the whole answer, unlike sma/stdev/median beside it which SKIP', () => {
    const series = [10, 20, NaN, 40, 50, 60, 70]
    const out = FN.percentileLinearInterpolation(series, 3, 50)
    // every window touching index 2 is contaminated: [10,20,na] at i=2,
    // [20,na,40] at i=3, [na,40,50] at i=4.
    expect(out[2]).toBeNaN()
    expect(out[3]).toBeNaN()
    expect(out[4]).toBeNaN()
    // the window is clean again from i=5 onward: [40,50,60] -> median 50.
    expect(out[5]).toBeCloseTo(50, 9)
    expect(out[6]).toBeCloseTo(60, 9)
  })

  // ⚠️ UNLIKE `ta.correlation`, WHICH DIVIDES BY A STDEV AND SO REFUSES BELOW
  // length 2, a percentile has no such floor — a one- or zero-element window
  // is a degenerate but well-defined answer (`vals[0]`), so 0 and 1 are
  // ACCEPTED here. Verified rather than assumed: a first draft of this test
  // borrowed correlation's "length < 2 refuses" rule and it was simply wrong
  // for this function — probed directly before writing the assertion below.
  it('⛔ a negative or non-literal length refuses; zero and one do not, because a percentile has no divide-by-window-size floor', () => {
    for (const okLen of ['0', '1', '2']) {
      const out = translatePine(S(`ta.percentile_linear_interpolation(close, ${okLen}, 50)`), { strict: true })
      expect(out.ok, `length ${okLen}: ${JSON.stringify(out.refusal)}`).toBe(true)
    }
    const negative = translatePine(S('ta.percentile_linear_interpolation(close, -1, 50)'), { strict: true })
    expect(negative.refusal).toBeTruthy()
    expect(negative.refusal.message).toMatch(/plain whole number/)
    const nonLiteral = translatePine(
      S('ta.percentile_linear_interpolation(close, close > open ? 10 : 20, 50)'), { strict: true })
    expect(nonLiteral.refusal).toBeTruthy()
  })

  // ⛔ NOT A FULL host-lane ACCEPT — recorded honestly rather than overclaimed,
  // per this file's header. `volatility-coil-edge-bullbyte` calls
  // `ta.percentile_linear_interpolation(high - low, 50, 50)` at line 371, and
  // that line NOW TRANSLATES — measured by stashing the implementation files
  // and confirming the pre-fix refusal was `pine:function` naming this exact
  // call at this exact line. The walker then proceeds to `compHigh` (a `var`
  // seeded `na` nothing in the script ever updates), a SEPARATE, later
  // blocker whose refusal message cites the `var` declaration at line 362 for
  // context. This corpus script still does not move the real host_ok count —
  // what moved is that percentile is no longer the reason ANY script would
  // refuse.
  it('the real corpus script no longer refuses on percentile (a separate, later blocker now surfaces)', () => {
    const src = fs.readFileSync(
      path.join(CORPUS, 'volatility-coil-edge-bullbyte__604f0fd1c6.pine'), 'utf8')
    const t = translatePine(src, { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).not.toBe('pine:function')
    expect(t.refusal.message).not.toMatch(/percentile/i)
    expect(t.refusal.guard).toBe('pine:state')
    expect(t.refusal.message).toMatch(/compHigh/)
  })
})
