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

// Two pure imports, no renderer. `ALPHA`/`withAlpha` are the app's ONE
// definition of the opacity ramp and of "dim this colour" (a second copy is the
// bug `designTokens` exists to prevent); `MAIN_PRICE_SCALE_ID` is placement's
// answer to "which scale do the candles own", consumed here so that the
// complete option set can name `priceScaleId` even when a caller supplies no
// placement at all.
import { ALPHA, withAlpha } from '../designTokens'
import { MAIN_PRICE_SCALE_ID } from './placement'

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

/** LWC's `LineType` enum by its OWN member name (there is no schema name for it —
 *  `stepline` is a plot STYLE, and it is the only thing that moves this option). */
const LINE_TYPE = Object.freeze({ Simple: 0, WithSteps: 1, Curved: 2 })

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

/** Same shape for `LineType`, whose members are already the names we use. */
function lineTypeValue(member, LineType) {
  const fromEnum = LineType && LineType[member]
  return Number.isInteger(fromEnum) ? fromEnum : LINE_TYPE[member]
}

/**
 * LWC's OWN defaults for every colour option this module can set, verbatim from
 * `lightweight-charts@5.2.0` (`lineStyleDefaults`, `histogramStyleDefaults`,
 * `areaStyleDefaults`, `baselineStyleDefaults`). Copied byte-for-byte, odd
 * spacing included — the point is that re-asserting one of these leaves the
 * series in EXACTLY the state a freshly-created one would be in, and a
 * "tidied-up" `rgba(46, 220, 135, 0.4)` would be a different string for no
 * reason.
 *
 * They are LITERALS here because this module is pure — importing the renderer to
 * read them would put `lightweight-charts` on every consumer of the pool. The
 * drift that buys is pinned in `pool.test.js` ("LWC_DEFAULTS is pinned against
 * the INSTALLED lightweight-charts"), which reads `defaultOptions` off the real
 * `LineSeries`/`AreaSeries`/`BaselineSeries`/`HistogramSeries` definitions and
 * fails, by name and with both values, the moment a dependency bump moves one.
 * Before that block existed this comment claimed a pin that did not exist: the
 * test hand-copied the same eleven literals a second time and asserted one copy
 * against the other, so an upstream change would have left both stale, the suite
 * green, and every bare `area`/`baseline` plot "restoring" a value the renderer
 * no longer uses.
 */
const LWC_DEFAULTS = Object.freeze({
  line: Object.freeze({ color: '#2196f3' }),
  histogram: Object.freeze({ color: '#26a69a' }),
  area: Object.freeze({
    lineColor: '#33D778',
    topColor: 'rgba( 46, 220, 135, 0.4)',
    bottomColor: 'rgba( 40, 221, 100, 0)',
  }),
  baseline: Object.freeze({
    topLineColor: 'rgba(38, 166, 154, 1)',
    bottomLineColor: 'rgba(239, 83, 80, 1)',
    topFillColor1: 'rgba(38, 166, 154, 0.28)',
    topFillColor2: 'rgba(38, 166, 154, 0.05)',
    bottomFillColor1: 'rgba(239, 83, 80, 0.05)',
    bottomFillColor2: 'rgba(239, 83, 80, 0.28)',
  }),
})

/** LWC's OWN `priceFormat.precision` (`seriesOptionsDefaults`, 5.2.0). Naming it
 *  here is what makes `precision` free to wire onto EVERY pool key: a plot that
 *  says nothing gets the number the renderer already uses, so the emitted
 *  `{type: 'price', precision: 2}` is a no-op on the picture and Flip A parity is
 *  untouched. `minMove` is deliberately NOT emitted — LWC's `merge` recurses into
 *  a nested plain object, so the series keeps its own `minMove: 0.01`, which is
 *  exactly what the legacy MACD call (`StockChart.jsx:6018`,
 *  `{type: 'price', precision: 5}` and nothing else) leaves it at. */
const DEFAULT_PRICE_PRECISION = 2

/**
 * `plots[].precision` → the axis/crosshair decimals for that plot.
 *
 * It was validated by `defSchema` for ANY plot and read only on the histogram
 * branch, so a `line`/`area`/`baseline` plot declaring `precision: 5` silently
 * rendered with 2-decimal labels: the third member of the family I-2 (`area`
 * given an option it does not have) and I-4 (`opacity` validated and read by
 * nothing) closed. Resolved the same way I-4 was — wired, not dropped — because
 * a schema field a consumer ignores is a promise the engine does not keep.
 *
 * Emitted on every pool key rather than only where the author asked for it: the
 * C-1 key set has to be identical for every plot sharing a pool key, or an
 * `applyOptions` merge carries the last tenant's precision onto the next one.
 */
function precisionFor(plot) {
  return Number.isFinite(plot.precision) ? plot.precision : DEFAULT_PRICE_PRECISION
}

/** The engine's own default line width. NOT LWC's (which is 3): every indicator
 *  line in `StockChart.jsx` is created at 1, so 1 is what "the author didn't
 *  say" has to mean for a Flip A migration to stay pixel-identical. */
const DEFAULT_LINE_WIDTH = 1

/** SAR's dot radius (`StockChart.jsx:5889-5894`). Also the inert value handed to
 *  every non-`markers` line — see the key-set note below. */
const DEFAULT_DOT_RADIUS = 3

/** The alpha an `area`'s fill takes at the top of its gradient when the author
 *  declares no `opacity`. It is LWC's own default area gradient (0.4 → 0), so an
 *  area plot that only names a colour gets that colour in the shape the library
 *  already draws rather than a shape this module invented. */
const AREA_FILL_ALPHA = 0.4

/** A fully transparent colour, for the bottom of an area gradient whose colour
 *  could not be parsed (a CSS keyword like `red`, say). Transparent is the safe
 *  direction: the fill disappears, the line still draws. */
const TRANSPARENT = 'rgba(0, 0, 0, 0)'

/**
 * The only two `autoscaleInfoProvider` values the engine can ever set, as
 * MODULE-LEVEL singletons.
 *
 * ⛔ WHY SINGLETONS AND NOT INLINE ARROWS. `seriesOptionsForPlot` runs on every
 * bind — roughly once a second in extended hours. A fresh `() => null` per call
 * allocates, and worse it makes every option set unequal to the last one, so no
 * future no-op check could ever fire. That was the stated reason this option was
 * left out of the key set entirely (the docstring below, pre-B3); two frozen
 * identities remove the objection without weakening the rule.
 *
 * ⛔ WHY A `DEFAULT` EXISTS AT ALL. LWC has NO default for this option — it is
 * absent from `LineSeries.defaultOptions` and the renderer branches on
 * `!== undefined` (`lightweight-charts.development.mjs:3716`). So "put it back"
 * cannot be expressed by omitting the key: `merge()` SKIPS `undefined`, and a
 * pooled series that inherited `EXCLUDE` from a Bollinger band would go on
 * contributing nothing to whatever scale it lands on next. The identity provider
 * IS the reset, and it is byte-for-byte what the library does when the option is
 * absent: `_internal_autoscaleInfo` calls the provider with a thunk over
 * `_private__autoscaleInfoImpl` and re-wraps the raw result through
 * `AutoscaleInfoImpl._internal_fromRaw(x._internal_toRaw())`, which round-trips
 * priceRange and margins by value (`:2298-2322`). Both facts are pinned against
 * the INSTALLED bundle in `pool.test.js`, not asserted from memory.
 *
 * ⚠️ PLACEMENT decides WHICH — it is the only module that knows whether a series
 * is a guest on the candles' axis — but it returns the STRING `'exclude'` /
 * `'default'`, never a function, so its output stays deep-comparable. The
 * string→function mapping lives here because this is where the complete-key-set
 * rule (C-1) lives.
 */
export const AUTOSCALE_EXCLUDE = () => null
export const AUTOSCALE_DEFAULT = (baseImplementation) => baseImplementation()

/**
 * `plots[].opacity` → a multiplier in [0, 1], or `null` for "the author said
 * nothing".
 *
 * `defSchema` validates this field as an ALPHA-ramp STEP NAME or a number in
 * [0, 1] and does not enumerate the ramp (it stays dependency-free on purpose).
 * This is the consumer that gives that validation meaning: until now the field
 * was validated, documented as "the binder resolves it", and read by nothing —
 * a capability the schema advertised and the engine did not have.
 *
 * A step name the ramp does not know returns `null` rather than an invented
 * alpha: the colour is left exactly as authored. That is the same posture the
 * rest of the module takes toward an unrecognised value, and it is visible (the
 * plot renders at full strength) rather than silently wrong.
 */
export function plotAlpha(plot) {
  const o = plot && plot.opacity
  if (o === undefined || o === null) return null
  if (typeof o === 'number') return (Number.isFinite(o) && o >= 0 && o <= 1) ? o : null
  if (typeof o === 'string' && Object.prototype.hasOwnProperty.call(ALPHA, o)) return ALPHA[o]
  return null
}

/** The plot's colour with its `opacity` folded in, or `fallback` when it declares
 *  none. `withAlpha` MULTIPLIES through, so `rgba(…,0.4)` at `opacity: 'band'`
 *  dims rather than brightens — the same rule `designTokens` applies to a
 *  `token:role@step` reference. */
function effectiveColor(plot, fallback) {
  const raw = (typeof plot.color === 'string' && plot.color) ? plot.color : fallback
  if (raw === null || raw === undefined) return null
  const alpha = plotAlpha(plot)
  if (alpha === null || alpha >= 1) return raw
  return withAlpha(raw, alpha) || raw
}

/**
 * The options a plot implies, as one object.
 *
 * ─── THE RULE: A COMPLETE SET, EVERY BIND ───────────────────────────────────
 *
 * **Every key this function can EVER set for a given pool key is set on EVERY
 * call, with either the declared value or the value a freshly-created series
 * would have had.** Not "the options this plot happens to declare".
 *
 * That is not style — it is the whole correctness of pooling. `binder.js` re-binds
 * a re-purposed series with `applyOptions`, which MERGES: any option the previous
 * tenant set and the new plot does not name SURVIVES. A partial object made every
 * re-purpose inherit its predecessor, and it was measured, not theorised:
 *
 *   sar → rsi          leaked `pointMarkersVisible: true` — an RSI line with a
 *                      dot on every bar
 *   stoch.d → mfi.mfi  leaked `lineStyle: 2` — MFI rendered dashed
 *   any → any          leaked `visible: false` after Alt+Shift+I, and the
 *                      hide-all effect does not re-run to correct it
 *
 * The branch already took exactly this posture for price-SCALE options (trap #2,
 * `placement.resolvePlacement` returns the complete object on every resolve) and
 * had never taken it for SERIES options. This closes that asymmetry, and
 * `pool.test.js` walks the whole plot vocabulary asserting the key set so a new
 * plot style cannot silently skip it.
 *
 * The corollary is why cross-type leaks are impossible: the pool key IS the LWC
 * constructor, so a series can only ever be re-purposed by a plot with the same
 * pool key — and every plot with that pool key produces the same key set.
 *
 * ─── PER-TYPE COLOUR MAPPING ────────────────────────────────────────────────
 *
 * `plot.color` is ONE field; the four constructors spell colour four ways, and
 * `AreaStyleOptions`/`BaselineStyleOptions` have no `color` at all (checked
 * against 5.2.0's `typings.d.ts`). Emitting `color` for them validated,
 * registered, pooled — and then dropped the author's colour on the floor and
 * rendered in LWC's palette. So: line/histogram → `color`, area → `lineColor`
 * plus a gradient derived from it, baseline → `topLineColor`.
 *
 * KNOWN v1 LIMIT, stated rather than discovered: a baseline's BOTTOM half needs a
 * second colour the vocabulary cannot express, so its four other colour options
 * are re-asserted at LWC's defaults. A definition that needs a two-sided baseline
 * needs a schema field first.
 *
 * ─── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
 *
 * `autoscaleInfoProvider` USED to be the exception here, on the grounds that a
 * FUNCTION cannot be compared between passes. B3 carry #1 closed that: the two
 * values it can take are the frozen singletons `AUTOSCALE_EXCLUDE` /
 * `AUTOSCALE_DEFAULT` above, so the key is comparable AND in the set. Which one a
 * series gets is `ctx.autoscale`, and only `placement` can answer it.
 *
 * `pointMarkersRadius` is set on every line-family bind, including plots that
 * draw no markers, purely to keep the key set uniform. It is INERT whenever
 * `pointMarkersVisible` is false — LWC reads it as
 * `pointMarkersVisible ? (pointMarkersRadius || lineWidth/2 + 2) : undefined`.
 * It cannot be "reset by omission" either way: LWC's `merge` SKIPS `undefined`
 * values, so there is no such thing as writing a key back to absent.
 *
 * @param {object} plot
 * @param {{scaleId?: string, autoscale?: 'exclude'|'default', LineStyle?: object,
 *          LineType?: object, indicatorsHidden?: boolean}} [ctx]
 */
export function seriesOptionsForPlot(plot, ctx) {
  const pk = poolKey(plot)
  if (!pk) return null
  const c = ctx || {}

  // `priceScaleId` is RESOLVED, never omitted — that is the #2049 escape (it is
  // mutable → `moveSeriesToScale`) and, since `placement` now returns a concrete
  // id for price overlays too, there is no path left that means "leave it".
  // `visible` is the one option whose value is neither the plot's nor LWC's: it is
  // the declutter toggle's, threaded in so a re-bind agrees with the hide-all
  // effect instead of fighting it.
  const base = {
    priceLineVisible: false,
    lastValueVisible: false,
    visible: c.indicatorsHidden !== true,
    priceScaleId: (typeof c.scaleId === 'string' && c.scaleId) ? c.scaleId : MAIN_PRICE_SCALE_ID,
    priceFormat: { type: 'price', precision: precisionFor(plot) },
    // B3 carry #1. A price overlay is a GUEST on the candles' axis and must not
    // stretch it; anything owning its own band must. Always emitted, because a
    // key that can be set must be set on every bind or a re-purpose inherits it —
    // and there is no "omit to reset" for this one (LWC's merge skips undefined).
    autoscaleInfoProvider: c.autoscale === 'exclude' ? AUTOSCALE_EXCLUDE : AUTOSCALE_DEFAULT,
  }

  if (pk === 'histogram') {
    // A histogram has no line width, no line style and no crosshair marker.
    // Passing them would be describing a series that isn't there — and since a
    // histogram can only ever be re-purposed by another histogram, there is
    // nothing of that kind for it to inherit.
    base.color = effectiveColor(plot, LWC_DEFAULTS.histogram.color)
    return base
  }

  // ── everything else is one of LWC's line-shaped series ──
  const markers = plot.style === 'markers'
  base.crosshairMarkerVisible = false
  // SAR: dots, not a line — `lineWidth: 0` plus point markers
  // (`StockChart.jsx:5889-5894`). The plot's `width` is the DOT RADIUS there,
  // which is why SAR declares 3 and not 1.
  base.lineWidth = markers ? 0 : (Number.isFinite(plot.width) ? plot.width : DEFAULT_LINE_WIDTH)
  const declared = lineStyleValue(plot.lineStyle, c.LineStyle)
  base.lineStyle = declared === undefined ? lineStyleValue('solid', c.LineStyle) : declared
  base.lineType = lineTypeValue(plot.style === 'stepline' ? 'WithSteps' : 'Simple', c.LineType)
  base.pointMarkersVisible = markers
  base.pointMarkersRadius = (markers && Number.isFinite(plot.width)) ? plot.width : DEFAULT_DOT_RADIUS

  if (pk === 'area') {
    const color = effectiveColor(plot, null)
    if (color === null) return Object.assign(base, LWC_DEFAULTS.area)
    base.lineColor = color
    base.topColor = withAlpha(color, AREA_FILL_ALPHA) || color
    base.bottomColor = withAlpha(color, 0) || TRANSPARENT
    return base
  }

  if (pk === 'baseline') {
    Object.assign(base, LWC_DEFAULTS.baseline)
    const color = effectiveColor(plot, null)
    if (color !== null) base.topLineColor = color
    return base
  }

  base.color = effectiveColor(plot, LWC_DEFAULTS.line.color)
  return base
}

/**
 * The per-point colours a `colorMode: 'sign'` plot draws with, or `null`.
 *
 * MACD's histogram is the shipped case: `StockChart.jsx:4002` emits
 * `{time, value, color: p.value >= 0 ? MACD_HIST_UP : MACD_HIST_DOWN}` — green
 * above zero, red below. `colorMode: 'sign'` is how a definition SAYS that, and
 * `colorUp`/`colorDown` are the two colours it needs (a mode without them is
 * unrenderable, which is why `defSchema` requires them together).
 *
 * Everything else — including `colorMode: 'column:<key>'`, which is a legal
 * schema value with no v1 consumer — returns null and draws in the series colour.
 */
export function signColorsForPlot(plot) {
  if (!plot || plot.colorMode !== 'sign') return null
  const alpha = plotAlpha(plot)
  const dim = (raw) => {
    if (typeof raw !== 'string' || !raw) return null
    if (alpha === null || alpha >= 1) return raw
    return withAlpha(raw, alpha) || raw
  }
  const up = dim(plot.colorUp)
  const down = dim(plot.colorDown)
  return (up && down) ? { up, down } : null
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
