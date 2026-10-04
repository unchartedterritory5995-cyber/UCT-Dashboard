// UCT Terminal shell — the CLIENT half of rung zero's gate (TERM-068 / RM-N11).
//
// ⭐ THIS IS THE FIRST CONSUMER OF `TERMINAL_NEXT_ENABLED`. The server decides; the
// client is told. `_access_payload` carries `cohorts` = `rollout_gate.client_cohorts(id)`,
// the EFFECTIVE list: the kill switch is evaluated first, so with the flag unset or
// false the list is empty for a member who IS tagged, and no tag was touched. This
// module never re-derives that answer from a role, a plan or a preference.
//
// ⛔ NEVER `user_preferences`. A member writes their own preferences, so a
// preference-backed entitlement is self-grantable (`rollout_gate`'s rule, railed
// server-side by `test_the_gate_NEVER_reads_user_preferences`).
//
// ⛔ OFF IS NEVER A 404 FOR A MEMBER. The shell's two routes redirect to TERMINAL-CURRENT
// (`/calendar`) while the gate is closed, and `/calendar` redirects INTO the shell while it
// is open — both decisions read this one boolean, so the pair cannot loop.
import { useContext } from 'react'
import { AuthContext } from '../../context/AuthContext'

/** Spelled exactly as `api/services/rollout_gate.py::TERMINAL_NEXT_COHORT`.
 *  `terminalGate.test.js` reads the Python source and pins the two together. */
export const TERMINAL_NEXT_COHORT = 'terminal-next'

/** Pure: is the shell released to the member this payload describes? */
export function terminalNextOpen(cohorts) {
  return Array.isArray(cohorts) && cohorts.includes(TERMINAL_NEXT_COHORT)
}

/** useContext, not useAuth(): renders (closed) outside a provider. */
export default function useTerminalNext() {
  return terminalNextOpen(useContext(AuthContext)?.cohorts)
}

/** The shell's paths. `/terminal/calendar` is the Calendar SECTION of the shell
 *  (owner ruling 2026-10-02: the calendar lives inside the UCT Terminal). */
export const TERMINAL_PATH = '/terminal'
export const TERMINAL_CALENDAR_PATH = '/terminal/calendar'
export const LEGACY_CALENDAR_PATH = '/calendar'

/** Where `/calendar` sends a cohort member: the shell's Calendar section, with the
 *  query string and hash carried VERBATIM (`?earnings=`, `?esection=`, `?week=`,
 *  `?d=`, `?view=` are a URL contract shared in Discord and bookmarks — coexistence
 *  §3.4 rows A5 and C1). */
export function calendarIntoShell(search = '', hash = '') {
  return `${TERMINAL_CALENDAR_PATH}${search || ''}${hash || ''}`
}

/** Where a closed shell sends anyone who reaches it: TERMINAL-CURRENT, params kept. */
export function shellOutToCalendar(search = '', hash = '') {
  return `${LEGACY_CALENDAR_PATH}${search || ''}${hash || ''}`
}
