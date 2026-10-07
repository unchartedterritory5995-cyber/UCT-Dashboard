// TERMINAL-NEXT (owner rulings 2026-10-02): the calendar lives INSIDE the UCT Terminal, as
// its Calendar section. Both route wrappers read ONE boolean (`useTerminalNext`, the
// server's effective `cohorts` list) and each redirects to the other only when that boolean
// says the other is the live one, so the pair cannot loop.
//
// ⛔ NEITHER EVER 404s A MEMBER. A closed shell sends you to TERMINAL-CURRENT; an open one
// receives `/calendar` WITH its query string and hash, so `?earnings=`, `?esection=`,
// `?week=`, `?d=` and `?view=` links keep working (coexistence §3.4 rows A5 / C1).
// ⚠️ AuthGuard's free-tier `/calendar?earnings=` -> `/research/:sym` clause matches the
// exact path BEFORE this element renders, so the acquisition redirect (row E2) is untouched.
import { Navigate, useLocation } from 'react-router-dom'
import usePreferences from '../../hooks/usePreferences'
import useTerminalNext, { calendarIntoShell, shellOutToCalendar } from './terminalGate'
import { isGuardedStatus, readLibrary } from './boardModel'
import { TERMINAL_BOARDS_PREF } from './useTerminalLayout'
import { PanelSkeleton } from '../../components/terminal'

/** `/calendar`: today's page, or — for an admitted member — the shell's Calendar section.
 *
 *  Lane T2 / V19: an admitted member may choose to KEEP the classic page here
 *  (`terminal_boards.keepCalendar`, set from the shell's Boards menu); `/terminal` stays open
 *  to them. ⚠️ This is a preference, and that is safe ONLY because it can narrow what a member
 *  sees, never widen it: a closed cohort never reaches this branch (terminalGate.js). While the
 *  preference is loading a neutral placeholder renders (never a blank screen) so the redirect
 *  never fires ahead of the choice. */
export function CalendarRoute({ children }) {
  const open = useTerminalNext()
  const { search, hash } = useLocation()
  const { prefs, loading } = usePreferences(open)
  if (!open) return children
  if (loading) return <div style={{ padding: 'var(--space-lg)' }}><PanelSkeleton label="Loading" /></div>
  const { library, status } = readLibrary(prefs?.[TERMINAL_BOARDS_PREF])
  // An unreadable/newer preference must not silently reverse "keep classic calendar" —
  // warn and stay put, the same idiom BoardsMenu uses for the same guarded states.
  if (isGuardedStatus(status)) {
    return (
      <>
        <p role="alert" style={{ color: 'var(--warn)', padding: 'var(--space-sm) var(--space-lg)', margin: 0 }}>
          Your terminal preferences could not be read, so your "keep classic calendar" choice
          could not be confirmed. Showing the classic calendar for now.
        </p>
        {children}
      </>
    )
  }
  if (library.keepCalendar) return children
  return <Navigate to={calendarIntoShell(search, hash)} replace />
}

/** `/terminal` and `/terminal/calendar`: the shell, or — when closed — `/calendar`. */
export function TerminalRoute({ children }) {
  const open = useTerminalNext()
  const { search, hash } = useLocation()
  if (!open) return <Navigate to={shellOutToCalendar(search, hash)} replace />
  return children
}
