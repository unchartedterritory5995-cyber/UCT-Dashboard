import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'

// ─── ONE TEST MUST MAKE THE REAL FETCH ──────────────────────────────────────
//
// `IndicatorAlertPopover.test.jsx` mocks this module, so every assertion there
// about "loading offers nothing" and "an error says so" is an assertion about a
// hand-made state object. If the real hook could never PRODUCE the error state,
// all of it would be green and the popover would render an empty-but-enabled
// dropdown in production — `lesson_injected_dependency_hides_the_fetch`, exactly.
//
// The alerts fetcher answers a failed request with `{alerts: []}`; for a LIST
// that is indistinguishable from "you have none" and it does not matter. For the
// CATALOG it is the difference between "says so" and "silently offers nothing",
// so the catalog fetcher must REJECT. That is what these three cases pin.

const H = vi.hoisted(() => ({ user: { id: 'u1' } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: H.user }) }))

import { useIndicatorAlertCatalog } from './useIndicatorAlerts'

const ENTRY = {
  indicator: 'rsi',
  label: 'RSI',
  conditions: [{ value: 'above', label: 'Above threshold', needs_threshold: true }],
  default_threshold: 70,
}

beforeEach(() => {
  H.user = { id: 'u1' }
  vi.restoreAllMocks()
})
afterEach(cleanup)

describe('useIndicatorAlertCatalog — a failed fetch is an ERROR, never an empty list', () => {
  it('serves what the endpoint returned', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ catalog: [ENTRY] }) }))
    const { result } = renderHook(() => useIndicatorAlertCatalog())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(global.fetch).toHaveBeenCalledWith('/api/indicator-alerts/catalog', { credentials: 'include' })
    expect(result.current.catalog).toEqual([ENTRY])
    expect(result.current.error).toBeNull()
  })

  it('a non-OK response surfaces as an error and an EMPTY catalog, not as a silent empty catalog', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    const { result } = renderHook(() => useIndicatorAlertCatalog())
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.catalog).toEqual([])
    expect(result.current.isLoading).toBe(false)
  })

  it('so does a 200 whose body is the wrong shape — the popover must not read it as "nothing to offer"', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ alerts: [] }) }))
    const { result } = renderHook(() => useIndicatorAlertCatalog())
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.catalog).toEqual([])
  })

  it('a signed-out user reads as LOADING — offer nothing, and do not claim a failure that did not happen', () => {
    H.user = null
    global.fetch = vi.fn(async () => { throw new Error('must not be called') })
    const { result } = renderHook(() => useIndicatorAlertCatalog())
    expect(result.current.isLoading).toBe(true)
    expect(result.current.error).toBeNull()
    expect(result.current.catalog).toEqual([])
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
