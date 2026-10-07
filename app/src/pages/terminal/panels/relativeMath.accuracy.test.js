// Accuracy audit 2026-10-06 (docs/terminal-research/15-accuracy/): RRG / CORR on REAL closes,
// against reference values computed independently in pandas (stored in the fixture beside the
// data they were computed from). Each case below is a regression for a defect the audit found.
import { describe, it, expect } from 'vitest'
import { closesFromBars, correlationMatrix, isoWeekFriday, rrgPath } from './relativeMath'
import fx from './__fixtures__/realCloses.json'

const daily = Object.fromEntries(Object.entries(fx.daily).map(([s, rows]) => [s, rows.map(([d, c]) => ({ d, c }))]))
const ref = fx.reference

describe('CORR on real closes', () => {
  it('matches the pandas correlation of daily returns, 3M window', () => {
    const m = correlationMatrix(daily, ['NVDA', 'AMD', 'SPY'], 63)
    expect(m.matrix[0][1].r).toBeCloseTo(ref.corr_3m.NVDA_AMD, 12)
    expect(m.matrix[0][2].r).toBeCloseTo(ref.corr_3m.NVDA_SPY, 12)
    expect(m.matrix[1][2].r).toBeCloseTo(ref.corr_3m.AMD_SPY, 12)
    expect(m.matrix[0][1].n).toBe(63)
  })

  it('a session one name did not trade never pairs a two-day return with a one-day one', () => {
    // AMD is missing 2026-08-14. The reference aligns the pair's closes first, so the return on
    // 08-17 spans 08-13 -> 08-17 for BOTH names. The old per-name returns read r = 0.3896, n = 62.
    const halted = { ...daily, AMD: daily.AMD.filter((p) => p.d !== '2026-08-14') }
    const cell = correlationMatrix(halted, ['NVDA', 'AMD'], 63).matrix[0][1]
    expect(cell.n).toBe(ref.corr_halt_NVDA_AMD.n)
    expect(cell.r).toBeCloseTo(ref.corr_halt_NVDA_AMD.r, 12)
  })
})

describe('weekly anchors', () => {
  it('keys a week by the Friday of its ISO week, whatever day the source stamped', () => {
    expect(isoWeekFriday('2026-09-28')).toBe('2026-10-02')   // Monday (index path)
    expect(isoWeekFriday('2026-10-02')).toBe('2026-10-02')   // Friday (equity store)
    expect(isoWeekFriday('2026-10-04')).toBe('2026-10-02')   // Sunday closes the same ISO week
    expect(isoWeekFriday('2027-01-01')).toBe('2027-01-01')   // across a year end
  })

  it('a Monday-keyed index (SPX) and a Friday-keyed ETF (SPY) share their weeks in a weekly RRG', () => {
    const spx = { bars: fx.weekly.SPX_index_monday_unix.map(([t, c]) => ({ t, c })) }
    const spy = { bars: fx.weekly.SPY_equity_friday.map(([t, c]) => ({ t, c })) }
    // the defect: without the weekly key the two series share no date at all
    expect(rrgPath(closesFromBars(spx), closesFromBars(spy))).toBeNull()
    const got = rrgPath(closesFromBars(spx, { weekly: true }), closesFromBars(spy, { weekly: true }))
    expect(got.asOf).toBe(ref.rrg_weekly_SPX_vs_SPY.asOf)
    expect(got.ratio).toBeCloseTo(ref.rrg_weekly_SPX_vs_SPY.ratio, 9)
    expect(got.momentum).toBeCloseTo(ref.rrg_weekly_SPX_vs_SPY.momentum, 9)
  })
})
