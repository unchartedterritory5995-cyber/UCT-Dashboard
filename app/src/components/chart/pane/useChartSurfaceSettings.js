import { useCallback, useMemo } from 'react'
import usePreferences from '../../../hooks/usePreferences'
import { mergeChartSettings } from '../chartDefaults'
import { menuThemeVars } from '../../../utils/dividerColor'

// Resolves the chart settings a surface should render with, and gives it one
// write sink.
//
//   stored = null  -> the user's ONE chart: read + write the global
//                     chart_settings pref. This is what every non-workspace
//                     surface passes, so a popup IS your chart.
//   stored = blob  -> a surface that owns its own settings (a /charts widget or
//                     tab). Writes go to onStore and NEVER to the global pref —
//                     that isolation is load-bearing.
export default function useChartSurfaceSettings({ stored = null, onStore = null, chartsTheme = 'default' } = {}) {
  const { prefs, setPref } = usePreferences()
  const globalCs = useMemo(() => mergeChartSettings(prefs.chart_settings), [prefs.chart_settings])
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
