// ── PRICE ALERT LINES — Chart Settings → Markers → Your activity → Price alerts (owner 11-16, was Soon) ──
//
// While ON (`priceAlertLines: true`, chartViewOptions.js; ABSENT = OFF = today's look — the chart drew no alert
// lines before this row existed), the member's ACTIVE price alerts on the chart's symbol are drawn as dashed
// horizontal price lines labelled "Alert" on the price scale. READ-ONLY: nothing here creates, moves or deletes an
// alert (the chart menu's "Set alert", the Alerts widget and the bell own that).
//
// ⭐ NO NEW BACKEND, NO SECOND CACHE. The list is `GET /api/watchlist-alerts` (api/routers/watchlist_alerts.py,
// owner-scoped, active rows only by default) under the SAME SWR key `useBoundDrawingAlerts` and `useWatchlistAlerts`
// read, so SWR dedupes them into one request, and every create / delete (they all revalidate every
// `/api/watchlist-alerts*` key) redraws the lines at once. Fetched only while the setting is ON.
//
// WHICH ALERTS DRAW: `is_active` (an alert that went off turns inactive and its line goes), the chart's symbol
// (case-insensitive), a finite positive level. A `trendline` alert (a sloped drawing's "Set alert…" that follows the
// line) has no single price — its level moves with time and its drawing already shows it — so it is not drawn as a
// flat line. A horizontal-line / Fib-level / position alert (`alert_type: 'line'`) and a plain price alert do draw.
//
// ⭐ UCT Signature: muted steel-blue (the approved lab swatch), never gold — gold is only for the current/chosen.

import useMobileSWR from '../../hooks/useMobileSWR'

export const PRICE_ALERTS_KEY = '/api/watchlist-alerts'
export const ALERT_LINE_COLOR = '#6ba3be'
export const ALERT_LINE_TITLE = 'Alert'

const fetcher = (url) => fetch(url).then((r) => (r.ok ? r.json() : []))

/** The member's alert rows while `on` (else none, and nothing is fetched). Same key + cadence as useBoundDrawingAlerts. */
export function usePriceAlertRows(on) {
  const { data } = useMobileSWR(on ? PRICE_ALERTS_KEY : null, fetcher, {
    refreshInterval: 60000,
    dedupingInterval: 30000,
  })
  return on && Array.isArray(data) ? data : null
}

/** The levels to draw for `sym`: [{ id, price }] sorted by price then id. Pure. */
export function activeAlertLevels(alerts, sym) {
  const symU = String(sym || '').trim().toUpperCase()
  if (!symU || !Array.isArray(alerts)) return []
  const out = []
  for (const a of alerts) {
    if (!a || !a.is_active) continue
    if (String(a.sym || '').trim().toUpperCase() !== symU) continue
    if (a.alert_type === 'trendline') continue
    const price = Number(a.target_price)
    if (!Number.isFinite(price) || price <= 0) continue
    out.push({ id: String(a.id), price })
  }
  out.sort((x, y) => (x.price - y.price) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
  return out
}

/** lightweight-charts createPriceLine options for each level (dashed, 1px, axis label "Alert"). Pure. */
export function alertPriceLines(levels, color = ALERT_LINE_COLOR) {
  return (levels || []).map((l) => ({
    price: l.price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, lineVisible: true, title: ALERT_LINE_TITLE,
  }))
}

/** What the lines show, as one string — the chart rebuilds them only when this changes. Pure. */
export const alertLinesKey = (lines) => lines.map((l) => `${l.price}|${l.color}`).join(',')

/**
 * Keep a series' alert price lines equal to `lines`. `state` = { series, handles, key } (a ref's current), mutated.
 * A different series (a chart-type swap or a recreated chart) starts from nothing: its old handles died with it.
 */
export function syncAlertPriceLines(state, series, lines) {
  if (state.series !== series) {
    for (const h of state.handles) { try { state.series?.removePriceLine(h) } catch { /* series gone */ } }
    state.series = series
    state.handles = []
    state.key = ''
  }
  if (!series) return
  const key = alertLinesKey(lines)
  if (key === state.key) return
  for (const h of state.handles) { try { series.removePriceLine(h) } catch { /* series gone */ } }
  state.handles = []
  for (const o of lines) {
    try { state.handles.push(series.createPriceLine(o)) } catch { /* series gone */ }
  }
  state.key = key
}
