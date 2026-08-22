import { createContext, useContext, useRef } from 'react'
import usePreferences from './usePreferences'

/**
 * The frozen app theme a workspace widget resolves its DEFAULT appearance from.
 * WidgetHost publishes it via PlacedThemeContext (from the widget's persisted
 * `opts.placedTheme`, else a capture frozen at the widget's mount), so the widget
 * body's JS-computed colors and the wrapper's `data-theme` CSS tokens agree on ONE
 * theme. Switching the app theme afterwards never recolors an already-placed,
 * uncustomized widget; only a NEW widget picks up the current theme.
 */
export const PlacedThemeContext = createContext(null)

/**
 * @param {string|null} stamped optional explicit override (wins over everything).
 * Resolution order: explicit `stamped` → WidgetHost's context → the first non-null
 * theme captured for THIS instance's lifetime (survives async prefs load) → live.
 * A customized widget reads its saved settings and never reaches the theme default,
 * so this only governs the untouched look — exactly the case that was flipping.
 */
export default function usePlacedTheme(stamped = null) {
  const ctx = useContext(PlacedThemeContext)
  const { prefs } = usePreferences()
  const frozen = useRef(null)
  if (frozen.current == null && prefs?.theme) frozen.current = prefs.theme
  return stamped || ctx || frozen.current || prefs?.theme || null
}
