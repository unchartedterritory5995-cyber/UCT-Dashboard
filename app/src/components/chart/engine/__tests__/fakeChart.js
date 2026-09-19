// app/src/components/chart/engine/__tests__/fakeChart.js
//
// ─── A RECORDING lightweight-charts double ──────────────────────────────────
//
// `StockChart.smoke.test.jsx:13-39` stubs the same surface with no-ops, which is
// exactly right for "does the component render without throwing". The binder
// needs the opposite: its whole contract is about WHICH calls it makes and which
// it does NOT (never `removeSeries` on a pane move; always `setData` on a first
// bind; `removePriceLine` for every guide it inherits). A no-op stub cannot
// express any of that, so every method here appends to one ordered log.
//
// ONE LOG, IN ORDER, ACROSS EVERY OBJECT. Order matters for real assertions —
// "the scale was re-applied AFTER the series moved panes" is a sequencing claim
// — and a per-object log throws that away.
//
// Nothing here is clever on purpose. A double with behaviour is a second
// implementation of the renderer, and then a passing test means the double
// agrees with the binder rather than the library does.

/**
 * @returns {{
 *   chart: object, LWC: object, calls: object[],
 *   callsOf: (method: string) => object[],
 *   count: (method: string) => number,
 *   methodsUsed: () => string[],
 *   seriesCreated: object[],
 *   livePriceLines: (series: object) => object[],
 *   reset: () => void,
 * }}
 */
export function createFakeChart(coords) {
  const calls = []
  const seriesCreated = []
  let nextId = 0

  // ⭐ (j) j.3 — THE TWO COORDINATE READS A SERIES PRIMITIVE NEEDS, AND THEY ARE
  // DELIBERATELY NOT RECORDED. `createFillPrimitive.draw` asks the time scale and
  // the series to turn a time and a price into pixels; without them no primitive
  // can be driven at all and a fill's DRAW half is untestable.
  //
  // ⛔ THEY APPEND NOTHING TO `calls`. Every existing assertion in this repo is
  // written against that log — "the draw-call list is byte-identical" among them —
  // and a coordinate read is a QUESTION, not one of the calls whose presence or
  // absence the binder's contract is about. Recording them would change the log
  // for every test that ever drives a primitive, which is the opposite of what a
  // control is for.
  //
  // Linear and injectable so a test can pin exact pixels: the default maps a time
  // to its index * 10 and a price to `500 - price`, both of which are invertible
  // by eye when an assertion fails.
  const timeToX = (coords && coords.timeToX) || ((t) => (Number.isFinite(t) ? t * 10 : null))
  const priceToY = (coords && coords.priceToY) || ((p) => (Number.isFinite(p) ? 500 - p : null))

  /** Every recorded call: `{on, id, method, args}`. `on` is the object KIND so a
   *  test can say "no series call of any kind happened"; `id` identifies which
   *  series (or `'chart'`). */
  const rec = (on, id, method, args, result) => {
    calls.push({ on, id, method, args, result })
    return result
  }

  function makeSeries(ctor, options, paneIndex) {
    const id = `series#${++nextId}`
    // Live price lines, so a leaked guide is observable as STATE and not only as
    // a missing `removePriceLine` call. The two are different failures: one is
    // "the binder forgot", the other is "the binder removed the wrong handle".
    const live = new Set()
    let currentPane = paneIndex

    const priceScale = {
      applyOptions: (opts) => rec('priceScale', id, 'priceScale.applyOptions', [opts]),
      width: () => 0,
    }

    const series = {
      __id: id,
      __ctor: ctor,
      __options: { ...(options || {}) },
      __live: live,
      get __pane() { return currentPane },

      setData: (data) => rec('series', id, 'setData', [data]),
      update: (point) => rec('series', id, 'update', [point]),
      applyOptions: (opts) => {
        Object.assign(series.__options, opts || {})
        return rec('series', id, 'applyOptions', [opts])
      },
      moveToPane: (i) => { currentPane = i; return rec('series', id, 'moveToPane', [i]) },
      priceScale: () => priceScale,
      createPriceLine: (opts) => {
        const handle = { __line: `${id}/line#${live.size + 1}`, options: opts }
        live.add(handle)
        return rec('series', id, 'createPriceLine', [opts], handle)
      },
      removePriceLine: (handle) => {
        live.delete(handle)
        return rec('series', id, 'removePriceLine', [handle])
      },
      setMarkers: (m) => rec('series', id, 'setMarkers', [m]),
      priceToCoordinate: (p) => priceToY(p),
      attachPrimitive: (p) => rec('series', id, 'attachPrimitive', [p]),
      detachPrimitive: (p) => rec('series', id, 'detachPrimitive', [p]),
      options: () => series.__options,
      seriesType: () => ctor && ctor.__type,
    }

    seriesCreated.push(series)
    return series
  }

  const chart = {
    addSeries: (ctor, options, paneIndex) => {
      const s = makeSeries(ctor, options, paneIndex)
      return rec('chart', 'chart', 'addSeries', [ctor, options, paneIndex], s)
    },
    removeSeries: (s) => rec('chart', 'chart', 'removeSeries', [s]),
    applyOptions: (o) => rec('chart', 'chart', 'applyOptions', [o]),
    priceScale: (id) => ({
      applyOptions: (o) => rec('priceScale', `chart:${id}`, 'priceScale.applyOptions', [o]),
      width: () => 0,
    }),
    timeScale: () => ({
      applyOptions: (o) => rec('chart', 'chart', 'timeScale.applyOptions', [o]),
      fitContent: () => rec('chart', 'chart', 'timeScale.fitContent', []),
      getVisibleLogicalRange: () => null,
      setVisibleLogicalRange: (r) => rec('chart', 'chart', 'timeScale.setVisibleLogicalRange', [r]),
      timeToCoordinate: (t) => timeToX(t),
    }),
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => null }],
    remove: () => rec('chart', 'chart', 'remove', []),
  }

  // The library's series-type tokens. Identity is all that matters — the binder
  // picks one and hands it to `addSeries` — but each carries a name so a failed
  // assertion reads "expected LineSeries, got HistogramSeries".
  const token = (name) => ({ __type: name, toString: () => name })
  const LWC = {
    LineSeries: token('LineSeries'),
    HistogramSeries: token('HistogramSeries'),
    AreaSeries: token('AreaSeries'),
    BaselineSeries: token('BaselineSeries'),
    CandlestickSeries: token('CandlestickSeries'),
    BarSeries: token('BarSeries'),
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
  }

  return {
    chart,
    LWC,
    calls,
    seriesCreated,
    callsOf: (method) => calls.filter(c => c.method === method),
    count: (method) => calls.filter(c => c.method === method).length,
    methodsUsed: () => [...new Set(calls.map(c => c.method))],
    livePriceLines: (series) => [...series.__live],
    reset: () => { calls.length = 0 },
  }
}

/**
 * ⭐⭐ (j) j.3 — A RECORDING CANVAS, BECAUSE R30 IS A CLAIM ABOUT ORDER.
 *
 * "A fill is drawn as RUNS, and `ctx.fillStyle` is set once per run" cannot be
 * checked by looking at state after the fact: one `fillStyle` assignment and
 * three leave the canvas in the SAME final state. Only the ORDERED sequence
 * distinguishes "three runs, three colours" from "three polygons in one colour",
 * and those are exactly the two things R30 separates.
 *
 * So `fillStyle` is an accessor that records every ASSIGNMENT, and every path
 * call appends to the same ordered log — the same one-log-in-order discipline
 * `createFakeChart` states for itself, for the same reason.
 *
 * ⛔ A SETTER THAT RECORDS ONLY CHANGES WOULD BEG THE QUESTION. Recording an
 * assignment only when the value differs would make "set once per run" true by
 * construction for two adjacent runs that resolve to the SAME colour — which is
 * precisely the na-gap case (`up, down, GAP, down, up`), where two separate runs
 * legitimately share a colour. Every assignment is recorded; the test decides
 * what the sequence should be.
 */
export function createRecordingCtx() {
  const ops = []
  let fillStyleValue = null
  const ctx = {
    get fillStyle() { return fillStyleValue },
    set fillStyle(v) { fillStyleValue = v; ops.push({ op: 'fillStyle', value: v }) },
    save: () => ops.push({ op: 'save' }),
    restore: () => ops.push({ op: 'restore' }),
    beginPath: () => ops.push({ op: 'beginPath' }),
    moveTo: (x, y) => ops.push({ op: 'moveTo', x, y }),
    lineTo: (x, y) => ops.push({ op: 'lineTo', x, y }),
    closePath: () => ops.push({ op: 'closePath' }),
    fill: () => ops.push({ op: 'fill' }),
  }
  /** What lightweight-charts hands a renderer's `draw`. */
  const target = { useMediaCoordinateSpace: (fn) => fn({ context: ctx }) }
  return {
    ctx,
    target,
    ops,
    /** Every `fillStyle` assignment, in order — the R30 sequence. */
    fillStyles: () => ops.filter((o) => o.op === 'fillStyle').map((o) => o.value),
    /** One entry per `beginPath`…`fill`, each the vertices in draw order. */
    polygons: () => {
      const out = []
      let cur = null
      for (const o of ops) {
        if (o.op === 'beginPath') { cur = []; continue }
        if (cur && (o.op === 'moveTo' || o.op === 'lineTo')) cur.push({ x: o.x, y: o.y })
        if (o.op === 'fill' && cur) { out.push(cur); cur = null }
      }
      return out
    },
    /** The `fillStyle` in force when each polygon was filled, in order. */
    polygonColours: () => {
      const out = []
      let style = null
      for (const o of ops) {
        if (o.op === 'fillStyle') style = o.value
        if (o.op === 'fill') out.push(style)
      }
      return out
    },
    reset: () => { ops.length = 0; fillStyleValue = null },
  }
}

/** Drive a primitive's one pane view against a recording canvas. */
export function drawPrimitive(primitive, { chart, series, recorder }) {
  primitive.attached({ chart, series, requestUpdate: () => {} })
  primitive.paneViews()[0].renderer().draw(recorder.target)
  return recorder
}

/** Bars shaped the way `indicators.js` and `computeFor` expect. Enough of them
 *  that every default period actually computes — a 10-bar fixture would make
 *  `hasAnyFinite` false and quietly bind nothing. */
export function makeBars(n = 260, startT = 1_700_000_000) {
  const bars = []
  for (let i = 0; i < n; i++) {
    const base = 100 + Math.sin(i / 7) * 8 + i * 0.05
    bars.push({
      t: startT + i * 86400,
      o: base - 0.5,
      h: base + 1.2,
      l: base - 1.4,
      c: base,
      v: 1_000_000 + (i % 13) * 25_000,
    })
  }
  return bars
}
