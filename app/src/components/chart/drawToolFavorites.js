// ── DRAWING-TOOL FAVOURITES: the ★ in the toolbar's drawing-tools menu (FavoriteDrawingsMenu onToggleFavorite) ──
//
// Persisted per browser under one key; the floating favourites toolbar shows these tool ids. This module is the
// toggle's writer — ChartToolbar's toggleFavoriteTool calls it, and so does UCT Agent's drawingExtras.favoriteTool —
// and it tells every mounted toolbar in this tab, so a second chart's toolbar shows the same stars without a reload.

export const LS_FAV = 'uct.chart.drawtools.favorites.v1'
const EVENT = 'uct:drawtool-favorites'

/** The favourite tool ids, in the order they were starred. Unreadable storage reads as none. */
export function readFavoriteTools() {
  try {
    const a = JSON.parse(localStorage.getItem(LS_FAV) || '[]')
    return Array.isArray(a) ? a.filter(x => typeof x === 'string') : []
  } catch { return [] }
}

/** The list after the ★ on `id` is clicked (on → off, off → appended). */
export const toggledFavorites = (prev, id) => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

/** Write the whole list (the toggle's write, and an exact Undo's), then tell every toolbar. True once storage holds it. */
export function writeFavoriteTools(list) {
  const next = Array.isArray(list) ? list.filter(x => typeof x === 'string') : []
  try { localStorage.setItem(LS_FAV, JSON.stringify(next)) } catch { /* storage blocked: the read-back says so */ }
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: next })) } catch { /* no window (tests) */ }
  return JSON.stringify(readFavoriteTools()) === JSON.stringify(next)
}

/** Every write from anywhere in this tab (fn(list)); returns the unsubscribe. */
export function onFavoriteToolsChange(fn) {
  if (typeof window === 'undefined') return () => {}
  const h = (e) => fn(Array.isArray(e?.detail) ? e.detail : readFavoriteTools())
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}
