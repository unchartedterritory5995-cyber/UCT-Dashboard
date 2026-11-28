// "Widgets match the chart" (owner 2026-11-27).
//
// One switch per layout: while it is on, every non-chart widget wears the LEAD chart's
// look — its canvas (solid or gradient) and its up/down colours — and keeps wearing it as
// the chart changes. A widget can step out on its own (`opts.ownLook`), either from its ⚙
// panel's "Match the chart" box or simply by changing its own colours.
//
// Stored on the layout: `layout.matchChart = { on: true, chartId }`. chartId is the chart
// the switch was turned on from; when that chart is gone (or none was named) the lead is the
// top-left chart on the board.
//
// Everything here is PURE. The writes reuse the existing "All widgets" theme mapping
// (mapThemeToWidgetSettings / patchWidgetOptsWithTheme), so a matched widget is exactly what
// picking the same theme from 🎨 UCT Themes → All widgets would have produced.

import { mergeChartSettings } from '../../components/chart/chartDefaults'
import { mapThemeToWidgetSettings, patchWidgetOptsWithTheme, WIDGET_GLOBAL_PREF_KEYS } from '../../components/chart/chartThemes'
import { sanitizeChartTabs } from './chartTabs'

/** Is the switch on for this layout? */
export function matchChartOn(layout) {
  return !!(layout && layout.matchChart && layout.matchChart.on)
}

/** The chart widget whose look the board follows, or null when the board has no chart. */
export function leadChartWidget(widgets, chartId) {
  const charts = (widgets || []).filter(w => w && w.type === 'chart')
  if (!charts.length) return null
  if (chartId != null) {
    const named = charts.find(w => String(w.id) === String(chartId))
    if (named) return named
  }
  const pos = (v) => (Number.isFinite(v) ? v : 1e9)
  return [...charts].sort((a, b) => (pos(a.y) - pos(b.y)) || (pos(a.x) - pos(b.x)))[0]
}

/** The settings blob the chart widget is SHOWING (its open chart tab, else its own, else the seed). */
function shownChartSettings(widget, seed) {
  const opts = widget?.opts || {}
  const { tabs, active } = sanitizeChartTabs(opts)
  const own = active === 0 ? opts.settings : (tabs[active - 1]?.settings || null)
  return mergeChartSettings(own || seed || {})
}

/** A chart's look as a theme-shaped object the widget mappers understand. */
export function chartLookTheme(chartSettings) {
  const cs = mergeChartSettings(chartSettings || {})
  const gradient = cs.bgMode === 'gradient' && cs.bgGradient?.top && cs.bgGradient?.bottom
  const up = cs.header?.colors?.dayChangeUp || cs.candles?.upColor
  const down = cs.header?.colors?.dayChangeDown || cs.candles?.downColor
  return {
    id: 'match-chart',
    bg: gradient ? cs.bgGradient.bottom : cs.background,
    bgGradient: gradient ? { top: cs.bgGradient.top, bottom: cs.bgGradient.bottom } : null,
    up,
    down,
  }
}

/** The look of the layout's lead chart, or null when there is no chart to follow. */
export function leadChartLook(layout, seed) {
  const lead = leadChartWidget(layout?.widgets, layout?.matchChart?.chartId)
  if (!lead) return null
  return chartLookTheme(shownChartSettings(lead, seed))
}

// The keys the theme mapping writes. A member's own edit to any of these on a matched
// widget means "this one is mine now" (see `editsOwnLook`).
export const LOOK_KEYS = ['bgMode', 'bg', 'bgGradient', 'textColor', 'headerColor', 'valueColor', 'symColor',
  'upColor', 'downColor', 'posColor', 'negColor', 'gridColor', 'tintEnabled', 'tintUp', 'tintDown']

/** Just the look keys (+ the app-theme stamp) of a settings blob, in a fixed order. */
export function pickLook(blob) {
  const b = blob && typeof blob === 'object' ? blob : {}
  const out = {}
  for (const k of [...LOOK_KEYS, '_appTheme']) if (k in b) out[k] = b[k]
  return out
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Did this settings change touch the widget's colours? (columns, fonts, sorting do not count) */
export function editsOwnLook(prevSettings, nextSettings) {
  const p = prevSettings || {}
  const n = nextSettings || {}
  return LOOK_KEYS.some(k => !same(p[k], n[k]))
}

/** A non-chart surface follows the chart unless it has stepped out. */
function follows(type, opts) {
  return !!type && type !== 'chart' && !(opts && opts.ownLook)
}

/** Every widget type on the board that follows the chart (base widgets and widget tabs). */
export function followingTypes(widgets) {
  const out = new Set()
  for (const w of widgets || []) {
    if (follows(w?.type, w?.opts)) out.add(w.type)
    for (const t of (Array.isArray(w?.wtabs) ? w.wtabs : [])) if (follows(t?.type, t?.opts)) out.add(t.type)
  }
  return out
}

/**
 * Put `theme` on every following PER-WIDGET surface. Returns the same array (===) when
 * nothing changed, so the caller can skip the write — that is what keeps the sync from
 * looping on its own save.
 */
export function applyLookToWidgets(widgets, theme) {
  if (!theme || !Array.isArray(widgets)) return widgets
  let changed = false
  const patch = (type, opts) => {
    if (!follows(type, opts)) return opts
    const next = patchWidgetOptsWithTheme(type, opts, theme, null)
    if (same(next?.settings, opts?.settings)) return opts
    changed = true
    return next
  }
  const out = widgets.map(w => {
    if (!w) return w
    let nw = w
    const o = patch(w.type, w.opts)
    if (o !== w.opts) nw = { ...nw, opts: o }
    if (Array.isArray(w.wtabs)) {
      let tabChanged = false
      const tabs = w.wtabs.map(t => {
        if (!t || !t.type) return t
        const to = patch(t.type, t.opts)
        if (to === t.opts) return t
        tabChanged = true
        return { ...t, opts: to }
      })
      if (tabChanged) nw = { ...nw, wtabs: tabs }
    }
    return nw
  })
  return changed ? out : widgets
}

/**
 * The GLOBAL-pref widgets (Theme Tracker, Fundamentals, Breadth, AI Search) keep their
 * look in one pref each, not on the widget. Returns `{ prefKey: nextBlob }` for each
 * following type whose stored look differs from the chart's. `readPref(key)` returns the
 * parsed current blob (or null).
 */
export function globalPrefWrites(widgets, theme, readPref, appTheme = null) {
  const out = {}
  if (!theme) return out
  const types = followingTypes(widgets)
  const stamp = appTheme == null ? null : String(appTheme)
  for (const [type, key] of Object.entries(WIDGET_GLOBAL_PREF_KEYS)) {
    if (!types.has(type)) continue
    const cur = readPref(key) || {}
    const next = { ...mapThemeToWidgetSettings(cur, theme, type), _appTheme: stamp }
    // A pref stamped under another app theme is ignored by the widget (resolveGlobalPrefSettings),
    // so a stale stamp needs the write even when the colours already agree.
    if (cur._appTheme !== stamp || LOOK_KEYS.some(k => !same(cur[k], next[k]))) out[key] = next
  }
  return out
}
