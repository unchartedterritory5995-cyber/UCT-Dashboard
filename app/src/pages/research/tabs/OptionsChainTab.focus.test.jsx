// Audit 2026-10-08 (OVS P1, point 17): `NVDA OVS` opened the whole option chain with the vol
// surface about six panels down. The OVS code now passes focus="surface": the surface leads and
// the chain folds beneath it, read only when opened.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import OptionsChainTab from './OptionsChainTab'
import { FUNCTIONS } from '../../terminal/functions'

const CHAIN = {
  ticker: 'SPY', expiration: '2026-10-23', spot: 764.2, cache_seconds: 60,
  calls: [{ strike: 760, bid: 21.1, ask: 21.4, iv: 0.1462 }], puts: [{ strike: 760, bid: 17.0, ask: 17.3, iv: 0.151 }],
}
beforeEach(() => {
  global.fetch = vi.fn((url) => {
    const u = String(url)
    const ok = (b) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(b) })
    if (u.includes('/expirations')) return ok({ expirations: ['2026-10-23'] })
    if (u.includes('/chain?')) return ok(CHAIN)
    return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const renderTab = (p) => render(
  <MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><OptionsChainTab sym="spy" volSurface {...p} /></SWRConfig></MemoryRouter>,
)

describe('OVS opens on the vol surface', () => {
  it('the registry sends OVS with focus="surface"', () => {
    const ovs = FUNCTIONS.find((f) => f.code === 'OVS')
    expect(ovs.ticker.props).toMatchObject({ volSurface: true, focus: 'surface' })
  })

  it('focus="surface": the surface is up front and the chain grid is folded', async () => {
    renderTab({ focus: 'surface' })
    expect(await screen.findByTestId('vol-unavailable')).toBeTruthy()   // the surface panel mounted, no group opened
    expect(screen.queryByTestId('atm-row')).toBeNull()
    const g = screen.getByTestId('chain-group-chain')
    g.open = true; fireEvent(g, new Event('toggle'))
    expect(await screen.findByTestId('atm-row')).toBeTruthy()
    // the surface is not repeated inside the Volatility group
    expect(screen.getByTestId('chain-group-vol').querySelector('summary').textContent).not.toMatch(/surface/)
  })

  it('OMON (no focus) still leads with the chain', async () => {
    renderTab({})
    expect(await screen.findByTestId('atm-row')).toBeTruthy()
    expect(screen.queryByTestId('chain-group-chain')).toBeNull()
    expect(screen.queryByTestId('vol-unavailable')).toBeNull()
  })
})
