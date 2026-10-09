// Wave 5: the headline's next-earnings field says BMO / AMC when the calendar data the server
// already has cached for that day knows the session. It rides the SAME batch request (one
// fetch for two panels on a ticker), asking with `session: true`; an unknown session shows the
// date alone.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

const live = { prices: {} }
vi.mock('../../hooks/useLivePrices', () => ({ default: () => ({ prices: live.prices, isLoading: false }) }))
vi.mock('../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: true, isPremarket: false, isExtended: false }) }))

import SecurityHeadline, { headlineKey } from './SecurityHeadline'

const SESSION = { NVDA: 'amc', AAPL: 'bmo', MSFT: null }
let fetchMock
beforeEach(() => {
  fetchMock = vi.fn(async (url, init) => {
    const body = JSON.parse(init.body)
    const out = {}
    for (const t of body.tickers) {
      out[t] = { name: `${t} Corp`, next_earnings: '2099-11-19', avg_vol_20d: 1_000_000,
        ...(body.session ? { next_earnings_session: SESSION[t] ?? null } : {}) }
    }
    return { ok: true, json: async () => out }
  })
  globalThis.fetch = fetchMock
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const fresh = (ui) => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 60000 }}>{ui}</SWRConfig>)

describe('SecurityHeadline earnings session', () => {
  it('an after-close report reads "earnings Thu Nov 19 AMC", with the long form for assistive tech', async () => {
    live.prices = { NVDA: { price: 182.4, change_pct: 1 } }
    fresh(<SecurityHeadline sym="NVDA" />)
    const tag = await screen.findByTestId('security-headline-earn-session')
    expect(tag.textContent).toBe('AMC')
    expect(tag.getAttribute('title')).toBe('after the market closes')
    expect(screen.getByTestId('security-headline-earn').textContent).toMatch(/earnings Thu Nov 19 AMC$/)
  })

  it('a before-open report reads BMO', async () => {
    live.prices = { AAPL: { price: 1, change_pct: 0 } }
    fresh(<SecurityHeadline sym="AAPL" />)
    expect((await screen.findByTestId('security-headline-earn-session')).textContent).toBe('BMO')
  })

  it('an unknown session shows the date alone', async () => {
    live.prices = { MSFT: { price: 1, change_pct: 0 } }
    fresh(<SecurityHeadline sym="MSFT" />)
    await waitFor(() => expect(screen.getByTestId('security-headline-earn').textContent).toContain('Thu Nov 19'))
    expect(screen.queryByTestId('security-headline-earn-session')).toBeNull()
  })

  it('asks for the session on the one shared request, never a second fetch', async () => {
    live.prices = { NVDA: { price: 1, change_pct: 0 } }
    fresh(<><SecurityHeadline sym="NVDA" /><SecurityHeadline sym="NVDA" /></>)
    await waitFor(() => expect(screen.getAllByTestId('security-headline-earn-session')).toHaveLength(2))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ tickers: ['NVDA'], session: true })
    expect(headlineKey('NVDA')).not.toEqual(['/api/research/snapshot-batch', ['NVDA']])
  })
})
