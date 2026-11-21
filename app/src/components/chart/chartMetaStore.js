// app/src/components/chart/chartMetaStore.js
//
// ⭐ THE CHART'S PER-SYMBOL METADATA, WITHOUT RE-RENDERING THE CHART (metadata islands, 2026-11-20).
//
// A symbol switch asks a handful of small per-symbol reads after the bars: the name / sector / exchange
// (`/api/ticker-meta`), the listing date (`/api/ticker-ipo`), the event markers (`/api/chart/markers`), the
// news and desk-mention markers when those are on, and the pane's next-earnings date. Each one used to be a
// hook inside StockChart, so each answer (and each loading-flag flip around it) re-ran the whole StockChart
// render (the heaviest component in the app) and then `updateChart`, to change a watermark line, a badge or a
// marker. Measured on master in a jsdom mount of the real chart (2026-11-20, `StockChart.metaRenders.test.jsx`,
// the owner's layout: four moving averages, volume, earnings + IPO + news markers, the watermark with its logo):
// a cold switch cost 3 StockChart renders with the answers held and 12 once they landed (2 each for the ticker
// meta, the listing date, the markers and the news, 1 for the logo); a next-earnings-date change cost 1 more.
// With this store: 3 and 3, and 0.
//
// Now one small component (`ChartMetaFeed` in StockChart.jsx) owns those reads, and this store carries what
// they answered to the chart:
//   · the feed renders just BEFORE the chart body in the same pass and STAGES what its hooks returned, so a
//     body render reads exactly the values its own hooks would have returned (a switch's render sees the new
//     symbol's cached answers, as before);
//   · an answer that lands between body renders re-renders only the feed, which PUBLISHES in its layout
//     effect; the body hears it through `subscribe` and redraws the few things that show it (watermark lines,
//     markers, badges) on the chart directly, before the browser paints. No body render.
//   · the body tells the feed what to read (`setConfig`: the markers / news / desk switches come from the
//     chart's settings, which only the body resolves).

const EMPTY_CONFIG = Object.freeze({ markers: false, news: false, desk: false, fetcher: null })

const sameFields = (a, b) => {
  if (a === b) return true
  if (!a || !b) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) if (!Object.is(a[k], b[k])) return false
  return true
}

/** One chart's metadata store. */
export function createChartMetaStore() {
  let snap = Object.freeze({})     // what the feed's hooks returned at its latest render
  let published = snap             // what the listeners were last told
  let config = EMPTY_CONFIG
  const subs = new Set()
  const configSubs = new Set()
  const emit = (set) => { for (const fn of [...set]) fn() }
  return {
    /** The latest staged snapshot (stable identity until a field changes). */
    get: () => snap,
    /** The feed's render: hold what its hooks returned. A snapshot whose every field is unchanged keeps
     *  its identity, so readers memoised on it do not recompute. Never notifies (a render must not). */
    stage(next) {
      if (sameFields(snap, next)) return
      snap = Object.freeze({ ...next })
    },
    /** The feed's commit: tell the listeners, once, when the staged snapshot changed since the last time. */
    publish() {
      if (snap === published) return false
      published = snap
      emit(subs)
      return true
    },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn) } },
    /** What the feed should read (set by the chart body from its settings). */
    getConfig: () => config,
    setConfig(next) {
      if (sameFields(config, next)) return
      config = Object.freeze({ ...next })
      emit(configSubs)
    },
    subscribeConfig(fn) { configSubs.add(fn); return () => { configSubs.delete(fn) } },
  }
}

/** A value a host hands the chart through a channel instead of a prop, so a change re-renders only the
 *  chart's metadata feed (StableStockChart's `nextEarningsHint`). Staged in the host's render, published in
 *  its layout effect. */
export function createValueChannel(initial) {
  let value = initial
  let published = initial
  const subs = new Set()
  return {
    get: () => value,
    stage(next) { value = next },
    publish() {
      if (Object.is(value, published)) return false
      published = value
      for (const fn of [...subs]) fn()
      return true
    },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn) } },
  }
}

/** The stand-in channel for a host that passes the plain prop (never changes, never notifies). */
export const NO_CHANNEL = Object.freeze({ get: () => undefined, subscribe: () => () => {} })

/**
 * `fn` memoised on its whole argument list (each by `Object.is`), last call only. Both the chart's render
 * and its between-render redraw call the SAME instance with the same arguments, so they share identities
 * (a marker list the render computed is the one the redraw hands the renderer, and vice versa).
 */
export function memoLast(fn) {
  let last = null
  let out
  return (...args) => {
    if (last && last.length === args.length && last.every((v, i) => Object.is(v, args[i]))) return out
    last = args
    out = fn(...args)
    return out
  }
}
