import { useCallback, useMemo } from 'react'
import usePreferences from './usePreferences'

// The user's saved custom colors — ONE global list shared by every color picker in
// the app (chart settings, and the news / profile / watchlist widget settings
// panels). Backed by the `chart_saved_colors` preference so a color saved in any
// picker shows up in all of them. Newest-first, de-duped, capped at 24.
export default function useSavedColors() {
  const { prefs, setPref } = usePreferences()
  const savedColors = useMemo(() => {
    try {
      const raw = prefs?.chart_saved_colors
      const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
      return Array.isArray(arr) ? arr : []
    } catch { return [] }
  }, [prefs?.chart_saved_colors])
  const saveColor = useCallback((hex) => {
    if (!hex) return
    const h = String(hex).toLowerCase()
    const next = [h, ...savedColors.filter(c => String(c).toLowerCase() !== h)].slice(0, 24)
    setPref('chart_saved_colors', JSON.stringify(next))
  }, [savedColors, setPref])
  const deleteColor = useCallback((hex) => {
    const h = String(hex).toLowerCase()
    setPref('chart_saved_colors', JSON.stringify(savedColors.filter(c => String(c).toLowerCase() !== h)))
  }, [savedColors, setPref])
  return { savedColors, saveColor, deleteColor }
}
