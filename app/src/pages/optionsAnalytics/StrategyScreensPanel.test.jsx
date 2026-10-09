import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import StrategyScreensPanel, { MoreStrategyScreens } from './StrategyScreensPanel'

// Shapes from api/services/options_analytics/strategy_screens.py (tests/test_options_strategy_screens.py).
const CATALOG = { strategies: [{ id: 'covered_calls', label: 'Covered calls' }, { id: 'bull_put_spreads', label: 'Bull put spreads' }] }
const CC = { strategy: 'covered_calls', description: 'Calls 0-10% OTM.', session: '2026-10-02', data_basis: 'end-of-day snapshot',
  fill: 'Short legs at the logged bid.', matches: 1, candidates_read: 2,
  rows: [{ underlying: 'TST', type: 'call', strike: 105, expiration: '2026-11-01', bid: 1.2, premium_yield_pct: 1.2, annualized_pct: 14.6, if_called_pct: 6.2 }] }
const BPS = { strategy: 'bull_put_spreads', description: 'Sell a put.', session: '2026-10-02', data_basis: 'end-of-day snapshot',
  fill: 'Short legs at the logged bid.', matches: 1, candidates_read: 1,
  rows: [{ underlying: 'TST', expiration: '2026-11-01', short: { type: 'put', strike: 95 }, long: { type: 'put', strike: 92 },
    credit: 0.6, max_profit: 0.6, max_loss: 2.4, return_on_risk_pct: 25 }] }

function stub(map) {
  vi.stubGlobal('fetch', vi.fn((u) => {
    const hit = Object.entries(map).find(([k]) => u.includes(k))
    const [status, body] = hit ? hit[1] : [404, {}]
    return Promise.resolve({ status, ok: status === 200, json: () => Promise.resolve(body) })
  }))
}
// a catalog fetch that never settles -- used to observe the loading state before it resolves.
function stubPending() {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
}
const mount = () => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><StrategyScreensPanel /></SWRConfig>)
const mountMore = () => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><MoreStrategyScreens /></SWRConfig>)

describe('StrategyScreensPanel (FT-072/073)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('typing tickers asks for the screen ONCE, after typing pauses -- not once per keystroke', async () => {
    stub({ '/strategies': [200, CATALOG], '/strategy/covered_calls': [200, CC] })
    mount()
    await screen.findByTestId('strategy-basis')
    const box = screen.getByLabelText('Limit to tickers')
    vi.useFakeTimers()
    try {
      for (const v of ['N', 'NV', 'NVD', 'NVDA', 'NVDA,', 'NVDA,A', 'NVDA,AM', 'NVDA,AMD']) {
        fireEvent.change(box, { target: { value: v } })
        act(() => { vi.advanceTimersByTime(60) })
      }
      act(() => { vi.advanceTimersByTime(1000) })
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() => expect(fetch.mock.calls.some(([u]) => u.includes('underlyings=NVDA%2CAMD'))).toBe(true))
    const filtered = fetch.mock.calls.map(([u]) => u).filter((u) => u.includes('underlyings='))
    expect(filtered).toEqual([expect.stringContaining('underlyings=NVDA%2CAMD')])
  })

  it('dark: nothing', async () => {
    stub({})
    const { container } = mount()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.querySelector('[data-testid="strategy-screens"]')).toBeNull()
  })

  it('names the session, the end-of-day basis and the fill, then the rows', async () => {
    stub({ '/strategies': [200, CATALOG], '/strategy/covered_calls': [200, CC], '/strategy/bull_put_spreads': [200, BPS] })
    mount()
    expect((await screen.findByTestId('strategy-basis')).textContent).toContain('Session 2026-10-02, end-of-day snapshot')
    expect(screen.getByTestId('strategy-screens').textContent).toContain('14.6%')
    fireEvent.change(screen.getByLabelText('Strategy'), { target: { value: 'bull_put_spreads' } })
    await waitFor(() => expect(screen.getByTestId('strategy-screens').textContent).toContain('sell put 95.00 / buy put 92.00'))
    expect(screen.getByTestId('strategy-screens').textContent).toContain('25.0%')
  })

  it('while a strategy results read is in flight it says so, never a header over an empty body', async () => {
    vi.stubGlobal('fetch', vi.fn((u) => (u.includes('/strategies')
      ? Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(CATALOG) })
      : new Promise(() => {}))))
    mount()
    expect((await screen.findByTestId('strategy-loading')).textContent).toBe('Loading the screen…')
    expect(screen.queryByTestId('strategy-basis')).toBeNull()
  })

  it('a failed screen says it is not "nothing matched"', async () => {
    stub({ '/strategies': [200, CATALOG], '/strategy/': [503, { detail: 'x' }] })
    mount()
    expect((await screen.findByTestId('strategy-unavailable')).textContent).toContain('not "nothing matched"')
  })

  it('a failed CATALOG (outage) is distinct from an empty one: shows an unavailable state, not nothing', async () => {
    stub({ '/strategies': [503, { detail: 'x' }] })
    mount()
    expect((await screen.findByTestId('strategy-catalog-unavailable')).textContent).toContain('not "nothing matched"')
  })

  it('a genuinely empty catalog (200, strategies absent) renders nothing, same as before', async () => {
    stub({ '/strategies': [200, {}] })
    const { container } = mount()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.querySelector('[data-testid="strategy-screens"]')).toBeNull()
    expect(container.querySelector('[data-testid="strategy-catalog-unavailable"]')).toBeNull()
  })

  it('a still-loading catalog renders nothing yet (not the outage state)', async () => {
    stubPending()
    const { container } = mount()
    expect(container.querySelector('[data-testid="strategy-screens"]')).toBeNull()
    expect(container.querySelector('[data-testid="strategy-catalog-unavailable"]')).toBeNull()
  })
})

describe('MoreStrategyScreens (FT-073) — catalog outage vs empty vs loading', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('a failed catalog (outage) shows an unavailable state, not nothing', async () => {
    stub({ '/more-strategies': [503, { detail: 'x' }] })
    mountMore()
    expect((await screen.findByTestId('more-catalog-unavailable')).textContent).toContain('not "nothing matched"')
  })

  it('a genuinely empty catalog (200, strategies absent) renders nothing', async () => {
    stub({ '/more-strategies': [200, {}] })
    const { container } = mountMore()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.querySelector('[data-testid="more-strategy-screens"]')).toBeNull()
    expect(container.querySelector('[data-testid="more-catalog-unavailable"]')).toBeNull()
  })

  it('a still-loading catalog renders nothing yet (not the outage state)', async () => {
    stubPending()
    const { container } = mountMore()
    expect(container.querySelector('[data-testid="more-strategy-screens"]')).toBeNull()
    expect(container.querySelector('[data-testid="more-catalog-unavailable"]')).toBeNull()
  })
})
