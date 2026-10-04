// FT-071 — the estimates-by-contributor panel, asserted on rendered text.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import DepthTab from './DepthTab'

const OK = {
  ticker: 'AAPL', state: 'ok', source: 'FMP /stable/analyst-estimates (period=quarter), consensus aggregates',
  contributors: { state: 'unavailable', reason: 'FMP /stable/analyst-estimates returns consensus aggregates only' },
  firms: { state: 'ok', source: 'FMP grades', actions: [{ date: '2026-09-30', firm: 'Morgan Stanley', action: 'maintain', from_grade: 'Overweight', to_grade: 'Overweight' }] },
  periods: [{ period_end: '2026-12-27',
    eps: { mean: 2.91933, low: 2.69786, high: 3.12066, n: 14, dispersion_pct: 14.5 },
    revenue: { mean: 138000000000, low: 1, high: 2, n: 13, dispersion_pct: 3.1 } }],
}
let body
beforeEach(() => {
  body = OK
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const renderTab = (flags = { broker_estimates_enabled: true }) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <DepthTab sym="aapl" flags={flags} />
  </SWRConfig>,
)

describe('BrokerEstimatesPanel', () => {
  it('is not rendered when its flag is off', () => {
    renderTab({})
    expect(screen.queryByTestId('broker-panel')).not.toBeInTheDocument()
  })

  it('shows the number of estimates beside the mean, and the spread', async () => {
    renderTab()
    const row = await screen.findByTestId('broker-row')
    expect(row.textContent).toContain('2.92')
    expect(row.textContent).toContain('14')
    expect(row.textContent).toContain('2.70–3.12')
    expect(row.textContent).toContain('138.00B')
  })

  it('names firms as rating actions and refuses contributor-level estimates with the reason', async () => {
    renderTab()
    expect((await screen.findByTestId('broker-firms')).textContent).toContain('Morgan Stanley: maintain to Overweight')
    expect(screen.getByTestId('broker-firms').textContent).toContain('rating actions, not the estimates above')
    expect(screen.getByTestId('broker-contributors').textContent).toMatch(/unavailable — FMP/)
  })

  it('a pending read says so', async () => {
    body = { ...OK, state: 'pending', reason: 'the consensus is being read; reopen in a minute', periods: undefined }
    renderTab()
    expect((await screen.findByTestId('broker-state')).textContent).toMatch(/being read/)
  })
})
