// Phase 5 split-fetch flag (instant-charts edge caching). The gate that decides whether a
// D/W/M chart pulls its deep history from the edge-cacheable /api/bars-history endpoint.
// Mirrors the proven bars-push rollout idiom: explicit localStorage wins, else staged %.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  _barsHistorySplitEnabled,
  setBarsHistorySplitEnabled,
  BARS_HISTORY_SPLIT_ROLLOUT_PCT,
} from './StockChart.jsx'

describe('bars-history split-fetch flag', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults OFF (rollout pct is 0 = byte-identical to the pre-Phase-5 path)', () => {
    expect(BARS_HISTORY_SPLIT_ROLLOUT_PCT).toBe(0)
    // Force the bucket below any conceivable rollout so ONLY the pct gates it.
    localStorage.setItem('uct.barsHistory.bucket', '0')
    expect(_barsHistorySplitEnabled()).toBe(false)
  })

  it('explicit localStorage "1" force-enables (canary opt-in)', () => {
    localStorage.setItem('uct.barsHistory.enabled', '1')
    expect(_barsHistorySplitEnabled()).toBe(true)
  })

  it('explicit localStorage "0" force-disables even inside the rollout', () => {
    localStorage.setItem('uct.barsHistory.bucket', '0')   // would be in-rollout if pct were high
    localStorage.setItem('uct.barsHistory.enabled', '0')
    expect(_barsHistorySplitEnabled()).toBe(false)
  })

  it('setBarsHistorySplitEnabled(true/false) sets/clears the flag and dispatches the change event', () => {
    const spy = vi.fn()
    window.addEventListener('uct-barshistory-change', spy)
    setBarsHistorySplitEnabled(true)
    expect(localStorage.getItem('uct.barsHistory.enabled')).toBe('1')
    expect(_barsHistorySplitEnabled()).toBe(true)
    setBarsHistorySplitEnabled(false)
    expect(localStorage.getItem('uct.barsHistory.enabled')).toBe(null)
    expect(spy).toHaveBeenCalledTimes(2)
    window.removeEventListener('uct-barshistory-change', spy)
  })

  it('exposes the DevTools canary toggle on window', () => {
    expect(typeof window.__uctBarsHistory).toBe('function')
  })
})
