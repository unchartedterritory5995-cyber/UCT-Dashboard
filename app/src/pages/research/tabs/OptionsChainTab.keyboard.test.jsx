// Audit 2026-10-08 (OMON P1, points 18/26): a quote cell opened the contract drill on a mouse
// click only. While the drill exists (its contract route answers), each side's Mid cell is a
// keyboard stop that opens it on Enter or Space.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { MemoryRouter } from 'react-router-dom'
import OptionsChainTab from './OptionsChainTab'

const CHAIN = {
  ticker: 'SPY', expiration: '2026-10-23', spot: 764.2, cache_seconds: 60,
  calls: [{ contract: 'O:SPY261023C00760000', type: 'call', strike: 760, expiration: '2026-10-23', bid: 21.1, ask: 21.4, iv: 0.1462 }],
  puts: [{ contract: 'O:SPY261023P00760000', type: 'put', strike: 760, expiration: '2026-10-23', bid: 17.0, ask: 17.3, iv: 0.151 }],
}
let contractStatus
beforeEach(() => {
  contractStatus = 200
  global.fetch = vi.fn((url) => {
    const u = String(url)
    const ok = (b) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(b) })
    if (u.includes('/expirations')) return ok({ expirations: ['2026-10-23'] })
    if (u.includes('/contract/')) {
      return contractStatus === 200 ? ok({ bars: [{ t: '2026-10-01', c: 20 }], note: '' })
        : Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
    }
    if (u.includes('/chain?')) return ok(CHAIN)
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const renderTab = () => render(
  <MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><OptionsChainTab sym="spy" /></SWRConfig></MemoryRouter>,
)

describe('OptionsChainTab quote cells from the keyboard', () => {
  it('the Mid cell is focusable, named, and Enter opens the contract drill', async () => {
    renderTab()
    const cell = await screen.findByTestId('drill-call-760')
    expect(cell.getAttribute('tabindex')).toBe('0')
    expect(cell.getAttribute('aria-label')).toBe('Mid 21.25: open the 760.00 call contract')
    expect(screen.queryByTestId('contract-drill')).toBeNull()
    fireEvent.keyDown(cell, { key: 'Enter' })
    expect(await screen.findByTestId('contract-drill')).toBeTruthy()
    expect(screen.getByTestId('contract-drill').textContent).toContain('O:SPY261023C00760000')
  })

  it('Space on the put Mid cell opens the put', async () => {
    renderTab()
    fireEvent.keyDown(await screen.findByTestId('drill-put-760'), { key: ' ' })
    expect((await screen.findByTestId('contract-drill')).textContent).toContain('O:SPY261023P00760000')
  })

  it('with the drill switched off no cell pretends to be operable', async () => {
    contractStatus = 404
    renderTab()
    await screen.findByTestId('atm-row')
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('drill-call-760')).toBeNull()
    expect(screen.getByTestId('atm-row').querySelector('[tabindex]')).toBeNull()
  })
})
