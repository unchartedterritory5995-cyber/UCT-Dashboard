// Mount test: the Sync Trust Center is wired into the broker-home tab near the
// existing broker surfaces. Heavy children are mocked to sentinels — this only
// asserts the wiring, not their internals.
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import OpenPositionsTab from './OpenPositionsTab'

vi.mock('../hooks/useJ2Positions', () => ({
  default: () => ({ positions: [], isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('../hooks/useJ2OptionStrategies', () => ({
  default: () => ({ strategies: [], isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('../hooks/useJ2SelectedAccount', () => ({
  default: () => ({ accountId: 'a1', account: { id: 'a1', name: 'Test', balanceSource: 'broker' }, accounts: [] }),
}))
vi.mock('../hooks/useJ2Nudges', () => ({ default: () => ({ nudges: null }) }))
vi.mock('../hooks/useBrokerWarming', () => ({ default: () => ({ warming: false, broker: null }) }))
vi.mock('../../../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: {}, isStreaming: false }),
}))
vi.mock('../components/BrokerAccountHero', () => ({ default: () => null }))
vi.mock('../components/BrokerReviewNudge', () => ({ default: () => null }))
vi.mock('../components/NudgesBanner', () => ({ default: () => null }))
vi.mock('../components/HoldingsList', () => ({ default: () => <div data-testid="holdings-list" /> }))
vi.mock('../components/PositionsTable', () => ({
  default: () => <div data-testid="positions-table" />,
  POSITIONS_COLUMNS: [{ key: 'symbol', label: 'Symbol' }],
}))
// The unit under wiring — mock to a sentinel so we don't fan out its fetches.
vi.mock('../components/trust/SyncTrustCenter', () => ({
  default: () => <div data-testid="sync-trust-center" />,
}))

beforeEach(() => localStorage.clear())

describe('OpenPositionsTab — Sync Trust Center wiring', () => {
  it('mounts the SyncTrustCenter as the ONE broker-sync surface (slim bar retired)', () => {
    render(<OpenPositionsTab settings={{}} />)
    expect(screen.getByTestId('sync-trust-center')).toBeInTheDocument()
    // The old stacked BrokerSyncStatus bar must NOT come back (its Sync-now
    // lives in the Trust Center header now).
    expect(screen.queryByTestId('broker-sync-status')).toBeNull()
  })
})
