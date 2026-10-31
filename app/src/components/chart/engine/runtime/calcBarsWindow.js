// app/src/components/chart/engine/runtime/calcBarsWindow.js
//
// ─── ⭐⭐ PHASE 3 WS-E — `calc_bars_count = N`: THE RUN STARTS N BARS FROM THE END ──
//
// Pine's `indicator(calc_bars_count = N)` "limits the initial calculation of a
// script to the last number of bars specified" (the v6 reference). TradingView
// runs the script over those N bars only: its state starts on the first of them,
// and nothing is drawn on any bar before.
//
// ⚰️ THE RUNTIME LANE RAN FROM THE CHART'S FIRST BAR. A run that owned its
// drawings refused by name on a chart longer than N (`runtime:calc-bars-count`,
// RT5) and fell back to a plain run — which drew every plot and paint from bar 0,
// with state TradingView never had. Measured on the vendor capture
// `wyckoff-accumulation-distribution-spy-1d-2026-10-02` (1,800 bars, N = 1,000):
// its barcolor DIVERGED (and the plain run hit `ARRAY_OPERATIONS` on the warm
// prehistory, so the stop was misnamed `runtime:calc-bars-count`), its boxes were
// withheld, and every one of its eight plotshapes drew marks on bars 10..824 where
// TradingView draws none. Run over the last 1,000 bars instead, the SAME capture
// reads MATCH on all ten items: eight plotshapes, the barcolor bar for bar, and the
// 66 paired box colour slots. Its RDDT capture (631 bars, under N) is unchanged.
//
// ⭐ HOW. The window is the last N rows. The run sees them as its whole history
// (TradingView's first calculated bar IS bar 0 of the script's state, so the run
// is told its history starts where TradingView's does: `historyFromListing`). Its
// columns are padded back to the chart's length with `NaN` in front — nothing
// drawn before the window, which is what TradingView shows. Its own drawings'
// bar-index coordinates are moved into the chart's indices (`+ cut`); a
// `bar_time` coordinate is an instant and stays.
//
// ⚠️ NEEDS CAPTURE, said plainly:
//   · the VALUE of `bar_index` on the first calculated bar. This run answers 0.
//     Wyckoff reads `bar_index` only in differences and as drawing coordinates, so
//     its MATCH does not settle whether TradingView answers 0 or the bar's index in
//     the loaded history. Probe: `plot(bar_index)` with `calc_bars_count = 100` on
//     a chart of more than 100 bars.
//   · REALTIME: TradingView limits the INITIAL calculation; bars that arrive later
//     are added to it. This window slides with each new bar, which is what a reload
//     of TradingView shows, not what a live session does after N new bars. Probe: a
//     live capture across a new bar of a `calc_bars_count` script whose state
//     depends on its first bar.

/** A drawing property that is a bar coordinate (`objectStore.PROP_KIND` 'x'). */
const X_PROPS = Object.freeze(['x', 'x1', 'x2', 'left', 'right'])

/** The declared `calc_bars_count` of a source, comments and strings stripped. */
function declaredCalcBars(def, readCalcBars) {
  const src = def && def.compute && typeof def.compute.source === 'string' ? def.compute.source : ''
  const n = readCalcBars(src)
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * The window a run of `def` over `rows` must take, or null when it takes them all.
 *
 * @param {object} def
 * @param {object[]} rows
 * @param {(source: string) => number|null} readCalcBars  the source's declared count
 * @returns {{rows: object[], cut: number}|null}
 */
export function calcBarsWindowOf(def, rows, readCalcBars) {
  const n = declaredCalcBars(def, readCalcBars)
  if (n === null || !Array.isArray(rows) || rows.length <= n) return null
  const cut = rows.length - n
  return { rows: rows.slice(cut), cut }
}

/** A run payload's drawings moved into the chart's bar indices. */
function shiftedObjects(payload, cut) {
  if (!payload || !Array.isArray(payload.live)) return payload
  const live = payload.live.map((o) => {
    if (!o || !o.props) return o
    const props = { ...o.props }
    // ⭐ only a BAR-INDEX coordinate moves (the default `xloc`); an instant does not
    if (props.xloc === undefined || props.xloc === 'bar_index') {
      for (const k of X_PROPS) if (typeof props[k] === 'number' && Number.isFinite(props[k])) props[k] += cut
    }
    return { ...o, props, ...(Number.isInteger(o.createdBar) ? { createdBar: o.createdBar + cut } : {}) }
  })
  return { ...payload, live, calcBarsCut: cut }
}

/**
 * The windowed run's columns as the chart's: every column padded with `NaN` for
 * the `cut` bars before the window; the run's non-enumerable payloads carried, its
 * drawings moved by `cut`.
 */
export function widenToChart(cols, cut, objectsKey) {
  const out = {}
  for (const [k, col] of Object.entries(cols || {})) {
    const padded = new Array(cut + col.length)
    for (let i = 0; i < cut; i += 1) padded[i] = NaN
    for (let i = 0; i < col.length; i += 1) padded[cut + i] = col[i]
    out[k] = padded
  }
  for (const key of Object.getOwnPropertyNames(cols || {})) {
    if (Object.hasOwn(out, key)) continue
    const value = key === objectsKey ? shiftedObjects(cols[key], cut) : cols[key]
    Object.defineProperty(out, key, { value, enumerable: false, configurable: true })
  }
  return out
}
