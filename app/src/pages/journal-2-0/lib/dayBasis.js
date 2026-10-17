/**
 * The basis a day's detail is read on (`useJ2DayDetail(date, accountId, basis)`).
 *
 * ONE derivation for every door that reads a day: the day page (DayDetailPage) and the Today checklist panel.
 * A broker-synced account follows the member's calendar basis preference (`j2_calendar_pnl_basis`, 'account'
 * until they pick), a manual account is always 'closed'. ⛔ Two copies of this would read two different cache
 * entries for the same day (the basis is part of the SWR key), and a tick on one door would not reach the other.
 *
 * @param {{ balanceSource?: string }|null|undefined} account  the selected account (null for All Accounts)
 * @param {Record<string, unknown>|null|undefined} prefs        usePreferences().prefs
 * @returns {'account'|'closed'|string}
 */
import { parsePref } from '../../../hooks/usePreferences'

export function effectiveDayBasis(account, prefs) {
  const isBroker = !!account && account.balanceSource && account.balanceSource !== 'manual'
  return isBroker ? parsePref(prefs?.j2_calendar_pnl_basis, 'account') : 'closed'
}
