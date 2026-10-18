import { parsePref } from '../../../hooks/usePreferences'

/**
 * True for a broker-synced account: it has a balance source and that source is not 'manual'.
 * The one test for "is this account a broker account" on the calendar and day doors.
 *
 * @param {{ balanceSource?: string }|null|undefined} account  the selected account (null for All Accounts)
 * @returns {boolean}
 */
export function isBrokerAccount(account) {
  return !!account && !!account.balanceSource && account.balanceSource !== 'manual'
}

/**
 * The P&L basis a calendar or a day is read on (`useJ2Calendar`'s `basis`, `useJ2DayDetail(date, accountId, basis)`).
 *
 * ONE derivation for every door that reads the calendar or a day: the calendar tab (CalendarTab), the day page
 * (DayDetailPage) and the Today checklist panel. A broker-synced account follows the member's calendar basis
 * preference (`j2_calendar_pnl_basis`, 'account' until they pick), a manual account is always 'closed'.
 * ⛔ Two copies of this would read two different cache entries for the same day (the basis is part of the SWR
 * key), and a tick on one door would not reach the other.
 *
 * @param {{ balanceSource?: string }|null|undefined} account  the selected account (null for All Accounts)
 * @param {Record<string, unknown>|null|undefined} prefs        usePreferences().prefs
 * @returns {'account'|'closed'|string}
 */
export function effectiveDayBasis(account, prefs) {
  return isBrokerAccount(account) ? parsePref(prefs?.j2_calendar_pnl_basis, 'account') : 'closed'
}
