/**
 * Calendar dates for the Data Charts window, on the market's clock.
 *
 * ⚰️ THE DEFECT (audit A-35): the window was built from
 * `new Date().toISOString().slice(0, 10)` — the UTC date — so from 8 PM ET every
 * evening "today" was already tomorrow.
 *
 * ⛔ Labels only. Which session SHOULD exist by now is
 * `utils/marketSession.expectedLatestDailySessionET`, the holiday-aware
 * authority; it is deliberately not restated here (D-025).
 */
const ET_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
})
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `'YYYY-MM-DD'` of `now` in Eastern Time. */
export function todayET(now = new Date()) {
  const p = Object.fromEntries(ET_DATE.formatToParts(now).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

/** Calendar arithmetic on an ISO date. Zone-free: the date is a label, not an instant. */
export function shiftISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** `'Aug 7'`, with the year when it differs from `referenceIso` or there is no reference. */
export function shortSessionDate(iso, referenceIso = null) {
  const [y, m, d] = iso.split('-').map(Number)
  const base = `${MONTHS[m - 1]} ${d}`
  return referenceIso && Number(referenceIso.slice(0, 4)) === y ? base : `${base}, ${y}`
}
