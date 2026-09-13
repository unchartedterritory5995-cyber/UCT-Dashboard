// app/src/pages/breadth/chartMagnitude.test.js
//
// A-04: a hand-typed MAX_ABS table in a test was the only magnitude guard, it had
// drifted (Breadth Thrust's ratio axis spans 23x on today's data), and it never ran
// for a member's own selection. The rule now runs on the rows on screen (D-029).
import { describe, it, expect } from 'vitest'
import { MAGNITUDE_LIMIT, magnitudeGaps, describeGap } from './chartMagnitude'

const rows = (series) => Array.from({ length: 5 }, (_, i) =>
  Object.fromEntries(Object.entries(series).map(([k, peak]) => [k, i === 2 ? peak : peak / 2])))

describe('magnitudeGaps', () => {
  it('flags the smaller series when two on one axis differ by more than the limit', () => {
    const gaps = magnitudeGaps(['universe_count', 'new_52w_lows'], rows({ universe_count: 3000, new_52w_lows: 10 }),
      { universe_count: 0, new_52w_lows: 0 })
    expect(gaps).toEqual([{ axis: 0, small: 'new_52w_lows', large: 'universe_count', ratio: 300 }])
  })

  // The two round-one defects, as fixtures rather than as a table.
  it('would have caught QQQ beside the S&P and ATR extension beside monthly movers', () => {
    expect(magnitudeGaps(['sp500_close', 'qqq_close'], rows({ sp500_close: 7737, qqq_close: 746 }),
      { sp500_close: 1, qqq_close: 1 })).toHaveLength(1)
    expect(magnitudeGaps(['up_25pct_month', 'atr_ext_7'], rows({ up_25pct_month: 385, atr_ext_7: 34 }),
      { up_25pct_month: 0, atr_ext_7: 0 })).toHaveLength(1)
  })

  // CONTROL: froth's closest pair (4.8x) and series on different axes are not gaps.
  it('leaves series within the limit, or on different axes, alone', () => {
    expect(magnitudeGaps(['hvc_52w', 'atr_ext_7'], rows({ hvc_52w: 163, atr_ext_7: 34 }),
      { hvc_52w: 0, atr_ext_7: 0 })).toEqual([])
    expect(magnitudeGaps(['universe_count', 'ratio_5day'], rows({ universe_count: 3000, ratio_5day: 2 }),
      { universe_count: 0, ratio_5day: 1 })).toEqual([])
  })

  it('ignores a series with nothing numeric in the window', () => {
    expect(magnitudeGaps(['universe_count', 'new_52w_lows'], rows({ universe_count: 3000 }),
      { universe_count: 0, new_52w_lows: 0 })).toEqual([])
    expect(MAGNITUDE_LIMIT).toBe(6)
  })
})

describe('describeGap', () => {
  const label = k => ({ new_52w_lows: '52W Lows (Close)', universe_count: 'Universe Count' }[k])
  it('says which series is flattened, by how much, on this axis', () => {
    expect(describeGap({ axis: 0, small: 'new_52w_lows', large: 'universe_count', ratio: 300 }, label))
      .toBe('52W Lows (Close) is 300× smaller than Universe Count on this axis.')
    expect(describeGap({ axis: 0, small: 'new_52w_lows', large: 'universe_count', ratio: 7.25 }, label))
      .toBe('52W Lows (Close) is 7.3× smaller than Universe Count on this axis.')
  })
})
