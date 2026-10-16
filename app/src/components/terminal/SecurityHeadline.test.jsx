// Wave 3 (#2): the one-line security headline every one-stock terminal panel carries.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

const live = { prices: {} }
vi.mock('../../hooks/useLivePrices', () => ({ default: () => ({ prices: live.prices, isLoading: false }) }))
const market = { isOpen: true, isPremarket: false, isExtended: false }
vi.mock('../../hooks/useMarketOpen', () => ({ default: () => market }))

import SecurityHeadline, { fmtEarnings, fmtPct, headlineKey, headlineRvol, sessionClause } from './SecurityHeadline'

// RVOL is "volume vs usual by this time of day" (lib/volumeCurve.js), from ONE
// /api/screener/volume-curve?tickers=SYM request. The clock is pinned to 10:42 ET on the
// payload's session day, 72 minutes in: the market curve's share is 72/390, NVDA's own
// (front-loaded) curve's is 14.4/39.
const LINEAR = Array.from({ length: 391 }, (_, m) => m / 390)
const FRONT_KNOTS = Array.from({ length: 79 }, (_, k) => Math.min(1, k / 39))
const curvePayload = (ticker_knots = {}) => ({
  curve: LINEAR, session: { date: '2026-08-24', open_min: 570, close_min: 960 },
  suppress_first_min: 15, full_session_min: 390, bar_min: 5, ticker_knots,
})
const AT_1042 = new Date('2026-08-24T14:42:00Z')
const curve = { knots: {} }
const isCurve = (u) => String(u).startsWith('/api/screener/volume-curve')

let fetchMock
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(AT_1042)
  live.prices = {}
  curve.knots = {}
  Object.assign(market, { isOpen: true, isPremarket: false, isExtended: false })
  fetchMock = vi.fn(async (url, init) => {
    if (isCurve(url)) return { ok: true, json: async () => curvePayload(curve.knots) }
    const { tickers } = JSON.parse(init.body)
    const out = {}
    for (const t of tickers) {
      out[t] = t === 'ZZZQ'
        ? { name: null, next_earnings: null, avg_vol_20d: null, avg_vol_30d: null }
        : { name: `${t} Corp`, next_earnings: '2099-11-19', avg_vol_20d: 1_000_000, avg_vol_30d: 2_000_000 }
    }
    return { ok: true, json: async () => out }
  })
  globalThis.fetch = fetchMock
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

const fresh = (ui) => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 60000 }}>{ui}</SWRConfig>)

describe('SecurityHeadline', () => {
  it('shows price, % change, RVOL (volume vs usual by now) and the next earnings date', async () => {
    live.prices = { NVDA: { price: 182.4, change_pct: 3.1, volume: 3_000_000 } }
    fresh(<SecurityHeadline sym="nvda" />)
    expect(screen.getByTestId('security-headline-price').textContent).toBe('182.40')
    expect(screen.getByTestId('security-headline-pct').textContent).toContain('+3.10%')
    // 3e6 / (2e6 x 72/390) = 8.13 -> "8.1x". The old raw 20-day ratio read "3.0x avg".
    await waitFor(() => expect(screen.getByTestId('security-headline-vol').textContent).toBe('· RVOL 8.1x'))
    expect(screen.getByTestId('security-headline-vol').getAttribute('title')).toBe('Volume vs usual by this time of day')
    expect(screen.getByTestId('security-headline-earn').textContent).toContain('Thu Nov 19')
    expect(screen.getByTestId('security-headline').getAttribute('data-state')).toBe('live')
    expect(screen.queryByTestId('security-headline-session')).toBeNull()
  })

  it('two panels on the same ticker make ONE snapshot request and ONE curve request (shared SWR keys)', async () => {
    live.prices = { NVDA: { price: 1, change_pct: 0 } }
    fresh(<><SecurityHeadline sym="NVDA" /><SecurityHeadline sym="NVDA" /></>)
    await waitFor(() => expect(screen.getAllByTestId('security-headline-earn')).toHaveLength(2))
    await waitFor(() => expect(fetchMock.mock.calls.filter(([u]) => isCurve(u))).toHaveLength(1))
    const snaps = fetchMock.mock.calls.filter(([u]) => !isCurve(u))
    expect(snaps).toHaveLength(1)
    expect(snaps[0][0]).toBe('/api/research/snapshot-batch')
    expect(fetchMock.mock.calls.find(([u]) => isCurve(u))[0]).toBe('/api/screener/volume-curve?tickers=NVDA')
    expect(headlineKey('nvda')).toEqual(headlineKey('NVDA'))
  })

  it("uses the symbol's OWN curve when the payload carries one", async () => {
    curve.knots = { NVDA: FRONT_KNOTS }
    live.prices = { NVDA: { price: 182.4, change_pct: 3.1, volume: 3_000_000 } }
    fresh(<SecurityHeadline sym="NVDA" />)
    // 3e6 / (2e6 x 14.4/39) = 4.06 -> "4.1x"
    await waitFor(() => expect(screen.getByTestId('security-headline-vol').textContent).toBe('· RVOL 4.1x'))
  })

  it('RVOL is blank before 09:45 ET', async () => {
    vi.setSystemTime(new Date('2026-08-24T13:44:00Z'))
    live.prices = { NVDA: { price: 182.4, change_pct: 3.1, volume: 3_000_000 } }
    fresh(<SecurityHeadline sym="NVDA" />)
    await waitFor(() => expect(screen.getByTestId('security-headline-earn')).toBeTruthy())
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => isCurve(u))).toBe(true))
    expect(screen.queryByTestId('security-headline-vol')).toBeNull()
  })

  it('a closed market is labelled "at last close" and greyed', () => {
    live.prices = { NVDA: { price: 180, change_pct: -1.2, market_closed: true } }
    Object.assign(market, { isOpen: false })
    fresh(<SecurityHeadline sym="NVDA" />)
    expect(screen.getByTestId('security-headline-session').textContent).toBe('at last close')
    expect(screen.getByTestId('security-headline').getAttribute('data-state')).toBe('closed')
    expect(screen.getByTestId('security-headline-pct').textContent).toContain('−1.20%')
  })

  it('an unknown ticker says so instead of loading forever or crashing', async () => {
    fresh(<SecurityHeadline sym="ZZZQ" />)
    expect(screen.getByTestId('security-headline').getAttribute('data-state')).toBe('loading')
    await waitFor(() => expect(screen.getByTestId('security-headline').getAttribute('data-state')).toBe('unknown'))
    expect(screen.getByTestId('security-headline').textContent).toContain('No quote found for ZZZQ')
  })

  it('missing / NaN fields drop their clause, never print NaN', () => {
    live.prices = { NVDA: { price: 10, change_pct: Number.NaN, volume: null } }
    fresh(<SecurityHeadline sym="NVDA" />)
    expect(screen.getByTestId('security-headline').textContent).not.toMatch(/NaN|undefined/)
    expect(screen.queryByTestId('security-headline-pct')).toBeNull()
    expect(screen.queryByTestId('security-headline-vol')).toBeNull()
  })
})

describe('headline formatting', () => {
  it('earnings: a calendar date is shown as that day (no timezone shift); a past date is not "next"', () => {
    const now = new Date('2026-10-09T15:00:00Z')
    expect(fmtEarnings('2026-11-19', now)).toBe('Thu Nov 19')
    expect(fmtEarnings('2026-10-01', now)).toBeNull()
    // 01:00 UTC on Nov 20 is still Nov 19 in New York.
    expect(fmtEarnings('2026-11-20T01:00:00Z', now)).toBe('Thu Nov 19')
    expect(fmtEarnings('garbage', now)).toBeNull()
  })
  it('RVOL and percent', () => {
    const p = curvePayload()
    expect(headlineRvol(p, 'NVDA', 3_000_000, 2_000_000, AT_1042)).toBe('8.1x')
    expect(headlineRvol(p, 'NVDA', 3_000_000, 0, AT_1042)).toBeNull()
    expect(headlineRvol(null, 'NVDA', 3_000_000, 2_000_000, AT_1042)).toBeNull()
    expect(fmtPct(0)).toBe('0.00%')
  })
  it('session clause', () => {
    expect(sessionClause({}, { isOpen: true })).toBeNull()
    expect(sessionClause({ market_closed: true }, { isOpen: true })).toBe('at last close')
    expect(sessionClause({ ext_session: 'premarket' }, { isOpen: false, isPremarket: true })).toBe('pre-market')
    expect(sessionClause({ ext_session: 'afterhours' }, { isOpen: false, isExtended: true })).toBe('after hours')
    expect(sessionClause({}, { isOpen: false })).toBe('at last close')
  })
})
