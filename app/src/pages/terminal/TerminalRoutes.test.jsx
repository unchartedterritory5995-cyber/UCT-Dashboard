// UCT Terminal — CalendarRoute's loading state. `/calendar` is the single most common
// navigation (TERMINAL-NEXT cohort members land here on their way into the shell), and while
// `usePreferences('terminal_boards.keepCalendar')` resolves, the route must never blank the
// screen -- it renders a neutral placeholder instead.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthContext } from '../../context/AuthContext'
import { CalendarRoute } from './TerminalRoutes'

vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, loading: true }),
}))

const OPEN = { cohorts: ['terminal-next'] }

function renderRoute() {
  return render(
    <AuthContext.Provider value={OPEN}>
      <MemoryRouter initialEntries={['/calendar']}>
        <Routes>
          <Route path="/calendar" element={<CalendarRoute><div data-testid="legacy-calendar" /></CalendarRoute>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('CalendarRoute while terminal_boards.keepCalendar is loading', () => {
  it('renders a non-null placeholder instead of a blank screen', () => {
    const { container } = renderRoute()
    // Not the blank-screen regression: `null` would leave container.firstChild falsy.
    expect(container.firstChild).not.toBeNull()
    expect(container.textContent).toMatch(/Loading/)
  })

  it('does not render the legacy calendar (the choice has not resolved yet)', () => {
    renderRoute()
    expect(screen.queryByTestId('legacy-calendar')).toBeNull()
  })
})
