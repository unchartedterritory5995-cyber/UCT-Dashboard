// The screener's Chart widget, persisted so a member's chart setup in the screener survives a
// reload (2026-10-18). The screener's equivalent of `breadth_drill_board`, and kept SEPARATE from
// `charts_workspace_layout` for the same reason: this chart is not part of the /charts layout,
// and folding it in would put a second authority over that blob.
//
// ⛔ Stored: the chart widget's OPTS (timeframe, settings, chart tabs, dock, watermark), plus any
// widget the phone chart's toolbar added (★ watchlist, Tools ▸ add) as {id, type, opts}, plus the
// opts of the News & Catalysts widget under the desktop chart (its filter and look). The symbol
// is never stored: it is the selected row's, published into colour group A per selection.

export const SCREENER_CHART_PREF = 'screener_chart_widget'
export const SCREENER_CHART_ID = 'screener-chart'
export const SCREENER_NEWS_ID = 'screener-news'
// The row list publishes the selected ticker into group A and the chart reads it: the same link
// /charts uses between a watchlist and a chart, not a bespoke callback.
export const SCREENER_CHART_GROUP = 'A'
const MAX_EXTRA = 12

/** The chart widget, its opts read from the stored pref; `seedOpts` (the member's own /charts
 *  chart) seeds a member who has never opened it, so the screener opens on THEIR chart.
 *  Never throws: a corrupt pref opens the seeded chart. */
export function parseChartWidget(raw, seedOpts = {}) {
  return parseScreenerWidgets(raw, seedOpts)[0]
}

/** [chart, ...extras]. Extras are never charts (the shell binds the first chart) and always sit
 *  on group A, so a stored blob cannot unlink them from the selection. */
export function parseScreenerWidgets(raw, seedOpts = {}) {
  let v = null
  try { v = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { v = null }
  const opts = v && typeof v === 'object' && v.opts && typeof v.opts === 'object' ? v.opts : null
  const chart = { id: SCREENER_CHART_ID, type: 'chart', color: SCREENER_CHART_GROUP, opts: opts || { ...seedOpts } }
  const extras = (v && Array.isArray(v.extras) ? v.extras : [])
    .filter(w => w && typeof w.id === 'string' && typeof w.type === 'string' && w.type !== 'chart' && w.id !== SCREENER_CHART_ID)
    .slice(0, MAX_EXTRA)
    .map(w => ({ id: w.id, type: w.type, color: SCREENER_CHART_GROUP, opts: w.opts && typeof w.opts === 'object' ? w.opts : {} }))
  return [chart, ...extras]
}

/** The News & Catalysts widget under the desktop chart, on group A like the chart. Never throws. */
export function parseScreenerNews(raw) {
  let v = null
  try { v = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { v = null }
  const opts = v && typeof v === 'object' && v.news && typeof v.news === 'object' ? v.news : {}
  return { id: SCREENER_NEWS_ID, type: 'news', color: SCREENER_CHART_GROUP, opts }
}

export function serializeChartWidget(widget, extras = [], news = null) {
  return JSON.stringify({
    opts: widget?.opts || {},
    extras: (extras || []).map(w => ({ id: w.id, type: w.type, opts: w.opts || {} })),
    news: news?.opts || {},
  })
}
