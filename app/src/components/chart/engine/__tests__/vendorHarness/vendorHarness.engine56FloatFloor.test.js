// ─── ⭐⭐ ENGINE 56 — two grading rules of the vendor harness ───────────────────────────────
//
// S4-4 (coordinator ruling, 2026-11-14): where a running total (`cum`, `sum`) feeds a plot,
// two correct engines that add the same terms in a different order differ by a few ulps of
// the TOTAL. `accdist-macd` on AMEX:SPY 1D (8,507 bars) read 2 bars over REL 1e-9: its MACD
// is `ema(ad, 12) - ema(ad, 26)` of an accumulation near 1e9, a difference of two large
// numbers that keeps their rounding. The floor is `8 · ε · max |total|` over the prefix
// (`ourSide.js::floatOrderFloorOf`), used only for such a plot, and it cannot hide a real
// difference: a relative 1e-6 error in the plot still DIVERGES (railed below on the
// capture's own magnitudes).
//
// Per-bar withholding (A3 / S4-2): a bar our side withheld BY NAME (`pine:bool-na-unwitnessed`,
// `pine:tie-unwitnessed`) is not compared. Where TradingView drew a value on one, the plot is
// INCONCLUSIVE with the count — never MATCH (a gap is not agreement) and never DIVERGE (a
// withholding is not a wrong value).
import { describe, it, expect } from 'vitest'
import { comparePlot, plotVerdict, tolerancePolicy } from '../../../../../../../tools/vendor_harness/compare.mjs'
import { floatOrderFloorOf, withheldBarsOf, FLOAT_ORDER_ULPS } from './ourSide'

const TOL = tolerancePolicy({ symbol: { pricescale: 100 } })
const times = (n) => Array.from({ length: n }, (_, i) => 1700000000 + i * 86400)
const verdictOf = (r) => plotVerdict(r, { colorMeasured: false, colorResolvable: false }).verdict

describe('S4-4 — the float-order floor of a plot a running total feeds', () => {
  // the capture's magnitudes: an accumulation near 1.2e9, a MACD near 3.6e5
  const TOTAL = 1.2e9
  const MACD = 362254.0341452854
  const floor = FLOAT_ORDER_ULPS * Number.EPSILON * TOTAL
  it('the floor is a few ulps of the total (about 2.1e-6 here), far below any difference a member sees', () => {
    expect(floor).toBeGreaterThan(1e-6)
    expect(floor).toBeLessThan(1e-5)
  })
  it('two ulps of the total in the plot: DIVERGE without the floor, MATCH with it', () => {
    const vendor = [MACD, MACD]
    const ours = [MACD + 2 * Number.EPSILON * TOTAL, MACD]
    // the gap is ~5.3e-7; graded with a tolerance tight enough to see it, as REL 1e-9 · |value|
    // is where the capture's histogram crosses zero (the two bars it read over)
    const gap = Math.abs(ours[0] - vendor[0])
    const tight = { rel: 1e-12, abs: 1e-12 }
    expect(verdictOf(comparePlot({ times: times(2), vendor, ours, tol: tight }))).toBe('DIVERGE')
    const r = comparePlot({ times: times(2), vendor, ours, tol: tight, floatOrderFloor: [floor, floor] })
    expect(verdictOf(r)).toBe('MATCH')
    expect(r.floatOrderFloorUsed).toBe(1)
    expect(gap).toBeLessThan(floor)
  })
  it('a relative 1e-6 error in the plot still DIVERGES with the floor on', () => {
    const vendor = [MACD]
    const ours = [MACD * (1 + 1e-6)]
    const r = comparePlot({ times: times(1), vendor, ours, tol: TOL, floatOrderFloor: [floor] })
    expect(verdictOf(r)).toBe('DIVERGE')
    expect(r.valueMismatches).toBe(1)
  })
  it('floatOrderFloorOf: null for a plot no running total feeds; the running max of |total| otherwise', () => {
    const bars = [1, -3, 2, 5].map((c, i) => ({ t: 1700000000 + i * 86400, o: c, h: c, l: c, c, v: 1 }))
    expect(floatOrderFloorOf({ type: 'series', name: 'close' }, bars, 0)).toBeNull()
    const cumClose = { type: 'call', name: 'cum', args: [{ type: 'series', name: 'close' }] }
    const out = floatOrderFloorOf({ type: 'op', name: '*', args: [cumClose, { type: 'num', value: 2 }] }, bars, 1)
    // totals 1, -2, 0, 5: running max |total| 1, 2, 2, 5; the window starts at bar 1
    expect(out).toEqual([2, 2, 5].map((m) => FLOAT_ORDER_ULPS * Number.EPSILON * m))
  })
})

describe('per-bar withholding is graded "not compared"', () => {
  const vendor = [1, 2, 3, 4]
  const ours = [NaN, 2, 3, 4]
  it('a withheld bar where TradingView draws a value: INCONCLUSIVE with the count, never DIVERGE', () => {
    expect(verdictOf(comparePlot({ times: times(4), vendor, ours, tol: TOL }))).toBe('DIVERGE')
    const r = comparePlot({ times: times(4), vendor, ours, tol: TOL, withheldBars: [1, 0, 0, 0] })
    expect(r.withheldBars).toBe(1)
    expect(r.withheldVendorValued).toBe(1)
    const v = plotVerdict(r, { colorMeasured: false, colorResolvable: false })
    expect(v.verdict).toBe('INCONCLUSIVE')
    expect(v.reason).toMatch(/1 bar\(s\) where TradingView draws a value are withheld by name/)
  })
  it('a withheld bar where TradingView draws nothing: the rest is graded as usual', () => {
    const r = comparePlot({ times: times(4), vendor: [null, 2, 3, 4], ours, tol: TOL, withheldBars: [1, 0, 0, 0] })
    expect(verdictOf(r)).toBe('MATCH')
  })
  it('a withheld bar inside the warm-up region weighs on nothing, as a warm-up divergence does not', () => {
    const r = comparePlot({ times: times(4), vendor, ours, tol: TOL, withheldBars: [1, 0, 0, 0], warmupBars: 1 })
    expect(r.withheldWarmupVendorValued).toBe(1)
    expect(r.withheldVendorValued).toBe(0)
    expect(verdictOf(r)).toBe('MATCH')
  })
  it('a wrong value on a bar that is NOT withheld still DIVERGES', () => {
    const r = comparePlot({ times: times(4), vendor, ours: [NaN, 2, 9, 4], tol: TOL, withheldBars: [1, 0, 0, 0] })
    expect(verdictOf(r)).toBe('DIVERGE')
  })
  it('withheldBarsOf: the union of the codes\' masks, sliced to the window', () => {
    const report = { p0: { 'pine:a': Float64Array.from([1, 0, 0, 1, 0]), 'pine:b': Float64Array.from([0, 0, 1, 0, 0]) } }
    expect(withheldBarsOf(report, 'p0', 1)).toEqual({ bars: [0, 1, 1, 0], codes: ['pine:a', 'pine:b'] })
    expect(withheldBarsOf(report, 'p1', 0)).toBeNull()
    expect(withheldBarsOf({ p0: { 'pine:a': Float64Array.from([1, 0]) } }, 'p0', 1)).toBeNull()
  })
})
