// When a live-stream pool (barsStreamManager, priceStreamManager) reconnects after its subscriptions change.
//
// ⚡ A SINGLE SWITCH CONNECTS AT ONCE (owner, 2026-11-20: typing SPY / QQQ / IWM on a 1m chart "loads a candle or two
// behind", then takes a second to reach the live candle). Every subscription change waited a flat 400 ms before the
// pool reconnected, so the new symbol's live candle could not arrive before ~400 ms + connect + first frame (measured
// on production: the stream itself answered 45 ms after it opened).
//
// The rule, per pool (barsStreamManager / priceStreamManager _scheduleRebuild; two module variables, kept tiny:
// both pools ride the notebook's first-open bytes budget, tools/notebook_perf_budgets.py):
//   - a change on a QUIET pool (no change and no reconnect within `debounceMs`) gathers for REBUILD_GATHER_MS — long
//     enough for every subscriber of one switch (the chart's writer, the legend, the header price) to share one
//     reconnect — and connects;
//   - a change while that gather is still pending keeps gathering;
//   - any other change (the pool was busy moments ago: a member scanning a list by keyboard, a board mounting its
//     charts over a few hundred ms) waits the full debounce from THIS change, exactly as before: a scan reconnects
//     once, after it stops, never per row. "Busy" counts the last change as well as the last reconnect.
export const REBUILD_GATHER_MS = 30
