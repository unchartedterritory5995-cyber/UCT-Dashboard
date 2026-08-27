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

import BrokerAccountHero, { indexFromFraction, resolveHeadlineEquity } from './BrokerAccountHero'

describe('resolveHeadlineEquity (broker-truth coherence guard)', () => {
  it('trusts the live reconstruction when it agrees with broker truth', () => {
    // live net-liq $20 off a $10k broker equity → coherent → show the live value
    expect(resolveHeadlineEquity({ brokerTotalEquity: 10000, liveNetLiq: 10020, perfBase: 9990 }))
      .toBe(10020)
  })

  it('falls back to broker truth when the reconstruction diverges (the −$17,774 bug)', () => {
    // full margin cash + partial market value collapsed the recompute; broker
    // truth is +$9,588.17 — the headline must show that, never the −$17,774.
    expect(resolveHeadlineEquity({
      brokerTotalEquity: 9588.17, liveNetLiq: -17774.10, perfBase: 9588.17,
    })).toBe(9588.17)
  })

  it('never shows a negative headline when the funded account reports positive equity', () => {
    const v = resolveHeadlineEquity({ brokerTotalEquity: 9588.17, liveNetLiq: -17774.10 })
    expect(v).toBeGreaterThan(0)
    expect(v).toBe(9588.17)
  })

  it('uses the perf base, then broker truth, when there is no live reconstruction', () => {
    expect(resolveHeadlineEquity({ brokerTotalEquity: 14632.18, perfBase: 14600 })).toBe(14600)
    expect(resolveHeadlineEquity({ brokerTotalEquity: 14632.18 })).toBe(14632.18)
  })

  it('keeps the live value when broker truth is unavailable (no false fallback)', () => {
    expect(resolveHeadlineEquity({ liveNetLiq: 12345, perfBase: 12000 })).toBe(12345)
  })

  it('does NOT clamp a legitimate large intraday GAIN to the stale broker figure', () => {
    // broker equity is ~morning-stale; a +20% live move on complete data must
    // reach the headline (not revert to a stale, self-contradictory number).
    expect(resolveHeadlineEquity({ brokerTotalEquity: 10000, liveNetLiq: 12000, perfBase: 10000 }))
      .toBe(12000)
  })

  it('does NOT clamp a moderate intraday LOSS', () => {
    expect(resolveHeadlineEquity({ brokerTotalEquity: 10000, liveNetLiq: 9000 })).toBe(9000)
  })

  it('still clamps a severe positive collapse (partial positions, no sign flip)', () => {
    // live far below truth AND below half of it = the missing-positions signature
    // even without going negative → fall back to broker truth.
    expect(resolveHeadlineEquity({ brokerTotalEquity: 10000, liveNetLiq: 3000 })).toBe(10000)
  })
})

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

  it('Cash + Margin Used prefer the fill-derived brokerCashLive over the sync-stale cash', () => {
    // 2026-08-26 incident: cash synced pre-market, then an intraday buy — the
    // backend derives the true current cash; every cash consumer must use it.
    const acct = { ...brokerAccount, brokerCashLive: -22047.04, brokerCashLiveFills: 1 }
    render(<BrokerAccountHero account={acct} aggregates={aggregates} />)
    selectDailyRange()
    expect(screen.getByText('-$22,047.04')).toBeInTheDocument()  // Cash stat
    expect(screen.getByText('$22,047.04')).toBeInTheDocument()   // Margin Used
    expect(screen.queryByText('$12,053.04')).not.toBeInTheDocument()
    expect(screen.queryByText('-$12,053.04')).not.toBeInTheDocument()
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

  it('shows broker truth, not a diverged reconstruction, as the headline (the live bug)', () => {
    // Real incident: Robinhood ··2364 — broker equity +$9,588.17, but the client
    // recompute (full −$22,447.21 margin cash + only 2 materialized positions)
    // collapsed to −$17,774.10. The headline must show the broker's number.
    const account = {
      balanceSource: 'broker', brokerTotalEquity: 9588.17,
      brokerCash: -22447.21, brokerBuyingPower: 6464.36,
    }
    render(
      <BrokerAccountHero
        account={account}
        aggregates={{ unrealized: 2236.72, invested: 0.487 }}
        liveSummary={{ netLiq: -17774.10, marketValue: 4673.11, today: 98.07, todayPct: 0.005 }}
        isLive
      />,
    )
    expect(screen.getByText('$9,588.17')).toBeInTheDocument()          // broker truth
    expect(screen.queryByText(/-\$17,774\.10/)).toBeNull()             // never the fabricated negative
  })
})

// ── RH extended-hours split (After-Hours / Overnight) ───────────────────────
describe('extended-hours hero rows', () => {
  const positions = [
    { symbol: 'AAPL', side: 'Long', shares: 10, entryPrice: 100, entryDate: '2026-06-01' },
  ]

  it('post-market: Today freezes at the close and After-Hours gets its own line', () => {
    const prices = {
      AAPL: {
        price: 112, ext_price: 112, ext_session: 'post_market',
        day_close: 110, prev_close: 108,
      },
    }
    render(
      <BrokerAccountHero
        account={brokerAccount}
        aggregates={aggregates}
        liveSummary={{ netLiq: 14632, today: 40, todayPct: 0.003 }}
        positions={positions}
        prices={prices}
      />,
    )
    // Today (frozen regular leg) = 10 × (110 − 108) = +$20.00 AND
    // After-Hours = 10 × (112 − 110) = +$20.00 — one line each.
    expect(screen.getAllByText(/\+\$20\.00/)).toHaveLength(2)
    expect(screen.getByText(/Today/)).toBeInTheDocument()
    expect(screen.getByText('After-Hours')).toBeInTheDocument()
  })

  it('pre-market: the single change line relabels to Overnight', () => {
    const prices = {
      AAPL: { price: 111, ext_price: 111, ext_session: 'pre_market', prev_close: 108 },
    }
    render(
      <BrokerAccountHero
        account={brokerAccount}
        aggregates={aggregates}
        liveSummary={{ netLiq: 14632, today: 30, todayPct: 0.002 }}
        positions={positions}
        prices={prices}
      />,
    )
    expect(screen.getByText(/Overnight/)).toBeInTheDocument()
    expect(screen.queryByText('After-Hours')).toBeNull()
    expect(screen.queryByText(/Today/)).toBeNull()
  })

  it('regular session: unchanged single Today line', () => {
    const prices = { AAPL: { price: 111, prev_close: 108 } }
    render(
      <BrokerAccountHero
        account={brokerAccount}
        aggregates={aggregates}
        liveSummary={{ netLiq: 14632, today: 30, todayPct: 0.002 }}
        positions={positions}
        prices={prices}
      />,
    )
    expect(screen.getByText(/Today/)).toBeInTheDocument()
    expect(screen.queryByText('After-Hours')).toBeNull()
    expect(screen.queryByText(/Overnight/)).toBeNull()
  })
})
