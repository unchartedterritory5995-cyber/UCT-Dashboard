// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.f5SeedWarmup.test.js
//
// ─── ⭐⭐ F5 — AN OFF-LISTING CAPTURE WHOSE ONLY DIVERGENCE IS A CORRECTLY
//     WITHHELD SEED WARM-UP GRADES MATCH, AND A WITHHELD BAR CANNOT HIDE A REAL
//     DIVERGENCE ───────────────────────────────────────────────────────────────
//
// Off the listing a recursive series is seeded where TradingView's is not, and our
// side WITHHOLDS its early bars (`interpret.js::seedWarmupMask`). The harness rule
// (`compare.mjs::seedWithheldAt`): a bar our side withheld for a seed is not
// compared, and is counted, ONLY when the value it withheld lies within the bound
// our side derived for it — the bound comes from the decay maths before any vendor
// number is read. A withheld value OUTSIDE its bound is a divergence of its own
// kind (`seed-bound`). A blank our side did not withhold for a seed is graded
// exactly as before.
import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'
import { comparePlot, plotVerdict, seedWithheldAt, tolerancePolicy } from '../../../../../../../tools/vendor_harness/compare.mjs'
import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import * as ourSide from './ourSide'

const TOL = tolerancePolicy({ symbol: { pricescale: 100 } })
const times = Array.from({ length: 10 }, (_, i) => 1700000000 + i * 86400)

/** ours withheld on bars 0..3 (raw `raw`, bound `b`), drawn from 4 on */
function synthetic({ raw = [10.4, 10.3, 10.2, 10.1], b = [1, 1, 1, 1], vendorHead = [10, 10, 10, 10], oursTail = [10, 10, 10, 10, 10, 10] } = {}) {
  const vendor = [...vendorHead, 10, 10, 10, 10, 10, 10]
  const ours = [NaN, NaN, NaN, NaN, ...oursTail]
  const seedWithheld = {
    mask: Float64Array.from([1, 1, 1, 1, 0, 0, 0, 0, 0, 0]),
    bound: Float64Array.from([...b, 0, 0, 0, 0, 0, 0]),
    raw: Float64Array.from([...raw, 10, 10, 10, 10, 10, 10]),
  }
  return { vendor, ours, seedWithheld }
}

describe('F5 · the comparator — a withheld bar is graded by its own bound', () => {
  it('⭐ within its bound: not compared, counted, named — and the plot MATCHes', () => {
    const { vendor, ours, seedWithheld } = synthetic()
    const r = comparePlot({ times, vendor, ours, tol: TOL, seedWithheld })
    expect(r.seedWithheld).toBe(4)
    expect(r.seedBoundViolations).toBe(0)
    expect(r.compared).toBe(6)
    expect([r.seedWithheldFirst, r.seedWithheldLast]).toEqual([0, 3])
    const v = plotVerdict(r, {})
    expect(v.verdict).toBe('MATCH')
    expect(v.reason).toMatch(/4 bar\(s\) withheld by the seed warm-up \(seed:window, bars 0\.\.3\)/)
  })

  it('⛔ OUTSIDE its bound: a divergence of its own kind, never excused', () => {
    const { vendor, ours, seedWithheld } = synthetic({ raw: [10.4, 13, 10.2, 10.1] })
    const r = comparePlot({ times, vendor, ours, tol: TOL, seedWithheld })
    expect(r.seedBoundViolations).toBe(1)
    expect(r.seedWithheld).toBe(3)
    expect(r.steady.first).toMatchObject({ bar: 1, kind: 'seed-bound', withheldValue: 13, bound: 1 })
    expect(plotVerdict(r, {}).verdict).toBe('DIVERGE')
  })

  it('⛔ a blank our side did NOT withhold for a seed is graded exactly as before', () => {
    const { vendor, ours, seedWithheld } = synthetic()
    seedWithheld.mask[2] = 0
    const r = comparePlot({ times, vendor, ours, tol: TOL, seedWithheld })
    expect(r.naMismatches).toBe(1)
    expect(plotVerdict(r, {}).verdict).toBe('DIVERGE')
  })

  it('⛔ a bar our side DREW is compared whatever the mask says — the mask can only confirm a blank', () => {
    const { vendor, seedWithheld } = synthetic()
    const ours = [99, NaN, NaN, NaN, 10, 10, 10, 10, 10, 10]
    const r = comparePlot({ times, vendor, ours, tol: TOL, seedWithheld })
    expect(r.valueMismatches).toBe(1)
    expect(plotVerdict(r, {}).verdict).toBe('DIVERGE')
  })

  it('where TradingView draws nothing either, the bar is compared as usual (both `na`)', () => {
    const { ours, seedWithheld } = synthetic()
    const vendor = [null, null, null, null, 10, 10, 10, 10, 10, 10]
    const r = comparePlot({ times, vendor, ours, tol: TOL, seedWithheld })
    expect(r.seedWithheld).toBe(0)
    expect(r.compared).toBe(10)
    expect(plotVerdict(r, {}).verdict).toBe('MATCH')
  })

  it('a blank our side could not decide (`NaN` raw) is covered only by an unbounded claim', () => {
    expect(seedWithheldAt({ mask: [1], bound: [Infinity], raw: [NaN] }, 0, NaN, 5, TOL)).toBe('within')
    expect(seedWithheldAt({ mask: [1], bound: [3], raw: [NaN] }, 0, NaN, 5, TOL)).toBe('violated')
    expect(seedWithheldAt({ mask: [0], bound: [Infinity], raw: [NaN] }, 0, NaN, 5, TOL)).toBe(null)
    expect(seedWithheldAt(null, 0, NaN, 5, TOL)).toBe(null)
  })

  it('every bar withheld leaves nothing to judge: INCONCLUSIVE, and it says why', () => {
    const vendor = [10, 10]
    const r = comparePlot({ times: times.slice(0, 2), vendor, ours: [NaN, NaN], tol: TOL,
      seedWithheld: { mask: [1, 1], bound: [1, 1], raw: [10.5, 10.5] } })
    const v = plotVerdict(r, {})
    expect(v.verdict).toBe('INCONCLUSIVE')
    expect(v.reason).toMatch(/withheld by the seed warm-up/)
  })
})

describe('F5 · end to end on real vendor bars, through the member door', () => {
  const grade = (id) => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    try {
      return gradeCapture(loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture).verdict
    } finally { vi.unstubAllEnvs() }
  }

  it('⭐ keltner-channels-bands on AMEX:SPY 1D (not from the listing): every band MATCHes, its warm-up withheld by bound', () => {
    const v = grade('keltner-channels-bands-spy-1d-2026-10-03')
    expect(v.plots.length).toBe(7)
    for (const p of v.plots) {
      expect(p.verdict, p.title).toBe('MATCH')
      expect(p.stats.seedWithheld, p.title).toBeGreaterThan(100)
      expect(p.stats.seedBoundViolations, p.title).toBe(0)
      expect(p.reason, p.title).toMatch(/withheld by the seed warm-up/)
    }
  })

  it('…and from the listing (NYSE:RDDT 1D) nothing is withheld for a seed', () => {
    const v = grade('keltner-channels-bands-rddt-1d-2026-09-27')
    for (const p of v.plots) {
      expect(p.verdict, p.title).toBe('MATCH')
      expect(p.stats.seedWithheld || 0, p.title).toBe(0)
    }
  })

  it('⛔ NON-VACUITY: the withheld values really differ from TradingView — graded without the rule, the prefix DIVERGEs', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    try {
      const cap = loadCapture(path.join(HARNESS_DIR, 'keltner-channels-bands-spy-1d-2026-10-03.json')).capture
      const ours = ourSide.runOurSide(cap)
      const basis = ours.plots.find((p) => p.title === 'Basis')
      const col = cap.plotValues.fields.indexOf(cap.study.plots.find((p) => p.title === 'Basis').id)
      const byT = new Map(cap.plotValues.rows.map((r) => [String(r[0]), r]))
      const ts = cap.bars.rows.map((r) => r[0])
      const vendor = ts.map((t) => { const r = byT.get(String(t)); return r ? r[col] : undefined })
      const tol = tolerancePolicy(cap)
      const withRule = comparePlot({ times: ts, vendor, ours: basis.column, tol, warmupBars: basis.lookback, seedWithheld: basis.seedWithheld })
      const without = comparePlot({ times: ts, vendor, ours: basis.seedWithheld.raw, tol, warmupBars: basis.lookback })
      expect(plotVerdict(withRule, {}).verdict).toBe('MATCH')
      expect(plotVerdict(without, {}).verdict).toBe('DIVERGE')
      expect(without.steady.pattern.kind).toBe('converging-prefix')
      // every divergent bar of the plain evaluation is one the rule withheld — and
      // its real error sits inside the bound claimed for it
      let checked = 0
      for (let i = 0; i < ts.length; i++) {
        const v = vendor[i]
        const raw = basis.seedWithheld.raw[i]
        if (v === null || v === undefined || !Number.isFinite(raw) || i < basis.lookback) continue
        if (Math.abs(raw - v) > tol.abs && Math.abs(raw - v) > tol.rel * Math.abs(v)) {
          expect(basis.seedWithheld.mask[i], `bar ${i}`).toBe(1)
          expect(Math.abs(raw - v), `bar ${i}`).toBeLessThanOrEqual(basis.seedWithheld.bound[i])
          checked += 1
        }
      }
      expect(checked).toBeGreaterThan(100)
    } finally { vi.unstubAllEnvs() }
  })
})
