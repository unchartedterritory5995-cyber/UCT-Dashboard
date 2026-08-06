// Per-widget chrome canvas derivation for the /charts workspace.
//
// Each chart/watchlist widget can now carry its OWN settings (stored in
// widget.opts), so the widget CHROME (border, header bar, dividers, popup
// panels) must follow THAT widget's canvas — not a single global value shared
// by every widget of the same type. This module turns a widget's own settings
// into its canvas color + the derived chrome entry, so a per-widget map can be
// built once and consumed by WidgetHost.

import { mergeChartSettings } from '../../components/chart/chartDefaults'
import { mergeWatchlistSettings } from '../watchlist/watchlistSettings'
import { mergeNewsWidgetSettings } from './widgets/newsWidgetSettings'
import { mergeProfileWidgetSettings } from './widgets/profileWidgetSettings'
import { mergeAlertsWidgetSettings } from './widgets/alertsWidgetSettings'
import { mergeCalendarWidgetSettings } from './widgets/calendarWidgetSettings'
import { dividerFor, chromeFor, panelFor, toolbarFor } from '../../utils/dividerColor'
import { sanitizeChartTabs } from './chartTabs'
import { resolveActiveTab } from './widgetTabs'

// The chrome-variable bundle derived from a single canvas color.
export function canvasEntry(canvas) {
  return {
    canvas,
    divider: dividerFor(canvas),
    dividerStrong: dividerFor(canvas, { strong: true }),
    chrome: chromeFor(canvas),
    panel: panelFor(canvas),
    rowHover: toolbarFor(canvas)?.bg,
  }
}

// The canvas color of a CHART widget's currently-active tab (main = opts.settings;
// extra = the active chartTabs[i].settings). null when the active surface hasn't
// diverged from the global default (→ caller falls back to the type default).
// Returns { canvas, canvasBottom } — canvasBottom is the gradient's BOTTOM stop
// (null when solid), so a header docked at the BOTTOM of the widget can match the
// bottom of the gradient instead of the top.
function chartActiveCanvas(widget, chartsTheme) {
  const opts = widget.opts || {}
  const { tabs, active } = sanitizeChartTabs(opts)
  const settings = active === 0 ? (opts.settings || null) : (tabs[active - 1]?.settings || null)
  if (!settings) return null
  if (chartsTheme === 'sunrise') return { canvas: '#eaf1fa', canvasBottom: null }
  const cs = mergeChartSettings(settings)
  if (cs.bgMode === 'gradient') {
    return { canvas: cs.bgGradient?.top || cs.background, canvasBottom: cs.bgGradient?.bottom || null }
  }
  return { canvas: cs.background, canvasBottom: null }
}

// The canvas of a simple solid/gradient settings blob (News / Profile widgets):
// their own opts.settings, or null if it hasn't diverged from the global default.
function simpleOwnCanvas(settings, mergeFn) {
  if (!settings) return null
  const s = mergeFn(settings)
  const gradient = s.bgMode === 'gradient'
  const canvas = gradient ? (s.bgGradient?.top || s.bg) : s.bg
  const canvasBottom = gradient ? (s.bgGradient?.bottom || null) : null
  return { canvas, canvasBottom }
}

// The canvas color of a WATCHLIST widget's own settings, or null if it hasn't
// diverged. Also returns the gradient bottom stop + the explicit gridline override
// so the caller can mirror watchlistStyleVars' divider override (keep in sync).
function watchlistOwnCanvas(widget) {
  const settings = widget.opts?.settings
  if (!settings) return null
  const wl = mergeWatchlistSettings(settings)
  const gradient = wl.bgMode === 'gradient'
  const canvas = gradient ? (wl.bgGradient?.top || wl.bg) : wl.bg
  const canvasBottom = gradient ? (wl.bgGradient?.bottom || null) : null
  return { canvas, canvasBottom, gridColor: wl.gridColor || null }
}

// Build a per-widget chrome entry for a widget that has diverged from the global
// default, or null if it hasn't (caller uses the type default). Handles the
// watchlist gridline override so the widget chrome matches the list surface.
export function widgetOwnChrome(widget, chartsTheme) {
  if (!widget || !widget.type) return null
  // Follow the ACTIVE tab: a slot showing a chart tab paints the chart's canvas,
  // one showing a watchlist tab paints the watchlist's. Build a surrogate widget
  // carrying the active tab's type + opts so the per-type logic below is unchanged.
  const active = resolveActiveTab(widget)
  const surrogate = { type: active.type, opts: active.opts }
  if (surrogate.type === 'chart') {
    const own = chartActiveCanvas(surrogate, chartsTheme)
    if (!own) return null
    const entry = canvasEntry(own.canvas)
    // A header docked at the widget's BOTTOM (when another widget sits above it)
    // should match the gradient's bottom stop, not its top.
    if (own.canvasBottom && own.canvasBottom !== own.canvas) entry.bottom = canvasEntry(own.canvasBottom)
    return entry
  }
  if (surrogate.type === 'news' || surrogate.type === 'profile' || surrogate.type === 'alerts' || surrogate.type === 'calendar') {
    const mergeFn = surrogate.type === 'news'
      ? mergeNewsWidgetSettings
      : surrogate.type === 'alerts' ? mergeAlertsWidgetSettings
        : surrogate.type === 'calendar' ? mergeCalendarWidgetSettings : mergeProfileWidgetSettings
    const own = simpleOwnCanvas(surrogate.opts?.settings, mergeFn)
    if (!own) return null
    const entry = canvasEntry(own.canvas)
    if (own.canvasBottom && own.canvasBottom !== own.canvas) entry.bottom = canvasEntry(own.canvasBottom)
    return entry
  }
  if (surrogate.type === 'watchlist') {
    const own = watchlistOwnCanvas(surrogate)
    if (!own) return null
    const entry = canvasEntry(own.canvas)
    if (own.gridColor) { entry.divider = own.gridColor; entry.dividerStrong = own.gridColor }
    if (own.canvasBottom && own.canvasBottom !== own.canvas) {
      entry.bottom = canvasEntry(own.canvasBottom)
      if (own.gridColor) { entry.bottom.divider = own.gridColor; entry.bottom.dividerStrong = own.gridColor }
    }
    return entry
  }
  return null
}
