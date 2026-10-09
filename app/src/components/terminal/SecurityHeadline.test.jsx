// Wave 3 (#2): the one-line security headline every one-stock terminal panel carries.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

const live = { prices: {} }
vi.mock('../../hooks/useLivePrices', () => ({ default: () => ({ prices: live.prices, isLoading: false }) }))
const market = { isOpen: true, isPremarket: false, isExtended: false }
vi.mock('../../hooks/useMarketOpen', () => ({ default: () => market }))

import SecurityHeadline, { fmtEarnings, fmtPct, headlineKey, sessionClause, volRatio } from './SecurityHeadline'

let fetchMock
beforeEach(() => {
  live.prices = {}
  Object.assign(market, { isOpen: true, isPremarket: false, isExtended: false })
  fetchMock = vi.fn(async (url, init) => {
    const { tickers } = JSON.parse(init.body)
    const out = {}
    for (const t of tickers) {
      out[t] = t === 'ZZZQ'
        ? { name: null, next_earnings: null, avg_vol_20d: null }
        : { name: `${t} Corp`, next_earnings: '2099-11-19', avg_vol_20d: 1_000_000 }
    }
    return { ok: true, json: async () => out }
  })
  globalThis.fetch = fetchMock
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const fresh = (ui) => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 60000 }}>{ui}</SWRConfig>)

describe('SecurityHeadline', () => {
  it('shows price, % change, volume vs average and the next earnings date', async () => {
    live.prices = { NVDA: { price: 182.4, change_pct: 3.1, volume: 2_400_000 } }
    fresh(<SecurityHeadline sym="nvda" />)
    expect(screen.getByTestId('security-headline-price').textContent).toBe('182.40')
    expect(screen.getByTestId('security-headline-pct').textContent).toContain('+3.10%')
    await waitFor(() => expect(screen.getByTestId('security-headline-vol').textContent).toContain('2.4× avg'))
    expect(screen.getByTestId('security-headline-earn').textContent).toContain('Thu Nov 19')
    expect(screen.getByTestId('security-headline').getAttribute('data-state')).toBe('live')
    expect(screen.queryByTestId('security-headline-session')).toBeNull()
  })

  it('two panels on the same ticker make ONE snapshot request (shared SWR key)', async () => {
    live.prices = { NVDA: { price: 1, change_pct: 0 } }
    fresh(<><SecurityHeadline sym="NVDA" /><SecurityHeadline sym="NVDA" /></>)
    await waitFor(() => expect(screen.getAllByTestId('security-headline-earn')).toHaveLength(2))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/research/snapshot-batch')
    expect(headlineKey('nvda')).toEqual(headlineKey('NVDA'))
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
  it('volume ratio and percent', () => {
    expect(volRatio(2_400_000, 1_000_000)).toBe('2.4×')
    expect(volRatio(5, 0)).toBeNull()
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
