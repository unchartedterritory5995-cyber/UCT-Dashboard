// UCT Terminal — CalendarRoute's loading state. `/calendar` is the single most common
// navigation (TERMINAL-NEXT cohort members land here on their way into the shell), and while
// `usePreferences('terminal_boards.keepCalendar')` resolves, the route must never blank the
// screen -- it renders a neutral placeholder instead.
import { describe, it, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { AuthContext } from '../../context/AuthContext'
import { CalendarRoute, useTerminalNavPath } from './TerminalRoutes'
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

// V19: the menu's "UCT Terminal" entry moved to `/terminal` (c941080f0), which went round
// CalendarRoute, so "keep classic calendar" was ignored from the menu. `useTerminalNavPath`
// is what the sidebar and the mobile More sheet now link to.
const KEEP = (on) => ({
  prefs: { terminal_boards: JSON.stringify({ v: 1, boards: [], presets: {}, favorites: [], keepCalendar: on }) },
  loading: false,
})

function NavPathProbe() {
  return <span data-testid="nav-path">{useTerminalNavPath()}</span>
}

function navPath(auth) {
  render(<AuthContext.Provider value={auth}><NavPathProbe /></AuthContext.Provider>)
  return screen.getByTestId('nav-path').textContent
}

describe('V19: useTerminalNavPath — the menu entry honours "keep classic calendar"', () => {
  test('a member who kept the classic calendar is sent to /calendar', () => {
    vi.mocked(usePreferences).mockReturnValue(KEEP(true))
    expect(navPath(OPEN)).toBe('/calendar')
  })

  test('a member who did not tick it still gets the terminal', () => {
    vi.mocked(usePreferences).mockReturnValue(KEEP(false))
    expect(navPath(OPEN)).toBe('/terminal')
  })

  test('no stored preference at all: the terminal', () => {
    vi.mocked(usePreferences).mockReturnValue({ prefs: {}, loading: false })
    expect(navPath(OPEN)).toBe('/terminal')
  })

  test('while the preference loads: the terminal (never a guess at the choice)', () => {
    vi.mocked(usePreferences).mockReturnValue({ prefs: {}, loading: true })
    expect(navPath(OPEN)).toBe('/terminal')
  })

  test('an unreadable preference does not flip the entry', () => {
    vi.mocked(usePreferences).mockReturnValue({ prefs: { terminal_boards: '{not json' }, loading: false })
    expect(navPath(OPEN)).toBe('/terminal')
  })

  test('a closed cohort is unchanged (the shell gate already sends /terminal to /calendar)', () => {
    vi.mocked(usePreferences).mockReturnValue(KEEP(true))
    expect(navPath({ cohorts: [] })).toBe('/terminal')
  })
})

// The entry now lands on `/calendar`, so the query-string contract there is what a kept
// deep link relies on: both branches carry `?earnings=` etc. through untouched.
describe('V19: /calendar deep links keep their query string on both branches', () => {
  function Where() {
    const { pathname, search } = useLocation()
    return <span data-testid="where">{pathname + search}</span>
  }
  function renderAt(url) {
    return render(
      <AuthContext.Provider value={OPEN}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/calendar" element={<CalendarRoute><div data-testid="legacy-calendar"><Where /></div></CalendarRoute>} />
            <Route path="/terminal/calendar" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    )
  }

  test('kept: the classic page renders AT the deep link, query intact', () => {
    vi.mocked(usePreferences).mockReturnValue(KEEP(true))
    renderAt('/calendar?earnings=NVDA&week=2026-10-12')
    expect(screen.getByTestId('legacy-calendar')).toBeInTheDocument()
    expect(screen.getByTestId('where').textContent).toBe('/calendar?earnings=NVDA&week=2026-10-12')
  })

  test('not kept: redirected into the shell with the same query', () => {
    vi.mocked(usePreferences).mockReturnValue(KEEP(false))
    renderAt('/calendar?earnings=NVDA&week=2026-10-12')
    expect(screen.queryByTestId('legacy-calendar')).toBeNull()
    expect(screen.getByTestId('where').textContent).toBe('/terminal/calendar?earnings=NVDA&week=2026-10-12')
  })
})
