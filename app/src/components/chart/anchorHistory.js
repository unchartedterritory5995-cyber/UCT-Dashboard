// app/src/components/chart/anchorHistory.js
//
// ⭐ (review of #2947, M2; rail LOW 1) "NO BARS AT THE DATE" ONLY ONCE THE WHOLE HISTORY IS HERE. A date before the loaded
// rows frames the earliest HELD bars (StockChart `anchorEarliest`), and D/W/M then ask their full depth: while it loads, a
// name that has bars at the date said it had none. Done: a host's own bars (no longer pending); intraday, its window
// answered; D/W/M, the full depth asked, settled, and (bar store) no deep history still due.

/**
 * @param {object} o
 * @param {boolean} o.anchorEarliest  the date is before the held rows
 * @param {boolean} o.hasOverride     a host supplies the bars (barsOverride)
 * @param {boolean} o.overridePending the host's bars are still loading
 * @param {boolean} o.intraday
 * @param {boolean} o.validating      a read of the chart's bars is in flight
 * @param {number}  o.fetchDepth      D/W/M: the depth asked
 * @param {number}  o.fullTarget      D/W/M: the full depth
 * @param {boolean} o.store           the bar store serves the chart
 * @param {() => boolean} o.deepPending  (bar store) is the key's deep history still due? A throw reads as not due.
 * @returns {boolean} the whole history is here (the "no bars at the date" note may show)
 */
export function anchorHistoryDone({ anchorEarliest, hasOverride, overridePending, intraday, validating, fetchDepth, fullTarget, store, deepPending }) {
  if (!anchorEarliest) return true
  if (hasOverride) return !overridePending
  if (intraday) return !validating
  if (fetchDepth !== fullTarget || validating) return false
  if (!store) return true
  let due = false
  try { due = !!deepPending?.() } catch { due = false }
  return !due
}
