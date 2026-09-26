// app/src/components/chart/engine/runtime/__tests__/vendorParityP1.test.js
//
// ─── ⭐⭐ MEASURED AGAINST TRADINGVIEW, NOT AGAINST OUR OWN ARITHMETIC ───────
//
// Every assertion here compares this engine to a number TradingView itself
// produced, captured 2026-09-21 from a live chart's own model and committed at
// `tests/fixtures/vendor/p1-top-unmeasured-spy-1d-2026-09-21.json`.
// The probe that produced it is `tools/visual_conformance/probes/
// p1-top-unmeasured.pine`.
//
// ⛔⛔ THIS IS THE DIFFERENCE BETWEEN A TEST AND A PARITY TEST. A test that
// asserts `ta.stdev(x,5)` equals a figure this file computes is a test of our
// arithmetic against our arithmetic — it passes just as happily when both are
// wrong. These assert against the vendor, which is the only thing "identical to
// TradingView" can mean.
//
// ⚠️ WHAT THIS FILE CANNOT SETTLE, SAID HERE RATHER THAN LEFT IMPLIED: the
// ema/rma SEED. The capture's chart held bars 8168..8467, and the seed is only
// observable in the first ~n bars of a series, so the fixture records that
// question as still owed. `ta.atr === ta.rma(ta.tr(true))` below proves those
// two agree with EACH OTHER at the vendor; it does not prove either matches the
// vendor at the seed.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import VENDOR from '../../../../../../../tests/fixtures/vendor/p1-top-unmeasured-spy-1d-2026-09-21.json'

const N = 80
const BARS = (() => {
  const out = []
  let p = 100
  for (let i = 0; i < N; i += 1) {
    p += Math.sin(i / 5) * 1.4 + Math.cos(i / 11) * 0.6
    out.push({
      t: 1700000000 + i * 86400,
      o: p - Math.cos(i / 3) * 0.9, h: p + 1.3, l: p - 1.1, c: p, v: 1000 + i,
    })
  }
  return out
})()
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const HEAD = '//@version=6\nindicator("t")\n'

/** Pine source → the first plotted output series. */
function runPine(src) {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
  })
  return Array.from(outputs[0])
}
/** The value on the last bar — where every window is long since warm. */
const last = (src) => runPine(src)[N - 1]

describe('⛔ the fixture is the one this file was written against', () => {
  it('names its probe, its symbol and its bar range', () => {
    // A parity file silently pointed at a different capture is a parity file
    // asserting nothing in particular.
    expect(VENDOR._probe).toBe('tools/visual_conformance/probes/p1-top-unmeasured.pine')
    expect(VENDOR._symbol).toBe('AMEX:SPY')
    expect(VENDOR._tf).toBe('1D')
    expect(VENDOR._rows).toBeGreaterThan(200)
  })
})

describe('⭐⭐ `nz` — measured at the vendor', () => {
  it('⭐⭐ nz(na) substitutes what TradingView substitutes', () => {
    expect(last(`${HEAD}plot(nz(na))\n`)).toBe(VENDOR.answers.nz_of_na.value)
  })

  it('⭐⭐ nz(na, r) substitutes the REPLACEMENT', () => {
    expect(last(`${HEAD}plot(nz(na, 42.0))\n`)).toBe(VENDOR.answers.nz_na_with_replacement.value)
  })

  it('⭐⭐ nz(v, r) with v PRESENT takes the VALUE — the argument order', () => {
    // ⛔ THE LOAD-BEARING ONE. An implementation with these backwards passes
    // every test written as nz(na, x) and is wrong on every real call site.
    // The vendor says 7; a backwards engine says 42.
    expect(last(`${HEAD}plot(nz(7.0, 42.0))\n`))
      .toBe(VENDOR.answers.nz_present_with_replacement.value)
  })
})

describe('⭐⭐ `math.abs` — and the na question is the real one', () => {
  it('⛔ CONTROL — abs(-2.5), agreed by every implementation ever written', () => {
    expect(last(`${HEAD}plot(math.abs(-2.5))\n`)).toBe(VENDOR.answers.abs_negative_control.value)
  })

  it('⭐⭐ abs(na) PROPAGATES na — it does not become 0', () => {
    // The vendor returned null on all 300 rows. An engine answering 0 here
    // silently changes the truth of every `math.abs(x) > t` guard in the corpus.
    expect(VENDOR.answers.abs_of_na.value).toBe(null)
    expect(VENDOR.answers.abs_of_na._allRowsNull).toBe(true)
    const ours = last(`${HEAD}plot(math.abs(na))\n`)
    expect(Number.isNaN(ours) || ours === null).toBe(true)
  })
})

describe('⭐⭐ `ta.stdev` divides by n — the vendor says POPULATION', () => {
  it('⛔ the fixture records the ruling and the two candidates it chose between', () => {
    const r = VENDOR.rulings.stdev_denominator
    expect(r.verdict).toBe('POPULATION')
    // ⛔ NON-VACUITY: the two candidates must be far enough apart that matching
    // one is evidence. 6.5885 vs 7.3662 is 11.8% — not float noise.
    const spread = Math.abs(r.recomputed_sample_div_n_minus_1 - r.recomputed_population_div_n)
    expect(spread).toBeGreaterThan(0.5)
    expect(Math.abs(r.tradingview - r.recomputed_population_div_n)).toBeLessThan(1e-6)
  })

  it('⭐⭐ and OUR stdev divides by n too', () => {
    // Computed on this file's own synthetic series, then checked against both
    // candidates the way the capture checked the vendor — so the assertion is
    // "we made the same CHOICE as TradingView", not "we match a number".
    const ours = last(`${HEAD}plot(ta.stdev(close, 5))\n`)
    const cs = BARS.slice(N - 5).map((b) => b.c)
    const m = cs.reduce((a, b) => a + b, 0) / 5
    const ss = cs.reduce((a, b) => a + (b - m) * (b - m), 0)
    const pop = Math.sqrt(ss / 5)
    const samp = Math.sqrt(ss / 4)
    expect(Math.abs(samp - pop)).toBeGreaterThan(1e-3) // the candidates are distinguishable here
    expect(Math.abs(ours - pop)).toBeLessThan(1e-9)
    expect(Math.abs(ours - samp)).toBeGreaterThan(1e-3)
  })
})

describe('⭐⭐ `ta.atr` IS `ta.rma(ta.tr(true), n)` — exact at the vendor', () => {
  it('⛔ the vendor measured it on 300 bars at delta EXACTLY 0', () => {
    const id = VENDOR.identities.atr_IS_rma_of_tr
    expect(id.rowsChecked).toBeGreaterThan(200)
    expect(id.maxAbsDelta).toBe(0)
  })

  // ⛔⛔ FOUND DEFECT, 2026-09-21 — THIS ENGINE FAILS THE VENDOR'S IDENTITY.
  //
  // `it.fails` asserts this DOES fail. It is not a waiver: the day somebody
  // fixes the seed this test goes RED for "expected to fail but passed", the
  // marker comes off, and the assertion becomes an ordinary one. A skip would
  // go quiet instead, which is how a known defect becomes a forgotten one.
  //
  // MEASURED SHAPE OF THE DEFECT, so the fix has something to aim at:
  //   bar 4 : rma = 2.5537...  atr = NaN     <- rma emits ONE BAR EARLIER
  //   bar 5 : atr - rma = 0.03074733229709814
  //   bar 6 : 0.024597865837678423
  //   bar 7 : 0.01967829267014265
  //   ...decaying by EXACTLY 0.8 per bar = (n-1)/n at n=5.
  //
  // ⭐ That decay factor is the whole diagnosis. Two RMA series seeded
  // differently converge at exactly (1 - 1/n) per bar; two series with
  // different INPUTS would not decay so cleanly. So `ta.atr(n)` and
  // `ta.rma(ta.tr(true), n)` in this engine are the same recurrence started
  // from different seeds, and they additionally disagree about WHICH BAR the
  // series begins on.
  //
  // ⭐⭐ AND THE VENDOR CONSTRAINS THE FIX even though the capture could not
  // see the seed directly: TradingView's two series are identical to delta
  // EXACTLY 0 across 300 bars, so whatever it seeds `atr` with, it is the same
  // thing it seeds `rma` with. Ours are not, so at least one is wrong, and they
  // cannot both be right.
  it.fails('⛔ KNOWN DEFECT — the identity does NOT hold in this engine', () => {
    const atr = runPine(`${HEAD}plot(ta.atr(5))\n`)
    const rma = runPine(`${HEAD}plot(ta.rma(ta.tr(true), 5))\n`)
    let maxDelta = 0
    let compared = 0
    for (let i = 0; i < N; i += 1) {
      if (!Number.isFinite(atr[i]) || !Number.isFinite(rma[i])) continue
      maxDelta = Math.max(maxDelta, Math.abs(atr[i] - rma[i]))
      compared += 1
    }
    // ⛔ NON-VACUITY: an identity over zero compared bars is satisfied by two
    // all-na series, which is exactly what a broken build would produce.
    expect(compared).toBeGreaterThan(N / 2)
    expect(maxDelta).toBeLessThan(1e-9)
  })

  it('⛔ CONTROL — sma(tr) is NOT the same thing, so the identity above is a real claim', () => {
    // If rma and sma agreed, the identity test would pass for the wrong reason.
    const rma = runPine(`${HEAD}plot(ta.rma(ta.tr(true), 5))\n`)
    const sma = runPine(`${HEAD}plot(ta.sma(ta.tr(true), 5))\n`)
    let maxDelta = 0
    for (let i = 0; i < N; i += 1) {
      if (!Number.isFinite(rma[i]) || !Number.isFinite(sma[i])) continue
      maxDelta = Math.max(maxDelta, Math.abs(rma[i] - sma[i]))
    }
    expect(maxDelta).toBeGreaterThan(1e-6)
  })
})

describe('⚠️ what this capture did NOT settle', () => {
  it('records the ema/rma seed as still owed, with the reason', () => {
    // ⛔ An owed measurement that nothing names is an owed measurement nobody
    // takes. This keeps it in the suite's own voice.
    const owed = VENDOR._NOT_ANSWERED_BY_THIS_CAPTURE.ema_and_rma_SEED
    expect(owed.why).toMatch(/first ~n bars|seed/i)
    expect(VENDOR._barIndexRange[0]).toBeGreaterThan(5)
  })
})
