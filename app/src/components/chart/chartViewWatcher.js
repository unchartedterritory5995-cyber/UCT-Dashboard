// Watches a Lightweight Charts view (visible range + price-to-pixel mapping) for the canvas overlays
// that draw on top of a chart (drawings, callouts, setup moves) and tells them when it moved.
//
// WHY (measured 2026-11-10, page-cost proof, /charts after hours): each overlay re-armed
// `requestAnimationFrame` forever to sample the view, so a still chart ran 60 overlay ticks a second
// per overlay, per chart, all day. This is the same loop on `createAdaptiveFrameLoop`: every frame
// while the view moves (or while the overlay says it is settling), a 250 ms safety pass when still.
//
// Wakes: the time scale's visible-range change (also forwarded to `onRange` for the same-frame
// redraw the overlays rely on during a focus zoom), the series' data change (autoscale moves the
// price mapping), pointer and wheel events on the chart's own element (a price-axis drag changes the
// mapping without a range change) and window resize.
//
// `sample(ctx)` runs on every tick with `{ chart, series, key, y0 }` and returns:
//   * `undefined` / anything else: the view key decides (idle after it stops changing)
//   * `null`: still settling, keep measuring every frame (a snap waiting to land, a pending re-search)
// The chart and series are re-read from their refs on every tick, so an overlay that mounts before
// its chart exists, or whose series is replaced, keeps working (the "trendline doesn't stay put" bug).
import { createAdaptiveFrameLoop } from './adaptiveFrameLoop'

export const NO_CHART_FRAMES = 180 // ~3 s of every-frame polling for a chart that has not appeared yet

export function viewKey(chart, series, extra = '') {
  const r = chart.timeScale().getVisibleLogicalRange()
  let y0 = null
  let y1 = null
  try { y0 = series?.priceToCoordinate(1); y1 = series?.priceToCoordinate(100) } catch { /* disposed series */ }
  return { key: `${r ? `${r.from.toFixed(2)}_${r.to.toFixed(2)}` : ''}|${y0 ?? ''}|${y1 ?? ''}|${extra}`, y0 }
}

export function watchChartView({
  chartRef,
  seriesRef,
  onRange,
  sample,
  extraKey,
  loopFactory = createAdaptiveFrameLoop,
  win = typeof window !== 'undefined' ? window : null,
}) {
  let loop = null
  let chartSub = null
  let seriesSub = null
  let wakeEl = null
  let noChart = 0
  const wake = () => loop?.wake()
  const rangeHandler = () => {
    onRange?.()
    wake()
  }
  const POINTER = ['pointerdown', 'pointermove', 'pointerup', 'wheel']

  const unsubscribeChart = () => {
    try { chartSub?.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler) } catch { /* gone */ }
    chartSub = null
    if (wakeEl) for (const ev of POINTER) wakeEl.removeEventListener(ev, wake)
    wakeEl = null
  }
  const unsubscribeSeries = () => {
    try { seriesSub?.unsubscribeDataChanged?.(wake) } catch { /* gone */ }
    seriesSub = null
  }

  const tick = () => {
    const chart = chartRef?.current
    const series = seriesRef?.current
    if (chart !== chartSub) {
      unsubscribeChart()
      if (chart) {
        try { chart.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler); chartSub = chart } catch { /* older API */ }
        try {
          const el = typeof chart.chartElement === 'function' ? chart.chartElement() : null
          if (el) {
            for (const ev of POINTER) el.addEventListener(ev, wake, { passive: true })
            wakeEl = el
          }
        } catch { /* the safety pass covers it */ }
      }
    }
    if (series !== seriesSub) {
      unsubscribeSeries()
      if (series && typeof series.subscribeDataChanged === 'function') {
        try { series.subscribeDataChanged(wake); seriesSub = series } catch { /* the safety pass covers it */ }
      }
    }
    if (!chart) {
      noChart++
      return noChart < NO_CHART_FRAMES ? null : 'no-chart'
    }
    noChart = 0
    try {
      const { key, y0 } = viewKey(chart, series, extraKey ? extraKey() : '')
      const verdict = sample?.({ chart, series, key, y0 })
      return verdict === null ? null : key
    } catch {
      return 'torn-down' // chart torn down mid-frame: idle until something changes
    }
  }

  loop = loopFactory({ tick })
  loop.start()
  win?.addEventListener?.('resize', wake)
  return {
    wake,
    stop() {
      loop.stop()
      win?.removeEventListener?.('resize', wake)
      unsubscribeChart()
      unsubscribeSeries()
    },
  }
}
