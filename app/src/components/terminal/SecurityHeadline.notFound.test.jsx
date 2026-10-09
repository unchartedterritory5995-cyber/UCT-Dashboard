// Wave 4 #1: the headline says the server's own "not a ticker" verdict, with suggestions.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'

const live = { prices: {} }
vi.mock('../../hooks/useLivePrices', () => ({ default: () => ({ prices: live.prices, isLoading: false }) }))
const market = { isOpen: false, isPremarket: false, isExtended: false }
vi.mock('../../hooks/useMarketOpen', () => ({ default: () => market }))

import SecurityHeadline from './SecurityHeadline'

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

describe('SecurityHeadline — unknown ticker (wave 4 #1)', () => {
  it('shows the server message and clickable suggestions instead of a blank line', async () => {
    const onRun = vi.fn()
    fresh(<SecurityHeadline sym="zzqxv" onRun={onRun} />)
    await waitFor(() => expect(screen.getByTestId('security-headline').getAttribute('data-state')).toBe('not-found'))
    expect(screen.getByTestId('security-headline').textContent).toContain('No data for ZZQXV — check the ticker')
    fireEvent.click(screen.getByRole('button', { name: 'Load ZQXV' }))
    expect(onRun).toHaveBeenCalledWith('$ZQXV')
  })

  it('outside a run context the suggestions are plain names, never dead buttons', async () => {
    fresh(<SecurityHeadline sym="ZZQXV" />)
    await waitFor(() => expect(screen.getByTestId('ticker-suggestion-ZZQX')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /Load/ })).toBeNull()
  })

  it('without the marker it keeps the old "No quote found" line', async () => {
    presence = { sym: 'ZZQXV', name: 'ZZQXV' }
    fresh(<SecurityHeadline sym="ZZQXV" />)
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === '/api/research/snapshot/ZZQXV')).toBe(true))
    await waitFor(() => expect(screen.getByTestId('security-headline').getAttribute('data-state')).toBe('unknown'))
    expect(screen.getByTestId('security-headline').textContent).toContain('No quote found for ZZQXV')
  })

  it('a real ticker never pays for the presence read', async () => {
    live.prices = { NVDA: { price: 180, change_pct: 1 } }
    fresh(<SecurityHeadline sym="NVDA" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 30))
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual(['/api/research/snapshot-batch'])
  })
})
