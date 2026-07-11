import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

// Controllable paid state (Compass is paid-gated in the nav).
let mockIsPaid = true
vi.mock('../../context/AuthContext', () => ({
  useIsPaid: () => mockIsPaid,
  useAuth: () => ({ isPaid: mockIsPaid }),
}))

import JournalMobileNav from './JournalMobileNav'

// Surfaces the live URL so a NavLink click can be asserted.
function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="loc">{`${loc.pathname}${loc.search}`}</div>
}

function renderNav(route = '/journal', { paid = true } = {}) {
  mockIsPaid = paid
  return render(
    <MemoryRouter initialEntries={[route]}>
      <LocationProbe />
      <Routes>
        <Route path="/journal" element={<JournalMobileNav />} />
        <Route path="/journal/*" element={<JournalMobileNav />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockIsPaid = true
})

describe('JournalMobileNav', () => {
  it('renders the 5 primary sections as NavLinks (paid)', () => {
    renderNav('/journal', { paid: true })
    const nav = screen.getByRole('navigation', { name: 'Journal sections (mobile)' })
    for (const label of ['Today', 'Trades', 'Journal', 'Insights', 'Compass']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
    // Exactly the 5 labels, in order (icon-over-label; no stray text).
    expect(nav.textContent).toBe('TodayTradesJournalInsightsCompass')
  })

  it('clicking a section navigates to its route', () => {
    renderNav('/journal', { paid: true })
    fireEvent.click(screen.getByRole('link', { name: 'Insights' }))
    expect(screen.getByTestId('loc')).toHaveTextContent('/journal/insights')
  })

  it('Today uses `end` so it is only active on the exact index route', () => {
    renderNav('/journal/insights', { paid: true })
    // On a sub-route, the Today link is present but NOT aria-current.
    const today = screen.getByRole('link', { name: 'Today' })
    expect(today).not.toHaveAttribute('aria-current', 'page')
    const insights = screen.getByRole('link', { name: 'Insights' })
    expect(insights).toHaveAttribute('aria-current', 'page')
  })

  it('shows Compass as a present-but-disabled teaser when NOT paid (never hidden)', () => {
    renderNav('/journal', { paid: false })
    // Present — never hidden from free users.
    expect(screen.getByText('Compass')).toBeInTheDocument()
    // Teaser is a disabled button, not a navigable link.
    const compass = screen.getByRole('button', { name: 'Compass' })
    expect(compass).toBeDisabled()
    expect(screen.queryByRole('link', { name: 'Compass' })).not.toBeInTheDocument()
  })

  it('uses no emoji', () => {
    renderNav('/journal', { paid: true })
    const nav = screen.getByRole('navigation', { name: 'Journal sections (mobile)' })
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u
    expect(nav.textContent).not.toMatch(emoji)
  })

  it('is the hide-on-desktop mobile nav (its own class, distinct from the rail)', () => {
    renderNav('/journal', { paid: true })
    const nav = screen.getByRole('navigation', { name: 'Journal sections (mobile)' })
    // CSS-module local name is preserved in the generated class → substring check.
    expect(nav.className).toContain('mobileNav')
  })
})
