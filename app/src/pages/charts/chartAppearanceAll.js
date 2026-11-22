// ── "Apply to all charts" across ONE layout (owner 11-16) ──
//
// Every chart SURFACE in the open layout: a chart widget's main tab, each of its extra chart tabs (opts.chartTabs), and
// the same for a chart that sits in another widget's tabs (wtabs). A surface is addressed the way ChartWidget knows
// itself: `chartId` = the slot's group id (`widget.id`, or `${widget.id}:${wtab.id}` for a widget tab — WidgetHost)
// and `tabId` = the extra chart tab's id, or null for the main tab.
//
// Pure. The workspace calls it inside ONE setLayout and saves the result through its normal scheduleSave, so the board
// is dirty / saved exactly like any manual change. Only the current layout's widgets are walked — never another layout,
// never the global chart_settings pref.

import { applyAppearance } from '../../components/chart/chartAppearance'
import { sanitizeWidgetTabs } from './widgetTabs'
import { sanitizeChartTabs } from './chartTabs'

function surfacesOfChart(chartId, opts, out) {
  out.push({ chartId, tabId: null })
  for (const t of sanitizeChartTabs(opts).tabs) out.push({ chartId, tabId: t.id })
}

/** Every chart surface in `widgets`, as `{ chartId, tabId }`. */
export function chartSurfacesOf(widgets) {
  const out = []
  for (const w of Array.isArray(widgets) ? widgets : []) {
    if (!w || typeof w !== 'object' || w.id == null) continue
    if (w.type === 'chart') surfacesOfChart(String(w.id), w.opts, out)
    for (const t of sanitizeWidgetTabs(w).tabs) if (t.type === 'chart') surfacesOfChart(`${w.id}:${t.id}`, t.opts, out)
  }
  return out
}

const sameSurface = (a, b) => !!a && !!b && String(a.chartId) === String(b.chartId) && (a.tabId ?? null) === (b.tabId ?? null)

/** How many OTHER charts the layout holds, or null when `source` is not one of its charts (no door then). */
export function countOtherCharts(widgets, source) {
  const all = chartSurfacesOf(widgets)
  if (!all.some((s) => sameSurface(s, source))) return null
  return all.length - 1
}

/**
 * Every OTHER chart surface in `widgets` wears `settings`' look (chartAppearance.applyAppearance). A surface that has
 * never been edited inherits `seed` (the member's chart_settings — what it shows today) and is given its own blob,
 * exactly as a theme's "All charts" does. Returns `{ widgets, count }`; `widgets` is the same array when nothing changed.
 */
export function applyAppearanceToOtherCharts(widgets, source, settings, seed = null) {
  const list = Array.isArray(widgets) ? widgets : []
  if (countOtherCharts(list, source) == null) return { widgets: list, count: 0 }
  let count = 0
  const patchChart = (chartId, opts) => {
    const o = opts && typeof opts === 'object' ? opts : {}
    let next = opts
    if (!sameSurface({ chartId, tabId: null }, source)) {
      next = { ...next, settings: applyAppearance(o.settings || seed || {}, settings) }
      count += 1
    }
    if (Array.isArray(o.chartTabs)) {
      let touched = false
      const tabs = o.chartTabs.map((t) => {
        if (!t || typeof t !== 'object' || !t.id || sameSurface({ chartId, tabId: t.id }, source)) return t
        touched = true
        count += 1
        return { ...t, settings: applyAppearance(t.settings || seed || {}, settings) }
      })
      if (touched) next = { ...(next || {}), chartTabs: tabs }
    }
    return next
  }
  const out = list.map((w) => {
    if (!w || typeof w !== 'object' || w.id == null) return w
    let nw = w
    if (w.type === 'chart') {
      const opts = patchChart(String(w.id), w.opts)
      if (opts !== w.opts) nw = { ...nw, opts }
    }
    if (Array.isArray(w.wtabs) && w.wtabs.some((t) => t?.type === 'chart')) {
      let touched = false
      const wtabs = w.wtabs.map((t) => {
        if (!t || typeof t !== 'object' || t.type !== 'chart' || !t.id) return t
        const opts = patchChart(`${w.id}:${t.id}`, t.opts)
        if (opts === t.opts) return t
        touched = true
        return { ...t, opts }
      })
      if (touched) nw = { ...nw, wtabs }
    }
    return nw
  })
  return count ? { widgets: out, count } : { widgets: list, count: 0 }
}
