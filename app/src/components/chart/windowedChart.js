// ONE RENDER WINDOW FOR EVERY SERIES, BEHIND A FACADE (2026-11-20, owner: "I NEED THEM ALL BELOW 20MS").
//
// Measured (lightweight-charts as the app ships it, real Chromium, candles + volume + 4 lines): a symbol switch
// handing the library 45,000 bars costs 132 ms of setData and 218 ms to the next frame; 12,000 bars 29-41 / 58-70;
// 1,500 bars 2-3 ms and the next frame. A chart only ever shows a few hundred bars at a time, so the library is
// handed a WINDOW: the bars from a start `ws` onward, a few screens deeper than the view, extended leftwards (in
// the same frame, before paint) whenever the view comes near its start.
//
// The library numbers its logical indices from the earliest time it holds, so with a window its logical index L
// is the full-history index i minus ws. ~100 places in the chart and its overlays speak full-history indices
// (framing, view locks, date navigation, drawings, lookups). Instead of converting each, this facade sits between
// the app and the library and translates at that boundary: the app keeps speaking full indices, stored values stay
// valid across an extension, and anything that asks for a view left of the window extends it first.
//
//   createWindowedChart(rawChart, opts) -> a Proxy over the library chart:
//     timeScale(): logical ranges / coordinates / subscriptions translated (+-ws); setVisibleLogicalRange and
//       setVisibleRange extend the window first when they reach left of it; timeToCoordinate falls back to the
//       index of a time older than the window.
//     addSeries(): a wrapped series. setData(full) keeps `full` and hands the library the cut (the PRIMARY series,
//       the candles, by index; every other series by time from the window start, so no series ever holds a time
//       older than the candles' window: the library's logical 0 is the earliest time of ANY series). update()
//       passes through and remembers the live tail (re-applied after an extension). dataByIndex(i) translates;
//       data() returns the full rows. attachPrimitive hands primitives the facade chart and the wrapped series.
//     subscribeCrosshairMove / Click / DblClick: param.logical +ws, seriesData keys and hoveredSeries are the
//       wrapped series.
//   The window is OFF (a pure pass-through, ws 0) until `setWindow(rows)` turns it on for a load, and whenever
//   `setWindow(null)` says the view needs every bar (compare, replay, pinned ranges).
//
// Switch: localStorage `uct.renderwindow.off` = '1' keeps every bar (the library sees the whole history, as before).

export const RENDER_WINDOW_OFF_KEY = 'uct.renderwindow.off'
/** The window holds at least this many bars ... */
export const RENDER_WINDOW_MIN_BARS = 600
/** ... or this many screens of the view the load opened at. */
export const RENDER_WINDOW_SCREENS = 3
/** The window start is a multiple of this (appended live bars never move it). */
export const RENDER_WINDOW_STEP = 250
/** With fewer bars than this to leave out, the library gets every bar. */
export const RENDER_WINDOW_MIN_SAVED = 1000
/** The view's left edge must stay at least this many bars (and one screen) right of the window start. */
export const RENDER_WINDOW_MARGIN_BARS = 150

export function renderWindowDisabled() {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(RENDER_WINDOW_OFF_KEY) === '1' } catch { return false }
}

/** How many bars a load's window holds, from the view it opens at: `span` bars across, its left edge `left` bars
 *  back from the newest (unknown reads as 0). */
export function renderWindowRows(span, left) {
  const s = Number.isFinite(span) && span > 0 ? span : 0
  const l = Number.isFinite(left) && left > 0 ? left : 0
  return Math.max(RENDER_WINDOW_MIN_BARS, Math.ceil(s * RENDER_WINDOW_SCREENS), Math.ceil(l + Math.max(s, RENDER_WINDOW_MARGIN_BARS)) + 1)
}

/** The first full index of a window of `rows` over `n` bars: step-aligned, 0 when the saving is small. */
export function renderWindowStart(n, rows) {
  if (!(n > 0) || !(rows > 0)) return 0
  const raw = Math.floor(n) - Math.floor(rows)
  if (raw < RENDER_WINDOW_MIN_SAVED) return 0
  return Math.floor(raw / RENDER_WINDOW_STEP) * RENDER_WINDOW_STEP
}

/** The start a view whose left edge is at full index `from`, `span` bars wide, needs (never right of `ws`). */
export function extendedStart(ws, from, span) {
  if (!(ws > 0) || !Number.isFinite(from)) return ws
  const s = Number.isFinite(span) && span > 0 ? span : 0
  if (from - Math.max(s, RENDER_WINDOW_MARGIN_BARS) >= ws) return ws
  const want = Math.max(0, Math.floor(from) - Math.max(2 * s, RENDER_WINDOW_MIN_BARS))
  const next = Math.floor(want / RENDER_WINDOW_STEP) * RENDER_WINDOW_STEP
  return next < ws ? next : ws
}

// -1 / 0 / 1, or null when the two cannot be ordered (different kinds of time).
function cmpTime(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0
  if (a && b && typeof a === 'object' && typeof b === 'object' && Number.isFinite(a.year) && Number.isFinite(b.year)) {
    return (a.year - b.year) || (a.month - b.month) || (a.day - b.day) || 0
  }
  return null
}
/** First index of `rows` whose time is >= `t` (rows in time order); null when times cannot be compared. */
function firstAtOrAfter(rows, t) {
  let lo = 0
  let hi = rows.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const c = cmpTime(rows[mid]?.time, t)
    if (c === null) return null
    if (c < 0) lo = mid + 1
    else hi = mid
  }
  return lo
}

const RAW = Symbol('raw')
const WINDOW_CTL = Symbol('windowControl')
/**
 * ⭐ (2026-11-23, next-row chart walks, item ii) A facade series' `[SET_DATA_PAINTED](rows, paint)`: `setData(rows)`, but
 * the library is handed `paint(rows, from)` (rows `from..end`, transformed) instead of the cut `rows.slice(from)`, on
 * this setData and on every re-cut after it (an extension left, a consistency re-cut), until the next setData. So a
 * per-row transform (the candles' net-change colours, chart/netChangePaint.js) runs on the rows the library is handed,
 * not on every row: `paint(rows, from)` must equal `transformAll(rows).slice(from)`. `data()` keeps the rows as given.
 * A plain `setData` drops the paint. Absent on the pass-through (window off): there `setData` takes every row.
 */
export const SET_DATA_PAINTED = Symbol('setDataPainted')
/** The library object behind a facade object (or the object itself). */
export function rawOf(x) { return (x && x[RAW]) || x }

function passThrough(chart) {
  const inert = {
    setWindow() {}, windowStart: () => 0, windowStartTime: () => null, ensureFrom() {}, raw: () => chart,
    onChange: () => () => {}, setPrimary() {},
  }
  try { Object.defineProperty(chart, 'window', { value: inert, configurable: true }) } catch { /* frozen double */ }
  return chart
}

/**
 * @param {object} chart  the library chart (createChart)
 * @param {object} [o]
 * @param {() => boolean} [o.disabled]   the per-browser switch (default: localStorage)
 */
export function createWindowedChart(chart, { disabled = renderWindowDisabled } = {}) {
  // ⛔ OFF MEANS OFF: switched off in this browser, the app gets the library chart ITSELF (every series, pane and
  // callback object exactly as before), with an inert control so callers need no branch. A rollback that still
  // wrapped would still change object identity, which is what a rollback is for ruling out.
  if (disabled()) return passThrough(chart)
  const st = {
    ws: 0,               // the window's first full index (of the primary series)
    wsTime: null,        // its time: every other series is cut from here
    wanted: null,        // rows the load asked for (null: no window)
    span: 0,             // bars across the view, for extensions
    extending: false,
    placePending: false, // a new load: the next primary setData places the window
    checkQueued: false,
  }
  /** wrapped series -> { raw, full, tail: Map(time -> item), primary } */
  const series = new Map()
  const byRaw = new Map()
  let primary = null

  const on = () => st.wanted != null && !disabled()

  function cutFor(w, rows) {
    if (!Array.isArray(rows) || !rows.length) return rows
    const paint = series.get(w)?.paint || null   // (SET_DATA_PAINTED: the rows handed over, transformed)
    let from = 0
    if (w === primary) from = st.ws > 0 ? st.ws : 0
    else if (st.wsTime != null) {
      const k = firstAtOrAfter(rows, st.wsTime)
      from = k == null ? 0 : k
    }
    if (paint) return paint(rows, from)
    return from > 0 ? rows.slice(from) : rows
  }
  function applyOne(w) {
    const rec = series.get(w)
    if (!rec || !rec.full) return
    const cut = cutFor(w, rec.full)
    rec.cutFirst = cut && cut.length ? cut[0].time : null
    rec.set(cut)
    // the live forming bar(s) after a re-set: what update() planted since the last setData
    for (const item of rec.tail.values()) { try { rec.upd(item) } catch { /* an older item */ } }
  }
  /** Place ws / wsTime on the primary's full rows: a forced start (an extension), a new load's rows, or (the
   *  same load: appended or prepended bars) the index of the start TIME, so live bars never move it. */
  function placeWindow(forcedWs = null) {
    const full = primary ? series.get(primary)?.full : null
    if (!on() || !full || !full.length) { st.ws = 0; st.wsTime = null; st.placePending = false; return }
    if (forcedWs == null && !st.placePending && st.wsTime != null) {
      // the same load: the start TIME is the anchor. An array that starts after it (a session-filtered copy set
      // on the candles beside the whole one) is drawn whole, and the anchor stays for the next array.
      st.ws = Math.max(0, Math.min(firstAtOrAfter(full, st.wsTime) ?? 0, full.length - 1))
      return
    }
    const ws = forcedWs != null ? forcedWs : renderWindowStart(full.length, st.wanted)
    st.placePending = false
    st.ws = Math.max(0, Math.min(ws, full.length - 1))
    st.wsTime = st.ws > 0 ? full[st.ws].time : null
  }
  /** After a pass that moved the window: any other series still holding a time older than its start (one the
   *  pass did not re-set) is re-cut, so no series can widen the library's time scale past the candles. */
  function queueConsistency() {
    if (st.checkQueued) return
    st.checkQueued = true
    queueMicrotask(() => {
      st.checkQueued = false
      if (st.wsTime == null) return
      for (const [w, rec] of series) {
        if (w === primary || !rec.full || !rec.full.length) continue
        if (cmpTime(rec.cutFirst, st.wsTime) === -1) applyOne(w)
      }
    })
  }
  /** Listeners of a window change (its start moved): window-aware markers re-hand their list. */
  const changeSubs = new Set()
  function fireChange() { for (const cb of [...changeSubs]) { try { cb() } catch { /* a listener */ } } }
  /** Move the window start left to `newWs` (full index): every series re-set, primary first. */
  function extendTo(newWs) {
    if (st.extending || !(newWs < st.ws)) return false
    st.extending = true
    try {
      placeWindow(newWs)
      if (primary) applyOne(primary)
      for (const w of series.keys()) if (w !== primary) applyOne(w)
    } finally { st.extending = false }
    fireChange()
    return true
  }
  /** Make sure full index `from` (and a screen before it) is inside the window. */
  function ensureFrom(from, span = st.span) {
    if (!(st.ws > 0)) return
    const next = extendedStart(st.ws, from, span)
    if (next < st.ws) extendTo(next)
  }

  const ts = () => chart.timeScale()
  const handlers = new Map()   // app handler -> library handler
  const plus = (r) => (r ? { ...r, from: r.from + st.ws, to: r.to + st.ws } : r)
  function primaryIndexOfTime(t) {
    const full = primary ? series.get(primary)?.full : null
    if (!full || !full.length) return null
    const k = firstAtOrAfter(full, t)
    if (k == null || k >= full.length) return null
    return cmpTime(full[k].time, t) === 0 ? k : null
  }

  const tsOwn = Object.create(null)
  const timeScaleFacade = new Proxy({}, {
    set(_t, prop, value) { tsOwn[prop] = value; return true },
    get(_t, prop) {
      if (prop in tsOwn) return tsOwn[prop]
      const raw = ts()
      // ⛔ A METHOD THE OBJECT DOES NOT HAVE, THE FACADE DOES NOT HAVE EITHER. Code feature-tests before it calls
      // (`typeof s.getPane === 'function'`); a translated stand-in for a missing method passes that test and then
      // throws (found by the time-range-sync and replay suites, whose library doubles have no panes).
      if (typeof prop === 'string' && raw[prop] === undefined) return undefined
      switch (prop) {
        case RAW: return raw
        case 'getVisibleLogicalRange': return () => plus(raw.getVisibleLogicalRange())
        case 'setVisibleLogicalRange': return (r) => {
          if (r && Number.isFinite(r.from)) ensureFrom(r.from, Number.isFinite(r.to) ? r.to - r.from : st.span)
          return raw.setVisibleLogicalRange(r ? { ...r, from: r.from - st.ws, to: r.to - st.ws } : r)
        }
        case 'subscribeVisibleLogicalRangeChange': return (h) => {
          const lib = (r) => h(plus(r))
          handlers.set(h, lib)
          return raw.subscribeVisibleLogicalRangeChange(lib)
        }
        case 'unsubscribeVisibleLogicalRangeChange': return (h) => {
          const lib = handlers.get(h) || h
          handlers.delete(h)
          return raw.unsubscribeVisibleLogicalRangeChange(lib)
        }
        case 'logicalToCoordinate': return (i) => raw.logicalToCoordinate(i - st.ws)
        case 'coordinateToLogical': return (x) => { const l = raw.coordinateToLogical(x); return l == null ? l : l + st.ws }
        case 'setVisibleRange': return (r) => {
          if (r && st.wsTime != null && cmpTime(r.from, st.wsTime) === -1) {
            const k = primaryIndexOfTime(r.from) ?? firstAtOrAfter(series.get(primary)?.full || [], r.from)
            if (k != null) ensureFrom(k, st.span)
          }
          return raw.setVisibleRange(r)
        }
        case 'timeToIndex': return (t, findNearest) => {
          const k = raw.timeToIndex(t, findNearest)
          if (st.wsTime != null && cmpTime(t, st.wsTime) === -1) {
            // older than the window: its full-history index (exact, or the nearest bar when asked)
            const full = primary ? series.get(primary)?.full : null
            if (!full) return k
            const j = firstAtOrAfter(full, t)
            if (j == null) return k
            if (j < full.length && cmpTime(full[j].time, t) === 0) return j
            return findNearest ? Math.max(0, j - 1) : null
          }
          return k == null ? k : k + st.ws
        }
        case 'timeToCoordinate': return (t) => {
          const x = raw.timeToCoordinate(t)
          if (x != null || st.wsTime == null || cmpTime(t, st.wsTime) !== -1) return x
          const i = primaryIndexOfTime(t)
          return i == null ? x : raw.logicalToCoordinate(i - st.ws)
        }
        default: {
          const v = raw[prop]
          return typeof v === 'function' ? v.bind(raw) : v
        }
      }
    },
  })

  // ⛔ A PANE ANSWERS WITH THE APP'S SERIES. The library's `pane.getSeries()` returns its own series objects; the app
  // keys its maps by the wrapped ones (paneLayout's byPane, the readout placement), so a raw answer would match
  // nothing. One proxy per library pane, so a pane read twice is the same object.
  const paneProxies = new WeakMap()
  function wrapPane(p) {
    if (!p || typeof p !== 'object') return p
    let w = paneProxies.get(p)
    if (!w) {
      w = new Proxy(p, {
        get(target, prop) {
          if (prop === RAW) return target
          if (typeof prop === 'string' && target[prop] === undefined) return undefined
          if (prop === 'getSeries') return () => (target.getSeries() || []).map((s) => byRaw.get(s) || s)
          const v = target[prop]
          return typeof v === 'function' ? v.bind(target) : v
        },
      })
      paneProxies.set(p, w)
    }
    return w
  }

  function wrapPrimitive(p) {
    if (!p || typeof p.attached !== 'function' || p.__wcWrapped) return p
    const orig = p.attached.bind(p)
    p.attached = (param) => orig({ ...param, chart: facade, series: param?.series ? (byRaw.get(param.series) || param.series) : param?.series })
    p.__wcWrapped = true
    return p
  }

  function wrapSeries(raw, isPrimary) {
    const rec = { raw, full: null, tail: new Map(), primary: isPrimary, paint: null }
    // ⛔ THE FACADE CALLS THE LIBRARY'S ORIGINAL METHODS, CAPTURED HERE. Code wraps series methods by assignment
    // (barColours' `series.setData = (d) => realSet(...)`, the volume dimmer, the price-series colouring), reading
    // the method it wraps through this facade; the assignment lands on the library series. Had the facade called
    // `target.setData` at call time, it would call that wrapper, which calls the facade, forever (found in tests:
    // the candles stayed empty, the RangeError swallowed by the chart's own try/catch). So the facade keeps the
    // originals, and a read returns an installed wrapper when there is one: the chain is always
    // wrapper(s) -> facade (the cut) -> the library's own method, whichever object the caller holds.
    const origSetData = typeof raw.setData === 'function' ? raw.setData.bind(raw) : null
    const origUpdate = typeof raw.update === 'function' ? raw.update.bind(raw) : null
    const origSetDataFn = raw.setData
    const origUpdateFn = raw.update
    rec.set = (rows) => origSetData(rows)
    rec.upd = (item, ...rest) => origUpdate(item, ...rest)
    /** The series' setData: keep `rows`, hand the library the cut (painted when `paint` is given). */
    function setFull(rows, paint) {
      rec.full = rows
      rec.paint = paint
      rec.tail.clear()
      const before = st.wsTime
      if (w === primary) placeWindow()
      const cut = cutFor(w, rows)
      rec.cutFirst = cut && cut.length ? cut[0].time : null
      rec.set(cut)
      // the window moved (a new load): the other series are normally re-set in this same pass; any that is
      // not is re-cut before the frame paints
      if (w === primary && before !== st.wsTime) { queueConsistency(); fireChange() }
    }
    const w = new Proxy(raw, {
      get(target, prop) {
        if (prop === 'setData' && target.setData !== origSetDataFn) return target.setData       // a wrapper installed
        if (prop === 'update' && target.update !== origUpdateFn) return target.update
        if (typeof prop === 'string' && target[prop] === undefined) return undefined       // see the time scale's note
        switch (prop) {
          case RAW: return target
          case WINDOW_CTL: return control
          case 'setData': return (rows) => setFull(rows, null)
          case SET_DATA_PAINTED: return (rows, paint) => setFull(rows, typeof paint === 'function' ? paint : null)
          case 'update': return (item, ...rest) => {
            const r = rec.upd(item, ...rest)
            if (item && item.time != null) {
              const full = rec.full
              const last = full && full.length ? full[full.length - 1].time : null
              if (last == null || cmpTime(item.time, last) !== -1) rec.tail.set(JSON.stringify(item.time), item)
            }
            return r
          }
          case 'dataByIndex': return (i, mismatch) => target.dataByIndex(i - st.ws, mismatch)
          case 'data': return () => {
            if (!rec.full) return target.data()
            if (!rec.tail.size) return rec.full
            const out = rec.full.slice()
            for (const item of rec.tail.values()) {
              const lastT = out.length ? out[out.length - 1].time : null
              if (lastT != null && cmpTime(item.time, lastT) === 0) out[out.length - 1] = item
              else out.push(item)
            }
            return out
          }
          case 'barsInLogicalRange': return (r) => {
            const b = target.barsInLogicalRange(r ? { ...r, from: r.from - st.ws, to: r.to - st.ws } : r)
            return b ? { ...b, barsBefore: b.barsBefore + st.ws } : b
          }
          case 'attachPrimitive': return (p, ...rest) => target.attachPrimitive(wrapPrimitive(p), ...rest)
          case 'getPane': return () => wrapPane(target.getPane())
          default: {
            const v = target[prop]
            return typeof v === 'function' ? v.bind(target) : v
          }
        }
      },
    })
    series.set(w, rec)
    byRaw.set(raw, w)
    return w
  }

  function crossParam(param) {
    if (!param) return param
    const out = { ...param }
    if (Number.isFinite(param.logical)) out.logical = param.logical + st.ws
    if (param.seriesData instanceof Map) {
      const m = new Map()
      for (const [k, v] of param.seriesData) m.set(byRaw.get(k) || k, v)
      out.seriesData = m
    }
    if (param.hoveredSeries) out.hoveredSeries = byRaw.get(param.hoveredSeries) || param.hoveredSeries
    return out
  }
  const evHandlers = { crosshair: new Map(), click: new Map(), dbl: new Map() }
  const sub = (kind, name) => (h) => { const lib = (p) => h(crossParam(p)); evHandlers[kind].set(h, lib); return chart[name](lib) }
  const unsub = (kind, name) => (h) => { const lib = evHandlers[kind].get(h) || h; evHandlers[kind].delete(h); return chart[name](lib) }

  // the extension: when the view comes near the window start, the window grows left before the frame paints
  // (checked in a microtask: after the library's own update and the app's setData pass, before the rAF paint)
  let rangeQueued = false
  const onRange = (r) => {
    if (!r || st.extending || !(st.ws > 0)) return
    st.span = Math.max(0, r.to - r.from)
    if (rangeQueued) return
    rangeQueued = true
    queueMicrotask(() => {
      rangeQueued = false
      const cur = chart.timeScale().getVisibleLogicalRange()
      if (cur && st.ws > 0) ensureFrom(cur.from + st.ws, Math.max(0, cur.to - cur.from))
    })
  }
  try { chart.timeScale().subscribeVisibleLogicalRangeChange(onRange) } catch { /* a stub chart */ }

  const control = {
    /** Turn the window on for a load: `rows` bars (renderWindowRows), or null for every bar. Re-cuts every series. */
    setWindow(rows, { span } = {}) {
      if (Number.isFinite(span) && span > 0) st.span = span
      if (!(Number.isFinite(rows) && rows > 0)) {
        // every bar: re-set what is windowed now (a compare / replay / pinned view turning on)
        st.wanted = null
        if (st.ws > 0) extendTo(0)
        st.wsTime = null
        fireChange()
        return
      }
      // a new load: the next primary setData places the window (the series are about to be re-set anyway)
      st.wanted = rows
      st.placePending = true
    },
    /** The window start (full index) and its time; 0 / null when off. */
    windowStart: () => st.ws,
    windowStartTime: () => st.wsTime,
    /** Extend the window so full index `from` (and a screen before it) is inside it. */
    ensureFrom,
    /** The library chart. */
    raw: chart,
    /** Call `cb` whenever the window start moves; returns the unsubscribe. */
    onChange(cb) { changeSubs.add(cb); return () => changeSubs.delete(cb) },
  }

  const chartOwn = Object.create(null)
  const facade = new Proxy(chart, {
    set(_target, prop, value) { chartOwn[prop] = value; return true },
    get(target, prop) {
      if (prop in chartOwn) return chartOwn[prop]
      if (typeof prop === 'string' && prop !== 'window' && target[prop] === undefined) return undefined   // see the time scale's note
      switch (prop) {
        case RAW: return target
        case 'window': return control
        case 'timeScale': return () => timeScaleFacade
        case 'addSeries': return (def, options, paneIndex) => {
          const raw = target.addSeries(def, options, paneIndex)
          const w = wrapSeries(raw, false)
          return w
        }
        // a custom series (the thin volume style) holds times too: it takes the window like any other
        case 'addCustomSeries': return (view, options, paneIndex) => wrapSeries(target.addCustomSeries(view, options, paneIndex), false)
        case 'removeSeries': return (w) => {
          const raw = rawOf(w)
          series.delete(w)
          byRaw.delete(raw)
          if (primary === w) primary = null
          return target.removeSeries(raw)
        }
        case 'panes': return () => (target.panes() || []).map(wrapPane)
        case 'setCrosshairPosition': return (price, time, s) => target.setCrosshairPosition(price, time, rawOf(s))
        case 'subscribeCrosshairMove': return sub('crosshair', 'subscribeCrosshairMove')
        case 'unsubscribeCrosshairMove': return unsub('crosshair', 'unsubscribeCrosshairMove')
        case 'subscribeClick': return sub('click', 'subscribeClick')
        case 'unsubscribeClick': return unsub('click', 'unsubscribeClick')
        case 'subscribeDblClick': return sub('dbl', 'subscribeDblClick')
        case 'unsubscribeDblClick': return unsub('dbl', 'unsubscribeDblClick')
        default: {
          const v = target[prop]
          return typeof v === 'function' ? v.bind(target) : v
        }
      }
    },
  })
  /** Name the series whose rows define the window (the candles). */
  control.setPrimary = (w) => { primary = series.has(w) ? w : null }
  return facade
}

/**
 * Series markers that respect the render window. The library's markers plugin snaps a marker older than its
 * series' first point onto that first point, so markers left of the window would pile up at its start (visible
 * once the member scrolls back and the window grows). This hands the plugin, on the LIBRARY series, only the
 * markers inside the window, and re-hands the list whenever the window moves. Same API as the plugin's
 * (setMarkers, markers, detach; anything else passes through).
 */
export function createWindowedMarkers(createSeriesMarkers, series, markers) {
  const ctl = series?.[WINDOW_CTL] || null
  let all = Array.isArray(markers) ? markers : []
  const inWindow = () => {
    const t0 = ctl?.windowStartTime?.()
    return t0 == null ? all : all.filter((m) => cmpTime(m?.time, t0) !== -1)
  }
  const inner = createSeriesMarkers(rawOf(series), inWindow())
  const off = ctl?.onChange ? ctl.onChange(() => { try { inner.setMarkers(inWindow()) } catch { /* detached */ } }) : null
  return new Proxy(inner, {
    get(target, prop) {
      if (prop === 'setMarkers') return (m) => { all = Array.isArray(m) ? m : []; return target.setMarkers(inWindow()) }
      if (prop === 'markers') return () => all
      if (prop === 'detach') return () => { off?.(); return target.detach?.() }
      const v = target[prop]
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
}
