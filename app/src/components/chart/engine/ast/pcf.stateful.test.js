// TC2000's three stateful functions, EVALUATED — not just translated.
//
// ⛔ A TREE THAT BUILDS IS NOT A FUNCTION THAT WORKS. `CountTrue`, `SinceTrue` and
// `TrueInRow` read a boolean across bars, and every one of them can produce a
// plausible column while meaning something else: an off-by-one window, a streak
// that never resets, a sentinel washed away by arithmetic. So these run the tree
// through the shipped interpreter over hand-made bars whose answers can be counted
// by eye.
//
// 🔴 `test_sincetrue_answers_MINUS_ONE_when_it_never_happened` IS THE ONE THAT
// MATTERS. TC2000 returns -1 for "never", and -1 is not "zero bars ago". Seeding 0
// would make *never happened* read as *happened just now* — on every symbol where
// the setup is absent, which is most of them, silently, in the direction that
// admits them to the scan.

import { describe, it, expect } from 'vitest'
import { parsePcf } from './pcf.js'
import { interpret } from './interpret.js'

/** Bars whose up/down pattern is written out, so every expected number below can
 *  be counted off the string rather than trusted. */
function barsFrom(pattern) {
  // 'u' = close > open, 'd' = close < open
  let price = 100
  return [...pattern].map((ch) => {
    const open = price
    const close = ch === 'u' ? open + 1 : open - 1
    price = close
    return { o: open, h: Math.max(open, close) + 0.5, l: Math.min(open, close) - 0.5, c: close, v: 1000 }
  })
}

const evaluate = (src, bars) => {
  const r = parsePcf(src)
  expect(r.ok, `${src} did not translate: ${r.guard || r.error}`).toBe(true)
  return [...interpret(r.ast, bars, {})]
}

describe('CountTrue — occurrences in the window', () => {
  it('counts the up bars in the last N, and nothing outside them', () => {
    //           idx 0123456789
    const bars = barsFrom('uuuudddddd')
    const out = evaluate('CountTrue(C > O, 4)', bars)
    // At bar 9 the window covers bars 6..9 — all down — so zero.
    expect(out[9]).toBe(0)
    // At bar 4 the window covers 1..4: bars 1,2,3 are up, bar 4 is down ⇒ 3.
    expect(out[4]).toBe(3)
  })

  it('the warm-up prefix is NOT COMPUTABLE, never a partial count', () => {
    // ⛔ 0, 1, 2 … would be a "reasonable" prefix and it is exactly the defect: a
    // number smaller than the truth, indistinguishable from a real one.
    const out = evaluate('CountTrue(C > O, 5)', barsFrom('uuuuuuuu'))
    for (let i = 0; i < 5; i += 1) expect(out[i], `bar ${i}`).toBeNaN()
    expect(out[5]).toBe(5)
  })
})

describe('TrueInRow — the consecutive streak', () => {
  it('counts a run and RESETS on the first false bar', () => {
    // ⚠️ EVERY ASSERTION IS PAST THE WARM-UP, and getting that wrong is how this
    // test first failed: a 6-bar window answers NOTHING before bar 6, so an
    // expectation at bar 3 was asserting against a NaN prefix that is CORRECT.
    //                     0123456789012345678
    const out = evaluate('TrueInRow(C > O, 6)', barsFrom('uuuuuuuuuudduuuuuuu'))
    expect(out[5], 'inside the warm-up').toBeNaN()
    expect(out[11], 'bar 11 is down ⇒ the streak resets').toBe(0)
    expect(out[14], 'bars 12,13,14 up after the two down bars').toBe(3)
    // ⭐ AND IT CANNOT EXCEED THE WINDOW. Bars 12..18 are seven consecutive up
    // bars, but a 6-bar window re-seeds at bar 12, so the answer is 6 — which is
    // TC2000's documented range of 0 to x, arriving from the bound rather than
    // from a clamp anybody has to keep in step.
    expect(out[18]).toBe(6)
  })

  it('⭐ this is the shape "up 3+ days in a row" needs, and it reads as a scan', () => {
    // The Qullamaggie parabolic-short criterion, said in TC2000 and answered here.
    //                                              0123456789012345678
    const out = evaluate('TrueInRow(C > O, 5) >= 3', barsFrom('ddddddduuudddddddd'))
    expect(out[9], 'bars 7,8,9 up ⇒ streak 3 ⇒ true').toBe(1)
    expect(out[8], 'only 7,8 up ⇒ streak 2 ⇒ false').toBe(0)
    expect(out[16], 'streak broken').toBe(0)
  })
})

describe('SinceTrue — and the sentinel that makes it honest', () => {
  it('🔴 answers -1 when it NEVER happened in the window, not 0', () => {
    // ⛔ THE INVERSION THIS PREVENTS: a seed of 0 would say "it happened on this
    // very bar" for a symbol where the condition has never once been true.
    const out = evaluate('SinceTrue(C > O, 6)', barsFrom('dddddddddd'))
    expect(out[9]).toBe(-1)
    expect(out[6]).toBe(-1)
  })

  it('answers 0 on the bar it IS true — which is why -1 had to be distinct', () => {
    const out = evaluate('SinceTrue(C > O, 6)', barsFrom('dddddddddu'))
    expect(out[9]).toBe(0)
  })

  it('counts bars since the last true one', () => {
    //                                        012345678901234
    const out = evaluate('SinceTrue(C > O, 8)', barsFrom('ddddudddddddddd'))
    // bar 4 is the only up bar. ⚠️ Bars before 8 are inside the warm-up.
    expect(out[7], 'inside the warm-up').toBeNaN()
    expect(out[9], 'five bars after the up bar').toBe(5)
    expect(out[11], 'seven bars after it').toBe(7)
  })

  it('⚠️ and it forgets, because the window is the bound', () => {
    // TC2000 documents the maximum as `x - 1`. Re-seeding at `i - x` cannot
    // produce more than that, so there is no clamp to keep in step with a
    // declared bound — the window IS the bound.
    const out = evaluate('SinceTrue(C > O, 4)', barsFrom('uddddddddd'))
    // The only up bar is 0. By bar 9 it is far outside a 4-bar window ⇒ never.
    expect(out[9]).toBe(-1)
  })

  it('⛔ THE CONTROL: a seed of 0 would pass three of the tests above', () => {
    // Proves the sentinel tests are load-bearing rather than incidental. A "never"
    // answer and a "just now" answer must not be the same number, and here they
    // are observed to differ on the SAME formula over two bar patterns.
    const never = evaluate('SinceTrue(C > O, 6)', barsFrom('dddddddddd'))
    const justNow = evaluate('SinceTrue(C > O, 6)', barsFrom('dddddddddu'))
    expect(never[9]).not.toBe(justNow[9])
  })
})

describe('what these three refuse', () => {
  it('a bar count that is not a written number', () => {
    const r = parsePcf('CountTrue(C > O, V) > 1')
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('pcf:window')
  })

  it('the wrong number of arguments', () => {
    const r = parsePcf('CountTrue(C > O) > 1')
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('pcf:arity')
  })
})
