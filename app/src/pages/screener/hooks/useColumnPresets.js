import { useCallback } from 'react'
import usePreferences, { parsePref } from '../../../hooks/usePreferences'

// ── useColumnPresets — the member's own saved COLUMN layouts ──
//
// A "view" in the screener is a set of columns. The firm ships a few
// (`meta.views`); this lets a member save their OWN, as many as they like, from
// any columns they picked. It needs no new backend: preferences
// (`/api/auth/preferences`) are a generic JSON key-value store, so the whole
// preset list rides under one key. Values there round-trip as a JSON string, so
// every read goes through parsePref with an array fallback.
export const PRESETS_KEY = 'screener_column_presets'

const clean = list => (Array.isArray(list) ? list.filter(p => p && p.id && Array.isArray(p.columns)) : [])

export default function useColumnPresets() {
  const { prefs, setPref, loading } = usePreferences()
  const presets = clean(parsePref(prefs[PRESETS_KEY], []))

  // Save (or overwrite by name — a member re-saving "My momentum" updates it
  // rather than stacking a duplicate). Columns are copied, never aliased.
  const save = useCallback((name, columns) => {
    const nm = (name || '').trim()
    if (!nm || !Array.isArray(columns) || !columns.length) return Promise.resolve(false)
    const id = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    return setPref(PRESETS_KEY, [
      ...presets.filter(p => p.name !== nm),
      { id, name: nm, columns: [...columns] },
    ])
  }, [presets, setPref])

  const remove = useCallback(
    id => setPref(PRESETS_KEY, presets.filter(p => p.id !== id)),
    [presets, setPref])

  return { presets, save, remove, loading }
}
