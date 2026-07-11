/**
 * AccountsSurface (B6) — the canonical account-management home.
 *
 * `/journal/accounts` renders AccountsTab, which now assembles the full home:
 *   - the account list (create/select/delete)
 *   - a Brokerage Connection section (BrokerConnectionsCard — broker connect/
 *     disconnect + dup review is reachable HERE, not only in global Settings)
 *   - Goals (GoalProgress) for the selected account
 *   - the Account Comparison grid
 *
 * These tests assert the four sections mount. The heavy leaf children
 * (BrokerConnectionsCard / ComparisonGrid / GoalProgress / Milestones) are
 * stubbed — the point is that the surface WIRES them, not their internals.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AccountsSurface from './AccountsSurface'

// ── data hooks AccountsTab consumes ──────────────────────────────────────────
vi.mock('../hooks/useJ2Accounts', () => ({
  default: () => ({
    accounts: [{ id: 'a1', name: 'Main', color: 'green', broker: null, startingBalance: 10000 }],
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))
vi.mock('../hooks/useJ2AccountComparison', () => ({
  default: () => ({
    accounts: [{ id: 'a1', tradeCount: 12, currentBalance: 10500, totalReturn: 5 }],
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))
vi.mock('../hooks/useJ2SelectedAccount', () => ({
  default: () => ({
    accountId: 'a1',
    account: { id: 'a1', name: 'Main', goals: {} },
    setAccount: vi.fn(),
    accounts: [{ id: 'a1', name: 'Main' }],
    isLoading: false,
  }),
}))

// ── heavy leaf children → simple stubs (assert they mount) ───────────────────
vi.mock('../components/BrokerConnectionsCard', () => ({
  default: () => <div data-testid="broker-connections">Brokerage Connections</div>,
}))
vi.mock('../components/accounts/ComparisonGrid', () => ({
  default: () => <div data-testid="comparison-grid">comparison</div>,
}))
vi.mock('../components/accounts/GoalProgress', () => ({
  default: () => <div data-testid="goal-progress">goals</div>,
}))
vi.mock('../components/accounts/Milestones', () => ({
  default: () => <div data-testid="milestones">milestones</div>,
}))
vi.mock('../components/accounts/NewAccountModal', () => ({
  default: () => <div data-testid="new-account-modal" />,
}))

function renderSurface() {
  return render(
    <MemoryRouter>
      <AccountsSurface />
    </MemoryRouter>,
  )
}

describe('AccountsSurface — canonical account-management home', () => {
  it('renders the account list', () => {
    renderSurface()
    expect(screen.getByText('Your Accounts')).toBeTruthy()
    expect(screen.getByText('Main')).toBeTruthy()
  })

  it('surfaces a Brokerage Connection section — broker connect is reachable here', () => {
    renderSurface()
    // BrokerConnectionsCard mounts on the Accounts home (not only global Settings).
    expect(screen.getByTestId('broker-connections')).toBeTruthy()
  })

  it('renders Goals (GoalProgress) for the selected account', () => {
    renderSurface()
    expect(screen.getByTestId('goal-progress')).toBeTruthy()
  })

  it('renders the account comparison', () => {
    renderSurface()
    expect(screen.getByText('Account Comparison')).toBeTruthy()
    expect(screen.getByTestId('comparison-grid')).toBeTruthy()
  })

  it('uses no emoji (UIcon section headers only)', () => {
    const { container } = renderSurface()
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
