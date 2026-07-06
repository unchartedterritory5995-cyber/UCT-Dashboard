import { describe, it, expect, beforeEach } from 'vitest'
import { _barsPushEnabled, BARS_PUSH_ROLLOUT_PCT } from './StockChart'

// Phase C single-writer + widen gate. barsPushActive = _barsPushEnabled() && eligible
// && liveUpdates && delivering. _barsPushEnabled resolves: explicit localStorage
// '1'=opt-in / '0'=opt-out, else a STAGED percentage rollout (BARS_PUSH_ROLLOUT_PCT of
// browsers, by a stable per-browser bucket). These tests are PCT-aware so they hold at
// any point on the ramp (0→100), and deterministic (they set the bucket, never random).
describe('_barsPushEnabled — Phase C single-writer + widen gate', () => {
  beforeEach(() => {
    try {
      localStorage.removeItem('uct.barsPush.enabled')
      localStorage.removeItem('uct.barsPush.bucket')
    } catch { /* ignore */ }
  })

  it('explicit opt-in "1" engages; explicit "0" is a hard per-browser revert that beats the rollout', () => {
    localStorage.setItem('uct.barsPush.bucket', '0')   // would be IN at any PCT > 0
    localStorage.setItem('uct.barsPush.enabled', '1')
    expect(_barsPushEnabled()).toBe(true)
    localStorage.setItem('uct.barsPush.enabled', '0')
    expect(_barsPushEnabled()).toBe(false)             // opt-out wins over the rollout
  })

  it('rollout dial: a bucket BELOW the dial is IN, a bucket AT/ABOVE is OUT (strict <)', () => {
    const pct = BARS_PUSH_ROLLOUT_PCT
    if (pct > 0) {
      localStorage.setItem('uct.barsPush.bucket', String(pct - 1))
      expect(_barsPushEnabled()).toBe(true)
    }
    if (pct < 100) {
      localStorage.setItem('uct.barsPush.bucket', String(pct))
      expect(_barsPushEnabled()).toBe(false)
    }
  })

  it('a high-bucket browser stays OFF until the dial reaches it (staged rollout, no flip-all)', () => {
    localStorage.setItem('uct.barsPush.bucket', '99')
    expect(_barsPushEnabled()).toBe(BARS_PUSH_ROLLOUT_PCT > 99)  // false unless fully widened
  })

  it('the per-browser rollout bucket is assigned once and stable (no push↔Finnhub flapping)', () => {
    _barsPushEnabled()
    const b1 = localStorage.getItem('uct.barsPush.bucket')
    expect(b1).not.toBeNull()
    _barsPushEnabled()
    expect(localStorage.getItem('uct.barsPush.bucket')).toBe(b1)   // unchanged across calls
  })
})
