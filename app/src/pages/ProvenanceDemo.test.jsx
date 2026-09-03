// app/src/pages/ProvenanceDemo.test.jsx
//
// The wire-cut proof for S8 Step 2's "visible Terminal value" deliverable:
// this file renders the REAL page (not the components in isolation) and
// mocks only the network boundary (`fetch`), the same idiom
// Screener.scanmount.test.jsx uses for CoverageLine's own wire-cut rail.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProvenanceDemo from './ProvenanceDemo'

afterEach(cleanup)

function mockFetchOnce(json) {
  // jsonFetcher checks `.ok` before parsing — the real shape a mock must match.
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(json) })
}

/** The page now fires TWO fetches on mount: the quote lookup and the
 *  <Cited> bar example. Routes by URL substring so both tests families
 *  stay independent of each other. */
function mockFetchRouted({ quote, bar }) {
  global.fetch = vi.fn((url) => {
    if (url.includes('/api/provenance/bar')) {
      if (bar === null) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ detail: 'no data' }) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(bar) })
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(quote) })
  })
}

describe('the page fetches live D1 data through /api/provenance/quote and renders it', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a loading state, then the fetched result', async () => {
    mockFetchOnce({
      symbol: 'AAPL',
      vendors: {
        massive: {
          value: { day: { c: 505.24 } },
          provenance: { vendor: 'massive', source_activity: 'massive.get_quote', source_observed_at: 1788393600 },
          freshness: 'real_time',
        },
        fmp: {
          value: [{ symbol: 'AAPL', price: 505.09, timestamp: 1788392700 }],
          provenance: { vendor: 'fmp', source_activity: 'fmp_client.get_quote', source_observed_at: 1788392700 },
          freshness: 'delayed_15',
        },
      },
    })
    render(<ProvenanceDemo />)
    expect(screen.getByTestId('provenance-demo-page')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('vendor-row-massive')).toBeTruthy())
    expect(screen.getByTestId('vendor-row-massive')).toHaveTextContent('$505.24')
    expect(screen.getByTestId('vendor-row-massive')).toHaveTextContent('LIVE')
    expect(screen.getByTestId('vendor-row-fmp')).toHaveTextContent('$505.09')
    expect(screen.getByTestId('vendor-row-fmp')).toHaveTextContent(/delayed/i)
  })

  it('the delayed vendor never renders as LIVE and the realtime vendor never renders as delayed', async () => {
    mockFetchOnce({
      symbol: 'AAPL',
      vendors: {
        massive: { value: { day: { c: 1 } }, provenance: { source_activity: 'x' }, freshness: 'real_time' },
        fmp: { value: [{ price: 1 }], provenance: { source_activity: 'y' }, freshness: 'delayed_15' },
      },
    })
    render(<ProvenanceDemo />)
    await waitFor(() => expect(screen.getByTestId('vendor-row-fmp')).toBeTruthy())
    const massiveTier = screen.getByTestId('vendor-row-massive').querySelector('[data-freshness-tier]')
    const fmpTier = screen.getByTestId('vendor-row-fmp').querySelector('[data-freshness-tier]')
    expect(massiveTier.dataset.freshnessTier).toBe('real_time')
    expect(fmpTier.dataset.freshnessTier).toBe('delayed_15')
  })

  it('a source-stale vendor renders distinctly from a real_time one', async () => {
    mockFetchOnce({
      symbol: 'ATLQ',
      vendors: {
        fmp: { value: [{ price: 9.97 }], provenance: { source_activity: 'x' }, freshness: 'stale' },
      },
    })
    render(<ProvenanceDemo />)
    await waitFor(() => expect(screen.getByTestId('vendor-row-fmp')).toBeTruthy())
    expect(screen.getByTestId('vendor-row-fmp')).toHaveTextContent(/source/i)
  })
})

describe('entitlement-denied and not-found render as honest, distinct states', () => {
  it('entitlement_denied (Massive index 403) never renders a fabricated price', async () => {
    mockFetchOnce({
      symbol: 'SPX',
      vendors: {
        massive: { error: true, kind: 'auth_error', entitlement_denied: true, vendor: 'massive' },
      },
    })
    render(<ProvenanceDemo />)
    await waitFor(() => expect(screen.getByTestId('vendor-row-massive')).toBeTruthy())
    const row = screen.getByTestId('vendor-row-massive')
    expect(row).not.toHaveTextContent('$')
    expect(row.querySelector('[data-availability]').dataset.availability).toBe('entitlement_denied')
  })

  it('not_found renders a different availability state than entitlement_denied', async () => {
    mockFetchOnce({
      symbol: 'ZZZNOTREAL',
      vendors: { fmp: { error: true, kind: 'not_found' } },
    })
    render(<ProvenanceDemo />)
    await waitFor(() => expect(screen.getByTestId('vendor-row-fmp')).toBeTruthy())
    expect(screen.getByTestId('vendor-row-fmp').querySelector('[data-availability]').dataset.availability)
      .toBe('not_found')
  })

  it('a provider error (transient) renders a third, distinct availability state', async () => {
    mockFetchOnce({
      symbol: 'AAPL',
      vendors: { massive: { error: true, kind: 'transient' } },
    })
    render(<ProvenanceDemo />)
    await waitFor(() => expect(screen.getByTestId('vendor-row-massive')).toBeTruthy())
    expect(screen.getByTestId('vendor-row-massive').querySelector('[data-availability]').dataset.availability)
      .toBe('provider_error')
  })
})

describe('a network-level failure degrades honestly, never crashes the page', () => {
  it('fetch rejecting renders a provider-error state, not a blank/broken page', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'))
    render(<ProvenanceDemo />)
    await waitFor(() => expect(screen.getByTestId('vendor-row-massive')).toBeTruthy())
    expect(screen.getByTestId('vendor-row-massive').querySelector('[data-availability]')).toBeTruthy()
  })

  it('a non-2xx response from the endpoint itself (via jsonFetcher) never renders the error body as data', async () => {
    // The exact TD-18 shape jsonFetcher exists to prevent: a non-ok JSON body
    // (here, a stand-in for a future non-2xx answer) must never be treated as
    // a valid {symbol, vendors} payload.
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 500, json: () => Promise.resolve({ detail: 'boom' }),
    })
    render(<ProvenanceDemo />)
    await waitFor(() => expect(screen.getByTestId('vendor-row-massive')).toBeTruthy())
    expect(screen.getByTestId('vendor-row-massive').querySelector('[data-availability]').dataset.availability)
      .toBe('provider_error')
    expect(screen.queryByText('boom')).toBeNull()
  })
})

describe('looking up a different symbol re-fetches', () => {
  it('submitting the form issues a new fetch for the new symbol', async () => {
    const user = userEvent.setup()
    mockFetchOnce({ symbol: 'AAPL', vendors: { fmp: { error: true, kind: 'not_found' } } })
    render(<ProvenanceDemo />)
    await waitFor(() => expect(screen.getByTestId('vendor-row-fmp')).toBeTruthy())

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ symbol: 'MSFT', vendors: { fmp: { error: true, kind: 'not_found' } } }),
    })
    await user.clear(screen.getByTestId('provenance-demo-input'))
    await user.type(screen.getByTestId('provenance-demo-input'), 'MSFT')
    await user.click(screen.getByTestId('provenance-demo-submit'))
    // jsonFetcher calls fetch(url, init) — a second (possibly undefined) arg
    // is always present, so match on the URL actually requested rather than
    // the full call signature.
    await waitFor(() => {
      const urls = global.fetch.mock.calls.map((c) => c[0])
      expect(urls.some((u) => u.includes('symbol=MSFT'))).toBe(true)
    })
  })
})

describe('accessibility of the page shell', () => {
  it('the symbol input has an associated label', async () => {
    mockFetchOnce({ symbol: 'AAPL', vendors: {} })
    render(<ProvenanceDemo />)
    expect(screen.getByLabelText('Symbol')).toBeTruthy()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
  })

  it('the session context renders a plain, readable string', async () => {
    mockFetchOnce({ symbol: 'AAPL', vendors: {} })
    render(<ProvenanceDemo />)
    expect(screen.getByTestId('provenance-demo-session').textContent.length).toBeGreaterThan(0)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
  })
})

describe('session-stale wiring (S11 continuation): real, distinct from source-stale', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a value observed before the session boundary that has since crossed shows "view needs refresh"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-01-15T15:00:00Z')) // 10:00am ET, regular session (opened 9:30am)
    mockFetchOnce({
      symbol: 'AAPL',
      vendors: {
        massive: {
          value: { day: { c: 505.24 } },
          // 9:00am ET — pre-market, BEFORE the 9:30am open boundary that has since passed.
          provenance: { source_activity: 'massive.get_quote', source_observed_at: Math.floor(new Date('2026-01-15T14:00:00Z').getTime() / 1000) },
          freshness: 'real_time',
        },
      },
    })
    render(<ProvenanceDemo />)
    await waitFor(() => expect(screen.getByTestId('vendor-row-massive')).toBeTruthy())
    expect(screen.getByTestId('vendor-row-massive').querySelector('[data-testid="session-stale-note"]')).toBeTruthy()
  })

  it('a value observed within the current session shows no session-stale note, even though its own source data is real_time', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-01-15T15:00:00Z')) // 10:00am ET, regular session
    mockFetchOnce({
      symbol: 'AAPL',
      vendors: {
        massive: {
          value: { day: { c: 505.24 } },
          // 9:45am ET — AFTER the 9:30am open boundary, same session as "now".
          provenance: { source_activity: 'massive.get_quote', source_observed_at: Math.floor(new Date('2026-01-15T14:45:00Z').getTime() / 1000) },
          freshness: 'real_time',
        },
      },
    })
    render(<ProvenanceDemo />)
    await waitFor(() => expect(screen.getByTestId('vendor-row-massive')).toBeTruthy())
    expect(screen.getByTestId('vendor-row-massive').querySelector('[data-testid="session-stale-note"]')).toBeNull()
  })

  it('D1 source-stale and S11 session-stale are independent: a source-stale value from the current session shows source-stale text but no session-stale note', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-01-15T15:00:00Z'))
    mockFetchOnce({
      symbol: 'ATLQ',
      vendors: {
        fmp: {
          value: [{ price: 9.97 }],
          provenance: { source_activity: 'x', source_observed_at: Math.floor(new Date('2026-01-15T14:45:00Z').getTime() / 1000) },
          freshness: 'stale', // D1's own source-stale classification
        },
      },
    })
    render(<ProvenanceDemo />)
    await waitFor(() => expect(screen.getByTestId('vendor-row-fmp')).toBeTruthy())
    const row = screen.getByTestId('vendor-row-fmp')
    expect(row.querySelector('[data-testid="source-stale-note"]')).toBeTruthy()
    expect(row.querySelector('[data-testid="session-stale-note"]')).toBeNull()
  })
})

describe('the <Cited> bar-citation example (narrow interim form, SPEC-S8 §4.5)', () => {
  it('a real recorded bar renders through <Cited>, present state', async () => {
    mockFetchRouted({
      quote: { symbol: 'AAPL', vendors: {} },
      bar: { ticker: 'AAPL', tf: 'D', bar_time: 1, source: 'massive', validated_at: 1, verified_at: null },
    })
    render(<ProvenanceDemo />)
    await waitFor(() => expect(screen.getByTestId('cited-bar-example')).toBeTruthy())
    expect(screen.getByTestId('cited-bar-example').querySelector('[data-testid="cited-present"]')).toBeTruthy()
  })

  it('a genuinely unrecorded bar (404) renders the honest "citation unavailable" state, never an error', async () => {
    mockFetchRouted({ quote: { symbol: 'AAPL', vendors: {} }, bar: null })
    render(<ProvenanceDemo />)
    await waitFor(() => expect(screen.getByTestId('cited-bar-example')).toBeTruthy())
    expect(screen.getByTestId('cited-bar-example').querySelector('[data-testid="cited-unavailable"]')).toBeTruthy()
  })
})
