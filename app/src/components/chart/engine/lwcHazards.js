// app/src/components/chart/engine/lwcHazards.js
//
// ─── R0.4 — THE LIGHTWEIGHT-CHARTS TRAPS, AS CODE INSTEAD OF FOLKLORE ───────
//
// Every hazard below is one this codebase or the capability survey has already
// paid for. They share a shape: **the wrong thing is the DEFAULT, and it renders
// without an error.** An omitted option is not "keep what's there", it is "use
// LWC's own default", and LWC's defaults were chosen for a charting library, not
// for Pine parity.
//
// ⛔⛔ THE ONE THAT ALREADY COST US: `createPriceLine`'s `lineStyle` default is
// **Dashed**, not solid. Omit it and every Pine `hline` renders dashed. Our own
// `binder.js` learned this at a cost of **379 px** on RSI's 50 line — and four
// separate files now carry a comment warning about it, which is exactly the state
// a fact reaches just before it gets re-broken: everybody has written it down and
// nothing enforces it. `lwcHazards.test.js` is the enforcement — it sweeps every
// `createPriceLine` call site in `app/src` and fails by name.
//
// Provenance: docs/pine/lwc5-capability-map.md §2 (per-primitive caveats) and its
// §3.4 loss register.

/** The register. Ids are stable; the tests assert each one is actually covered,
 *  so a hazard cannot be documented here and unguarded. */
export const HAZARDS = Object.freeze({
  H1: 'createPriceLine lineStyle defaults to Dashed, not solid (cost: 379px on RSI 50)',
  H2: 'native LineWidth is 1|2|3|4; Pine linewidth is an unbounded series int',
  H3: 'positionsBox returns length = |delta| + 1',
  H4: 'the bar_index x-domain is [bar_index - 10000, bar_index + 500]',
  H5: 'primitives get no culling: 100 polylines x 10,000 points = 1M vertices',
  H6: 'one primitive per box means one hitTest per box per mousemove',
  H7: 'display.none needs visible:false AND autoscaleInfoProvider returning null',
})

// ─── H1 ─────────────────────────────────────────────────────────────────────

/** LWC's `LineStyle` enum, by name, so a call site never writes a bare integer. */
export const LINE_STYLE = Object.freeze({
  Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4,
})

/** What LWC uses when `lineStyle` is omitted from a price line. NOT Solid. */
export const PRICE_LINE_DEFAULT_STYLE = LINE_STYLE.Dashed

/**
 * Build a `createPriceLine` spec, refusing to leave the style to LWC.
 *
 * ⛔ `lineStyle` IS REQUIRED, and the refusal is the point. Pine's `hline` draws
 * solid unless the script says otherwise; LWC's price line draws dashed unless the
 * caller says otherwise. The defaults disagree, silently, on every hline in every
 * script. Making it required means a new call site cannot inherit the bug.
 *
 * ⚠️ `axisLabelVisible` defaults to FALSE here on purpose: Pine's `hline` draws no
 * price-axis label, and LWC's price line does.
 */
export function priceLineSpec(spec = {}) {
  if (spec.lineStyle === undefined || spec.lineStyle === null) {
    throw new Error(
      'priceLineSpec: lineStyle is required — omitting it takes LWC\'s price-line default, ' +
      `which is Dashed (${PRICE_LINE_DEFAULT_STYLE}), not solid. Pine hlines are solid unless ` +
      'the script says otherwise. Pass LINE_STYLE.Solid explicitly if that is what you mean.',
    )
  }
  if (!Object.values(LINE_STYLE).includes(spec.lineStyle)) {
    throw new Error(`priceLineSpec: unknown lineStyle ${spec.lineStyle}`)
  }
  const { width, ...rest } = spec
  const w = clampNativeLineWidth(width === undefined ? 1 : width)
  return { axisLabelVisible: false, ...rest, lineWidth: w.lineWidth, lineStyle: spec.lineStyle }
}

// ─── H2 ─────────────────────────────────────────────────────────────────────

/** The only widths a native series or price line accepts. */
export const NATIVE_LINE_WIDTHS = Object.freeze([1, 2, 3, 4])

/**
 * Pine's unbounded `linewidth` onto LWC's four native widths.
 *
 * ⚠️ THIS CLAMP APPLIES TO THE NATIVE PATH ONLY. A canvas primitive's stroke has
 * no such cap — `ctx.lineWidth = 17` is fine — so a `line.new(width = 17)` drawn
 * through the primitive layers must NOT be routed through here. Clamping there
 * would invent a limit the vendor does not have.
 *
 * @returns {{lineWidth: number, clamped: boolean}}
 */
export function clampNativeLineWidth(width) {
  const n = Math.trunc(Number(width))
  if (!Number.isFinite(n)) return { lineWidth: 1, clamped: true }
  const lineWidth = Math.min(Math.max(n, 1), 4)
  return { lineWidth, clamped: lineWidth !== n }
}

// ─── H3 ─────────────────────────────────────────────────────────────────────

/**
 * The bar span a box actually covers.
 *
 * ⚠️ `positionsBox(x1, x2, ratio)` returns `length = |x2 - x1| + 1`, because it
 * describes a span of BARS INCLUSIVE, not a pixel distance. Using it as a width
 * makes every box one bar too wide, and adjacent boxes overlap by exactly one bar
 * — which looks like a rounding artefact and is not.
 */
export function boxSpan(x1, x2) {
  const a = Math.trunc(Number(x1))
  const b = Math.trunc(Number(x2))
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('boxSpan needs two finite indices')
  const inclusiveLength = Math.abs(b - a) + 1
  return { from: Math.min(a, b), to: Math.max(a, b), inclusiveLength, gapCorrectedLength: inclusiveLength - 1 }
}

// ─── H4 ─────────────────────────────────────────────────────────────────────

/** How far either side of the current bar an `xloc.bar_index` coordinate may go. */
export const X_DOMAIN = Object.freeze({ back: 10000, forward: 500 })

/**
 * Is a bar_index coordinate inside the domain the chart will accept?
 *
 * ⚠️ Out-of-domain is not a clamp — a drawing placed outside it is a Pine runtime
 * error, so the honest answer is to report it, not to drag the coordinate back to
 * the edge and draw something the script never asked for.
 */
export function withinXDomain(barIndex, currentBarIndex) {
  const i = Number(barIndex)
  const now = Number(currentBarIndex)
  if (!Number.isFinite(i) || !Number.isFinite(now)) return { ok: false, reason: 'non-finite index' }
  if (i < now - X_DOMAIN.back) return { ok: false, reason: `more than ${X_DOMAIN.back} bars back` }
  if (i > now + X_DOMAIN.forward) return { ok: false, reason: `more than ${X_DOMAIN.forward} bars forward` }
  return { ok: true, reason: null }
}

// ─── H5 / H6 ────────────────────────────────────────────────────────────────

export const POLYLINE = Object.freeze({ maxPoints: 10000, maxObjects: 100 })

/**
 * ⛔ PRIMITIVES GET NO CULLING. A custom SERIES receives
 * `PaneRendererCustomData.visibleRange` for free; a primitive receives nothing and
 * is asked to draw the whole thing on every frame. The documented worst case is
 * 100 polylines × 10,000 points = **one million vertices**, so culling to the
 * visible logical range is the caller's job and is not optional.
 */
export function needsCulling(pointCount, visibleBars) {
  const n = Number(pointCount) || 0
  const v = Number(visibleBars) || 0
  return { cull: n > v && n > 0, points: n, visible: v, ceiling: POLYLINE.maxPoints }
}

/**
 * ⛔ ONE LAYER OWNS ALL OF A KIND, NOT ONE PRIMITIVE PER OBJECT. `hitTest` runs
 * per attached primitive on every mousemove, so 500 boxes as 500 primitives is 500
 * hit tests per mouse move. One `BoxLayer` holding 500 boxes is one.
 */
export function primitiveCountFor(objectCount) {
  return { primitives: objectCount > 0 ? 1 : 0, objects: objectCount }
}

// ─── H7 ─────────────────────────────────────────────────────────────────────

/**
 * What `display = display.none` has to mean on a native series.
 *
 * ⚠️ `visible: false` ALONE IS NOT ENOUGH. An invisible series still contributes
 * to the price scale, so a hidden plot silently rescales the pane around data
 * nobody can see — and Pine's hidden plots are frequently extreme values used only
 * as fill anchors. The autoscale provider must return null too.
 */
export function hiddenSeriesOptions() {
  return { visible: false, autoscaleInfoProvider: () => null }
}
