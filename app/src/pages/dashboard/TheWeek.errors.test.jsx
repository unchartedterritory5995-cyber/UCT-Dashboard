// app/src/pages/dashboard/TheWeek.errors.test.jsx
//
// 🔴 THE CARRIED FIX. TheWeek's fetcher was
// `fetch(u).then(r => r.ok ? r.json() : null).catch(() => null)` — a
// 402/500/network error collapses into the same `null` as "nothing
// published this week", so a desk outage rendered as a quiet week,
// indistinguishable from the true empty state.
//
// ⛔ `TheWeek.test.jsx` beside this file mocks `swr` wholesale and hands the
// component a ready-made `data` object — it never calls the fetcher at all,
// so it would stay green for the entire time this bug shipped (same shape
// as `Traders.paywall.test.jsx` beside `Traders.jsx`, which this file
// mirrors). THIS FILE MOCKS NOTHING ON THE PATH UNDER TEST: only
// `global.fetch` is stubbed; the real `jsonFetcher` and the real SWR cache
// both run.
//
// ⚠️ AMENDED WITH THE ZONE-B GATE (task 13). These three cases used to assert
// `getByText('The Week')` — "the tile survives, not a white screen". That was
// the right assertion when TheWeek always rendered its TileCard; it is the
// WRONG one now. A labelled frame with nothing under it IS the defect this
// hero replaces, so TheWeek returns null when all three panels are empty, and
// an outage lands on exactly that path. The assertion therefore moved from
// "the header is on screen" to "NOTHING is on screen, and in particular not
// the refusal's own words" — which is a strictly stronger statement about the
// same failure. The happy-path control below is what stops it becoming a test
// of a component that renders nothing ever.
import { render, screen, waitFor, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import TheWeek from './TheWeek'

/** A fresh cache per case, or SWR serves the previous test's answer. */
const mount = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
    <MemoryRouter><TheWeek /></MemoryRouter>
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
afterEach(() => { cleanup(); delete global.fetch; vi.useRealTimers() })

describe('TheWeek under a non-ok response', () => {
  it('a 402 on both endpoints does not throw and degrades to the empty-week shape, never a refusal body as content', async () => {
    respond(402, { detail: 'This page requires a paid plan' })
    let container
    expect(() => { ({ container } = mount()) }).not.toThrow()

    // Nothing at all is drawn — not the panels, and NOT a labelled frame
    // standing over them.
    await waitFor(() => expect(container.textContent).toBe(''))
    // …and the refusal's own words never leak into the page as data.
    expect(screen.queryByText(/This page requires a paid plan/)).toBeNull()
    expect(screen.queryByText('The Week')).toBeNull()
    // Every panel omits itself, exactly like the genuine empty-week case
    // TheWeek.test.jsx already covers.
    expect(screen.queryByText(/latest sunday scan/i)).toBeNull()
    expect(screen.queryByText(/from the desk/i)).toBeNull()
    expect(screen.queryByText(/next week on deck/i)).toBeNull()
  })

  it('a 500 does not throw and degrades the same way — an outage is not rendered as data', async () => {
    respond(500, {})
    const { container } = mount()
    await waitFor(() => expect(container.textContent).toBe(''))
    expect(screen.queryByText('The Week')).toBeNull()
    expect(screen.queryByText(/latest sunday scan/i)).toBeNull()
    expect(screen.queryByText(/from the desk/i)).toBeNull()
  })

  it('a network failure (fetch rejects) does not throw either', async () => {
    global.fetch = vi.fn(async () => { throw new Error('network down') })
    let container
    expect(() => { ({ container } = mount()) }).not.toThrow()
    await waitFor(() => expect(container.textContent).toBe(''))
    expect(screen.queryByText('The Week')).toBeNull()
    expect(screen.queryByText(/latest sunday scan/i)).toBeNull()
  })

  it('the happy path still renders — the fetcher swap is not a blanket refusal', async () => {
    // The control. Without it every assertion above passes for a tile that
    // renders nothing at all, ever.
    respond(200, { articles: [{ slug: 'sunday-scans-ctrl', title: 'Sunday Scans', url: '#' }] })
    mount()
    await waitFor(() => expect(screen.getByText('Sunday Scans')).toBeTruthy())
  })

  // ⭐ THE STRUCTURAL DIFFERENCE, not just "no crash". jsonFetcher THROWS on a
  // non-ok response; SWR only ever retries on a REJECTED fetcher promise. The
  // old fetcher caught its own error and resolved to `null` — a "successful"
  // revalidation as far as SWR is concerned — so a transient outage never
  // retried and the section stayed empty until something else (focus, a
  // manual reload) revalidated it. This is the one place the two fetchers'
  // behaviour actually diverges instead of both landing on "no panel"; assert
  // ON that divergence rather than a rendered output the two shapes share.
  it('self-heals from a transient failure via SWR\'s built-in error retry — only reachable because jsonFetcher THROWS', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let call = 0
    global.fetch = vi.fn(async () => {
      call += 1
      // Both /api/desk/articles and /api/calendar hit this same mock; fail
      // the first wave (both requests), then heal.
      if (call <= 2) return { ok: false, status: 500, json: async () => ({}) }
      return {
        ok: true,
        status: 200,
        json: async () => ({ articles: [{ slug: 'sunday-scans-heal', title: 'Sunday Scans', url: '#' }] }),
      }
    })

    mount()
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByText(/sunday scans/i)).toBeNull()

    // SWR's default errorRetryInterval is 5000ms with jittered exponential
    // backoff (up to ~1.5x on the first retry) — 12s clears it with margin.
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000) })

    expect(screen.getByText(/sunday scans/i)).toBeTruthy()
  })
})
