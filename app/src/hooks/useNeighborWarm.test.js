import { renderHook } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../utils/prefetchBars', () => ({
  warmMemFromIDB: vi.fn(),
  prefetchBarsToIDB: vi.fn(),
  prefetchBars: vi.fn(),
}))
vi.mock('./livePriceStore', () => ({ registerTickers: vi.fn(() => vi.fn()) }))

import { warmMemFromIDB, prefetchBarsToIDB, prefetchBars } from '../utils/prefetchBars'
import { registerTickers } from './livePriceStore'
import { useNeighborWarm } from './useNeighborWarm'

const LIST = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

describe('useNeighborWarm', () => {
  beforeEach(() => {
    warmMemFromIDB.mockClear()
    prefetchBarsToIDB.mockClear()
    prefetchBars.mockClear()
    registerTickers.mockClear()
  })

  it('pre-registers the WHOLE list\'s live prices (once, for the developing bar)', () => {
    renderHook(() => useNeighborWarm(LIST, 'D', 'D', { radius: 2 }))
    // keyed on the list, not the selection → the entire list (bounded), not just ±radius
    expect(registerTickers).toHaveBeenCalledTimes(1)
    expect([...registerTickers.mock.calls[0][0]].sort()).toEqual([...LIST].sort())
  })

  it('warms the ±radius neighbors (wrap-aware, self excluded) into sync-mem AND IDB', () => {
    renderHook(() => useNeighborWarm(LIST, 'D', '5', { radius: 2 }))
    // 'D' is index 3 → ±2 neighbors = B, C, E, F (D itself excluded)
    expect(warmMemFromIDB).toHaveBeenCalledTimes(1)
    expect([...warmMemFromIDB.mock.calls[0][0]].sort()).toEqual(['B', 'C', 'E', 'F'])
    expect(warmMemFromIDB.mock.calls[0][1]).toEqual(['5']) // current tf only

    expect(prefetchBarsToIDB).toHaveBeenCalledTimes(1)
    expect([...prefetchBarsToIDB.mock.calls[0][0]].sort()).toEqual(['B', 'C', 'E', 'F'])
    expect(prefetchBarsToIDB.mock.calls[0][1]).toBe('5')
    expect(prefetchBarsToIDB.mock.calls[0][2]).toEqual({ priority: true })
  })

  it('warms the row on either side URGENTLY: not held behind the daily pack ingest', () => {
    renderHook(() => useNeighborWarm(LIST, 'D', '5', { radius: 2 }))
    expect(prefetchBars).toHaveBeenCalledTimes(1)
    expect([...prefetchBars.mock.calls[0][0]].sort()).toEqual(['C', 'E'])
    expect(prefetchBars.mock.calls[0][1]).toBe('5')
    expect(prefetchBars.mock.calls[0][2]).toEqual({ urgent: true })
  })

  it('pins the neighbors in the store while they are neighbors, and lets them go on unmount', () => {
    const sets = []
    let cleared = 0
    globalThis.__uctStoreWarmers = { warmMemFromIDB, prefetchBarsToIDB, prefetchBars,
      createNeighborHold: () => ({ set: (syms, tf, opts) => sets.push([[...syms].sort(), tf, [...(opts?.deep || [])].sort()]), clear: () => { cleared++ } }) }
    try {
      const { unmount } = renderHook(() => useNeighborWarm(LIST, 'D', '5', { radius: 2 }))
      // held: the ±2 rows; deepened once the member rests: the row on either side
      expect(sets).toEqual([[['B', 'C', 'E', 'F'], '5', ['C', 'E']]])
      unmount()
      expect(cleared).toBe(1)
    } finally {
      delete globalThis.__uctStoreWarmers
    }
  })

  it('wraps around the ends of the list', () => {
    renderHook(() => useNeighborWarm(LIST, 'A', 'D', { radius: 2 }))
    // 'A' index 0 → forward B, C; backward wraps to H, G
    expect([...warmMemFromIDB.mock.calls[0][0]].sort()).toEqual(['B', 'C', 'G', 'H'])
  })

  it('no-ops on an empty/singleton list or a selection not in the list', () => {
    renderHook(() => useNeighborWarm([], 'A', 'D'))
    renderHook(() => useNeighborWarm(['X'], 'X', 'D'))
    renderHook(() => useNeighborWarm(LIST, 'ZZZ', 'D'))
    expect(warmMemFromIDB).not.toHaveBeenCalled()
    expect(prefetchBarsToIDB).not.toHaveBeenCalled()
  })

  it('defaults the timeframe to D when none is given', () => {
    renderHook(() => useNeighborWarm(LIST, 'D', undefined, { radius: 1 }))
    expect(warmMemFromIDB.mock.calls[0][1]).toEqual(['D'])
    expect(prefetchBarsToIDB.mock.calls[0][1]).toBe('D')
  })
})
