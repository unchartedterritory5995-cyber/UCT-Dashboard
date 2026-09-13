// app/src/hub/hubViewport.test.js — coverage for Phase 2's viewport/device gating (hubViewport.js).
// See docs/plans/joystick/00-master-spec-v1.4.md §2c/§5 and docs/plans/joystick/20-wave05-ux.md §3/§4.

import { createElement } from 'react'
import { describe, it as vitestIt, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import useHubViewport, {
  CHART_SHELL_ATTR,
  CHART_PORTRAIT_QUERY,
  LANDSCAPE_IMMERSIVE_QUERY,
} from './hubViewport'
import { CHART_SCRIM_EXCLUDE_BOTTOM } from './constants'

// `./registry` and `./hubRoutes` are mocked for the WHOLE file (not just the hideOnRoute
// tests) so every test here runs against a small, fully-known route table instead of the real
// registry — which today declares no `hideOnRoute` mode at all, so a test built against the
// real thing could only ever prove a negative. Mocking both lets this file assert the actual
// mechanism (a route resolving to a mode with `hideOnRoute: true` hides the hub) without
// depending on — or drifting alongside — whatever the registry contains next.
vi.mock('./hubRoutes', () => ({
  routeToModeId: (pathname) => ({
    '/hidden-route': 'fakeHidden',
    '/visible-route': 'fakeVisible',
  }[pathname] ?? null),
}))

vi.mock('./registry', () => ({
  modesById: {
    fakeHidden: { id: 'fakeHidden', hideOnRoute: true },
    fakeVisible: { id: 'fakeVisible' },
  },
}))

// ⚠️ RAIL: `vitest -t <regex>` is a regex filter, and a filter matching nothing exits 0 and
// reads as a PASS. `definedCount` counts every `it()` call below as the file is collected
// (regardless of `-t`, since vitest must enumerate names before it can filter them);
// `executedCount` counts only the ones that actually ran. `afterAll` asserts they're equal AND
// non-zero, so a `-t` typo that excludes even one case here — or a stray `.only`/`.skip` — fails
// loudly instead of silently reporting fewer green tests as a full pass. Pattern copied from
// `useHubCursor.test.js`, this file's sibling.
let definedCount = 0
let executedCount = 0
function it(name, fn) {
  definedCount += 1
  return vitestIt(name, async (...args) => {
    executedCount += 1
    return fn(...args)
  })
}
afterAll(() => {
  expect(executedCount).toBeGreaterThan(0)
  expect(executedCount).toBe(definedCount)
})

// ── matchMedia stub — per-query state + live listeners. jsdom ships no real matchMedia, and
// even where a runtime provides one, this hook's correctness (initial read + live `change`
// listener + listener cleanup) needs a stub that can both report a matches value on demand AND
// let a test fire a `change` event by hand — never a real display to lay anything out against. ──
let mqState
function setQuery(query, matches) {
  mqState[query] = mqState[query] || { matches, listeners: [] }
  mqState[query].matches = matches
}
function fireChange(query, matches) {
  setQuery(query, matches)
  mqState[query].listeners.slice().forEach((fn) => fn({ matches }))
}
function listenerCount(query) {
  return (mqState[query]?.listeners || []).length
}

beforeEach(() => {
  mqState = {}
  vi.stubGlobal('matchMedia', vi.fn((query) => {
    mqState[query] = mqState[query] || { matches: false, listeners: [] }
    const entry = mqState[query]
    return {
      get matches() { return entry.matches },
      media: query,
      addEventListener: (_evt, fn) => { entry.listeners.push(fn) },
      removeEventListener: (_evt, fn) => { entry.listeners = entry.listeners.filter((f) => f !== fn) },
    }
  }))
  document.documentElement.removeAttribute(CHART_SHELL_ATTR)
})

afterEach(() => {
  // Explicit `cleanup()` FIRST, ahead of the DOM mutation below — a test that never calls
  // `unmount()` itself leaves its hook's `MutationObserver` attached until React Testing
  // Library's own auto-cleanup runs, and removing the attribute before that disconnect fires a
  // real mutation callback on a component that is no longer this test's, landing an
  // "update not wrapped in act(...)" warning on whichever test happens to be running when that
  // microtask flushes. Disconnecting first makes the order deterministic.
  cleanup()
  document.documentElement.removeAttribute(CHART_SHELL_ATTR)
  vi.restoreAllMocks()
})

// No JSX — this file is plain `.js` (spec: no TypeScript, and per this task's file scope this
// stays `.js` rather than becoming a `.jsx`), so the wrapper is built with `createElement`.
function renderAt(pathname) {
  return renderHook(() => useHubViewport(), {
    wrapper: ({ children }) => createElement(MemoryRouter, { initialEntries: [pathname] }, children),
  })
}

describe('isChartPortrait — requires BOTH the chart-shell attribute AND the portrait-phone-chart media query', () => {
  it('is false when the device matches portrait-phone-chart but the chart shell attribute is absent', () => {
    setQuery(CHART_PORTRAIT_QUERY, true)
    const { result } = renderAt('/charts')
    expect(result.current.isChartPortrait).toBe(false)
  })

  it('is false when the chart-shell attribute is present but the device does not match (e.g. landscape, or desktop-width)', () => {
    document.documentElement.setAttribute(CHART_SHELL_ATTR, '1')
    setQuery(CHART_PORTRAIT_QUERY, false)
    const { result } = renderAt('/charts')
    expect(result.current.isChartPortrait).toBe(false)
  })

  it('is true once both the chart-shell attribute is present AND the portrait-phone-chart query matches', () => {
    document.documentElement.setAttribute(CHART_SHELL_ATTR, '1')
    setQuery(CHART_PORTRAIT_QUERY, true)
    const { result } = renderAt('/charts')
    expect(result.current.isChartPortrait).toBe(true)
  })

  it('tracks a live rotation: a query change fired after mount flips isChartPortrait', () => {
    document.documentElement.setAttribute(CHART_SHELL_ATTR, '1')
    setQuery(CHART_PORTRAIT_QUERY, false)
    const { result } = renderAt('/charts')
    expect(result.current.isChartPortrait).toBe(false)
    act(() => fireChange(CHART_PORTRAIT_QUERY, true))
    expect(result.current.isChartPortrait).toBe(true)
  })
})

describe('scrimExcludeBottom — present ONLY on the portrait phone chart, and equal to the one constants.js value', () => {
  it('is null when isChartPortrait is false', () => {
    document.documentElement.setAttribute(CHART_SHELL_ATTR, '1')
    setQuery(CHART_PORTRAIT_QUERY, false)
    const { result } = renderAt('/charts')
    expect(result.current.isChartPortrait).toBe(false)
    expect(result.current.scrimExcludeBottom).toBeNull()
  })

  it('equals CHART_SCRIM_EXCLUDE_BOTTOM (constants.js) when isChartPortrait is true — never a re-typed literal', () => {
    document.documentElement.setAttribute(CHART_SHELL_ATTR, '1')
    setQuery(CHART_PORTRAIT_QUERY, true)
    const { result } = renderAt('/charts')
    expect(result.current.isChartPortrait).toBe(true)
    expect(result.current.scrimExcludeBottom).toBe(CHART_SCRIM_EXCLUDE_BOTTOM)
  })
})

describe('hidden — landscape-immersive (scoped to the chart shell)', () => {
  it('is true when the chart shell is mounted AND the device matches the landscape-immersive query', () => {
    document.documentElement.setAttribute(CHART_SHELL_ATTR, '1')
    setQuery(LANDSCAPE_IMMERSIVE_QUERY, true)
    const { result } = renderAt('/charts')
    expect(result.current.hidden).toBe(true)
  })

  it('is false when the device matches landscape-immersive but the chart shell is NOT mounted (scoped, not a bare orientation check)', () => {
    setQuery(LANDSCAPE_IMMERSIVE_QUERY, true)
    const { result } = renderAt('/charts')
    expect(result.current.hidden).toBe(false)
  })
})

describe('hidden — registry hideOnRoute', () => {
  it('is true on a route whose resolved mode declares hideOnRoute: true, even with no chart/landscape condition active', () => {
    const { result } = renderAt('/hidden-route')
    expect(result.current.hidden).toBe(true)
  })

  it('is false on a route whose resolved mode does not declare hideOnRoute', () => {
    const { result } = renderAt('/visible-route')
    expect(result.current.hidden).toBe(false)
  })

  it('is false on a route that resolves to no mode at all (routeToModeId returns null)', () => {
    const { result } = renderAt('/not-a-hub-route')
    expect(result.current.hidden).toBe(false)
  })
})

describe('listener hygiene — a leaked matchMedia listener on the hub is a real per-session leak', () => {
  it('adds exactly one change listener per media query on mount, and removes both on unmount', () => {
    document.documentElement.setAttribute(CHART_SHELL_ATTR, '1')
    const { unmount } = renderAt('/charts')

    expect(listenerCount(CHART_PORTRAIT_QUERY)).toBe(1)
    expect(listenerCount(LANDSCAPE_IMMERSIVE_QUERY)).toBe(1)

    unmount()

    expect(listenerCount(CHART_PORTRAIT_QUERY)).toBe(0)
    expect(listenerCount(LANDSCAPE_IMMERSIVE_QUERY)).toBe(0)
  })

  it('does not throw, and adds no listener, when matchMedia is unavailable (below the §2 browser floor)', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(() => renderAt('/charts')).not.toThrow()
  })
})
