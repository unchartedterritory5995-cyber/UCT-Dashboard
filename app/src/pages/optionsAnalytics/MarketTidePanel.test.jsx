import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import MarketTidePanel, { money, tidePaths, todayEt } from './MarketTidePanel'

// The payload is the shape api/services/options_analytics/market_tide.py returns for
// tests/fixtures/options_analytics/tape_*.csv (tests/test_options_market_tide.py hand-computes it).
const PAYLOAD = {
  session: '2026-10-02', scope: 'all', label: 'computed',
  minutes: [
    { t: '09:30', net_call_premium: 20000, net_put_premium: 38000, cum_net_call_premium: 20000, cum_net_put_premium: 38000, cum_net_premium: -18000, prints: 4 },
    { t: '09:31', net_call_premium: 0, net_put_premium: 0, cum_net_call_premium: 20000, cum_net_put_premium: 38000, cum_net_premium: -18000, prints: 1 },
    { t: '12:05', net_call_premium: 20000, net_put_premium: 40000, cum_net_call_premium: 40000, cum_net_put_premium: 78000, cum_net_premium: -38000, prints: 2 },
  ],
  totals: { net_call_premium: 40000, net_put_premium: 78000, net_premium: -38000 },
  prints_counted: 7, prints_unsigned: 1, prints_unreadable: 1,
  partial: true, partial_reasons: ['1 prints had no readable time, premium or call/put and are not counted.'],
  sources: { stocks: 'ok', etfs: 'ok' },
  filters: 'The flow tape records option prints of 50+ contracts and $10K+ premium; smaller prints are not on it and are not in this tide.',
  method: 'Each print\'s premium is signed by its side. Minutes are Eastern time.',
  stale: false,
}

function mount() {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><MarketTidePanel /></SWRConfig>)
}

function respond(status, body) {
  return Promise.resolve({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) })
}

describe('MarketTidePanel (FT-056)', () => {
  let calls
  beforeEach(() => { calls = [] })
  afterEach(() => { vi.unstubAllGlobals() })

  it('renders NOTHING while the switch is off (404)', async () => {
    vi.stubGlobal('fetch', vi.fn((u) => { calls.push(u); return respond(404, { detail: 'Not Found' }) }))
    const { container } = mount()
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    await waitFor(() => expect(container.querySelector('[data-testid="market-tide"]')).toBeNull())
  })

  it('states totals, the tape filters and the partial reason in words', async () => {
    vi.stubGlobal('fetch', vi.fn((u) => { calls.push(u); return respond(200, PAYLOAD) }))
    mount()
    const totals = await screen.findByTestId('market-tide-totals')
    expect(totals.textContent).toContain('2026-10-02 through 12:05 ET')
    expect(totals.textContent).toContain('net call premium +$40K')
    expect(totals.textContent).toContain('net put premium +$78K')
    expect(totals.textContent).toContain('net -$38K')
    expect(screen.getByTestId('market-tide-filters').textContent).toContain('50+ contracts and $10K+ premium')
    expect(screen.getByTestId('market-tide-filters').textContent).toContain('7 prints counted, 1 at the mid')
    expect(screen.getByTestId('market-tide-partial').textContent).toContain('no readable time')
    expect(screen.getByText('computed')).toBeTruthy()
    expect(screen.getByTestId('market-tide-chart')).toBeTruthy()
    expect(screen.getByTestId('market-tide-legend').textContent).toMatch(/Net call premium.*Net put premium.*Zero/)
  })

  it('live audit: a past session says plainly it is not today; today\'s session says nothing extra', async () => {
    vi.stubGlobal('fetch', vi.fn((u) => { calls.push(u); return respond(200, PAYLOAD) }))   // 2026-10-02
    const { unmount } = mount()
    expect((await screen.findByTestId('market-tide-old-session')).textContent)
      .toContain('This is the 2026-10-02 session, not today')
    unmount()
    vi.stubGlobal('fetch', vi.fn(() => respond(200, { ...PAYLOAD, session: todayEt() })))
    mount()
    await screen.findByTestId('market-tide-totals')
    expect(screen.queryByTestId('market-tide-old-session')).toBeNull()
  })

  it('todayEt() is the New York date, not the UTC one', () => {
    expect(todayEt(new Date('2026-10-06T02:30:00Z'))).toBe('2026-10-05')   // 22:30 ET on the 5th
  })

  it('a failed request says so, never an empty tide', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond(503, { detail: 'x' })))
    mount()
    expect((await screen.findByTestId('market-tide-unavailable')).textContent).toContain('does not mean the tape is quiet')
  })

  it('a body that is not a tide renders nothing and does not throw (mounted on Options Flow)', async () => {
    vi.stubGlobal('fetch', vi.fn((u) => { calls.push(u); return respond(200, { rows: [] }) }))
    const { container } = mount()
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    await waitFor(() => expect(container.querySelector('[data-testid="market-tide"]')).toBeNull())
  })

  it('the scope buttons ask the server for that scope', async () => {
    vi.stubGlobal('fetch', vi.fn((u) => { calls.push(u); return respond(200, PAYLOAD) }))
    mount()
    await screen.findByTestId('market-tide-totals')
    fireEvent.click(screen.getByRole('button', { name: 'ETFs' }))
    await waitFor(() => expect(calls.some((u) => u.endsWith('scope=etfs'))).toBe(true))
  })

  it('money() signs and scales; tidePaths needs two minutes', () => {
    expect(money(40000)).toBe('+$40K')
    expect(money(-1_250_000)).toBe('-$1.3M')
    expect(money(0)).toBe('$0')
    expect(tidePaths(PAYLOAD.minutes.slice(0, 1))).toBeNull()
    expect(tidePaths(PAYLOAD.minutes).call.startsWith('M')).toBe(true)
  })
})
