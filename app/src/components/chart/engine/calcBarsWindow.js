// app/src/components/chart/engine/calcBarsWindow.js
//
// ─── ⭐⭐ `calc_bars_count = N`: THE SCRIPT IS COMPUTED ON THE CHART'S LAST N BARS ──
//
// Pine's `indicator(calc_bars_count = N)` "limits the initial calculation of a script
// to the last number of bars specified" (the v6 reference). ONE module, imported by
// BOTH lanes: the host lane at its one compute seam (`nativeRegistry.computeFor`, the
// `ast` branch) and the runtime lane (`runtime/runtimeColumns.js`). Pure: it imports
// nothing, so the server bundle's host-neutral closure is unchanged.
//
// ⭐ WITNESSED (committed captures `vw-cs1-calc-bars-rddt-1d-2026-11-14` and
// `vw-wse-calc-bars-bar-index-rddt-1d-2026-11-14`, NYSE:RDDT 1D from the listing, 666
// bars, `calc_bars_count = 100`):
//   · TradingView prints rows for chart bars 566..665 only, and nothing before them;
//   · `bar_index` reads 0..99 on those bars (the window's first bar IS bar 0);
//   · a `var` counter reads 1..100 (state starts on the window's first bar);
//   · `ta.sma(close, 10)` is `na` on window bars 0..8 and is the window-only average
//     after (a history read does not reach before the window: the window is the
//     script's whole history);
//   · `time` is the bar's real time.
// And wyckoff (`calc_bars_count = 1000`) MATCHES on SPY 1D (1,800 bars, windowed) and on
// RDDT 1D (636 bars, under the count: not windowed).
//
// ⭐ SO A WINDOWED RUN IS A RUN OVER THE LAST N ROWS, told its history starts there
// (`historyFromListing`), with its first bar as `bar_index` 0; its columns are padded
// back to the chart's length with `NaN` in front (nothing drawn before the window, as
// TradingView shows nothing there). A run over a chart of N bars or fewer is not
// windowed at all: byte-identical to a document that declares no count.
//
// ⭐ AND (capture session S10, `vw-cbc-history-reads-rddt-1d-2026-11-15` and
// `vw-cbc-mbb-and-input-rddt-1d-2026-11-15`, 100 rows each, nothing before the window):
//   · a history read never reaches before the window: `close[1]`, `time[1]`, `bar_index[1]`
//     are `na` on its first bar, `close[150]` and `ta.highest(high, 150)` on all 100,
//     `nz(close[100], -1)` is -1 on all 100, and `max_bars_back = 500` changes none of it
//     (`close[300]`, `ta.sma(close, 300)` stay `na`) — the window is the run's whole history,
//     which is what handing either lane the slice computes;
//   · `last_bar_index` reads 99, `barstate.isfirst` is true on the window's first bar only,
//     and `ta.cum(1)` reads 1..100: each the window's own, as the slice computes them.
//   · `calc_bars_count = 0` computes every bar (`vw-cbc-zero`, MATCH): no window.
//
// ⛔ WHAT IS NOT WITNESSED, AND IS NEVER GUESSED (each named, each a probe in
// `docs/pine/capture-queue-2026-11-15-calc-bars.md`):
//   · `request.*` inside a window — REFUSED by name (`CALC_BARS_REQUEST_GUARD`);
//   · REALTIME: TradingView fixes the INITIAL window and appends new bars to it; this
//     window is re-taken on every run. Until the live probe lands the newest bar of a
//     windowed run, while it is forming, is WITHHELD by name (`CALC_BARS_FORMING_GUARD`).

/** The non-enumerable record a windowed run's columns carry: `{count, cut, rows}`. */
export const CALC_BARS_KEY = '__calcBarsWindow'

/** A windowed script that requests other bars (unwitnessed in a window). */
export const CALC_BARS_REQUEST_GUARD = 'pine:calc-bars-request'
/** The newest bar of a windowed run while it is forming (realtime, unwitnessed). */
export const CALC_BARS_FORMING_GUARD = 'pine:calc-bars-forming'
/** The disclosure row a windowed run carries: "computed on its last N bars". */
export const CALC_BARS_WINDOW_CODE = 'calc-bars:window'

/** Any request of other bars in a SOURCE (comments and strings stripped first), the
 *  identity request included, and the pre-v5 bare spellings. Over-declares.
 *  ⛔ `.test()` only, and NO LOOKBEHIND (iOS 16 floor: Safari before 16.4 throws on `(?<!`
 *  when the chunk is parsed, `src/noRegexLookbehind.test.js`): "not preceded by a word
 *  character or a dot" is the consumed prefix `(?:^|[^\w.])`. */
export const CALC_BARS_REQUEST_SOURCE = /(?:^|[^\w.])(?:request\s*\.\s*[A-Za-z_]\w*|security|financial)\s*\(/

/** A drawing property that is a bar coordinate (`objectStore.PROP_KIND` 'x'). */
const X_PROPS = Object.freeze(['x', 'x1', 'x2', 'left', 'right'])

/** The document's declared count (`meta.calcBarsCount`, stamped by the member door from
 *  `pine.js::declarationCalcBars`), or null. ⛔ The stamp is the ONE authority: a
 *  document that does not carry it is not windowed. */
export function calcBarsCountOf(def) {
  const n = def && def.meta ? def.meta.calcBarsCount : undefined
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * The window a run of `def` over `rows` takes, or null when it takes them all (no
 * count, or a chart of N bars or fewer).
 * @returns {{rows: object[], cut: number, count: number}|null}
 */
export function calcBarsWindowOf(def, rows) {
  const n = calcBarsCountOf(def)
  if (n === null || !Array.isArray(rows) || rows.length <= n) return null
  const cut = rows.length - n
  return { rows: rows.slice(cut), cut, count: n }
}

/** The context a windowed run is handed: its first bar is the history's first bar and
 *  TradingView's `bar_index` 0 (both witnessed, see the header). */
export function windowContext(ctx) {
  return { ...(ctx || {}), historyFromListing: true, barIndexFromFirstBar: true }
}

/** Is the newest bar of a windowed run withheld? Unless the caller states it is CLOSED
 *  (`newestBarIsForming === false`), it may be forming: fail closed. */
export function formingWithheld(ctx) {
  return !(ctx && (ctx.newestBarIsForming === false || ctx.newest_bar_is_forming === false))
}

const count = (n) => Number(n).toLocaleString('en-US')

/** The member's sentence for a windowed document's disclosure row. */
export function calcBarsWindowSentence(n) {
  return `this script is computed on the chart's last ${count(n)} bars only (\`calc_bars_count = ${n}\`), `
    + 'as TradingView computes it, so nothing is drawn on the bars before them.'
}

/** …for a windowed script that requests other bars. */
export function calcBarsRequestSentence(n) {
  return `this script requests other bars (\`request.*\`) and runs on its last ${count(n)} bars only `
    + `(\`calc_bars_count = ${n}\`); how TradingView computes a request inside such a window has not been `
    + 'measured, so nothing is drawn rather than a guess.'
}

/** …for the newest bar of a windowed run while it may be forming. */
export function calcBarsFormingSentence(n) {
  return `the newest bar is not drawn while it may still be forming: TradingView fixes a \`calc_bars_count = ${n}\` `
    + 'window when the chart loads and adds new bars to it, and how its values move as bars arrive has not been '
    + 'measured.'
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
 * The windowed run's columns as the chart's: every column padded with `NaN` for the
 * `cut` bars before the window; the run's non-enumerable records carried (each
 * redefined CONFIGURABLE on the new map), its drawings moved by `cut`.
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

/**
 * The windowed columns with the newest bar withheld (`NaN` in every column) when it may
 * be forming, and the record that names the window (and the withheld bar). A drawing
 * payload, if the run made one, is withheld by name too: what it holds on the forming
 * bar is the realtime state no capture measured.
 */
export function withCalcBarsRecord(out, { count: n, cut }, ctx, objectsKey) {
  const forming = formingWithheld(ctx)
  if (forming) {
    for (const k of Object.keys(out)) {
      const col = out[k]
      if (Array.isArray(col) && col.length) col[col.length - 1] = NaN
    }
    if (objectsKey && Object.hasOwn(out, objectsKey) && out[objectsKey]) {
      Object.defineProperty(out, objectsKey, {
        value: { status: 'WITHHELD', live: [], guard: CALC_BARS_FORMING_GUARD, reason: calcBarsFormingSentence(n) },
        enumerable: false, configurable: true,
      })
    }
  }
  const rows = [{ code: CALC_BARS_WINDOW_CODE, reason: calcBarsWindowSentence(n) },
    ...(forming ? [{ code: CALC_BARS_FORMING_GUARD, reason: calcBarsFormingSentence(n) }] : [])]
  Object.defineProperty(out, CALC_BARS_KEY, {
    value: Object.freeze({ count: n, cut, formingWithheld: forming, rows: Object.freeze(rows) }),
    enumerable: false, configurable: true,
  })
  return out
}

/** The window record a column map carries (`{count, cut, formingWithheld, rows}`), or null. */
export function calcBarsWindowReport(columns) {
  return (columns && columns[CALC_BARS_KEY]) || null
}
