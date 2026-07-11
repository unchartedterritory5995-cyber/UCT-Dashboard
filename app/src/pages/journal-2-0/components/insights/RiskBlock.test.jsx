import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

// RiskBlock is presentational — it reads its `risk` slice and uses no hooks,
// no router, no ECharts. Nothing to mock.
import RiskBlock from './RiskBlock'

// ── Fixtures ─────────────────────────────────────────────────────────────────

// Coverage-ready: full aggregate shape (mirrors the backend `_risk_section`).
const READY = {
  coverageReady: true,
  tradeCount: 22,
  decisiveCount: 20,
  noRCount: 2,
  rHistogram: [
    { bin: '< -3', count: 0 },
    { bin: '-3..-2', count: 1 },
    { bin: '-2..-1', count: 2 },
    { bin: '-1..0', count: 5 },
    { bin: '0..1', count: 3 },
    { bin: '1..2', count: 7 },
    { bin: '2..3', count: 2 },
    { bin: '> 3', count: 1 },
  ],
  expectancyR: 0.4,
  drawdown: {
    maxDrawdownDollar: 150,
    currentDrawdownDollar: 120,
    peakDate: '2026-04-01',
    troughDate: '2026-04-03',
  },
  streaks: {
    longestWin: 6,
    longestLoss: 4,
    current: { type: 'win', length: 2 },
  },
  lossStreakOdds: { winRate: 0.52, k: 5, perYear: 9 },
}

// Thin book: backend gated everything to null, counts populated.
const GATED = {
  coverageReady: false,
  tradeCount: 4,
  decisiveCount: 4,
  noRCount: 1,
  rHistogram: null,
  expectancyR: null,
  drawdown: null,
  streaks: null,
  lossStreakOdds: null,
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('RiskBlock', () => {
  it('leads with the streak-odds sentence (sentence → number → math)', () => {
    render(<RiskBlock risk={READY} />)
    // reassurance framing is the lede
    expect(screen.getByText(/variance, not failure/i)).toBeInTheDocument()
    expect(screen.getByText(/win rate, a/i)).toBeInTheDocument()
    // the win rate + streak length + per-year number all render. "52%" shows
    // both in the sentence AND in the ConfidenceStat cell → assert >= 1.
    expect(screen.getAllByText('52%').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/5-loss streak/i)).toBeInTheDocument()
    expect(screen.getByText(/~9×\/year/i)).toBeInTheDocument()
  })

  it('renders the R histogram bars + expectancy from the mock', () => {
    render(<RiskBlock risk={READY} />)
    expect(screen.getByText('R-multiple distribution')).toBeInTheDocument()
    // every bin label present (plain CSS bars — no chart lib)
    expect(screen.getByText('> 3')).toBeInTheDocument()
    expect(screen.getByText('-1..0')).toBeInTheDocument()
    // expectancy figure (rMultiple formats +0.4R at 1dp)
    expect(screen.getByText('+0.4R')).toBeInTheDocument()
  })

  it('renders the drawdown pair as red-toned negative money', () => {
    render(<RiskBlock risk={READY} />)
    expect(screen.getByText('-$150.00')).toBeInTheDocument()
    expect(screen.getByText('-$120.00')).toBeInTheDocument()
    expect(screen.getByText(/max drawdown/i)).toBeInTheDocument()
  })

  it('renders the streak stats (longest win/loss + current)', () => {
    render(<RiskBlock risk={READY} />)
    expect(screen.getByText('Longest win streak')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()   // longest win
    expect(screen.getByText('4')).toBeInTheDocument()   // longest loss
    expect(screen.getByText('2 W')).toBeInTheDocument() // current
    // the win rate goes through the confidence cell (rate shown), n>=10 → confident
    expect(screen.getByText('Win rate')).toBeInTheDocument()
  })

  it('shows the honest noRCount footnote', () => {
    render(<RiskBlock risk={READY} />)
    expect(screen.getByText(/2 trades have no stop logged/i)).toBeInTheDocument()
    expect(screen.getByText(/no R computed/i)).toBeInTheDocument()
  })

  it('renders the gated empty state on thin data (no bars/drawdown)', () => {
    render(<RiskBlock risk={GATED} />)
    expect(screen.getByText(/risk analytics unlock at 10 decisive trades/i)).toBeInTheDocument()
    // the decisive count is surfaced honestly
    expect(screen.getByText('4')).toBeInTheDocument()
    // no aggregates rendered
    expect(screen.queryByText('R-multiple distribution')).not.toBeInTheDocument()
    expect(screen.queryByText(/variance, not failure/i)).not.toBeInTheDocument()
  })

  it('is resilient to a missing risk slice (renders the gated state)', () => {
    render(<RiskBlock risk={undefined} />)
    expect(screen.getByText(/risk analytics unlock/i)).toBeInTheDocument()
  })

  it('renders no emoji (all iconography via UIcon)', () => {
    const { container } = render(<RiskBlock risk={READY} />)
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
