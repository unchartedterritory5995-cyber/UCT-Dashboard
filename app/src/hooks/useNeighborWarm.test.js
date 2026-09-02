import { renderHook } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../utils/prefetchBars', () => ({
  warmMemFromIDB: vi.fn(),
  prefetchBarsToIDB: vi.fn(),
}))

import { warmMemFromIDB, prefetchBarsToIDB } from '../utils/prefetchBars'
import { useNeighborWarm } from './useNeighborWarm'

const LIST = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

describe('useNeighborWarm', () => {
  beforeEach(() => {
    warmMemFromIDB.mockClear()
    prefetchBarsToIDB.mockClear()
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
