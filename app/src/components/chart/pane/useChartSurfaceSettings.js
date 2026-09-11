import { useCallback, useMemo } from 'react'
import usePreferences from '../../../hooks/usePreferences'
import { mergeChartSettings } from '../chartDefaults'
import { resolveOwnChartSettingsSource } from './ownChartSettings'
import { menuThemeVars } from '../../../utils/dividerColor'
import { readableInk } from '../chartThemes'

// The resolution itself lives in ownChartSettings.js (hooks-free) so
// capture-time consumers — journal chart embeds freeze the merged blob at
// insert — can import it without dragging React into their module graph.
// Re-exported here so the hook module stays the discoverable front door.
export { resolveOwnChartSettingsSource, resolveOwnChartMergedSettings } from './ownChartSettings'

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

  /**
   * The colour the chart's own chrome is sitting on, and the ink that reads on it.
   *
   * ⭐⭐ ONE DERIVATION, NOT A SECOND ONE. `menuCanvasColor` above is already the
   * answer to "what colour is the surface behind this chart's chrome" — it
   * resolves the workspace sunrise theme, the gradient case and the solid case in
   * one place, and the menus have used it since the menu-theming reversal. Asking
   * the same question a second way is how the header came to disagree with the
   * canvas in the first place.
   *
   * ⛔⛔ AND THE HEADER'S TEXT FOLLOWED THE WRONG THEME. There are TWO theme
   * systems here: `charts_theme` (workspace-wide, two values) stamps
   * `data-charts-theme` and drives 99 CSS rules; the Chart Themes gallery (44
   * skins, 8 of them in the `light` family) writes the CANVAS into this blob. The
   * Info Row's values set no colour of their own, so they inherited the APP
   * theme's bright text — measured `rgb(240,239,234)` on a `rgb(243,239,228)`
   * bar, a contrast ratio of **1.002**, with the built-in `Price` field affected
   * identically. That is not a custom-formula bug and not an attribute-plumbing
   * bug: the gallery simply never told the header anything.
   *
   * ⭐ `readableInk` IS THE SHIPPED RULE, NOT A NEW ONE. It already exists for
   * exactly this class of text — "widget DATA text (symbol/price/volume/etc.),
   * which must read crisply in dense rows" — and `applyThemeToSettings` already
   * uses the same luminance test to pick the legend and title ink. The Info Row is
   * that same dense data row; it was the one that never called it.
   */
  const ink = useMemo(() => readableInk(menuCanvasColor), [menuCanvasColor])

  return {
    cs, menuVars, write, patchHeader,
    // The canvas behind this chart's chrome, and the ink that reads on it.
    // ⚠️ A FALLBACK, NEVER AN OVERRIDE: a field that carries its own colour keeps
    // it, so the four built-ins that ship an explicit tint are untouched.
    canvasColor: menuCanvasColor,
    ink,
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
