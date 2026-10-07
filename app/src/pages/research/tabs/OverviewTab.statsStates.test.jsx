import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, renderHook } from '@testing-library/react'

// Completeness audit 2026-10-07, ERROR/RETRY gap 2 (DES): the Overview had no loading state, and a
// vendor failure on /api/fundamentals arrived as a 200 with every field null -- the key-stats card
// drew the same "—" for "still loading", "the vendors are down" and "nothing on file". The route
// now carries `status` (tests/test_fundamentals_router.py::TestFundamentalsStatus); the hook turns
// it into `statsState`, and the card says each one in words.
vi.mock('../../../components/FundamentalSnapshot', () => ({ default: () => <div>fundamental-snapshot</div> }))
vi.mock('../DeskCoverage', () => ({ default: () => null }))
vi.mock('../LeadershipBadge', () => ({ default: () => null }))
vi.mock('../ConfidenceBadge', () => ({ default: () => null }))
vi.mock('../../../components/chart/pane/ChartPane', () => ({ default: () => <div>chart-pane</div> }))

import OverviewTab from './OverviewTab'

const base = { sym: 'ZZZQ', stats: {}, analyst: {}, ai: {}, row: null, error: false, mutate: () => {} }

describe('DES key stats: loading, failed and empty are three different sentences', () => {
  it('while the reads are in flight the tab says it is loading, not "will appear here"', () => {
    render(<OverviewTab {...base} statsState="loading" loading aiLoading />)
    expect(screen.getByTestId('overview-loading')).toHaveTextContent('Loading the ZZZQ overview')
    expect(screen.getByTestId('key-stats-loading')).toHaveTextContent('Loading key stats')
    expect(screen.queryByText('Earnings analysis will appear here once available.')).toBeNull()
    expect(screen.getByText('Loading the earnings analysis…')).toBeTruthy()
    expect(screen.queryByText('Mkt cap')).toBeNull()
  })

  it('a vendor failure is an error with a Retry, never drawn as dashes', () => {
    const retryStats = vi.fn()
    render(<OverviewTab {...base} statsState="unavailable" retryStats={retryStats} />)
    const block = screen.getByTestId('key-stats-unavailable')
    expect(block).toHaveAttribute('data-kind', 'error')
    expect(screen.queryByText('Mkt cap')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retryStats).toHaveBeenCalledTimes(1)
  })

  it('a refused read (non-2xx) is the same error with a Retry', () => {
    render(<OverviewTab {...base} statsState="error" retryStats={() => {}} />)
    expect(screen.getByTestId('key-stats-unavailable')).toBeTruthy()
  })

  it('a genuine empty says there is nothing on file, with no Retry', () => {
    render(<OverviewTab {...base} statsState="empty" />)
    const block = screen.getByTestId('key-stats-empty')
    expect(block).toHaveTextContent('No key stats on file for ZZZQ.')
    expect(block).toHaveAttribute('data-kind', 'empty')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('ok draws the numbers', () => {
    render(<OverviewTab {...base} statsState="ok" stats={{ market_cap: '$1.00B', beta: 1.2 }} />)
    expect(screen.getByText('$1.00B')).toBeTruthy()
  })
})

describe('useResearchOverview: statsState from the fundamentals read', () => {
  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('../../../hooks/useMobileSWR')
    vi.doUnmock('../../../hooks/useLivePrices')
  })

  async function stateFor(fundamentals) {
    vi.resetModules()
    vi.doMock('../../../hooks/useMobileSWR', () => ({
      default: (url) => ({
        data: url?.includes('/api/fundamentals/') ? fundamentals : { ok: true, httpStatus: 200, body: {} },
        mutate: () => {},
      }),
    }))
    vi.doMock('../../../hooks/useLivePrices', () => ({ default: () => ({ prices: {} }) }))
    const { default: useResearchOverview } = await import('../hooks/useResearchOverview')
    const { result } = renderHook(() => useResearchOverview('ZZZQ', { header: false }))
    return result.current.statsState
  }

  it('maps each answer to its state', async () => {
    expect(await stateFor(undefined)).toBe('loading')
    expect(await stateFor({ ok: false, httpStatus: 500, body: null })).toBe('error')
    expect(await stateFor({ ok: true, httpStatus: 200, body: { status: 'unavailable', market_cap: null } })).toBe('unavailable')
    expect(await stateFor({ ok: true, httpStatus: 200, body: { status: 'empty', market_cap: null } })).toBe('empty')
    expect(await stateFor({ ok: true, httpStatus: 200, body: { status: 'ok', market_cap: '$1B' } })).toBe('ok')
    // a pre-status cached snapshot has no status and reads as ok
    expect(await stateFor({ ok: true, httpStatus: 200, body: { market_cap: '$1B' } })).toBe('ok')
  })
})
