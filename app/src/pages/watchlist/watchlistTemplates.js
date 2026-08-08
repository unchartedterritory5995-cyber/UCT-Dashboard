// app/src/pages/watchlist/watchlistTemplates.js
//
// Watchlist "look" templates — a saved bundle of the APPEARANCE settings (canvas,
// colors, tint, logos, font — the `watchlist_settings` blob) PLUS the column layout
// (order / hidden / widths). NO symbols: a template is a reusable style you can apply
// to any list, mirroring the charts widget's "Save as Template" (Templates ▾ /
// + Save as Template). Stored per-user in the `watchlist_templates` preference so it
// follows the user across devices, exactly like `watchlist_settings`.
import { useMemo, useCallback } from 'react'
import usePreferences, { parsePref } from '../../hooks/usePreferences'
import { WATCHLIST_DEFAULTS, mergeWatchlistSettings } from './watchlistSettings'

export const WATCHLIST_TEMPLATES_KEY = 'watchlist_templates'

// The localStorage key the Watchlists page reads its column config from. Centralized
// here so both the page and the picker (create-from-template) write the same key.
export const WL_COLS_LS = 'uct.watchlist.cols'

/** Write a template's column layout to the shared watchlist column config. Merges over
 *  whatever is stored so we never drop an unrelated field (e.g. a live sort). */
export function applyTemplateColumns(cols) {
  if (!cols || typeof cols !== 'object') return
  try {
    const cur = JSON.parse(localStorage.getItem(WL_COLS_LS) || '{}') || {}
    const next = { ...cur }
    if (Array.isArray(cols.order)) next.order = cols.order
    if (cols.hidden && typeof cols.hidden === 'object') next.hidden = cols.hidden
    if (cols.widths && typeof cols.widths === 'object') next.widths = cols.widths
    localStorage.setItem(WL_COLS_LS, JSON.stringify(next))
  } catch { /* ignore quota / disabled storage */ }
}

function genId() {
  return `wt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Per-user watchlist templates, backed by the `watchlist_templates` preference.
 * Returns { templates, saveTemplate({name, settings, cols}) → id, removeTemplate(id) }.
 */
export function useWatchlistTemplates() {
  const { prefs, setPref } = usePreferences()

  const templates = useMemo(() => {
    const raw = parsePref(prefs?.[WATCHLIST_TEMPLATES_KEY], [])
    return Array.isArray(raw) ? raw.filter(t => t && t.id && t.name) : []
  }, [prefs])

  const saveTemplate = useCallback(({ name, settings }) => {
    const clean = (name || '').trim().slice(0, 60)
    if (!clean) return null
    const id = genId()
    const tpl = {
      id,
      name: clean,
      // Normalize appearance through the same merge the panel uses so a partial/older
      // blob still applies cleanly later. A template is APPEARANCE ONLY — it deliberately
      // does NOT store the column layout (order/hidden/widths), so applying a template
      // never changes which columns show or removes a list-specific column.
      settings: mergeWatchlistSettings(settings),
    }
    // Upsert by case-insensitive name so re-saving under an existing name replaces it.
    const rest = templates.filter(t => t.name.toLowerCase() !== clean.toLowerCase())
    setPref(WATCHLIST_TEMPLATES_KEY, JSON.stringify([...rest, tpl]))
    return id
  }, [templates, setPref])

  const removeTemplate = useCallback((id) => {
    setPref(WATCHLIST_TEMPLATES_KEY, JSON.stringify(templates.filter(t => t.id !== id)))
  }, [templates, setPref])

  return { templates, saveTemplate, removeTemplate }
}

// Re-export for callers that only need the defaults reference.
export { WATCHLIST_DEFAULTS }
