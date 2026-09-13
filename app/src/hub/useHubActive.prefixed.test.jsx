// F-1 — the hub must mount on a browser that supports ONLY `-webkit-backdrop-filter`.
//
// ⛔ THIS IS EVERY IPHONE. Measured on iPhone 15 Pro / iOS 17.3.1 (BrowserStack session
// 4698156a4117c298272974663583bc359eea4e0d):
//     CSS.supports('backdrop-filter', 'blur(1px)')         -> false
//     CSS.supports('-webkit-backdrop-filter', 'blur(1px)') -> true
// The capability floor tested only the unprefixed name, so it rejected 100% of iOS for a
// control that is mobile-only by design. `hub-root` count on the device: 0.
//
// ⭐ WHY NO EXISTING TEST CAUGHT IT, AND WHY THIS ONE HAS TO STUB. jsdom implements
// NEITHER spelling, so `useHubActive()` returns false there for an entirely different
// reason — and `useHubActive.js` documents that as intended ("an unstubbed test
// environment looks exactly like a browser too old for the hub"). A green suite and a
// blank iPhone were literally the same observation. The only way to tell them apart is
// to stub `CSS.supports` so it answers like Safari, which is what this file does.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import useHubActive from './useHubActive'

vi.mock('./useHubSettings', () => ({
  default: () => ({ settings: { enabled: true } }),
}))

/** Everything except CSS.supports that the floor requires, so only the prefix varies. */
function stubEnvironment() {
  window.visualViewport = window.visualViewport || {}
  window.matchMedia = vi.fn().mockImplementation((q) => ({
    matches: q === '(max-width: 1023px) and (pointer: coarse)',
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  }))
}

/** A `CSS.supports` that answers true for exactly the listed properties. */
function supportsOnly(...properties) {
  globalThis.CSS = {
    supports: vi.fn((prop) => properties.includes(prop)),
  }
}

let originalCSS
let originalMatchMedia

beforeEach(() => {
  originalCSS = globalThis.CSS
  originalMatchMedia = window.matchMedia
  stubEnvironment()
})

afterEach(() => {
  globalThis.CSS = originalCSS
  window.matchMedia = originalMatchMedia
  vi.restoreAllMocks()
})

describe('useHubActive — backdrop-filter capability floor', () => {
  it('MOUNTS on a browser with only the -webkit- prefix (every iPhone)', () => {
    supportsOnly('-webkit-backdrop-filter')
    const { result } = renderHook(() => useHubActive())
    expect(result.current).toBe(true)
  })

  it('mounts on a browser with only the unprefixed property (Chrome/Android)', () => {
    supportsOnly('backdrop-filter')
    const { result } = renderHook(() => useHubActive())
    expect(result.current).toBe(true)
  })

  it('mounts when both are supported', () => {
    supportsOnly('backdrop-filter', '-webkit-backdrop-filter')
    const { result } = renderHook(() => useHubActive())
    expect(result.current).toBe(true)
  })

  it('does NOT mount when neither is supported — the floor still has to reject', () => {
    // The non-vacuity control. Without it, a `CSS.supports` stub that returned true for
    // everything would make all three tests above pass while proving nothing.
    supportsOnly()
    const { result } = renderHook(() => useHubActive())
    expect(result.current).toBe(false)
  })

  it('asks about BOTH spellings rather than guessing from one', () => {
    supportsOnly('-webkit-backdrop-filter')
    renderHook(() => useHubActive())
    const asked = globalThis.CSS.supports.mock.calls.map(([prop]) => prop)
    expect(asked).toContain('backdrop-filter')
    expect(asked).toContain('-webkit-backdrop-filter')
  })
})
