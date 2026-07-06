import { describe, it, expect, beforeEach } from 'vitest'
import { _barsPushEnabled } from './StockChart'

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

  it('engages ONLY for exactly "1" (the canary opt-in)', () => {
    localStorage.setItem('uct.barsPush.enabled', '1')
    expect(_barsPushEnabled()).toBe(true)
    localStorage.setItem('uct.barsPush.enabled', '0')
    expect(_barsPushEnabled()).toBe(false)
    localStorage.setItem('uct.barsPush.enabled', 'true')
    expect(_barsPushEnabled()).toBe(false)
  })
})
