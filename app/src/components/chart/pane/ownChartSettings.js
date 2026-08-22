// The own-chart settings RESOLUTION, hooks-free. useChartSurfaceSettings is
// the render-time consumer; capture-time consumers (journal chart embeds
// freeze the blob at insert) import from here so the pure journal core never
// drags React/usePreferences into its module graph. ONE authority for the
// resolution order: named default widget → board scan → chart_settings seed
// → defaults. (Extracted verbatim from useChartSurfaceSettings.js, which
// re-exports these — see that file's doc comments for the full history.)

import { mergeChartSettings } from '../chartDefaults'
import { mergeSettingsOverride } from '../instanceShape'

function isNonEmptySettingsObj(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0
}

// The winning settings for ONE chart widget: its main-tab `opts.settings` if
// non-empty, else the first `opts.chartTabs[]` entry that has non-empty
// settings, else null. A widget whose settings is absent/`{}`/`null` is NOT a
// candidate — that's the whole point, since an untouched widget carries
// nothing worth resolving to.
function pickWidgetSettings(widget) {
  const widgetSettings = widget?.opts?.settings
  if (isNonEmptySettingsObj(widgetSettings)) return widgetSettings
  const tabs = widget?.opts?.chartTabs
  if (Array.isArray(tabs)) {
    const tab = tabs.find((t) => isNonEmptySettingsObj(t?.settings))
    if (tab) return tab.settings
  }
  return null
}

// `charts_default_chart_widget` is a plain widget-id pref (forward-wiring —
// no UI sets it yet). setPref only JSON.stringifies non-string values, so a
// string id written directly comes back unquoted; but preferences can also
// round-trip through JSON elsewhere, so defensively unwrap a quoted-string
// shape too. Any other shape (number, object, null) is not a usable id.
function resolveDefaultWidgetId(raw) {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'string' && parsed) return parsed
  } catch {
    // Not JSON — the raw string itself IS the id.
  }
  return raw
}

// Deterministic own-chart resolution over the raw layout pref. Returns the
// RAW, unmerged blob that won (or null). Defensive at every step — the pref
// may be absent, a JSON string, malformed, or shaped wrong — and NEVER throws.
// (Order and rationale documented at length in useChartSurfaceSettings.js.)
export function resolveOwnChartSettingsSource(workspaceLayoutRaw, defaultWidgetIdRaw) {
  try {
    if (!workspaceLayoutRaw) return null
    const parsed = typeof workspaceLayoutRaw === 'string' ? JSON.parse(workspaceLayoutRaw) : workspaceLayoutRaw
    const widgets = parsed?.widgets
    if (!Array.isArray(widgets)) return null
    const chartWidgets = widgets.filter((w) => w?.type === 'chart')
    if (chartWidgets.length === 0) return null

    const defaultId = resolveDefaultWidgetId(defaultWidgetIdRaw)
    if (defaultId) {
      const namedWidget = chartWidgets.find((w) => w?.id === defaultId)
      if (namedWidget) {
        const namedSettings = pickWidgetSettings(namedWidget)
        if (namedSettings) return namedSettings
      }
    }

    for (const widget of chartWidgets) {
      const settings = pickWidgetSettings(widget)
      if (settings) return settings
    }
  } catch {
    // Any parse/shape failure falls through to null below.
  }
  return null
}

// The capture-time twin of the own-chart resolution: the FULL merged settings
// blob for "the user's one chart", from raw prefs. Exported for surfaces that
// freeze the blob at a moment in time (journal chart embeds stamp it at
// insert) instead of subscribing through the hook. Shares the resolver above
// so the resolution ORDER can never drift from what ChartPane renders —
// stamping the bare seed instead is the exact popup "settings trap" of 8/5.
export function resolveOwnChartMergedSettings(prefs = {}) {
  const own = resolveOwnChartSettingsSource(prefs.charts_workspace_layout, prefs.charts_default_chart_widget)
  let seed = prefs.chart_settings
  if (typeof seed === 'string') {
    try { seed = JSON.parse(seed) } catch { seed = null }
  }
  if (!seed || typeof seed !== 'object' || Array.isArray(seed)) seed = null
  // Match the LIVE composition exactly — THREE layers, not two. StockChart
  // builds its base from the chart_settings seed and applies the widget blob
  // as a per-section OVERRIDE (mergeSettingsOverride), so a PARTIAL winning
  // blob composes over the seed's customized sections. mergeChartSettings(own)
  // alone dropped the whole seed layer whenever a widget fragment won —
  // capture-time and render-time disagreed (review finding).
  const base = mergeChartSettings(seed || {})
  return own ? mergeSettingsOverride(base, own) : base
}
