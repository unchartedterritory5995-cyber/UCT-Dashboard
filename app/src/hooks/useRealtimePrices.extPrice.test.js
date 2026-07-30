import { describe, it, expect } from 'vitest'
import { _applyLiveExtPrice } from './useRealtimePrices'

// The chart's orange "Pre"/"Post" axis chip reads `ext_price`, which only the 15s REST
// snapshot produced — so pre-market it lagged the watchlist's Price cell (same Massive
// feed, ~1s) and the two showed different numbers for the same instant. This helper
// promotes a STREAMED price into ext_price, and the safety rule is narrow on purpose:
//
//   REST `price` falls back through `day.c || lastTrade.p || prevDay.c`. Post-market,
//   `day.c` IS the 4pm regular-session close. Promoting that would paint the closing
//   price as the live post-market print — a wrong number, confidently displayed.
//
// So: only a value that actually came from the stream, and only while REST says we are
// in an extended session.

const run = (rest, streamed) => {
  const merged = { ...rest, ...streamed }
  _applyLiveExtPrice(merged, rest, streamed)
  return merged
}

describe('_applyLiveExtPrice', () => {
  it('freshens ext_price from the streamed price during pre-market', () => {
    const m = run({ ext_session: 'pre', ext_price: 100.0, price: 100.0 }, { price: 101.25 })
    expect(m.ext_price).toBe(101.25)
  })

  it('freshens ext_price during post-market too', () => {
    const m = run({ ext_session: 'post', ext_price: 50, price: 49 }, { price: 50.75 })
    expect(m.ext_price).toBe(50.75)
  })

  it('does NOT touch ext_price during regular hours (ext_session null)', () => {
    const m = run({ ext_session: null, ext_price: 100, price: 100 }, { price: 105 })
    expect(m.ext_price).toBe(100)
  })

  it('does NOT promote when there is no streamed price — REST `price` post-market is the RTH close', () => {
    const m = run({ ext_session: 'post', ext_price: 99.5, price: 100.0 /* = day.c, the 4pm close */ }, undefined)
    expect(m.ext_price).toBe(99.5)
    const m2 = run({ ext_session: 'post', ext_price: 99.5, price: 100.0 }, {})
    expect(m2.ext_price).toBe(99.5)
  })

  it('ignores a non-positive or non-numeric streamed price rather than blanking the chip', () => {
    for (const px of [0, -1, null, undefined, NaN, 'x']) {
      expect(run({ ext_session: 'pre', ext_price: 88 }, { price: px }).ext_price).toBe(88)
    }
  })

  it('is a no-op with no REST entry at all (nothing says we are in an extended session)', () => {
    const merged = { price: 10 }
    _applyLiveExtPrice(merged, null, { price: 10 })
    expect(merged.ext_price).toBeUndefined()
  })

  it('can set ext_price even when REST had none yet, once the session is known', () => {
    const m = run({ ext_session: 'pre' }, { price: 12.5 })
    expect(m.ext_price).toBe(12.5)
  })
})
