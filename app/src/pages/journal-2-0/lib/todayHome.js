// Audit 2026-11-05, spec S15 (M1): where the Notebook opens. The EAGER half, kept small: the Today home itself is a
// lazy view (components/notebook/TodayHome.jsx), fetched only when it is shown.
//
//   ?view=today   the Today home
//   ?view=home    Research Home (the old landing, still one link away)
//   ?view=all     All notes
//   no ?view=     the member's landing: what they CHOSE ("Open the Notebook on", stored per account in the
//                 `notebook_landing` preference), else the Today home.
//
// ⛔ A member who chose another view keeps it: the choice is stored on the account, never in this browser.
// ⛔ Until the preferences have answered, a bare Notebook shows neither home: opening Today makes the day's note,
//    and a member who chose Research Home must never have one made by a flash of the page they opted out of.

export const TODAY_VIEW = 'today'
export const HOME_VIEW = 'home'
export const LANDING_PREF = 'notebook_landing'
/** The landings a member can choose, in the order the choice lists them. */
export const LANDINGS = Object.freeze([
  { id: 'today', label: 'Today' },
  { id: 'home', label: 'Research home' },
  { id: 'all', label: 'All notes' },
])
const IDS = new Set(LANDINGS.map((l) => l.id))

// The default landing is the Today home. Suites written before it render a bare Notebook and expect Research Home;
// test-setup.js turns this off before each test (a suite about Today turns it back on).
let todayDefaultOn = true
export function __setTodayLandingForTests(on) { todayDefaultOn = on !== false }
export function todayLandingOn() { return todayDefaultOn }

/** The stored choice, or the default: 'today' | 'home' | 'all'. A value this build does not know is the default. */
export function resolveLanding(raw, { on = todayLandingOn() } = {}) {
  let v = typeof raw === 'string' ? raw.trim() : ''
  if (v.startsWith('"')) { try { v = JSON.parse(v) } catch { v = '' } }
  if (IDS.has(v)) return v
  return on ? 'today' : 'home'
}
