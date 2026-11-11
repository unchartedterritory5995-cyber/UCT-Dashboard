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
  // Speed pass 2026-11-09: a panel with no ready signal must not hold its slot for the safety timer.
  it('a per-id timeout frees that slot on its own schedule; everyone else keeps the default', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useStaggeredMount(ids(6), {
      limit: 3, slotTimeoutMs: 5000, slotTimeoutFor: (id) => (id === 'c0' ? 300 : undefined),
    }))
    expect(result.current.mountedIds.size).toBe(3)
    act(() => { vi.advanceTimersByTime(299) })
    expect(result.current.mountedIds.size).toBe(3)
    act(() => { vi.advanceTimersByTime(2) })
    expect(result.current.mountedIds.has('c3')).toBe(true)
    expect(result.current.mountedIds.size).toBe(4)   // c1, c2 still hold theirs
    act(() => { vi.advanceTimersByTime(4801) })
    expect(result.current.mountedIds.size).toBe(6)
  })

  it('a per-id timeout commits once per admission, however the releases land', () => {
    vi.useFakeTimers()
    let commits = 0
    const { result } = renderHook(() => {
      commits += 1
      return useStaggeredMount(ids(9), { limit: 3, slotTimeoutMs: 5000, slotTimeoutFor: () => 300 })
    })
    const seeded = commits
    act(() => { vi.advanceTimersByTime(3000) })
    expect(result.current.mountedIds.size).toBe(9)
    expect(commits - seeded).toBeLessThanOrEqual(6)   // six admissions, never a loop
  })
  // Review round: a chart reports ready as soon as IndexedDB answers, with its network fetches
  // still pending, so on a warm browser release alone would admit a whole board within milliseconds.
  it('12 panels ready at once are admitted no faster than the minimum interval', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useStaggeredMount(ids(12), { limit: 3, slotTimeoutMs: 5000, minAdmitIntervalMs: 300 }))
    const releaseAll = () => act(() => { for (const id of result.current.mountedIds) result.current.release(id) })
    expect(result.current.mountedIds.size).toBe(3)
    releaseAll()
    expect(result.current.mountedIds.size).toBe(3)            // ready at once admits nobody yet
    for (let admitted = 4; admitted <= 12; admitted += 1) {
      act(() => { vi.advanceTimersByTime(299) })
      expect(result.current.mountedIds.size).toBe(admitted - 1)
      act(() => { vi.advanceTimersByTime(1) })
      expect(result.current.mountedIds.size).toBe(admitted)
      releaseAll()
    }
  })

  it('the 5 s timer stays the backstop under a minimum interval', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useStaggeredMount(ids(4), { limit: 3, slotTimeoutMs: 5000, minAdmitIntervalMs: 300 }))
    act(() => { vi.advanceTimersByTime(4999) })
    expect(result.current.mountedIds.size).toBe(3)            // nobody released, so nobody admitted
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.mountedIds.size).toBe(4)
  })

  it('CONTROL: with no minimum interval a release admits at once', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useStaggeredMount(ids(4), { limit: 3, slotTimeoutMs: 5000 }))
    act(() => result.current.release('c0'))
    expect(result.current.mountedIds.size).toBe(4)
  })
})
