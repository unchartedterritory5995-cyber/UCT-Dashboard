// COT: NO MACHINE CONSUMER SEES A REPORT BEFORE CFTC PUBLISHED IT.
//
// ⭐ ONE DOOR, SO ONE PROOF. Every engine consumer of a `sym:` source — the plotted
// series, a moving average over it, a member formula or condition, the alert seam —
// resolves it through `projectionFor` (exact-`t` join, NO forward fill) and then
// `registry.computeFor`. The server serves each report from its PUBLIC day
// (`api/services/market_indicators/cot_release.py`, railed by
// `tests/test_market_indicators_cot_release.py`); these cases prove the client adds no
// lookahead on top: a Tuesday–Thursday bar reads the PREVIOUS report, Friday the new one.

import { describe, it, expect } from 'vitest'
import { projectionFor } from '../engine/symbolProjection'
import * as registry from '../engine/nativeRegistry'

// The chart's own daily bars, Mon 2026-08-31 .. Fri 2026-09-11 (Labor Day 09-07 absent).
const DAYS = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
  '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']
const chart = DAYS.map((t, i) => ({ t, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1000 }))

// EXACTLY what `/api/bars/COT:NQ:COMM` now serves for reports as-of Tue 08-25 (-62,340,
// public Fri 08-28), Tue 09-01 (-57,000, public Fri 09-04) and Tue 09-08 (3,400, public
// Fri 09-11): carried weekday bars starting on each PUBLIC day.
const flat = (t, v) => ({ t, o: v, h: v, l: v, c: v, v: 0 })
const served = [
  ...['2026-08-28', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03'].map((t) => flat(t, -62340)),
  ...['2026-09-04', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'].map((t) => flat(t, -57000)),
  flat('2026-09-11', 3400),
]

const byDay = (col) => Object.fromEntries(DAYS.map((t, i) => [t, col[i]]))

describe('COT through the engine — no pre-publication value', () => {
  const col = projectionFor(served, 'close', chart)
  const seen = byDay(col)

  it('the as-of Tuesday and the Wednesday/Thursday after it still read the PREVIOUS report', () => {
    expect(seen['2026-09-01']).toBe(-62340)   // report B's own as-of Tuesday
    expect(seen['2026-09-02']).toBe(-62340)
    expect(seen['2026-09-03']).toBe(-62340)
    expect(seen['2026-09-08']).toBe(-57000)   // report C's as-of Tuesday
    expect(seen['2026-09-10']).toBe(-57000)
  })

  it('the Friday it was published is the first bar that knows it', () => {
    expect(seen['2026-09-04']).toBe(-57000)
    expect(seen['2026-09-11']).toBe(3400)
  })

  it('the plotted series (dataSeries) computes exactly the projected column', () => {
    const def = registry.getDefinition('dataSeries')
    const out = registry.computeFor(def, chart, { source: 'sym:COT:NQ:COMM:close' }, { source: col })
    const vals = byDay(Array.from(out.value, (p) => (p && typeof p === 'object' ? p.value : p)))
    expect(vals['2026-09-03']).toBe(-62340)
    expect(vals['2026-09-04']).toBe(-57000)
  })

  it('a derived calculation over it (a moving average — the formula / condition / alert lane) cannot see ahead', () => {
    const def = registry.getDefinition('movingAverage')
    const out = registry.computeFor(def, chart, { period: 1, maType: 'sma' }, { source: col })
    const vals = byDay(Array.from(out.ma, (p) => (p && typeof p === 'object' ? p.value : p)))
    // Period 1 is the identity: any value on a bar before its report was public would
    // show up here as that report's number.
    expect(vals['2026-09-10']).toBe(-57000)
    expect(vals['2026-09-11']).toBe(3400)
  })

  it('there is no forward fill of its own: a day the server does not serve is empty', () => {
    const gappy = served.filter((b) => b.t !== '2026-09-09')
    const c2 = byDay(projectionFor(gappy, 'close', chart))
    expect(Number.isFinite(c2['2026-09-09'])).toBe(false)
  })
})
