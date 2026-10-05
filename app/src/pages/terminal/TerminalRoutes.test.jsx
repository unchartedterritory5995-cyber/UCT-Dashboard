// UCT Terminal — CalendarRoute's loading state. `/calendar` is the single most common
// navigation (TERMINAL-NEXT cohort members land here on their way into the shell), and while
// `usePreferences('terminal_boards.keepCalendar')` resolves, the route must never blank the
// screen -- it renders a neutral placeholder instead.
import { describe, it, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthContext } from '../../context/AuthContext'
import { CalendarRoute } from './TerminalRoutes'
import usePreferences from '../../hooks/usePreferences'

vi.mock('../../hooks/usePreferences', () => ({
  default: vi.fn(() => ({ prefs: {}, loading: true })),
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

// FIX 5: an UNREADABLE (or newer-than-known) terminal_boards preference must warn and
// keep the member on the classic calendar, never silently reverse their "keep classic
// calendar" choice — matching BoardsMenu's idiom for the same guarded states.
describe('FIX 5: CalendarRoute on an unreadable terminal_boards preference', () => {
  test('unreadable: warns and keeps the classic calendar, never silently redirects', () => {
    vi.mocked(usePreferences).mockReturnValue({ prefs: { terminal_boards: '{not json' }, loading: false })
    renderRoute()
    expect(screen.getByRole('alert').textContent).toMatch(/could not be read/i)
    expect(screen.getByTestId('legacy-calendar')).toBeInTheDocument()
  })

  test('newer-than-known: same warn-and-stay treatment as unreadable', () => {
    vi.mocked(usePreferences).mockReturnValue({ prefs: { terminal_boards: JSON.stringify({ v: 999 }) }, loading: false })
    renderRoute()
    expect(screen.getByRole('alert').textContent).toMatch(/could not be read/i)
    expect(screen.getByTestId('legacy-calendar')).toBeInTheDocument()
  })

  test('readable keepCalendar=true: classic calendar, no warning', () => {
    vi.mocked(usePreferences).mockReturnValue({
      prefs: { terminal_boards: JSON.stringify({ v: 1, boards: [], presets: {}, favorites: [], keepCalendar: true }) },
      loading: false,
    })
    renderRoute()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('legacy-calendar')).toBeInTheDocument()
  })

  test('readable keepCalendar=false: redirects into the shell, no warning', () => {
    vi.mocked(usePreferences).mockReturnValue({
      prefs: { terminal_boards: JSON.stringify({ v: 1, boards: [], presets: {}, favorites: [], keepCalendar: false }) },
      loading: false,
    })
    renderRoute()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByTestId('legacy-calendar')).toBeNull()
  })
})
