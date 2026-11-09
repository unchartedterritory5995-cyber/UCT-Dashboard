import {
  applyThemeToSettings, mapThemeToWidgetSettings, appThemeToChartTheme, appThemeSurface, CHART_THEME_BY_ID,
} from '../../../components/chart/chartThemes'
import { LIST_WIDGET_ID } from './drillBoardPrefs'

// The drill window wears the APP theme (owner, 2026-11-09): on Slate the chart
// and the list are Slate, on Graphite they are Graphite, and switching the app
// theme re-skins them. Until the member changes the look themselves: once a
// widget's colours differ from what was last applied here (a chart theme picked
// in Chart Settings, a candle colour, the list's appearance panel), that widget
// is marked `lookManual` and is never re-skinned again.
//
// Each followed widget carries `opts.look = { app, sig }`: the app theme it was
// skinned for and a signature of the colours that were written. Other settings
// (indicators, columns, fonts) are not part of the signature, so editing them
// never counts as taking over the look.

/** The chart theme that matches `appTheme`, on the app's own surface tone. Same
 *  resolution /charts uses for a widget placed under that app theme. */
export function appLook(appTheme) {
  const surf = appThemeSurface(appTheme)
  // An app theme with no chart twin (Carbon; the base Light theme, whose chart
  // id has no gallery entry) takes its family's default: Paper or Graphite.
  const fallback = surf?.family === 'light' ? 'paper' : 'graphite'
  const id = appThemeToChartTheme(appTheme)
  const theme = CHART_THEME_BY_ID[id] || CHART_THEME_BY_ID[fallback]
  if (!theme) return null
  return surf ? { ...theme, bg: surf.bg, bgGradient: null } : theme
}

const chartSig = (s) => JSON.stringify([s?.background ?? null, s?.bgMode ?? null, s?.textColor ?? null,
  s?.candles?.upColor ?? null, s?.candles?.downColor ?? null])
const listSig = (s) => JSON.stringify([s?.bg ?? null, s?.bgMode ?? null, s?.textColor ?? null,
  s?.upColor ?? null, s?.downColor ?? null])

/** One widget's opts, following `appTheme`. Returns the SAME object when
 *  nothing changes, so callers can bail on identity. */
export function followOpts(opts, isList, appTheme, chartSeed) {
  const o = opts || {}
  if (o.lookManual) return o
  const sig = isList ? listSig : chartSig
  const app = appTheme == null ? 'default' : String(appTheme)
  if (o.look) {
    if (o.look.sig !== sig(o.settings)) return { ...o, lookManual: true }
    if (o.look.app === app) return o
  }
  const theme = appLook(app)
  if (!theme) return o
  const settings = isList
    ? mapThemeToWidgetSettings(o.settings || {}, theme, 'watchlist')
    : applyThemeToSettings(o.settings || chartSeed || {}, theme)
  return { ...o, settings, look: { app, sig: sig(settings) } }
}

/** The board with every widget following `appTheme` (same object if unchanged). */
export function followAppTheme(board, appTheme, chartSeed) {
  if (!board?.widgets) return board
  let changed = false
  const widgets = board.widgets.map((w) => {
    const next = followOpts(w.opts, w.id === LIST_WIDGET_ID, appTheme, chartSeed)
    if (next === w.opts) return w
    changed = true
    return { ...w, opts: next }
  })
  return changed ? { ...board, widgets } : board
}
