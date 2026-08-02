// app/src/components/chart/engine/pool.js
//
// ─── Series pooling: every decision, no lightweight-charts ───────────────────
//
// This module answers three questions and touches nothing:
//
//   1. WHICH LWC SERIES TYPE does a plot need?              → poolKey()
//   2. GIVEN what is already on the chart, which series      → planBindings()
//      is re-purposed for what, which is freed, which is new?
//   3. MUST this binding be re-`setData`'d this pass?        → firstBindNeedsSetData()
//
// ─── WHY THE POOL KEY IS THE SERIES TYPE AND NOTHING ELSE ────────────────────
//
// Verified against the installed lightweight-charts 5.2.0 bundle. Two in-code
// comments in `StockChart.jsx` (`:5460-5461` and `:5490`) say scale id, pane and
// type are all fixed at creation. That was true on 5.1.x. Today:
//
//   priceScaleId   MUTABLE — applyOptions → moveSeriesToScale
//                  (lightweight-charts.development.mjs:3476-3482, :7174-7178)
//   pane           MUTABLE — series.moveToPane(i)   (typings.d.ts:2600-2606)
//   series TYPE    IMMUTABLE — seriesType() is a read-only getter (:2570)
//
// So a LineSeries can be moved to another pane, re-bound to another price scale,
// recoloured, restyled and re-`setData`'d. It can become ANY single-line plot of
// ANY indicator. The type is the only thing it cannot stop being, so the type is
// the only thing the pool can key on.
//
// This matters because of lightweight-charts issue #2049 (still open): a mass
// `removeSeries` costs 2-4 s of blocked main thread, and `StockChart` already
// does that pattern roughly thirty times per symbol flip. Pooling turns a
// remove-and-recreate into an `applyOptions` + `moveToPane`.
//
// ─── WHAT A BINDING IS ───────────────────────────────────────────────────────
//
//   { key, instanceId, defId, plotKey, plot, def, inst,
//     poolKey, source, series, from, guides, guideSig }
//
// `key` (`instanceId::plotKey`) is the stable handle. `source` says where the
// series came from and is the only thing the binder has to branch on:
//
//   'same'    the same key existed last pass and keeps its own series
//   'pooled'  it took a series that belonged to a DIFFERENT key — re-purposed
//   'create'  nothing compatible was free; the binder must addSeries
//
// `series` is carried opaquely. This module never calls a method on it, which is
// what keeps "pure" true while still letting the plan say "reuse THAT one".

/** The four LWC series constructors any v1 plot can need. */
export const POOL_KEYS = Object.freeze(['line', 'histogram', 'area', 'baseline'])

/**
 * `plots[].style` → the LWC constructor that draws it.
 *
 * TWO MAPPINGS THE PLAN LEFT OPEN, and what they are:
 *
 *   `band`    → 'line'. Today a band IS a line: BB's `middle` and Donchian's
 *              `middle` are single LineSeries drawn between two sibling line
 *              plots, with NO fill — `fill` is schema-RESERVED and neither
 *              indicator draws one (nativeRegistry docstring). The `edges` a
 *              band declares are themselves first-class line plots with their
 *              own bindings, so the band's own key is just its centre series.
 *              If B3 gives bands a real fill, the constructor changes and so
 *              does this mapping — which is correct, and is the pool key doing
 *              its job.
 *
 *   `markers` → 'line'. SAR is a LineSeries with `lineWidth: 0` and point
 *              markers turned on (`StockChart.jsx` ~:5903). It is dots because
 *              of two options, not because of a different constructor.
 *
 *   `stepline`→ 'line', for the same reason: `lineType: WithSteps` is an option.
 *
 * `hlines` returns NULL — deliberately, and it is not an error. A guide is a
 * `createPriceLine` on somebody else's series; it has no column
 * (`nativeRegistry.columnKeys` excludes it) and giving it a pool key would
 * allocate a series with nothing to put in it. `planBindings` attaches guides to
 * their instance's first data-bearing binding instead.
 *
 * An unrecognised style is also null. Same posture as `defSchema`: a style
 * nobody has mapped renders nothing rather than quietly becoming a line of the
 * wrong shape. (`validateDefinition` already rejects unknown styles at
 * registration, so this is the second lock, not the first.)
 *
 * @param {object} plot a definition's plot
 * @returns {'line'|'histogram'|'area'|'baseline'|null}
 */
export function poolKey(plot) {
  switch (plot && plot.style) {
    case 'line':
    case 'stepline':
    case 'band':
    case 'markers':
      return 'line'
    case 'histogram':
      return 'histogram'
    case 'area':
      return 'area'
    case 'baseline':
      return 'baseline'
    default:
      return null
  }
}

/** The stable handle for one plot of one instance. Two instances of the same
 *  definition must never collide, so the instance id leads. */
export function bindingKey(instanceId, plotKey) {
  return `${instanceId}::${plotKey}`
}

/**
 * A stable string for a set of guides, so the binder can tell "these are the
 * same three price lines" from "the user moved 70 to 80" without diffing.
 *
 * Guides are `createPriceLine` handles, and LWC has no "update this price line"
 * — changing one means removing and recreating it. Comparing signatures is what
 * makes that a decision rather than an unconditional churn on every pass.
 */
export function guideSignature(guides) {
  if (!guides || !guides.length) return ''
  return guides.map(g => [
    g.key,
    (g.levels || []).join('/'),
    g.color || '',
    g.width == null ? '' : g.width,
    g.lineStyle || '',
  ].join(':')).join('|')
}

// ─── a definition's plot → THIS instance's plot ───────────────────────────────

/**
 * Re-apply a plot's `$ref` substitutions against an instance's stored inputs.
 *
 * `validateDefinition` resolves `color: '$color'` to the input's DEFAULT, which
 * is correct for a definition — there is no user behind one. An instance is
 * nothing BUT the user: `{inputs: {color: '#abcdef'}}` is the field's entire
 * purpose. Without this step the binder would read the definition's plot and
 * render every migrated indicator in its default colour, silently ignoring what
 * the blob says — and in B3 that is a pixel change on every user who has ever
 * touched an indicator colour.
 *
 * `$refs` (recorded by `defSchema`) is what makes it possible: it remembers WHICH
 * input each substituted field came from, so this is a lookup rather than a
 * guess. A field with no ref is an author's literal and is left alone; an input
 * the instance does not set keeps the definition default, which is the same
 * "unset means current default" the migrator preserves.
 *
 * Returns the plot UNCHANGED (same reference) when there is nothing to re-apply,
 * so the common case allocates nothing.
 */
export function resolvePlotForInstance(plot, inputs) {
  const refs = plot && plot.$refs
  if (!refs || !inputs) return plot

  let out = null
  for (const field of ['color', 'width']) {
    const key = refs[field]
    if (!key) continue
    const v = inputs[key]
    if (v === undefined) continue
    out = out || { ...plot }
    out[field] = v
  }

  if (Array.isArray(refs.levels) && Array.isArray(plot.levels)) {
    let levels = null
    for (let i = 0; i < refs.levels.length; i++) {
      const key = refs.levels[i]
      if (!key) continue
      const v = inputs[key]
      if (v === undefined) continue
      levels = levels || [...plot.levels]
      levels[i] = v
    }
    if (levels) { out = out || { ...plot }; out.levels = levels }
  }

  return out || plot
}

// ─── plot style → LWC series options ─────────────────────────────────────────

/** LWC's `LineStyle` enum by SCHEMA name. Numeric because the values are stable
 *  API constants and a pure module must not import the renderer; the binder
 *  passes the real enum in when it has one, and these agree with it. */
const LINE_STYLE = Object.freeze({ solid: 0, dotted: 1, dashed: 2, largeDashed: 3 })

/** Schema name → the LWC enum's own MEMBER name. The two vocabularies differ in
 *  case, and that difference was silently eating every declared line style. */
const LINE_STYLE_MEMBER = Object.freeze({
  solid: 'Solid', dotted: 'Dotted', dashed: 'Dashed', largeDashed: 'LargeDashed',
})

/**
 * A schema line-style name → the numeric value LWC wants, or `undefined` for
 * "leave it alone".
 *
 * ⚠️ WHY THIS IS A FUNCTION AND NOT A SUBSCRIPT. It used to be
 * `styles[plot.lineStyle]`, with `styles` being the REAL `LWC.LineStyle` the
 * binder passes in. That enum is keyed `Solid/Dotted/Dashed/LargeDashed` —
 * capitalised — while a plot declares `'dashed'`. So the lookup was
 * `LineStyle['dashed']`, which is `undefined` on every call, and the guard
 * `!== undefined` then dropped the option entirely. In production (where the
 * real enum is always passed) EVERY declared line style was being discarded: BB
 * and Donchian's dashed edges, Ichimoku's spans, the SAR — all of them would
 * have rendered solid the moment B3 migrated them, and the numeric fallback map
 * that was supposed to prevent exactly this was unreachable because a truthy
 * `ctx.LineStyle` always won.
 *
 * Surfaced by the Task 8 rehearsal while diagnosing a different style bug. RSI's
 * own line declares no style, so the rehearsal's pixels never touched this — it
 * was a B3 parity failure already sitting in the tree.
 *
 * The enum is still consulted first (it is the library's own answer), by its own
 * member name; the frozen numbers are the fallback for a caller with no enum.
 */
export function lineStyleValue(name, LineStyle) {
  const member = LINE_STYLE_MEMBER[name]
  if (!member) return undefined
  const fromEnum = LineStyle && LineStyle[member]
  return Number.isInteger(fromEnum) ? fromEnum : LINE_STYLE[name]
}

/**
 * The options a plot implies, as one object.
 *
 * Mirrors what each shipped render block passes to `addSeries` — the three
 * "don't decorate this" flags (`priceLineVisible` / `lastValueVisible` /
 * `crosshairMarkerVisible`) are on every indicator series in `StockChart.jsx`,
 * and a pooled series that inherited them from a previous tenant and never got
 * them re-asserted would be one axis label away from a visible diff.
 *
 * `priceScaleId` IS one of these options, which is the whole #2049 escape: it is
 * mutable (→ `moveSeriesToScale`), so re-binding a pooled series to a different
 * scale is an `applyOptions`, not a remove-and-recreate.
 *
 * NOT here, and deliberately: `autoscaleInfoProvider: () => null` (a FUNCTION —
 * it cannot be compared between passes, so re-applying it every bind would make
 * every options object unequal to the last and defeat any future no-op check;
 * the price overlays that need it get it from their placement) and `colorMode:
 * 'sign'` per-point colouring (MACD's histogram: the up/down colours are
 * hardcoded in `StockChart.jsx` and no definition declares them — a B3 carry).
 *
 * @param {object} plot
 * @param {{scaleId?: string, LineStyle?: object}} [ctx]
 */
export function seriesOptionsForPlot(plot, ctx) {
  const pk = poolKey(plot)
  if (!pk) return null

  const base = { priceLineVisible: false, lastValueVisible: false }
  if (ctx && typeof ctx.scaleId === 'string') base.priceScaleId = ctx.scaleId

  if (pk === 'histogram') {
    // A histogram has no line width, no line style and no crosshair marker.
    // Passing them would be describing a series that isn't there.
    if (plot.color) base.color = plot.color
    base.priceFormat = { type: 'price', precision: Number.isFinite(plot.precision) ? plot.precision : 2 }
    return base
  }

  base.crosshairMarkerVisible = false
  if (plot.color) base.color = plot.color

  if (plot.style === 'markers') {
    // SAR: dots, not a line — `lineWidth: 0` plus point markers
    // (`StockChart.jsx:5889-5894`). The plot's `width` is the DOT RADIUS here,
    // which is why it is 3 in the definition and not 1.
    base.lineWidth = 0
    base.pointMarkersVisible = true
    base.pointMarkersRadius = Number.isFinite(plot.width) ? plot.width : 3
    return base
  }

  base.lineWidth = Number.isFinite(plot.width) ? plot.width : 1
  // An UNDECLARED lineStyle stays undeclared: absent means "leave it alone", and
  // a series option LWC is not given keeps whatever the series already had.
  // (A `createPriceLine` option works the OTHER way — see `binder.guideSpecs`.)
  const declared = lineStyleValue(plot.lineStyle, ctx && ctx.LineStyle)
  if (declared !== undefined) base.lineStyle = declared
  if (plot.style === 'stepline' && ctx && ctx.LineType) base.lineType = ctx.LineType.WithSteps

  return base
}

// ─── registry resolution ─────────────────────────────────────────────────────

/** Same two shapes `instances.js` accepts: a `(defId) => def|null` function, or
 *  a module exposing `getDefinition`. No registry ⇒ nothing resolves, so the
 *  plan comes back empty rather than guessing. */
function resolveGet(registry) {
  if (typeof registry === 'function') return registry
  if (registry && typeof registry.getDefinition === 'function') return (id) => registry.getDefinition(id)
  return () => null
}

/** The plots a definition returns a column for, in declaration order. Mirrors
 *  `nativeRegistry.columnKeys`, expressed over plot OBJECTS because the plan
 *  needs the whole plot (style, colour, width) and not just its key. */
function dataPlots(def) {
  return (def.plots || []).filter(p => p && p.style !== 'hlines' && typeof p.key === 'string')
}

/** The static guides of a definition, in declaration order. */
function guidePlots(def) {
  return (def.plots || []).filter(p => p && p.style === 'hlines' && typeof p.key === 'string')
}

// ─── the planner ─────────────────────────────────────────────────────────────

/**
 * Decide what the chart should hold, given what it already holds.
 *
 * @param {object[]} instances    normalised instances (see `instances.js`)
 * @param {object|Function} registry
 * @param {object[]} prevBindings the bindings the binder produced last pass,
 *        each carrying its `series`
 * @param {{hasData?: (key: string, binding: object) => boolean}} [opts]
 *        `hasData` is THE PANE-EXISTENCE TEST (trap #4) — the caller supplies it
 *        from `nativeRegistry.hasAnyFinite` over the column it just computed.
 *        Post-B1 every column is input-length, so the `.length` check
 *        `StockChart.jsx` uses today is always truthy and would create a series
 *        (and a pane) for every indicator whether or not it computed anything.
 *        Omitted ⇒ everything has data, which is the right default for a
 *        planner asked to plan without being told otherwise.
 *
 * @returns {{bind: object[], release: object[], reuse: object[]}}
 *
 * THE INVARIANT THIS EXISTS FOR: a series is never released while a binding in
 * the SAME pass could have taken it. That falls out of the ordering — exact-key
 * matches first, then the pool, and only what is left over is released — and is
 * asserted as a property in `pool.test.js`, not just case by case.
 *
 * `reuse` is the RE-PURPOSED subset (`source === 'pooled'`), not everything that
 * avoided a create. A same-key carry-over is continuity; a re-purpose is the
 * thing the binder has to do extra work for (drop the previous tenant's guides,
 * re-assert the scale, force a setData), so it gets its own list.
 */
export function planBindings(instances, registry, prevBindings, opts) {
  const get = resolveGet(registry)
  const hasData = opts && typeof opts.hasData === 'function' ? opts.hasData : null

  // ── 1. What the chart SHOULD hold ──
  const desired = []
  for (const inst of (Array.isArray(instances) ? instances : [])) {
    if (!inst || typeof inst !== 'object') continue
    if (inst.hidden === true) continue
    if (typeof inst.instanceId !== 'string' || !inst.instanceId) continue

    const def = get(inst.defId)
    if (!def) continue

    // Every plot is resolved against THIS instance's inputs before anything
    // reads it, so nothing downstream can accidentally use a definition default
    // where the user set a value.
    const guides = guidePlots(def).map(p => resolvePlotForInstance(p, inst.inputs))
    const guideSig = guideSignature(guides)
    let first = true

    for (const rawPlot of dataPlots(def)) {
      const plot = resolvePlotForInstance(rawPlot, inst.inputs)
      const pk = poolKey(plot)
      if (!pk) continue                       // unmappable style: bind nothing
      const key = bindingKey(inst.instanceId, plot.key)

      const candidate = {
        key,
        instanceId: inst.instanceId,
        defId: inst.defId,
        plotKey: plot.key,
        plot,
        def,
        inst,
        poolKey: pk,
        // Guides belong to a SERIES, so the plan has to name one. The first
        // data-bearing plot is the instance's primary line — RSI's line, Stoch's
        // %K, MACD's line — which is exactly where `StockChart` puts them today.
        guides: first ? guides : [],
        guideSig: first ? guideSig : '',
        source: 'create',
        series: null,
        from: null,
      }

      if (hasData && !hasData(key, candidate)) continue

      desired.push(candidate)
      first = false
    }
  }

  // ── 2. Match by exact key — a binding that survives keeps its own series ──
  //
  // The poolKey must match too. A key that survived but whose plot changed TYPE
  // cannot keep its series: type is the one immutable property, so that series
  // goes back to the pool (where a compatible binding may still claim it) and
  // this one is served like any other.
  const prev = (Array.isArray(prevBindings) ? prevBindings : []).filter(b => b && b.series)
  const prevByKey = new Map()
  for (const b of prev) if (!prevByKey.has(b.key)) prevByKey.set(b.key, b)

  const claimed = new Set()
  const unmatched = []
  for (const d of desired) {
    const p = prevByKey.get(d.key)
    if (p && !claimed.has(p) && p.poolKey === d.poolKey) {
      claimed.add(p)
      d.source = 'same'
      d.series = p.series
      d.from = p
      d.prevGuideSig = p.guideSig || ''
    } else {
      unmatched.push(d)
    }
  }

  // ── 3. Re-purpose what is left, by type ──
  const pool = new Map()
  for (const p of prev) {
    if (claimed.has(p)) continue
    if (!pool.has(p.poolKey)) pool.set(p.poolKey, [])
    pool.get(p.poolKey).push(p)
  }

  for (const d of unmatched) {
    const bucket = pool.get(d.poolKey)
    if (bucket && bucket.length) {
      const p = bucket.shift()               // FIFO — deterministic, order-stable
      claimed.add(p)
      d.source = 'pooled'
      d.series = p.series
      d.from = p
      d.prevGuideSig = p.guideSig || ''
    }
  }

  // ── 4. Whatever nobody claimed is genuinely free ──
  const release = prev.filter(p => !claimed.has(p))

  return {
    bind: desired,
    release,
    reuse: desired.filter(d => d.source === 'pooled'),
  }
}

/**
 * Must this binding be handed a full `setData` this pass, whatever the render
 * plan says?
 *
 * TRAP #1. `StockChart`'s `_applyData` returns EARLY on `_noop` (`:4675-4680`) —
 * bars and config byte-identical to the last paint, so re-`setData`ing would be a
 * pure wipe/repaint, and skipping it is what stops the extended-hours price-tag
 * tick from erasing the developing bar every second. That is correct for a series
 * that already holds the right data.
 *
 * A series that was created THIS pass holds nothing, and a series that was
 * RE-PURPOSED this pass holds the previous tenant's numbers. Both would render
 * blank or wrong under a `noop`. Today this is safe only by coupling: every
 * create is triggered by a `cs` change, which makes the plan non-noop by
 * construction. Pooling breaks that coupling — a series can change tenant while
 * `cs` and the bars are untouched — so the guarantee has to become explicit.
 *
 * An unrecognised binding is treated as a first bind. Fail toward drawing: a
 * missed setData is a blank indicator, a redundant one is a repaint.
 */
export function firstBindNeedsSetData(binding, _planMode) {
  return !binding || binding.source !== 'same'
}
