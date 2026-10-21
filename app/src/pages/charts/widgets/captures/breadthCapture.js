// Notebook widgets Task 16: the Breadth heatmap capture, ONE builder for both doors.
//
// The /charts BreadthWidget's "Send to Journal" and the Notebook's `/breadth` insert both build the frozen
// capture here. A mid-session capture holds the LIVE intraday row the 4:15 collector discards, so the
// payload is the only record of it (owner-approved freeze). The widget's live view (the row on top, the
// trend series, the "updated" stamp) comes from the same three functions, so the two doors cannot disagree.
import { HM_METRICS, FFILL_KEYS } from '../../../breadth/heatmapMetrics'
import { BREADTH_WIDGET_SETTINGS_KEY, mergeBreadthWidgetSettings, breadthDefaultsForTheme } from '../breadthWidgetSettings'
import { resolveGlobalPrefSettings } from '../../../../components/chart/chartThemes'
import { parsePref } from '../../../../hooks/usePreferences'
import { formatLiveClock, isLiveRowUsable } from '../../../../hooks/useLiveBreadth'
import { getJson, isOffline, captureFailure, readPreferences, etStamp } from './captureFetch'

const TREND_N = 24

/** Every reading key the heatmap can show, in its own order. */
export const BREADTH_METRIC_KEYS = HM_METRICS.filter((m) => !m.isHeader).map((m) => m.key)

/** The look a breadth widget resolves: the member's GLOBAL pref when saved for this theme, else the theme's defaults. */
export const breadthCaptureSettings = (prefs, theme) =>
  mergeBreadthWidgetSettings(resolveGlobalPrefSettings(parsePref(prefs?.[BREADTH_WIDGET_SETTINGS_KEY], null), theme, breadthDefaultsForTheme))

/** The row on top: the live intraday row over the stored history, the sparse weekly sentiment keys
 *  forward-filled from recent rows so those tiles are not blank. Null when there is nothing to show. */
export function breadthCurrentRow(rows, liveRow) {
  const base = liveRow || rows[0]
  if (!base) return null
  const filled = { ...base }
  for (const k of FFILL_KEYS) {
    if (filled[k] == null) {
      for (const r of rows) { if (r?.[k] != null) { filled[k] = r[k]; break } }
    }
  }
  return filled
}

/** One reading's trend, oldest first: today's intraday path when the live feed carries one, else the
 *  last ~month of daily values with the live row as the newest point. */
export function breadthSeries(key, rows, live, currentRow) {
  const p = live?.path?.[key]
  if (Array.isArray(p) && p.length >= 2) return p.map((x) => x?.[1])
  const trendBase = live?.row && currentRow ? [currentRow, ...rows] : rows
  const out = []
  for (let i = Math.min(TREND_N, trendBase.length) - 1; i >= 0; i--) out.push(trendBase[i]?.[key])
  return out
}

/** "Last updated": the live intraday clock while a live row stands, else the fetch time, else the row's date. */
export function breadthUpdated(live, fetchedAt, currentRow) {
  if (live?.clock) return `${live.clock} ET`
  return fetchedAt ? etStamp(fetchedAt) : (currentRow?.date || null)
}

/** The frozen capture. Pure: the row, the visible readings' series and the stamp the widget shows. */
export function buildBreadthCapture({ row, series, updated }, { hiddenMetrics, settings }) {
  return {
    hiddenMetrics: Array.isArray(hiddenMetrics) ? hiddenMetrics : [],
    tileStyle: settings.tileStyle || 'values', settings, row, series, updated,
  }
}

/** What the widget fetches: the stored history (same endpoint, same query) and the live intraday row.
 *  A failed history read is a failure; a failed live read leaves the history standing on its own, as
 *  the widget does. Nothing to show inserts nothing. Never throws. */
export async function fetchBreadthCaptureData() {
  if (isOffline()) return { ok: false, reason: 'offline' }
  const [hist, liveRes, prefs] = await Promise.all([
    getJson('/api/breadth-monitor?days=90'),
    getJson('/api/breadth-monitor/live'),
    readPreferences(),
  ])
  if (!hist.ok || !hist.data || typeof hist.data !== 'object') return captureFailure()
  const fetchedAt = Date.now()
  const rows = Array.isArray(hist.data.rows) ? hist.data.rows : []
  const d = liveRes.ok ? liveRes.data : null
  const live = isLiveRowUsable(d)
    ? { row: { ...d.row, _live: true }, clock: formatLiveClock(d.as_of), path: d.path ?? {} }
    : { row: null, clock: null, path: {} }
  if (!breadthCurrentRow(rows, live.row)) return captureFailure()
  return { ok: true, data: { rows, live, fetchedAt }, prefs }
}

/** The slash insert: fetch, then build the capture a fresh widget's Send to Journal would build. */
export async function slashCapture() {
  const res = await fetchBreadthCaptureData()
  if (!res.ok) return res
  const { rows, live, fetchedAt } = res.data
  const row = breadthCurrentRow(rows, live.row)
  const series = {}
  for (const k of BREADTH_METRIC_KEYS) series[k] = breadthSeries(k, rows, live, row)
  return {
    ok: true,
    payload: buildBreadthCapture({ row, series, updated: breadthUpdated(live, fetchedAt, row) },
      { hiddenMetrics: [], settings: breadthCaptureSettings(res.prefs, res.prefs.theme) }),
  }
}
