import { useCallback, useMemo } from 'react'
import usePreferences from '../../../hooks/usePreferences'
import { mergeChartSettings } from '../chartDefaults'
import { menuThemeVars } from '../../../utils/dividerColor'

// Every /charts widget owns its own settings blob in `opts.settings` inside the
// `charts_workspace_layout` pref (see ChartWidget.jsx). The global
// `chart_settings` pref is only the untouched SEED that a brand-new widget
// starts from — it is NOT "the user's chart". A surface that IS the user's one
// chart (stored=null, no onStore — every popup/embedded chart outside the
// /charts workspace itself) must resolve to the FIRST chart widget's settings
// when one exists, falling back to the seed otherwise, so it renders what the
// owner actually configured rather than the untouched default.
//
// Defensive at every step: the layout pref may be absent, a JSON string, an
// already-parsed object, malformed JSON, missing a `widgets` array, or missing
// a chart widget entirely — every failure falls through to `chart_settings`
// and this NEVER throws.
function resolveOwnChartSettingsSource(chartSettings, workspaceLayoutRaw) {
  try {
    if (workspaceLayoutRaw) {
      const parsed = typeof workspaceLayoutRaw === 'string' ? JSON.parse(workspaceLayoutRaw) : workspaceLayoutRaw
      const widgets = parsed?.widgets
      if (Array.isArray(widgets)) {
        const chartWidget = widgets.find((w) => w?.type === 'chart')
        const widgetSettings = chartWidget?.opts?.settings
        if (widgetSettings && typeof widgetSettings === 'object' && !Array.isArray(widgetSettings)
          && Object.keys(widgetSettings).length > 0) {
          return widgetSettings
        }
      }
    }
  } catch {
    // Any parse/shape failure falls through to the seed below.
  }
  return chartSettings
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
export default function useChartSurfaceSettings({ stored = null, onStore = null, chartsTheme = 'default' } = {}) {
  const { prefs, setPref } = usePreferences()
  const isOwnChartSurface = stored === null && !onStore
  const globalCs = useMemo(() => mergeChartSettings(
    isOwnChartSurface
      ? resolveOwnChartSettingsSource(prefs.chart_settings, prefs.charts_workspace_layout)
      : prefs.chart_settings,
  ), [isOwnChartSurface, prefs.chart_settings, prefs.charts_workspace_layout])
  const storedCs = useMemo(() => (stored ? mergeChartSettings(stored) : null), [stored])
  const cs = storedCs || globalCs

  const write = useCallback((nextFull) => {
    if (stored || onStore) onStore?.(nextFull)
    else setPref('chart_settings', nextFull)
  }, [stored, onStore, setPref])

  const patchHeader = useCallback((patch) => {
    write({ ...cs, header: { ...cs.header, ...patch }, preset: 'custom' })
  }, [cs, write])

  const menuCanvasColor = chartsTheme === 'sunrise'
    ? '#eaf3fb'
    : (cs.bgMode === 'gradient' ? (cs.bgGradient?.top || cs.background) : cs.background)
  const menuGradient = (chartsTheme !== 'sunrise' && cs.bgMode === 'gradient' && cs.bgGradient)
    ? { top: cs.bgGradient.top, bottom: cs.bgGradient.bottom }
    : null
  const menuVars = useMemo(
    () => menuThemeVars(menuCanvasColor, menuGradient ? { gradient: menuGradient } : undefined) || {},
    [menuCanvasColor, menuGradient?.top, menuGradient?.bottom],
  )

  return { cs, menuVars, write, patchHeader }
}
