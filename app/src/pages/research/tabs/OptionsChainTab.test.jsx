// BRK-01 increment 1 — the option chain tab, asserted on rendered text.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import OptionsChainTab from './OptionsChainTab'

const CHAIN = {
  ticker: 'SPY', expiration: '2026-10-23', spot: 764.2, cache_seconds: 60, served_at: '2026-09-30T02:40:00+00:00',
  calls: [
    { strike: 760, bid: 21.1, ask: 21.4, iv: 0.1462, delta: 0.5836, gamma: 0.0138, theta: -0.265, vega: 0.764, open_interest: 1231, day_volume: 88 },
    { strike: 770, bid: 15.2, ask: 15.5, iv: 0.139, delta: 0.47, gamma: 0.0141, theta: -0.26, vega: 0.77, open_interest: 900, day_volume: 50 },
  ],
  puts: [
    { strike: 760, bid: 17.0, ask: 17.3, iv: 0.151, delta: -0.4172, gamma: 0.0138, theta: -0.21, vega: 0.764, open_interest: 2100, day_volume: 120 },
  ],
}
let chainStatus
beforeEach(() => {
  chainStatus = 200
  global.fetch = vi.fn((url) => {
    if (String(url).includes('/expirations')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ expirations: ['2026-10-23', '2026-11-20'] }) })
    }
    return Promise.resolve({ ok: chainStatus === 200, status: chainStatus, json: () => Promise.resolve(CHAIN) })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const renderTab = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <OptionsChainTab sym="spy" />
  </SWRConfig>,
)

describe('OptionsChainTab', () => {
  it('lays calls and puts either side of the strike, with the greeks', async () => {
    renderTab()
    await screen.findByTestId('options-chain')
    const atm = screen.getByTestId('atm-row')
    expect(atm.textContent).toContain('760.00')      // nearest strike to 764.2
    expect(atm.textContent).toContain('14.6%')       // call IV
    expect(atm.textContent).toContain('0.584')       // call delta
    expect(atm.textContent).toContain('-0.417')      // put delta
    expect(atm.textContent).toContain('1,231')       // call OI
  })

  it('states the ATM IV, says IV rank is absent and why, and names the source', async () => {
    renderTab()
    expect((await screen.findByTestId('atm-iv')).textContent).toBe('ATM IV 14.6%')
    expect(screen.getByText('IV rank: needs IV history')).toBeTruthy()
    expect(screen.getByTestId('chain-source').textContent).toMatch(/Live chain from Massive \(OPRA\)/)
  })

  it('a missing side renders as a dash, never a zero', async () => {
    renderTab()
    await screen.findByTestId('options-chain')
    const row770 = screen.getAllByRole('row').find((r) => r.textContent.includes('770.00'))
    expect(row770.textContent).toContain('—')
  })

  it('a failed request is unavailable, not an empty chain', async () => {
    chainStatus = 503
    renderTab()
    expect((await screen.findByTestId('chain-unavailable')).textContent).toMatch(/does not mean no options trade on SPY/)
  })

  it('draws the payoff of a long call at the money, with its basis stated', async () => {
    renderTab()
    await screen.findByTestId('payoff')
    // ATM 760 call, mid of 21.1/21.4 = 21.25 → $2,125 for one contract
    expect(screen.getByTestId('payoff-facts').textContent)
      .toBe('Costs $2,125 · Max loss -$2,125 · Max profit unlimited · Breakeven 781.25')
    expect(screen.getByTestId('payoff-basis').textContent).toMatch(/priced at the mid of bid and ask, at expiration/)
  })

  it('a spread whose leg has no quote says so instead of drawing', async () => {
    const { fireEvent } = await import('@testing-library/react')
    renderTab()
    await screen.findByTestId('payoff')
    fireEvent.change(screen.getByLabelText('Strategy'), { target: { value: 'bear_put' } })
    // 760 has a put; 770 does not, so a 760/770 bear put spread cannot be priced
    expect((await screen.findByTestId('payoff-unpriced')).textContent).toMatch(/No two-sided quote for the 770 put/)
  })

  it('offers no trade, run or send action', async () => {
    renderTab()
    await screen.findByTestId('options-chain')
    expect(screen.queryByRole('button')).toBeNull()
  })
})
