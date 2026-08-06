// app/src/components/tiles/CatalystFlow.crashRecovery.test.jsx
//
// T11 review round 1, C3 (CRITICAL, most severe on THIS mount): CatalystFlow
// has no route — `setSelected(null)` lives only inside the crashed
// EarningsResearchModal subtree, unreachable once the ErrorBoundary (which
// has no reset of its own) trips. Before this fix a single section crash
// meant that Dashboard user could never open ANY earnings modal again
// without a full page reload — there is no browser Back to fall back on
// here, unlike Calendar.jsx/MyStocksHub.jsx. A dedicated file (not appended
// to CatalystFlow.test.jsx) because it needs to mock EarningsResearchModal
// to synthesize a crash; the existing suite deliberately renders the real one.
import { renderWithProviders, screen, fireEvent } from '../../test-utils'
import { vi, describe, it, expect } from 'vitest'

vi.mock('swr', () => ({
  default: vi.fn(() => ({ data: undefined, error: undefined, mutate: vi.fn() })),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

vi.mock('../research/EarningsResearchModal', () => ({
  default: ({ row }) => {
    if (row?.sym === 'CRASH') throw new Error('synthetic crash for GATE C3 (CatalystFlow)')
    return <div data-testid="erm" data-sym={row?.sym} />
  },
}))

import CatalystFlow from './CatalystFlow'

const mockData = {
  bmo: [
    { sym: 'CRASH', reported_eps: 0.47, rev_actual: 12000, change_pct: 1.43, verdict: 'Beat' },
    { sym: 'AMH', reported_eps: 0.66, rev_actual: 425, change_pct: 0.65, verdict: 'Beat' },
  ],
  amc: [],
  amc_tonight: [],
}

describe('CatalystFlow crashed-boundary recovery (C3)', () => {
  it('a crashed boundary recovers when the user opens a DIFFERENT symbol — no reload needed', () => {
    renderWithProviders(<CatalystFlow data={mockData} />)
    fireEvent.click(screen.getByText('CRASH'))
    expect(screen.getByText(/Unable to load/)).toBeTruthy()
    expect(screen.queryByTestId('erm')).toBeNull()

    fireEvent.click(screen.getByText('AMH'))

    const modal = screen.getByTestId('erm')
    expect(modal.getAttribute('data-sym')).toBe('AMH')
    expect(screen.queryByText(/Unable to load/)).toBeNull()
  })
})
