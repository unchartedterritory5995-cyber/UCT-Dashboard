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
