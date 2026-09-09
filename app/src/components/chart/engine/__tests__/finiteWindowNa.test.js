// app/src/components/chart/engine/__tests__/finiteWindowNa.test.js
//
// ─── ⭐⭐⭐ WHAT A WINDOW DOES WITH AN `na`, PER MEMBER ──────────────────────
//
// ⛔⛔ THE FAMILY DOES NOT SHARE ONE RULE, AND ASSUMING IT DOES WAS THE TRAP.
// Measured on TradingView 2026-09-08 over a deliberately gappy source, twelve
// members at once. Three policies came back:
//
//   SKIP      sma, stdev, sum, median   — the last `n` FINITE observations,
//                                         answering even ON the `na` bar
//   PROPAGATE dev (and the unresolved)  — a clean `n`-BAR window
//   RESTART   highest, lowest           — the window begins again after a hole
//
// Fixture: `finite-window-na-policy-by-member-spy-1d-2026-09-08`.
//
// ⛔ THIS FILE ASSERTS THE STRUCTURAL SIGNATURES THE VENDOR EXHIBITED, on
// synthetic data where each is unambiguous. The fixture carries the vendor's own
// numbers and the hypothesis counts (380/0, 346/0, 210/0); what these cases add
// is that OUR implementation reproduces the same shapes — a count in a JSON file
// cannot fail when the code changes, and this can.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { FINITE_WINDOW, CARRIED, FN } from '../ast/interpret.js'

const OBS = JSON.parse(fs.readFileSync(
  path.resolve(process.cwd(), '../tests/fixtures/vendor/runtime/finite-window-na-policy-by-member-spy-1d-2026-09-08.json'),
  'utf8'))

/** 40 bars, holes every 7 — long enough to warm up, gappy enough to separate. */
const N = 40
const HOLE = (i) => i % 7 === 0 && i > 0
const SRC = Float64Array.from({ length: N }, (_, i) => (HOLE(i) ? NaN : 100 + Math.sin(i / 2) * 10 + i))
const finite = (a) => Array.from(a).filter(Number.isFinite).length

describe('⛔⛔ the policy is declared PER MEMBER, and the table says so', () => {
  it('⭐ every member declares one, and all three are in use', () => {
    const seen = new Set()
    for (const [name, spec] of Object.entries(FINITE_WINDOW)) {
      expect(spec.na, `${name} declares no na policy`).toBeTruthy()
      seen.add(spec.na)
    }
    // ⛔ IF THIS DROPS TO ONE, SOMEBODY HAS GENERALISED. That is the exact move
    // the evidence forbids: at least three members would then be wrong.
    // ⚰️ THIS READ 3 UNTIL 2026-09-08. `wma` resolving to FORWARD-FILL added a
    // fourth, which is the same lesson one turn further on — the family did not
    // merely hold more than one rule, it held more rules than had been NAMED.
    expect(seen.size, 'the family must still use more than one policy').toBe(4)
  })

  it('⭐ the members are on the policies the vendor showed', () => {
    expect(FINITE_WINDOW.sma.na).toBe('skip')
    expect(FINITE_WINDOW.stdev.na).toBe('skip')
    expect(FINITE_WINDOW.sum.na).toBe('skip')
    expect(FINITE_WINDOW.median.na).toBe('skip')
    expect(FINITE_WINDOW.dev.na).toBe('propagate')
    expect(FINITE_WINDOW.highest.na).toBe('restart')
    expect(FINITE_WINDOW.lowest.na).toBe('restart')
  })
})

describe('⭐⭐ SKIP — answers on the `na` bar, over the last n FINITE values', () => {
  for (const m of ['sma', 'stdev', 'sum', 'median']) {
    it(`⭐ ${m} answers on every bar past its warm-up, holes included`, () => {
      const out = FN[m](SRC, 5)
      // the vendor answered on 133 of 133 na bars; ours must answer on the na
      // bars of this fixture too
      const onHoles = Array.from({ length: N }, (_, i) => i).filter((i) => HOLE(i) && i > 10)
      expect(onHoles.length).toBeGreaterThan(2)
      for (const i of onHoles) {
        expect(Number.isFinite(out[i]), `${m} must answer at the hole on bar ${i}`).toBe(true)
      }
    })
  }

  it('⭐ and the value is exactly the last 5 finite observations', () => {
    const out = FN.sma(SRC, 5)
    for (let i = 12; i < N; i += 1) {
      const f = []
      for (let k = i; k >= 0 && f.length < 5; k -= 1) if (Number.isFinite(SRC[k])) f.push(SRC[k])
      expect(out[i], `bar ${i}`).toBeCloseTo(f.reduce((a, b) => a + b, 0) / 5, 12)
    }
  })
})

describe('⭐⭐ PROPAGATE — blank for exactly n-1 bars after a hole', () => {
  it('⭐ dev goes blank at the hole and returns n-1 bars later', () => {
    const out = FN.dev(SRC, 5)
    // pick a hole with a clean run before and after it
    const h = 14
    expect(HOLE(h)).toBe(true)
    expect(Number.isFinite(out[h]), 'the hole itself is blank').toBe(false)
    for (let k = 1; k <= 4; k += 1) {
      expect(Number.isFinite(out[h + k]), `bar ${h + k} is still inside the dirty window`).toBe(false)
    }
    expect(Number.isFinite(out[h + 5]), 'and it returns exactly n bars after the hole').toBe(true)
  })

  it('⛔ NON-VACUITY — a SKIP member does NOT do that', () => {
    const skip = FN.sma(SRC, 5)
    const prop = FN.dev(SRC, 5)
    expect(finite(skip), 'skip answers on strictly more bars than propagate').toBeGreaterThan(finite(prop))
  })
})

describe('⭐⭐ RESTART — the window begins again after a hole', () => {
  it('⭐⭐ one bar after a hole, highest === lowest === the lone observation', () => {
    // ⭐ THE VENDOR'S OWN SIGNATURE. At bar 8130 — one bar past a hole — its
    // `highest` and `lowest` both read 594.2, the only observation since.
    const hi = FN.highest(SRC, 5)
    const lo = FN.lowest(SRC, 5)
    for (let i = 8; i < N - 1; i += 1) {
      if (!HOLE(i)) continue
      const j = i + 1
      expect(hi[j], `bar ${j}: highest is the lone value`).toBeCloseTo(SRC[j], 12)
      expect(lo[j], `bar ${j}: lowest is the lone value`).toBeCloseTo(SRC[j], 12)
      expect(hi[j]).toBeCloseTo(lo[j], 12)
    }
  })

  it('⭐ the run then grows back to n', () => {
    const hi = FN.highest(SRC, 5)
    const h = 14
    // two bars after the hole the window holds two observations
    expect(hi[h + 2], `bar ${h + 2}`).toBeCloseTo(Math.max(SRC[h + 1], SRC[h + 2]), 12)
    expect(hi[h + 3], `bar ${h + 3}`).toBeCloseTo(Math.max(SRC[h + 1], SRC[h + 2], SRC[h + 3]), 12)
  })

  it('⛔ and it is BLANK at the hole itself — restart is not skip', () => {
    const hi = FN.highest(SRC, 5)
    expect(Number.isFinite(hi[14])).toBe(false)
    // whereas a SKIP member answers there
    expect(Number.isFinite(FN.sma(SRC, 5)[14])).toBe(true)
  })
})

describe('⭐ the series-start warm-up is UNCHANGED, and deliberately so', () => {
  it('⛔ no member answers before bar n-1, whatever its policy', () => {
    // ⚠️ NOT OBSERVED BY ANY FIXTURE. Every capture begins deep in real history,
    // so what Pine does on bar 0 of a symbol is unknown. RESTART answers with a
    // PARTIAL run after a hole because that IS observed; the start-of-series gate
    // stays because it is not. Two rules that look alike, one with evidence.
    const clean = Float64Array.from({ length: 20 }, (_, i) => 100 + i)
    for (const m of Object.keys(FINITE_WINDOW)) {
      const span = FINITE_WINDOW[m].span(5)
      const out = FN[m](clean, 5)
      for (let i = 0; i < span - 1; i += 1) {
        expect(Number.isFinite(out[i]), `${m} answered at bar ${i}, before its window is full`).toBe(false)
      }
      expect(Number.isFinite(out[span - 1]), `${m} must answer at bar ${span - 1}`).toBe(true)
    }
  })

  it('⭐ a CLEAN source is untouched by the whole change', () => {
    // ⛔ THE BLAST-RADIUS CLAIM, ASSERTED. Real OHLCV has no holes, so no member
    // may move on a gapless series — that is why 0 corpus scripts changed.
    const clean = Float64Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 8)
    for (const m of Object.keys(FINITE_WINDOW)) {
      const out = FN[m](clean, 5)
      const span = FINITE_WINDOW[m].span(5)
      expect(finite(out), `${m} on a clean source`).toBe(40 - (span - 1))
    }
  })
})

describe('⚰️ what PART Z could not settle, and what settled it', () => {
  // ⛔⛔ THIS BLOCK USED TO ASSERT THE UNRESOLVED STATE ITSELF — that `wma` was
  // `propagate` "until it is known", that `rising`/`falling` were undetermined,
  // that `highestbars` answering on the `na` bar was "a shape we do not yet
  // serve". Those were honest records of ignorance and they are now records of a
  // WRONG ANSWER, so they are replaced rather than relaxed. The ignorance itself
  // survives where it belongs: in the superseded fixture's own `_coverage`.
  //
  // What settled all three was changing the SOURCE, not the analysis. PART Z
  // probed real `close`, where five `wma` hypotheses all produced plausible
  // numbers and none could be excluded. An arithmetic source ((bar_index*37)%101)
  // makes the answer fall out in one row.

  it('⭐⭐ wma is RESOLVED — forward-fill, and the sixth hypothesis is the one that fits', () => {
    expect(FINITE_WINDOW.wma.na).toBe('ffill')
    // One hand-checkable row from the capture: values 58, 95, na, 68 with
    // weights 1,2,3,4 read 80.5 — which is (58·1 + 95·2 + 95·3 + 68·4)/10, the
    // hole carrying the previous value FORWARD at its own bar's weight.
    const src = Float64Array.from([58, 95, NaN, 68])
    expect(FN.wma(src, 4)[3]).toBeCloseTo(80.5, 12)
  })

  it('⭐⭐ wma answers `na` on the bar it is ASKED about, and fills only what it looks BACK at', () => {
    // ⛔ THE HALF OF THE RULE THAT IS EASY TO LOSE. Forward-filling the current
    // bar too would answer on every hole; the vendor blanks exactly there, and
    // all 34 of the first model's failures were that one bar.
    const src = Float64Array.from([58, 95, 68, NaN])
    expect(Number.isFinite(FN.wma(src, 4)[3])).toBe(false)
  })

  it('⭐⭐ rising/falling LEFT the window family — the counter is what fits', () => {
    expect(FINITE_WINDOW.rising, 'rising is no longer a window member').toBeUndefined()
    expect(FINITE_WINDOW.falling, 'falling is no longer a window member').toBeUndefined()
    expect(CARRIED.rising).toBeTruthy()
    expect(CARRIED.falling).toBeTruthy()
    // ⭐ THE SIGNATURE NO WINDOW CAN PRODUCE, in four bars: the source DROPS
    // across a hole and `rising` stays true, because the hole held the count and
    // the bar after it compares against that hole.
    const src = Float64Array.from([5, 6, 7, NaN, 1, 2])
    const out = FN.rising(src, 2)
    expect(out[2], 'a clean 2-step run is true').toBe(1)
    expect(out[4], 'and 7 -> na -> 1 does not break it').toBe(1)
  })

  it('⭐⭐ highestbars/lowestbars: RESTART, and 0 where the VALUE is not computable', () => {
    expect(FINITE_WINDOW.highestbars.na).toBe('restart')
    expect(FINITE_WINDOW.lowestbars.na).toBe('restart')
    expect(FINITE_WINDOW.highestbars.naCurrent).toBe(0)
    // ⭐ THE ASYMMETRY PART Z MEASURED AND COULD NOT EXPLAIN, now expressed: the
    // OFFSET is defined on an `na` bar because the window restarted there and
    // this bar is its only candidate — while the VALUE stays blank.
    const src = Float64Array.from([10, 11, 12, NaN])
    expect(FN.highestbars(src, 3)[3]).toBe(0)
    expect(Number.isFinite(FN.highest(src, 3)[3])).toBe(false)
  })

  it('⛔ and a TIE goes to the OLDER bar, which is where the corpus actually moved', () => {
    // 6–10% of bars on real SPY OHLCV change under this rule. It is not a corner
    // case: repeated highs and lows are ordinary in a real price series.
    const src = Float64Array.from([10, 20, 20, 15])
    // internal form is a NON-NEGATIVE distance back; `ta.highestbars` negates it.
    expect(FN.highestbars(src, 3)[3]).toBe(2)
  })

  it('⭐ the superseded fixture still states its own coverage', () => {
    expect(OBS._coverage.SEED).toMatch(/NOT OBSERVED/)
    expect(OBS._coverage.WARMUP).toMatch(/NOT OBSERVED/)
    expect(OBS._coverage.NA_CURRENT_INPUT).toBe('OBSERVED')
  })
})
