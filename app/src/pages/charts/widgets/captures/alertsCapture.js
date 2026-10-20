// Notebook widgets Task 16: the Alerts capture, ONE builder for both doors.
//
// The /charts AlertsWidget's "Send to Journal" and the Notebook's `/alerts` insert both build the frozen
// capture here: the member's own alert list with each row's level and price AS THEY STOOD, because a
// deleted alert is unrecoverable and the capture is the only record of the list. It is the member's own
// account data, so its registry row stays "private" and a public page shows the neutral line instead.
import { mergeAlertsWidgetSettings, alertsDefaultsForTheme } from '../alertsWidgetSettings'
import { getJson, isOffline, captureFailure, readPreferences, readLivePrices } from './captureFetch'

/** The one URL both doors read: ALL of the member's alerts, active and triggered. */
export const ALERTS_URL = '/api/watchlist-alerts?active_only=false'

/** The alert's level right now. A trendline's level is interpolated/extrapolated from its two anchors
 *  (matches the server-side checker); everything else is the fixed target_price. */
export function levelNow(a) {
  if (a.alert_type === 'trendline') {
    const { anchor_t1: t1, anchor_p1: p1, anchor_t2: t2, anchor_p2: p2 } = a
    if ([t1, p1, t2, p2].every(v => v != null) && t2 !== t1) {
      const now = Date.now() / 1000
      return p1 + (p2 - p1) * ((now - t1) / (t2 - t1))
    }
  }
  return Number(a.target_price)
}

/** The look an alerts widget resolves: its own saved settings, else the defaults for the theme. */
export const alertsCaptureSettings = (saved, theme) => mergeAlertsWidgetSettings(saved ?? alertsDefaultsForTheme(theme))

/** The live price for a symbol out of a quote map, or null. */
export const alertPriceOf = (prices, sym) => prices?.[(sym || '').toUpperCase()]?.price ?? null

/** The frozen capture. Pure but for the clock a trendline's level is read at: every alert with its
 *  level and price at capture, and the look. */
export function buildAlertsCapture(alerts, { priceOf, settings }) {
  return {
    alerts: alerts.map((a) => ({ ...a, levelAtCapture: levelNow(a), priceAtCapture: priceOf(a.sym) })),
    settings,
  }
}

/** The sentence a slash insert shows when the member has no alerts: the widget offers no Send then either. */
export const NO_ALERTS_MESSAGE = 'You have no price alerts yet, so nothing was added.'

/** What the widget shows: the member's alerts (same endpoint, same query), live quotes for their symbols
 *  and the member's preferences. A failed read of the list inserts nothing; a failed quote read leaves
 *  the prices blank, as the widget shows them. Never throws. */
export async function fetchAlertsCaptureData() {
  if (isOffline()) return { ok: false, reason: 'offline' }
  const [list, prefs] = await Promise.all([getJson(ALERTS_URL), readPreferences()])
  if (!list.ok || !Array.isArray(list.data)) return captureFailure()
  if (!list.data.length) return { ok: false, reason: 'empty', message: NO_ALERTS_MESSAGE }
  const prices = await readLivePrices(list.data.map((a) => a.sym))
  return { ok: true, data: { alerts: list.data, prices }, prefs }
}

/** The slash insert: fetch, then build the capture a fresh widget's Send to Journal would build. */
export async function slashCapture() {
  const res = await fetchAlertsCaptureData()
  if (!res.ok) return res
  const { alerts, prices } = res.data
  return {
    ok: true,
    payload: buildAlertsCapture(alerts, {
      priceOf: (s) => alertPriceOf(prices, s), settings: alertsCaptureSettings(null, res.prefs.theme),
    }),
  }
}
