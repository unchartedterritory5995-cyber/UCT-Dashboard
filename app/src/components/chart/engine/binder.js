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
//    RSI's scale and never had its own asserted keeps 0-100 — and an ATR of 2.7
//    draws as a flat line at the bottom. The full object, every time.
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
 */
function toPoints(column, bars, adjustTime) {
  const out = new Array(bars.length)
  for (let i = 0; i < bars.length; i++) {
    const time = adjustTime(bars[i].t)
    const v = column ? column[i] : NaN
    out[i] = Number.isFinite(v) ? { time, value: v } : { time }
  }
  return out
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
 * @param {{chart: object, LWC: object}} deps
 * @returns {{sync: (ctx: object) => object, teardown: () => void}}
 */
export function createBinder({ chart, LWC }) {
  /** Last pass's bindings, each carrying `series`, `guideHandles`, `paneIndex`. */
  let held = []

  /** Remove every series we hold. Zero calls when we hold nothing, which is what
   *  makes `teardown()` safe to call unconditionally from an unmount path. */
  function releaseAll() {
    for (const b of held) attempt(() => chart.removeSeries(b.series))
    held = []
  }

  function sync(ctx) {
    // ── The flag. ABSENT MEANS OFF: dark is the default, never something a
    //    caller has to remember to ask for. ──
    const enabled = ctx && (ctx.enabled !== undefined ? ctx.enabled : ctx.cs && ctx.cs.engineEnabled) === true
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
    for (const inst of instances) {
      if (!inst || typeof inst.instanceId !== 'string') continue
      const def = registry.getDefinition(inst.defId)
      if (!def) continue
      const r = attempt(() => registry.computeFor(def, bars, inst.inputs))
      if (!r.ok || !r.value) continue
      for (const plotKey of Object.keys(r.value)) {
        columns.set(bindingKey(inst.instanceId, plotKey), r.value[plotKey])
      }
    }

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
    const next = []
    for (const b of bind) {
      const placement = attempt(() => resolvePlacement(b.inst, b.def, ctx))
      if (!placement.ok || !placement.value) continue
      const { paneIndex, scaleId, scaleOptions } = placement.value

      const options = seriesOptionsForPlot(b.plot, { scaleId, LineStyle: LWC.LineStyle, LineType: LWC.LineType })
      if (!options) continue

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
        if (b.from && b.from.paneIndex !== paneIndex) attempt(() => series.moveToPane(paneIndex))
        attempt(() => series.applyOptions(options))
      }

      // ── TRAP #2: the FULL set, every bind, create branch or not ──
      attempt(() => series.priceScale().applyOptions(scaleOptions))

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
      const points = toPoints(columns.get(b.key), bars, adjustTime)
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
      })
    }

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
