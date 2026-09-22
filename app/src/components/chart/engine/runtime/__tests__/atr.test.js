// app/src/components/chart/engine/runtime/__tests__/atr.test.js
//
// ─── ⭐⭐ ONE ATR, MEASURED — NOT TWO THAT AGREE BY ASSERTION ────────────────
//
// The columnar lane serves ATR from the SHIPPED `computeATR`. The runtime lane
// had no ATR at all: it is in none of `FINITE_WINDOW`, `CARRIED` or the
// pointwise table, so `ta.atr(n)` inside a `request.security` refused.
//
// ⛔ THE TEMPTING FIX IS A SECOND IMPLEMENTATION, and it is the one this repo
// keeps paying for: two authorities over one number a member reads off the
// screen, drifting the first time either seed changes. So `ta.atr(n)` DESUGARS
// to `ta.rma(trueRange, n)` — and `CARRIED.rma` is already the shared
// authority, because `carriedFn` derives the COLUMN driver from the same
// `CARRIED[name].step` the runtime walks.
//
// ⭐ WHY THAT IS EXACT, read side by side:
//     computeATR   accumulate n true ranges, seed atr = sum/n,
//                  then atr = (atr*(n-1) + tr)/n
//     smoothStep   seed from an SMA over the first n FINITE samples,
//     with k=1/n   then prev*(1-k) + v*k
//   Same recurrence, same seed, same hold-on-`na` rule.
//
// ⛔⛔ AND IT IS MEASURED RATHER THAN ASSERTED. The case below runs both and
// compares them bar by bar. An assertion that they "should" agree would pass on
// the day someone changes one of them.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { computeATR } from '../../../indicators.js'

const head = '//@version=6\nindicator("t", overlay = true)\n'

/** Bars with a genuinely varying range, so a wrong seed cannot hide. ⛔ A
 *  constant-range fixture makes every ATR equal its own true range and every
 *  implementation agree (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). */
const N = 60
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + Math.sin(i / 3) * 12 + i * 0.4
  const span = 1.5 + Math.abs(Math.cos(i / 5)) * 4
  return { t: 1700000000 + i * 86400, o: c - 0.3, h: c + span, l: c - span, c, v: 1000 + i }
})
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

const runtimeAtr = (n) => {
  // ⛔ READ THROUGH A `var`, so the expression cannot take the COLUMNAR route.
  // Without that this measures the shipped implementation against itself.
  const r = buildRuntimeIr(`${head}var float s = 0.0\ns := 0.0\nplot(ta.atr(${n}) + s)\n`, {
    bars: BARS, inputs: {}, newestBarIsForming: false,
  })
  if (!r.ok) throw new Error(`refused: ${r.refusal.guard} — ${r.refusal.message}`)
  const program = lowerIrProgram(r.ir)
  const { outputs } = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
  })
  return Array.from(outputs[0])
}

const shippedAtr = (n) => {
  const rows = computeATR(BARS, n)
  return BARS.map((_, i) => {
    const v = rows[i] && rows[i].value
    return typeof v === 'number' ? v : NaN
  })
}

describe('⭐⭐ the runtime lane agrees with the shipped ATR', () => {
  for (const n of [14, 5, 21]) {
    it(`bar for bar at length ${n}`, () => {
      const mine = runtimeAtr(n)
      const theirs = shippedAtr(n)

      // ⛔ NON-VACUITY FIRST. If the shipped one answered nothing, every
      // comparison below is between two blanks and the rail proves nothing.
      const answered = theirs.filter((v) => Number.isFinite(v)).length
      expect(answered, 'the shipped ATR answered on no bar — this fixture cannot '
        + 'distinguish anything').toBeGreaterThan(N / 2)

      for (let i = 0; i < N; i += 1) {
        const a = mine[i]
        const b = theirs[i]
        if (!Number.isFinite(b)) {
          expect(Number.isFinite(a), `bar ${i}: shipped is na, runtime answered ${a} `
            + '— the warm-up landed on a different bar').toBe(false)
          continue
        }
        expect(Number.isFinite(a), `bar ${i}: shipped answered ${b}, runtime is na`).toBe(true)
        expect(Math.abs(a - b), `bar ${i}: runtime ${a} vs shipped ${b}`).toBeLessThan(1e-9)
      }
    })
  }

  it('⛔ CONTROL — the fixture has a VARYING range, so a wrong seed shows', () => {
    // On constant-range bars every ATR equals that range from the seed onward,
    // and a seed bug is invisible. This asserts the fixture can tell them apart.
    const spans = BARS.map((b) => b.h - b.l)
    expect(Math.max(...spans) - Math.min(...spans)).toBeGreaterThan(1)
  })
})

describe('⭐ where `ta.atr` now works', () => {
  const ok = (src) => {
    const r = buildRuntimeIr(head + src, { bars: BARS, inputs: {}, newestBarIsForming: false })
    return r.ok ? 'OK' : `${r.refusal.guard}: ${r.refusal.message}`
  }

  it('⭐⭐ inside a request — the shape the target script uses', () => {
    expect(ok('plot(request.security("A", "D", ta.atr(14)))\n')).toBe('OK')
  })

  // ⚰⚰ THIS CASE'S NAME WAS FALSE, AND ITS ASSERTION COULD NOT TELL.
  //
  // It read "and over runtime state, where the columnar lane cannot reach"
  // and asserted only `'OK'` — which this source returns whichever lane
  // serves it, so the claim in the title was never under test
  // (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
  //
  // MEASURED 2026-09-21 BY MUTATION: a `throw` planted as the first statement
  // of the `ta.atr` branch in `pineRuntimeFrontend.js` does NOT fire for this
  // source, nor for a plain `ta.atr(5)`, nor inside a user function, nor
  // inside an `if` body. The COLUMNAR lane reaches all of them. That branch
  // has exactly ONE reachable door and it is the case above this one.
  //
  // ⭐ Kept, because "the columnar lane serves this too" is worth pinning —
  // but pinned as what it is.
  it('⭐ over runtime state the COLUMNAR lane still serves it', () => {
    expect(ok('var float s = 0.0\ns := close\nplot(ta.atr(14) + s)\n')).toBe('OK')
  })

  it('⛔ a length that cannot be sized before bar 0 still refuses', () => {
    const r = buildRuntimeIr(`${head}var float s = 0.0\ns := close\nplot(ta.atr(int(s)) + s)\n`,
      { bars: BARS, inputs: {}, newestBarIsForming: false })
    expect(r.ok).toBe(false)
  })

  it('⛔ a wrong argument count refuses by name', () => {
    // ⭐ AND AN EARLIER AUTHORITY ANSWERS IT. `pine:arity` fires before this
    // lane sees the call, with a message naming the count — so the arity check
    // inside the `ta.atr` branch is a floor, not the thing under test. Asserting
    // the branch's own sentence here would have been asserting unreachable code.
    expect(ok('var float s = 0.0\ns := close\nplot(ta.atr(14, 2) + s)\n'))
      .toMatch(/arity|given 2 argument/)
  })
})

describe('⛔⛔ Pine DEFINES `ta.atr(n)` as `ta.rma(ta.tr(true), n)` — ours differ', () => {
  // ⭐⭐ THE OPEN QUESTION, STATED PRECISELY SO NOBODY "FIXES" IT ON A GUESS.
  //
  // Pine's reference defines `ta.atr(length)` as `ta.rma(ta.tr(true), length)`.
  // `ta.tr(true)` is `high - low` on bar 0 — measured, ours is correct there.
  // But BOTH of this engine's ATR routes build a true range from a raw
  // `close[1]`, which is `na` on bar 0, so the warm-up ends one bar later and
  // the seed differs. The delta decays by exactly (n-1)/n, which is the
  // signature of the same recurrence started from a different seed.
  //
  // ⛔⛔ AND THE VENDOR CAPTURE CANNOT SETTLE IT. The 2026-09-21 capture
  // (`tests/fixtures/vendor/p1-top-unmeasured-spy-1d-2026-09-21.json`) holds
  // bars 8168..8467, where any seed difference has long since decayed to zero —
  // so TradingView's two series agreeing there is NOT evidence about the seed.
  // Changing these numbers on the strength of the documentation alone would put
  // a plausible figure where a capture belongs, which is the one thing the
  // desugar's own comment warns against.
  //
  // ⭐ SO THIS IS `it.fails`, NOT `it.skip`. The day somebody captures the seed
  // from a short-history symbol (or a chart scrolled back to bar 0) and fixes
  // it, this goes RED for "expected to fail but passed", the marker comes off,
  // and it becomes an ordinary assertion. A skip would go quiet instead, which
  // is how a known defect becomes a forgotten one.
  const series = (src) => {
    const r = buildRuntimeIr(head + src, { bars: BARS, inputs: {}, newestBarIsForming: false })
    if (!r.ok) throw new Error(`refused ${r.refusal.guard}: ${r.refusal.message}`)
    const { outputs } = execute(lowerIrProgram(r.ir), {
      bars: BARS.length, series: SERIES, columns: lowerIrProgram(r.ir).columns, confirmed: true,
    })
    return Array.from(outputs[0])
  }

  it.fails('⛔ KNOWN DEFECT — the identity does not hold in this engine', () => {
    const atr = series('plot(ta.atr(5))' + String.fromCharCode(10))
    const rma = series('plot(ta.rma(ta.tr(true), 5))' + String.fromCharCode(10))
    let maxDelta = 0
    let compared = 0
    for (let i = 0; i < BARS.length; i += 1) {
      if (!Number.isFinite(atr[i]) || !Number.isFinite(rma[i])) continue
      maxDelta = Math.max(maxDelta, Math.abs(atr[i] - rma[i]))
      compared += 1
    }
    // ⛔ NON-VACUITY: an identity over zero compared bars is satisfied by two
    // all-na series, which is exactly what a broken build produces.
    expect(compared).toBeGreaterThan(3)
    expect(maxDelta).toBeLessThan(1e-9)
  })

  // ⛔⛔ NON-VACUITY FOR THE `it.fails` ABOVE, AND IT IS NOT OPTIONAL.
  // `it.fails` is satisfied by ANY throw — including a refusal, a lowering
  // error, or a typo in the source string. That would make the marker report
  // "the defect is still there" for a test that never computed anything.
  // This measures the defect POSITIVELY: both series compute, they overlap on
  // real bars, and they disagree. When the seed is fixed this goes RED first.
  it('⛔ the defect is MEASURED, not merely expected — both compute and differ', () => {
    const atr = series('plot(ta.atr(5))' + String.fromCharCode(10))
    const rma = series('plot(ta.rma(ta.tr(true), 5))' + String.fromCharCode(10))
    const overlap = atr.filter((v, i) => Number.isFinite(v) && Number.isFinite(rma[i])).length
    expect(overlap).toBeGreaterThan(3)
    const maxDelta = Math.max(...atr.map((v, i) => (
      Number.isFinite(v) && Number.isFinite(rma[i]) ? Math.abs(v - rma[i]) : 0)))
    expect(maxDelta).toBeGreaterThan(1e-9)
  })

  it('⛔ CONTROL — `ta.tr(true)` really is `high - low` on bar 0', () => {
    // If this ever fails, the diagnosis above is wrong and the identity test
    // is failing for a different reason than the one it documents.
    const tr = series('plot(ta.tr(true))' + String.fromCharCode(10))
    expect(tr[0]).toBeCloseTo(BARS[0].h - BARS[0].l, 10)
  })
})
