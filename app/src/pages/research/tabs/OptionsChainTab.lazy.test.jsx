// Audit 2026-10-08 (OMON P2, points 1/17): the chain used to mount a dozen sub-panels at once,
// each firing its own read. They sit in folded groups now and read only when a group is opened.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import OptionsChainTab from './OptionsChainTab'

const CHAIN = {
  ticker: 'SPY', expiration: '2026-10-23', spot: 764.2, cache_seconds: 60,
  calls: [{ strike: 760, bid: 21.1, ask: 21.4, iv: 0.1462 }], puts: [{ strike: 760, bid: 17.0, ask: 17.3, iv: 0.151 }],
}
let urls
beforeEach(() => {
  urls = []
  global.fetch = vi.fn((url) => {
    const u = String(url)
    urls.push(u)
    const ok = (b) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(b) })
    if (u.includes('/expirations')) return ok({ expirations: ['2026-10-23'] })
    if (u.includes('/chain?')) return ok(CHAIN)
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const open = (el) => { el.open = true; fireEvent(el, new Event('toggle')) }
const renderTab = (p = {}) => render(
  <MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><OptionsChainTab sym="spy" {...p} /></SWRConfig></MemoryRouter>,
)
const DEFERRED = [/strategy-finder/, /\/edge\?/, /spread-book/, /\/builder$/, /\/probability\?/, /\/surface\?/, /rr-bf/, /surface-3d/,
  /iv-history/, /\/api\/options\/vol\/[^/]+\/(?!iv-rank)/, /\/api\/options\/positioning\//, /options-history/]

describe('OptionsChainTab first load', () => {
  it('the folded groups fire none of their reads until opened', async () => {
    renderTab({ volSurface: true, backtest: true })
    await screen.findByTestId('options-chain')
    await new Promise((r) => setTimeout(r, 30))
    const early = urls.filter((u) => DEFERRED.some((re) => re.test(u)))
    expect(early).toEqual([])
    expect(screen.queryByTestId('vol-surface')).toBeNull()
    expect(screen.queryByTestId('backtest')).toBeNull()
  })

  it('opening the Volatility group mounts the surface and reads it', async () => {
    renderTab({ volSurface: true })
    open(await screen.findByTestId('chain-group-vol'))
    await waitFor(() => expect(urls.some((u) => u.includes('/surface'))).toBe(true))
    expect(screen.getByTestId('chain-group-vol').textContent).toMatch(/implied-vol surface/i)
  })

  it('opening History & positioning shows the backtest when switched on', async () => {
    renderTab({ backtest: true })
    open(await screen.findByTestId('chain-group-history'))
    expect(await screen.findByTestId('backtest')).toBeTruthy()
  })
})
