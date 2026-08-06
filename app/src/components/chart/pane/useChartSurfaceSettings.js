import { useCallback, useMemo } from 'react'
import usePreferences from '../../../hooks/usePreferences'
import { mergeChartSettings } from '../chartDefaults'
import { menuThemeVars } from '../../../utils/dividerColor'

function isNonEmptySettingsObj(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0
}

// Every /charts widget owns its own settings blob in `opts.settings` inside the
// `charts_workspace_layout` pref (see ChartWidget.jsx) — or, when the user
// customized an EXTRA tab instead of the main one, in
// `opts.chartTabs[].settings` (see chartTabs.js). The global `chart_settings`
// pref is only the untouched SEED that a brand-new widget starts from — it is
// NOT "the user's chart". A surface that IS the user's one chart (stored=null,
// no onStore — every popup/embedded chart outside the /charts workspace
// itself) must resolve, for the FIRST chart widget: its main-tab settings,
// else the first extra tab that has settings, else null (caller falls back
// to the seed) — so it renders what the owner actually configured rather than
// the untouched default.
//
// Returns the RAW, unmerged blob that won (or null). Defensive at every step:
// the layout pref may be absent, a JSON string, an already-parsed object,
// malformed JSON, missing a `widgets` array, missing a chart widget entirely,
// or `chartTabs` may be absent/not-an-array/contain entries without a
// `settings` object — every failure falls through to null and this NEVER
// throws.
function resolveOwnChartSettingsSource(workspaceLayoutRaw) {
  try {
    if (!workspaceLayoutRaw) return null
    const parsed = typeof workspaceLayoutRaw === 'string' ? JSON.parse(workspaceLayoutRaw) : workspaceLayoutRaw
    const widgets = parsed?.widgets
    if (!Array.isArray(widgets)) return null
    const chartWidget = widgets.find((w) => w?.type === 'chart')
    if (!chartWidget) return null
    const widgetSettings = chartWidget?.opts?.settings
    if (isNonEmptySettingsObj(widgetSettings)) return widgetSettings
    const tabs = chartWidget?.opts?.chartTabs
    if (Array.isArray(tabs)) {
      const tab = tabs.find((t) => isNonEmptySettingsObj(t?.settings))
      if (tab) return tab.settings
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
export default function useChartSurfaceSettings({ stored = null, onStore = null, chartsTheme = 'default' } = {}) {
  const { prefs, setPref } = usePreferences()
  const isOwnChartSurface = stored === null && !onStore
  // The RAW, unmerged blob that won the own-chart resolution (the widget's or
  // a tab's settings) — or null when it fell back to the chart_settings seed
  // (in which case StockChart's own base, read from that same seed, is already
  // correct and needs no override). null on every non-own-chart surface. MUST
  // stay identity-stable across renders with unchanged inputs — ChartPane hands
  // this straight to StockChart's `settingsOverride`, documented there as a
  // memo dep that must not thrash.
  const ownChartSource = useMemo(
    () => (isOwnChartSurface ? resolveOwnChartSettingsSource(prefs.charts_workspace_layout) : null),
    [isOwnChartSurface, prefs.charts_workspace_layout],
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

  return {
    cs, menuVars, write, patchHeader,
    // The raw resolved own-chart source (or null) — see the doc comment above
    // `ownChartSource`. Consumed by ChartPane as StockChart's `settingsOverride`
    // so the ACTUAL CHART (candles/MAs/background/watermark), not just the
    // chrome around it, renders what the owner configured.
    ownChartSource,
  }
}
