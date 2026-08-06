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

  // A rAF callback receives the FRAME's start timestamp, which can predate the
  // performance.now() sampled just before the loop started. `t` was clamped at
  // the top only, so a negative t fed ease() = 1-(1-t)**3 and produced garbage:
  // the full suite caught a 100->200 tween rendering -478,175,142. This hook
  // drives the Journal account-balance hero, so that is a user watching their
  // balance flash a wild negative. Pin BOTH ends of the clamp.
  it('never overshoots below the start value when rAF reports a timestamp before start', async () => {
    const realRaf = window.requestAnimationFrame
    // Feed the callback a timestamp 500ms in the PAST, then a normal one.
    let firstCall = true
    window.requestAnimationFrame = (cb) => {
      const ts = firstCall ? performance.now() - 500 : performance.now() + 1000
      firstCall = false
      return realRaf(() => cb(ts))
    }
    try {
      const seen = []
      const { rerender } = renderHook(({ v }) => {
        const out = useAnimatedNumber(v, { duration: 40 })
        seen.push(out)
        return out
      }, { initialProps: { v: 100 } })
      rerender({ v: 200 })
      await waitFor(() => expect(seen[seen.length - 1]).toBe(200), { timeout: 2000 })
      // Every intermediate frame must stay inside the tween's own bounds.
      const bad = seen.filter((n) => typeof n === 'number' && (n < 100 || n > 200))
      expect(bad).toEqual([])
    } finally {
      window.requestAnimationFrame = realRaf
    }
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
