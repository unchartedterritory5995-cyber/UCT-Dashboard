import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock the network + durable layers so the test observes ONLY the intent logic.
const preloadMock = vi.fn()
vi.mock('swr', () => ({ preload: (...a) => preloadMock(...a) }))
vi.mock('./barsIDB', () => ({ idbGet: vi.fn(async () => undefined), idbPut: vi.fn(async () => {}) }))
vi.mock('../hooks/useTickerMeta', () => ({ prefetchTickerMeta: vi.fn() }))

import { prefetchBarOnIntent } from './prefetchBars'
import { memHas, memPut, memClear, memGet } from './barsMemCache'

describe('prefetchBarOnIntent', () => {
  beforeEach(() => {
    memClear()
    preloadMock.mockReset()
    preloadMock.mockResolvedValue({ bars: [{ t: 1, o: 1, h: 2, l: 0, c: 1, v: 9 }] })
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('is a no-op when the (sym, tf) is already warm in memcache', () => {
    memPut('AAPL', 'D', [{ t: 1, o: 1, h: 2, l: 0, c: 1, v: 9 }])
    prefetchBarOnIntent('AAPL', 'D')
    vi.advanceTimersByTime(500)
    expect(preloadMock).not.toHaveBeenCalled()
  })

  it('debounces rapid repeated intents into a single fetch', () => {
    for (let i = 0; i < 6; i++) prefetchBarOnIntent('NVDA', 'D')
    vi.advanceTimersByTime(120)
    expect(preloadMock).toHaveBeenCalledTimes(1)
  })

  it('warms the synchronous memcache on a successful fetch', async () => {
    prefetchBarOnIntent('TSLA', '30')
    // advanceTimersByTimeAsync fires the debounce timer AND flushes the awaited
    // microtasks inside _warmIntentNow (preload → memPut), so the cache is warm.
    await vi.advanceTimersByTimeAsync(120)
    expect(memHas('TSLA', '30')).toBe(true)
    expect(memGet('TSLA', '30')?.length).toBe(1)
  })
})
