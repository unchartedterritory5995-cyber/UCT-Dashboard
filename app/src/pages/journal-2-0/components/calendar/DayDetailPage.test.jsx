import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// Data hooks — account-mode metrics with the balance breakdown.
vi.mock('../../hooks/useJ2DayDetail', () => ({
  default: () => ({
    metrics: {
      basis: 'account', accountBalanceChange: 500, realizedPnl: 200,
      unrealizedChange: 300, netPnlDollar: 200, pnlPercent: 0.005,
      rSum: 1, tradeCount: 1, winners: 1, losers: 0, winRate: 1,
    },
    trades: [], strategies: { closed: [], expiring: [] }, notes: null,
    isLoading: false, error: null, refresh: () => {},
  }),
}))
vi.mock('../../hooks/useJ2SelectedAccount', () => ({
  default: () => ({ accountId: 'a1', account: { balanceSource: 'snaptrade' } }),
}))
vi.mock('../../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: { j2_calendar_pnl_basis: 'account' }, setPref: () => {} }),
  parsePref: (raw, fallback) => raw ?? fallback,
}))
vi.mock('../../hooks/useJ2DayNotesMutation', () => ({
  default: () => ({ save: () => {}, saving: false, error: null }),
}))
// Presentational children that fetch/own state — stub to no-ops.
vi.mock('./MiniMonthNav', () => ({ default: () => null }))
vi.mock('./DayReflection', () => ({ default: () => null }))
vi.mock('./DayAttachments', () => ({ default: () => null }))
vi.mock('./DayRulesChecklist', () => ({ default: () => null }))
vi.mock('../options/OptionStrategiesSection', () => ({ default: () => null }))

import DayDetailPage from './DayDetailPage'

function renderAt(date) {
  return render(
    <MemoryRouter initialEntries={[`/journal-2-0/calendar/${date}`]}>
      <Routes>
        <Route path="/journal-2-0/calendar/:date" element={<DayDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('DayDetailPage account-mode breakdown', () => {
  it('renders the balance-change breakdown when metrics.basis is account', () => {
    renderAt('2026-06-02')
    expect(screen.getByText(/account balance/i)).toBeInTheDocument()
    expect(screen.getByText(/realized/i)).toBeInTheDocument()
    expect(screen.getByText(/open positions/i)).toBeInTheDocument()
  })
})
