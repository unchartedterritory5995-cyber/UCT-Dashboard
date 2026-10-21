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

/** The sentence a slash insert shows when the feed answered but holds nothing finished for the name. */
export const uncoveredNewsMessage = (sym) => `No news feed for ${sym} yet. Open ${sym} on Charts to build it, then try again.`

/** What the widget shows for a symbol: the feed, its company name, and the member's preferences for the
 *  look. The feed is read as a PEEK (`?generate=0`, the screener's door): a slash insert never starts an
 *  AI catalyst generation, only the /charts widget does. A feed that is not `ready` (`none`, or a
 *  `generating` one that would freeze partial) or is empty inserts nothing and says why; a failed read
 *  keeps the generic sentence. A missing company name is not a failure. Never throws. */
export async function fetchNewsCaptureData({ symbol } = {}) {
  if (isOffline()) return { ok: false, reason: 'offline' }
  const sym = String(symbol || '').toUpperCase()
  if (!sym) return { ok: false, reason: 'failed' }
  const enc = encodeURIComponent(sym)
  const [feed, meta, prefs] = await Promise.all([
    getJson(`/api/news-catalysts/${enc}?generate=0`),
    getJson(`/api/ticker-meta/${enc}`),
    readPreferences(),
  ])
  const events = feed.ok && Array.isArray(feed.data?.events) ? feed.data.events : []
  if (!feed.ok) return captureFailure()
  if (feed.data?.status !== 'ready' || !events.length) {
    return { ok: false, reason: 'uncovered', message: uncoveredNewsMessage(sym) }
  }
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
