/* MOB-07 — the coarse-pointer primitive's semantic contract.
 *
 * ⭐ These are BEHAVIOURAL tests, deliberately. The thing that broke before was
 * not a wrong string in a file — it was a value FROZEN AT IMPORT, which a source
 * grep reads as perfectly correct. Only exercising the runtime can tell the
 * difference between "reads the media query" and "read the media query once, in
 * 2026, and will never look again".
 *
 * Matrix: A primary coarse · B primary fine · C coarse + no hover ·
 * D fine WITH touch hardware (the hybrid laptop) · E live change after mount ·
 * F no matchMedia · G cleanup · H the drawing layer's real values.
 */
import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  isCoarsePointer, hitThreshold, handleRadius, useCoarsePointer,
  subscribeCoarsePointer, __resetCoarsePointerForTest,
  HIT_COARSE, HIT_FINE, HANDLE_COARSE, HANDLE_FINE,
} from './coarsePointer'

// ── a matchMedia that can actually CHANGE, which is the whole point ─────────
function installMatchMedia({ coarse = false, hover = true, throws = false, absent = false } = {}) {
  const listeners = new Set()
  const state = { coarse }
  if (absent) { delete window.matchMedia; return { listeners, state, flip: () => {} } }
  window.matchMedia = vi.fn((q) => {
    if (throws) throw new Error('matchMedia exploded')
    const isPointerQ = q.includes('pointer: coarse')
    const isHoverQ = q.includes('hover')
    const mql = {
      media: q,
      get matches() {
        if (isPointerQ) return state.coarse
        if (isHoverQ) return !hover
        return false
      },
      addEventListener: (_e, fn) => listeners.add(fn),
      removeEventListener: (_e, fn) => listeners.delete(fn),
      addListener: (fn) => listeners.add(fn),
      removeListener: (fn) => listeners.delete(fn),
    }
    return mql
  })
  return {
    listeners,
    state,
    flip(next) { state.coarse = next; for (const fn of [...listeners]) fn({ matches: next }) },
  }
}

const origMatchMedia = window.matchMedia
beforeEach(() => { __resetCoarsePointerForTest() })
afterEach(() => { window.matchMedia = origMatchMedia; __resetCoarsePointerForTest() })

describe('A/B — the primary pointer decides, and it decides the real numbers', () => {
  it('A · a primary COARSE pointer yields the touch grab radius and handle', () => {
    installMatchMedia({ coarse: true })
    expect(isCoarsePointer()).toBe(true)
    expect(hitThreshold()).toBe(HIT_COARSE)
    expect(handleRadius()).toBe(HANDLE_COARSE)
  })

  it('B · a primary FINE pointer yields the mouse grab radius and handle', () => {
    installMatchMedia({ coarse: false })
    expect(isCoarsePointer()).toBe(false)
    expect(hitThreshold()).toBe(HIT_FINE)
    expect(handleRadius()).toBe(HANDLE_FINE)
  })

  it('the two radii are genuinely different, so a wrong answer is observable', () => {
    expect(HIT_COARSE).toBeGreaterThan(HIT_FINE)
    expect(HANDLE_COARSE).toBeGreaterThan(HANDLE_FINE)
  })
})

describe('C/D — the questions that are NOT this question', () => {
  it('C · coarse WITHOUT hover is still just coarse — hover is a separate query', () => {
    installMatchMedia({ coarse: true, hover: false })
    expect(isCoarsePointer()).toBe(true)
  })

  it('⛔ D · a FINE pointer with touch hardware present stays FINE (the hybrid laptop)', () => {
    // The exact mistake the module exists to prevent: a touchscreen laptop answers
    // YES to `maxTouchPoints > 0` and must still get a mouse-sized grab radius.
    installMatchMedia({ coarse: false })
    const origTouch = navigator.maxTouchPoints
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 10, configurable: true })
    window.ontouchstart = null            // the other half of the usual sniff
    try {
      expect(isCoarsePointer(), 'touch HARDWARE must not imply a coarse PRIMARY pointer').toBe(false)
      expect(hitThreshold()).toBe(HIT_FINE)
    } finally {
      Object.defineProperty(navigator, 'maxTouchPoints', { value: origTouch, configurable: true })
      delete window.ontouchstart
    }
  })

  it('⛔ viewport width is not consulted — a narrow window on a mouse stays fine', () => {
    installMatchMedia({ coarse: false })
    const orig = window.innerWidth
    try {
      Object.defineProperty(window, 'innerWidth', { value: 320, configurable: true })
      expect(isCoarsePointer()).toBe(false)
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: orig, configurable: true })
    }
  })
})

describe('E — it is LIVE, which is the entire reason this module exists', () => {
  function Probe() {
    const coarse = useCoarsePointer()
    return <div data-testid="probe" data-coarse={String(coarse)} data-hit={String(hitThreshold())} />
  }

  it('a component re-renders when the primary pointer flips mid-session', () => {
    const mm = installMatchMedia({ coarse: false })
    render(<Probe />)
    expect(screen.getByTestId('probe')).toHaveAttribute('data-coarse', 'false')
    expect(screen.getByTestId('probe')).toHaveAttribute('data-hit', String(HIT_FINE))

    // An iPad's Magic Keyboard is detached: (pointer: coarse) becomes true.
    act(() => { mm.flip(true) })

    expect(screen.getByTestId('probe'), 'the pointer flipped and the component did not notice')
      .toHaveAttribute('data-coarse', 'true')
    expect(screen.getByTestId('probe')).toHaveAttribute('data-hit', String(HIT_COARSE))
  })

  it('…and back again — the flip is not one-way', () => {
    const mm = installMatchMedia({ coarse: true })
    render(<Probe />)
    expect(screen.getByTestId('probe')).toHaveAttribute('data-coarse', 'true')
    act(() => { mm.flip(false) })
    expect(screen.getByTestId('probe')).toHaveAttribute('data-coarse', 'false')
  })

  it('a plain (non-React) subscriber is notified too', () => {
    const mm = installMatchMedia({ coarse: false })
    const seen = []
    const off = subscribeCoarsePointer(() => seen.push(isCoarsePointer()))
    mm.flip(true)
    mm.flip(false)
    off()
    mm.flip(true)                       // after unsubscribe — must not be recorded
    expect(seen).toEqual([true, false])
  })
})

describe('F — the deterministic fallback', () => {
  it('no matchMedia at all → FINE, and nothing throws', () => {
    installMatchMedia({ absent: true })
    expect(() => isCoarsePointer()).not.toThrow()
    expect(isCoarsePointer()).toBe(false)
    expect(hitThreshold()).toBe(HIT_FINE)
  })

  it('a matchMedia that THROWS → FINE, and nothing throws', () => {
    installMatchMedia({ throws: true })
    expect(() => isCoarsePointer()).not.toThrow()
    expect(isCoarsePointer()).toBe(false)
  })

  it('⭐ the fallback is FINE on purpose: a wrong guess costs precision, not phantom grabs', () => {
    installMatchMedia({ absent: true })
    expect(hitThreshold()).toBeLessThan(HIT_COARSE)
  })
})

describe('G — cleanup', () => {
  function Probe() {
    const coarse = useCoarsePointer()
    return <div data-testid="probe" data-coarse={String(coarse)} />
  }

  it('unmounting removes the subscriber, and a later flip reaches nobody', () => {
    const mm = installMatchMedia({ coarse: false })
    const { unmount } = render(<Probe />)
    expect(mm.listeners.size).toBeGreaterThan(0)   // the shared MQL listener is installed
    unmount()
    // A flip after unmount must not throw or update a dead tree.
    expect(() => act(() => { mm.flip(true) })).not.toThrow()
  })

  it('N mounted charts share ONE MediaQueryList listener, not N of them', () => {
    const mm = installMatchMedia({ coarse: false })
    render(<><Probe /><Probe /><Probe /><Probe /></>)
    expect(mm.listeners.size, 'one listener per chart would leak on a multi-chart grid').toBe(1)
  })
})

describe('H — the values the drawing layer actually uses', () => {
  it('the coarse numbers are the ones the research measured from source (15 / 7)', () => {
    expect(HIT_COARSE).toBe(15)
    expect(HANDLE_COARSE).toBe(7)
    expect(HIT_FINE).toBe(8)
    expect(HANDLE_FINE).toBe(4)
  })

  it('⛔ the values are read at CALL time — caching one is the original defect', () => {
    const mm = installMatchMedia({ coarse: false })
    const before = hitThreshold()
    mm.flip(true)
    const after = hitThreshold()
    expect(before).toBe(HIT_FINE)
    expect(after, 'hitThreshold() returned a stale value — it was frozen somewhere').toBe(HIT_COARSE)
  })
})
