// app/src/components/chart/visibleRangeSubscription.js
//
// ⛔⛔ A LIGHTWEIGHT CHARTS `subscribe*` RETURNS NOTHING (2026-11-20, the per-switch memory leak).
//
// `timeScale().subscribeVisibleLogicalRangeChange(fn)` returns `void` (typings.d.ts); the only way to remove
// `fn` is `unsubscribeVisibleLogicalRangeChange(fn)` (the render-window facade, windowedChart.js, forwards the
// same `void` and maps the handler back on unsubscribe). Three StockChart effects kept the return value as their
// "unsubscribe" and called it in the cleanup, so the cleanup removed nothing: every symbol switch left one more
// live handler on the chart's time scale. Each one is a closure from that StockChart render, and the closures of
// one function share one context, so a handler kept the outgoing symbol's whole render alive (its bars and
// everything derived from them): measured on production 2026-11-20, about 20 MB retained per D + 60m switch,
// 2.3 GB after 100 switches, flat bar store, the same with neighbour frames on or off.
//
// This is the one way StockChart subscribes to the visible logical range: it returns the function that really
// removes the handler. `visibleRangeSubscription.test.js` rails it, and a source scan refuses a `subscribe*`
// return value used as an unsubscribe anywhere in app/src.

/** Subscribe `handler` to `chart`'s visible logical range. @returns {() => void} the unsubscribe. */
export function onVisibleLogicalRange(chart, handler) {
  let ts = null
  try {
    ts = chart.timeScale()
    ts.subscribeVisibleLogicalRangeChange(handler)
  } catch {
    return () => {}   // an older or stub library: nothing was subscribed
  }
  let live = true
  return () => {
    if (!live) return
    live = false
    try { ts.unsubscribeVisibleLogicalRangeChange(handler) } catch { /* the chart is gone */ }
  }
}
