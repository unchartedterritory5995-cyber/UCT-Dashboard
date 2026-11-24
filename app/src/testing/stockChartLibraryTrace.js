// THE REAL STOCKCHART ON THE REAL LIBRARY, RECORDED (2026-11-24).
//
// For `vi.mock('lightweight-charts', async () => recordingLibrary(S))` in a test that mounts StockChart: the library is
// the production build through the build's own edits (what members run; chartLibraryBuilds.js), sized 900 x 500 (jsdom
// has no ResizeObserver, so an `autoSize` chart stays 0 wide and every geometry read degenerates), and a thin layer
// under the render window records into `S.calls` every series the chart creates, every row it hands each one, every
// removal, and every frame it sets (with the function names of the code that set it). `S` is a `vi.hoisted` object:
// `{ calls: [], n: 0, ids: new Map(), live: new Map(), chart: null }`.
import { loadChartLibraryBuilds, stubCanvasForChartLibrary, libraryWorkCounter } from './chartLibraryBuilds'

/** The function names on the stack above the caller (outside the library), newest first. */
export function stackNames(n = 7) {
  return String(new Error().stack).split('\n').slice(2)
    .map((l) => /at (?:Object\.|Proxy\.)?([\w$.]+)/.exec(l)?.[1])
    .filter((x) => x && !/^(?:stackNames|s\.setData|ts\.setVisibleLogicalRange|Array|Map|new)$/.test(x))
    .slice(0, n).join('<')
}

// what each row is to the library: its time, and whether it is a bar ('c'), a value ('v') or whitespace ('w')
const slim = (rows) => (Array.isArray(rows) ? rows.map((r) => [r?.time,
  r && (r.open !== undefined || r.close !== undefined) ? 'c' : r && r.value !== undefined ? 'v' : 'w']) : [])

/** The module `lightweight-charts` resolves to: the patched production build, whose charts record into `S`. */
export async function recordingLibrary(S) {
  stubCanvasForChartLibrary()
  const lib = (await loadChartLibraryBuilds()).patched
  const kindOf = (def) => (def === lib.CandlestickSeries ? 'candle' : def === lib.HistogramSeries ? 'histogram'
    : def === lib.LineSeries ? 'line' : def === lib.AreaSeries ? 'area' : def === lib.BarSeries ? 'bar'
      : def === lib.BaselineSeries ? 'baseline' : 'other')
  const recorded = (s, kind, options, pane) => {
    const id = ++S.n
    S.ids.set(s, id)
    S.live.set(id, { s, kind })
    S.calls.push({ m: 'add', id, kind, pane: Number.isInteger(pane) ? pane : 0, scale: options?.priceScaleId ?? null })
    const setData = s.setData.bind(s)
    const update = s.update.bind(s)
    s.setData = (d) => {
      S.calls.push({ m: 'setData', id, rows: slim(d), from: kind === 'candle' ? stackNames() : null })
      return setData(d)
    }
    s.update = (p, hist) => { S.calls.push({ m: 'update', id, rows: slim([p]), hist: !!hist }); return update(p, hist) }
    return s
  }
  const createChart = (el, options) => {
    const chart = lib.createChart(el, { ...(options || {}), autoSize: false, width: 900, height: 500 })
    S.chart = chart
    const addSeries = chart.addSeries.bind(chart)
    const addCustomSeries = chart.addCustomSeries.bind(chart)
    const removeSeries = chart.removeSeries.bind(chart)
    chart.addSeries = (def, opts, pane) => recorded(addSeries(def, opts, pane), kindOf(def), opts, pane)
    chart.addCustomSeries = (view, opts, pane) => recorded(addCustomSeries(view, opts, pane), 'custom', opts, pane)
    chart.removeSeries = (s) => {
      const id = S.ids.get(s)
      S.calls.push({ m: 'remove', id })
      S.live.delete(id)
      return removeSeries(s)
    }
    const ts = chart.timeScale()
    const setRange = ts.setVisibleLogicalRange.bind(ts)
    ts.setVisibleLogicalRange = (r) => {
      S.calls.push({ m: 'frame', range: r ? [r.from, r.to] : null, from: stackNames(4) })
      return setRange(r)
    }
    return chart
  }
  return { ...lib, createChart }
}

/**
 * A canvas whose every call (method and arguments, numbers to 1e-4 of a pixel) and every property it is given
 * (colours, fonts, line widths) is recorded while a recording is on: two charts' drawings compare call for call.
 * Installed over `HTMLCanvasElement.prototype.getContext` (the library asks for the context on every paint).
 */
export function installRecordingCanvas(width = 900, height = 500) {
  let log = null
  const r4 = (x) => (typeof x === 'number' ? Math.round(x * 1e4) / 1e4 : typeof x === 'string' ? x : x == null ? x : '[obj]')
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'canvas') return { width, height }
      if (k === 'measureText') return (s) => ({ width: String(s).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) })
      return (...a) => { if (log) log.push(`${String(k)}(${a.map(r4).join(',')})`) }
    },
    set: (_t, k, v) => { if (log) log.push(`${String(k)}=${r4(v)}`); return true },
  })
  HTMLCanvasElement.prototype.getContext = () => ctx
  Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get() { return width }, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { get() { return height }, configurable: true })
  return {
    r4,
    /** Every canvas call of one full redraw of a library chart: an options call invalidates everything, and the
     *  screenshot paints what is pending into the chart's own canvases (panes, both axes) before it copies them. */
    drawingOf(chart) {
      chart.applyOptions({})
      const out = []
      log = out
      try { chart.takeScreenshot() } finally { log = null }
      return out
    },
  }
}

/**
 * What the library holds and shows now (the raw chart the chart last created): every live series' rows as the
 * library holds them, the price range its scale shows, and the visible logical and time ranges. A string, to compare.
 */
export function libraryState(S) {
  const chart = S.chart
  if (!chart) return 'no chart'
  const ts = chart.timeScale()
  const series = [...S.live.entries()].map(([id, { s, kind }]) => {
    let scale = null
    try { scale = s.priceScale().getVisibleRange() } catch { scale = 'n/a' }
    return { id, kind, rows: s.data(), scale }
  })
  return JSON.stringify({ range: ts.getVisibleLogicalRange(), times: ts.getVisibleRange(), series })
}

/**
 * Replay recorded calls on a real chart of `lib`; per `mark`: setData calls, FULL updates (calls that changed the
 * library's time points), rebuild sorts measured, and the list of what happened.
 */
export function replayLibraryWork(lib, calls) {
  stubCanvasForChartLibrary()
  const el = document.createElement('div')
  document.body.appendChild(el)
  const chart = lib.createChart(el, { width: 900, height: 500 })
  const DEF = { candle: lib.CandlestickSeries, bar: lib.BarSeries, line: lib.LineSeries, area: lib.AreaSeries,
    baseline: lib.BaselineSeries, histogram: lib.HistogramSeries, custom: lib.HistogramSeries, other: lib.LineSeries }
  const series = new Map()
  const kinds = new Map()
  const counter = libraryWorkCounter()
  const steps = []
  let step = null
  const rowFor = (kind, [time, flag]) => {
    if (flag === 'w') return { time }
    return kind === 'candle' || kind === 'bar' ? { time, open: 10, high: 11, low: 9, close: 10.5 } : { time, value: 1 }
  }
  counter.counted(() => {
    for (const c of calls) {
      if (c.m === 'mark') { step = { label: c.label, calls: 0, updates: 0, full: 0, sorts0: counter.sorts, sorts: 0, log: [], threw: 0 }; steps.push(step); continue }
      if (c.m === 'frame') { step?.log.push(`frame ${c.range ? c.range.map(Math.round).join('..') : null} from ${c.from}`); continue }
      if (c.m === 'add') {
        series.set(c.id, chart.addSeries(DEF[c.kind] || lib.LineSeries, c.scale != null ? { priceScaleId: c.scale } : {}, c.pane))
        kinds.set(c.id, c.kind)
        continue
      }
      const s = series.get(c.id)
      if (!s) continue
      const before = counter.sorts
      try {
        if (c.m === 'setData') {
          s.setData(c.rows.map((r) => rowFor(kinds.get(c.id), r)))
          const changed = counter.setData(c.id, c.rows.map((r) => r[0]))
          if (step) {
            step.calls += 1
            if (changed) step.full += 1
            step.log.push(`${kinds.get(c.id)}#${c.id}:${c.rows.length}${changed ? ' FULL' : ''} s${counter.sorts - before}${c.from ? ` from ${c.from}` : ''}`)
          }
        } else if (c.m === 'update') {
          s.update(rowFor(kinds.get(c.id), c.rows[0]), c.hist)
          const changed = counter.update(c.id, c.rows[0][0])
          if (step) { step.updates += 1; if (changed) step.full += 1 }
        } else if (c.m === 'remove') {
          chart.removeSeries(s)
          series.delete(c.id)
          if (counter.remove(c.id) && step) step.full += 1
          step?.log.push(`remove ${kinds.get(c.id)}#${c.id}`)
        }
      } catch { if (step) step.threw += 1 }
      if (step) step.sorts = counter.sorts - step.sorts0
    }
  })
  chart.remove()
  el.remove()
  return steps.map(({ sorts0, ...rest }) => rest)
}
