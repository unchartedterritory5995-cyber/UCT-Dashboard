// Notebook widgets Task 16: the News & Catalysts capture, ONE builder for both doors.
//
// The /charts NewsWidget's "Send to Journal" and the Notebook's `/news NVDA` insert both build the
// frozen capture here: the feed as it reads now, rendered verbatim forever (owner-approved freeze).
import { mergeNewsWidgetSettings, newsDefaultsForTheme } from '../newsWidgetSettings'
import { getJson, isOffline, captureFailure, readPreferences } from './captureFetch'

/** The look a news widget resolves: its own saved settings, else the defaults for the theme. */
export const newsCaptureSettings = (saved, theme) => mergeNewsWidgetSettings(saved ?? newsDefaultsForTheme(theme))

/** The frozen capture for one feed. Pure: exactly what the widget had fetched and shows. */
export function buildNewsCapture({ symbol, events, company }, { filter, settings }) {
  return { symbol, filter, company, settings, events }
}

/** What the widget fetches for a symbol: the feed (same endpoint, same query), its company name, and
 *  the member's preferences for the look. An empty feed is a failure: the widget offers no Send then
 *  either. A missing company name is not (the widget shows the ticker alone). Never throws. */
export async function fetchNewsCaptureData({ symbol } = {}) {
  if (isOffline()) return { ok: false, reason: 'offline' }
  const sym = String(symbol || '').toUpperCase()
  if (!sym) return { ok: false, reason: 'failed' }
  const enc = encodeURIComponent(sym)
  const [feed, meta, prefs] = await Promise.all([
    getJson(`/api/news-catalysts/${enc}`),
    getJson(`/api/ticker-meta/${enc}`),
    readPreferences(),
  ])
  const events = feed.ok && Array.isArray(feed.data?.events) ? feed.data.events : []
  if (!events.length) return captureFailure()
  const company = meta.ok ? (meta.data?.name ?? null) : null
  return { ok: true, data: { symbol: sym, events, company }, prefs }
}

/** The slash insert: fetch, then build the capture a fresh widget's Send to Journal would build. */
export async function slashCapture(params) {
  const res = await fetchNewsCaptureData(params)
  if (!res.ok) return res
  return {
    ok: true,
    payload: buildNewsCapture(res.data, { filter: 'all', settings: newsCaptureSettings(null, res.prefs.theme) }),
  }
}
