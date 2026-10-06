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
    // mean of the 760 call (14.62%) and put (15.10%) IV, as chain_tools.py::_atm computes it -- not the call alone
    expect((await screen.findByTestId('atm-iv')).textContent).toBe('ATM IV 14.9%')
    expect(screen.getByText('IV rank: needs IV history')).toBeTruthy()
    expect(screen.getByTestId('chain-source').textContent).toMatch(/Live chain from Massive \(OPRA quotes\)/)
  })

  it('the source line says vendor-computed, never exchange-derived, and labels the units', async () => {
    renderTab()
    const src = (await screen.findByTestId('chain-source')).textContent
    expect(src).not.toMatch(/exchange-derived/)
    expect(src).toMatch(/vendor-computed by Massive, per share/)
    expect(src).toMatch(/Θ per calendar day, vega per 1 vol point/)
    expect(src).toMatch(/OI is the OCC prior-close figure/)
    const heads = screen.getAllByRole('columnheader')
    expect(heads.find((h) => h.textContent === 'Θ').getAttribute('title')).toMatch(/per calendar day/)
    expect(heads.find((h) => h.textContent === 'OI').getAttribute('title')).toMatch(/prior close/)
  })

  it('shows Mid and V/OI, shades in-the-money cells, puts DTE in the expiration list and the expected move', async () => {
    renderTab()
    await screen.findByTestId('options-chain')
    const atm = screen.getByTestId('atm-row')
    expect(atm.textContent).toContain('21.25')        // call mid of 21.1 / 21.4
    expect(atm.textContent).toContain('0.07×')        // call V/OI 88 / 1231
    // 760 < spot 764.2: the call is in the money, the put is not
    const cells = [...atm.querySelectorAll('td')]
    const strikeAt = cells.findIndex((c) => c.textContent === '760.00')
    expect(cells[0].className).toMatch(/itm/)
    expect(cells[strikeAt + 1].className).not.toMatch(/itm/)
    const opts = [...screen.getByLabelText('Expiration').querySelectorAll('option')].map((o) => o.textContent)
    expect(opts[0]).toMatch(/^2026-10-23 \(-?\d+d\)$/)
    // ATM straddle mid = 21.25 + 17.15 = 38.40; / 764.2 = 5.0%
    expect(screen.getByTestId('expected-move').textContent).toMatch(/±\$38\.40 \(±5\.0%\)/)
    expect(screen.getByTestId('expected-move').textContent).toMatch(/ATM straddle ÷ spot/)
  })

  it('an adjusted duplicate at a strike never overwrites the standard contract, and the drop is said', async () => {
    const std = { ...CHAIN.calls[0], contract: 'O:SPY261023C00760000', shares_per_contract: 100 }
    const adj = { ...CHAIN.calls[0], contract: 'O:SPY1261023C00760000', shares_per_contract: 50, bid: 1.0, ask: 1.2, iv: 0.9, delta: 0.11 }
    global.fetch = vi.fn((url) => {
      if (String(url).includes('/expirations')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ expirations: [] }) })
      // the adjusted contract arrives LAST: under the old strike-keyed Map it would have won
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ...CHAIN, calls: [std, adj, CHAIN.calls[1]] }) })
    })
    renderTab()
    await screen.findByTestId('options-chain')
    const atm = screen.getByTestId('atm-row')
    expect(atm.textContent).toContain('0.584')        // the standard contract's delta
    expect(atm.textContent).not.toContain('0.110')
    expect(screen.getByTestId('chain-merge-note').textContent).toMatch(/1 adjusted or duplicate contract sharing a strike was left out/)
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

// Phone: Strike leads the row and a Calls / Puts switch shows one side at a time, because a
// twelve-column-a-side chain cannot fit a 375px screen.
describe('OptionsChainTab on a phone', () => {
  let realMM
  beforeEach(() => {
    realMM = window.matchMedia
    window.matchMedia = (q) => ({ matches: q === '(max-width: 640px)', media: q, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } })
  })
  afterEach(() => { window.matchMedia = realMM })

  it('puts Strike first and shows calls only, then puts only after the switch', async () => {
    const { fireEvent } = await import('@testing-library/react')
    renderTab()
    await screen.findByTestId('options-chain')
    const heads = [...screen.getByTestId('options-chain').querySelectorAll('thead tr:nth-child(2) th')].map((t) => t.textContent)
    expect(heads[0]).toBe('Strike')
    expect(heads.filter((h) => h === 'Strike')).toHaveLength(1)
    let atm = screen.getByTestId('atm-row')
    expect(atm.firstChild.textContent).toBe('760.00')
    expect(atm.textContent).toContain('0.584')        // call delta shown
    expect(atm.textContent).not.toContain('-0.417')   // put delta hidden
    fireEvent.click(screen.getByRole('button', { name: 'Puts' }))
    atm = screen.getByTestId('atm-row')
    expect(atm.textContent).toContain('-0.417')
    expect(atm.textContent).not.toContain('0.584')
    expect(screen.getByRole('button', { name: 'Puts' }).getAttribute('aria-pressed')).toBe('true')
  })
})

// The header tooltips (Mid, IV, the greeks, OI) were hover-only; the same text is in a tappable key.
describe('OptionsChainTab column key', () => {
  it('lists every column definition the headers carry, reachable without hover', async () => {
    renderTab()
    const key = await screen.findByTestId('chain-column-key')
    expect(key.tagName).toBe('DETAILS')
    expect(key.textContent).toMatch(/What the columns mean/)
    expect(key.textContent).toMatch(/Midpoint of bid and ask/)
    expect(key.textContent).toMatch(/Theta: \$ per share per calendar day/)
    expect(key.textContent).toMatch(/ATM IV.*strike nearest spot/)
  })
})
