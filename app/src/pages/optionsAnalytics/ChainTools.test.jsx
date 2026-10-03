import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { ProbabilityPanel, ContractDrill, ContractPicker, PositionBuilder, StancePanel, priceLegs, netGreeks, daysTo } from './ChainTools'

// Route bodies are the shapes api/services/options_analytics/chain_tools.py returns
// (tests/test_options_chain_tools.py); chain rows are polygon_options.get_chain rows.
const ROWS = [
  { strike: 95, call: { contract: 'O:TST261016C00095000', type: 'call', strike: 95, expiration: '2026-10-16', bid: 6.0, ask: 6.2, iv: 0.25, delta: 0.8, gamma: 0.02, theta: -0.03, vega: 0.08 },
    put: { contract: 'O:TST261016P00095000', type: 'put', strike: 95, expiration: '2026-10-16', bid: 0.9, ask: 1.1, iv: 0.27, delta: -0.2, gamma: 0.02, theta: -0.02, vega: 0.08 } },
  { strike: 100, call: { contract: 'O:TST261016C00100000', type: 'call', strike: 100, expiration: '2026-10-16', bid: 2.9, ask: 3.1, iv: 0.2, delta: 0.52, gamma: 0.05, theta: -0.05, vega: 0.11 },
    put: { contract: 'O:TST261016P00100000', type: 'put', strike: 100, expiration: '2026-10-16', bid: 0, ask: 2.9, iv: 0.22, delta: -0.48, gamma: 0.05, theta: -0.05, vega: 0.11 } },
  { strike: 105, call: { contract: 'O:TST261016C00105000', type: 'call', strike: 105, expiration: '2026-10-16', bid: 0.9, ask: 1.1, iv: 0.18, delta: 0.22, gamma: 0.03, theta: -0.02, vega: 0.07 } },
]
const PROB = { label: 'computed', iv_label: 'vendor', expiration: '2026-10-16', atm_iv: 0.21, days: 14, method: 'Lognormal.', note: null,
  ranges: [{ probability: 0.6827, z: 1, low: 94.16, high: 106.21 }, { probability: 0.9545, z: 2, low: 88.66, high: 112.8 }] }
const HIST = { label: 'vendor', bars: [{ date: '2026-09-30', close: 2.4 }, { date: '2026-10-01', close: 3.0 }], note: null }

function stub(map) {
  vi.stubGlobal('fetch', vi.fn((u) => {
    const hit = Object.entries(map).find(([k]) => u.includes(k))
    const [status, body] = hit ? hit[1] : [404, {}]
    return Promise.resolve({ status, ok: status === 200, json: () => Promise.resolve(body) })
  }))
}
const wrap = (el) => render(<MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{el}</SWRConfig></MemoryRouter>)

describe('ProbabilityPanel (FT-003)', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('shows the ranges and asks for the chosen probability', async () => {
    stub({ '/probability': [200, PROB] })
    wrap(<ProbabilityPanel sym="TST" expiration="2026-10-16" />)
    expect((await screen.findByTestId('probability-0.6827')).textContent).toContain('94.16 to 106.21')
    fireEvent.change(screen.getByLabelText('Probability percent'), { target: { value: '90' } })
    await waitFor(() => expect(fetch.mock.calls.some(([u]) => u.includes('probability=0.9000'))).toBe(true))
  })
  it('dark: nothing', async () => {
    stub({})
    const { container } = wrap(<ProbabilityPanel sym="TST" expiration="" />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.querySelector('[data-testid="probability"]')).toBeNull()
  })
})

describe('ContractDrill + ContractPicker (FT-016)', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('vendor and computed side by side, with the contract chart and a chart link', async () => {
    stub({ '/contract/': [200, HIST] })
    wrap(<ContractDrill sym="TST" contract={ROWS[1].call} spot={100} />)
    const p = await screen.findByTestId('pricer')
    const price = p.querySelectorAll('tbody tr')[0].textContent
    expect(price).toContain('3.00')                       // vendor mid (2.9 + 3.1) / 2
    expect(screen.getByTestId('contract-chart')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Chart TST' }).getAttribute('href')).toBe('/research/TST?section=technical')
    fireEvent.change(screen.getByLabelText('Pricer days'), { target: { value: '0' } })
    expect(p.querySelectorAll('tbody tr')[0].textContent).toContain('0.00')   // at expiry, ATM: intrinsic 0
  })
  it('the picker is absent while the pricer is dark, and opens a contract when on', async () => {
    stub({})
    const onPick = vi.fn()
    const { container, unmount } = wrap(<ContractPicker sym="TST" rows={ROWS} onPick={onPick} />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.querySelector('[data-testid="contract-picker"]')).toBeNull()
    unmount()
    vi.unstubAllGlobals()
    stub({ '/contract/': [200, HIST] })
    wrap(<ContractPicker sym="TST" rows={ROWS} onPick={onPick} />)
    fireEvent.change(await screen.findByLabelText('Drill into contract'), { target: { value: 'O:TST261016P00095000' } })
    expect(onPick).toHaveBeenCalledWith(ROWS[0].put)
  })
})

describe('StancePanel (FT-039)', () => {
  afterEach(() => vi.unstubAllGlobals())
  const STANCE = { label: 'computed', fit_score: 3.94, components_used: 4,
    sub_scores: { iv_regime: null, greeks_fit: 1, dte_fit: 1, liquidity: 0.85, earnings_timing: 0.3 },
    reasons: { iv_regime: 'IV rank: 3 sessions logged, needs 20.', greeks_fit: 'delta +0.45', dte_fit: '30 days', liquidity: 'spread 2.0%', earnings_timing: 'earnings before expiry' },
    explanation: 'Scores 3.94 of 5 over 4 of 5 components.', disclaimer: 'Not advice and not a recommendation.' }
  it('shows the score, the components it could not compute, and the disclaimer', async () => {
    stub({ '/stance': [200, STANCE] })
    wrap(<StancePanel sym="TST" contract={ROWS[1].call} />)
    expect((await screen.findByTestId('stance-score')).textContent).toContain('3.94 / 5 over 4 of 5 components')
    expect(screen.getByTestId('stance').textContent).toContain('IV regime: not computed')
    expect(screen.getByTestId('stance-disclaimer').textContent).toContain('Not advice')
    fireEvent.click(screen.getByRole('button', { name: 'bearish' }))
    await waitFor(() => expect(fetch.mock.calls.some(([u]) => u.includes('direction=bearish'))).toBe(true))
  })
  it('is absent while dark', async () => {
    stub({})
    const { container } = wrap(<StancePanel sym="TST" contract={ROWS[1].call} />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.querySelector('[data-testid="stance"]')).toBeNull()
  })
})

describe('PositionBuilder (FT-002)', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('legs priced at mids, payoff via optionPayoff, net vendor greeks', () => {
    // long 1 x 100 call (mid 3.00), short 1 x 105 call (mid 1.00): a 2.00 debit bull spread
    const { priced, unpriced } = priceLegs([{ type: 'call', strike: 100, qty: 1 }, { type: 'call', strike: 105, qty: -1 }], ROWS)
    expect(unpriced).toEqual([])
    const g = netGreeks(priced)
    expect(g.delta).toBeCloseTo(30)                        // (0.52 - 0.22) x 100
    expect(g.vega).toBeCloseTo(4)
  })
  it('a leg with no two-sided quote is unpriced, never guessed', () => {
    const { unpriced } = priceLegs([{ type: 'put', strike: 100, qty: 2 }], ROWS)
    expect(unpriced.length).toBe(1)
  })
  it('builds a spread in the UI and states cost, max loss and max profit', async () => {
    stub({ '/builder': [200, { enabled: true, max_legs: 8, basis: 'Mid prices.' }] })
    wrap(<PositionBuilder sym="TST" rows={ROWS} spot={100} />)
    await screen.findByTestId('position-builder')
    fireEvent.change(screen.getByLabelText('Leg strike'), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Buy' }))
    fireEvent.change(screen.getByLabelText('Leg strike'), { target: { value: '105' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sell' }))
    expect(screen.getByTestId('builder-facts').textContent).toBe('Costs $200 · Max loss -$200 · Max profit $300 · Breakeven 102.00')
    expect(screen.getByTestId('builder-greeks').textContent).toContain('Net Δ 30.0')
  })
  it('is absent while dark', async () => {
    stub({})
    const { container } = wrap(<PositionBuilder sym="TST" rows={ROWS} spot={100} />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.querySelector('[data-testid="position-builder"]')).toBeNull()
  })
  it('daysTo counts calendar days', () => {
    expect(daysTo('2026-10-16', new Date(Date.UTC(2026, 9, 2)))).toBe(14)
  })
})
