import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock the network + durable layers so the test observes ONLY the list-warm logic
// (which timeframes/tickers get queued), not real fetches or IndexedDB.
const preloadMock = vi.fn()
vi.mock('swr', () => ({ preload: (...a) => preloadMock(...a) }))
vi.mock('./barsIDB', () => ({
  idbGet: vi.fn(async () => undefined),   // cold IDB → every warm falls through to a fetch
  idbPut: vi.fn(async () => {}),
  mergeDelta: (a, b) => b,
}))
vi.mock('../hooks/useTickerMeta', () => ({ prefetchTickerMeta: vi.fn() }))

import { prewarmVisibleList, listPrewarmDisabled, _noteWarmResult } from './prefetchBars'
import { memClear } from './barsMemCache'

const urlsFor = (sym) => preloadMock.mock.calls.map(c => c[0]).filter(u => u.includes(`/api/bars/${sym}`))

describe('prewarmVisibleList — warm a whole list the moment it opens', () => {
  beforeEach(() => {
    memClear()
    preloadMock.mockReset()
    preloadMock.mockResolvedValue({ bars: [{ t: 1, o: 1, h: 2, l: 0, c: 1, v: 9 }] })
    try {
      localStorage.clear()
      localStorage.setItem('barspack.version', '2026-09-01') // pack ingested → warms allowed
    } catch { /* ignore */ }
    _noteWarmResult({ bars: [{ t: 1 }] }) // clear any 503 backoff from a prior test
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('is a no-op on empty / nullish input (never throws)', () => {
    expect(() => prewarmVisibleList([])).not.toThrow()
    expect(() => prewarmVisibleList(undefined)).not.toThrow()
  })

  it('warms every ticker in the list into durable IDB, across multiple timeframes', async () => {
    prewarmVisibleList(['PWVLA', 'PWVLB'], { chartTf: 'D' })
    await vi.advanceTimersByTimeAsync(3000)
    // Both names warmed…
    expect(urlsFor('PWVLA').length).toBeGreaterThan(0)
    expect(urlsFor('PWVLB').length).toBeGreaterThan(0)
    // …and across more than just daily (the shared list-warm covers 5/60/30/15 too).
    const tfs = new Set(urlsFor('PWVLA').map(u => new URL(u, 'http://x').searchParams.get('tf')))
    expect(tfs.has('D')).toBe(true)
    expect(tfs.size).toBeGreaterThan(1)
  })

  it('the localStorage kill-switch disables it entirely', async () => {
    expect(listPrewarmDisabled()).toBe(false)
    localStorage.setItem('uct.listprewarm.off', '1')
    expect(listPrewarmDisabled()).toBe(true)
    prewarmVisibleList(['PWVLC', 'PWVLD'])
    await vi.advanceTimersByTimeAsync(3000)
    expect(urlsFor('PWVLC').length).toBe(0)
    expect(urlsFor('PWVLD').length).toBe(0)
  })

  it('caps a pathologically huge list so it cannot flood the queue', async () => {
    const huge = Array.from({ length: 900 }, (_, i) => `BIG${i}`)
    prewarmVisibleList(huge, { cap: 500 })
    await vi.advanceTimersByTimeAsync(3000)
    // The last names beyond the cap are never queued.
    expect(urlsFor('BIG899').length).toBe(0)
    // …but the head of the list (what the user reaches first) is warmed.
    expect(urlsFor('BIG0').length).toBeGreaterThan(0)
  })
})
