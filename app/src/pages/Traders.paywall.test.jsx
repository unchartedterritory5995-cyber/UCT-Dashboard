/**
 * 🔴 A MID-FLIGHT 402 THREW ON `traders.map(...)`.
 *
 * `/api/traders` is paid-gated and 55 routes were paywalled in the same pass,
 * so a 402 on this surface is not hypothetical — it is what a free member gets.
 * The page's fetcher was `url => fetch(url).then(r => r.json())`, which handed
 * the refusal body `{"detail": "..."}` straight through as `traders`. That
 * object is truthy, so the `traders ? … : 'Loading…'` guard chose the render
 * branch, and `traders.map` threw. White screen.
 *
 * ⛔ THIS FILE MOCKS NOTHING ON THE PATH UNDER TEST. `Traders.test.jsx` beside
 * it mocks `swr` wholesale and hands the component a ready-made array — it was
 * green for the entire time this bug shipped, and it would stay green if the
 * fetcher were deleted altogether. The wire is the thing being tested here, so
 * only `global.fetch` is stubbed and the real `jsonFetcher`, the real
 * `useMobileSWR` and the real SWR cache all run.
 */
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import Traders from './Traders'

/** A fresh cache per case, or SWR serves the previous test's answer. */
const mount = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
    <Traders />
  </SWRConfig>,
)

const respond = (status, body) => {
  global.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }))
}

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { cleanup(); delete global.fetch })

describe('Traders under a non-ok response', () => {
  it('🔴 a 402 does not throw, and does not render a refusal body as traders', async () => {
    // THE case. Before the fix this render threw `traders.map is not a function`.
    respond(402, { detail: 'This page requires a paid plan' })
    expect(() => mount()).not.toThrow()

    // The heading survives — i.e. the component is still mounted, not unwound.
    expect(screen.getByRole('heading', { name: /traders/i })).toBeTruthy()
    // …and the refusal's own words never leak into the page as data.
    expect(screen.queryByText(/This page requires a paid plan/)).toBeNull()
  })

  it('says the feed is PAID rather than pretending to still be loading', async () => {
    respond(402, { detail: 'nope' })
    mount()
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
    expect(screen.getByRole('status').textContent).toMatch(/paid plan/i)
    expect(screen.queryByText(/Loading traders/i), 'a refusal rendered as a spinner')
      .toBeNull()
  })

  it('a 500 is reported as a FAILURE, not as a paywall', async () => {
    // ⛔ The two must not collapse: telling a paying member to upgrade during an
    // outage is worse than saying nothing.
    respond(500, {})
    mount()
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
    expect(screen.getByRole('status').textContent).not.toMatch(/paid plan/i)
    expect(screen.getByRole('status').textContent).toMatch(/could not be loaded/i)
  })

  it('the happy path still renders the feed — the guard is not a blanket refusal', async () => {
    // The control. Without it every assertion above passes for a page that
    // renders nothing at all, ever.
    respond(200, [{ name: 'TSDR', tickers: ['NVDA'] }])
    mount()
    await waitFor(() => expect(screen.getByText('TSDR')).toBeTruthy())
    expect(screen.getByRole('link', { name: 'NVDA' })).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
