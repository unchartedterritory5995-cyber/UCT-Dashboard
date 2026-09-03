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
