import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useStaggeredMount from './useStaggeredMount'

const ids = (n) => Array.from({ length: n }, (_, i) => `c${i}`)

afterEach(() => vi.useRealTimers())

describe('useStaggeredMount', () => {
  it('seeds only `limit` ids, admits the next on release', () => {
    const { result } = renderHook(() => useStaggeredMount(ids(9), { limit: 3, slotTimeoutMs: 0 }))
    expect([...result.current.mountedIds]).toEqual(['c0', 'c1', 'c2'])
    act(() => result.current.release('c0'))
    expect(result.current.mountedIds.has('c3')).toBe(true)
    expect(result.current.mountedIds.has('c0')).toBe(true)   // never unmounts
    expect(result.current.mountedIds.size).toBe(4)
  })

  it('drains fully as releases arrive; double-release is a no-op', () => {
    const { result } = renderHook(() => useStaggeredMount(ids(5), { limit: 2, slotTimeoutMs: 0 }))
    act(() => {
      result.current.release('c0')
      result.current.release('c0')   // no-op
      result.current.release('c1')
      result.current.release('c2')
      result.current.release('c3')
      result.current.release('c4')
    })
    expect(result.current.mountedIds.size).toBe(5)
  })

  it('safety timer releases a stuck slot', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useStaggeredMount(ids(6), { limit: 3, slotTimeoutMs: 5000 }))
    expect(result.current.mountedIds.size).toBe(3)
    act(() => { vi.advanceTimersByTime(5001) })
    expect(result.current.mountedIds.size).toBe(6)
  })

  it('layout switch queues new ids and purges removed ones without evicting survivors', () => {
    const { result, rerender } = renderHook(
      ({ list }) => useStaggeredMount(list, { limit: 3, slotTimeoutMs: 0 }),
      { initialProps: { list: ids(4) } }
    )
    act(() => { result.current.release('c0'); result.current.release('c1'); result.current.release('c2'); result.current.release('c3') })
    expect(result.current.mountedIds.size).toBe(4)
    // 4 -> 9: survivors stay, new ids queue through free slots
    rerender({ list: ids(9) })
    expect(result.current.mountedIds.has('c0')).toBe(true)
    expect(result.current.mountedIds.size).toBeGreaterThanOrEqual(7)  // 4 + up to `limit` admitted
    // 9 -> 2: removed ids purged
    rerender({ list: ids(2) })
    expect(result.current.mountedIds.has('c7')).toBe(false)
    expect(result.current.mountedIds.has('c0')).toBe(true)
  })
})
