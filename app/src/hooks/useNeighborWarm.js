import { useEffect } from 'react'
import { warmMemFromIDB, prefetchBarsToIDB } from '../utils/prefetchBars'

// ── Shared "instant scan" neighbor-warm ──────────────────────────────────────
// The ONE step that makes arrow/click scanning through ANY ticker list paint the
// next chart in the SAME frame: keep the ±radius neighbors of the current
// selection in the SYNCHRONOUS mem cache for the on-screen timeframe, so
// StockChart's memPeek fallback hits on the first render instead of paying the
// async idbGet hop (the perceptible "pop") or a cold /api/bars fetch (~150ms).
//
// Two complementary calls, both bounded / idle-deferred / backpressure-guarded
// inside prefetchBars.js (they can never stampede the server or starve the chart
// the user is actively viewing — same envelope as the watchlist warm):
//   • warmMemFromIDB       — promote neighbors ALREADY durable in IndexedDB
//     straight to sync mem (zero network). Instant for an already-warmed list.
//   • prefetchBarsToIDB(priority) — for neighbors NOT yet in IDB (a cold list like
//     Market Map, or the frontier of a fast scan), fetch → IDB + mem, jumping the
//     queue so the tickers about to be reached warm before ones further out.
//
// Extracted from Watchlists' proven ±6 effect (app/src/pages/Watchlists.jsx) so
// Theme Tracker, Breadth, Market Map and any future list get the identical
// same-frame behavior from ONE place instead of each re-deriving it (Theme
// Tracker + Breadth had the arrow nav but omitted the sync-mem promote; Market
// Map had nothing).
//
// `orderedSymbols` MUST be in the on-screen (DOM / visual sort) order so the
// warmed neighbors match what the user actually arrows to under any active sort.
// Wrap-aware, mirroring the end-of-list wrap in the surfaces' nav handlers.
// Pass a memoized array where possible; re-firing is cheap regardless (memHas /
// _idbSeen skips make an already-warm neighbor a no-op), so a churny reference
// only costs a few Map lookups, never a duplicate fetch.
export function useNeighborWarm(orderedSymbols, selectedSym, tf, { radius = 6 } = {}) {
  useEffect(() => {
    if (!selectedSym || !orderedSymbols || orderedSymbols.length < 2) return
    const flat = orderedSymbols
    const idx = flat.indexOf(selectedSym)
    if (idx < 0) return
    const len = flat.length
    const around = new Set()
    for (let d = 1; d <= radius; d++) {
      around.add(flat[(idx + d) % len])
      around.add(flat[(idx - d + len) % len])
    }
    around.delete(selectedSym)
    const neighbors = [...around].filter(Boolean)
    if (!neighbors.length) return
    const onTf = tf || 'D'
    warmMemFromIDB(neighbors, [onTf])                      // durable → sync mem (no network)
    prefetchBarsToIDB(neighbors, onTf, { priority: true }) // cold → IDB + mem, jump the queue
  }, [orderedSymbols, selectedSym, tf, radius])
}
