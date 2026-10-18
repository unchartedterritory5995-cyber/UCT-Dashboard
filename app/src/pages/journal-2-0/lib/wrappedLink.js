/**
 * P2 Tier 3, Task 8 — where "Your <year> in trading" lives and when the current year opens. Kept
 * apart from the page so the Report page door can link to it without pulling the page into its
 * own chunk (the myPlaybookLink.js shape).
 *
 * ⛔ ONE FACT IN TWO FILES: `OPENS_ON` is `api/services/journal_two/wrapped.py`'s `OPENS_ON`.
 * tests/test_wrapped.py reads THIS file and compares the two, so the door and the server cannot
 * disagree about the day the current year opens.
 */
import { todayET } from './calendar'

export const WRAPPED_ROUTE = '/journal-2-0/wrapped/:year'
export const WRAPPED_YEARS_API = '/api/j2/wrapped/years'

/** The current ET year opens on this month and day (wrapped.OPENS_ON). */
export const OPENS_ON = '12-01'

export function wrappedHref(year) {
  return `/journal-2-0/wrapped/${encodeURIComponent(String(year))}`
}

/** The ET year of `now`, and whether that year's page is open yet (from December 1 ET). */
export function currentYearOpen(now = new Date()) {
  const today = todayET(now)
  return { year: Number(today.slice(0, 4)), open: today.slice(5) >= OPENS_ON }
}
