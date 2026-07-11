import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

// ── mocks (mock-prefixed so vi.mock hoisting can reference them) ──────────────
let mockAccountId = null
let mockAccount = null
const mockSetAccount = vi.fn()
let mockAccounts = []

vi.mock('../hooks/useJ2SelectedAccount', () => ({
  default: () => ({
    accountId: mockAccountId,
    account: mockAccount,
    accounts: mockAccounts,
    setAccount: mockSetAccount,
    isLoading: false,
  }),
}))

vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: vi.fn() }),
  parsePref: (raw, fallback) => (raw == null ? fallback : raw),
}))

// ScopeBar stubbed — asserts the tab mounts it with the right props (the real
// ScopeBar has its own test). Calendar mounts it with dateApplies={false}.
vi.mock('../components/scope/ScopeBar', () => ({
  default: ({ surface, dateApplies }) => (
    <div
      data-testid="scope-bar"
      data-surface={surface}
      data-dateapplies={String(dateApplies)}
    />
  ),
}))

// Navigation chrome + views stubbed — this test is about the tab's own wiring.
vi.mock('../components/calendar/CalendarHeader', () => ({
  default: () => <div data-testid="calendar-header" />,
}))
vi.mock('../components/calendar/MonthView', () => ({
  default: () => <div data-testid="month-view" />,
}))
vi.mock('../components/calendar/YearView', () => ({ default: () => null }))
vi.mock('../components/calendar/WeekView', () => ({ default: () => null }))

import CalendarTab from './CalendarTab'

// Capture the SWR fetch URL + drive the calendar response.
let capturedUrl = null

beforeEach(() => {
  mockAccountId = null
  mockAccount = null
  mockSetAccount.mockClear()
  mockAccounts = [{ id: 'acc1', name: 'Robinhood' }]
  capturedUrl = null
  global.fetch = vi.fn((url) => {
    capturedUrl = String(url)
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ days: [], totals: null, basis: 'closed' }),
    })
  })
})

function renderTab({ route = '/journal' } = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={[route]}>
        <CalendarTab />
      </MemoryRouter>
    </SWRConfig>,
  )
}

describe('CalendarTab — ScopeBar (date facet muted)', () => {
  it('mounts <ScopeBar surface="calendar" dateApplies={false}> above the CalendarHeader', async () => {
    renderTab()
    const bar = await screen.findByTestId('scope-bar')
    expect(bar).toHaveAttribute('data-surface', 'calendar')
    expect(bar).toHaveAttribute('data-dateapplies', 'false')
    // The navigation chrome (CalendarHeader) is preserved.
    expect(screen.getByTestId('calendar-header')).toBeInTheDocument()
  })
})

describe('CalendarTab — non-date Scope facets drive the calendar fetch', () => {
  it('includes non-date facets (symbol) but NOT date_from/date_to', async () => {
    renderTab({ route: '/journal?sc_sym=AAPL&sc_from=2026-01-01&sc_to=2026-12-31&sc_v=1' })
    await screen.findByTestId('scope-bar')
    expect(capturedUrl).toContain('/api/j2/calendar?')
    expect(capturedUrl).toContain('symbol=AAPL')
    // The calendar navigates its OWN dates — the Scope date facet is dropped.
    expect(capturedUrl).not.toContain('date_from')
    expect(capturedUrl).not.toContain('date_to')
  })

  it('includes a setups facet in the calendar fetch URL', async () => {
    renderTab({ route: '/journal?sc_setup=VCP&sc_v=1' })
    await screen.findByTestId('scope-bar')
    expect(capturedUrl).toContain('setups=VCP')
    expect(capturedUrl).not.toContain('date_from')
  })

  it('still carries the calendar own navigation params (view/year)', async () => {
    renderTab({ route: '/journal?sc_sym=TSLA&sc_v=1' })
    await screen.findByTestId('scope-bar')
    expect(capturedUrl).toContain('view=month')
    expect(capturedUrl).toContain('year=')
  })
})

describe('CalendarTab — first-run zero-trades prompt', () => {
  it('shows a subtle first-run prompt when the account has zero closed trades', async () => {
    // beforeEach resolves totals:null (a fresh, never-traded account).
    renderTab()
    expect(await screen.findByTestId('calendar-first-run')).toBeInTheDocument()
    // The grid is NOT replaced — the month view still renders beneath the note.
    expect(screen.getByTestId('month-view')).toBeInTheDocument()
  })

  it('does NOT show the first-run prompt when closed trades exist (no false prompt)', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            days: [{ date: '2026-06-02', tradeCount: 2, pnlDollar: 120 }],
            totals: { tradeCount: 2, netPnlDollar: 120, winners: 1, losers: 1 },
            basis: 'closed',
          }),
      }),
    )
    renderTab()
    // Wait for the initial load to finish (the "Loading calendar…" hint clears).
    await waitFor(() => expect(screen.queryByText(/Loading calendar/i)).toBeNull())
    expect(screen.queryByTestId('calendar-first-run')).toBeNull()
  })
})
