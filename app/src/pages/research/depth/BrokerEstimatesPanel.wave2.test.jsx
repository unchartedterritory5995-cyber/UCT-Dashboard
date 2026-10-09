// Audit wave 2 (lane A, BRKE): an honest title, an explained Spread, "$" on USD revenue as EE
// shows it, and one dash when both ends of the range are missing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { TerminalPanelContext } from '../../../components/terminal'
import BrokerEstimatesPanel from './BrokerEstimatesPanel'

const OK = {
  ticker: 'AAPL', state: 'ok', currency: 'USD', source: 'FMP consensus',
  contributors: { state: 'unavailable', reason: 'consensus aggregates only' },
  firms: { state: 'ok', source: 'FMP grades', actions: [] },
  periods: [
    { period_end: '2026-12-27', eps: { mean: 2.91933, low: 2.69786, high: 3.12066, n: 14, dispersion_pct: 14.5 },
      revenue: { mean: 138000000000, n: 13 } },
    { period_end: '2027-03-27', eps: { mean: 1.5, low: null, high: null, n: 3, dispersion_pct: null },
      revenue: { mean: null, n: null } },
  ],
}
beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(OK) }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const renderPanel = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <TerminalPanelContext.Provider value={{ code: 'BRKE', density: 'comfortable', inset: true }}>
      <BrokerEstimatesPanel sym="aapl" />
    </TerminalPanelContext.Provider>
  </SWRConfig>,
)

describe('BrokerEstimatesPanel wave 2', () => {
  it('is not titled "by contributor" while saying contributor estimates are unavailable', async () => {
    renderPanel()
    await screen.findAllByTestId('broker-row')
    expect(document.body.textContent).not.toMatch(/Estimates by contributor/)
    expect(screen.getByRole('table').getAttribute('aria-label')).toBe('Analyst consensus estimates')
  })

  it('explains Spread in plain English', async () => {
    renderPanel()
    await screen.findAllByTestId('broker-row')
    expect(screen.getByTestId('broker-spread-help').textContent).toMatch(/highest and lowest estimates/)
  })

  it('USD revenue carries "$" (as EE shows it); both range ends missing is one dash', async () => {
    renderPanel()
    const rows = await screen.findAllByTestId('broker-row')
    expect(rows[0].textContent).toContain('$138.00B')
    expect(rows[0].textContent).toContain('$2.92')
    expect(rows[1].textContent).not.toContain('—–—')
  })
})
