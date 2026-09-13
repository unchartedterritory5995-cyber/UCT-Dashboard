/**
 * The zoom window as DATES.
 *
 * ⚰️ THE DEFECT (audit A-07): the chart rebuilds with `notMerge`, so every change —
 * a ticked metric, a live tick, a hidden series — threw the zoom away and showed
 * the full range again. Held as dates, the window survives any rebuild and any
 * new row; it is written back as `dataZoom.startValue/endValue` (D-028).
 *
 * Payloads, read in `echarts/lib/component/dataZoom`: inside zoom dispatches
 * `{batch: [{start, end}]}` in percent (roams.js), the slider `{start, end}`
 * (SliderZoomView.js); `startValue`/`endValue` are honoured when present
 * (dataZoomAction.js).
 */
export function zoomWindowFrom(params, dates) {
  if (!dates?.length) return null
  const last = dates.length - 1
  const b = params?.batch?.[0] ?? params ?? {}
  const clamp = i => Math.max(0, Math.min(last, i))
  const index = (value, pct, fallback) => {
    if (typeof value === 'number') return clamp(Math.round(value))
    if (typeof value === 'string') {
      const i = dates.indexOf(value)
      return i >= 0 ? i : fallback
    }
    if (typeof pct === 'number') return clamp(Math.round((pct / 100) * last))
    return fallback
  }
  const a = index(b.startValue, b.start, 0)
  const z = index(b.endValue, b.end, last)
  const from = Math.min(a, z)
  const to = Math.max(a, z)
  return from <= 0 && to >= last ? null : { from: dates[from], to: dates[to] }
}

/** The zoom window mapped onto the sessions present, or null when nothing is zoomed or none falls inside. */
export function zoomValues(zoom, dates) {
  if (!zoom || !dates?.length) return null
  const inside = dates.filter(d => d >= zoom.from && d <= zoom.to)
  return inside.length ? { startValue: inside[0], endValue: inside[inside.length - 1] } : null
}
