// app/src/components/chart/engine/binder.js
//
// ─── THE ONLY FILE IN THE ENGINE THAT TOUCHES LIGHTWEIGHT-CHARTS ─────────────
//
// Everything above it is pure: `defSchema` says what an indicator IS,
// `nativeRegistry` turns one into columns, `instances` turns a settings blob into
// a list, `pool` decides which series becomes which plot, `placement` (Task 6)
// decides where. This file does exactly one thing: it TRANSLATES that plan into
// renderer calls. It holds no policy of its own — no placement maths, no reuse
// heuristics, no data-shape decisions — because policy that lives next to a side
// effect can only be tested through the side effect.
//
// ⛔ THE LANDS-DARK CONTRACT: flag off ⇒ `sync` returns having made ZERO calls of
// any kind. Not "no series calls", not "no visible change" — zero. That is B2's
// whole safety story and the first test in `binder.test.js`.
//
// ─── THE THREE TRAPS IT EXISTS TO CLOSE ─────────────────────────────────────
//
// 1. FORCE setData ON A FIRST BIND. `StockChart._applyData` returns early on a
//    `noop` plan (`:4675-4680`), which is correct for a series that already holds
//    the right data and is what stops the extended-hours price-tag tick from
//    wiping the developing bar. A series created — or RE-PURPOSED — this pass
//    holds nothing, or the previous tenant's numbers. Today that is safe only by
//    coupling: every create is triggered by a `cs` change, so the plan can never
//    be `noop` on a create. Pooling breaks the coupling, so the guarantee becomes
//    explicit (`pool.firstBindNeedsSetData`).
//
// 2. RE-ASSERT THE FULL PRICE-SCALE OPTION SET ON EVERY BIND. `StockChart` passes
//    `{autoScale:false, minimum:0, maximum:100}` on the CREATE branch only
//    (`:5773`), and the update branch calls `applyIndScale` with no extras. Price
//    scales are CHART-LEVEL and keyed by id, so a pooled series that inherited an
//    RSI's scale and never had its own asserted is stuck with whatever that scale
//    was left holding — and an ATR of 2.7 draws as a flat line at the bottom. The
//    full object, every time. (The inherited hazard is `autoScale: false`, which
//    FREEZES the range; `minimum`/`maximum` are not 5.2.0 options and pin nothing
//    — see `placement.js`'s TRAP #2 and `__tests__/autoscaleOnARealScale.test.js`.)
//
// 3. TRACK AND REMOVE PRICE LINES. `createPriceLine` returns a handle that the
//    shipped code throws away, which is fine while a series is destroyed with its
//    guides. A pooled series SURVIVES its tenant, so RSI's 70 / 50 / 30 would
//    stay drawn across whatever took the series next. Handles are tracked per
//    binding and removed when the tenant changes.
//
// ─── WHAT IT REQUIRES FROM ITS CALLER ───────────────────────────────────────
//
// `ctx.resolvePlacement` is REQUIRED. Without it `sync` makes zero calls and
// says why, rather than inventing a pane and a scale — a second source of truth
// for placement is exactly the drift Task 6 exists to prevent.

import {
  planBindings,
  firstBindNeedsSetData,
  seriesOptionsForPlot,
  signColorsForPlot,
  bindingKey,
  lineStyleValue,
} from './pool'
import { paneMode, paneStretchPlan, paneHeightMismatch } from './paneLayout'
import {
  sourceInputsOf, parseSource, barFieldSeries, orderByDependency,
} from './sourceRef'
import { projectionFor, clippedBarsFor } from './symbolProjection'
import { ohlcCapabilityOf, barHasOhlc } from './ohlcCapability'
import { resolvePlotStyle, resolveCandleColors } from './presentation'

/** Monotonic id stamped on each resolved source column, so a consumer's memo key
 *  can name the exact array it computed against. Non-enumerable, so it can never
 *  reach a settings blob or a JSON payload. */
let SOURCE_SERIAL = 0

/** poolKey → the LWC series constructor to hand `addSeries`. */
const SERIES_CTOR = {
  line: 'LineSeries',
  histogram: 'HistogramSeries',
  area: 'AreaSeries',
  baseline: 'BaselineSeries',
  // ⚠️ THE BINDER CAN ONLY BUILD WHAT THIS TABLE NAMES, and a pool key absent
  // from it resolves to `undefined`: `addSeries(undefined, …)` throws, `attempt`
  // swallows it, and the result is an orphaned binding — a plot that plans,
  // computes, and then silently does not exist. `engineLwc()` in StockChart must
  // carry the constructor this names, or the same hole opens one file over.
  candlestick: 'CandlestickSeries',
}

/**
 * A column plus the bars it is aligned to → LWC series data.
 *
 * `indicators.js` pads with NaN and **LWC rejects `value: NaN` outright**, so a
 * not-yet-computable position becomes a WHITESPACE item (`{time}` with no
 * `value`) — the same conversion `StockChart`'s `indPoint` does at its render
 * boundary, and the only correct way to hand these arrays to a series.
 *
 * ─── PER-POINT COLOUR (`colorMode: 'sign'`) ─────────────────────────────────
 *
 * `signColors` is `{up, down}` or null. MACD's histogram is the shipped case and
 * the reason this parameter exists: `StockChart.jsx:4002` emits a `color` on
 * every point (`value >= 0 ? MACD_HIST_UP : MACD_HIST_DOWN`), so the legacy
 * histogram is green above zero and red below. Emitting `{time, value}` only —
 * which is what this did — draws the whole pane in ONE flat colour, LWC's
 * histogram default, because no definition declares a series colour for it
 * either. That is a `macd_only` parity failure waiting for B3's third pilot.
 *
 * `>= 0` is green, matching the legacy comparison exactly. A whitespace point
 * carries no colour, which is correct: there is no bar to colour.
 */
// ─── THE ONE COMPOUND PAYLOAD ─────────────────────────────────────
//
// ⛔⛔ TAGGED, NOT DUCK-TYPED. `payload.bars !== undefined` would be a contract
// nobody declared, and a Float64Array that grew a property would silently change
// lanes. `kind` is the only thing any reader tests.
//
// ⛔ AND COMPUTE NEVER SEES ONE. `columns` feeds two consumers: the renderer,
// and the source resolution that hands a numeric column to `computeFor`. An OHLC
// payload is produced only for a binding whose PRESENTATION asked for candles,
// and a source reference always resolves through the scalar projection — so
// `MA(QQQ)` reads `sym:QQQ:close` exactly as it did.
const OHLC_KIND = 'ohlc'

/** A tagged OHLC payload for one visual binding. */
function ohlcPayload(bars) {
  return { kind: OHLC_KIND, bars: Array.isArray(bars) ? bars : [] }
}

/** Is this binding payload the coordinated bar shape rather than a column? */
function isOhlcPayload(v) {
  return !!v && typeof v === 'object' && v.kind === OHLC_KIND
}

/**
 * Canonical bars → LWC `CandlestickData`.
 *
 * ⛔ THE BAR'S OWN `t`, NEVER THE PRIMARY'S. `clippedBarsFor` has already dropped
 * every bar outside the chart's time domain, so each survivor is a real bar of
 * the secondary instrument at its own timestamp. Rewriting it would attribute one
 * instrument's auction to another's bar.
 *
 * ⛔ AND NO SIGN COLOURS. `colorMode: 'sign'` paints a histogram bar from the
 * value's sign; a candle's colour is its own up/down option and is LWC's to
 * decide from open vs close. Threading the scalar machinery through here would
 * paint every candle one colour and call it a feature.
 */
function toOhlcPoints(payload, adjustTime) {
  const bars = payload && Array.isArray(payload.bars) ? payload.bars : []
  const out = new Array(bars.length)
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]
    const time = adjustTime(b.t)
    // A bar the capability probe admitted may still be individually incomplete —
    // whitespace, exactly as a NaN column position becomes whitespace.
    if (!Number.isFinite(b.o) || !Number.isFinite(b.h)
      || !Number.isFinite(b.l) || !Number.isFinite(b.c)) {
      out[i] = { time }
      continue
    }
    out[i] = { time, open: b.o, high: b.h, low: b.l, close: b.c }
  }
  return out
}

function toPoints(column, bars, adjustTime, signColors) {
  const out = new Array(bars.length)
  for (let i = 0; i < bars.length; i++) {
    const time = adjustTime(bars[i].t)
    const v = column ? column[i] : NaN
    if (!Number.isFinite(v)) { out[i] = { time }; continue }
    out[i] = signColors
      ? { time, value: v, color: v >= 0 ? signColors.up : signColors.down }
      : { time, value: v }
  }
  return out
}

/**
 * The LAST point's value, or `undefined` if the series ends on whitespace.
 *
 * ⛔ THE DEVELOPING-BAR FALLBACK, AND WHY IT IS THE BINDER'S JOB. The shipped
 * crosshair legend read `d?.value ?? indicatorData.<id>.at(-1)?.value` — the
 * newest computed value when the HOVERED bar carries no point for the
 * indicator. (⚠️ B4 Task 10 deleted those hand-written reads; the LEGACY lane
 * now registers the same `.at(-1)?.value` as a THUNK on its chip entry, and this
 * is the ENGINE lane's half of the identical rule.) That is not a cosmetic nicety: the bars
 * push feed's writer B appends a developing candle imperatively
 * (`StockChart.jsx:4553`, `series.update()`, no `updateChart` pass), so on an
 * intraday chart the newest bar exists on the CANDLES and not yet on any
 * indicator series until the next SWR refresh (30 s). Hover it and legacy prints
 * `RSI(14) 71.2`; without this an engine-drawn RSI printed nothing at all.
 *
 * The LAST element, not the last FINITE one, because that is exactly what
 * `.at(-1)?.value` means: a column that ends in whitespace has no fallback and
 * the chip is dropped, as it is for legacy.
 */
function lastPointValue(points) {
  if (!Array.isArray(points) || points.length === 0) return undefined
  const last = points[points.length - 1]
  return last ? last.value : undefined
}

/**
 * One `hlines` plot → one `createPriceLine` spec per level.
 *
 * ⚠️ A `createPriceLine` OPTION IS NOT A SERIES OPTION. Omitting `lineStyle` from
 * `applyOptions` leaves the series' current style alone; omitting it here takes
 * LWC's OWN price-line default, which is `Dashed` (2). So "declare nothing and
 * nothing changes" — true one level up in `seriesOptionsForPlot` — is false for a
 * guide, and it cost 379 pixels on RSI's 50 line before the Task 8 rehearsal
 * measured it. Every guide the shipped code draws now NAMES its style, and this
 * maps it through the same `lineStyleValue` the series options use so the two can
 * never disagree about what `'largeDashed'` means.
 *
 * A style the vocabulary does not know is still left undeclared rather than
 * guessed — `defSchema` rejects one at registration, so this is the second lock.
 *
 * The hand-rolled if-chain this replaced could not express LargeDashed at all.
 */
function guideSpecs(plot, LineStyle) {
  const specs = []
  const style = lineStyleValue(plot.lineStyle, LineStyle)
  for (const price of (plot.levels || [])) {
    if (!Number.isFinite(price)) continue
    const spec = { price, axisLabelVisible: false }
    if (plot.color) spec.color = plot.color
    spec.lineWidth = Number.isFinite(plot.width) ? plot.width : 1
    if (style !== undefined) spec.lineStyle = style
    specs.push(spec)
  }
  return specs
}

/**
 * HAND-BACK (W1b.5, minor 4) — the guide follows the first VISIBLE plot.
 *
 * `pool.js::planBindings` decides which binding carries an instance's guides
 * before anything downstream knows a plot will be HIDDEN: it always hangs
 * `hlines` guides on `dataPlots(def)[0]`, the first data-bearing plot in
 * DECLARATION order — pool.js has no notion of `plots[].hidden` at all (that
 * is this task, and pool.js is out of scope for it: "your files are binder.js
 * and binder.test.js, and nothing else"). Left alone, an author who hides the
 * FIRST data plot silently drops every guide the instance declares: the
 * binding carrying them hits the pass-one skip below and `continue`s, and
 * nothing else in `bind` still holds the `guides` array it was carrying — the
 * zero line simply stops being drawn, with no error anywhere that says why.
 *
 * ⛔ `pool.js` IS DELIBERATELY NOT TOUCHED FOR THIS. `bind` is walked here
 * BEFORE either binding is looked at below, moving `guides`/`guideSig` off a
 * HIDDEN carrier onto the first VISIBLE binding of the SAME instance. The
 * guide keeps exactly the meaning pool.js already gave it ("this instance's
 * one set of guides") — only WHICH series draws it changes, and every plot of
 * one instance shares one pane and one price scale
 * (`placement.resolvePlacement` keys both on `def.id`, never on the plot),
 * so the guide lands in the same visual place either way.
 *
 * An instance whose every plot is hidden has no series left to hang a guide
 * on; its guides are dropped there, which is the same thing that already
 * happens to an instance that draws nothing at all — not a new failure mode.
 *
 * `bind` is `pool.js`'s own fresh array for this one pass — nobody else holds
 * a reference to its entries — so mutating `heir`'s two guide fields in place
 * costs nothing a rebuild would not, and reads as what it is: reassigning who
 * carries a guide, not inventing a second one. The carrier's own `guides` is
 * left untouched: it is `continue`d by the hidden-plot skip below before pass
 * two ever looks at it again, so there is nothing left to clear.
 */
function reassignOrphanedGuides(bind) {
  const byInstance = new Map()
  for (const b of bind) {
    const group = byInstance.get(b.instanceId)
    if (group) group.push(b)
    else byInstance.set(b.instanceId, [b])
  }
  for (const group of byInstance.values()) {
    const carrier = group.find((b) => b.guides && b.guides.length)
    if (!carrier || !(carrier.plot && carrier.plot.hidden === true)) continue
    const heir = group.find((b) => b !== carrier && !(b.plot && b.plot.hidden === true))
    if (!heir) continue                       // nothing visible left to carry it
    heir.guides = carrier.guides
    heir.guideSig = carrier.guideSig
  }
}

/** Swallow a renderer throw for ONE call. The shipped code wraps every LWC call
 *  the same way: one bad series must not abort the rest of the paint and take
 *  the chart down with it. */
function attempt(fn) {
  try { return { ok: true, value: fn() } } catch (err) { return { ok: false, err } }
}

/**
 * A stable string for an instance's inputs, for the compute memo below.
 *
 * VALUE equality, not identity: `normalizeInstances` rebuilds the inputs object
 * on every read, so `inst.inputs` is a different object every pass even when the
 * user has changed nothing. An identity check would therefore never hit and the
 * memo would be decorative — which is the failure mode this line exists to avoid.
 *
 * Every v1 input type resolves to a SCALAR (`int`/`float` → number, `bool` →
 * boolean, `enum`/`string`/`color`/`source` → string), so `String(v)` is total
 * and lossless here; keys are sorted so property order cannot make two equal
 * input sets look different.
 *
 * The two delimiters are U+0000 and U+0001 because no input VALUE can contain
 * them — that is what makes the joined string unambiguous. They are written as
 * `\u0000`/`\u0001` ESCAPES and MUST stay that way. Typed as raw bytes (which
 * is how they first shipped) they make this file *binary* to git and to ripgrep:
 * a diff of the engine's only renderer-touching module reads "Binary files …
 * differ", and `Grep` for a symbol defined in it returns nothing. The runtime
 * string is byte-identical either way — only the tooling can tell them apart,
 * which is why nothing failed when it regressed.
 * `app/src/__tests__/sourcesAreText.test.js` is the rail that does.
 */
function inputsSignature(inputs) {
  if (!inputs || typeof inputs !== 'object') return ''
  const keys = Object.keys(inputs).sort()
  let out = ''
  for (const k of keys) out += `${k}\u0000${String(inputs[k])}\u0001`
  return out
}

// ─── D2: WHERE A SURVIVING HEIGHT DRIFT GOES ─────────────────────────────────
//
// ⛔ NOT AN EXCEPTION. `binder.sync` runs inside StockChart's render effect, so a
// throw here reaches the ErrorBoundary and the user gets a BLANK CHART — which
// B5 Task 11 measured happening on ~20 % of cold loads for a ONE-PIXEL
// disagreement that a re-apply fixes. The drift still has to be attributable, so
// it lands here: a `console.warn` the first time each distinct message appears,
// and a counter a test can assert on. Module-level and not per-binder because the
// point is "did this ever happen", which outlives any one chart.

/** message → times seen. Read by `paneHeightAlerts()`; reset by tests. */
const _paneHeightAlerts = new Map()

function recordPaneHeightAlert(message) {
  const seen = _paneHeightAlerts.get(message) || 0
  _paneHeightAlerts.set(message, seen + 1)
  // Once per distinct message: an `updateChart` pass runs about once a second in
  // extended hours, and a warning that repeats 3,600 times an hour is noise
  // nobody reads.
  if (seen === 0 && typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(`${message} (re-applied once and it did not take; the chart is drawn anyway)`)
  }
}

/** Every height drift that survived a re-apply, as `{message: count}`. */
export function paneHeightAlerts() {
  return Object.fromEntries(_paneHeightAlerts)
}

/** TEST ONLY — a fresh slate between cases. */
export function __resetPaneHeightAlerts() {
  _paneHeightAlerts.clear()
}

/**
 * @param {{chart: object, LWC: object}} deps
 * @returns {{sync: (ctx: object) => object, teardown: () => void}}
 */
export function createBinder({ chart, LWC }) {
  /** Last pass's bindings, each carrying `series`, `guideHandles`, `paneIndex`. */
  let held = []

  // ─── THE TWO MEMOS (spec §5: "columnar→object mapping reused, never
  //     re-allocated per update") ─────────────────────────────────────────────
  //
  // `updateChart` re-runs on every data poll — roughly once a second in extended
  // hours, by its own comment at `StockChart.jsx:4688` — and most of those passes
  // are `noop`s where `_applyData` returns early and everything computed for them
  // is thrown away. Unmemoised, at the branch's own measured scale (14 instances →
  // 27 columns over 5,000 bars) that is 14 full indicator computes and ~135,000
  // freshly-allocated point objects PER SECOND, discarded.
  //
  // The legacy path never did this: `indicatorData` is a `useMemo`. Memoising here
  // does not merely match that budget, it matches its SEMANTICS — legacy
  // recomputes when the `bars` REFERENCE changes, and so does this, so a live
  // writer mutating a bar in place cannot make the engine and the legacy block
  // disagree about what an indicator says.
  //
  // Both are keyed on the real inputs and hold no clock: same bars + same
  // definition + same input VALUES ⇒ the same numbers, by definition of a pure
  // compute. Both are pruned to what this pass actually used, so a symbol flip
  // cannot leave 5,000-point arrays alive behind a stale key.

  /** instanceId → `{registry, def, bars, sig, cols}`. */
  let computeMemo = new Map()

  /** bindingKey → `{column, bars, adjustTime, up, down, points}`. */
  let pointMemo = new Map()

  // ─── FLIP C: THE HEIGHT CHECK IS ONE FRAME BEHIND, ON PURPOSE ──────────────
  //
  // 🔴 THE PLAN WROTE THIS CHECK INLINE, RIGHT AFTER `setStretchFactor`, AND IT
  // CANNOT WORK THERE. lightweight-charts computes pane heights in
  // `_private__adjustSizeImpl`, reached from `_private__syncGuiWithModel`, which
  // the invalidate handler defers to `requestAnimationFrame`. MEASURED on the
  // installed 5.2.0 bundle: `getHeight()` reads `[400, 0]` synchronously after a
  // second pane's `addSeries`, and reads the PREVIOUS heights synchronously after
  // `setStretchFactor` — so an inline assertion would throw on the FIRST sync of
  // EVERY chart. (Same rAF blindness that nearly pinned `SEPARATOR_PX` at 0 in
  // B5 Task 3, arriving from the other direction.)
  //
  // So the layout we asked for is remembered and verified at the TOP of the next
  // sync, gated on a frame having actually been through. That is still loud — an
  // `updateChart` pass runs about once a second in extended hours — and it is
  // deterministic, which an rAF callback that throws into nobody's stack is not.
  //
  // Verifying the PREVIOUS layout at the next sync is correct even when the
  // instance list changed in between: the frame in between laid the chart out at
  // the OLD layout, and the new one has not been applied yet when this runs.
  // 🔴 D2 — AND ONE FRAME IS STILL NOT A SETTLE. B5 Task 11 MEASURED the
  // deferred check throwing `paneLayout: pane 2 is 77px, expected 78px` into
  // StockChart's ErrorBoundary on 3 of 14 and then 1 of 8 COLD LOADS, with the
  // same build minus the throw producing 15 identical manifests out of 15 — so
  // the geometry was right every time and the ASSERTION was the defect. LWC is
  // free to re-lay-out between the write and the read (the price-axis width
  // ratchet re-measures, the time axis re-optimises), and an exact pixel identity
  // is not an invariant across that.
  //
  // ⛔ SO IT CONVERGES INSTEAD OF THROWING, AND THE ORDER MATTERS:
  //   1. re-apply the layout ONCE and re-arm — a transient disagreement is
  //      exactly what a re-apply fixes, and a chart that self-corrects is better
  //      than one that reports;
  //   2. only a mismatch that survives its own correction is REPORTED — a
  //      `console.warn`, once per distinct message, plus a counter tests read.
  // A blank chart is a worse failure than a one-pixel drift; that is the whole
  // ruling, and it is the third rAF-blindness incident on this branch.
  /** The layout the last sync applied, awaiting a frame. */
  let pendingLayout = null
  /** Set by a rAF once the renderer has had a chance to lay `pendingLayout` out. */
  let pendingLaidOut = false
  /**
   * Consecutive syncs whose height check disagreed. Reset by a CLEAN check, not
   * by applying a layout.
   *
   * ⛔ RESETTING IT ON APPLY MAKES THE REPORT UNREACHABLE, and that is not a
   * hypothetical: the first draft did, `applyPaneStretch` runs every sync, and a
   * layout the renderer can NEVER honour was silently converged forever. "Do not
   * throw" must not become "do not notice" — `flipCGeometry.test.jsx`'s
   * surviving-drift case is the rail, and it went red saying so.
   */
  let mismatchRun = 0

  /** Remove every series we hold. Zero calls when we hold nothing, which is what
   *  makes `teardown()` safe to call unconditionally from an unmount path. */
  /**
   * The chart's LEFT axis is visible exactly when something is drawn on it.
   *
   * ⚰️⚰️ A VACATED LEFT SCALE FREEZES THE WHOLE CHART. `leftPriceScale.visible` is
   * a CHART-LEVEL option, and `series.priceScale().applyOptions({visible: true})`
   * on a `'left'` scale turns it on for the chart — which is how a volume-pane
   * guest gets its own ladder. Nothing ever turned it back off. Once the last
   * left-axis tenant leaves, `ChartWidget._adjustSizeImpl` still walks every pane
   * calling `ensureNotNull(paneWidget._leftPriceAxisWidget())`, the pane that has
   * no left scale any more answers `null`, and the THROW happens inside
   * `_drawImpl` — so the canvas keeps its LAST GOOD FRAME and nothing afterwards
   * paints. MEASURED 2026-09-18 in the live pane harness: volume bars deleted with
   * an MA of Volume still in the pane, and the chart went on showing the bars it
   * no longer had, through every later edit and every resize.
   *
   * ⛔ CALLED FROM BOTH EXITS, AND THE DISABLED ONE IS NOT OPTIONAL. Deleting the
   * last instance takes `sync` down the `enabled === false` path, which returns
   * before the scale writes — so the tenant leaves and the axis it turned on
   * stays on.
   *
   * ⭐ THE ANSWER COMES FROM THE PLACEMENTS, not from settings and not from the
   * volume predicate: the question is "did anything this sync place on `'left'`".
   *
   * ⚠️ IDEMPOTENT AND GUARDED: `applyOptions` with the value already in force is a
   * no-op merge, and the read is skipped entirely on an API that cannot answer.
   *
   * @param {boolean} want is anything bound to `'left'` right now
   */
  function assertLeftAxis(want) {
    try {
      if (typeof chart.options !== 'function' || typeof chart.applyOptions !== 'function') return
      const cur = chart.options()?.leftPriceScale?.visible
      // ⛔⛔ A CHART THAT CANNOT ANSWER GETS NO CALL — `undefined !== false` IS NOT
      // A DIFFERENCE. This is the DARK CONTRACT ("zero calls of any kind"), which
      // fifteen parity ledgers assert by COUNTING the renderer calls a sync makes.
      // A loose `cur !== want` fires on every one of their doubles, which report no
      // options at all, and lands an `applyOptions` in a list whose whole point is
      // that it is two entries long. Read a real boolean or do nothing.
      if (typeof cur !== 'boolean' || cur === want) return
      chart.applyOptions({ leftPriceScale: { visible: want } })
    } catch { /* older API — the axis stays as it was, which is today's behaviour */ }
  }

  function releaseAll() {
    for (const b of held) attempt(() => chart.removeSeries(b.series))
    held = []
    computeMemo = new Map()
    pointMemo = new Map()
    pendingLayout = null
    pendingLaidOut = false
    mismatchRun = 0
  }

  /**
   * Give every pane the height the layout asked for, and arm the check.
   *
   * Plan §A7: the factors ARE the pixel heights, because LWC distributes the
   * available height in proportion to them — measured, not assumed, in
   * `__tests__/paneSeparatorPin.test.js`.
   */
  function applyPaneStretch(layout) {
    const panes = attempt(() => chart.panes())
    if (!panes.ok || !Array.isArray(panes.value) || !panes.value.length) return
    const list = panes.value
    const current = list.map((p) => {
      const v = attempt(() => p.getStretchFactor())
      return v.ok && Number.isFinite(v.value) ? v.value : 0
    })
    const want = paneStretchPlan(layout, current)
    for (let i = 0; i < list.length; i++) {
      if (want[i] === current[i]) continue
      attempt(() => list[i].setStretchFactor(want[i]))
    }
    pendingLayout = layout
    pendingLaidOut = false
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => { pendingLaidOut = true })
    } else {
      // No frame loop to wait for (a non-browser host). The check is a renderer
      // claim; without a renderer there is nothing to check.
      pendingLayout = null
    }
  }

  /**
   * ⛔ REPORTS BY NAME. IT DOES NOT THROW — see the D2 note on `pendingLayout`.
   *
   * A disagreement gets ONE re-apply (`pendingRetries`), which is what actually
   * fixes the measured transient. Only a drift that survives its own correction
   * is recorded, and it is recorded loudly enough to attribute and cheaply enough
   * that a chart still draws.
   */
  function verifyPendingLayout() {
    if (!pendingLayout || !pendingLaidOut) return
    const layout = pendingLayout
    const message = paneHeightMismatch(chart, layout)
    if (!message) {
      pendingLayout = null
      pendingLaidOut = false
      mismatchRun = 0
      return
    }
    mismatchRun += 1
    if (mismatchRun === 1) {
      // ── converge ──
      // ⚠️ AND THE FIRST SYNC OF EVERY CHART LANDS HERE, BY CONSTRUCTION.
      // `paneStackHeightPx` is itself rAF-stale: on a two-pane chart it reads the
      // panes BEFORE the renderer has sized them, so the very first layout is
      // computed against a chart height that is a pixel or two out. MEASURED in
      // `flipCGeometry.test.jsx` — a real 400 px chart reports 401 on the first
      // read. That is a FOURTH face of the same rAF blindness, it is unavoidable
      // without blocking a frame inside the paint, and it is precisely what the
      // old `throw` turned into a blank chart on cold load.
      applyPaneStretch(layout)
      return
    }
    // ── it survived its own correction ──
    pendingLayout = null
    pendingLaidOut = false
    mismatchRun = 0
    recordPaneHeightAlert(message)
  }

  function sync(ctx) {
    // The renderer has had a frame with the last layout: did it keep it?
    if (paneMode() === 'panes') verifyPendingLayout()

    // ── The switch. ABSENT MEANS OFF: dark is the default, never something a
    //    caller has to remember to ask for. ──
    //
    // ⭐ B5 TASK 4 — THE `cs` FALLBACK IS GONE. This read
    // `ctx.enabled !== undefined ? ctx.enabled : ctx.cs && ctx.cs.engineEnabled`,
    // so a caller that passed no `enabled` fell back to the settings blob's flag.
    // That flag is deleted, and the fallback would have resolved to `undefined` —
    // i.e. permanently OFF — for any such caller, which is a silently dark engine
    // rather than an explicit one. `StockChart` has always passed `enabled`
    // explicitly, so this is behaviour-identical; what changes is that "the caller
    // forgot" is now indistinguishable from "the caller said no", which is exactly
    // what ABSENT MEANS OFF promises.
    const enabled = Boolean(ctx) && ctx.enabled === true
    if (!enabled) {
      // A flag that flips OFF at runtime must not leave ghosts behind. When
      // nothing is held this is still zero calls, so the dark contract holds.
      if (held.length) releaseAll()
      // ⛔ THE TENANT IS GONE, SO THE AXIS GOES. See `assertLeftAxis` — deleting
      // the last indicator arrives HERE, not at pass two.
      assertLeftAxis(false)
      return { ok: false, reason: 'engine disabled', bound: 0, released: 0 }
    }

    const registry = ctx.registry
    const resolvePlacement = ctx.resolvePlacement
    if (!registry || typeof resolvePlacement !== 'function') {
      return { ok: false, reason: 'no placement resolver', bound: 0, released: 0 }
    }

    const bars = Array.isArray(ctx.bars) ? ctx.bars : []
    const adjustTime = typeof ctx.adjustTime === 'function' ? ctx.adjustTime : (t) => t
    const plan = ctx.plan || {}
    const planMode = plan.fresh ? 'fresh' : plan.incr ? 'incr' : plan.noop ? 'noop' : 'fresh'
    const instances = Array.isArray(ctx.instances) ? ctx.instances : []

    // ── 1. Compute every column ONCE, before any decision needs one ──
    //
    // The pane-existence test (trap #4) is `hasAnyFinite` over the column, not
    // `.length`, and the planner needs the answer — so the compute has to happen
    // first. A definition whose compute throws is skipped: an indicator that
    // cannot be computed must not take the paint down with it.
    const columns = new Map()
    const computedIds = new Set()

    // ⭐⭐ BARS FOR ANY CANONICAL SYMBOL AN INSTANCE NAMES, AS DATA. The binder
    // never fetches — `sync` runs inside a paint — so this arrives already
    // resolved, exactly as `bars` does. Absent is not an error: it is a chart
    // with no symbol sources, and every lookup simply misses.
    const secondary = ctx.secondary && typeof ctx.secondary.get === 'function'
      ? ctx.secondary : null

    // ⛔⛔ DEPENDENCY ORDER, NOT ARRAY ORDER. The loop below used to walk
    // `instances` as stored — which is the order they were ADDED — and that was
    // correct only by accident: a definition reading another instance's output
    // would compute against a column that did not exist yet and silently draw
    // nothing. `orderByDependency` is Kahn's algorithm over the edges that exist
    // and nothing more; a cycle is REPORTED rather than sorted around, and the
    // ids in it are refused below instead of spun on.
    const { ordered, cyclic } = orderByDependency(instances, (id) => registry.getDefinition(id))

    // ── WHO IS READ BY SOMEBODY ELSE ─────────────────────────────────
    //
    // ⛔⛔ VISIBILITY IS INK, NOT EXISTENCE. The hidden-skip below exists because
    // computing what nobody draws is a full pass over the bar set for nothing —
    // and that stays true for a hidden instance nobody reads, and STOPS being
    // true the moment one does. Hiding a QQQ series must not silently take
    // `MA(QQQ)` down with it: the eye icon is about what is DRAWN.
    const dependedOn = new Set()
    for (const inst of instances) {
      if (!inst || inst.hidden === true) continue
      const idef = registry.getDefinition(inst.defId)
      for (const [, value] of sourceInputsOf(idef, inst)) {
        const parsed = parseSource(value)
        if (parsed && parsed.kind === 'instance') dependedOn.add(parsed.instanceId)
      }
    }

    for (const inst of ordered) {
      if (!inst || typeof inst.instanceId !== 'string') continue
      // A HIDDEN instance is computed by NOBODY. `planBindings` drops it on its
      // first line (`if (inst.hidden === true) continue`), before it ever asks
      // `hasData`, so every cycle spent here was thrown away — and it was not
      // free: it is a full indicator pass over the whole bar set, on the main
      // thread, inside `updateChart`. B3's Flip-A visibility projection makes
      // `hidden` the COMMON state — every migrated indicator whose legacy toggle
      // is off carries a hidden instance — so this stopped being a rounding
      // error. MEASURED while chasing an unrelated capture flake: the pass
      // shifted the headless screenshot enough to change the dashed last-price
      // line's antialiasing on one scanline. It did not fully explain that flake
      // (see the runbook's "a diff confined to one scanline" note), but it was
      // wasted work either way.
      if (inst.hidden === true && !dependedOn.has(inst.instanceId)) continue
      const def = registry.getDefinition(inst.defId)
      if (!def) continue
      computedIds.add(inst.instanceId)

      // ⛔ A CYCLE COMPUTES NOTHING. It is not an error the member can see yet,
      // but it is never a partial answer either: the instance is skipped whole.
      if (cyclic.has(inst.instanceId)) continue

      // ── THE SOURCE, RESOLVED INTO A NUMERIC SERIES ───────────────────────
      //
      // Three families, and the definition never learns which one it got:
      //   a BAR FIELD  — read off the chart's own bars.
      //   an INSTANCE  — a lookup in `columns`, which the dependency order above
      //                  guarantees is already filled. The key is the same string
      //                  `bindingKey` writes, so a source reference and a computed
      //                  column cannot drift apart.
      //   a SYMBOL     — projected from the canonical secondary bar bundle.
      //
      // ⛔⛔ AN UNSUPPLIED SYMBOL IS `null`, WHICH IS NOT-COMPUTABLE — NEVER THE
      // CHART'S OWN BARS. Falling back to the bars in hand would answer
      // confidently about the WRONG INSTRUMENT, which is the one failure here
      // that looks exactly like success.
      let sourceCols = null
      let sourceSig = ''
      for (const [key, value] of sourceInputsOf(def, inst)) {
        const parsed = parseSource(value)
        let series = null
        if (parsed && parsed.kind === 'bar') series = barFieldSeries(bars, parsed.field)
        else if (parsed && parsed.kind === 'instance') {
          series = columns.get(bindingKey(parsed.instanceId, parsed.plotKey)) || null
        } else if (parsed && parsed.kind === 'symbol') {
          const entry = secondary ? secondary.get(parsed.symbol) : null
          const secBars = entry && Array.isArray(entry.bars) && entry.bars.length ? entry.bars : null
          // ⭐ EXACT-t ALIGNMENT, NO FORWARD FILL — `projectionFor` aligns the
          // secondary's own timestamps to the chart's and leaves a missing bar as
          // a GAP. A hole is the truth; a carried-forward value is a price that
          // never traded.
          series = secBars ? projectionFor(secBars, parsed.field, bars) : null
        }
        sourceCols = sourceCols || {}
        sourceCols[key] = series
        // ⭐ THE COLUMN'S IDENTITY IS THE INVALIDATION KEY, and it costs nothing.
        // A recomputed source is a NEW array, so the consumer's memo misses and it
        // recomputes; a source that only changed COLOUR or PANE returns the very
        // same array from its own memo, so the consumer hits and does not. The
        // dependency invalidation rule is therefore not a rule anybody has to
        // maintain — it is object identity.
        sourceSig += `${key}${value}`
        if (series) {
          if (!series.__srcId) {
            SOURCE_SERIAL += 1
            try { Object.defineProperty(series, '__srcId', { value: SOURCE_SERIAL, enumerable: false }) }
            catch { /* a frozen column keeps its place in the signature below */ }
          }
          sourceSig += `#${series.__srcId || 0}`
        }
      }
      // ⛔ THE PRIMARY SOURCE IS THE FIRST DECLARED ONE. `ctx.source` is what a
      // single-source definition reads; `ctx.sources` carries them all by input
      // key for the day one takes two.
      const primarySource = sourceCols ? sourceCols[Object.keys(sourceCols)[0]] : null

      const sig = inputsSignature(inst.inputs) + sourceSig
      const memo = computeMemo.get(inst.instanceId)
      let cols
      if (memo && memo.registry === registry && memo.def === def && memo.bars === bars && memo.sig === sig) {
        cols = memo.cols
      } else {
        // ⭐ `{sym, tf}` is the SERVER LANE's only requirement (Phase C Task 13).
        // A native ignores it entirely; a `compute.kind: 'server'` definition
        // cannot be fetched without it, and passing nothing would leave the RS
        // line registered, enabled and permanently blank — a definition that
        // lies. It rides the ctx rather than a module global on purpose: a
        // 16-cell Multi-Chart grid has sixteen symbols and one module.
        const r = attempt(() => registry.computeFor(def, bars, inst.inputs,
          { sym: ctx.sym, tf: ctx.tf, source: primarySource, sources: sourceCols }))
        if (!r.ok || !r.value) { computeMemo.delete(inst.instanceId); continue }
        cols = r.value
        // ⛔ AN EMPTY COLUMN SET IS NOT MEMOIZED. Every native returns at least
        // one column, so this can only be the server lane answering "the fetch
        // has not landed yet" — and remembering that answer against an unchanged
        // (def, bars, inputs) key would pin the indicator blank until the bars
        // array changed for some unrelated reason.
        if (Object.keys(cols).length) {
          computeMemo.set(inst.instanceId, { registry, def, bars, sig, cols })
        } else {
          computeMemo.delete(inst.instanceId)
        }
      }
      // ── THE CANDLE PAYLOAD, IF THIS OUTPUT ASKED FOR ONE AND MAY HAVE IT ───
      //
      // ⛔ IT ANSWERS `null` UNLESS EVERYTHING AGREES: the output's resolved
      // presentation is `candles`, the source is a canonical SYMBOL, and
      // `ohlcCapabilityOf` says that symbol's PROVIDER FAMILY means an auction
      // period by those four fields. Absent `ctx.ohlcFamilyOf` nothing is
      // capable — fail closed, because "not classified yet" must never read as
      // "ordinary security".
      const ohlcBarsForPlot = (definition, instance, plotKey) => {
        const declared = sourceInputsOf(definition, instance)
        if (!declared.length) return null
        const parsed = parseSource(declared[0][1])
        if (!parsed || parsed.kind !== 'symbol') return null
        const entry = secondary ? secondary.get(parsed.symbol) : null
        const cap = ohlcCapabilityOf(definition, parsed, entry, ctx.ohlcFamilyOf)
        if (!cap.ok) return null
        const plot = (definition.plots || []).find((pl) => pl && pl.key === plotKey)
        if (!plot) return null
        // ⛔ THE SAME RESOLUTION THE PLAN MADE, with the same capability answer —
        // a stored `candles` the source cannot mean is clamped to a line in both
        // places, so the series type and its payload can never disagree.
        if (resolvePlotStyle(instance, plot, { ohlcCapable: true }) !== 'candles') return null
        return clippedBarsFor(entry.bars, bars)
      }

      for (const plotKey of Object.keys(cols)) {
        // ⭐⭐ THE ONE PLACE A BINDING BECOMES COMPOUND. The column above was
        // computed exactly as it always is — this does not replace a CALCULATION,
        // it replaces what the RENDERER is handed for an output whose presentation
        // asked for candles and whose source can mean them. Everything upstream
        // (the projection, `computeFor`, the memo) is untouched, which is why
        // `MA(QQQ)` and a QQQ line are byte-identical.
        const ohlcBars = ohlcBarsForPlot(def, inst, plotKey)
        columns.set(bindingKey(inst.instanceId, plotKey),
          ohlcBars ? ohlcPayload(ohlcBars) : cols[plotKey])
      }
    }
    for (const id of computeMemo.keys()) if (!computedIds.has(id)) computeMemo.delete(id)

    const hasData = (key) => {
      const col = columns.get(key)
      // ⭐ "IS THERE ANYTHING TO DRAW" HAS TWO SHAPES NOW. `hasAnyFinite` walks a
      // numeric column and would read an OHLC payload as EMPTY — which would drop
      // the binding before the renderer ever saw it, silently, with the bars
      // sitting right there in the cache.
      if (isOhlcPayload(col)) return col.bars.some(barHasOhlc)
      return col !== undefined && registry.hasAnyFinite(col)
    }

    // ── 2. Ask the pool what should happen ──
    // ⭐⭐ ONE CAPABILITY ANSWER PER INSTANCE, ASKED ONCE AND SHARED. The plan
    // needs it (a `candles` style decides the SERIES TYPE), the style resolution
    // needs it (the clamp refuses what the source cannot mean), and the payload
    // production needs it. Three readers of one answer, so they cannot disagree
    // about whether a member's stored style is honoured.
    const ohlcCapableFor = (instance) => {
      const idef = registry.getDefinition(instance && instance.defId)
      if (!idef) return false
      const declared = sourceInputsOf(idef, instance)
      if (!declared.length) return false
      const parsed = parseSource(declared[0][1])
      if (!parsed || parsed.kind !== 'symbol') return false
      const entry = secondary ? secondary.get(parsed.symbol) : null
      return ohlcCapabilityOf(idef, parsed, entry, ctx.ohlcFamilyOf).ok
    }
    const { bind, release } = planBindings(instances, registry, held, {
      hasData,
      ohlcCapable: ohlcCapableFor,
      // ⭐ THE MEMBER'S OWN UP/DOWN, straight off the settings blob this sync was
      // already handed. `applyThemeToSettings` writes `cs.candles` when a UCT
      // Chart Theme is chosen, so a signed histogram that stores no colour of its
      // own follows the theme for free — one palette, not a second one.
      candles: (ctx.cs && ctx.cs.candles) || null,
    })

    // HAND-BACK (W1b.5, minor 4): reassign a hidden carrier's guides onto its
    // instance's first VISIBLE plot BEFORE the hidden-plot skip below ever
    // sees them — see `reassignOrphanedGuides`.
    reassignOrphanedGuides(bind)

    // ── 3. Free first, so a create later in the pass can reuse the slot the
    //       renderer just gave back. (The planner has already guaranteed nothing
    //       released here could have been reused, so this is ordering hygiene
    //       rather than a second policy.) ──
    for (const b of release) attempt(() => chart.removeSeries(b.series))

    // ── 4. Bind ──
    //
    // A binding that cannot resolve draws nothing (fail-closed), but if it was
    // CARRYING a series — `source` 'same' or 'pooled' — that series must go back
    // to the renderer here. Dropping it from `held` without `removeSeries` would
    // leave it on the chart, unreachable by the pool AND by `teardown()`: still
    // drawing the previous tenant's numbers, for the life of the chart. Not
    // reachable with the native registry today (every def has a string id and
    // `normalizeInstances` validates `placement.target`), and it fails in the
    // wrong direction for a Phase C catalog definition, so it is closed now.
    const orphan = (b) => { if (b.series) attempt(() => chart.removeSeries(b.series)) }

    /** The column→LWC-points mapping, reused whenever nothing it depends on has
     *  moved. `adjustTime` is part of the key because it is what stamps every
     *  `time`; it is a stable `useCallback` in `StockChart`, so this hits. */
    const pointsFor = (b, column) => {
      // ⭐ ONE ADAPTER, TWO SHAPES. The memo is keyed on the payload's IDENTITY
      // exactly as it is on a column's, so a candle binding that did not change
      // re-uses its points for the same reason a line does.
      if (isOhlcPayload(column)) {
        const m0 = pointMemo.get(b.key)
        if (m0 && m0.column === column && m0.adjustTime === adjustTime) return m0.points
        const pts = toOhlcPoints(column, adjustTime)
        pointMemo.set(b.key, { column, bars, adjustTime, up: null, down: null, points: pts })
        return pts
      }
      const sc = signColorsForPlot(b.plot)
      const up = sc ? sc.up : null
      const down = sc ? sc.down : null
      const m = pointMemo.get(b.key)
      if (m && m.column === column && m.bars === bars && m.adjustTime === adjustTime
          && m.up === up && m.down === down) return m.points
      const points = toPoints(column, bars, adjustTime, sc)
      pointMemo.set(b.key, { column, bars, adjustTime, up, down, points })
      return points
    }

    /** Scale writes already made THIS sync — see TRAP #6 below. Keyed by pane,
     *  scale id AND payload, so a second definition wanting a DIFFERENT scale
     *  state on the same axis still gets its write. */
    const scalesWritten = new Set()

    // ── TRAP #5: EVERY SERIES ON A SCALE MUST EXIST BEFORE ANY OF THEM HAS
    //             DATA. Measured at B5 Task 8; it cost 11,913 changed pixels.
    //
    // See TRAP #6 below for the mechanism. Both halves are required and each was
    // measured INSUFFICIENT ALONE: creating all three of `adx`'s series up front
    // while the scale was still written per binding reads 11,913, and writing the
    // scale once while the siblings are still created between `setData` calls
    // reads 11,913 too. The shipped block does both, so the binder does both.
    //
    // Pass one CREATES (and relocates/restyles) every series; pass two writes the
    // scale, the guides and the data. Both walk `bind` in the same order, so
    // insertion order — which IS z-order — is unchanged.
    const prepared = []
    for (const b of bind) {
      // ⭐ W1b — `plots[].hidden`: COMPUTED, NEVER DRAWN. The column still reaches
      // the scan and the alert seam through `computeFor`; the chart gets no
      // series. A series this binding was carrying goes back to the renderer.
      if (b.plot && b.plot.hidden === true) { orphan(b); continue }
      const placement = attempt(() => resolvePlacement(b.inst, b.def, ctx))
      if (!placement.ok || !placement.value) { orphan(b); continue }
      const { paneIndex, scaleId, scaleOptions, autoscale, lastValue } = placement.value

      const options = seriesOptionsForPlot(b.plot, {
        scaleId,
        // B3 carry #1: a SERIES option that only PLACEMENT knows the answer to.
        // Placement returns a string; `pool` owns the two function singletons.
        autoscale,
        // The right-axis value tag — the same shape of answer as `autoscale`, and
        // for the same reason: whether a series may write on the axis it sits on
        // is a question about PLACEMENT, and `pool` has never been told where a
        // series landed.
        lastValue,
        LineStyle: LWC.LineStyle,
        LineType: LWC.LineType,
        // The declutter toggle (Alt+Shift+I). `visible` is part of the complete
        // option set, so without this the engine would re-show a hidden series on
        // the next paint — roughly once a second in extended hours.
        indicatorsHidden: ctx.indicatorsHidden === true,
        // ⭐ ONLY A CANDLE READS THESE, and resolving them HERE is what keeps the
        // chart's own palette the default: `cs.candles` is the member's candle
        // colour, so a secondary instrument wears it until they override it on
        // this instance. No new palette, no second source of truth.
        candleColors: b.poolKey === 'candlestick'
          ? resolveCandleColors(b.inst, b.plot, ctx.cs && ctx.cs.candles)
          : null,
      })
      if (!options) { orphan(b); continue }

      let series = b.series
      let guideHandles = (b.from && b.from.guideHandles) || []

      if (!series) {
        const ctor = LWC[SERIES_CTOR[b.poolKey]]
        const created = attempt(() => chart.addSeries(ctor, options, paneIndex))
        if (!created.ok || !created.value) continue
        series = created.value
        guideHandles = []
      } else {
        // ── THE #2049 ESCAPE ──
        // Pane and priceScaleId are both mutable on 5.2.0 (`moveToPane` /
        // `applyOptions` → `moveSeriesToScale`). The shipped code destroys and
        // recreates a series whenever its target scale changes, on the strength
        // of two comments that were true on 5.1.x. Mass `removeSeries` is the
        // 2-4 s main-thread block of lightweight-charts#2049.
        // ⚠️ A RELOCATION IS INVISIBLE TO THE Z-ORDER RAILS. `moveToPane` is
        // `removeDataSource` + `_addSeriesToPane`, which APPENDS — so a pooled
        // series that crosses panes lands on TOP of its new pane, and every
        // z-order test in `stockChartWiring.test.jsx` reads `addSeries` CALL
        // ORDER and cannot see that. (The pixel gate cannot either: every parity
        // case is a fresh page load and never photographs a transition.) Benign
        // while nothing crosses — `chart.addSeries` also appends, so an engine
        // create and a legacy create land in the same place — and the rail
        // 🔴 …EXCEPT THAT SOMETHING CROSSES NOW. This note used to end *"That day
        // is `vwap`/`sar`/`ichimoku`/`donchian`"*, and B5 Task 5 arrived first:
        // `stoch` and `atr` are pane oscillators that the VOLUME-OVERLAY toggle
        // moves between pane 0 and the volume pane, so this branch's
        // `series.moveToPane` fires on a live chart today. It is measured in
        // `stockChartWiring.test.jsx` → *"the VOLUME-OVERLAY path, mid-session"*,
        // which asserts the series is RELOCATED rather than destroyed (the
        // hand-written block recreated it) and that `H.moveToPaneCalls` is
        // non-empty. What is still true is the rest of this paragraph: the
        // z-order rails and the pixel gate are both blind to it, which is why the
        // expiry rail keeps its name and now says which fixture it speaks for.
        // ⚠️ AND `sar`/`ichimoku` ARE OFF THAT LIST AS OF B5 TASK 6: they are
        // PRICE overlays, which the volume-overlay toggle cannot move (the menu
        // offers it for pane oscillators only, and `migrateLegacyToInstances`
        // refuses to honour the list for a price target), so migrating them adds
        // no new crossing. `donchian` is the last price overlay and Task 8 is the
        // last chance for one.
        // ⚠️ AND THE LIST OF DEFINITIONS THAT *CAN* CROSS GREW AT B5 TASK 7. That
        // last sentence used to read *"the crossing that DOES happen is still the
        // volume-overlay one, on `stoch` and `atr`"* and Task 7 falsified it
        // without anything going red: `mfi`, `cci` and `williamsR` are PANE
        // oscillators too, so all five are eligible for `ensureIndTarget`'s
        // `volSeparatePane && volOverlaySet.has(key)` branch and all five can
        // relocate on a live chart.
        // ⭐⭐ AND B5 TASK 8 CLOSED THAT LIST: `adx` and `obv` joined, so it is
        // now EVERY PANE OSCILLATOR THERE IS — nine of them — and `donchian`
        // took the last price-overlay slot without adding a crossing (a price
        // target is still not movable by the volume-overlay toggle). The
        // MECHANISM is unchanged and so is the blind spot; only the count moved,
        // and it has stopped moving.
        //
        // ⭐⭐⭐ AND THE SUCCESSOR HAS ARRIVED (B5 Task 10). This paragraph used
        // to end *"⏳ WHAT REPLACES THE BLIND SPOT, AND WHEN … Task 10's PANE
        // MANIFEST is the successor"*. It exists: `paneLayout.paneManifest`
        // records, per pane, each series' pane index, `priceScaleId` and
        // INSERTION ORDER, and `tools/chart_parity.py` diffs it as JSON beside
        // the pixels under an UNCONDITIONAL rule no `expectProvenance` can wave
        // through. So a series that changed pane or z-position without changing a
        // pixel is a failure by definition — measured twice already, at B5 Task 8
        // (`donchian`'s three `scaleId`s at 0 px) and Task 9 (`cci -> williamsR`
        // at 0 px).
        //
        // ⚠️ WHAT IS STILL BLIND, PRECISELY: a MID-SESSION transition. Every
        // parity case is a fresh page load, so the manifest photographs the
        // settled chart and never the pass that relocated a series into it. The
        // expiry rail in `stockChartWiring.test.jsx` keeps its name for exactly
        // that, and `__tests__/flipCGeometry.test.jsx` drives the transition on a
        // REAL renderer — bands → panes on a live chart, asserting the SAME
        // series object ends up in the new pane with `toBe` and an empty
        // `removeSeries` list.
        if (b.from && b.from.paneIndex !== paneIndex) attempt(() => series.moveToPane(paneIndex))
        attempt(() => series.applyOptions(options))
      }

      prepared.push({ b, paneIndex, scaleId, scaleOptions, series, guideHandles })
    }

    // ⛔⛔ THE LEFT AXIS IS ASSERTED **BEFORE** ANY SCALE IS WRITTEN, and the order
    // is the whole of it. `series.priceScale().applyOptions({visible: true})` on a
    // `'left'` scale flips the chart-level flag WITHOUT recreating the pane
    // widgets, so the next draw walks panes that have no left axis widget yet and
    // throws out of `_adjustSizeImpl`. `chart.applyOptions` rebuilds them, so doing
    // it first means every pane is ready before the tenant arrives.
    //
    // MEASURED: asserting it after pass two instead produced exactly three
    // `Value is null` exceptions on the frame a member restores Volume beside a
    // guest — the chart recovered, and threw every time.
    assertLeftAxis(prepared.some((p) => p.scaleId === 'left'))

    // ── PASS TWO: freeze the scale, hang the guides, feed the data ──
    const next = []
    for (const p of prepared) {
      const { b, paneIndex, scaleId, scaleOptions, series } = p
      let { guideHandles } = p

      // ── TRAP #2: the FULL set, every SYNC, create branch or not ──
      //
      // `scaleOptions === null` means ASSERT NOTHING — a price overlay lands on
      // the candles' own axis and writing `scaleMargins` there would move the
      // candles. It used to reach `applyOptions(null)` anyway; that is a traced
      // no-op in 5.2.0 (`merge(dst, {rightPriceScale: null})` iterates nothing)
      // but it fired a full price-scale update on every bind and contradicted
      // placement's own docstring, so the guard says out loud what was meant.
      //
      // ── TRAP #6: ONCE PER SCALE PER SYNC, NOT ONCE PER BINDING ──
      //
      // 🔴 THIS READ *"every BIND"* AND IT COST 11,913 CHANGED PIXELS ON `adx`.
      // Measured on the two-build gate at B5 Task 8; the picture, the option
      // payloads, the pane manifest and the SERIES DATA were all identical, and
      // the ONLY difference was the frozen price range: the legacy build's `adx`
      // scale held **5.1746 … 59.0249** (the extent of all THREE lines) and the
      // engine's held **15.5154 … 59.0249** — the ADX line's own extent, exactly.
      //
      // `autoScale: false` does not compute anything (`PriceScale.applyOptions`
      // just `merge`s the flag, `…development.mjs:4541`); what it does is stop
      // `_internal_recalculatePriceScale` from ever running again (`:5456`). The
      // range is then materialised the first time anything asks for it, from the
      // sources that have data AT THAT MOMENT — and a `priceScale().applyOptions`
      // is one of the things that asks. The shipped block calls `applyIndScale`
      // **once**, before any of its series has data, so nothing is materialisable
      // and the range is computed at paint from all three. The binder called it
      // once per BINDING: the second call landed between `setData(adx)` and
      // `setData(plusDI)` and froze the scale on the ADX line alone.
      //
      // ⭐ WHY NOTHING CAUGHT IT UNTIL THE LAST MIGRATION. It is invisible unless
      // a definition puts SEVERAL series on ONE PINNED scale whose extents are
      // not nested. `stoch` is the only earlier one, and `%D` is a moving average
      // OF `%K`, so `%K`'s extent already contains it and freezing on `%K` alone
      // gives the same answer. `adx` is the first where it does not.
      //
      // ⭐ THE TRAP #2 GUARANTEE IS UNCHANGED. Its subject was always a POOLED
      // series inheriting a scale some earlier tenant left frozen, and that is a
      // claim about every SYNC, not about every binding within one. The repeats
      // were inert on the payload (this file's own tests called them so) and were
      // never inert on the ORDER.
      const scaleWriteKey = `${paneIndex}|${scaleId}`
      const scaleSig = scaleOptions ? scaleWriteKey + '|' + JSON.stringify(scaleOptions) : null
      if (scaleOptions && !scalesWritten.has(scaleSig)) {
        scalesWritten.add(scaleSig)
        attempt(() => series.priceScale().applyOptions(scaleOptions))
      }

      // ── TRAP #3: the previous tenant's guides ──
      //
      // Removed whenever the tenant CHANGED (`source !== 'same'`) or the guide
      // spec itself did. LWC has no "update this price line" — changing one means
      // removing and recreating it — so a signature comparison is what keeps this
      // from churning three price lines on every tick.
      const guidesChanged = b.source !== 'same' || b.guideSig !== (b.prevGuideSig || '')
      if (guidesChanged) {
        for (const handle of guideHandles) attempt(() => series.removePriceLine(handle))
        guideHandles = []
        for (const plot of b.guides) {
          for (const spec of guideSpecs(plot, LWC.LineStyle)) {
            const made = attempt(() => series.createPriceLine(spec))
            if (made.ok && made.value) guideHandles.push(made.value)
          }
        }
      }

      // ── TRAP #1: a first bind is setData, whatever the plan says ──
      const points = pointsFor(b, columns.get(b.key))
      if (firstBindNeedsSetData(b, planMode)) {
        attempt(() => series.setData(points))
      } else if (typeof ctx.applyData === 'function') {
        attempt(() => ctx.applyData(series, points))
      } else {
        attempt(() => series.setData(points))
      }

      next.push({
        key: b.key,
        instanceId: b.instanceId,
        defId: b.defId,
        plotKey: b.plotKey,
        poolKey: b.poolKey,
        series,
        guideHandles,
        guideSig: b.guideSig,
        paneIndex,
        scaleId,
        // The crosshair legend's developing-bar fallback — see `lastPointValue`.
        // Carried on the BINDING because that is the only place the column and
        // the series are both in hand; `readout.js` is pure and gets no other
        // route to the value legacy reads off `indicatorData`.
        lastValue: lastPointValue(points),
      })
    }

    // A binding that is gone takes its point array with it. Without this a symbol
    // flip would leave a 5,000-object array alive behind a key nothing will ever
    // ask for again — a memo that only grows is a leak wearing a cache's clothes.
    const boundKeys = new Set(next.map(n => n.key))
    for (const key of pointMemo.keys()) if (!boundKeys.has(key)) pointMemo.delete(key)

    held = next


    // ── PASS THREE (FLIP C ONLY): the panes get their heights ──
    //
    // AFTER the data, because an empty pane is a pane LWC has already sized and a
    // pane whose last series was removed is gone by now (measured: `removeSeries`
    // drops the pane synchronously), so this is the first point in the sync where
    // `chart.panes()` describes the stack the layout is talking about.
    if (paneMode() === 'panes' && ctx.paneLayout) applyPaneStretch(ctx.paneLayout)

    return { ok: true, bound: next.length, released: release.length }
  }

  /**
   * The bindings currently held, for a caller that must reach the series the
   * engine owns without owning them itself — today that is StockChart's
   * hide-all-indicators toggle, which hand-lists twenty-seven refs and carries an
   * in-code warning that a phantom name there crashed `/charts` for every user on
   * 2026-07-22 with no build-time check. Iterating a map removes that failure
   * class for everything the engine draws.
   *
   * A COPY of the list — a caller walking it must not be able to reorder or
   * truncate the binder's own state.
   */
  function bindings() { return held.slice() }

  return { sync, teardown: releaseAll, bindings }
}
