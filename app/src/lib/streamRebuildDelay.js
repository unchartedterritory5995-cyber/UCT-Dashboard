// When a live-stream pool (barsStreamManager, priceStreamManager) reconnects after its subscriptions change.
//
// ⚡ A SINGLE SWITCH CONNECTS AT ONCE (owner, 2026-11-20: typing SPY / QQQ / IWM on a 1m chart "loads a candle or two
// behind", then takes a second to reach the live candle). Every subscription change waited a flat 400 ms before the
// pool reconnected, so the new symbol's live candle could not arrive before ~400 ms + connect + first frame (measured
// on production: the stream itself answered 45 ms after it opened). Now an IDLE pool (no reconnect within the last
// `debounceMs`) gathers for REBUILD_GATHER_MS — long enough for every subscriber of one switch (the chart's writer,
// the legend, the header price) to land in the same reconnect — and connects. A pool that reconnected moments ago (a
// member scanning down a list by keyboard) still waits the full debounce, so a scan never opens a connection per row.
export const REBUILD_GATHER_MS = 30

/**
 * @param {number} lastRebuildAt  Date.now() of the pool's last reconnect (-Infinity: never)
 * @param {number} now            Date.now()
 * @param {number} debounceMs     the pool's scan debounce (REBUILD_DEBOUNCE_MS)
 * @returns {number} ms to wait before reconnecting
 */
export function rebuildDelay(lastRebuildAt, now, debounceMs) {
  return now - lastRebuildAt >= debounceMs ? REBUILD_GATHER_MS : debounceMs
}
