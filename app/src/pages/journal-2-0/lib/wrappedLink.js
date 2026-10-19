/**
 * P2 Tier 3, Task 8 — where "Your <year> in trading" lives and when the current year opens. Kept
 * apart from the page so the Report page door can link to it without pulling the page into its
 * own chunk (the myPlaybookLink.js shape).
 *
 * ⛔ THREE FACTS THE SERVER OWNS, each read from THIS file by tests/test_wrapped.py and compared
 * with the server's value, so the two cannot drift:
 *   OPENS_ON            wrapped.OPENS_ON (the current year opens on this ET month and day)
 *   YEAR_UNAVAILABLE    wrapped.YEAR_UNAVAILABLE_SENTENCE (the route's 400)
 *   ALL_ACCOUNTS_PARAM  unified_coach.UNIFIED_ACCOUNT_ID (the route reads it as no account)
 */
import { todayET } from './calendar'

export const WRAPPED_ROUTE = '/journal-2-0/wrapped/:year'
export const WRAPPED_YEARS_API = '/api/j2/wrapped/years'

/** The current ET year opens on this month and day (wrapped.OPENS_ON). */
export const OPENS_ON = '12-01'
export const YEAR_UNAVAILABLE = "That year isn't available."
export const ALL_ACCOUNTS_PARAM = "_all_"

/**
 * The page for `year`, scoped to the account the link was made for (ruling R-T3-T8-R2). An absent
 * `accountId` (null) is All Accounts and is written as ALL_ACCOUNTS_PARAM, because an absent query
 * means "the Journal's own pick" to the page.
 */
export function wrappedHref(year, accountId) {
  const scope = accountId ? accountId : ALL_ACCOUNTS_PARAM
  return `/journal-2-0/wrapped/${encodeURIComponent(String(year))}?account_id=${encodeURIComponent(scope)}`
}

/** The account a page URL names: undefined when it names none, null for All Accounts, else the id. */
export function accountFromParam(value) {
  if (value == null) return undefined
  return value === '' || value === ALL_ACCOUNTS_PARAM ? null : value
}

/** The ET year of `now`, and whether that year's page is open yet (from December 1 ET). */
export function currentYearOpen(now = new Date()) {
  const today = todayET(now)
  return { year: Number(today.slice(0, 4)), open: today.slice(5) >= OPENS_ON }
}
