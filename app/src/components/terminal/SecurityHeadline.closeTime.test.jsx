// Wave 4 #3: a closed-market price says WHEN it was set ("at the 4:00 PM ET close").
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

const live = { prices: {} }
vi.mock('../../hooks/useLivePrices', () => ({ default: () => ({ prices: live.prices, isLoading: false }) }))
const market = { isOpen: false, isPremarket: false, isExtended: false }
vi.mock('../../hooks/useMarketOpen', () => ({ default: () => market }))

import SecurityHeadline, { closeClause, etClock } from './SecurityHeadline'

let fetchMock
let presence
beforeEach(() => {
  live.prices = {}
  Object.assign(market, { isOpen: false, isPremarket: false, isExtended: false })
  presence = { sym: 'ZZQXV', name: 'ZZQXV', not_found: true, message: 'No data for ZZQXV — check the ticker', suggestions: ['ZQXV', 'ZZQX'] }
  fetchMock = vi.fn(async (url, init) => {
    if (url === '/api/research/snapshot-batch') {
      const { tickers } = JSON.parse(init.body)
      const out = {}
      for (const t of tickers) out[t] = t.startsWith('ZZ') ? { name: null } : { name: `${t} Corp` }
      return { ok: true, status: 200, json: async () => out }
    }
    if (url.startsWith('/api/research/snapshot/')) return { ok: true, status: 200, json: async () => presence }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  globalThis.fetch = fetchMock
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const fresh = (ui) => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 60000 }}>{ui}</SWRConfig>)
const ET_CLOSE = (y, m, d, h = 16) => Date.UTC(y, m - 1, d, h + 4) / 1000   // EDT (UTC-4)

describe('SecurityHeadline — the closed-market time (wave 4 #3)', () => {
  it('closeClause: today is "at the 4:00 PM ET close", an older close names its day', () => {
    const fri = ET_CLOSE(2026, 10, 9)
    expect(closeClause({ session_close_at: fri }, new Date('2026-10-09T22:00:00Z'))).toBe('at the 4:00 PM ET close')
    expect(closeClause({ session_close_at: fri }, new Date('2026-10-11T15:00:00Z'))).toBe('at the Fri 4:00 PM ET close')
    // a half-day closes at 1:00 PM ET (EST in late November: UTC-5)
    expect(closeClause({ session_close_at: Date.UTC(2026, 10, 27, 18) / 1000 }, new Date('2026-11-28T15:00:00Z')))
      .toBe('at the Fri 1:00 PM ET close')
    expect(closeClause({ session_close_at: null })).toBe('at last close')
    expect(closeClause({})).toBe('at last close')
  })

  it('the strip renders the close time when the row carries it', () => {
    live.prices = { NVDA: { price: 180, change_pct: -1.2, market_closed: true, session_close_at: ET_CLOSE(2026, 10, 9) } }
    fresh(<SecurityHeadline sym="NVDA" />)
    expect(screen.getByTestId('security-headline-session').textContent).toMatch(/^at the (Fri )?4:00 PM ET close$/)
  })

  it('an extended-hours print names its own ET time', () => {
    Object.assign(market, { isExtended: true })
    live.prices = { NVDA: { price: 180, change_pct: 1, ext_session: 'afterhours', ext_price: 181.5, observed_at: Date.UTC(2026, 9, 9, 22, 42) / 1000 } }
    fresh(<SecurityHeadline sym="NVDA" />)
    expect(screen.getByTestId('security-headline-session').textContent).toBe('after hours 181.50 at 6:42 PM ET')
  })

  it('etClock refuses junk', () => {
    expect(etClock(null)).toBeNull()
    expect(etClock(Number.NaN)).toBeNull()
    expect(etClock(0)).toBeNull()
  })
})
