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

import OverviewTab from './OverviewTab'

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
})
