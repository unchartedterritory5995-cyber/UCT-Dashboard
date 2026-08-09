// Loading state: the holdings skeleton (not text) shows while positions load.
//
// ⛔ MOCK ONLY WHAT THE TAB ACTUALLY IMPORTS. This file carried
// `vi.mock('../components/BrokerSyncStatus', …)` long after `OpenPositionsTab`
// stopped importing it — the sync bar was absorbed into
// `components/trust/SyncTrustCenter`. A mock of a module nobody imports is
// inert: it never intercepts anything, so it can never fail for the reason it
// was written, and it reads to the next engineer as protection that is not
// there. Removed 2026-08-09; the same dead mock was in
// `OpenPositionsTab.view.test.jsx`. If you add a mock here, first confirm the
// specifier appears in `OpenPositionsTab.jsx`'s import list.
// ⚠️ `SyncTrustCenter` is deliberately NOT mocked — it renders for real (that
// is where the act() warnings below come from).
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
