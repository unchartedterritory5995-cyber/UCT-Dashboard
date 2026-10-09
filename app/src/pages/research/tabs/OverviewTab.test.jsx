import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// OverviewTab (DES) composes four endpoint reads (ResearchPage ->
// useResearchOverview) into stats/analyst/ai/row props, plus `error`/`mutate`
// since TERM-088. Its chart pane + ticker-badge children are mocked so this
// stays a unit test of the tab's own error-vs-empty rendering.
vi.mock('../../../components/FundamentalSnapshot', () => ({ default: () => <div>fundamental-snapshot</div> }))
vi.mock('../DeskCoverage', () => ({ default: () => null }))
vi.mock('../LeadershipBadge', () => ({ default: () => null }))
vi.mock('../ConfidenceBadge', () => ({ default: () => null }))
vi.mock('../../../components/chart/pane/ChartPane', () => ({ default: () => <div>chart-pane</div> }))

import OverviewTab, { consensusText, targetMid } from './OverviewTab'

describe('OverviewTab', () => {
  it('renders the AI snapshot copy when no analysis exists yet, and no error banner', () => {
    render(<OverviewTab sym="AAPL" stats={{}} analyst={{}} ai={{}} row={null} error={false} mutate={() => {}} />)
    expect(screen.getByText('Earnings analysis will appear here once available.')).toBeInTheDocument()
    expect(screen.queryByTestId('overview-error')).not.toBeInTheDocument()
  })

  it('renders real AI analysis when present', () => {
    render(<OverviewTab sym="AAPL" stats={{}} analyst={{}} ai={{ analysis_summary: 'A strong quarter.' }} row={null} error={false} mutate={() => {}} />)
    expect(screen.getByText('A strong quarter.')).toBeInTheDocument()
  })
})

// TERM-088 -- a failed read on the composing endpoints is not "nothing
// available yet". The error banner renders BEFORE the per-card empty
// fallbacks, and the AI snapshot's generic "will appear here" copy -- the one
// genuine empty-state claim in this tab -- is suppressed in favor of an
// honest dash.
describe('OverviewTab -- failed read vs genuine empty state', () => {
  it('renders the error banner on a failed read, not the "will appear here" empty copy', () => {
    render(<OverviewTab sym="AAPL" stats={{}} analyst={{}} ai={{}} row={null} error mutate={() => {}} />)
    expect(screen.getByTestId('overview-error')).toHaveTextContent("Couldn't load")
    expect(screen.queryByText('Earnings analysis will appear here once available.')).not.toBeInTheDocument()
  })

  it('still renders the genuine empty state when the read succeeded with nothing yet', () => {
    render(<OverviewTab sym="AAPL" stats={{}} analyst={{}} ai={{}} row={null} error={false} mutate={() => {}} />)
    expect(screen.getByText('Earnings analysis will appear here once available.')).toBeInTheDocument()
    expect(screen.queryByTestId('overview-error')).not.toBeInTheDocument()
  })

  it('Retry calls mutate', () => {
    const mutate = vi.fn()
    render(<OverviewTab sym="AAPL" stats={{}} analyst={{}} ai={{}} row={null} error mutate={mutate} />)
    screen.getByText('Retry').click()
    expect(mutate).toHaveBeenCalled()
  })
})

// The "Latest report" card (useLatestReport): loading, outage, genuinely-none and a real row
// are four different sentences, and an outage must never read as "nothing reported".
describe('OverviewTab -- Latest report states', () => {
  const base = { sym: 'AAPL', stats: {}, analyst: {}, ai: {}, error: false, mutate: () => {} }

  it('renders the reported row and its quarter label', () => {
    const row = { label: 'FY26 Q2', eps_estimate: '$1.10', reported_eps: '$1.25', surprise_pct: '+13.6%',
      rev_estimate: '$46.00B', rev_actual: '$46.70B', rev_surprise_pct: '+1.5%' }
    render(<OverviewTab {...base} row={row} reportState="ready" retryReport={() => {}} />)
    expect(screen.getByText('Latest report · FY26 Q2')).toBeInTheDocument()
    expect(screen.getByText('$1.25')).toBeInTheDocument()
    expect(screen.getByText('+13.6%')).toBeInTheDocument()
    expect(screen.queryByTestId('latest-report-error')).not.toBeInTheDocument()
  })

  it('a failed read says it could not load, with a Retry -- never "no report"', () => {
    const retry = vi.fn()
    render(<OverviewTab {...base} row={null} reportState="error" retryReport={retry} />)
    expect(screen.getByTestId('latest-report-error')).toHaveTextContent("Couldn't load the latest report.")
    expect(screen.queryByTestId('latest-report-empty')).not.toBeInTheDocument()
    screen.getByText('Retry').click()
    expect(retry).toHaveBeenCalled()
  })

  it('loading and genuinely-none are distinct copy', () => {
    const { unmount } = render(<OverviewTab {...base} row={null} reportState="loading" />)
    expect(screen.getByTestId('latest-report-loading')).toBeInTheDocument()
    unmount()
    render(<OverviewTab {...base} row={null} reportState="empty" />)
    expect(screen.getByTestId('latest-report-empty')).toHaveTextContent('No reported quarter on file yet.')
  })

describe('OverviewTab analyst view (DES)', () => {
  const base = { sym: 'AAPL', stats: {}, ai: {}, row: null, error: false, mutate: () => {} }

  it('the FMP fallback (no mean) shows the median, labelled median -- not a dash', () => {
    render(<OverviewTab {...base} analyst={{ price_target: { targetLow: 150, targetHigh: 300, targetMean: null, targetMedian: 240 } }} />)
    expect(screen.getByTestId('target-range').textContent).toBe('$150.00 — $240.00 (median) — $300.00')
    // the FMP fallback carries no revision date -- said, not implied current
    expect(screen.getByTestId('target-asof').textContent).toBe('Price targets source gives no as-of date.')
  })

  // tq-panels: targets printed without "$" and without the date they were last revised.
  it('price targets read as dollars, with the as-of date', () => {
    render(<OverviewTab {...base} analyst={{ price_target: { targetLow: 230, targetMean: 251.4, targetHigh: 280, lastUpdated: '2026-10-01 00:00:00' } }} />)
    expect(screen.getByTestId('target-range').textContent).toBe('$230.00 — $251.40 — $280.00')
    expect(screen.getByTestId('target-asof').textContent).toBe('Price targets as of 2026-10-01.')
  })

  // tq-panels: a 404 on /api/earnings/intel is "no earnings record", not "couldn't load".
  it('no earnings record says so in the analyst card, with no error banner', () => {
    render(<OverviewTab {...base} analyst={{}} analystMissing />)
    expect(screen.getByTestId('analyst-missing').textContent)
      .toBe('No earnings record for AAPL: the source holds no consensus or price target for it.')
    expect(screen.queryByTestId('overview-error')).toBeNull()
    expect(screen.queryByTestId('target-range')).toBeNull()
  })

  it('a fund says not applicable to funds in both the report and analyst cards', () => {
    render(<OverviewTab {...base} sym="SPY" reportState="not_applicable" reportReason="SPY is a fund; funds do not report earnings" analystMissing />)
    expect(screen.getByTestId('latest-report-na').textContent)
      .toBe('Not applicable to funds: SPY is a fund; funds do not report earnings.')
    expect(screen.queryByTestId('latest-report-empty')).toBeNull()
    expect(screen.getByTestId('analyst-missing').textContent).toMatch(/^Not applicable to funds/)
  })

  it('a mean wins over the median and carries no label', () => {
    expect(targetMid({ targetMean: 231.5, targetMedian: 240 })).toEqual({ value: '$231.50', label: null })
    expect(targetMid({})).toEqual({ value: '—', label: null })
  })

  it('strong buy/sell are counted into the buckets and named', () => {
    render(<OverviewTab {...base} analyst={{ consensus: { strongBuy: 10, buy: 15, hold: 8, sell: 1, strongSell: 0 } }} />)
    expect(screen.getByTestId('consensus-counts').textContent).toBe('Buy 25 (incl. 10 strong) · Hold 8 · Sell 1')
  })

  it('consensus text handles strong sell and absence', () => {
    expect(consensusText({ buy: 2, hold: 3, sell: 1, strongSell: 2 })).toBe('Buy 2 · Hold 3 · Sell 3 (incl. 2 strong)')
    expect(consensusText({})).toBe('—')
    expect(consensusText(undefined)).toBe('—')
  })
})
})
