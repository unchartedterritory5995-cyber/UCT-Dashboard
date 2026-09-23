import { describe, it, expect } from 'vitest'
import {
  FIRST_PAINT_BARS, FIRST_PAINT_MAX, RTH_VISIBLE_FRACTION,
  firstPaintBarsFor, firstPaintVisibleFor,
  fullBarsFor, shouldBackfill, nextBackfillDepth,
} from './barsBackfill'

describe('nextBackfillDepth (progressive deep-pan)', () => {
  it('first step from the 600 shallow window lands a fast intermediate chunk', () => {
    // 600*8=4800 >= 600+4000=4600 -> 4800. Fast (~5s) vs the full 20000 (~20s).
    expect(nextBackfillDepth(600, 20000)).toBe(4800)
  })

  it('second pan reaches (and caps at) the full target', () => {
    // 4800*8 = 38400, capped to 20000.
    expect(nextBackfillDepth(4800, 20000)).toBe(20000)
  })

  it('small targets (W/M) reach full in one step — no visible progression', () => {
    expect(nextBackfillDepth(600, 4000)).toBe(4000)   // 600->4000 directly
    expect(nextBackfillDepth(600, 1200)).toBe(1200)
  })

  it('never exceeds the target and is idempotent at/above it', () => {
    expect(nextBackfillDepth(20000, 20000)).toBe(20000)
    expect(nextBackfillDepth(25000, 20000)).toBe(20000)
  })

  it('degenerate inputs fall back to the full target', () => {
    expect(nextBackfillDepth(0, 20000)).toBe(20000)
    expect(nextBackfillDepth(600, 0)).toBe(0)
  })

  it('reaches full for the deepest intraday targets within a few steps', () => {
    // 5m target 26000: 600 -> 4800 -> 26000 (4800*8=38400 capped).
    let d = 600, steps = 0
    while (d < 26000 && steps < 10) { d = nextBackfillDepth(d, 26000); steps++ }
    expect(d).toBe(26000)
    expect(steps).toBeLessThanOrEqual(3)
  })
})

describe('barsBackfill', () => {
  it('FIRST_PAINT_BARS is a small shallow window', () => {
    expect(FIRST_PAINT_BARS).toBe(600)
  })

  it('fullBarsFor: deep per-timeframe history targets', () => {
    // Daily reaches ~50yr (matches deep_history_warm _DEEP_TARGET['D']);
    // W/M decades; intraday multi-year.
    expect(fullBarsFor('D')).toBe(12500)
    expect(fullBarsFor('W')).toBe(4000)
    expect(fullBarsFor('M')).toBe(1200)
    expect(fullBarsFor('60')).toBe(32000)
    expect(fullBarsFor('30')).toBe(32000)
    expect(fullBarsFor('15')).toBe(30000)
    expect(fullBarsFor('5')).toBe(30000)
    expect(fullBarsFor('1')).toBe(20000)
    // Every target must exceed the shallow first-paint window and stay within
    // the API's 60000-bar ceiling.
    for (const tf of ['D', 'W', 'M', '1', '5', '15', '30', '60']) {
      expect(fullBarsFor(tf)).toBeGreaterThan(FIRST_PAINT_BARS)
      expect(fullBarsFor(tf)).toBeLessThanOrEqual(60000)
    }
  })

  const base = { fromIndex: 10, toIndex: 210, loadedCount: 600, fullTarget: 5000 }

  it('triggers when panned to the left edge while zoomed in', () => {
    expect(shouldBackfill(base)).toBe(true)
  })

  it('does NOT trigger on the initial full-series view (width ≈ loadedCount)', () => {
    expect(shouldBackfill({ ...base, fromIndex: 0, toIndex: 600 })).toBe(false)
  })

  it('does NOT trigger at the default right-edge view (left edge not in view)', () => {
    expect(shouldBackfill({ ...base, fromIndex: 400, toIndex: 600 })).toBe(false)
  })

  it('does NOT trigger once loaded depth has reached the full target', () => {
    expect(shouldBackfill({ ...base, loadedCount: 5000 })).toBe(false)
  })

  it('respects the edge threshold boundary', () => {
    expect(shouldBackfill({ ...base, fromIndex: 50, toIndex: 250 })).toBe(true)
    expect(shouldBackfill({ ...base, fromIndex: 51, toIndex: 251 })).toBe(false)
  })
})

describe('firstPaintBarsFor — the budget is in VISIBLE bars', () => {
  // RTH buckets per session, per timeframe. The whole point of the budget is that
  // THESE are the units a trader experiences, so the coverage assertions use them.
  const PER_SESSION = { 1: 390, 5: 78, 15: 26, 30: 13, 60: 7 }

  it('reaches the intended trading-day coverage on every intraday timeframe', () => {
    const sessions = (tf) => firstPaintVisibleFor(tf) / PER_SESSION[tf]
    expect(sessions('1')).toBeCloseTo(1, 1)
    expect(sessions('5')).toBeCloseTo(6, 1)
    expect(sessions('15')).toBeCloseTo(18, 1)
    expect(sessions('30')).toBeCloseTo(35, 1)
    expect(sessions('60')).toBeCloseTo(66, 1)
  })

  it('CONTROL — the OLD flat 600 missed those targets badly, so the test above is not vacuous', () => {
    // 600 fetched arrived as ~244 visible. Measured on AAPL in production
    // 2026-09-20: 234 / 242 / 247 / 246 on 5m / 15m / 30m / 60m.
    const oldVisible = Math.round(600 * RTH_VISIBLE_FRACTION)
    expect(oldVisible).toBeGreaterThan(230)
    expect(oldVisible).toBeLessThan(250)
    expect(oldVisible / PER_SESSION[60]).toBeLessThan(40)      // was ~35 sessions
    expect(firstPaintVisibleFor('60') / PER_SESSION[60]).toBeGreaterThan(60)
  })

  it('leaves real scroll-back behind the 200-bar default zoom', () => {
    // The defect: ~240 visible against a 200-bar zoom is ~40 bars of headroom.
    for (const tf of ['5', '15', '30', '60']) {
      expect(firstPaintVisibleFor(tf) - 200).toBeGreaterThan(200)
    }
  })

  it('stays UNDER the server deep-request threshold on every timeframe', () => {
    // bars_fetch._DEEP_REQUEST_THRESHOLD === 1200. At or above it the server takes
    // a heavier branch, so a first paint crossing this line silently changes which
    // server path a chart open uses.
    for (const tf of ['1', '5', '15', '30', '60', 'D', 'W', 'M']) {
      expect(firstPaintBarsFor(tf)).toBeLessThan(1200)
      expect(firstPaintBarsFor(tf, true)).toBeLessThan(1200)
    }
    expect(FIRST_PAINT_MAX).toBeLessThan(1200)
  })

  it('extended hours makes the request SMALLER, never larger — nothing is filtered', () => {
    for (const tf of ['1', '5', '15', '30', '60']) {
      expect(firstPaintBarsFor(tf, true)).toBeLessThanOrEqual(firstPaintBarsFor(tf, false))
    }
  })

  it('never returns less than the old floor, so no timeframe regresses', () => {
    for (const tf of ['1', '5', '15', '30', '60', 'D', 'W', 'M', '2', 'bogus']) {
      expect(firstPaintBarsFor(tf)).toBeGreaterThanOrEqual(FIRST_PAINT_BARS)
    }
  })

  it('D/W/M and custom codes keep the flat default — this budget is intraday-only', () => {
    for (const tf of ['D', 'W', 'M', '2', '45', undefined, null]) {
      expect(firstPaintBarsFor(tf)).toBe(FIRST_PAINT_BARS)
    }
  })

  it('the session fraction is derived from the clock, not typed', () => {
    expect(RTH_VISIBLE_FRACTION).toBeCloseTo(390 / 960, 6)
  })
})
