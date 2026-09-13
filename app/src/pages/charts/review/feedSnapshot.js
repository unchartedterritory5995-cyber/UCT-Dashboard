/* THE LAST FRAME A CARD PAINTED — so scrolling away does not leave a hole.
 *
 * ⛔ THE PROBLEM A SKELETON CREATES. Only three cards can hold a live chart, so
 * on a 40-symbol feed thirty-seven cards are placeholders at any moment. If a
 * placeholder is a grey box, scrolling back over ground you just covered shows
 * you nothing you have already seen — the feed reads as broken rather than
 * bounded, and the member scrolls slower to let charts "catch up", which is the
 * opposite of what the surface is for.
 *
 * ⭐ THE CARD'S OWN CANVAS IS THE CHEAPEST TRUTH. lightweight-charts paints into
 * canvases inside the card; at unmount they are still there, still holding the
 * frame the member was looking at. No new imperative surface on `StockChart`
 * (15k lines, and a screenshot door would be a second way to read a chart), no
 * refetch, no second renderer that could draw something the live chart would
 * not.
 *
 * ⛔ DOWNSCALED, AND THE CAP IS THE POINT. A full-resolution data URL per card
 * would trade the heap the window just saved for a pile of base64 — the memory
 * incident again, wearing a different hat. Snapshots are drawn into a small
 * canvas and the store keeps only the most recent few.
 *
 * ⛔ AND EVERY FAILURE IS SILENT AND RETURNS NULL. No 2D context (jsdom), a
 * tainted canvas, a card that never painted — all of them mean "no snapshot",
 * and the card falls back to its skeleton. A placeholder is never load-bearing.
 */

/** The widest a stored snapshot is drawn. Phone cards are ~360 CSS px, so this
 *  is a touch under 1x — sharp enough to read as the chart, small enough that
 *  the whole store is a fraction of one live chart's heap. */
export const SNAP_MAX_W = 320

/** How many snapshots are kept. ⛔ A CAP, NOT A CACHE POLICY: the point is a
 *  ceiling on bytes held, so the oldest is dropped even if it is about to be
 *  scrolled back to. Missing a snapshot costs a skeleton for one frame. */
export const SNAP_KEEP = 8

/**
 * Draw the card's biggest canvas into a small one and return a data URL.
 *
 * ⭐ BIGGEST BY AREA, deliberately: lightweight-charts renders several canvases
 * per pane (price area, axes, panes) and the price area is the one that reads as
 * "the chart". Picking the first would sometimes store an axis strip.
 */
export function captureSnapshot(el, maxW = SNAP_MAX_W) {
  try {
    if (!el || typeof el.querySelectorAll !== 'function') return null
    let best = null
    for (const c of el.querySelectorAll('canvas')) {
      const area = (c.width || 0) * (c.height || 0)
      if (area > 0 && (!best || area > best.area)) best = { canvas: c, area }
    }
    if (!best) return null
    const src = best.canvas
    const scale = Math.min(1, maxW / (src.width || maxW))
    const out = document.createElement('canvas')
    out.width = Math.max(1, Math.round(src.width * scale))
    out.height = Math.max(1, Math.round(src.height * scale))
    const ctx = out.getContext('2d')
    // jsdom, and any browser that refuses the context, land here.
    if (!ctx) return null
    ctx.drawImage(src, 0, 0, out.width, out.height)
    return out.toDataURL('image/webp', 0.6)
  } catch {
    return null
  }
}

/**
 * A bounded, insertion-ordered store of snapshots keyed by symbol.
 *
 * A plain `Map` iterates in insertion order, so the oldest key is simply the
 * first — re-setting a key moves it to the end only if it is deleted first,
 * which `put` does. That makes this an LRU by writes with no bookkeeping.
 */
export function makeSnapshotStore(keep = SNAP_KEEP) {
  const m = new Map()
  return {
    get: (key) => m.get(key) || null,
    has: (key) => m.has(key),
    size: () => m.size,
    put(key, url) {
      if (!key || !url) return
      if (m.has(key)) m.delete(key)
      m.set(key, url)
      while (m.size > keep) m.delete(m.keys().next().value)
    },
    clear: () => m.clear(),
  }
}
