// ── UCT Agent PRODUCT GUIDE: the ring's geometry — measured, clipped and tracked the same way for every walkthrough ──
//
// GUIDE-OVERLAY-GEOMETRY.md has the why. In short:
//   • one set of constants (RING) for the room around a control, the corner radius and the stroke, and one handle style: a
//     small drag handle (a widget's resize corner, a divider) gets a circle centred on the handle's own centre
//   • the rectangle is the control's border box in viewport coordinates (getBoundingClientRect: transforms and zoom already
//     applied), intersected with EVERY ancestor that clips it, on BOTH axes (overflow hidden / clip / auto / scroll)
//   • tracking is event-driven: a ResizeObserver on the control and the box it sits in, scroll (capture) and resize on the
//     window, and a requestAnimationFrame loop that runs ONLY while something is moving (a pointer drag in progress, or the
//     rectangle changed on the last frame) and stops once it has been still for STILL_FRAMES frames. One read per frame;
//     the write is a transform on the ring, never a layout property. Nothing outlives `stop()`.
// Nothing here clicks, focuses or changes the board.

export const RING = Object.freeze({
  pad: 4,          // room between the control's edge and the ring's inner edge, px
  radius: 8,       // the ring's corner radius, px
  stroke: 2,       // the ring's line width, px (GuideOverlay.module.css .ring border)
  handlePad: 6,    // room around a drag handle's own box, px (the circle's radius = half its longer side + this)
  handleMax: 24,   // a control no bigger than this on both sides, that is dragged, is a handle
})
/** Frames with no change before the loop stops (and an event starts it again). */
export const STILL_FRAMES = 6

const CLIPS = /hidden|clip|auto|scroll/
const overflowOf = (node) => {
  try {
    const cs = getComputedStyle(node)
    // a browser resolves both axes; jsdom reports only what was set, so the shorthand is the fallback
    return { x: cs.overflowX || cs.overflow || '', y: cs.overflowY || cs.overflow || '', fixed: cs.position === 'fixed' }
  } catch { return { x: '', y: '', fixed: false } }
}

/** What of `el` shows, in viewport coordinates: its box intersected with every clipping ancestor, each axis on its own.
 *  → { top, left, width, height } (may be empty: width or height 0). */
export function visibleBox(el) {
  if (!el?.getBoundingClientRect) return null
  const r = el.getBoundingClientRect()
  let left = r.left
  let top = r.top
  let right = r.right ?? r.left + r.width
  let bottom = r.bottom ?? r.top + r.height
  if (typeof document !== 'undefined') {
    // a fixed element is clipped by nothing it is not inside of on screen: stop at the first fixed ancestor (its own box clips)
    let fixedSeen = overflowOf(el).fixed
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const o = overflowOf(p)
      if (CLIPS.test(o.x) || CLIPS.test(o.y)) {
        const c = p.getBoundingClientRect()
        // jsdom (and a box not laid out yet) gives a 0×0 rectangle: no clip known on that axis
        if (CLIPS.test(o.x) && c.width > 0) { left = Math.max(left, c.left); right = Math.min(right, c.right ?? c.left + c.width) }
        if (CLIPS.test(o.y) && c.height > 0) { top = Math.max(top, c.top); bottom = Math.min(bottom, c.bottom ?? c.top + c.height) }
      }
      if (fixedSeen) break
      fixedSeen = o.fixed
    }
  }
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

/** A small control the member drags (a resize corner, a divider): ringed as a circle on its own centre. */
export function isHandle(el) {
  if (!el?.getBoundingClientRect) return false
  const r = el.getBoundingClientRect()
  if (!(r.width > 0 && r.height > 0 && r.width <= RING.handleMax && r.height <= RING.handleMax)) return false
  const g = el.getAttribute?.('data-guide') || ''
  if (/(^|\.)resize(\.|$)/.test(g)) return true
  let cur = ''
  try { cur = el.style?.cursor || getComputedStyle(el).cursor || '' } catch { cur = '' }
  return /resize|grab|move/.test(cur)
}

/** The ring for a control → { top, left, width, height, round } in viewport px, or null when nothing of it shows.
 *  `pad` overrides RING.pad (a menu's holder box is measured with 0). */
export function ringRect(el, { pad = RING.pad } = {}) {
  const v = visibleBox(el)
  if (!v || v.width <= 0 || v.height <= 0) return null
  if (isHandle(el)) {
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const d = Math.max(r.width, r.height) + RING.handlePad * 2
    return { top: cy - d / 2, left: cx - d / 2, width: d, height: d, round: true }
  }
  return { top: v.top - pad, left: v.left - pad, width: v.width + pad * 2, height: v.height + pad * 2, round: false }
}

/** The element the ring is drawn around for a found control. The CHART ITSELF (its plot, chart.plot) is ringed as its whole board
 *  cell (header and toolbar included: the chart's boundary as the member sees it, pl-auto 2026-11-09); every other control is its own box. */
export function ringElementOf(el) {
  if (el?.getAttribute?.('data-guide') !== 'chart.plot') return el
  return el.closest?.('[data-grid-cell-id]') || el.closest?.('[data-widget-id]') || el
}

export const sameRing = (a, b) => (!a && !b) || (!!a && !!b && a.round === b.round && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5
  && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5)

const raf = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(() => fn(Date.now()), 16))
const caf = (id) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id))

/**
 * Track one control: `onRing(rect | null)` on every change (null: it unmounted or nothing of it shows). Measures once now.
 * `holder`: the box the control sits in (its board cell), observed too — a cell resized from its corner moves the control
 * inside it without resizing the control itself.
 * → { stop(), kick() } — `kick` runs the frame loop (something outside says it may have moved).
 */
export function trackRing(el, onRing, { holder = null } = {}) {
  let stopped = false
  let frame = null
  let still = 0
  let dragging = false
  let last
  const measure = () => {
    const r = el.isConnected === false ? null : ringRect(el)
    if (!sameRing(r, last)) { last = r; onRing(r); return true }
    return false
  }
  const loop = () => {
    frame = null
    if (stopped) return
    const moved = measure()
    still = moved ? 0 : still + 1
    if (last === null && el.isConnected === false) return   // gone: no more frames for it
    if (dragging || still < STILL_FRAMES) frame = raf(loop)
  }
  const kick = () => { if (stopped) return; still = 0; if (frame == null) frame = raf(loop) }
  const onDown = () => { dragging = true; kick() }
  const onUp = () => { dragging = false; kick() }
  let ro = null
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => { if (stopped) return; measure(); kick() })
    try { ro.observe(el) } catch { /* not observable */ }
    for (const box of new Set([holder, holder?.parentElement, el.offsetParent].filter(b => b && b !== el && b !== document.body))) {
      try { ro.observe(box) } catch { /* not observable */ }
    }
  }
  // a drag in progress keeps the loop alive (the drag's own frames move the control); only noted, never consumed
  const onMove = () => { if (dragging) kick() }
  const opts = { capture: true, passive: true }
  if (typeof window !== 'undefined') {
    window.addEventListener('scroll', kick, opts)
    window.addEventListener('resize', kick, opts)
    window.addEventListener('pointerdown', onDown, opts)
    window.addEventListener('pointermove', onMove, opts)
    window.addEventListener('pointerup', onUp, opts)
    window.addEventListener('pointercancel', onUp, opts)
  }
  measure()
  kick()
  return {
    kick,
    stop() {
      if (stopped) return
      stopped = true
      if (frame != null) { caf(frame); frame = null }
      ro?.disconnect()
      if (typeof window !== 'undefined') {
        window.removeEventListener('scroll', kick, opts)
        window.removeEventListener('resize', kick, opts)
        window.removeEventListener('pointerdown', onDown, opts)
        window.removeEventListener('pointermove', onMove, opts)
        window.removeEventListener('pointerup', onUp, opts)
        window.removeEventListener('pointercancel', onUp, opts)
      }
    },
    get running() { return frame != null },
  }
}

/** A control the member DRAGS (a resize corner or edge, a divider, a grip): any size. Its step is done when the drag ENDS. */
export function isDragControl(el) {
  if (!el) return false
  if (/(^|\.)resize(\.|$)/.test(el.getAttribute?.('data-guide') || '')) return true
  let cur = ''
  try { cur = el.style?.cursor || getComputedStyle(el).cursor || '' } catch { cur = '' }
  return /resize|grab|move/.test(cur)
}
