// Completeness audit 2026-10-07, ERROR/RETRY gap 5 (SEAS): Retry did not reset the re-ask counter,
// so once the automatic re-asks were spent a Retry fetched once and left the panel on
// "unavailable" for good; and the fetcher read every answer twice.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import SeasonalityTab, { PENDING_TRIES } from './SeasonalityTab'

const DATA = {
  ticker: 'NVDA', covered_from: '2011-03-14', covered_to: '2026-09-30', full_months: 186, min_years: 5,
  months: [{ month: 1, label: 'Jan', avg_pct: 1, median_pct: 1, pct_up: 60, n: 15, thin: false }],
  weekdays: [{ weekday: 0, label: 'Mon', avg_pct: 0.1, median_pct: 0.1, pct_up: 54, n: 780 }],
}
// Alternating hints make each pending answer a NEW value, so the re-asks run on the old code
// too and the Retry case below fails there for the reason it names (the counter), not a stall.
let hint = 0
const pending = () => {
  hint += 1
  const ra = hint % 2 ? '2' : '3'
  return Promise.resolve({ ok: false, status: 503, headers: { get: (h) => (h === 'Retry-After' ? ra : null) },
    json: () => Promise.resolve({}) })
}

const renderTab = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <SeasonalityTab sym="nvda" />
  </SWRConfig>,
)

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('SeasonalityTab retry', () => {
  it('an answer is read ONCE, not fetched a second time by the fallback fetcher', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, headers: { get: () => null },
      json: () => Promise.resolve(DATA) }))
    renderTab()
    await screen.findByTestId('seasonality-window')
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('a non-transient failure is read once and said, with a Retry', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500, headers: { get: () => null },
      json: () => Promise.resolve({}) }))
    renderTab()
    await screen.findByTestId('seasonality-unavailable')
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('Retry after the re-asks are spent starts them again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    global.fetch = vi.fn(pending)
    renderTab()
    await screen.findByTestId('seasonality-pending')
    for (let i = 0; i < PENDING_TRIES + 1 && !screen.queryByTestId('seasonality-unavailable'); i += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    }
    expect(screen.getByTestId('seasonality-unavailable')).toBeTruthy()
    const spent = global.fetch.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    // the panel is waiting again, not stuck on "unavailable" after one fetch
    expect(await screen.findByTestId('seasonality-pending')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    expect(global.fetch.mock.calls.length).toBeGreaterThan(spent + 1)
  })
})
