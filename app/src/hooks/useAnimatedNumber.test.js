import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import useAnimatedNumber from './useAnimatedNumber'

afterEach(() => vi.restoreAllMocks())

describe('useAnimatedNumber', () => {
  it('snaps on first render (no tween on page load)', () => {
    const { result } = renderHook(() => useAnimatedNumber(1000))
    expect(result.current).toBe(1000)
  })

  it('passes non-finite values through', () => {
    const { result, rerender } = renderHook(({ v }) => useAnimatedNumber(v), {
      initialProps: { v: null },
    })
    expect(result.current).toBeNull()
    rerender({ v: 500 })
    expect(result.current).toBe(500)          // snap: previous was non-finite
  })

  it('tweens to a new value and lands exactly on target', async () => {
    const { result, rerender } = renderHook(({ v }) => useAnimatedNumber(v, { duration: 40 }), {
      initialProps: { v: 100 },
    })
    rerender({ v: 200 })
    await waitFor(() => expect(result.current).toBe(200), { timeout: 2000 })
  })

  it('snaps under prefers-reduced-motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true })
    const { result, rerender } = renderHook(({ v }) => useAnimatedNumber(v), {
      initialProps: { v: 100 },
    })
    act(() => rerender({ v: 900 }))
    expect(result.current).toBe(900)
  })
})
