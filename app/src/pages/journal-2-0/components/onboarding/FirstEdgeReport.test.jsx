/**
 * FirstEdgeReport + useFirstReport — P0 First-Insight onboarding.
 *
 * Two units, one file:
 *   A. FirstEdgeReport (presentational) — composes "Your First Edge Report" from
 *      a mocked `/api/j2/analytics` payload: best setup, Edge Score, biggest leak,
 *      win rate + expectancy. Coverage-gated (thin stats gray, absent stats omit),
 *      one deterministic closing sentence, dismiss/explore actions, flag gate.
 *   B. useFirstReport (trigger) — flag + closed-trade-count(≥10) + seen gating.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }))

// ── controllable mock state ──────────────────────────────────────────────────
let analyticsData = null
let selAccountId = 'a1'
let comparison = [{ id: 'a1', tradeCount: 12 }]

vi.mock('../../hooks/useJ2Analytics', () => ({
  default: () => ({ data: analyticsData, isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('../../hooks/useJ2SelectedAccount', () => ({
  default: () => ({ accountId: selAccountId, account: null, accounts: [], setAccount: vi.fn(), isLoading: false }),
}))
vi.mock('../../hooks/useJ2AccountComparison', () => ({
  default: () => ({ accounts: comparison, isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => navigateSpy }
})

import FirstEdgeReport from './FirstEdgeReport'
import useFirstReport, { FIRST_REPORT_SEEN_KEY } from '../../hooks/useFirstReport'
import { setFeatureFlag } from '../../featureFlags'

// A rich payload: best setup = VCP (expectancy 1200/15 = $80 > Flat Base 300/12);
// leak = no_stop -$412; edge score present; win rate + R expectancy present.
const RICH = {
  tradeCount: 42,
  attribution: {
    bySetup: [
      { setup: 'Flat Base', totalPnl: 300, winRate: 0.5, avgR: 0.4, tradeCount: 12 },
      { setup: 'VCP', totalPnl: 1200, winRate: 0.62, avgR: 0.8, tradeCount: 15 },
    ],
  },
  edgeScore: {
    score: 0.842,
    components: { winRate: 0.57, profitFactor: 1.8, rConsistency: 0.6, tradeCount: 42 },
    trend: [],
  },
  psychology: {
    costOfMistakes: {
      total: -532,
      byMistake: [
        { mistake: 'no_stop', total: -412, count: 6 },
        { mistake: 'fomo', total: -120, count: 3 },
      ],
    },
    taggedTradeCount: 20,
  },
  risk: {
    coverageReady: true,
    decisiveCount: 40,
    noRCount: 0,
    expectancyR: 0.32,
    drawdown: { maxDrawdownDollar: 800, currentDrawdownDollar: 200 },
  },
}

// A thin payload: no tagged setups (best setup omitted), no R (edge score dim),
// no mistakes + risk not covered (leak omitted), win rate on n=4 (grayed).
const THIN = {
  tradeCount: 4,
  attribution: { bySetup: [] },
  edgeScore: {
    score: null,
    components: { winRate: 0.5, profitFactor: 1.2, rConsistency: null, tradeCount: 4 },
    trend: [],
  },
  psychology: { costOfMistakes: { total: 0, byMistake: [] }, taggedTradeCount: 0 },
  risk: { coverageReady: false, decisiveCount: 4, noRCount: 4, expectancyR: null, drawdown: null },
}

function renderReport(props = {}) {
  return render(
    <MemoryRouter>
      <FirstEdgeReport accountId="a1" onDismiss={vi.fn()} {...props} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  navigateSpy.mockClear()
  analyticsData = RICH
  selAccountId = 'a1'
  comparison = [{ id: 'a1', tradeCount: 12 }]
})

describe('FirstEdgeReport — composition from analytics', () => {
  it('renders every headline stat from a rich payload', () => {
    renderReport()
    expect(screen.getByTestId('first-edge-report')).toBeInTheDocument()
    // best setup = highest expectancy (VCP), expectancy $80/trade
    expect(screen.getByTestId('stat-best-setup')).toHaveTextContent('VCP')
    expect(screen.getByTestId('stat-best-setup')).toHaveTextContent('+$80.00')
    // edge score
    expect(screen.getByTestId('stat-edge-score')).toHaveTextContent('0.842')
    // biggest leak (top mistake in $)
    expect(screen.getByTestId('stat-leak')).toHaveTextContent('no_stop')
    expect(screen.getByTestId('stat-leak')).toHaveTextContent('-$412.00')
    expect(screen.getByTestId('stat-leak')).toHaveTextContent('6 trades')
    // win rate + expectancy
    expect(screen.getByTestId('stat-winrate')).toHaveTextContent('57%')
    expect(screen.getByTestId('stat-winrate')).toHaveTextContent('+0.3R')
  })

  it('writes the deterministic closing sentence + honesty line', () => {
    renderReport()
    const closing = screen.getByText(/Your VCP trades carry your edge/i)
    expect(closing).toHaveTextContent('no_stop')
    expect(closing).toHaveTextContent('$412.00')
    expect(closing).toHaveTextContent('Compass will watch both')
    expect(screen.getByText(/Generated from your 42 closed trades/i)).toBeInTheDocument()
  })

  it('greys thin stats and omits stats with no data', () => {
    analyticsData = THIN
    renderReport()
    // no tagged setups → best-setup card omitted; no leak source → leak omitted
    expect(screen.queryByTestId('stat-best-setup')).not.toBeInTheDocument()
    expect(screen.queryByTestId('stat-leak')).not.toBeInTheDocument()
    // edge score has no R-multiples → honest dim em-dash, not a fabricated number
    expect(screen.getByTestId('stat-edge-score')).toHaveTextContent('—')
    // win rate on n=4 → ConfidenceStat low-confidence affordance
    expect(screen.getByLabelText(/50% — low confidence/i)).toBeInTheDocument()
  })

  it('falls back to the largest drawdown when no mistakes are tagged', () => {
    analyticsData = {
      ...RICH,
      psychology: { costOfMistakes: { total: 0, byMistake: [] }, taggedTradeCount: 0 },
    }
    renderReport()
    // leak now comes from risk.drawdown.maxDrawdownDollar ($800)
    expect(screen.getByTestId('stat-leak')).toHaveTextContent('Drawdown')
    expect(screen.getByTestId('stat-leak')).toHaveTextContent('-$800.00')
    expect(screen.getByText(/your biggest leak is a \$800\.00 drawdown/i)).toBeInTheDocument()
  })

  it('"Continue to Today" calls onDismiss', () => {
    const onDismiss = vi.fn()
    renderReport({ onDismiss })
    fireEvent.click(screen.getByRole('button', { name: /continue to today/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('"Explore your Insights" dismisses AND routes to the Insights hub', () => {
    const onDismiss = vi.fn()
    renderReport({ onDismiss })
    fireEvent.click(screen.getByRole('button', { name: /explore your insights/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(navigateSpy).toHaveBeenCalledWith('/journal/insights')
  })

  it('renders nothing when the firstInsight flag is off', () => {
    setFeatureFlag('firstInsight', false)
    renderReport()
    expect(screen.queryByTestId('first-edge-report')).not.toBeInTheDocument()
  })
})

describe('useFirstReport — trigger gating', () => {
  it('shows once the account has ≥10 closed trades and it is unseen', () => {
    comparison = [{ id: 'a1', tradeCount: 12 }]
    const { result } = renderHook(() => useFirstReport())
    expect(result.current.show).toBe(true)
    expect(result.current.count).toBe(12)
  })

  it('does not show below 10 closed trades', () => {
    comparison = [{ id: 'a1', tradeCount: 4 }]
    const { result } = renderHook(() => useFirstReport())
    expect(result.current.show).toBe(false)
  })

  it('never shows when the firstInsight flag is off', () => {
    setFeatureFlag('firstInsight', false)
    comparison = [{ id: 'a1', tradeCount: 30 }]
    const { result } = renderHook(() => useFirstReport())
    expect(result.current.show).toBe(false)
  })

  it('sums closed trades across accounts on All-Accounts', () => {
    selAccountId = null // All-Accounts
    comparison = [{ id: 'a1', tradeCount: 6 }, { id: 'a2', tradeCount: 7 }]
    const { result } = renderHook(() => useFirstReport())
    expect(result.current.count).toBe(13)
    expect(result.current.show).toBe(true)
  })

  it('dismiss persists the seen flag and stops showing (drops through to Today)', () => {
    comparison = [{ id: 'a1', tradeCount: 12 }]
    const { result } = renderHook(() => useFirstReport())
    expect(result.current.show).toBe(true)
    act(() => result.current.dismiss())
    expect(localStorage.getItem(FIRST_REPORT_SEEN_KEY)).toBe('1')
    expect(result.current.show).toBe(false)
  })

  it('stays dismissed on a fresh mount (seen flag already set)', () => {
    localStorage.setItem(FIRST_REPORT_SEEN_KEY, '1')
    comparison = [{ id: 'a1', tradeCount: 50 }]
    const { result } = renderHook(() => useFirstReport())
    expect(result.current.show).toBe(false)
  })
})
