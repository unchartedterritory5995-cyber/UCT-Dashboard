// app/src/components/chart/engine/paneLayout.js
//
// ─── THE GEOMETRY, AS A PURE FUNCTION ───────────────────────────────────────
//
// `paneMargins.computePaneMargins` answers "what slice of pane 0 does each
// oscillator get". This answers "which PANE does each oscillator get, and how
// tall is it" — the same question after Flip C, when the bands become panes.
//
// It reproduces the band arithmetic EXACTLY (the same proportional squeeze, the
// same integer-hundredths quantisation, the same deterministic tallest-first
// shave), because that is what makes pane 0's rectangle land on the same pixels
// and the `price_plot` parity region read 0. See the plan's §A6 for the identity
// and §A7 for why heights are set as stretch factors.
//
// ⛔ NO NINE-ROW TABLE LIVES HERE. `paneMargins.PANES` is three different facts
// wearing one coat, and moving the coat would have been a rename, not a
// retirement:
//
//   * its nine `baseH` values  → `placement.pane.height` on each DEFINITION
//     (`defSchema.js` validates it, `nativeRegistry.js` declares it). A pane
//     height is a per-indicator property, which is what lets a sixteenth
//     indicator cost one definition and zero list edits (plan §A5).
//   * its stack ORDER          → the INSTANCE LIST's order (plan §A5). Order is
//     user data, not a constant, the day panes become draggable.
//   * its volume row           → `VOLUME_PANE_HEIGHT`, one constant, because
//     volume is not an indicator instance and never will be one.
//
// `paneLayout.test.js` asserts the absence with a probe that matches the nine
// IDS rather than the identifier `PANES`, so a rename cannot dodge it.
//
// ─── WHAT MAKES THE GEOMETRY TOTAL ──────────────────────────────────────────
//
// lightweight-charts 5.2.0 throws on a price scale whose margins are outside
// `0 <= top <= 1`, `0 <= bottom <= 1`, `top + bottom <= 1`
// (`lightweight-charts.standalone.development.js:4548-4562`). `computePaneMargins`
// shipped a fix (`1c1b84bf`) for exactly that class: 1,178 illegal layouts, 895
// of which threw, at 4+ oscillators plus volume.
//
// This module cannot reproduce that class, and the reason is arithmetic rather
// than vigilance: EVERY horizontal boundary is one rounded cumulative fraction,
// measured from the BOTTOM of the chart —
//
//     px(c) = Math.round(c * chartHeight / 100)          // c in whole hundredths
//
// so `pane0.heightPx = chartHeight - px(oscTotalC)` and
// `mainBottomPx = chartHeight - px(oscTotalC + volumeC)`. `px` is monotone, so
// `mainBottomPx <= pane0.heightPx` HOLDS BY CONSTRUCTION — the negative bottom
// margin is unreachable, not merely unobserved. The remaining condition,
// `mainTopPx <= mainBottomPx`, follows from the band function's own ceiling
// (`MAX_STACK_C` = 69 hundredths): `round(0.30·H) + round(0.69·H) <= 0.99·H + 1`,
// which is `<= H` for every `H >= 100`. `paneLayout.test.js` sweeps the WHOLE
// space — 1,024 band configurations × every integer chart height in the declared
// range — rather than sampling it.
//
// ⚠️ PER-BAND ROUNDING WOULD NOT HAVE BEEN TOTAL, and it is the obvious version —
// round each band's own height to pixels and add them up. `Σ round(bandC_i · H /
// 100)` is not `round(Σ bandC_i · H / 100)`: with nine oscillators, no volume band
// and H = 594 the per-band sum is 414 px against a cumulative 410, so pane 0 comes
// out 180 px tall while the candle rectangle's own bottom edge is at 184 — a bottom
// margin of **-0.0222**, and the same throw `1c1b84bf` fixed. It was MEASURED, not
// reasoned about: `paneLayout.test.js`'s sweep is what says so, and the mutation
// that restores per-band rounding is in this task's gauntlet for that reason.

import { computePaneMargins } from '../paneMargins'
import { isInstanceTombstone } from '../chartDefaults'
import { getDefinition, listDefinitions } from './nativeRegistry'

/**
 * The height lightweight-charts gives a pane separator, in CSS pixels.
 *
 * MEASURED against the installed bundle, not assumed — see
 * `__tests__/paneSeparatorPin.test.js`, which builds a real two-pane chart and
 * reads back what the renderer kept for itself. Do not edit this without
 * re-running the 512-subset identity: the separators are taken out of the
 * OSCILLATOR panes precisely so that pane 0's rectangle does not move, and the
 * budget is `panes.length × SEPARATOR_PX`.
 */
export const SEPARATOR_PX = 1

/**
 * The volume band's height, as a fraction of the chart.
 *
 * ONE CONSTANT, not a tenth definition. Volume is not an indicator instance:
 * it has no `defId`, no inputs, no Style tab, and it is drawn by StockChart's
 * own series rather than by the binder. `paneMargins.PANES` listed it beside the
 * nine because that table was a stacking list; here the nine are data and this
 * is a constant, which is what the decomposition means.
 *
 * Transcribed from `paneMargins.js:48`. `paneLayout.test.js` asserts the two
 * agree by reading that file, so a drift on either side fails.
 */
export const VOLUME_PANE_HEIGHT = 0.15

/**
 * The height a pane-target definition gets when it declares none.
 *
 * `placement.pane.height` is OPTIONAL, so a new indicator costs one definition
 * and no geometry edit at all. 0.15 is the value six of the nine already use.
 */
export const DEFAULT_PANE_HEIGHT = 0.15

/** Transcribed from `paneMargins.js:18`. ~30% headroom above the highest candle. */
const MAIN_TOP = 0.30

/** Transcribed from `paneMargins.js:54`. The stack AIMS here; it is the LOOK. */
const STACK_TARGET = 0.72

/** Transcribed from `paneMargins.js:32`. The stack's ceiling in whole hundredths;
 *  this is the SAFETY bound, and it is what makes `mainTopPx < mainBottomPx`
 *  provable rather than hopeful. */
const MAX_STACK_C = 100 - Math.round(MAIN_TOP * 100) - 1   // 69 hundredths

/** lightweight-charts clamps every pane to at least this
 *  (`…development.js:11375`, `Math.max(calculatePaneHeight, 2)`), so a layout
 *  that asks for less silently stops summing to the chart height. The sweep in
 *  `paneLayout.test.js` asserts no pane in the declared space ever gets there. */
export const MIN_PANE_PX = 2

/** The key `computePaneMargins` gives the volume band. Not a definition id. */
const VOLUME_BAND_KEY = 'volume'

/** The key `computePaneMargins` gives the price area. Not a definition id. */
const MAIN_BAND_KEY = 'main'

// ─── which definitions own a pane ────────────────────────────────────────────

let _paneTargetIds = null

/**
 * Definition ids whose `placement.target` is `'pane'` — the ones that stack.
 *
 * DERIVED, never transcribed: a price overlay shares the candles' pane and must
 * never reserve vertical space, and the registry already says which is which.
 * Computed once; `listDefinitions()` returns a frozen catalogue built at import.
 */
function paneTargetIds() {
  if (_paneTargetIds === null) {
    _paneTargetIds = new Set(
      listDefinitions()
        .filter((d) => d && d.placement && d.placement.target === 'pane')
        .map((d) => d.id),
    )
  }
  return _paneTargetIds
}

/**
 * A definition's declared pane height, or the default.
 *
 * A malformed declaration (0, 1, a string) falls back rather than throwing:
 * `validateDefinition` already refuses those at REGISTRATION, so anything
 * reaching here is a definition that never registered, and a chart that draws is
 * better than a chart that throws inside the paint.
 */
function paneHeightFor(defId) {
  const h = getDefinition(defId)?.placement?.pane?.height
  return (typeof h === 'number' && Number.isFinite(h) && h > 0 && h < 1) ? h : DEFAULT_PANE_HEIGHT
}

// ─── stack order ─────────────────────────────────────────────────────────────

/**
 * The SHIPPED band order, top-to-bottom, read back out of `computePaneMargins`.
 *
 * ⭐ THIS IS WHY THERE IS NO ORDER TABLE HERE EITHER. `computePaneMargins`
 * inserts its keys in stacking order (bottom of the chart first), so its own
 * output already carries the order, and reading it back means the fallback
 * cannot drift from the thing it is a fallback for. It is also the only reader
 * of `paneMargins.js` in this module, which is what makes Flip C's retirement of
 * that file a single-import deletion rather than a re-derivation.
 *
 * ⚠️ EXISTENCE, NOT VISIBILITY, and membership comes from `cs.indicators` — the
 * pre-migration authority. Once the instance list is seeded (plan Task 9) this
 * branch returns nothing at all, because `cs.indicators` no longer carries the
 * oscillators.
 */
function shippedBandOrder(cs, excluded, hasVolumeBand) {
  let bands
  try {
    bands = computePaneMargins(cs, hasVolumeBand, excluded)
  } catch {
    // It runs inside the paint. A malformed blob is a missing band, not a blank
    // chart through StockChart's ErrorBoundary.
    return []
  }
  const stack = Object.keys(bands || {})
    .filter((k) => k !== MAIN_BAND_KEY && k !== VOLUME_BAND_KEY)
  stack.reverse()          // bottom-to-top ⇒ top-to-bottom, which is pane order
  return stack
}

/**
 * Pane keys, TOP-TO-BOTTOM — the order the panes are created in.
 *
 * The instance list is the authority on the order of every id it names. An id
 * that is enabled in `cs` but named by no instance keeps its shipped position,
 * appended below — the transitional state while some indicators are migrated and
 * some are not. Task 9 ends it by seeding the instance list from today's order,
 * after which the second half is empty by construction.
 */
function orderedPaneKeys(cs, instances, excluded, hasVolumeBand) {
  const paneIds = paneTargetIds()
  const keys = []
  const seen = new Set()

  for (const inst of (Array.isArray(instances) ? instances : [])) {
    if (!inst || typeof inst !== 'object') continue
    let tombstone = false
    try { tombstone = isInstanceTombstone(inst) } catch { /* booby-trapped getter */ }
    if (tombstone) continue
    const id = inst.defId
    if (typeof id !== 'string' || !paneIds.has(id)) continue
    if (excluded.has(id) || seen.has(id)) continue
    seen.add(id)
    keys.push(id)
  }

  for (const id of shippedBandOrder(cs, excluded, hasVolumeBand)) {
    if (seen.has(id)) continue
    seen.add(id)
    keys.push(id)
  }

  return keys
}

// ─── the arithmetic ──────────────────────────────────────────────────────────

/** First index holding the maximum. Ties go to the LOWEST index, which is the
 *  BOTTOM-most band — the same tie-break `paneMargins.js:68-71` makes, and the
 *  reason both shaves below are deterministic. */
function tallestIndex(heights) {
  let tallest = 0
  for (let i = 1; i < heights.length; i++) {
    if (heights[i] > heights[tallest]) tallest = i
  }
  return tallest
}

/**
 * Band heights in whole hundredths, bottom-to-top, INCLUDING the volume band.
 *
 * Byte-for-byte the arithmetic of `paneMargins.js:50-74`: the proportional
 * squeeze at `STACK_TARGET`, the 2-decimal quantisation held as integers, and
 * the one-hundredth-at-a-time shave off the tallest band until the stack fits
 * under `MAX_STACK_C`. The ONLY difference is where the base heights come from —
 * DEFINITIONS instead of a table — which is the point of the whole retirement.
 * The gauntlet proves the difference is real by editing one definition's declared
 * height and watching the 512-subset identity go red.
 */
function stackHundredths(baseHeights) {
  const totalBase = baseHeights.reduce((s, h) => s + h, 0)
  const scale = totalBase > STACK_TARGET ? STACK_TARGET / totalBase : 1
  const heightsC = baseHeights.map((h) => Math.round(+((h * scale).toFixed(2)) * 100))

  let stackC = heightsC.reduce((s, h) => s + h, 0)
  while (stackC > MAX_STACK_C) {
    heightsC[tallestIndex(heightsC)] -= 1
    stackC -= 1
  }
  return heightsC
}

/** The empty answer: one pane, whole chart, today's headroom. Returned for a
 *  chart with no usable height, so a caller never has to guard the call. */
function pane0Only(chartHeight, separatorPx) {
  const h = (Number.isFinite(chartHeight) && chartHeight > 0) ? chartHeight : 0
  return {
    chartHeight: h,
    separatorPx,
    panes: [],
    pane0: {
      heightPx: h,
      mainMargins: { top: MAIN_TOP, bottom: 0 },
      volumeMargins: null,
    },
  }
}

/**
 * The real-pane geometry for one chart.
 *
 * PURE. No LWC import, no clock, no globals; the same arguments always produce
 * the same object.
 *
 * @param {object} cs merged chart settings (read only through `computePaneMargins`)
 * @param {object[]} instances the engine's indicator instances, in stack order
 * @param {object} opts
 * @param {number} opts.chartHeight the pane stack's total height in CSS pixels
 *        (the chart's height MINUS the time axis — that is the budget LWC
 *        distributes, `…development.js:11358-11359`)
 * @param {boolean} opts.hasVolumeBand volume shares pane 0 as a band. FALSE when
 *        volume has its own LWC pane — the same flag `StockChart.jsx:5941`
 *        passes as `computePaneMargins`' `hasVolume`
 * @param {Set<string>|string[]} opts.excludeKeys indicators overlaid into the
 *        volume pane, which reserve no space
 * @param {number} opts.separatorPx pixels LWC keeps between two panes
 * @returns {{chartHeight: number, separatorPx: number,
 *            panes: {key: string, index: number, heightPx: number, stretchFactor: number}[],
 *            pane0: {heightPx: number,
 *                    mainMargins: {top: number, bottom: number},
 *                    volumeMargins: {top: number, bottom: number}|null}}}
 */
export function computePaneLayout(cs, instances, opts) {
  const o = opts || {}
  const chartHeight = o.chartHeight
  const hasVolumeBand = !!o.hasVolumeBand
  const separatorPx = Number.isFinite(o.separatorPx) ? o.separatorPx : SEPARATOR_PX
  const excluded = o.excludeKeys instanceof Set ? o.excludeKeys : new Set(o.excludeKeys || [])

  if (!Number.isFinite(chartHeight) || chartHeight <= 0) return pane0Only(chartHeight, separatorPx)

  const keys = orderedPaneKeys(cs, instances, excluded, hasVolumeBand)
  if (!keys.length && !hasVolumeBand) return pane0Only(chartHeight, separatorPx)

  // Bottom-to-top, because that is the order the squeeze and both shaves run in
  // and their tie-breaks are index-sensitive. Volume is the TOP band: it sits
  // directly under the price area, exactly as `paneMargins.PANES` puts it last.
  const bottomToTop = [...keys].reverse()
  const baseHeights = bottomToTop.map(paneHeightFor)
  if (hasVolumeBand) baseHeights.push(VOLUME_PANE_HEIGHT)

  const heightsC = stackHundredths(baseHeights)
  const oscCount = bottomToTop.length
  const oscTotalC = heightsC.slice(0, oscCount).reduce((s, h) => s + h, 0)
  const volumeC = hasVolumeBand ? heightsC[oscCount] : 0

  // EVERY boundary is one rounded cumulative fraction measured from the BOTTOM.
  // See the header: this is what makes the geometry total.
  const px = (c) => Math.round((c * chartHeight) / 100)

  const rawPx = []
  let cumC = 0
  for (let i = 0; i < oscCount; i++) {
    const nextC = cumC + heightsC[i]
    rawPx.push(px(nextC) - px(cumC))
    cumC = nextC
  }

  // ─ the separator budget comes out of the OSCILLATORS, never out of pane 0 ─
  //
  // A 1 px compression across ~70% of the canvas costs tens of thousands of
  // pixels; the same compression inside an 88 px strip costs a few thousand.
  // Same tallest-first, lowest-index-wins shave as the hundredths trim above, so
  // the result is deterministic and the total is exact.
  const paneHeights = rawPx.slice()
  for (let budget = oscCount * separatorPx; budget > 0; budget--) {
    paneHeights[tallestIndex(paneHeights)] -= 1
  }

  const pane0HeightPx = chartHeight - px(oscTotalC)
  const mainTopPx = Math.round(MAIN_TOP * chartHeight)
  const mainBottomPx = chartHeight - px(oscTotalC + volumeC)

  return {
    chartHeight,
    separatorPx,
    // Top-to-bottom, so `index` is the LWC pane index a series is moved to.
    // `stretchFactor` IS the pixel height: stretch factors distribute the
    // AVAILABLE height (chart minus separators minus time axis), so a factor set
    // to a target pixel count lands on it exactly — measured, not assumed, in
    // `__tests__/paneSeparatorPin.test.js`.
    panes: keys.map((key, i) => {
      const heightPx = paneHeights[oscCount - 1 - i]
      return { key, index: i + 1, heightPx, stretchFactor: heightPx }
    }),
    pane0: {
      heightPx: pane0HeightPx,
      // Re-expressed as fractions of PANE 0's height rather than the chart's, so
      // the candle rectangle lands on the same absolute pixels it does today.
      // That identity is what lets the `price_plot` parity region read 0.
      mainMargins: {
        top: mainTopPx / pane0HeightPx,
        bottom: 1 - (mainBottomPx / pane0HeightPx),
      },
      volumeMargins: hasVolumeBand
        ? { top: mainBottomPx / pane0HeightPx, bottom: 0 }
        : null,
    },
  }
}

// ─── reading the renderer back ───────────────────────────────────────────────

/**
 * The chart the page should publish a manifest for, and how to name its series.
 *
 * ⚠️ A REGISTRY AND NOT A PROP, because the page that publishes the manifest
 * (`pages/ChartRender.jsx`) does not own the chart: `StockChart` keeps its
 * `IChartApi` in a ref and exposes it through no prop, no ref and no callback,
 * and StockChart.jsx belongs to a later task. So the chart announces ITSELF and
 * the page reads whatever is announced.
 *
 * ONE SLOT ON PURPOSE. The parity route renders exactly one chart, and a page
 * with two charts has no single manifest to publish anyway.
 */
let _manifestSource = null

/**
 * Announce a chart (and, optionally, the binder's bindings) for the manifest.
 * @param {object} chart an `IChartApi`
 * @param {() => object[]} getBindings optional — the engine's current bindings
 * @returns {() => void} an unregister function, safe to call twice
 */
export function registerManifestChart(chart, getBindings) {
  const entry = { chart, getBindings }
  _manifestSource = entry
  return () => { if (_manifestSource === entry) _manifestSource = null }
}

/** The registered chart's manifest, or null when nothing has registered. */
export function currentPaneManifest() {
  if (!_manifestSource) return null
  const { chart, getBindings } = _manifestSource
  let bindings = null
  try { bindings = typeof getBindings === 'function' ? getBindings() : null } catch { bindings = null }
  return paneManifest(chart, bindings)
}

/**
 * A JSON-serialisable description of what the renderer ACTUALLY built, read back
 * from the renderer rather than predicted.
 *
 * The plan's discriminator #3: a change that moves pixels but not this, or this
 * but not the pixels, is a regression by definition — one of the two is lying.
 *
 * Never throws and never returns a half-built object: a chart that cannot answer
 * is a MISSING manifest (`null`), which `tools/chart_parity.py::read_manifest`
 * records as a stated reason. An exception at run 13 of 20 is not visible; a
 * `null` in `report.json` is.
 *
 * ⚠️ `chartHeight` here is the PANE STACK's height — the sum of the panes plus
 * the separators between them, i.e. the chart's height minus the time axis. That
 * is the budget the layout distributes, and the number `computePaneLayout` takes.
 *
 * ⚠️ THE SERIES' SCALE ID COMES FROM `series.options()`, NOT FROM THE PRICE
 * SCALE. `IPriceScaleApi` in lightweight-charts 5.2.0 has exactly six members —
 * applyOptions, options, width, setVisibleRange, getVisibleRange, setAutoScale
 * (`typings.d.ts`) — and `priceScaleId()` is not one of them, so the obvious
 * `series.priceScale().priceScaleId()` reads `undefined` on every series and the
 * manifest would silently report `null` for the field the cutover is most
 * supposed to be watched on. (`ISeriesApi.priceScale()` does compute the true id
 * internally — `series._internal_priceScale()._internal_id()`, dev bundle
 * :12758 — but only to construct a fresh `PriceScaleApi`, which exposes neither
 * the id nor a stable identity: `chart.priceScale(id)` returns a NEW object on
 * every call, :13152, so an identity comparison cannot recover it either.)
 *
 * 🔴 AND `SeriesOptionsCommon.priceScaleId` IS **NOT** RESOLVED — this paragraph
 * used to end by saying it was, and B5 Task 8 measured that false. LWC leaves the
 * option `undefined` when the caller omits it and resolves it only at insertion
 * (`targetScaleId = priceScaleId !== undefined ? priceScaleId :
 * defaultVisiblePriceScaleId()`, :7334-7335), so a series created WITHOUT the
 * option reported `null` here while sitting on exactly the same scale as its
 * neighbour that passed `'right'`. That is not a nuance: `donchian`'s shipped
 * block is the ONE legacy indicator block that omitted `priceScaleId` (`sar`,
 * `ichimoku`, `mfi`, `cci`, `williamsR`, `adx`, `obv` and the MA overlays all
 * pass it), so migrating it moved three `scaleId`s from `None` to `'right'` with
 * **0 changed pixels** — a GEOMETRY diff, which no `expectProvenance` can declare
 * away and which the gate is designed to refuse. The renderer had not changed;
 * the manifest was reporting WHICH OPTION WAS PASSED rather than WHICH SCALE THE
 * SERIES IS ON, and geometry means the second.
 *
 * ⛔ SO AN ABSENT OPTION IS RESOLVED THE WAY LWC RESOLVES IT, from the chart's
 * own PUBLIC options (`_defaultVisibleScaleId`), and the candles — which have
 * always omitted it too — now report `'right'` instead of `null`. This is
 * strictly STRONGER, not a tolerance: two series on DIFFERENT default scales
 * used to read identically (`null` both), and now they read `'right'` and
 * `'left'`.
 */
/**
 * Which scale LWC will put a series on when its options carry no `priceScaleId`.
 *
 * A transcription of `ChartModel._internal_defaultVisiblePriceScaleId`
 * (lightweight-charts 5.2.0 dev bundle :7214-7222) over the PUBLIC
 * `chart.options()`: when exactly one of the two default scales is visible that
 * one wins, otherwise the chart's declared `defaultVisiblePriceScaleId` does.
 * `null` when the chart cannot answer — a manifest never guesses.
 */
function _defaultVisibleScaleId(chart) {
  let o = null
  try { o = chart && typeof chart.options === 'function' ? chart.options() : null } catch { o = null }
  if (!o) return null
  const left = o.leftPriceScale?.visible === true
  const right = o.rightPriceScale?.visible === true
  if (left !== right) return left ? 'left' : 'right'
  return o.defaultVisiblePriceScaleId ?? null
}

export function paneManifest(chart, bindings) {
  let panes
  try { panes = chart && typeof chart.panes === 'function' ? chart.panes() : null } catch { panes = null }
  if (!Array.isArray(panes)) return null
  const dfltScaleId = _defaultVisibleScaleId(chart)

  const byPane = new Map()
  for (const b of (Array.isArray(bindings) ? bindings : [])) {
    if (!b || !b.series) continue
    byPane.set(b.series, { key: b.key ?? null, scaleId: b.scaleId ?? null })
  }

  const heights = panes.map((p) => {
    const h = typeof p?.getHeight === 'function' ? p.getHeight() : null
    return Number.isFinite(h) ? h : 0
  })

  return {
    chartHeight: heights.reduce((s, h) => s + h, 0)
      + Math.max(0, panes.length - 1) * SEPARATOR_PX,
    separatorPx: SEPARATOR_PX,
    panes: panes.map((p, i) => ({
      index: typeof p?.paneIndex === 'function' ? p.paneIndex() : i,
      height: heights[i],
      stretchFactor: typeof p?.getStretchFactor === 'function' ? p.getStretchFactor() : null,
      series: (typeof p?.getSeries === 'function' ? p.getSeries() : []).map((s) => {
        const meta = byPane.get(s) || {}
        let opts = null
        try { opts = typeof s?.options === 'function' ? s.options() : null } catch { opts = null }
        return {
          type: typeof s?.seriesType === 'function' ? s.seriesType() : null,
          scaleId: opts?.priceScaleId ?? meta.scaleId ?? dfltScaleId,
          key: meta.key ?? null,
        }
      }),
    })),
  }
}
