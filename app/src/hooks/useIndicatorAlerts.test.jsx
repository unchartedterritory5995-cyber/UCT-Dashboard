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

// ─── AND THE OTHER KEY IN THE SAME ANSWER ───────────────────────────────────
//
// `GET /api/indicator-alerts/catalog` also carries `refusals` — why a member's
// OWN saved formula is NOT among the offerings, in the refusing door's own
// words. The fetcher returned `body.catalog`, so the block was discarded one
// line after it arrived and no component could ever see it.
//
// These cases pin the hook end of that wire. The SURFACE end — the sentence
// reaching a member's screen — is `IndicatorAlertPopover.refusals.test.jsx`,
// which mounts the real hook rather than a double, so a cut anywhere between
// the two shows there too.

const REFUSAL = {
  id: 'my_ma',
  label: 'My MA',
  gate: 'repaint',
  // The door's own sentence, `[gate:…]` suffix and all. Passed through untouched.
  messages: ["a repainting formula cannot arm an alert: my_ma.line measures 'repaints' [gate:repaint]"],
}

describe('useIndicatorAlertCatalog — `refusals` is served, not dropped', () => {
  it('⭐ hands back the refusals block the endpoint sent, verbatim', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true, json: async () => ({ catalog: [ENTRY], refusals: [REFUSAL] }),
    }))
    const { result } = renderHook(() => useIndicatorAlertCatalog())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    // ⛔ DEEP EQUALITY on the whole block. The gate's sentence is the payload;
    // a hook that reshaped, trimmed or re-keyed it would be a second vocabulary
    // for one refusal, which is the defect this endpoint was built to avoid.
    expect(result.current.refusals).toEqual([REFUSAL])
    // …and the offerings are untouched by it.
    expect(result.current.catalog).toEqual([ENTRY])
  })

  it('⛔ CONTROL: an empty refusals block is EMPTY — nothing is invented for a member with none', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true, json: async () => ({ catalog: [ENTRY], refusals: [] }),
    }))
    const { result } = renderHook(() => useIndicatorAlertCatalog())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.refusals).toEqual([])
  })

  it('a body with NO refusals key keeps the catalog and reports none — it is not an error', async () => {
    // ⚠️ THE ASYMMETRY WITH `catalog` ABOVE IS DELIBERATE. An absent catalog is
    // a SAFETY failure (an empty-but-enabled dropdown a user can submit from),
    // so that one rejects. An absent refusals block is only the silence that
    // existed before it shipped — a browser holding this bundle against a server
    // that predates the key degrades to yesterday rather than losing the picker.
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ catalog: [ENTRY] }) }))
    const { result } = renderHook(() => useIndicatorAlertCatalog())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.refusals).toEqual([])
    expect(result.current.catalog).toEqual([ENTRY])
    expect(result.current.error).toBeNull()
  })

  it('and a refusals key of the WRONG SHAPE reads as none, never as a crash on a member\'s chart', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true, json: async () => ({ catalog: [ENTRY], refusals: { my_ma: 'nope' } }),
    }))
    const { result } = renderHook(() => useIndicatorAlertCatalog())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.refusals).toEqual([])
    expect(result.current.catalog).toEqual([ENTRY])
  })

  it('⛔ every non-answer reports NO refusals — loading, failed and signed-out alike', async () => {
    // "Nothing was refused" and "we could not ask" render identically on purpose:
    // both mean this surface has nothing true to say about a member's own
    // formulas, and the error branch already says so in its own words.
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    const { result } = renderHook(() => useIndicatorAlertCatalog())
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.refusals).toEqual([])

    H.user = null
    const signedOut = renderHook(() => useIndicatorAlertCatalog())
    expect(signedOut.result.current.refusals).toEqual([])
  })
})
