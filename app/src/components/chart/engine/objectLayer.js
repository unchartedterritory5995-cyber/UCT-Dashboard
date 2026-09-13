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
import { renderTables, fitFactor, applyFit, TABLES_FIT } from './objectTableDom'
import { setPaneScaled } from './paneFitNotice'

const noop = () => {}

/** ⭐ THE PHONE TIER, from the one place the app defines it (`breakpoints.js`
 *  BP.phone = 640). R-R applies at this tier and no other. */
const PHONE_MAX = 640

/** Both side margins the adapter reserves — `TABLE_MARGIN` on each side. */
const TABLE_MARGIN_TOTAL = 16

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

  // ⭐⭐ R2 STEP 6 — THE TABLE LAYER IS DOM, AND IT IS A SIBLING, NOT A SECOND
  // SCHEDULE. One node, over the canvas, holding a real `<table>` per table the
  // state describes.
  //
  // ⛔ IT IS NOT DRIVEN BY `draw()` AND MUST NOT BE. A table is anchored to the
  // PANE, so panning, zooming and resizing the chart change nothing about where
  // it goes — nine CSS corners already put it there and keep it there. Hanging
  // it off the repaint loop would rebuild it sixty times a second to produce the
  // identical DOM, and the cost of that on a page already running a live feed is
  // the incident this file's own header warns about.
  const tableRoot = doc.createElement('div')
  if (tableRoot.setAttribute) {
    tableRoot.setAttribute('data-uct-table-layer', String((host.instanceId) || '1'))
    tableRoot.setAttribute('data-uct-tables-drawn', '')
  }
  tableRoot.style.position = 'absolute'
  // ⛔⛔ THE INSET IS THE HOST'S CHROME, AND ONLY THE TABLE LAYER GETS IT. Lines,
  // labels and boxes live in price/time and must keep the canvas's exact
  // coordinate space; a table is anchored to a CORNER, and the corner a member
  // means is the one they can SEE. On this chart a drawing toolbar floats over
  // the container's top 30px at `z-index: 5`, so `top_left` and `top_right`
  // landed underneath it — drawn, correct, and invisible.
  // ⭐ The HOST supplies the number (`ChartToolbar.CHART_TOOLBAR_FOOTPRINT_PX`)
  // because the host owns the chrome; the adapter still measures nothing.
  const ins = (host && host.insets) || {}
  const px = (v) => `${Math.max(0, Math.round(Number(v) || 0))}px`
  tableRoot.style.top = px(ins.top)
  tableRoot.style.right = px(ins.right)
  tableRoot.style.bottom = px(ins.bottom)
  tableRoot.style.left = px(ins.left)
  tableRoot.style.pointerEvents = 'none'
  // ⭐ ABOVE THE CANVAS. The z-order manifest's rule is that a plot can never
  // appear on top of a table; the drawings layer is `3`, so the dashboard is `4`.
  tableRoot.style.zIndex = '4'
  container.appendChild(tableRoot)

  let state = null
  let dead = false
  let frame = 0
  let lastSig = ''
  let stats = { drawn: {}, skipped: {} }
  let tables = []
  let tableStats = { tables: 0, cells: 0, skipped: 0 }
  let lastRightInset = null

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
    // ⭐⭐ THE RIGHT INSET TRACKS THE PRICE SCALE, WHICH IS NOT A CONSTANT.
    // LWC sizes the scale to the widest label in view, so it moves with the
    // symbol and the zoom. The host reports it with the rest of the mapping;
    // this applies it to the TABLE layer only — the canvas keeps the chart's
    // exact coordinate space, because a line at a price must still land on that
    // price even where the scale covers it.
    // ⛔ WRITTEN ONLY WHEN IT CHANGES. This runs inside the repaint loop, and an
    // unconditional style write on every frame is the background cost this
    // file's own header exists to prevent.
    const wantRight = Math.max(0, Math.round(Number(map.rightInset) || 0)
      + Math.round(Number((host.insets || {}).right) || 0))
    if (wantRight !== lastRightInset) {
      lastRightInset = wantRight
      tableRoot.style.right = `${wantRight}px`
    }
    // ⭐⭐ R-R — FIT THE TABLES TO THE PLOT, PHONE TIER ONLY.
    //
    // ⛔ THE TIER IS THE BREAKPOINT, NOT THE PLOT WIDTH. A narrow WIDGET on a
    // desktop is not a phone, and scaling an author's text there would be a
    // change nobody asked for; the ruling says phone only and `BP.phone` is the
    // one place that number lives.
    // ⛔ AND IT MEASURES ONLY WHAT IT MUST. `scrollWidth` is the table's natural
    // width — what it WANTS — which cannot be derived from the model, so it is
    // read here in the layer rather than in the adapter, whose freedom from
    // measurement is what keeps a resize free.
    // ⛔ A NODE THAT CANNOT BE QUERIED CANNOT BE MEASURED, AND SAYS SO BY DOING
    // NOTHING. Every real browser document has `querySelectorAll`; a hand-rolled
    // host stub does not, and the honest answer there is "no measurement", not a
    // `scaled: false` that would publish a claim about a viewport nobody read.
    // ⚠️ Deliberately NOT a `typeof document` check — the layer is handed its
    // document by the host and must ask THAT node, not a global.
    const plotWidth = Math.max(0, w - wantRight - TABLE_MARGIN_TOTAL)
    const isPhone = (typeof window !== 'undefined' ? window.innerWidth : w) <= PHONE_MAX
    const els = typeof tableRoot.querySelectorAll === 'function'
      ? [...tableRoot.querySelectorAll('[data-uct-object-table]')]
      : []
    if (els.length) {
      // ⚠️ MEASURED UNSCALED. `scrollWidth` on an already-scaled table reports the
      // scaled width, so a second pass would compound the factor into nothing.
      for (const el of els) el.style.transform = ''
      const needed = els.map((el) => el.scrollWidth)
      const fit = isPhone
        ? fitFactor({ neededWidths: needed, plotWidth, floorPx: TABLES_FIT.floorPx })
        : { factor: 1, wrap: false, scaled: false, widest: 0 }
      applyFit(tableRoot, fit)
      tableRoot.setAttribute('data-uct-tables-fit',
        fit.scaled ? `${fit.factor.toFixed(3)}${fit.wrap ? ':wrap' : ''}` : 'none')
      setPaneScaled(String((host.instanceId) || '1'), !!fit.scaled)
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
      // ⛔ REBUILT ON STATE, AND ONLY ON STATE — including the state going away,
      // which is what takes a switched-off indicator's dashboard off the pane.
      // A layer that stopped updating but left its last table there reads as
      // "the indicator is still on", the ghost-state defect `clear()` exists for.
      tableStats = renderTables(tableRoot, tables, doc)
      if (tableRoot.setAttribute) {
        tableRoot.setAttribute('data-uct-tables-drawn', JSON.stringify(tableStats))
      }
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
        // ⛔ HOW MANY OF THE DOCUMENT'S NODES THE OBJECT LANE COULD NOT EVALUATE.
        // Non-zero means every value that depends on one of them reaches a cell
        // as `NaN`, and the reason is the ENGINE'S refusal rather than the
        // script's `na` — two facts a member cannot tell apart on the pane.
        canvas.setAttribute('data-uct-objects-unreadable',
          String(meta.unreadableNodes === undefined ? '' : meta.unreadableNodes))
        // ⛔⛔ R-Q — AND THE GUARD THAT REFUSED, ON THE DOM. A count told an
        // observer that something was `NaN`; the guard tells them WHICH work it
        // is. `interpret:steps` is a ceiling to derive, `interpret:bind-time-text`
        // is a wire to thread, and a member cannot tell those apart from a cell.
        canvas.setAttribute('data-uct-object-tf', String(meta.boundTf === undefined ? '' : meta.boundTf))
        canvas.setAttribute('data-uct-objects-unreadable-guards',
          (meta.unreadableGuards || []).join(','))
        if (meta.unreadableWhy) {
          canvas.setAttribute('data-uct-objects-unreadable-why',
            String(meta.unreadableWhy).slice(0, 240))
        }
      }
      if (changed) schedule()
      return tables
    },
    /** Force a repaint — the chart moved, the state did not.
     *  ⭐ The table layer needs this too: the price scale's width changes with
     *  the zoom, and the right inset is read in `draw()`. */
    invalidate: schedule,
    tables: () => tables,
    stats: () => stats,
    tableStats: () => tableStats,
    clear() {
      dead = true
      if (frame) { cancel(frame); frame = 0 }
      state = null
      tables = []
      lastSig = ''
      tableStats = { tables: 0, cells: 0, skipped: 0 }
      // ⛔ AND THE NOTICE GOES WITH IT. A disclosure about scaling that outlived
      // the pane it described would be a sentence about nothing on screen.
      setPaneScaled(String((host.instanceId) || '1'), false)
      try {
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
      } catch { noop() }
      // ⛔ BOTH NODES, OR THE DASHBOARD OUTLIVES THE INDICATOR. The canvas
      // going while the `<table>` stayed would leave the numbers frozen on the
      // pane with nothing left to update them — worse than the frozen raster
      // this path was written for, because a crisp stale number reads as live.
      try {
        if (tableRoot.parentNode) tableRoot.parentNode.removeChild(tableRoot)
      } catch { noop() }
    },
    /** exposed for tests and for a host that wants to position them itself */
    canvas,
    tableRoot,
  }
}
