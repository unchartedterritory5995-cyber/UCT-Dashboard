import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Select a daily (non-1D) range so the mocked broker-performance equitySeries
// drives the curve (the default 1D range reconstructs from intraday bars).
const selectDailyRange = () => fireEvent.click(screen.getByRole('tab', { name: '3M' }))

let mockPerf = {
  data: {
    timeWeighted: 0.21,
    dollarPnl: 1234.5,
    netDeposits: 5000,
    equitySeries: [
      { date: '2026-04-01', value: 12000, estimated: true },
      { date: '2026-05-01', value: 13500, estimated: true },
      { date: '2026-06-16', value: 14000, estimated: false },
      { date: '2026-06-17', value: 14632.18, estimated: false },
    ],
  },
  isLoading: false,
  error: null,
}
vi.mock('../hooks/useJ2BrokerPerformance', () => ({ default: () => mockPerf }))

import BrokerAccountHero, { indexFromFraction } from './BrokerAccountHero'

describe('indexFromFraction (scrub math)', () => {
  it('maps a 0..1 pointer fraction to a clamped data index', () => {
    expect(indexFromFraction(0, 5)).toBe(0)
    expect(indexFromFraction(1, 5)).toBe(4)        // last index
    expect(indexFromFraction(0.5, 5)).toBe(2)      // middle
    expect(indexFromFraction(-0.3, 5)).toBe(0)     // clamp low
    expect(indexFromFraction(2, 5)).toBe(4)        // clamp high
    expect(indexFromFraction(0.5, 1)).toBe(0)      // single point
    expect(indexFromFraction(0.5, 0)).toBe(0)      // empty
  })
})

const brokerAccount = {
  id: 'a1', balanceSource: 'broker', brokerTotalEquity: 14632.18,
  brokerCash: -12053.04, brokerBuyingPower: 9470.11,
}
const aggregates = { unrealized: 1204, invested: 1.78 }

function resetPerf() {
  mockPerf = {
    data: {
      timeWeighted: 0.21,
      dollarPnl: 1234.5,
      netDeposits: 5000,
      equitySeries: [
        { date: '2026-04-01', value: 12000, estimated: true },
        { date: '2026-05-01', value: 13500, estimated: true },
        { date: '2026-06-16', value: 14000, estimated: false },
        { date: '2026-06-17', value: 14632.18, estimated: false },
      ],
    },
    isLoading: false,
    error: null,
  }
}

describe('BrokerAccountHero', () => {
  beforeEach(resetPerf)

  it('renders account value, the daily equity curve, range change, and margin used', () => {
    const { container } = render(<BrokerAccountHero account={brokerAccount} aggregates={aggregates} />)
    selectDailyRange()
    expect(screen.getByText('$14,632.18')).toBeInTheDocument()      // account value
    expect(container.querySelector('svg')).toBeInTheDocument()      // the curve
    // 3M change = last − first = 14632.18 − 12000 = +$2,632.18 (est. history)
    expect(screen.getByText(/\+\$2,632\.18/)).toBeInTheDocument()
    expect(screen.getByText('Margin Used')).toBeInTheDocument()
    expect(screen.getByText('$12,053.04')).toBeInTheDocument()      // = -brokerCash
  })

  it('draws the curve from estimated history even with no real snapshots yet', () => {
    // Freshly connected: only estimated points (from trade history), 0 real
    // snapshots. The curve must STILL render (the bug we are fixing).
    mockPerf.data.equitySeries = [
      { date: '2026-04-01', value: 12000, estimated: true },
      { date: '2026-05-01', value: 14632.18, estimated: true },
    ]
    const { container } = render(<BrokerAccountHero account={brokerAccount} aggregates={aggregates} />)
    selectDailyRange()
    expect(container.querySelector('svg')).toBeInTheDocument()      // curve shows
    expect(screen.getByText('$14,632.18')).toBeInTheDocument()
  })

  it('renders the day-one 2-point curve (one real snapshot + a live estimated anchor)', () => {
    // Day one: exactly one real net-liq snapshot plus the backend-appended
    // live "now" anchor (estimated: true) → a 2-point baseline. The curve/SVG
    // must render, not the null/empty state.
    mockPerf.data.equitySeries = [
      { date: '2026-06-16', value: 14000, estimated: false },
      { date: '2026-06-17', value: 14632.18, estimated: true },
    ]
    const { container } = render(<BrokerAccountHero account={brokerAccount} aggregates={aggregates} />)
    selectDailyRange()
    expect(container.querySelector('svg')).toBeInTheDocument()      // curve renders
    expect(screen.getByText('$14,632.18')).toBeInTheDocument()      // account value
  })

  it('returns null for a non-broker account', () => {
    const { container } = render(
      <BrokerAccountHero account={{ balanceSource: 'manual' }} aggregates={aggregates} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the live net-liq value + Today when a liveSummary is provided', () => {
    const account = { balanceSource: 'broker', brokerTotalEquity: 10000, brokerCash: 2000 }
    render(
      <BrokerAccountHero
        account={account}
        aggregates={{ unrealized: 0, invested: 0.8, count: 1, value: 8000 }}
        liveSummary={{ netLiq: 10020, marketValue: 8020, today: -50, todayPct: -0.005 }}
        isLive
      />,
    )
    expect(screen.getByText('$10,020.00')).toBeInTheDocument()   // net-liq headline
    expect(screen.getByText(/LIVE/i)).toBeInTheDocument()
    expect(screen.getByText(/-\$50\.00/)).toBeInTheDocument()    // Today $ (down)
  })
})
