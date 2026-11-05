// app/src/pages/charts/grid/rangeGuard.js
// Echo/oscillation gate for cross-chart time-range sync. Charts with different
// bar spacing produce slightly different {from,to} for "the same" view, so a
// naive bidirectional bus never settles. Skip an incoming range that's within
// `epsilonSec` of the chart's own on BOTH ends. Pure + unit-tested; the
// StockChart applyingExternalRangeRef latch handles the same-tick echo.

// A range end is whatever time the chart was fed: unix seconds for intraday,
// 'YYYY-MM-DD' for D/W/M, or a BusinessDay object if a series ever carries one.
// All three compare as seconds. A D/W/M range used to read as "not a number"
// here, so it was refused outright and those charts never synced.
export function rangeTimeSec(t) {
  if (typeof t === 'number') return Number.isFinite(t) ? t : null
  if (typeof t === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000 : null
  }
  if (t && Number.isFinite(t.year)) return Date.UTC(t.year, t.month - 1, t.day) / 1000
  return null
}

export function shouldApplyRange(incoming, lastApplied, epsilonSec = 2) {
  const from = rangeTimeSec(incoming?.from)
  const to = rangeTimeSec(incoming?.to)
  if (from == null || to == null) return false
  const lastFrom = rangeTimeSec(lastApplied?.from)
  const lastTo = rangeTimeSec(lastApplied?.to)
  if (lastFrom == null || lastTo == null) return true
  const near = Math.abs(from - lastFrom) <= epsilonSec &&
               Math.abs(to - lastTo) <= epsilonSec
  return !near
}

// Can this chart show the range? Ends past its history clamp onto its first or last
// bar, so a chart holding only a sliver of the range would stretch that sliver across
// the whole cell, down to a single candle. It keeps its own view until it holds at
// least `minShare` of the range.
export function rangeFitsBars(range, firstTime, lastTime, minShare = 0.5) {
  const from = rangeTimeSec(range?.from)
  const to = rangeTimeSec(range?.to)
  const first = rangeTimeSec(firstTime)
  const last = rangeTimeSec(lastTime)
  if (from == null || to == null || first == null || last == null) return false
  const held = Math.min(to, last) - Math.max(from, first)
  return held >= 0 && held >= (to - from) * minShare
}

// Where the bars in a view stop. A visible range runs on past the newest bar into the
// chart's empty future axis, which ends far from it when the chart's last bar is old.
// Counted as history, that axis made a view from the default position, whose right edge
// sits on it, read as a range nobody could hold, so no other chart followed.
export function rangeBarsEnd(to, lastTime) {
  const end = rangeTimeSec(to)
  const last = rangeTimeSec(lastTime)
  return end != null && last != null && last < end ? lastTime : to
}

// Is this view mostly bars? A chart's time range is clipped to its bars, so one
// scrolled off the end of its history reports a few days while drawing a cell of
// empty space. That is no range to hand to anyone. The ordinary gap to the right of
// the newest bar is well inside `minShare`.
export function viewMostlyBars(logical, barCount, minShare = 0.8) {
  if (!logical || !(barCount > 0) || !(logical.to > logical.from)) return false
  const bars = Math.min(logical.to, barCount - 1) - Math.max(logical.from, 0)
  return bars >= (logical.to - logical.from) * minShare
}
