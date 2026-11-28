// app/src/lib/firstChartPaint.js
//
// The page's first chart paint, as a signal a module can wait on WITHOUT importing the bar-pack client (the writer census
// counts every bar-cache import: components/chart/rails/writerCensus). StockChart's markFirstChartPaint
// (lib/barsPackClient.js) leaves a buffered performance mark and dispatches a window event under FIRST_CHART_PAINT_EVENT,
// the one name both read from here. A leaf: no imports.

export const FIRST_CHART_PAINT_EVENT = 'uct:first-chart-paint'

function painted() {
  try { return typeof performance !== 'undefined' && performance.getEntriesByName(FIRST_CHART_PAINT_EVENT).length > 0 } catch { return false }
}

/** Run `fn` once the page's first chart has painted (now, if it has), or after `maxWaitMs` whatever happens. Returns a
 *  cancel. `checkMark: false`: the caller has asked "painted yet?" its own way (barsPackClient's flag); only the wait. */
export function whenFirstChartPainted(fn, { maxWaitMs = 15000, checkMark = true } = {}) {
  if (checkMark && painted()) { fn(); return () => {} }
  let done = false
  let timer = null
  const go = () => {
    if (done) return
    done = true
    if (timer) clearTimeout(timer)
    try { window.removeEventListener(FIRST_CHART_PAINT_EVENT, go) } catch { /* no window */ }
    fn()
  }
  timer = setTimeout(go, maxWaitMs)
  try { window.addEventListener(FIRST_CHART_PAINT_EVENT, go) } catch { /* no window: the timer runs it */ }
  return () => {
    done = true
    if (timer) clearTimeout(timer)
    try { window.removeEventListener(FIRST_CHART_PAINT_EVENT, go) } catch { /* no window */ }
  }
}
