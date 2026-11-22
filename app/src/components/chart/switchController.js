// app/src/components/chart/switchController.js
//
// ─── ⭐⭐ THE SWITCH CONTROLLER: ONE CHART PAINTS A NEW SYMBOL WITHOUT A RENDER (imperative switch, stage 3) ────
//
// docs/charts/imperative-switch-design.md §3.3. One per chart, made by StockChart only when the switch is on
// (chart/imperativeSwitch.js; OFF, the default, makes none). It holds no render: only
//   • `ctx` and `frame`, what the chart's LAST React pass handed `applyFrame` (one frame, replaced by the next), and
//   • `view`, a small object the chart writes each commit: its recipes, what it refuses, and the few things about
//     the chart only the component can reach (its channel refs, its layer refs).
//
// `apply(sym)` builds the new symbol's frame, then runs the SAME `applyFrame` the React path runs. There is one
// copy of the series logic; this file only decides what frame to hand it.
//
// ⛔⛔ ALL OR NOTHING PER SWITCH, AND CORRECTNESS BEATS COVERAGE (owner's rule, 2026-11-21). `canApply` is yes only
// when the frame builds whole AND every name of the frame has a rule in FRAME_RULES below. Anything else is a
// refusal BY NAME, and that switch takes today's React path, unchanged. `diag` counts both, so the share of
// switches on this path is a number the harness reads, never an impression.
//
// ⛔ NO VALUE IS CARRIED FROM THE OLD SYMBOL UNLESS IT IS SYMBOL-INDEPENDENT. Every frame name is one of:
//   SAME     the same for every symbol this path accepts (a host prop, a setting, a value derived from settings
//            and the timeframe). What makes that true is the refusals: both symbols are the host's plain kind, no
//            ECON id, the settings are not clamped for either, the instance list does not follow the symbol.
//   NONE     carried only while it is its "nothing" value (null / empty / false); anything else REFUSES by name.
//   BUILT    made for the new symbol (the bars and what derives from them).
//   CLEARED  a per-symbol layer whose data only a render holds (the host's price lines, the signature zones, the
//            swing points): emptied in the frame, redrawn by its own React code at the body's render. That is
//            what the React path shows on its first frame when the data is not cached. The old symbol's lines
//            and zones are never drawn on the new candles.
//            ⭐ The metadata layers are NOT cleared blind: `view.metaFor(sym)` reads what the app already holds
//            for the new symbol (its name, its event markers, its listing date) and the pass draws THAT, so a
//            symbol the app has met is painted with its name and its badges in the frame. Likewise the member's
//            alert lines (`view.alertLines`: one alerts list for every symbol, filtered by the new one).
//   CHANNEL  the developing-bar channel: closed for the old symbol in `apply`, opened for the new one by the
//            React commit (the store subscription is the hook's; a second subscriber here would be a second
//            writer of the candle series).
// `switchController.rules.test.js` pins the table to `applyFrame`'s own list: a new frame name with no rule fails
// there, and at run time it refuses (`unruled:<name>`) instead of riding along.
//
// ⛔ CHART CHUNK ONLY. The handoff hook reaches a controller through a ref the widget hands both of them
// (`switchPort`), and imports nothing from here.

const SAME = 'same'
const NONE = 'none'
const BUILT = 'built'
const CLEARED = 'cleared'
const CHANNEL = 'channel'

/** Is this value "nothing"? null / undefined / false / '' / an empty array, Map, Set or plain object. */
export function isNone(v) {
  if (v == null || v === false || v === '') return true
  if (Array.isArray(v)) return v.length === 0
  if (v instanceof Map || v instanceof Set) return v.size === 0
  if (typeof v === 'object') return Object.keys(v).length === 0
  return false
}

const NO_LINES = Object.freeze([])
const NO_MARKERS = Object.freeze([])
const NO_ZONES = Object.freeze([])
const NO_POINTS = Object.freeze([])
const NO_DEV = Object.freeze({ tail: () => null, dev: () => null, sym: () => null })
const NO_PAINT = () => {}

/**
 * ONE RULE PER FRAME NAME. `kind` as above; a NONE row names its refusal; a BUILT row says where the value comes
 * from (`b` = what `build` assembled for the new symbol); a CLEARED / CHANNEL row gives the value handed instead.
 */
export const FRAME_RULES = Object.freeze({
  // ── the symbol itself, and what is derived from its bars ──
  sym: { kind: BUILT, from: (b) => b.sym },
  _exKey: { kind: BUILT, from: (b) => b.exKey },
  __heavy: { kind: BUILT, from: (b) => b.box },
  volMaData: { kind: BUILT, from: (b) => b.frame.volMaData },
  overlayData: { kind: BUILT, from: (b) => b.overlayData },
  sessionShadeBands: { kind: BUILT, from: (b) => b.shadeBands },
  historyFromListing: { kind: BUILT, from: (b) => b.listing.historyFromListing },
  listingUnserved: { kind: BUILT, from: (b) => b.listing.listingUnserved },
  symbolMeta: { kind: BUILT, from: (b) => b.symbolMeta },
  // ── per-symbol layers: emptied in the frame ──
  allPriceLines: { kind: CLEARED, value: () => NO_LINES },
  mergedMarkers: { kind: BUILT, from: (b) => b.meta.mergedMarkers || NO_MARKERS },
  dpZones: { kind: CLEARED, value: () => NO_ZONES },
  swingPoints: { kind: CLEARED, value: () => NO_POINTS },
  fadeCutoff: { kind: CLEARED, value: () => null },
  // ── the developing-bar channel ──
  _paintStoreDev: { kind: CHANNEL, value: () => NO_PAINT },
  devOnScreen: { kind: CHANNEL, value: () => NO_DEV },
  // ── carried only while "nothing" ──
  _econId: { kind: NONE, why: 'econ' },
  _hasOverride: { kind: NONE, why: 'bars-override' },
  _overlayActive: { kind: NONE, why: 'comparison' },
  _pinnedFull: { kind: NONE, why: 'pinned-range' },
  candleFrameFade: { kind: NONE, why: 'frame-fade' },
  comparisonData: { kind: NONE, why: 'comparison' },
  entryDate: { kind: NONE, why: 'entry-date' },
  exactDateRange: { kind: NONE, why: 'exact-range' },
  exitDate: { kind: NONE, why: 'exit-date' },
  replayCutoff: { kind: NONE, why: 'replay' },
  replayMode: { kind: NONE, why: 'replay' },
  sessionCandleActive: { kind: NONE, why: 'session-candle' },
  sessionPreviewLastBar: { kind: NONE, why: 'session-preview' },
  studioPreview: { kind: NONE, why: 'studio-preview' },
  watermark: { kind: NONE, why: 'watermark-label' },
  wmPending: { kind: NONE, why: 'watermark-drag' },
  calcFrames: { kind: NONE, why: 'sources' },
  economicSources: { kind: NONE, why: 'sources' },
  fundamentalSources: { kind: NONE, why: 'sources' },
  lowerTfSources: { kind: NONE, why: 'sources' },
  marketCapAuthoritySources: { kind: NONE, why: 'sources' },
  secondarySources: { kind: NONE, why: 'sources' },
  strategyHistoryWindow: { kind: NONE, why: 'strategy-window' },
  strategyListingDepth: { kind: NONE, why: 'strategy-window' },
  strategyWindowPending: { kind: NONE, why: 'strategy-window' },
  // ── the same for every symbol this path accepts ──
  // settings and what derives from them (the settings object is proven the same for both symbols: `view.refuse`
  // and `view.symbolRefusal` say `settings-clamped` / `instances-follow-symbol` otherwise)
  cs: { kind: SAME }, csView: { kind: SAME }, themeColors: { kind: SAME }, axisAuto: { kind: SAME },
  breadthLineColor: { kind: SAME }, separatorColors: { kind: SAME }, canvasTheme: { kind: SAME },
  mbUp: { kind: SAME }, mbDown: { kind: SAME }, mbUpOpaque: { kind: SAME }, mbVolUp: { kind: SAME }, mbVolDown: { kind: SAME },
  resolvedOverlays: { kind: SAME }, rightPadBars: { kind: SAME }, showExtended: { kind: SAME }, showVolume: { kind: SAME },
  swingLabelsOn: { kind: SAME }, volMaPeriodEff: { kind: SAME }, volumePaneExists: { kind: SAME },
  _h24: { kind: SAME }, _tzId: { kind: SAME }, _shadeOn: { kind: SAME }, _study: { kind: SAME },
  userDefsGeneration: { kind: SAME }, binderNoticeScope: { kind: SAME },
  // the timeframe and what derives from it alone (a switch keeps the timeframe; a custom one is `not-plain`)
  resolvedTf: { kind: SAME }, isIntraday: { kind: SAME }, _intradayLike: { kind: SAME },
  // chart state that is the chart's, not the symbol's
  _plotWindowFullKey: { kind: SAME },   // compared with the new key inside the pass, so an old key reads "not full"
  sessionExtReady: { kind: SAME },      // read only with a session candle, which is `session-candle`
  liveUpdates: { kind: SAME },          // a host prop; its one reader in the pass asks the (closed) channel first
  // inert on this path: read only by the legacy live writers, which the bar store source switches off (`legacy-live`)
  _liveSane: { kind: SAME }, livePrices: { kind: SAME },
  // functions over the chart's refs and its settings
  adjustTime: { kind: SAME }, _extendOverlaysLive: { kind: SAME }, applyAverageZOrder: { kind: SAME },
  buildCrosshairOpts: { kind: SAME }, ema9CandleColorFor: { kind: SAME }, mainPriceScale: { kind: SAME },
  pinPriceChrome: { kind: SAME }, otherSymbolExchangeOf: { kind: SAME },
  anchorOwnsFrame: { kind: SAME }, applyAnchorFrame: { kind: SAME },   // an anchored chart is `anchor` (view.refuse)
  // host props (the host's plain kind for both symbols: `host-symbol` otherwise)
  axisFloor: { kind: SAME }, blankVolume: { kind: SAME }, boldCandles: { kind: SAME }, carryDragPlacement: { kind: SAME },
  centerWatermarkOnPlot: { kind: SAME }, chartId: { kind: SAME }, colorByNetChange: { kind: SAME }, compactAxes: { kind: SAME },
  dailyDefaultBars: { kind: SAME }, ema9MatchCandle: { kind: SAME }, fitPriceToCandles: { kind: SAME },
  frameRightPadFrac: { kind: SAME }, frozen: { kind: SAME }, hideLastValue: { kind: SAME }, hidePriceLine: { kind: SAME },
  hideWatermark: { kind: SAME }, indexPaneHeightPct: { kind: SAME }, keepPresentOnSymbolChange: { kind: SAME },
  leftBarPad: { kind: SAME }, modelBookLook: { kind: SAME }, priceScaleBottomMargin: { kind: SAME },
  priceScaleTopMargin: { kind: SAME }, subtleSeparator: { kind: SAME }, tickLabelChars: { kind: SAME },
  userCandleColors: { kind: SAME }, visibleBarsOverride: { kind: SAME }, volumeLastValue: { kind: SAME },
  volumePaneByDefault: { kind: SAME }, volumePaneHeightPct: { kind: SAME }, volumeSeparatePane: { kind: SAME },
  vwapOverride: { kind: SAME }, watermarkBrandMark: { kind: SAME }, watermarkCenterX: { kind: SAME },
  watermarkOpacity: { kind: SAME }, watermarkPad: { kind: SAME }, watermarkPadTop: { kind: SAME },
  watermarkX: { kind: SAME }, watermarkY: { kind: SAME },
})

const blankDiag = () => ({
  asked: 0,            // questions answered: ALWAYS `applied` + the sum of `refused`
  applied: 0,          // switches painted here (a replay of React's own frame included: `replayed`)
  refused: {},         // reason -> count. `group-veto`: a frame this chart built that a sibling's no kept unpainted;
                       // `round`: a switch the handoff's round showed (the round never paints: its label lands a task later)
  replayed: 0,         // switches back to the symbol React still showed: the chart's own pass, no built frame
  released: 0,         // the body's holds released by the handoff (one per paint that was not overtaken)
  lateBoxReads: 0,     // reads of a built frame's box AFTER its pass: a closure the pass installed kept it (must be 0)
  tail: {},            // the candles' tail of each applied switch: none / whitespace
  catchUp: { noop: 0, repaint: 0 },   // the React pass after a switch: handed the renderer nothing / painted again
  stale: 0,            // React passes of the old symbol skipped while a switch was pending
  views: 0,            // commits of the chart's body (each writes its view): a switch that adds none rendered nothing
  heldViews: 0,        // …of them, while a switch was pending with the body still on the OLD symbol (the held body
                       // rendered: in the key's task that is the cost the switch exists to move; should stay 0)
  // the key's task as this chart sees it, for switches the key handler's decision asked: from this chart's question
  // (`canApply`, the decision's first loop) to the end of its paint (`paint`), and to the end of the task after its
  // microtasks, where React's synchronous render of the label runs (`task`). The last KEY_TASK_RING of each, in ms,
  // and their medians.
  keyTask: { n: 0, paint: [], task: [], paintMedian: null, taskMedian: null },
  last: null,          // { sym, ok, why }
})

const KEY_TASK_RING = 32
const median = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const pushRing = (xs, v) => { xs.push(v); if (xs.length > KEY_TASK_RING) xs.shift() }
const defaultNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())
/** Microtask hops after a paint before the task's end is read: React's sync render is a microtask queued later. */
const TASK_END_HOPS = 3

/**
 * @param {{applyFrame: Function, buildFrame: Function, now?: Function}} deps  StockChart's pass and
 *   switchFrame.buildFrame; `now` (ms) for the key-task timing, `performance.now` by default
 */
export function createSwitchController({ applyFrame, buildFrame, now = defaultNow }) {
  let ctx = null
  let frame = null       // the last frame a React pass handed over (the symbol React shows)
  let view = null
  let pending = null     // { sym, tf, fromSym }: painted here, React not there yet
  let appliedKey = null
  const subs = new Set()
  const diag = blankDiag()
  let open = null        // a frame `canApply` built that has not been painted: { sym }
  const refuse = (sym, why) => {
    diag.asked += 1
    diag.refused[why] = (diag.refused[why] || 0) + 1
    diag.last = { sym, ok: false, why }
    return { ok: false, why }
  }
  /** A yes that was never painted was a sibling's veto of the group's decision, unless the same symbol is asked
   *  again (the round, for the same press): then it is one question, answered when that one is. */
  const settleOpen = (sym) => {
    if (open && open.sym !== sym) refuse(open.sym, 'group-veto')
    open = null
  }
  const publish = (key) => {
    appliedKey = key
    for (const fn of [...subs]) { try { fn(appliedKey) } catch { /* one reader never blocks the rest */ } }
  }
  /**
   * ⛔ BACK TO THE SYMBOL REACT STILL SHOWS. A switch was painted here (`pending`), the chart's body is still
   * rendered with the symbol it replaced, and that symbol is wanted again. Its body will not render (its prop
   * does not change), so nothing would ever end the pending switch: the canvas would keep the painted symbol
   * under the old one's label, every later pass skipped as stale. So the switch ends HERE, and the chart's own
   * pass of the symbol React shows runs again, in full: its candles, its lines, its markers, its name.
   */
  const replay = () => {
    pending = null
    ctx.lastCfgSigRef.current = null       // the next pass is a full one…
    ctx.prevPaintBarsRef.current = null    // …whatever was painted in between
    // (review round 2, L1) the server-compute lane heard the painted symbol in `apply`; the body's `sym` never
    // changes back, so its own effect will not tell the lane again. Told here first, as on any switch.
    view.laneShows(frame.sym)
    view.reactRepaint()
    diag.replayed += 1
    publish(frame && typeof frame._exKey === 'string' ? frame._exKey : null)
  }

  /** A decided switch's key task: `paint` now, `task` once the task's microtasks (React's sync render) have run. */
  const timeKeyTask = (t0) => {
    const paintMs = now() - t0
    let hops = TASK_END_HOPS
    const step = () => {
      if (--hops > 0) { Promise.resolve().then(step); return }
      const k = diag.keyTask
      k.n += 1
      pushRing(k.paint, paintMs)
      pushRing(k.task, now() - t0)
      k.paintMedian = median(k.paint)
      k.taskMedian = median(k.task)
    }
    Promise.resolve().then(step)
  }

  /** Everything the new symbol's pass will be handed, or the refusal. Touches no chart. */
  function build(sym) {
    if (!ctx || !frame || !view) return refuse(sym, 'no-pass')
    if (!ctx.chartRef.current || !ctx.candleSeriesRef.current) return refuse(sym, 'no-chart')
    if (!sym || typeof sym !== 'string') return refuse(sym, 'no-symbol')
    // the symbol React still shows is never refused and never built: it is replayed (see `replay`)
    if (pending && sym === pending.fromSym) return { ok: true, sym, replay: true, view }
    if (sym === (pending ? pending.sym : frame.sym)) return refuse(sym, 'same-symbol')
    // the render React last committed must be the one whose pass we hold (a commit whose pass has not run yet
    // would make `frame` a symbol behind `view`)
    if (view.sym !== frame.sym || view.tf !== frame.resolvedTf) return refuse(sym, 'pass-behind')
    if (view.refuse) return refuse(sym, view.refuse)
    const symWhy = view.symbolRefusal(sym)
    if (symWhy) return refuse(sym, symWhy)
    if (view.recipes.adjustTime !== frame.adjustTime) return refuse(sym, 'recipes-behind')
    const snapshot = view.snapshot(sym)
    const built = buildFrame(snapshot, { sym, tf: view.tf, showExtended: view.showExtended }, view.recipes)
    if (!built.ok) return refuse(sym, `frame:${built.why}`)
    const tail = view.tail(built, sym, snapshot)
    if (!tail.ok) return refuse(sym, tail.why || 'tail')
    // ⛔ the chart's key for the new symbol is DERIVED from the chart's own key (its symbol swapped), never
    // spelled a second time here (rails/oneKey.census: one owner per key shape)
    if (typeof frame._exKey !== 'string' || !frame._exKey.startsWith(frame.sym)) return refuse(sym, 'key-shape')
    const b = {
      sym,
      tf: view.tf,
      exKey: sym + frame._exKey.slice(frame.sym.length),
      frame: built,
      tail,
      overlayData: view.overlayData(built.sessionAppliedBars),
      shadeBands: view.shadeBands(built.filteredBars),
      listing: view.listing(built.filteredBars, sym),
      symbolMeta: view.symbolMeta(sym),
      // what the app already holds of the new symbol's metadata (its name, its event markers), or nothing
      meta: view.metaFor(sym, built),
      // its session tags (the Pre/Post chip, the RTH close), from its bars, the clock and the quote the app holds
      sessionTags: view.sessionTags(built, sym),
      // the member's alert lines on it: ONE alerts list for every symbol, held by the chart's last render
      alertLines: typeof view.alertLines === 'function' ? (view.alertLines(sym) || NO_LINES) : NO_LINES,
    }
    // the box the pass reads its bars from: the same field names as the render box's committed copy.
    // ⛔ It is a throwaway: it never updates. A closure the pass installed that kept it would read these bars for
    // good, so every read after the pass is counted (`lateBoxReads`), and the rails hold the count at 0.
    const committed = {
      filteredBars: built.filteredBars,
      displayBars: built.displayBars,
      sessionAppliedBars: built.sessionAppliedBars,
      data: { newest_bar_is_forming: built.newestBarIsForming },
      _big: { ohlcData: tail.ohlcData, closeData: built.closeData, volData: built.volData },
    }
    let sealed = false
    b.box = { get committed() { if (sealed) diag.lateBoxReads += 1; return committed } }
    const next = {}
    for (const name of Object.keys(frame)) {
      const rule = FRAME_RULES[name]
      if (!rule) return refuse(sym, `unruled:${name}`)
      if (rule.kind === SAME) next[name] = frame[name]
      else if (rule.kind === NONE) { if (!isNone(frame[name])) return refuse(sym, rule.why); next[name] = frame[name] }
      else if (rule.kind === BUILT) next[name] = rule.from(b)
      else next[name] = rule.value()
    }
    return {
      ok: true, sym, tf: view.tf, fromSym: frame.sym, frame: next, tail: tail.kind, tailData: tail, meta: b.meta,
      sessionTags: b.sessionTags, alertLines: b.alertLines, view,
      seal: () => { sealed = true },
    }
  }

  return {
    /** A React pass: note what it hands over, then run it. `updateChart` calls this instead of `applyFrame`. */
    reactPass(c, f) {
      ctx = c
      const caughtUp = pending && f.sym === pending.sym
      const before = caughtUp ? { sig: c.lastCfgSigRef.current, bars: c.prevPaintBarsRef.current } : null
      frame = f
      if (pending) pending = null   // React is here (the switch's symbol, or another one it moved to)
      applyFrame(c, f)
      if (before) {
        const noop = before.sig != null && before.sig === c.lastCfgSigRef.current
          && before.bars === (f.__heavy.committed ? f.__heavy.committed.displayBars : null)
        diag.catchUp[noop ? 'noop' : 'repaint'] += 1
      }
    },
    /** What the chart committed (written each commit). */
    noteView(v) {
      view = v
      diag.views += 1
      // the body committed while a switch is pending and it is still the OLD symbol's: a held render
      if (pending && v && v.sym !== pending.sym) diag.heldViews += 1
    },
    /** A React pass of the symbol a switch replaced, while React has not caught up: it must not paint. */
    staleFor(sym) {
      const stale = !!pending && sym === pending.fromSym && sym !== pending.sym
      if (stale) diag.stale += 1
      return stale
    },
    /** Can this chart paint `sym` whole, now? A token for `apply`, or null. Pure: paints nothing. */
    canApply(sym) {
      const t0 = now()
      settleOpen(sym)
      const r = build(sym)
      if (r.ok) { open = { sym }; r.t0 = t0 }   // the decision's question: where its key-task timing starts
      return r.ok ? r : null
    },
    /**
     * The handoff says what the host shows (when it shows a symbol through React, and at each release of the
     * body). If that is the symbol React still shows while another one is painted here, the body will not render:
     * the switch is ended and React's frame replayed (`replay`). Anything else: nothing.
     */
    reconcile(hostSym) {
      if (pending && hostSym === pending.fromSym && pending.sym !== hostSym) { try { replay() } catch { /* the next pass paints */ } }
    },
    /** The handoff released the body's hold (only a release that freed one is reported). */
    noteReleased() { diag.released += 1 },
    /**
     * (review round 2, H2) The handoff showed `sym` by the round, which never paints (its React render lands a task
     * after a paint would). One question answered no: `group-veto` when the key handler's decision built a frame
     * for this same press and a sibling said no, else `round`.
     */
    noteRound(sym) {
      if (open && open.sym === sym) { open = null; refuse(sym, 'group-veto'); return }
      settleOpen(sym)
      refuse(sym, 'round')
    },
    /**
     * Paint `sym`. `token`: what `canApply` returned in this task (built once, never twice).
     * @returns {'applied'|false}
     */
    apply(sym, token = null) {
      settleOpen(sym)
      const t = token && token.ok && token.sym === sym && token.view === view ? token : build(sym)
      if (!t.ok) return false
      if (t.replay) {
        replay()
        diag.asked += 1
        diag.applied += 1
        diag.last = { sym, ok: true, why: null }
        return 'applied'
      }
      const v = t.view
      v.laneShows(sym)                 // the server-compute lane hears the symbol first (today's effect order)
      v.closeChannel()                 // an old-symbol tick paints nothing from here on
      const passCtx = {
        ...ctx,
        // the metadata the pass reads and draws: the NEW symbol's, as far as the app holds it (never the old
        // render's closures over the old symbol's)
        _metaNowRef: { current: () => t.meta },
        _drawMetaRef: { current: (m, fresh) => v.drawMeta(m, fresh, t.tailData) },
        // the member's alerts on the NEW symbol (never the old one's): one list for every symbol, so readable here
        alertLineOptsRef: { current: t.alertLines || NO_LINES },
        wmLogoRef: { current: null },              // the old symbol's logo image (its effect loads the new one)
      }
      pending = { sym, tf: t.tf, fromSym: t.fromSym }
      applyFrame(passCtx, t.frame)
      t.seal()
      v.applySessionTags(t.sessionTags, sym)   // the new symbol's Pre/Post and close tags (none clears the old ones)
      v.clearReadout()                 // the old symbol's numbers are not left over the new candles
      diag.asked += 1
      diag.applied += 1
      diag.tail[t.tail] = (diag.tail[t.tail] || 0) + 1
      diag.last = { sym, ok: true, why: null }
      publish(t.frame._exKey)
      if (typeof t.t0 === 'number') timeKeyTask(t.t0)
      return 'applied'
    },
    /** The symbol on screen that React has not committed yet, or null. */
    pendingSym: () => (pending ? pending.sym : null),
    /** The symbol React showed when the pending switch was painted (the deferred commit's `fromSym`). */
    pendingFrom: () => (pending ? pending.fromSym : null),
    appliedKey: () => appliedKey,
    subscribeApplied(fn) { subs.add(fn); return () => { subs.delete(fn) } },
    diag,
  }
}

/** One controller per chart, keyed by an object the chart holds for its life (its render box). */
const _controllers = new WeakMap()
export function switchControllerFor(owner, deps) {
  let c = _controllers.get(owner)
  if (!c) { c = createSwitchController(deps); _controllers.set(owner, c) }
  return c
}
