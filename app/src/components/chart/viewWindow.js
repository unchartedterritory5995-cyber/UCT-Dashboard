// app/src/components/chart/viewWindow.js
//
// (owner, 2026-11-27: charts at any date) THE WINDOW AN INTRADAY CHART READS AT A PAST DATE: the one ending at that ET date
// (the `@to=` key, as intraday replay's). One rule for the chart (useBarSnapshotBars chartKeyFor), the double buffer's
// proofs, the switch's prepare and the date's warms (review of #2947, H2). A leaf.
import { isDateTf, dateLabelToUnix } from '../../data/barStore/types'
import { isNativeTf } from './timeframes'

/** The window an INTRADAY chart anchored at `dateIso` ('YYYY-MM-DD') reads: the one ending at that ET date (noon UTC is
 *  that ET date, as the replay window's); null on D/W/M, a custom timeframe, or no date. */
export function viewWindowOfDate(dateIso, resolvedTf) {
  if (!dateIso || !resolvedTf || isDateTf(resolvedTf) || !isNativeTf(resolvedTf)) return null
  const to = dateLabelToUnix(String(dateIso).slice(0, 10)) + 43200
  return Number.isFinite(to) ? { to } : null
}

/** The window the chart painting under a member reads at the date it was sent to (chart/viewDate memberViewDate:
 *  `{rightMs}` noon UTC of the date), on `tf`; null at the present, or on D/W/M. */
export function viewWindowOfMemberDate(date, tf) {
  if (!date || !Number.isFinite(date.rightMs)) return null
  return viewWindowOfDate(new Date(date.rightMs).toISOString().slice(0, 10), String(tf))
}
