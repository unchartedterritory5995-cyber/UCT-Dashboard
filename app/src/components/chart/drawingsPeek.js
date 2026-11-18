// A read-only peek at a symbol's saved chart drawings, WITHOUT loading the drawings store.
//
// WHY (2026-11-10, measured): the Notebook's widget embeds read a chart's drawings when they build
// or re-skin an embed, and importing `peekDrawings` from drawingsStore put the whole store (undo
// history, tracings, the time-base conversions; a 10.9 KB shared chunk) on Notebook FIRST OPEN,
// which is held to a byte budget. This module is the small half: the storage key and the peek.
//
// Same answer as drawingsStore.peekDrawings, always:
//   - once drawingsStore has loaded (the member opened a chart in this page), it registers its own
//     live reader here, so an in-memory /charts edit that has not reached storage yet still wins;
//   - before that, the saved drawings are read from storage and normalized exactly as the store's
//     own fallback branch does.
// ⛔ ONE STORAGE KEY: drawingsStore imports DRAWINGS_STORAGE_KEY from here. Never retype it.
import { normalizeDrawings } from './drawingSchema'

export const DRAWINGS_STORAGE_KEY = 'uct-chart-drawings'

let livePeek = null

/** drawingsStore calls this once, at load, with its own peekDrawings. */
export function registerLiveDrawingsPeek(fn) {
  livePeek = typeof fn === 'function' ? fn : null
}

/** A deep copy of `sym`'s drawings; `[]` for no symbol, nothing saved, or unreadable storage. */
export function peekDrawings(sym) {
  if (!sym) return []
  if (livePeek) return livePeek(sym)
  try {
    const all = JSON.parse(localStorage.getItem(DRAWINGS_STORAGE_KEY) || '{}')
    const src = normalizeDrawings(all[sym] || [])
    return Array.isArray(src) ? JSON.parse(JSON.stringify(src)) : []
  } catch {
    return []
  }
}

/** Test seam. */
export function __resetLiveDrawingsPeek() { livePeek = null }
