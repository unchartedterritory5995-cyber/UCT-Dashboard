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

  it('⭐ and over runtime state, where the columnar lane cannot reach', () => {
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
