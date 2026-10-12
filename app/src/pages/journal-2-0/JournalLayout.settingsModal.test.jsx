// R-M2-2 M-3: the caller -> modal wiring of "no specific account". Every other JournalLayout test mocks
// PortfolioSettingsModal to null, so a caller passing the wrong prop (or none) stayed green while the
// member lost the banner and the disabled Save. Here the REAL modal is opened from the real header button.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../../context/AuthContext', () => ({
  useIsPaid: () => true,
  useAuth: () => ({ isPaid: true }),
}))
const S = vi.hoisted(() => ({ noSpecificAccount: false, noAccountReason: null }))
vi.mock('./hooks/useJ2Settings', () => ({
  default: () => ({
    settings: { accountSize: 50000, setups: [] },
    isLoading: false,
    error: null,
    save: vi.fn(),
    accountName: 'Default',
    noSpecificAccount: S.noSpecificAccount,
    noAccountReason: S.noAccountReason,
  }),
}))
vi.mock('./hooks/useBrokerSync', () => ({ default: () => {} }))
vi.mock('./components/accounts/AccountSelector', () => ({ default: () => <div data-testid="account-selector" /> }))
vi.mock('./components/accounts/NewAccountModal', () => ({ default: () => null }))
vi.mock('./components/GenerateReportModal', () => ({ default: () => null }))
vi.mock('./hooks/useJ2SelectedAccount', () => ({
  default: () => ({ accountId: null, account: null, accounts: [{ id: 'a1', name: 'Default' }], setAccount: vi.fn(), isLoading: false }),
}))
vi.mock('./components/AddPositionModal', () => ({ default: () => null }))
vi.mock('./components/AddTradeModal', () => ({ default: () => null }))
vi.mock('../../hooks/usePreferences', async (orig) => ({
  ...(await orig()),
  default: () => ({ prefs: {}, setPref: vi.fn(), loading: false }),
}))

import JournalLayout from './JournalLayout'

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/journal']}>
      <Routes>
        <Route path="/journal" element={<JournalLayout />}>
          <Route index element={<div data-testid="surface" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => { S.noSpecificAccount = false; S.noAccountReason = null })

describe('JournalLayout -> PortfolioSettingsModal: no specific account', () => {
  it('All Accounts chosen: the REAL modal shows the All Accounts sentence and Save is disabled', async () => {
    S.noSpecificAccount = true
    S.noAccountReason = 'all'
    renderLayout()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open Portfolio Settings' }))
    const save = await screen.findByRole('button', { name: 'Save Settings' }, { timeout: 5000 })
    expect(screen.getByRole('status').textContent).toMatch(/^All Accounts is selected\./)
    expect(save).toBeDisabled()
  })
  it('control: one account selected opens the real modal with no banner and Save enabled', async () => {
    renderLayout()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open Portfolio Settings' }))
    const save = await screen.findByRole('button', { name: 'Save Settings' }, { timeout: 5000 })
    expect(screen.queryByRole('status')).toBeNull()
    expect(save).not.toBeDisabled()
  })
})
