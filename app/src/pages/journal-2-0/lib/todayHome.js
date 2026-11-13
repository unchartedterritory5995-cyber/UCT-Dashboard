// Audit 2026-11-05, spec S15 (M1): where the Notebook opens. The EAGER half, kept small: the Daily brief itself is a
// lazy view (components/notebook/TodayHome.jsx), fetched only when it is shown.
//
// Notebook simplify, Task 5 ("open on your notes"): the Notebook opens on the notes list, always.
//
//   ?view=today   the Daily brief (the Today home: today's plan, setups, names, ...)
//   ?view=home    the notes list (Research home is no longer routed; old links land on the list)
//   ?view=all     the notes list
//   no ?view=     the notes list
//
// ⛔ Opening the Notebook never makes the day's note. Only the Daily brief's own read does (`GET /api/j2/notes/today`),
//    and only when the member opens it.
// ⚰️ The landing used to be a choice ("Open the Notebook on", the `notebook_landing` preference: Today, Research home
//    or All notes, default Today). The stored value is no longer read for the landing; `resolveLanding` answers
//    'all' whatever it holds. The names stay exported for the files that still import them.

export const TODAY_VIEW = 'today'
export const HOME_VIEW = 'home'
export const LANDING_PREF = 'notebook_landing'
// ⚰️ `LANDINGS` (the old choice's three labels, "Research home" among them) left in go-live wave 1: nothing read it.

// Where the 60-second first run's Done lands: the Daily brief (it shows what Build made). test-setup.js turns this off
// before each test, so suites written before the Daily brief existed keep Done opening today's note; a suite about the
// Daily brief turns it back on.
let todayDefaultOn = true
export function __setTodayLandingForTests(on) { todayDefaultOn = on !== false }
export function todayLandingOn() { return todayDefaultOn }

/** Where a bare Notebook opens: always the notes list ('all'), whatever the stored preference says. */
export function resolveLanding() {
  return 'all'
}
