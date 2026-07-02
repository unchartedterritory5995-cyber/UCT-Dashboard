// Loading state: the holdings skeleton (not text) shows while positions load.
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import OpenPositionsTab from './OpenPositionsTab'

vi.mock('../hooks/useJ2Positions', () => ({
  default: () => ({ positions: [], isLoading: true, error: null, refresh: vi.fn() }),
}))
vi.mock('../hooks/useJ2OptionStrategies', () => ({
  default: () => ({ strategies: [], isLoading: true, error: null, refresh: vi.fn() }),
}))
vi.mock('../hooks/useJ2SelectedAccount', () => ({
  default: () => ({ accountId: 'a1', account: { id: 'a1', name: 'Test' }, accounts: [] }),
}))
vi.mock('../hooks/useJ2Nudges', () => ({ default: () => ({ nudges: null }) }))
vi.mock('../hooks/useBrokerWarming', () => ({ default: () => ({ warming: false, broker: null }) }))
vi.mock('../../../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: {}, isStreaming: false }),
}))
vi.mock('../components/BrokerAccountHero', () => ({ default: () => null }))
vi.mock('../components/BrokerSyncStatus', () => ({ default: () => null }))
vi.mock('../components/BrokerReviewNudge', () => ({ default: () => null }))
vi.mock('../components/NudgesBanner', () => ({ default: () => null }))

describe('OpenPositionsTab loading state', () => {
  it('shows the holdings skeleton instead of loading text', () => {
    render(<OpenPositionsTab settings={{}} />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('Loading positions…')).toBeInTheDocument()  // sr-only label
    expect(screen.queryByText(/Loading positions…/, { selector: 'div' })).toBeNull()
  })
})
