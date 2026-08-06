import { useCallback, useMemo } from 'react'
import usePreferences from '../../../hooks/usePreferences'
import { mergeChartSettings } from '../chartDefaults'
import { menuThemeVars } from '../../../utils/dividerColor'

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

// Every /charts widget owns its own settings blob in `opts.settings` inside the
// `charts_workspace_layout` pref (see ChartWidget.jsx) — or, when the user
// customized an EXTRA tab instead of the main one, in
// `opts.chartTabs[].settings` (see chartTabs.js). The global `chart_settings`
// pref is only the untouched SEED that a brand-new widget starts from — it is
// NOT "the user's chart". A surface that IS the user's one chart (stored=null,
// no onStore — every popup/embedded chart outside the /charts workspace
// itself) must resolve DETERMINISTICALLY, not positionally:
//
//   1. Explicit winner — `charts_default_chart_widget` names a chart widget
//      id AND that widget actually has settings (main tab or a tab). Wins
//      outright, regardless of position. A named-but-untouched widget does
//      NOT win with nothing — it falls through to step 2.
//   2. Scan ALL chart widgets in board order, first one with non-empty
//      settings wins (main tab first, then its chartTabs). A customized
//      chart sitting third on the board now resolves correctly instead of
//      losing to an untouched first widget.
//   3. null (caller falls back to the chart_settings seed).
//
// Returns the RAW, unmerged blob that won (or null). Defensive at every step:
// the layout pref may be absent, a JSON string, an already-parsed object,
// malformed JSON, missing a `widgets` array, missing a chart widget entirely,
// or `chartTabs` may be absent/not-an-array/contain entries without a
// `settings` object — every failure falls through to null and this NEVER
// throws.
function resolveOwnChartSettingsSource(workspaceLayoutRaw, defaultWidgetIdRaw) {
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

// Resolves the chart settings a surface should render with, and gives it one
// write sink.
//
//   stored = null, no onStore  -> the user's ONE chart ("your chart,
//                     everywhere"): read from the first /charts chart widget's
//                     settings (falling back to the chart_settings seed), and
//                     WRITE to the global chart_settings pref. This is what
//                     every non-workspace surface passes.
//   stored = blob, or onStore  -> a surface that owns its own settings (a
//                     /charts widget or tab, identified by ALWAYS passing
//                     onStore even before its first edit, when stored is still
//                     null). Reads stay on `stored`/the seed; writes go to
//                     onStore and NEVER to the global pref — that isolation is
//                     load-bearing.
export default function useChartSurfaceSettings({ stored = null, onStore = null, chartsTheme = null } = {}) {
  const { prefs, setPref } = usePreferences()
  const isOwnChartSurface = stored === null && !onStore
  // The workspace's light/dark chart theme is a SEPARATE mechanism from
  // chart_settings: it lives in the `charts_theme` pref and ChartsWorkspace hands
  // it to its widgets through context. A popup is not inside that context, so it
  // used to fall back to 'default' (dark) and render dark even when the user's
  // /charts is on sunrise — the single most visible property on the chart, and
  // exactly why the owner reported "literally no difference". An explicit
  // chartsTheme from a host still wins; null means "resolve it like my settings".
  const theme = chartsTheme ?? (prefs.charts_theme || 'default')
  // The RAW, unmerged blob that won the own-chart resolution (the widget's or
  // a tab's settings) — or null when it fell back to the chart_settings seed
  // (in which case StockChart's own base, read from that same seed, is already
  // correct and needs no override). null on every non-own-chart surface. MUST
  // stay identity-stable across renders with unchanged inputs — ChartPane hands
  // this straight to StockChart's `settingsOverride`, documented there as a
  // memo dep that must not thrash.
  const ownChartSource = useMemo(
    () => (isOwnChartSurface
      ? resolveOwnChartSettingsSource(prefs.charts_workspace_layout, prefs.charts_default_chart_widget)
      : null),
    [isOwnChartSurface, prefs.charts_workspace_layout, prefs.charts_default_chart_widget],
  )
  const globalCs = useMemo(() => mergeChartSettings(
    isOwnChartSurface
      ? (ownChartSource || prefs.chart_settings)
      : prefs.chart_settings,
  ), [isOwnChartSurface, ownChartSource, prefs.chart_settings])
  const storedCs = useMemo(() => (stored ? mergeChartSettings(stored) : null), [stored])
  const cs = storedCs || globalCs

  const write = useCallback((nextFull) => {
    if (stored || onStore) onStore?.(nextFull)
    else setPref('chart_settings', nextFull)
  }, [stored, onStore, setPref])

  const patchHeader = useCallback((patch) => {
    write({ ...cs, header: { ...cs.header, ...patch }, preset: 'custom' })
  }, [cs, write])

  const menuCanvasColor = theme === 'sunrise'
    ? '#eaf3fb'
    : (cs.bgMode === 'gradient' ? (cs.bgGradient?.top || cs.background) : cs.background)
  const menuGradient = (theme !== 'sunrise' && cs.bgMode === 'gradient' && cs.bgGradient)
    ? { top: cs.bgGradient.top, bottom: cs.bgGradient.bottom }
    : null
  const menuVars = useMemo(
    () => menuThemeVars(menuCanvasColor, menuGradient ? { gradient: menuGradient } : undefined) || {},
    [menuCanvasColor, menuGradient?.top, menuGradient?.bottom],
  )

  return {
    cs, menuVars, write, patchHeader,
    // Resolved workspace chart theme — the host's value if it passed one, else
    // the `charts_theme` pref. ChartPane feeds this to StockChart's canvasTheme.
    theme,
    // The raw resolved own-chart source (or null) — see the doc comment above
    // `ownChartSource`. Consumed by ChartPane as StockChart's `settingsOverride`
    // so the ACTUAL CHART (candles/MAs/background/watermark), not just the
    // chrome around it, renders what the owner configured.
    ownChartSource,
  }
}
