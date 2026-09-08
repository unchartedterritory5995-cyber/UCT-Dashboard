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
  // ⭐⭐ C3B-CLOSE — THE PRODUCT'S OWN ANSWER TO "DID IT PAINT".
  //
  // ⛔ A CANVAS COUNT CANNOT SAY YES. The C0 journey already learned this the
  // hard way: `querySelectorAll('canvas').length` read 75 before an import and
  // 75 after, because the workspace owns every one of them — a gate that cannot
  // fail. So the layer stamps what the PAINTER returned, after each paint, and
  // an observer can read three independent facts off the DOM:
  //   * this canvas belongs to an object layer, and to WHICH instance;
  //   * how many objects of each family the painter DREW;
  //   * how many it SKIPPED for a coordinate it could not place.
  // ⚠️ Even that is our own counter. The strongest evidence is the canvas's own
  // PIXELS, which an observer can read directly — this attribute exists so the
  // observer can find the right canvas, not so it can be believed instead.
  if (canvas.setAttribute) {
    canvas.setAttribute('data-uct-object-layer', String((host.instanceId) || '1'))
    canvas.setAttribute('data-uct-objects-drawn', '')
  }
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
    if (canvas.setAttribute) {
      const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0)
      canvas.setAttribute('data-uct-objects-drawn',
        `${sum(stats.drawn)}:${JSON.stringify(stats.drawn)}`)
      canvas.setAttribute('data-uct-objects-skipped',
        `${sum(stats.skipped)}:${JSON.stringify(stats.skipped)}`)
      canvas.setAttribute('data-uct-objects-tables', String(tables.length))
      canvas.setAttribute('data-uct-objects-bbox', JSON.stringify(stats.bbox || null))
      canvas.setAttribute('data-uct-objects-pane', `${w}x${h}@${dpr}`)
      // ⛔ THE RAW COORDINATE BESIDE THE MAPPED ONE. "we drew off-screen" has two
      // possible causes — the object's coordinate is wrong, or the mapping is —
      // and only showing both can tell them apart.
      const probe = (state.lines || [])[0] || (state.labels || [])[0] || (state.boxes || [])[0]
      if (probe) {
        const rx = probe.x1 !== undefined ? probe.x1 : probe.x !== undefined ? probe.x : probe.left
        canvas.setAttribute('data-uct-objects-probe',
          JSON.stringify({ rawX: rx, mappedX: map.timeToX(rx), rawY: probe.y1 !== undefined ? probe.y1 : probe.y }))
      }
    }
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
    set(next, sig, meta) {
      const signature = String(sig === undefined ? '' : sig)
      const changed = next !== state || signature !== lastSig
      state = next || null
      lastSig = signature
      tables = state ? layoutTables(state) : []
      // ⭐⭐ THE LIFECYCLE FACTS THE ENGINE ALREADY COMPUTED, MADE OBSERVABLE.
      // ⛔ THE IDS ARE THE IDENTITY DISCRIMINATOR. Object ids are a creation
      // counter, so a renderer that quietly re-created an object on every update
      // would show ids in the thousands where a correct one shows single digits.
      // That is a fact a screenshot cannot carry and a canvas count cannot see.
      if (canvas.setAttribute && meta) {
        canvas.setAttribute('data-uct-object-ids',
          (state && state.lines ? [] : []).concat(meta.liveIds || []).join(','))
        canvas.setAttribute('data-uct-object-stats', JSON.stringify(meta.stats || {}))
        canvas.setAttribute('data-uct-object-bars', (meta.createdBars || []).join(','))
      }
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
