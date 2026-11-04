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

// ─── ⭐⭐ WS-E (review H1) — THE WINDOW'S `bar_index` IS UNCAPTURED ─────────────
//
// TradingView's state starts on the window's first bar (its documented rule), but
// what `bar_index` READS there — 0, or that bar's index in the loaded history — has
// no capture (`docs/pine/capture-queue-2026-10-31-wse.md` Q-WSE1). A run that plots
// `bar_index`, tests `bar_index % n`, prints it, or computes a drawing coordinate
// that is not a plain shift of it, would draw an answer standing ruling 2 refuses.
//
// ⭐ SO THE QUESTION IS MEASURED, NOT GUESSED: the window is run a second time with
// every `bar_index` / `last_bar_index` read `CALC_BARS_INDEX_PROBE` bars further on
// (`pineRuntimeFrontend.js::shiftBarIndexLeaves`). A run whose answer does not move —
// every column equal bar for bar, every drawing equal once its bar-index
// coordinates are moved back by the probe — reads `bar_index` only in ways
// TradingView's base cannot change (a difference, a comparison of two indices, a
// drawing placed AT an index), and is drawn. Anything else is refused by name
// (`CALC_BARS_INDEX_GUARD`) until Q-WSE1 is captured. Wyckoff (differences and
// coordinates only) is drawn; `plot(bar_index)` is not.

// ⚠️ WHY NOT `ast/barIndexShift.js` (re-review M-A asked). That classifier is the host
// lane's authority over a TREE ('inv' / 'pos' / 'dep', thresholds); in this lane a
// `bar_index` value also flows through slots, `var` state, UDF frames and drawing
// stores the trees never show (`b = bar_index` then `if b > 5000`), so a verdict over
// the column trees alone would answer "invariant" for a script that is not. The probe
// measures the whole run, the same way the warm-up curtain does for a chart's first
// bar, and is this lane's ONE authority over the question; the host classifier stays
// the host's. Both answer the same question for different machines, not one twice.

/** The refusal a windowed run gets when its answer depends on `bar_index`'s base. */
export const CALC_BARS_INDEX_GUARD = 'runtime:calc-bars-bar-index'
/** How far the probe moves `bar_index`: 1,000,003, a PRIME above any count
 *  TradingView loads. A prime moves `bar_index % n` for every n below it; a shift
 *  past any loaded count carries every comparison with a constant (`bar_index >
 *  5000`, `math.max(bar_index, 5000)`) across it, so the answer moves; and a
 *  coordinate written as a plain number (`label.new(10, …)`) no longer lands where
 *  the moved-back coordinates do.
 *  ⚰️ It was 1 (re-review M-A): one bar crosses no constant the window never
 *  reaches, so `bar_index > 5000` was drawn. ⚰️ And the "1,000,003 refuses plain
 *  placements" note this replaced was a misread rail: the refused script picked its
 *  bars with `bar_index % 50`, which SHOULD be refused; a label AT `bar_index` moves
 *  back exactly (`wseReviewFixes.test.js` M1). */
export const CALC_BARS_INDEX_PROBE = 1000003

/** Does a run's drawing payload hold a drawing placed by bar index? Such a run is
 *  probed even when its source never names `bar_index`: `label.new(10, …)` places at
 *  an index whose meaning on TradingView is the uncaptured count itself. */
export function placesByBarIndex(payload) {
  const live = payload && Array.isArray(payload.live) ? payload.live : []
  return live.some((o) => {
    const p = (o && o.props) || {}
    return (p.xloc === undefined || p.xloc === 'bar_index') && X_PROPS.some((k) => typeof p[k] === 'number')
  })
}

/** Does the source read `bar_index` or `last_bar_index` at all (comments and strings stripped)? */
export function readsBarIndex(strippedSource) {
  return /\b(bar_index|last_bar_index)\b/.test(String(strippedSource || ''))
}

function sameNum(x, y) {
  if (x === y) return true
  const xn = typeof x !== 'number' || Number.isNaN(x)
  const yn = typeof y !== 'number' || Number.isNaN(y)
  if (xn || yn) return xn && yn
  return Math.abs(x - y) <= 1e-9 * Math.max(Math.abs(x), Math.abs(y), 1)
}

function sameProp(x, y) {
  if (typeof x === 'number' || typeof y === 'number') return sameNum(x, y)
  return JSON.stringify(x) === JSON.stringify(y)
}

/**
 * Where two windowed runs disagree — `a` with the window's own `bar_index`, `b` with
 * it moved `k` bars on — or null when they agree everywhere. Pure.
 * @returns {string|null} what moved, in a member's words
 */
export function barIndexDependenceOf(a, b, k, objectsKey) {
  for (const key of Object.keys(a || {})) {
    const ca = a[key]
    const cb = b && b[key]
    if (!cb || cb.length !== ca.length) return 'an output it draws'
    for (let i = 0; i < ca.length; i += 1) if (!sameNum(ca[i], cb[i])) return `an output it draws (from bar ${i + 1} of the window)`
  }
  const pa = a ? a[objectsKey] : undefined
  const pb = b ? b[objectsKey] : undefined
  if (!pa && !pb) return null
  if (!pa || !pb || pa.status !== pb.status) return 'its drawings'
  const la = Array.isArray(pa.live) ? pa.live : []
  const lb = Array.isArray(pb.live) ? pb.live : []
  if (la.length !== lb.length) return 'how many drawings it makes'
  for (let j = 0; j < la.length; j += 1) {
    const oa = la[j] || {}
    const ob = lb[j] || {}
    if (oa.family !== ob.family) return 'its drawings'
    const pra = oa.props || {}
    const prb = ob.props || {}
    const byIndex = pra.xloc === undefined || pra.xloc === 'bar_index'
    for (const p of new Set([...Object.keys(pra), ...Object.keys(prb)])) {
      let vb = prb[p]
      if (byIndex && X_PROPS.includes(p) && typeof vb === 'number') vb -= k
      if (!sameProp(pra[p], vb)) return `a ${oa.family || 'drawing'}'s \`${p}\``
    }
  }
  return null
}

/** FNV-1a over a string, as 8 hex digits. */
function fnv(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}

/**
 * ⭐ WS-E re-review M-B — what a window's `bar_index` probe verdict depends on: the
 * document (its source and the outputs it maps), the member's settings, every
 * window bar's time, and the values of every CLOSED bar. The forming bar's values are
 * left out ON PURPOSE (a tick does not re-probe; see the caller's note), its time is in.
 */
export function probeVerdictKey(def, ctx, rows) {
  const compute = (def && def.compute) || {}
  const forming = !!(ctx && ctx.newestBarIsForming === true)
  const closed = forming ? rows.length - 1 : rows.length
  const parts = [String(compute.source || ''), JSON.stringify(compute.outputs || {}),
    JSON.stringify((ctx && ctx.runtimeInputs) || {}), String(ctx && ctx.tf), String(forming)]
  for (let i = 0; i < rows.length; i += 1) {
    const b = rows[i] || {}
    parts.push(i < closed ? `${b.t},${b.o},${b.h},${b.l},${b.c},${b.v}` : `${b.t}`)
  }
  return fnv(parts.join('|')) + ':' + fnv(parts.reverse().join('#')) + ':' + rows.length
}
