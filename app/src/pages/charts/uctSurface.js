import { useLayoutEffect, useState } from 'react'

// UCT frame (owner 11-13): the title row and the widget's body must read as ONE surface,
// as on the chart widget. Every widget paints its own canvas (its own settings blob, its
// own CSS variable chain: --wl-bg, --tt-bg, --nb-bg, …), and those variables live INSIDE
// the body, where the header (a sibling) cannot read them. So the frame reads the colour
// the body actually painted — the first element near the top of the body with an opaque
// background — and the header wears that. It re-reads when the widget's own inline style
// changes (a settings edit re-points its variables) and when the app theme flips.

const TRANSPARENT = /^(transparent|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\))$/i

/** The first opaque background colour on the first-child chain under `el` (≤ 5 levels). */
export function paintedSurface(el) {
  let node = el?.firstElementChild || null
  for (let depth = 0; node && depth < 5; depth++) {
    const view = node.ownerDocument?.defaultView
    const bg = view ? view.getComputedStyle(node).backgroundColor : ''
    if (bg && !TRANSPARENT.test(bg)) return bg
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
