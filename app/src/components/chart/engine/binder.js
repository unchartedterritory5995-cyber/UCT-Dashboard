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

/** poolKey → the LWC series constructor to hand `addSeries`. */
const SERIES_CTOR = {
  line: 'LineSeries',
  histogram: 'HistogramSeries',
  area: 'AreaSeries',
  baseline: 'BaselineSeries',
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

  /** Remove every series we hold. Zero calls when we hold nothing, which is what
   *  makes `teardown()` safe to call unconditionally from an unmount path. */
  function releaseAll() {
    for (const b of held) attempt(() => chart.removeSeries(b.series))
    held = []
    computeMemo = new Map()
    pointMemo = new Map()
  }

  function sync(ctx) {
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
    for (const inst of instances) {
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
      if (inst.hidden === true) continue
      const def = registry.getDefinition(inst.defId)
      if (!def) continue
      computedIds.add(inst.instanceId)

      const sig = inputsSignature(inst.inputs)
      const memo = computeMemo.get(inst.instanceId)
      let cols
      if (memo && memo.registry === registry && memo.def === def && memo.bars === bars && memo.sig === sig) {
        cols = memo.cols
      } else {
        const r = attempt(() => registry.computeFor(def, bars, inst.inputs))
        if (!r.ok || !r.value) { computeMemo.delete(inst.instanceId); continue }
        cols = r.value
        computeMemo.set(inst.instanceId, { registry, def, bars, sig, cols })
      }
      for (const plotKey of Object.keys(cols)) {
        columns.set(bindingKey(inst.instanceId, plotKey), cols[plotKey])
      }
    }
    for (const id of computeMemo.keys()) if (!computedIds.has(id)) computeMemo.delete(id)

    const hasData = (key) => {
      const col = columns.get(key)
      return col !== undefined && registry.hasAnyFinite(col)
    }

    // ── 2. Ask the pool what should happen ──
    const { bind, release } = planBindings(instances, registry, held, { hasData })

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

    const next = []
    for (const b of bind) {
      const placement = attempt(() => resolvePlacement(b.inst, b.def, ctx))
      if (!placement.ok || !placement.value) { orphan(b); continue }
      const { paneIndex, scaleId, scaleOptions, autoscale } = placement.value

      const options = seriesOptionsForPlot(b.plot, {
        scaleId,
        // B3 carry #1: a SERIES option that only PLACEMENT knows the answer to.
        // Placement returns a string; `pool` owns the two function singletons.
        autoscale,
        LineStyle: LWC.LineStyle,
        LineType: LWC.LineType,
        // The declutter toggle (Alt+Shift+I). `visible` is part of the complete
        // option set, so without this the engine would re-show a hidden series on
        // the next paint — roughly once a second in extended hours.
        indicatorsHidden: ctx.indicatorsHidden === true,
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
        // relocate on a live chart. `adx` and `obv` join at Task 8, which makes
        // the eventual list every pane oscillator there is. The MECHANISM is
        // unchanged and so is the blind spot; only the count moved.
        if (b.from && b.from.paneIndex !== paneIndex) attempt(() => series.moveToPane(paneIndex))
        attempt(() => series.applyOptions(options))
      }

      // ── TRAP #2: the FULL set, every bind, create branch or not ──
      //
      // `scaleOptions === null` means ASSERT NOTHING — a price overlay lands on
      // the candles' own axis and writing `scaleMargins` there would move the
      // candles. It used to reach `applyOptions(null)` anyway; that is a traced
      // no-op in 5.2.0 (`merge(dst, {rightPriceScale: null})` iterates nothing)
      // but it fired a full price-scale update on every bind and contradicted
      // placement's own docstring, so the guard says out loud what was meant.
      if (scaleOptions) attempt(() => series.priceScale().applyOptions(scaleOptions))

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
