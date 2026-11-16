// useWidgetMenuPlacement — where a widget's ⚙ settings menu sits (owner 11-14). One owner for
// the six settings panels (Theme Tracker, Watchlist, News, Breadth, Fundamentals, NH/NL):
//
//  1. Beside the widget, on the side FACING the middle of the screen, its top FLUSH with the
//     widget's outer frame (the [data-widget-id] cell on /charts — not the inner body below
//     the header). Off /charts there is no frame, so the host element itself is the anchor.
//  2. As tall as the widget (never shorter than MIN_H), capped by the screen — it scrolls only
//     when it truly runs out of room.
//  3. While open, the ⚙ stays lit (data-menu-open on the gear; the widget outline was dropped).
//  4. An 8px gap and a quick slide-in from the widget's side (`side` → CSS).
//  5. No room on either side (a full-width widget): drop down from the ⚙, right-aligned inside
//     the widget. `dropdown: true` asks for that always (the Notebook's gear menu).
//  6. Dragging or resizing the widget closes the menu — it never floats beside empty space.
import { useEffect, useLayoutEffect, useRef } from 'react'

const GAP = 8
const EDGE = 8
const MIN_H = 380

export function frameOf(hostEl) {
  return hostEl?.closest?.('[data-widget-id]') || hostEl || null
}

export function placeWidgetMenu({ frame, gear, panelW, dropdown = false, vw, vh }) {
  const r = frame.getBoundingClientRect()
  const fitsRight = r.right + GAP + panelW <= vw - EDGE
  const fitsLeft = r.left - GAP - panelW >= EDGE
  const preferRight = (r.left + r.width / 2) < vw / 2
  let side = null
  if (!dropdown) side = preferRight ? (fitsRight ? 'right' : fitsLeft ? 'left' : null) : (fitsLeft ? 'left' : fitsRight ? 'right' : null)
  if (side) {
    const left = side === 'right' ? r.right + GAP : r.left - GAP - panelW
    const top = Math.max(EDGE, r.top)
    const want = Math.max(MIN_H, r.bottom - top)
    const maxHeight = Math.max(160, Math.min(want, vh - EDGE - top))
    return { left: Math.round(left), top: Math.round(top), maxHeight: Math.round(maxHeight), side }
  }
  // Drop-down from the gear, right-aligned inside the widget.
  const g = gear?.getBoundingClientRect?.()
  const anchorRight = g && g.width ? g.right : r.right - 6
  const anchorBottom = g && g.height ? g.bottom : r.top + 36
  const left = Math.max(EDGE, Math.min(Math.min(anchorRight, r.right - 6) - panelW, vw - panelW - EDGE))
  const top = Math.max(EDGE, anchorBottom + 6)
  const maxHeight = Math.max(160, Math.min(Math.max(MIN_H, r.bottom - top - 6), vh - EDGE - top))
  return { left: Math.round(left), top: Math.round(top), maxHeight: Math.round(maxHeight), side: 'down' }
}

export default function useWidgetMenuPlacement({ hostEl, gearEl, panelW, setPos, onClose, dropdown = false }) {
  const closeRef = useRef(onClose)
  const placeRef = useRef(null)
  useEffect(() => { closeRef.current = onClose })

  // 1, 2, 4, 5 — place now, and again when the window or the widget's size changes.
  useLayoutEffect(() => {
    const frame = frameOf(hostEl)
    if (!frame) return undefined
    const place = () => setPos(placeWidgetMenu({ frame, gear: gearEl, panelW, dropdown, vw: window.innerWidth, vh: window.innerHeight }))
    placeRef.current = place
    // A window resize re-lays the board AFTER this event (owner 11-15: the menu stayed ~20px off),
    // so measure now, on the next frame, and once the grid has settled.
    let raf = 0
    let t = 0
    const onResize = () => {
      place()
      cancelAnimationFrame(raf); raf = requestAnimationFrame(place)
      clearTimeout(t); t = setTimeout(place, 300)
    }
    place()
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); cancelAnimationFrame(raf); clearTimeout(t); placeRef.current = null }
  }, [hostEl, gearEl, panelW, dropdown, setPos])

  // 3 — the lit gear and the outlined widget, for as long as the menu is open.
  useEffect(() => {
    const frame = hostEl?.closest?.('[data-widget-id]')
    frame?.setAttribute('data-menu-open', 'true')
    gearEl?.setAttribute?.('data-menu-open', 'true')
    return () => {
      frame?.removeAttribute('data-menu-open')
      gearEl?.removeAttribute?.('data-menu-open')
    }
  }, [hostEl, gearEl])

  // 6 — the widget moved or changed size (a drag or a resize; not a window resize) → close.
  useEffect(() => {
    const frame = hostEl?.closest?.('[data-widget-id]')
    if (!frame || typeof MutationObserver === 'undefined') return undefined
    const box = (b) => `${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.width)},${Math.round(b.height)}`
    let last = box(frame.getBoundingClientRect())
    let winResizeAt = 0
    const onWin = () => { winResizeAt = Date.now() }
    const check = () => {
      const now = box(frame.getBoundingClientRect())
      if (now === last) return
      last = now
      // the board re-laying itself after a window resize: follow the widget, don't close
      if (Date.now() - winResizeAt < 1000) { placeRef.current?.(); return }
      closeRef.current?.()
    }
    const mo = new MutationObserver(check)
    mo.observe(frame, { attributes: true, attributeFilter: ['style', 'class'] })
    window.addEventListener('resize', onWin)
    return () => { mo.disconnect(); window.removeEventListener('resize', onWin) }
  }, [hostEl])
}
