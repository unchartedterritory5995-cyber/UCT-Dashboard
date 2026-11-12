// useBarSnapshot: re-renders on the key's snapshot identity only; a key change returns the
// NEW key's snapshot in the same render (S7); unmount stops the key's I/O.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBarSnapshot } from './useBarSnapshot'
import { createBarStore } from './index'
import { keyOf } from './types'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'

afterEach(() => { vi.useRealTimers() })

function store() {
  const request = vi.fn(() => new Promise(() => {}))
  const io = { memPeekEntry: () => null, idbGet: async () => null, memPutMonotonic: () => null, idbPutMonotonic: async () => null }
  return { request, s: createBarStore({ request, io, stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {} }) }
}

describe('useBarSnapshot', () => {
  it('returns the subscribed key’s snapshot, never the previous key’s, and stops I/O on unmount', async () => {
    vi.useFakeTimers()
    const { s, request } = store()
    const A = keyOf({ sym: 'AAA', tf: '5' }), B = keyOf({ sym: 'BBB', tf: '5' })
    const { result, rerender, unmount } = renderHook(({ k }) => useBarSnapshot(k, { store: s }), { initialProps: { k: A } })
    expect(result.current.key).toBe(A)
    rerender({ k: B })
    expect(result.current.key).toBe(B)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(request).toHaveBeenCalled()
    act(() => { s.applyLive(B, { sym: 'BBB', tf: '5', t_s: 1762786800, bar: { t: 1762786800000, o: 1, h: 1, l: 1, c: 1, v: 1 }, rev: 1 }) })
    expect(result.current.key).toBe(B)
    unmount()
    expect(s.network.stats().keys).toBe(0)
  })

  it('a null key subscribes nothing', () => {
    const { s, request } = store()
    const { result } = renderHook(() => useBarSnapshot(null, { store: s }))
    expect(result.current).toBe(null)
    expect(request).not.toHaveBeenCalled()
  })
})
