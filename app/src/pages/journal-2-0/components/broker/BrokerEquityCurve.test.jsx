/** BrokerEquityCurve — self-gating + change header from real points. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import BrokerEquityCurve from './BrokerEquityCurve'

vi.mock('echarts-for-react', () => ({
  __esModule: true,
  default: () => <div data-testid="chart" />,
}))

let points
beforeEach(() => {
  points = [
    { date: '2026-08-18', equity: 10000, cash: 2000, marketValue: 8000 },
    { date: '2026-08-19', equity: 10250, cash: 2000, marketValue: 8250 },
    { date: '2026-08-20', equity: 10100, cash: 2100, marketValue: 8000 },
  ]
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve({ points }),
  }))
})

describe('BrokerEquityCurve', () => {
  it('renders the chart + signed change from first to last point', async () => {
    render(<BrokerEquityCurve />)
    expect(await screen.findByTestId('chart')).toBeInTheDocument()
    expect(screen.getByText('Account Value')).toBeInTheDocument()
    expect(screen.getByText(/\+\$100/)).toBeInTheDocument()   // 10100 - 10000
    expect(screen.getByText(/1\.0%/)).toBeInTheDocument()
  })

  it('live net-liq drives the change header when supplied', async () => {
    render(<BrokerEquityCurve liveNetLiq={10500} />)
    expect(await screen.findByText(/\+\$500/)).toBeInTheDocument()
    expect(screen.getByText(/gold point = live/)).toBeInTheDocument()
  })

  it('self-gates: null with fewer than 2 points (manual accounts)', async () => {
    points = []
    const { container } = render(<BrokerEquityCurve />)
    await new Promise((r) => setTimeout(r, 30))
    expect(container.firstChild).toBeNull()
  })
})
