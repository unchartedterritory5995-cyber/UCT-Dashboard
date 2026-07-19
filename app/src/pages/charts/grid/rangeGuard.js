// app/src/pages/charts/grid/rangeGuard.js
// Echo/oscillation gate for cross-chart time-range sync. Charts with different
// bar spacing produce slightly different {from,to} for "the same" view, so a
// naive bidirectional bus never settles. Skip an incoming range that's within
// `epsilonSec` of the last one we applied on BOTH ends. Pure + unit-tested;
// the StockChart applyingExternalRangeRef latch handles the same-tick echo.

export function shouldApplyRange(incoming, lastApplied, epsilonSec = 2) {
  if (!incoming || !Number.isFinite(incoming.from) || !Number.isFinite(incoming.to)) return false
  if (!lastApplied) return true
  const near = Math.abs(incoming.from - lastApplied.from) <= epsilonSec &&
               Math.abs(incoming.to - lastApplied.to) <= epsilonSec
  return !near
}
