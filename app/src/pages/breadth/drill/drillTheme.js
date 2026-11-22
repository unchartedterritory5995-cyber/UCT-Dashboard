import {
  applyThemeToSettings, mapThemeToWidgetSettings, appThemeToChartTheme, appThemeSurface, CHART_THEME_BY_ID,
  CHART_THEMES,
} from '../../../components/chart/chartThemes'
import { mergeChartSettings } from '../../../components/chart/chartDefaults'
import { averageSlotView } from '../../../components/chart/maAdoption'
import { mergeWatchlistSettings, watchlistDefaultsForTheme } from '../../watchlist/watchlistSettings'
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

// ── A LEGACY board: stored before the drill followed the app theme ────────────
// ⛔⛔ A board saved before 2026-11-09 has no `look`, so nothing records whether
// its colours were applied here or chosen by the member. Following it anyway
// re-skinned EVERY such board on its first open (measured 2026-11-17: 28 chart
// colours rewritten with no click), so a member's own chart theme, candle
// colours or average colours were replaced by the app theme because the window
// was opened. The only colours that can be told apart from a choice are the
// DEFAULTS the board was seeded with: a board still wearing them follows (that
// is the feature); a board wearing anything else is the member's look and is
// marked `lookManual`, values untouched, exactly as if they had picked it today.
//
// ⭐ WHAT COUNTS AS "THE LOOK" IS DERIVED, NEVER LISTED: every leaf a theme apply
// WRITES (not just the ones it happens to change from the defaults: a theme
// always writes `tintEnabled: true`, so a member's tint OFF would be invisible to
// a "what moved" diff). Found by applying every gallery theme to a probe whose
// leaves are unique markers and recording each marker that was overwritten.
// ⛔ Averages are compared by SLOT through `averageSlotView`: an adopted average's
// colour lives on its instance, and the instance list is not positional.
// `preset` is a label every settings writer stamps 'custom', not a colour.
// ⚠️ Only the CURRENT defaults count. A board in a RETIRED default (the pre-08-24
// candles, the pre-08-27 SMA 5 slot) is kept as it is rather than followed: the
// cost of that is a widget that keeps its old look, the cost of the opposite
// guess is a member's colours overwritten.
const NOT_LOOK = new Set(['overlays', 'indicatorInstances', 'preset'])
const PROBE = '\u0001look:'

function probeOf(v, path) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const out = {}
    for (const k of Object.keys(v)) {
      out[k] = !path.length && NOT_LOOK.has(k) ? v[k] : probeOf(v[k], [...path, k])
    }
    return out
  }
  return PROBE + path.join('.')
}

// Every leaf of `after` that is not the probe marker the same path carried.
function writtenPaths(probe, after, path, out) {
  if (after && typeof after === 'object' && !Array.isArray(after)) {
    for (const k of Object.keys(after)) {
      if (!path.length && NOT_LOOK.has(k)) continue
      writtenPaths(probe?.[k], after[k], [...path, k], out)
    }
    return
  }
  if (after !== probe) out.set(path.join('.'), path)
}

let _look = null
function lookModel() {
  if (_look) return _look
  const chartBase = mergeChartSettings(null)
  const chartProbe = probeOf(chartBase, [])
  const listBase = mergeWatchlistSettings(watchlistDefaultsForTheme(null))
  const listProbe = probeOf(listBase, [])
  const chartPaths = new Map()
  const listPaths = new Map()
  let slots = 0
  for (const theme of CHART_THEMES) {
    writtenPaths(chartProbe, applyThemeToSettings(chartProbe, theme), [], chartPaths)
    writtenPaths(listProbe, mapThemeToWidgetSettings(listProbe, theme, 'watchlist'), [], listPaths)
    slots = Math.max(slots, Array.isArray(theme.ma) ? theme.ma.length : 0)
  }
  _look = {
    chartPaths: [...chartPaths.values()],
    listPaths: [...listPaths.values()],
    slots,
    chartBase,
    chartSlots: averageSlotView(chartBase),
    // An untouched list is written with the defaults of the app theme it sat under.
    listDefaults: [listBase, mergeWatchlistSettings(watchlistDefaultsForTheme('light'))],
  }
  return _look
}

const at = (obj, path) => path.reduce((v, k) => (v == null ? undefined : v[k]), obj)
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b)

const slotColour = (view, raw, i) => (view[i] ? view[i].color : (raw[i] && raw[i].color))

/** Does this stored chart blob still wear the default look (every colour a theme
 *  would write equals the default's)? Exported for the rails. */
export function isDefaultChartLook(settings) {
  const m = lookModel()
  const s = mergeChartSettings(settings)
  for (const p of m.chartPaths) if (!same(at(s, p), at(m.chartBase, p))) return false
  const view = averageSlotView(s)
  const raw = Array.isArray(s.overlays) ? s.overlays : []
  const baseRaw = m.chartBase.overlays || []
  for (let i = 0; i < m.slots; i += 1) {
    if (!raw[i]) continue
    if (!same(slotColour(view, raw, i), slotColour(m.chartSlots, baseRaw, i))) return false
  }
  return true
}

/** The list's version: its stored appearance equals the defaults of one app theme. */
export function isDefaultListLook(settings) {
  const m = lookModel()
  const s = mergeWatchlistSettings(settings)
  return m.listDefaults.some((d) => m.listPaths.every((p) => same(at(s, p), at(d, p))))
}

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
  } else if (o.settings && !(isList ? isDefaultListLook : isDefaultChartLook)(o.settings)) {
    // A legacy board in the member's own look: keep every value, stop following.
    return { ...o, lookManual: true }
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
