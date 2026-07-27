import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { publishChartReadout, getChartReadout, hasFreshReadouts, subscribeChartReadouts, _resetForTests } from './chartReadoutStore'

describe('chartReadoutStore', () => {
  beforeEach(() => { vi.useFakeTimers(); _resetForTests() })
  afterEach(() => { vi.useRealTimers() })

  it('returns a published readout, case-insensitively', () => {
    publishChartReadout('googl', { price: 324.1, volume: 400000, changePct: 1.31 })
    expect(getChartReadout('GOOGL')).toMatchObject({ price: 324.1, volume: 400000, changePct: 1.31 })
    expect(getChartReadout('googl')).toMatchObject({ price: 324.1 })
  })

  it('returns null for an unknown symbol', () => {
    expect(getChartReadout('ZZZZ')).toBeNull()
    expect(getChartReadout('')).toBeNull()
    expect(getChartReadout(null)).toBeNull()
  })

  it('goes stale once a chart stops publishing (unmounted / frozen)', () => {
    publishChartReadout('AAPL', { price: 100 })
    expect(getChartReadout('AAPL')).not.toBeNull()
    vi.advanceTimersByTime(6001)
    expect(getChartReadout('AAPL')).toBeNull()   // stale → watchlist reverts to its own feed
  })

  it('a fresh republish keeps it alive', () => {
    publishChartReadout('MSFT', { price: 380 })
    vi.advanceTimersByTime(4000)
    publishChartReadout('MSFT', { price: 381 })   // chart still ticking
    vi.advanceTimersByTime(4000)                  // 8s since first, 4s since last
    expect(getChartReadout('MSFT')).toMatchObject({ price: 381 })
  })

  it('hasFreshReadouts reflects staleness', () => {
    expect(hasFreshReadouts()).toBe(false)
    publishChartReadout('NVDA', { price: 5 })
    expect(hasFreshReadouts()).toBe(true)
    vi.advanceTimersByTime(6001)
    expect(hasFreshReadouts()).toBe(false)
  })

  it('notifies subscribers on publish and stops after unsubscribe', () => {
    const cb = vi.fn()
    const off = subscribeChartReadouts(cb)
    publishChartReadout('TSLA', { price: 300 })
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    publishChartReadout('TSLA', { price: 301 })
    expect(cb).toHaveBeenCalledTimes(1)   // no more after unsubscribe
  })

  it('a throwing subscriber never breaks publishing', () => {
    subscribeChartReadouts(() => { throw new Error('bad listener') })
    const ok = vi.fn()
    subscribeChartReadouts(ok)
    expect(() => publishChartReadout('AMD', { price: 1 })).not.toThrow()
    expect(ok).toHaveBeenCalled()
  })
})
