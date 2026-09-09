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

import { FINITE_WINDOW, FN } from '../ast/interpret.js'

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
    expect(seen.size, 'the family must still use more than one policy').toBe(3)
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

describe('⚠️ what the fixture did NOT settle — recorded, not guessed', () => {
  it('⛔ wma is UNRESOLVED and stays on the old policy', () => {
    // Five hypotheses were tried against the capture; none explains it. At bar
    // 8130 wma reads 589.386… while the only observation since the hole is
    // 594.2, so it is neither restarting nor reducing over the lone value.
    const h = OBS.vendor.probeB_holes_every_11.hypotheses
    expect(h._wma).toMatch(/UNRESOLVED/)
    expect(FINITE_WINDOW.wma.na, 'wma keeps the pre-existing policy until it is known').toBe('propagate')
  })

  it('⛔ rising/falling were NOT DETERMINED — the probe could not see it', () => {
    // They were read through `x ? 1 : 0`, which cannot separate `na` from false.
    expect(OBS.provenance.note).toMatch(/CANNOT distinguish na from false/)
    expect(FINITE_WINDOW.rising.na).toBe('propagate')
    expect(FINITE_WINDOW.falling.na).toBe('propagate')
  })

  it('⛔ highestbars/lowestbars answered ON the na bar — a shape we do not yet serve', () => {
    const b = OBS.vendor.probeB_holes_every_11
    expect(b.finiteOnNaBar.highestbars).toBe(b.naBars)
    expect(b.finiteOnNaBar.highest).toBe(0)
    // ⛔ so they are NOT `restart` like `highest`, and not `skip` either — left on
    // the old policy with the difference recorded rather than guessed at.
    expect(FINITE_WINDOW.highestbars.na).toBe('propagate')
  })

  it('⭐ the fixture states its own coverage, so a name cannot imply evidence', () => {
    expect(OBS._coverage.SEED).toMatch(/NOT OBSERVED/)
    expect(OBS._coverage.WARMUP).toMatch(/NOT OBSERVED/)
    expect(OBS._coverage.NA_CURRENT_INPUT).toBe('OBSERVED')
  })
})
