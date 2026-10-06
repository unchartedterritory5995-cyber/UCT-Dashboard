// COV-01 — the seasonality tab, asserted on rendered text.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import SeasonalityTab from './SeasonalityTab'

const month = (m, label, avg, n, thin = false) => ({ month: m, label, avg_pct: avg, median_pct: avg, pct_up: 60, n, thin })
const DATA = {
  ticker: 'NVDA', covered_from: '2011-03-14', covered_to: '2026-09-30', full_months: 186, min_years: 5,
  months: [month(1, 'Jan', 3.21, 15), month(2, 'Feb', -1.5, 15), month(3, 'Mar', 0.8, 3, true)],
  weekdays: [{ weekday: 0, label: 'Mon', avg_pct: 0.12, median_pct: 0.1, pct_up: 54, n: 780 }],
}
let status
beforeEach(() => {
  status = 200
  global.fetch = vi.fn(() => Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(DATA) }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const renderTab = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <SeasonalityTab sym="nvda" />
  </SWRConfig>,
)

describe('SeasonalityTab', () => {
  it('states the window it covers', async () => {
    renderTab()
    expect((await screen.findByTestId('seasonality-window')).textContent)
      .toBe('NVDA since 2011 (186 full months of history), close to close.')
  })

  it('shows each month with its sign and its n', async () => {
    renderTab()
    await screen.findByTestId('seasonality')
    expect(screen.getByTestId('row-Jan').textContent).toContain('+3.21%')
    expect(screen.getByTestId('row-Jan').textContent).toContain('15')
    expect(screen.getByTestId('row-Feb').textContent).toContain('-1.50%')
    expect(screen.getByTestId('row-Mon').textContent).toContain('780')
  })

  it('marks a thin month instead of hiding it, and says why', async () => {
    renderTab()
    await screen.findByTestId('seasonality')
    expect(screen.getByTestId('row-Mar').textContent).toContain('*')
    expect(screen.getByTestId('seasonality-basis').textContent).toMatch(/Seen fewer than 5 times/)
    expect(screen.getByTestId('seasonality-basis').textContent).toMatch(/not a forecast/)
  })

  it('a failed request is unavailable, not an empty table', async () => {
    status = 503
    renderTab()
    expect((await screen.findByTestId('seasonality-unavailable')).textContent)
      .toMatch(/not a finding about NVDA/)
  })

  // Live sweep 2026-10-05: a cold open answered 503 + Retry-After ("still being read") and the
  // panel said "unavailable" for good. It now waits, says so, and fills in by itself.
  it('a history still being read waits, then fills in without a reopen', async () => {
    let calls = 0
    global.fetch = vi.fn(() => {
      calls += 1
      if (calls === 1) {
        return Promise.resolve({ ok: false, status: 503, headers: { get: (h) => (h === 'Retry-After' ? '2' : null) },
          json: () => Promise.resolve({}) })
      }
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve(DATA) })
    })
    renderTab()
    expect((await screen.findByTestId('seasonality-pending')).textContent).toMatch(/Reading the full daily history for NVDA/)
    expect(screen.queryByTestId('seasonality-unavailable')).toBeNull()
    expect(await screen.findByTestId('seasonality-window', {}, { timeout: 5000 })).toBeInTheDocument()
    const settled = calls
    await new Promise((r) => setTimeout(r, 2500))
    expect(calls).toBe(settled)          // it stops asking once it has the history
  })

  it('a 503 without a retry hint is still unavailable', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 503, headers: { get: () => null },
      json: () => Promise.resolve({}) }))
    renderTab()
    expect(await screen.findByTestId('seasonality-unavailable')).toBeInTheDocument()
  })

  // tq-panels: a symbol with no full month on file rendered two empty tables.
  it('a symbol with no full month says there is not enough history, and for what window', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, headers: { get: () => null },
      json: () => Promise.resolve({ ticker: 'NEWCO', covered_from: '2026-09-15', covered_to: '2026-10-02',
        full_months: 0, min_years: 5, months: [], weekdays: [] }) }))
    renderTab()
    const t = (await screen.findByTestId('seasonality-thin')).textContent
    expect(t).toMatch(/Not enough history for seasonality/)
    expect(t).toMatch(/from 2026-09-15 to 2026-10-02/)
    expect(screen.queryByText('By month')).toBeNull()
  })

  it('a symbol with no bars at all says we hold none', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, headers: { get: () => null },
      json: () => Promise.resolve({ ticker: 'NVDA', covered_from: null, covered_to: null,
        full_months: 0, min_years: 5, months: [], weekdays: [] }) }))
    renderTab()
    expect((await screen.findByTestId('seasonality-thin')).textContent).toMatch(/We hold no daily bars for NVDA/)
  })
})
