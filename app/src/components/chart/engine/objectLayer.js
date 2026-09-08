// app/src/components/chart/engine/objectLayer.js
//
// ─── ⭐⭐ C3B — THE LAYER THAT PUTS OBJECTS ON A REAL CHART ──────────────────
//
// One canvas per indicator instance, sitting over the chart, redrawn from the
// generic render state. The painter (`objectCanvas.js`) is pure; this is the
// thin, boring part that owns a DOM node and a repaint schedule.
//
// ⛔⛔ IT DRAWS ONLY WHEN THE CHART HAS MOVED OR THE STATE HAS CHANGED. A
// repaint on every animation frame, forever, is a background CPU cost on a page
// that already runs a live feed — and this repo has an incident for exactly that
// shape. The trigger is a cheap signature of the visible range plus the state's
// own identity, so a still chart costs one comparison per frame and nothing else.
//
// ⛔ AND IT REMOVES ITS OWN NODE. An indicator that is toggled off must take its
// drawings with it: `clear()` detaches the canvas and cancels the frame. A layer
// that only stopped drawing would leave the last picture frozen over the chart,
// which reads as "the indicator is still on" and is the ghost-state defect the
// binder's own release path exists to prevent.
//
// ⚠️ EVERY CHART CAPABILITY IS INJECTED, exactly as `createSeriesMarkers` is for
// C3A's markers: the container, the two coordinate functions and the frame
// scheduler. A host that cannot provide them gets no drawings and no error —
// the columns, the legend and the scan are untouched.
import { paintObjects, layoutTables } from './objectCanvas'

const noop = () => {}

/**
 * @param {object} host
 * @param {HTMLElement} host.container       the element the canvas is appended to
 * @param {()=>({timeToX:Function, priceToY:Function})} host.mapping
 * @param {(cb:Function)=>number} [host.raf]
 * @param {(id:number)=>void} [host.cancel]
 * @param {Document} [host.doc]
 */
export function createObjectLayer(host) {
  const container = host && host.container
  const mapping = host && host.mapping
  if (!container || typeof mapping !== 'function') return null
  const doc = (host.doc || (typeof document !== 'undefined' ? document : null))
  if (!doc || typeof doc.createElement !== 'function') return null
  const raf = host.raf || ((cb) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : 0))
  const cancel = host.cancel || ((id) => { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id) })

  const canvas = doc.createElement('canvas')
  canvas.style.position = 'absolute'
  canvas.style.inset = '0'
  canvas.style.pointerEvents = 'none'
  canvas.style.zIndex = '3'
  container.appendChild(canvas)

  let state = null
  let dead = false
  let frame = 0
  let lastSig = ''
  let stats = { drawn: {}, skipped: {} }
  let tables = []

  const draw = () => {
    frame = 0
    if (dead || !state) return
    const map = mapping()
    if (!map) return
    const w = Math.max(1, Math.round(map.width || container.clientWidth || 0))
    const h = Math.max(1, Math.round(map.height || container.clientHeight || 0))
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
    const ctx = canvas.getContext ? canvas.getContext('2d') : null
    if (!ctx) return
    if (ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (ctx.clearRect) ctx.clearRect(0, 0, w, h)
    stats = paintObjects(ctx, state, {
      timeToX: map.timeToX, priceToY: map.priceToY, width: w, height: h,
    })
  }

  const schedule = () => {
    // ⛔⛔ A CLEARED LAYER IS INERT, FOREVER. Without this a late `set` — and the
    // binder's release path can easily race one in — would schedule a paint onto
    // a detached canvas, or worse, re-attach a drawing for an indicator the
    // member has already switched off. Caught by `objectLayer.test.js`, which
    // sets after clearing and asserts nothing was painted.
    if (dead || frame) return
    frame = raf(draw)
  }

  return {
    /** ⭐ THE SIGNATURE IS THE WHOLE PERFORMANCE STORY. Same objects and same
     *  visible window ⇒ no repaint, however often this is called. */
    set(next, sig) {
      const signature = String(sig === undefined ? '' : sig)
      const changed = next !== state || signature !== lastSig
      state = next || null
      lastSig = signature
      tables = state ? layoutTables(state) : []
      if (changed) schedule()
      return tables
    },
    /** Force a repaint — the chart moved, the state did not. */
    invalidate: schedule,
    tables: () => tables,
    stats: () => stats,
    clear() {
      dead = true
      if (frame) { cancel(frame); frame = 0 }
      state = null
      tables = []
      lastSig = ''
      try {
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
      } catch { noop() }
    },
    /** exposed for tests and for a host that wants to position it itself */
    canvas,
  }
}
