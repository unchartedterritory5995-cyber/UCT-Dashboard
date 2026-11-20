// The security headline for a currency pair (BTCUSD): SecurityHeadline.jsx + PairHeadline.jsx.
//   * a stock never asks about pairs, and its line is the stock line;
//   * BTCUSD with the switch off (404) gets the stock line, exactly as today;
//   * BTCUSD the server admits gets the pair line: price, change, the name, the SOURCE and that
//     source's own time for the price; none of the stock line's requests are made;
//   * no price is said in words, a held price after a failed read is marked, no time is said;
//   * the line never says "live" and never names a market session.
// Every price here is invented.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

const live = { prices: {} }
vi.mock('../../hooks/useLivePrices', () => ({ default: () => ({ prices: live.prices, isLoading: false }) }))
vi.mock('../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))
vi.mock('../../hooks/useVolumeCurve', () => ({ default: () => null }))

import SecurityHeadline from './SecurityHeadline'
import { expectNoAxeViolations } from '../../pages/journal-2-0/a11y/axeHarness'

const PAIRS = { source: 'FMP', pairs: [{ symbol: 'BTCUSD', name: 'Bitcoin', base: 'BTC', quote: 'USD' }] }
const QUOTE = { symbol: 'BTCUSD', source: 'FMP', state: 'fresh', price: 41234.5, change_pct: -1.2, as_of: 1794657600 }
const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const no = (status) => ({ ok: false, status, json: async () => ({ detail: 'Not Found' }) })
let routes
let fetchMock
beforeEach(() => {
  live.prices = {}
  routes = {}
  fetchMock = vi.fn(async (url, init) => {
    if (url in routes) return typeof routes[url] === 'number' ? no(routes[url]) : ok(routes[url])
    if (url === '/api/research/snapshot-batch') {
      const out = {}
      for (const t of JSON.parse(init.body).tickers) out[t] = { name: `${t} Corp` }
      return ok(out)
    }
    if (String(url).startsWith('/api/research/snapshot/')) return ok({ sym: 'BTCUSD', not_found: true, message: 'No data for BTCUSD: check the ticker', suggestions: [] })
    return no(404)
  })
  globalThis.fetch = fetchMock
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const fresh = (ui) => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{ui}</SWRConfig>)
const urls = () => fetchMock.mock.calls.map(([u]) => String(u))
const line = () => screen.getByTestId('security-headline')
const NOT_LIVE = /\blive\b|real.?time|streaming|at last close|pre-market|after hours/i

describe('a security that is not a pair', () => {
  it('a stock gets the stock line and no request about pairs', async () => {
    live.prices = { NVDA: { price: 182.4, change_pct: 3.1 } }
    fresh(<SecurityHeadline sym="NVDA" />)
    expect(screen.getByTestId('security-headline-price').textContent).toBe('182.40')
    expect(line().getAttribute('data-pair')).toBeNull()
    await waitFor(() => expect(urls()).toContain('/api/research/snapshot-batch'))
    expect(urls().filter((u) => u.startsWith('/api/crypto/'))).toEqual([])
  })

  it('the fund BTC is a stock here: no request about pairs', async () => {
    live.prices = { BTC: { price: 31.5, change_pct: 0.4 } }
    fresh(<SecurityHeadline sym="BTC" />)
    expect(screen.getByTestId('security-headline-price').textContent).toBe('31.50')
    await new Promise((r) => setTimeout(r, 20))
    expect(urls().filter((u) => u.startsWith('/api/crypto/'))).toEqual([])
  })

  it('BTCUSD with the switch off gets the stock line, as today, and never the quote', async () => {
    routes['/api/crypto/pairs'] = 404
    fresh(<SecurityHeadline sym="BTCUSD" />)
    await waitFor(() => expect(urls()).toContain('/api/crypto/pairs'))
    await waitFor(() => expect(urls().some((u) => u.startsWith('/api/research/snapshot'))).toBe(true))
    expect(line().getAttribute('data-pair')).toBeNull()
    expect(urls()).not.toContain('/api/crypto/quote/BTCUSD')
    expect(urls().filter((u) => u === '/api/crypto/pairs')).toHaveLength(1)
  })
})

describe('BTCUSD the server admits', () => {
  it('shows the price, the change, the name, the source and the source\'s own time', async () => {
    routes['/api/crypto/pairs'] = PAIRS
    routes['/api/crypto/quote/BTCUSD'] = QUOTE
    fresh(<SecurityHeadline sym="btcusd" />)
    await waitFor(() => expect(line().getAttribute('data-state')).toBe('priced'))
    expect(line().getAttribute('data-pair')).toBe('true')
    expect(screen.getByTestId('security-headline-price').textContent).toBe('41,234.50')
    expect(screen.getByTestId('security-headline-pct').textContent).toBe('▼−1.20%')
    expect(screen.getByTestId('security-headline-source').textContent).toBe('· FMP, as of Nov 14, 7:00 AM ET')
    expect(line().textContent).toContain('· Bitcoin')
    expect(line().textContent).not.toMatch(NOT_LIVE)
    expect(line().getAttribute('aria-label')).toBe('BTCUSD headline')
    await expectNoAxeViolations(document.body.firstElementChild)
  })

  it('once admitted, the stock line\'s requests stop and the quote is read', async () => {
    routes['/api/crypto/pairs'] = PAIRS
    routes['/api/crypto/quote/BTCUSD'] = QUOTE
    fresh(<><SecurityHeadline sym="BTCUSD" /><SecurityHeadline sym="BTCUSD" /></>)
    await waitFor(() => expect(screen.getAllByTestId('security-headline-source')).toHaveLength(2))
    expect(urls().filter((u) => u === '/api/crypto/pairs')).toHaveLength(1)        // two panels, one ask
    expect(urls().filter((u) => u === '/api/crypto/quote/BTCUSD')).toHaveLength(1)  // and one quote
    expect(urls().filter((u) => u.includes('volume-curve'))).toEqual([])
  })

  it('a quote with no time says so; a held price after a failed read is marked', async () => {
    routes['/api/crypto/pairs'] = PAIRS
    routes['/api/crypto/quote/BTCUSD'] = { ...QUOTE, as_of: null, state: 'failed' }
    fresh(<SecurityHeadline sym="BTCUSD" />)
    await waitFor(() => expect(line().getAttribute('data-state')).toBe('stale'))
    expect(screen.getByTestId('security-headline-source').textContent).toBe('· FMP, no time sent (last read failed)')
  })

  it('no price is said in words, never drawn as 0', async () => {
    routes['/api/crypto/pairs'] = PAIRS
    routes['/api/crypto/quote/BTCUSD'] = { symbol: 'BTCUSD', source: 'FMP', state: 'failed', price: null }
    fresh(<SecurityHeadline sym="BTCUSD" />)
    await waitFor(() => expect(line().getAttribute('data-state')).toBe('unavailable'))
    expect(line().textContent).toBe('No price for BTCUSD from FMP right now')
    expect(screen.queryByTestId('security-headline-price')).toBeNull()
  })

  it('the server still reading, and a failed quote read, are loading and unavailable', async () => {
    const quoteUrl = '/api/crypto/quote/BTCUSD'
    routes['/api/crypto/pairs'] = PAIRS
    routes[quoteUrl] = { symbol: 'BTCUSD', source: 'FMP', state: 'warming', price: null }
    fresh(<SecurityHeadline sym="BTCUSD" />)
    await waitFor(() => expect(line().getAttribute('data-pair')).toBe('true'))
    await waitFor(() => expect(urls()).toContain(quoteUrl))
    expect(line().getAttribute('data-state')).toBe('loading')
    expect(line().textContent).toBe('Loading the BTCUSD price…')
    cleanup()
    routes[quoteUrl] = 500
    fresh(<SecurityHeadline sym="BTCUSD" />)
    await waitFor(() => expect(line().getAttribute('data-state')).toBe('unavailable'))
  })
})

