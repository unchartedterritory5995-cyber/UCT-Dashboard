import { describe, it, expect, beforeEach } from 'vitest'
import { _barsPushEnabled, BARS_PUSH_ROLLOUT_PCT } from './StockChart'

// The Phase C single-writer arbitration ships DARK: barsPushActive =
// _barsPushEnabled() && eligible && liveUpdates && delivering. With the gate OFF
// (default), barsPushActive is strictly false, so all four writer guards
// (`if (barsPushActiveRef.current) return`) are no-ops and the chart behaves
// EXACTLY as before — even though VITE_REALTIME_BARS is already '1' in prod and
// the backend may be streaming. This test pins the default-off invariant.
describe('_barsPushEnabled — Phase C single-writer gate (default OFF)', () => {
  beforeEach(() => { try { localStorage.removeItem('uct.barsPush.enabled') } catch { /* ignore */ } })

  it('is FALSE by default — push never engages until explicitly opted in', () => {
    expect(_barsPushEnabled()).toBe(false)
  })

  it('engages for explicit opt-in "1"; explicit "0" is a hard per-browser revert', () => {
    localStorage.setItem('uct.barsPush.enabled', '1')
    expect(_barsPushEnabled()).toBe(true)
    localStorage.setItem('uct.barsPush.enabled', '0')
    expect(_barsPushEnabled()).toBe(false)   // opt-out beats any rollout %
  })

  it('SHIPS DARK: the widen dial is 0, so default (no opt-in) is off even with a bucket assigned', () => {
    expect(BARS_PUSH_ROLLOUT_PCT).toBe(0)          // guard: widening is a deliberate bump
    localStorage.setItem('uct.barsPush.bucket', '5')  // a low bucket would be IN once the dial ramps
    expect(_barsPushEnabled()).toBe(false)         // ...but at 0% it's still off
  })

  it('the per-browser rollout bucket is assigned once and stable (no push↔Finnhub flapping)', () => {
    _barsPushEnabled()
    const b1 = localStorage.getItem('uct.barsPush.bucket')
    expect(b1).not.toBeNull()
    _barsPushEnabled()
    expect(localStorage.getItem('uct.barsPush.bucket')).toBe(b1)   // unchanged across calls
  })
})
