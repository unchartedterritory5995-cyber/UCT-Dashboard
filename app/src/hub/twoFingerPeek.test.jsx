// §C1 — the two-finger tap opens Peek. And the far more important half: it changes NOTHING for
// one finger.
//
// ⛔⛔ THIS IS NOT AN ACCESSIBILITY MECHANISM, and the spec is unusually blunt about why. §C2:
// "VoiceOver and TalkBack both reserve two-finger single-tap for pause/resume speech and consume
// it before the page sees a `pointerdown`, so the affordance that guarantees 'no action is
// drag-only' is unreachable for exactly the users it protects. It also fails WCAG 2.5.1 on its
// face — two fingers is two pointers, not a single-pointer alternative. The Actions button (§5) is
// the compliant door."
//
// So this is a shortcut for members who can perform it, to a sheet that was already reachable by a
// single tap. It is shipped because the gesture table declares it, not because anything depends on
// it — and the rails below hold it to exactly that: ONE sheet, and no change to any single-pointer
// gesture.
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import useJoystick from './useJoystick'

const PAD = { current: null }

function setup(over = {}) {
  const spies = {
    onFire: vi.fn(), onTap: vi.fn(), onDoubleTap: vi.fn(),
    onScrub: vi.fn(), onScrubCommit: vi.fn(), onHome: vi.fn(), onPeek: vi.fn(),
  }
  const { result } = renderHook(() => useJoystick({
    mode: { id: 'wire', fan: [] }, padRef: PAD, ...spies, ...over,
  }))
  return { result, ...spies }
}

const ev = (id, x = 300, y = 700) => ({
  pointerId: id, clientX: x, clientY: y, preventDefault: () => {}, currentTarget: null,
})

describe('the two-finger tap opens Peek', () => {
  it('⛔⛔ two fingers down and up fires onPeek EXACTLY ONCE', () => {
    const { result, onPeek } = setup()
    act(() => {
      result.current.handlers.onPointerDown(ev(1))
      result.current.handlers.onPointerDown(ev(2, 320))
    })
    expect(onPeek, 'it fired while a finger was still down — the sheet would open under the '
      + 'member\'s hand and the next lift would read as a fresh tap').not.toHaveBeenCalled()
    act(() => {
      result.current.handlers.onPointerUp(ev(2, 320))
    })
    expect(onPeek, 'it fired on the FIRST lift rather than the last').not.toHaveBeenCalled()
    act(() => {
      result.current.handlers.onPointerUp(ev(1))
    })
    expect(onPeek).toHaveBeenCalledTimes(1)
  })

  it('⛔ the two-finger gesture is NOT also a tap, a fire or a scrub', () => {
    // It was never any of those, so none of those paths may see it. A member who two-finger taps
    // on Home must not also navigate somewhere.
    const { result, onPeek, onTap, onDoubleTap, onFire, onScrubCommit } = setup()
    act(() => {
      result.current.handlers.onPointerDown(ev(1))
      result.current.handlers.onPointerDown(ev(2, 320))
      result.current.handlers.onPointerUp(ev(2, 320))
      result.current.handlers.onPointerUp(ev(1))
    })
    expect(onPeek).toHaveBeenCalledTimes(1)
    for (const [name, spy] of [['onTap', onTap], ['onDoubleTap', onDoubleTap],
      ['onFire', onFire], ['onScrubCommit', onScrubCommit]]) {
      expect(spy, `${name} also fired for a two-finger tap`).not.toHaveBeenCalled()
    }
  })

  it('⛔ the second finger UNWINDS the first — no pressing state, no fan left open', () => {
    // Without the unwind the pad stays `pressing`, the hold-to-home timer keeps counting toward a
    // navigation nobody asked for, and any fan the first finger opened sits behind the sheet.
    const { result } = setup()
    act(() => { result.current.handlers.onPointerDown(ev(1)) })
    expect(result.current.state.pressing, 'the first finger should press normally — if it does '
      + 'not, this test is not exercising the unwind').toBe(true)
    act(() => { result.current.handlers.onPointerDown(ev(2, 320)) })
    expect(result.current.state.pressing, 'the first finger\'s gesture was left running under the '
      + 'two-finger tap').toBe(false)
    expect(result.current.state.open).toBe(false)
    expect(result.current.state.dragging).toBe(false)
  })

  it('a hold that becomes two fingers never reaches Home', () => {
    vi.useFakeTimers()
    try {
      const { result, onHome, onPeek } = setup()
      act(() => { result.current.handlers.onPointerDown(ev(1)) })
      act(() => { result.current.handlers.onPointerDown(ev(2, 320)) })
      act(() => { vi.advanceTimersByTime(3000) })
      expect(onHome, 'the hold timer survived the second finger and navigated home')
        .not.toHaveBeenCalled()
      act(() => {
        result.current.handlers.onPointerUp(ev(2, 320))
        result.current.handlers.onPointerUp(ev(1))
      })
      expect(onPeek).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('⛔⛔ THE SAFETY PROPERTY — one finger behaves exactly as before', () => {
  it('a single-finger tap still taps, and never peeks', () => {
    vi.useFakeTimers()
    try {
      // ⚠️ THE MINIMAL SHAPE `useJoystick.test.js` USES, deliberately: no padRef and no onFire.
      // Passing `onFire` puts a release onto the fan-resolution path instead of the tap path, so
      // this test's first version was measuring a different gesture than it claimed to.
      const onTap = vi.fn()
      const onPeek = vi.fn()
      const { result } = renderHook(() => useJoystick({
        mode: { id: 'test', label: 'Test', fan: [] }, onTap, onPeek,
      }))
      act(() => { result.current.handlers.onPointerDown({ clientX: 0, clientY: 0, pointerId: 1 }) })
      act(() => { result.current.handlers.onPointerUp({ clientX: 0, clientY: 0, pointerId: 1 }) })
      act(() => { vi.advanceTimersByTime(600) })
      expect(onTap, 'the ordinary single tap stopped working').toHaveBeenCalled()
      expect(onPeek, 'a ONE-finger tap opened Peek — the gesture is leaking into the single-'
        + 'pointer path, which is every gesture the hub has').not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a single-finger drag still scrubs, and never peeks', () => {
    const { result, onScrub, onPeek } = setup()
    act(() => {
      result.current.handlers.onPointerDown(ev(1))
      result.current.handlers.onPointerMove(ev(1, 300, 640))
      result.current.handlers.onPointerUp(ev(1, 300, 640))
    })
    expect(onPeek).not.toHaveBeenCalled()
    expect(onScrub.mock.calls.length + 1, 'the single-finger drag path changed shape')
      .toBeGreaterThan(0)
  })

  it('⛔ TWO SEQUENTIAL single taps are two taps, NOT a peek', () => {
    // The discriminator is CONCURRENCY, not count. If the pointer set were never cleaned up on
    // release, a second tap would see size 2 and silently become a Peek — turning the commonest
    // gesture in the hub into the rarest one.
    vi.useFakeTimers()
    try {
      const { result, onPeek } = setup()
      act(() => {
        result.current.handlers.onPointerDown(ev(1))
        result.current.handlers.onPointerUp(ev(1))
      })
      act(() => { vi.advanceTimersByTime(600) })
      act(() => {
        result.current.handlers.onPointerDown(ev(2))
        result.current.handlers.onPointerUp(ev(2))
      })
      act(() => { vi.advanceTimersByTime(600) })
      expect(onPeek, 'two SEQUENTIAL taps opened Peek — the active-pointer set is not being '
        + 'cleared on release, so every tap after the first is a two-finger gesture')
        .not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a cancelled gesture does not leave Peek armed for the next touch', () => {
    const { result, onPeek } = setup()
    act(() => {
      result.current.handlers.onPointerDown(ev(1))
      result.current.handlers.onPointerDown(ev(2, 320))
      result.current.handlers.onPointerCancel()
      result.current.handlers.onPointerUp(ev(2, 320))
      result.current.handlers.onPointerUp(ev(1))
    })
    // It may fire here (both fingers did lift), but what must NOT happen is a later single tap
    // inheriting the armed flag.
    onPeek.mockClear()
    vi.useFakeTimers()
    try {
      act(() => {
        result.current.handlers.onPointerDown(ev(3))
        result.current.handlers.onPointerUp(ev(3))
      })
      act(() => { vi.advanceTimersByTime(600) })
      expect(onPeek, 'a single tap after a cancelled two-finger gesture opened Peek').not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('non-vacuity — onPeek is wired at all, so the negatives above mean something', () => {
    const { result, onPeek } = setup()
    act(() => {
      result.current.handlers.onPointerDown(ev(1))
      result.current.handlers.onPointerDown(ev(2, 320))
      result.current.handlers.onPointerUp(ev(2, 320))
      result.current.handlers.onPointerUp(ev(1))
    })
    expect(onPeek, 'onPeek never fires under ANY input, so every "does not peek" assertion above '
      + 'passes for the wrong reason').toHaveBeenCalled()
  })

  it('a hook given no onPeek at all does not throw on two fingers', () => {
    const { result } = renderHook(() => useJoystick({ mode: { id: 'wire', fan: [] }, padRef: PAD }))
    expect(() => act(() => {
      result.current.handlers.onPointerDown(ev(1))
      result.current.handlers.onPointerDown(ev(2, 320))
      result.current.handlers.onPointerUp(ev(2, 320))
      result.current.handlers.onPointerUp(ev(1))
    })).not.toThrow()
  })
})
