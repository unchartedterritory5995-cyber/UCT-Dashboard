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
export function createFakeChart() {
  const calls = []
  const seriesCreated = []
  let nextId = 0

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
