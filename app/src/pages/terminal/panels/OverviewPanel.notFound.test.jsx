import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// Wave 4 #1: DES on a symbol the server says is not a ticker shows the shared not-found state
// (message + suggestions), never an overview of empty cards.
const overview = { current: null }
vi.mock('../../research/hooks/useResearchOverview', () => ({ default: () => overview.current }))
vi.mock('../../research/hooks/useLatestReport', () => ({
  default: () => ({ row: null, state: 'empty', retry: () => {} }),
}))
vi.mock('../../research/tabs/OverviewTab', () => ({ default: () => <div data-testid="overview-tab" /> }))

import OverviewPanel from './OverviewPanel'

afterEach(cleanup)

describe('OverviewPanel — unknown ticker', () => {
  it('renders the not-found state with suggestions instead of the tab', () => {
    overview.current = {
      sym: 'ZZQXV', analyst: {}, ai: {}, error: false, mutate: () => {}, statsState: 'empty',
      stats: { status: 'empty', name: null, not_found: true, message: 'No data for ZZQXV — check the ticker', suggestions: ['ZQXV'] },
    }
    render(<OverviewPanel sym="ZZQXV" />)
    expect(screen.queryByTestId('overview-tab')).toBeNull()
    expect(screen.getByTestId('des-not-found').textContent).toContain('No data for ZZQXV — check the ticker')
    expect(screen.getByTestId('ticker-suggestion-ZQXV')).toBeTruthy()
  })
  it('a real but empty answer still renders the tab', () => {
    overview.current = { sym: 'AAPL', analyst: {}, ai: {}, error: false, mutate: () => {}, statsState: 'empty', stats: { status: 'empty' } }
    render(<OverviewPanel sym="AAPL" />)
    expect(screen.getByTestId('overview-tab')).toBeTruthy()
    expect(screen.queryByTestId('des-not-found')).toBeNull()
  })
})
