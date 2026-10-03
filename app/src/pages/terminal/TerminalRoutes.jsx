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
import useTerminalNext, { calendarIntoShell, shellOutToCalendar } from './terminalGate'

/** `/calendar`: today's page, or — for an admitted member — the shell's Calendar section. */
export function CalendarRoute({ children }) {
  const open = useTerminalNext()
  const { search, hash } = useLocation()
  if (open) return <Navigate to={calendarIntoShell(search, hash)} replace />
  return children
}

/** `/terminal` and `/terminal/calendar`: the shell, or — when closed — `/calendar`. */
export function TerminalRoute({ children }) {
  const open = useTerminalNext()
  const { search, hash } = useLocation()
  if (!open) return <Navigate to={shellOutToCalendar(search, hash)} replace />
  return children
}
