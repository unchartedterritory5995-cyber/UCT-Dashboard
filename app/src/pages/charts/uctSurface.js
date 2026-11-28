import { useLayoutEffect, useState } from 'react'

// UCT frame (owner 11-13): the title row and the widget's body must read as ONE surface,
// as on the chart widget. Every widget paints its own canvas (its own settings blob, its
// own CSS variable chain: --wl-bg, --tt-bg, --nb-bg, …), and those variables live INSIDE
// the body, where the header (a sibling) cannot read them. So the frame reads the colour
// the body actually painted — the first element near the top of the body with an opaque
// background — and the header wears that. It re-reads when the widget's own inline style
// changes (a settings edit re-points its variables) and when the app theme flips.

const TRANSPARENT = /^(transparent|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\))$/i

// The first colour stop of a CSS gradient, when it is fully opaque (`rgb(…)` or `#…`).
// Computed style serialises a `to bottom` gradient as `linear-gradient(rgb(r, g, b) 0%, …)`,
// so the first stop is the TOP of the canvas — the edge the header sits on.
const FIRST_STOP = /gradient\(\s*(?:[^,()]*,\s*)?(rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|#[0-9a-f]{3,8}\b)/i

/** The first painted canvas on the first-child chain under `el` (≤ 5 levels): an opaque
 *  background colour, or the top stop of a gradient canvas. A layer that is fixed to the
 *  window or not showing (a hidden toast) is not the canvas and is skipped.
 *
 *  ⚰️ 2026-11-27: a gradient canvas has a TRANSPARENT background-color (the gradient is a
 *  background-image), so this used to walk past it and land on the watchlist's hidden
 *  toast (rgba(12,12,12,0.92)) — a teal watchlist under a near-black header. */
export function paintedSurface(el) {
  let node = el?.firstElementChild || null
  for (let depth = 0; node && depth < 5; depth++) {
    const view = node.ownerDocument?.defaultView
    const cs = view ? view.getComputedStyle(node) : null
    if (cs && cs.position !== 'fixed' && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0') {
      const bg = cs.backgroundColor
      if (bg && !TRANSPARENT.test(bg)) return bg
      const img = cs.backgroundImage
      const m = img && img !== 'none' ? FIRST_STOP.exec(img) : null
      if (m) return m[1]
    }
    node = node.firstElementChild
  }
  return null
}

/** The colour a widget body paints (null until known, or when it paints none). */
export function useBodySurface(bodyRef, enabled, key) {
  const [surface, setSurface] = useState(null)
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!enabled || !el) return undefined
    const view = el.ownerDocument?.defaultView || window
    let raf = 0
    const read = () => {
      raf = 0
      const next = paintedSurface(el)
      setSurface((prev) => (prev === next ? prev : next))
    }
    const schedule = () => { if (!raf) raf = view.requestAnimationFrame(read) }
    schedule()   // first read on the next frame: the body has painted by then
    const MO = view.MutationObserver
    const obs = MO ? new MO(schedule) : null
    // Inline style / class on the body's own top elements (a settings edit re-points the
    // canvas variables there) and the document root (the app theme flips via data-theme).
    obs?.observe(el, { attributes: true, attributeFilter: ['style', 'class'], subtree: true, childList: true })
    obs?.observe(el.ownerDocument.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })
    return () => { obs?.disconnect(); if (raf) view.cancelAnimationFrame(raf) }
  }, [bodyRef, enabled, key])
  return enabled ? surface : null
}
