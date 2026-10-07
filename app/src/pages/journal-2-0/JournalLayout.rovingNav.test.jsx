// app/src/pages/journal-2-0/JournalLayout.rovingNav.test.jsx
//
// Wave 13, lane 13Q-4. The click-budget instrument found that reaching
// anything past the Journal's own top tab bar (Today/Trades/Calendar/
// Notebook/Insights/Compass) costs a full forward Tab walk through all 6
// items one at a time (docs/notebook/wave13-13q2.md §4). This proves the
// roving-tabindex fix against the REAL component (JournalLayout.test.jsx's
// "JournalLayout — primary nav" block already pins the unrelated facts —
// 6 links, no emoji, exact text — unchanged; this file is additive): one Tab
// stop, Arrow keys (Left/Right — a horizontal tab row) + Home/End move
// focus, Enter still navigates, and focus lands on the current route's tab
// when tabbing in.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

let mockIsPaid = true
vi.mock('../../context/AuthContext', () => ({
  useIsPaid: () => mockIsPaid,
  useAuth: () => ({ isPaid: mockIsPaid }),
}))

vi.mock('./hooks/useJ2Settings', () => ({
  default: () => ({
    settings: { setups: [] },
    isLoading: false,
    error: null,
    save: vi.fn(),
    accountName: 'Default',
    isAllAccounts: false,
  }),
}))
vi.mock('./hooks/useBrokerSync', () => ({ default: () => {} }))
vi.mock('./components/accounts/AccountSelector', () => ({
  default: () => <div data-testid="account-selector" />,
}))
vi.mock('./components/PortfolioSettingsModal', () => ({ default: () => null }))
vi.mock('./components/accounts/NewAccountModal', () => ({ default: () => null }))
vi.mock('./components/GenerateReportModal', () => ({ default: () => null }))
vi.mock('./hooks/useJ2SelectedAccount', () => ({
  default: () => ({
    accountId: 'a1',
    account: { id: 'a1', name: 'Default' },
    accounts: [{ id: 'a1', name: 'Default' }],
    setAccount: vi.fn(),
    isLoading: false,
  }),
}))
vi.mock('./components/AddPositionModal', () => ({ default: () => null }))
vi.mock('./components/AddTradeModal', () => ({ default: () => null }))

import JournalLayout, { PRIMARY_NAV } from './JournalLayout'
import { latchNotebookFlags } from './lib/offline/notebookFlags'

latchNotebookFlags({ notebook_offline_default_on: true })

function renderAt(route, { paid = true } = {}) {
  mockIsPaid = paid
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/journal" element={<JournalLayout />}>
          <Route index element={<div data-testid="today" />} />
          <Route path="trades" element={<div data-testid="trades" />} />
          <Route path="calendar" element={<div data-testid="calendar" />} />
          <Route path="notebook" element={<div data-testid="notebook" />} />
          <Route path="insights" element={<div data-testid="insights" />} />
          <Route path="compass" element={<div data-testid="compass" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockIsPaid = true
})

function primaryNav() {
  return screen.getByRole('navigation', { name: 'Journal sections' })
}

function rovingItems() {
  return Array.from(primaryNav().querySelectorAll('[data-roving-item]'))
}

describe('JournalLayout primary nav -- roving tabindex (13Q-4)', () => {
  it('is ONE tab stop over all 6 items, in PRIMARY_NAV order', () => {
    renderAt('/journal')
    const items = rovingItems()
    expect(items.map((n) => n.getAttribute('data-roving-item'))).toEqual(
      PRIMARY_NAV.map((i) => i.to),
    )
    expect(items.filter((n) => n.tabIndex === 0)).toHaveLength(1)
    expect(items.filter((n) => n.tabIndex === -1)).toHaveLength(items.length - 1)
  })

  it('focus lands on the current route tab when tabbing in', () => {
    renderAt('/journal/insights')
    const items = rovingItems()
    const insights = within(primaryNav()).getByRole('link', { name: 'Insights' })
    expect(insights.tabIndex).toBe(0)
    expect(items.filter((n) => n.tabIndex === 0)).toHaveLength(1)
  })

  it('ArrowRight moves focus to the next tab, in order', () => {
    renderAt('/journal')
    const items = rovingItems()
    items[0].focus()
    fireEvent.keyDown(items[0], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(items[1])
    expect(items[1].tabIndex).toBe(0)
  })

  it('ArrowLeft from the first tab wraps to the last tab', () => {
    renderAt('/journal')
    const items = rovingItems()
    items[0].focus()
    fireEvent.keyDown(items[0], { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(items[items.length - 1])
  })

  it('Home/End jump to the first/last tab', () => {
    renderAt('/journal')
    const items = rovingItems()
    items[2].focus()
    fireEvent.keyDown(items[2], { key: 'End' })
    expect(document.activeElement).toBe(items[items.length - 1])
    fireEvent.keyDown(document.activeElement, { key: 'Home' })
    expect(document.activeElement).toBe(items[0])
  })

  it('arrow keys skip the disabled Compass teaser when the member is on the free tier', () => {
    renderAt('/journal', { paid: false })
    const items = rovingItems()
    const insights = items.find((n) => n.getAttribute('data-roving-item') === '/journal/insights')
    insights.focus()
    fireEvent.keyDown(insights, { key: 'ArrowRight' })
    // Compass (last item) is a real disabled <button> when unpaid -- arrow
    // key must not land focus on it (.focus() on a disabled button is a
    // browser no-op, so landing there would silently strand the roving stop).
    // Stepping forward from Insights skips the disabled Compass and wraps to
    // the first enabled item, Today.
    const compass = items[items.length - 1]
    expect(compass.hasAttribute('disabled')).toBe(true)
    expect(document.activeElement).not.toBe(compass)
    expect(document.activeElement).toBe(items[0])
  })

  it('Enter still navigates -- the roving handler never intercepts it', () => {
    renderAt('/journal')
    const items = rovingItems()
    items[0].focus()
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    fireEvent(items[0], event)
    expect(event.defaultPrevented).toBe(false)
    expect(items[0].tagName).toBe('A')
    expect(items[0]).toHaveAttribute('href', '/journal')
  })
})
