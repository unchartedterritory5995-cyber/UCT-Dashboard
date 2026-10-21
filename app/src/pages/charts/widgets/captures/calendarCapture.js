// Notebook widgets Task 16: the UCT Terminal (calendar) capture, ONE builder for both doors.
//
// The /charts CalendarWidget's "Send to Journal" and the Notebook's `/calendar` insert both build the
// frozen capture here. A calendar day is re-fetched live by its embed (the endpoints are
// date-parameterized), so the capture holds the DAY and the view, never the rows.
import { mergeCalendarWidgetSettings, calendarDefaultsForTheme } from '../calendarWidgetSettings'
import { mondayOf, lastSessionDay } from '../../../calendar/weekAnchor'
import { etTodayIso } from '../../../journal-2-0/lib/widgetEmbedCore'
import { getJson, isOffline, captureFailure, readPreferences } from './captureFetch'

/** The look a calendar widget resolves: its own saved settings, else the defaults for the theme. */
export const calendarCaptureSettings = (saved, theme) => mergeCalendarWidgetSettings(saved ?? calendarDefaultsForTheme(theme))

/** The frozen capture for one calendar day. Pure: exactly what the widget shows. */
export function buildCalendarCapture({ date }, { econStars, selectedSym, tbdOpen, settings }) {
  return { date, econStars, selectedSym, tbdOpen, settings }
}

/** The day a fresh widget opens on: today in ET, a weekend stepped back to the last session. */
export const calendarOpeningDay = () => lastSessionDay(etTodayIso())

/** The data a slash capture needs: the day's week from the same endpoint the widget reads (so a
 *  failed read inserts nothing), and the member's preferences for the look. Never throws. */
export async function fetchCalendarCaptureData({ date } = {}) {
  if (isOffline()) return { ok: false, reason: 'offline' }
  const day = date || calendarOpeningDay()
  const [week, prefs] = await Promise.all([
    getJson(`/api/calendar?week=${mondayOf(day)}&full_impact=1`),
    readPreferences(),
  ])
  if (!week.ok || !week.data || typeof week.data !== 'object') return captureFailure()
  return { ok: true, data: { date: day }, prefs }
}

/** The slash insert: fetch, then build the capture a fresh widget's Send to Journal would build. */
export async function slashCapture(params) {
  const res = await fetchCalendarCaptureData(params)
  if (!res.ok) return res
  return {
    ok: true,
    payload: buildCalendarCapture(res.data, {
      econStars: 3, selectedSym: null, tbdOpen: false,
      settings: calendarCaptureSettings(null, res.prefs.theme),
    }),
  }
}
