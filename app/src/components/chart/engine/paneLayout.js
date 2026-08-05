// app/src/components/chart/engine/paneLayout.js
//
// ─── THE GEOMETRY, AS A PURE FUNCTION — AND NOW THE ONLY COPY OF IT ─────────
//
// This answers BOTH questions the chart can ask about vertical space:
//
//   * `bands`  — "what slice of pane 0 does each oscillator get", the shape
//     `computePaneMargins` used to return, key for key and value for value;
//   * `panes`  — "which PANE does each oscillator get, and how tall is it",
//     which is the same question after Flip C, when the bands become panes.
//
// ⭐ B5 TASK 12 RETIRED `chart/paneMargins.js` INTO THIS FILE, and the reason
// both answers live here is that they were always ONE piece of arithmetic
// written down twice. The proportional squeeze, the integer-hundredths
// quantisation and the deterministic tallest-first shave are computed ONCE, in
// `stackHundredths`, and the two outputs are two readings of the same
// `heightsC` array. That is what makes pane 0's rectangle land on the same
// pixels and — while `PANE_MODE` was `'bands'` — made the `price_plot` parity
// region read 0. See the plan's §A6 for the identity and §A7 for why heights
// are set as stretch factors.
//
// ⛔ NO NINE-ROW TABLE LIVES HERE. `paneMargins.PANES` was three different facts
// wearing one coat, and moving the coat would have been a rename, not a
// retirement:
//
//   * its nine `baseH` values  → `placement.pane.height` on each DEFINITION
//     (`defSchema.js` validates it, `nativeRegistry.js` declares it). A pane
//     height is a per-indicator property, which is what lets a sixteenth
//     indicator cost one definition and zero list edits (plan §A5).
//   * its stack ORDER          → the INSTANCE LIST's order (plan §A5). Order is
//     user data, not a constant, the day panes become draggable. The order the
//     shipped stack had on the day it retired is `instances.SHIPPED_STACK_ORDER`,
//     which the v1→v2 fold seeds every existing user's list from.
//   * its volume row           → `VOLUME_PANE_HEIGHT`, one constant, because
//     volume is not an indicator instance and never will be one.
//
// `paneLayout.test.js` asserts the absence with a probe that matches the nine
// IDS rather than the identifier `PANES`, so a rename cannot dodge it — and it
// holds a FROZEN transcription of the retired `computePaneMargins`, table and
// all, as the oracle the 512-subset identity is measured against. A frozen copy
// in a test cannot co-drift with the implementation; the live function it used
// to read could.
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

// ─── FLIP C: THE ONE CONSTANT ────────────────────────────────────────────────

/**
 * `'bands'` — every oscillator is a stacked band inside pane 0, exactly as it has
 * been since the chart shipped. `'panes'` — every oscillator gets a REAL
 * lightweight-charts pane with a draggable divider.
 *
 * ⭐ FLIP C, APPLIED — 2026-08-05, `docs/decisions/2026-08-04-flip-c-pane-geometry.md`.
 *
 * THIS CONSTANT IS THE WHOLE CUTOVER, DELIBERATELY. It landed dark at B5 Task 10
 * with the 46-case gate at 0 changed pixels, so THIS commit's diff is the only
 * thing in the frame for every number in that record. Reversal is one edit and is
 * priced at the same numbers — which is exactly why the constant is KEPT and not
 * inlined away, following `MACD_HEAD_MASK`. `'bands'` is still a live, tested
 * mode: `computePaneLayout` returns the band map as well as the pane
 * decomposition, so the geometry the flip reverses TO did not retire with
 * `paneMargins.js`.
 *
 * The owner's answer, in full (record §5): SHIP, PRESERVING TODAY'S PANE HEIGHTS
 * (2.3 — LWC's equal split rejected at 195,658 px on `rsi_only`, 26.3 % of the
 * canvas), TAKE THE SEPARATOR TOKEN (2.1 — 2,400 px), YES TO THE PER-PANE PRICE
 * AXIS (2.2 — 372 px, every pixel inside `osc_strip`).
 *
 * ⛔ NOTHING READS THIS BINDING DIRECTLY EXCEPT `paneMode()` BELOW. A direct
 * `PANE_MODE === 'panes'` comparison in a consumer is a reader the test seam
 * cannot reach, i.e. a mode with no coverage — `__tests__/flipCGeometry.test.jsx`
 * scans `app/src` and fails on one.
 */
export const PANE_MODE = 'panes'

/**
 * The override the TESTS use, and the reason `paneMode()` is a function.
 *
 * Driving the real-pane path needs both modes alive in one process: the `bands`
 * half asserts the default path is byte-identical to today, and the `panes` half
 * asserts the cutover actually builds panes. Module-level mocking would give one
 * mode per FILE and would replace the very module under test.
 *
 * ⛔ PRODUCTION NEVER CALLS `__setPaneModeForTest`. `__tests__/flipCGeometry.test.jsx`
 * proves it by scanning `app/src` for the identifier outside `__tests__`.
 */
let _paneModeOverride = null

/** The active pane mode. THE ONLY READER of `PANE_MODE`. */
export function paneMode() {
  return _paneModeOverride || PANE_MODE
}

/** TEST ONLY — see `_paneModeOverride`. Pass `null` to restore the constant. */
export function __setPaneModeForTest(mode) {
  _paneModeOverride = (mode === 'panes' || mode === 'bands') ? mode : null
}

/**
 * The volume band's height, as a fraction of the chart.
 *
 * ONE CONSTANT, not a tenth definition. Volume is not an indicator instance:
 * it has no `defId`, no inputs, no Style tab, and it is drawn by StockChart's
 * own series rather than by the binder. `paneMargins.PANES` listed it beside the
 * nine because that table was a stacking list; here the nine are data and this
 * is a constant, which is what the decomposition means.
 *
 * Transcribed from the retired `paneMargins.js:48`. `paneLayout.test.js` asserts
 * it against that file's frozen table, so a drift on either side fails.
 */
export const VOLUME_PANE_HEIGHT = 0.15

/**
 * The height a pane-target definition gets when it declares none.
 *
 * `placement.pane.height` is OPTIONAL, so a new indicator costs one definition
 * and no geometry edit at all. 0.15 is the value six of the nine already use.
 */
export const DEFAULT_PANE_HEIGHT = 0.15

/** Transcribed from the retired `paneMargins.js:18`. ~30% headroom above the
 *  highest candle. */
const MAIN_TOP = 0.30

/** The candle rectangle when the stack is empty, or before the first sync has
 *  measured one. `computePaneMargins` answered this from a settings blob at any
 *  moment; the layout answers it from a chart, so a caller with no chart yet gets
 *  THIS and is corrected in the same commit (`StockChart.updateChart` re-asserts
 *  the candles' margins the moment a layout exists — B5 Task 10's fix for the
 *  options effect running first). */
export const NO_STACK_MAIN_MARGINS = Object.freeze({ top: MAIN_TOP, bottom: 0 })

/** Transcribed from the retired `paneMargins.js:54`. The stack AIMS here; it is
 *  the LOOK. */
const STACK_TARGET = 0.72

/** Transcribed from the retired `paneMargins.js:32`. The stack's ceiling in whole hundredths;
 *  this is the SAFETY bound, and it is what makes `mainTopPx < mainBottomPx`
 *  provable rather than hopeful. */
const MAX_STACK_C = 100 - Math.round(MAIN_TOP * 100) - 1   // 69 hundredths

/** lightweight-charts clamps every pane to at least this
 *  (`…development.js:11375`, `Math.max(calculatePaneHeight, 2)`), so a layout
 *  that asks for less silently stops summing to the chart height. The sweep in
 *  `paneLayout.test.js` asserts no pane in the declared space ever gets there. */
export const MIN_PANE_PX = 2

/** The key the volume band carries in `bands`. Not a definition id. */
const VOLUME_BAND_KEY = 'volume'

/** The key the price area carries in `bands`. Not a definition id. */
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
 * Pane keys, TOP-TO-BOTTOM — the order the panes are created in.
 *
 * ⭐ THE INSTANCE LIST IS THE ONLY AUTHORITY, AND B5 TASK 12 IS WHERE IT BECAME
 * THE ONLY ONE. A second loop stood here, appending any id that was enabled in
 * `cs.indicators` but named by no instance, in the order `computePaneMargins`
 * stacked it — the transitional state while some indicators were migrated and
 * some were not. Task 9 ended that state by folding `cs.indicators` into
 * `indicatorInstances`, so the loop had nothing left to append; Task 12 deletes
 * it along with the function it read the order out of. `cs` was that loop's only
 * argument, which is why this function and `computePaneLayout` no longer take one.
 *
 * ✅ THE LIST'S ORDER IS THE FOLD'S ORDER, AND THE FOLD SEEDS IN
 * `instances.SHIPPED_STACK_ORDER` — so an existing user's panes come out in the
 * order their BANDS are in today. ⚠️ THIS PARAGRAPH HAS BEEN WRONG IN BOTH
 * DIRECTIONS: it claimed the seed was stack-ordered while Task 12 measured it was
 * registry-ordered, and it then claimed registry order permanently. B5 Task 13
 * changed the FOLD (not this function) and re-measured. Do not re-word it from
 * either note — read `instances.migrateLegacyToInstances` and, if in doubt, run
 * the case `settingsBlobMigration.test.js` calls *"a stored July blob's panes come
 * out in the SHIPPED stack order"*, which drives a real blob through both.
 *
 * ⛔ AND THE SORT IS NOT HERE ON PURPOSE. Ordering the panes inside this function
 * would give the layout back the shipped order and leave every OTHER reader of
 * the instance list — the legend, which prints in binding order — in whatever
 * order the list is in. `legendFromDefinitions.test.jsx` pins the two together;
 * one list, two readings.
 */
function orderedPaneKeys(instances, excluded) {
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

// ─── THE FRAME OF REFERENCE ──────────────────────────────────────────────────
//
// 🔴 B5 TASK 11 MEASURED THREE DEFECTS AND THEY ARE ONE DEFECT: this module used
// `chartHeight` — the WHOLE pane stack — where the band arithmetic it reproduces
// means the CANDLE PANE's own height. The two are the same number exactly when
// `firstPaneIndex === 1`, which is the case Task 3's totality proof covers and
// **not a configuration this app renders**: `ChartWidget`, `GridChartCell`,
// `IntradayDayPopover`, `BottomsView` and `ChartRender` all pass
// `volumeSeparatePane` unconditionally, so there is always a volume pane between
// pane 0 and the stack. The conflation surfaced three ways:
//
//   D1  the separator budget removed `oscCount` separators from a height that
//       already contained the `firstPaneIndex - 1` separators of the panes ABOVE
//       the stack, so the layout over-allocated by exactly `firstPaneIndex - 1`
//       px and `paneHeightMismatch` threw into StockChart's ErrorBoundary —
//       a DETERMINISTIC BLANK CHART, on every one of the 46 parity cases, and
//       also on a chart with no oscillator at all.
//   D2  (see `paneHeightMismatch` below — the assertion, not the geometry).
//   D3  `pane0.mainMargins` were fractions of the price-pane BUDGET and were
//       applied to the candles' OWN scale, so the candle rectangle was re-fitted
//       and the `price_plot` parity region could not read 0. Dividing by the
//       candle pane's own height WITHOUT also fixing the numerators produces a
//       NEGATIVE bottom margin (452/353), which lightweight-charts refuses —
//       i.e. the naive half of the fix is a second blank chart.
//
// So the fix is one substitution, made once, here: every band fraction is a
// fraction of `mainHeightPx` — what the candle pane measures in BANDS mode —
// and the panes above the stack keep the heights they have. At
// `firstPaneIndex === 1` `mainHeightPx === chartHeight` and every line below is
// the arithmetic that shipped, so **Task 3's 1,966,080-layout proof is untouched
// rather than re-argued**. D1 does not need its own correction: the pre-existing
// separators are excluded from the budget before it is split, so the stack still
// pays for exactly the `oscCount` separators it adds.

/**
 * What each pane ABOVE the oscillator stack measures in BANDS mode.
 *
 * ⭐ THIS IS THE REFERENCE THE WHOLE MODULE IS MISSING. In `'bands'` the
 * oscillators occupy no pane at all, so the chart's panes are exactly these and
 * lightweight-charts distributes `chartHeight - (n - 1) * separatorPx` among them
 * in proportion to their stretch factors. Reconstructing it from the PERCENTAGES
 * (which come from settings — `cs.volume.paneHeightPct`, `indexPaneHeightPct` —
 * and not from the renderer) is what makes the layout a FIXED POINT: reading the
 * live factors back would re-derive a different reference on every sync, because
 * this module rewrites those factors as pixel counts.
 *
 * The remainder lands on the CANDLE pane so the sum is exact: rounding every
 * share independently loses a pixel off the stack (three equal weights over 100
 * give 33+33+33), and a one-pixel drift is a week of bisecting.
 *
 * ⚠️ MEASURED, NOT ASSUMED: `__tests__/flipCGeometry.test.jsx` builds a REAL
 * two-pane chart at 78/22 and asserts the renderer's own heights equal what this
 * returns.
 */
function bandsAboveHeights(chartHeight, firstPaneIndex, separatorPx, abovePct, mainPaneIndex) {
  const n = firstPaneIndex
  const available = chartHeight - Math.max(0, n - 1) * separatorPx
  const out = new Array(n).fill(0)
  if (n <= 1) { out[0] = available; return out }
  const total = abovePct.reduce((s, w) => s + w, 0)
  if (!(total > 0)) { out[mainPaneIndex] = available; return out }
  let assigned = 0
  for (let i = 0; i < n; i++) {
    if (i === mainPaneIndex) continue
    const px = Math.round((available * abovePct[i]) / total)
    out[i] = px
    assigned += px
  }
  out[mainPaneIndex] = available - assigned
  return out
}

/** The above-stack percentages, defaulted so a caller that says nothing gets the
 *  one-pane-above chart the identity was proved for. A malformed entry is 0,
 *  never NaN: `Number(null) === 0` has bitten this branch eight times. */
function normalisedAbovePct(raw, firstPaneIndex) {
  const src = Array.isArray(raw) ? raw : []
  const out = new Array(firstPaneIndex)
  for (let i = 0; i < firstPaneIndex; i++) {
    const v = src[i]
    out[i] = (typeof v === 'number' && Number.isFinite(v) && v > 0) ? v : 0
  }
  if (!out.some((v) => v > 0)) out.fill(1)
  return out
}

/**
 * The BAND map — `computePaneMargins`' entire output, from the same `heightsC`.
 *
 * ⭐ B5 TASK 12: THIS IS WHERE `paneMargins.js` WENT, and it is a MERGE rather
 * than a move. The band fractions and the pane pixel heights were always two
 * readings of one quantised stack; the retired module computed the stack a
 * second time from a nine-row table and `cs.indicators[key].enabled`, which is
 * why a projection module had to exist to keep that second copy honest once the
 * instance list became the authority. There is one copy now, so there is nothing
 * to project.
 *
 * ⛔ THE EXPRESSIONS ARE VERBATIM, NOT EQUIVALENT — `(100 - nextC) / 100` and
 * `bottomC / 100`, off the integer hundredths, never off the rounded pixels.
 * Deriving them from `px()` instead would move a band by a fraction of a pixel
 * on some heights and nothing would say so. Insertion order is bottom-to-top
 * then `main`, as it was, because that order was READ BACK as the stack order for
 * two phases.
 *
 * Height-independent by construction, which is stronger than the function it
 * replaces needed to be: a chart that cannot yet report a height still gets the
 * right bands.
 */
function bandMap(bottomToTop, heightsC, oscCount, hasVolumeBand) {
  const out = {}
  let bottomC = 0
  for (let i = 0; i < heightsC.length; i++) {
    const key = i < oscCount ? bottomToTop[i] : VOLUME_BAND_KEY
    const nextC = bottomC + heightsC[i]
    out[key] = { top: (100 - nextC) / 100, bottom: bottomC / 100 }
    bottomC = nextC
  }
  out[MAIN_BAND_KEY] = { top: MAIN_TOP, bottom: bottomC / 100 }
  return out
}

/** The empty answer: no oscillator pane at all. The panes above the stack keep
 *  the heights bands mode gives them, so the total is exact even when there is
 *  nothing to shave a separator off — the no-oscillator half of D1. */
function pane0Only(chartHeight, separatorPx, firstPaneIndex, abovePct, mainPaneIndex, bands) {
  const h = (Number.isFinite(chartHeight) && chartHeight > 0) ? chartHeight : 0
  const above = h > 0
    ? bandsAboveHeights(h, firstPaneIndex, separatorPx, abovePct, mainPaneIndex)
    : new Array(firstPaneIndex).fill(0)
  return {
    chartHeight: h,
    separatorPx,
    firstPaneIndex,
    mainPaneIndex,
    panes: [],
    above,
    bands,
    pane0: {
      heightPx: above[mainPaneIndex],
      stretchFactor: above[mainPaneIndex],
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
 * ⛔ IT NO LONGER TAKES A `cs`. The settings blob reached exactly one line of this
 * module — the fallback that ordered any id enabled in `cs.indicators` but named
 * by no instance — and B5 Task 9 emptied that set by folding `cs.indicators`
 * away. Keeping the parameter would have been a reader nobody can see is dead.
 *
 * @param {object[]} instances the engine's indicator instances, in stack order
 * @param {object} opts
 * @param {number} opts.chartHeight the pane stack's total height in CSS pixels
 *        (the chart's height MINUS the time axis — that is the budget LWC
 *        distributes, `…development.js:11358-11359`)
 * @param {boolean} opts.hasVolumeBand volume shares pane 0 as a band. FALSE when
 *        volume has its own LWC pane — the same flag the retired
 *        `computePaneMargins` took as `hasVolume`
 * @param {Set<string>|string[]} opts.excludeKeys indicators overlaid into the
 *        volume pane, which reserve no space
 * @param {number} opts.separatorPx pixels LWC keeps between two panes
 * @param {number} [opts.firstPaneIndex=1] the LWC pane index the oscillator stack
 *        STARTS at. 1 when the candles' pane is the only thing above it — the
 *        case the identity is proved for. A chart that also has a SEPARATE volume
 *        pane (`volInSeparatePane`, or any volume-overlay indicator) or a Model
 *        Book index pane has those between pane 0 and the stack, so the caller
 *        says how many. ⚠️ ADDED BY FLIP C AND DEFAULTED, because Task 3 proved
 *        totality over the one-pane-above case and a defaulted parameter cannot
 *        invalidate that proof — it renames indices, it does not move a pixel.
 * @param {number[]} [opts.abovePct=[100]] the BANDS-MODE stretch percentages of
 *        the panes above the stack, in pane order — `[100 - volPct, volPct]` on
 *        the shipped chart. Settings-derived, never read back off the renderer,
 *        so the layout is a fixed point. See `bandsAboveHeights`.
 * @param {number} [opts.mainPaneIndex=0] which of those panes holds the CANDLES.
 *        0 everywhere except Model Book, whose index-comparison pane is hoisted
 *        to pane 0 (`StockChart.jsx` `s.getPane().moveTo(0)`).
 * @returns {{chartHeight: number, separatorPx: number, firstPaneIndex: number,
 *            mainPaneIndex: number, above: number[],
 *            bands: Object<string, {top: number, bottom: number}>,
 *            panes: {key: string, index: number, heightPx: number, stretchFactor: number}[],
 *            pane0: {heightPx: number,
 *                    mainMargins: {top: number, bottom: number},
 *                    volumeMargins: {top: number, bottom: number}|null}}}
 */
export function computePaneLayout(instances, opts) {
  const o = opts || {}
  const chartHeight = o.chartHeight
  const hasVolumeBand = !!o.hasVolumeBand
  const separatorPx = Number.isFinite(o.separatorPx) ? o.separatorPx : SEPARATOR_PX
  const excluded = o.excludeKeys instanceof Set ? o.excludeKeys : new Set(o.excludeKeys || [])
  const firstPaneIndex = (Number.isInteger(o.firstPaneIndex) && o.firstPaneIndex >= 1)
    ? o.firstPaneIndex : 1
  const abovePct = normalisedAbovePct(o.abovePct, firstPaneIndex)
  const mainPaneIndex = (Number.isInteger(o.mainPaneIndex)
    && o.mainPaneIndex >= 0 && o.mainPaneIndex < firstPaneIndex) ? o.mainPaneIndex : 0

  const keys = orderedPaneKeys(instances, excluded)

  // Bottom-to-top, because that is the order the squeeze and both shaves run in
  // and their tie-breaks are index-sensitive. Volume is the TOP band: it sits
  // directly under the price area, exactly as the retired `PANES` put it last.
  const bottomToTop = [...keys].reverse()
  const baseHeights = bottomToTop.map(paneHeightFor)
  if (hasVolumeBand) baseHeights.push(VOLUME_PANE_HEIGHT)

  const heightsC = stackHundredths(baseHeights)
  const oscCount = bottomToTop.length

  // ⭐ THE BAND MAP IS COMPUTED BEFORE ANY HEIGHT GUARD, because it does not need
  // a height and its consumers (a right-click resolver, the candles' own
  // margins) can be asked before the renderer can answer one.
  const bands = bandMap(bottomToTop, heightsC, oscCount, hasVolumeBand)

  if (!Number.isFinite(chartHeight) || chartHeight <= 0) {
    return pane0Only(chartHeight, separatorPx, firstPaneIndex, abovePct, mainPaneIndex, bands)
  }
  if (!keys.length && !hasVolumeBand) {
    return pane0Only(chartHeight, separatorPx, firstPaneIndex, abovePct, mainPaneIndex, bands)
  }

  // ⭐ THE SUBSTITUTION. Every fraction below is a fraction of THIS, not of the
  // chart — see "THE FRAME OF REFERENCE" above. Identical at firstPaneIndex 1.
  const above = bandsAboveHeights(chartHeight, firstPaneIndex, separatorPx, abovePct, mainPaneIndex)
  const mainHeightPx = above[mainPaneIndex]

  const oscTotalC = heightsC.slice(0, oscCount).reduce((s, h) => s + h, 0)
  const volumeC = hasVolumeBand ? heightsC[oscCount] : 0

  // EVERY boundary is one rounded cumulative fraction measured from the BOTTOM
  // OF THE CANDLE PANE. See the header: this is what makes the geometry total.
  const px = (c) => Math.round((c * mainHeightPx) / 100)

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
  //
  // ⭐ `oscCount`, NOT `oscCount + firstPaneIndex - 1`: the separators of the
  // panes ABOVE the stack were already taken out of `bandsAboveHeights`' budget,
  // so the stack pays for exactly the separators it ADDS. That is D1, fixed by
  // the frame rather than by a second correction term.
  const paneHeights = rawPx.slice()
  for (let budget = oscCount * separatorPx; budget > 0; budget--) {
    paneHeights[tallestIndex(paneHeights)] -= 1
  }

  // The candle pane's OWN height — what its price scale's margins are fractions
  // of. `above` still carries the other panes' heights unchanged, which is why
  // the volume pane no longer shrinks through the cutover.
  const pane0HeightPx = mainHeightPx - px(oscTotalC)
  const mainTopPx = Math.round(MAIN_TOP * mainHeightPx)
  const mainBottomPx = mainHeightPx - px(oscTotalC + volumeC)
  above[mainPaneIndex] = pane0HeightPx

  return {
    chartHeight,
    separatorPx,
    firstPaneIndex,
    mainPaneIndex,
    above,
    bands,
    // Top-to-bottom, so `index` is the LWC pane index a series is moved to.
    // `stretchFactor` IS the pixel height: stretch factors distribute the
    // AVAILABLE height (chart minus separators minus time axis), so a factor set
    // to a target pixel count lands on it exactly — measured, not assumed, in
    // `__tests__/paneSeparatorPin.test.js`.
    panes: keys.map((key, i) => {
      const heightPx = paneHeights[oscCount - 1 - i]
      return { key, index: firstPaneIndex + i, heightPx, stretchFactor: heightPx }
    }),
    pane0: {
      heightPx: pane0HeightPx,
      // ✅ THE CANDLE PANE's OWN HEIGHT — and it used to be the price-pane BUDGET
      // (pane 0 PLUS the volume pane PLUS any index pane), which is D3: the
      // margins below are applied to the candles' own scale, whose height is this
      // and not that. The other panes above the stack are in `above`, unchanged;
      // ONE number now means ONE thing.
      stretchFactor: pane0HeightPx,
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

/**
 * The stretch factor every pane on the chart should be given, in pane order.
 *
 * PURE, and separate from the renderer call that applies it, because this is
 * arithmetic and `binder.js` is the only file allowed to touch the renderer.
 *
 * ⭐ PLAN §A7: LWC distributes `available = chartHeight - Σ separators` in
 * proportion to the stretch factors, so factors SET TO THE TARGET PIXEL HEIGHTS
 * land on them exactly — measured against the installed bundle in
 * `__tests__/paneSeparatorPin.test.js`.
 *
 * Three kinds of pane, and only one of them is the layout's:
 *
 *   * the oscillator stack (`firstPaneIndex …`) gets its declared pixel height;
 *   * the panes ABOVE it — the candles and any volume / index pane — get
 *     `layout.above`, which the layout already worked out. ⭐ IT USED TO SPLIT A
 *     BUDGET BY THE FACTORS ALREADY ON THE CHART, and that could not survive its
 *     own output: this function writes PIXEL COUNTS, so the next sync would read
 *     `[353, 99]` back as if it were the 78/22 the settings actually say and
 *     re-derive a different reference every pass. The heights are now computed
 *     once, from settings, in `bandsAboveHeights` — one authority, a fixed point.
 *   * anything BELOW the stack is not ours and keeps what it has. There is
 *     nothing there today; leaving it alone is what stops a future pane being
 *     silently crushed to zero.
 *
 * @param {object} layout `computePaneLayout`'s output
 * @param {number[]} currentStretch every pane's CURRENT stretch factor, in order
 * @returns {number[]} one target per entry of `currentStretch`
 */
export function paneStretchPlan(layout, currentStretch) {
  const cur = Array.isArray(currentStretch) ? currentStretch : []
  if (!layout || !Array.isArray(layout.panes)) return cur.slice()
  const first = Number.isInteger(layout.firstPaneIndex) ? layout.firstPaneIndex : 1
  const out = cur.slice()

  // ── the stack ──
  for (let i = 0; i < layout.panes.length; i++) {
    const idx = first + i
    if (idx < out.length) out[idx] = layout.panes[i].stretchFactor
  }

  // ── the panes above it, at the heights the layout computed ──
  const above = Array.isArray(layout.above) ? layout.above : []
  for (let i = 0; i < Math.min(first, out.length); i++) {
    if (Number.isFinite(above[i])) out[i] = above[i]
  }
  return out
}

// ─── reading the renderer back ───────────────────────────────────────────────

/** Every pane's height, in order. `null` when the chart cannot answer. */
function paneHeights(chart) {
  let panes
  try { panes = chart && typeof chart.panes === 'function' ? chart.panes() : null } catch { panes = null }
  if (!Array.isArray(panes)) return null
  return panes.map((p) => {
    const h = typeof p?.getHeight === 'function' ? p.getHeight() : null
    return Number.isFinite(h) ? h : 0
  })
}

/**
 * The PANE STACK's height — the budget `computePaneLayout` distributes.
 *
 * The chart's height MINUS the time axis, read back from the renderer rather
 * than re-derived from the container, because the time axis' height is the
 * renderer's own business. Identical to the number `paneManifest` reports as
 * `chartHeight`, on purpose: the layout and the manifest must be talking about
 * the same budget or a comparison between them means nothing.
 *
 * `0` when the chart cannot answer — `computePaneLayout` treats that as "no
 * usable height" and returns the one-pane answer, so a caller never has to guard.
 */
export function paneStackHeightPx(chart) {
  const heights = paneHeights(chart)
  if (!heights || !heights.length) return 0
  return heights.reduce((s, h) => s + h, 0) + Math.max(0, heights.length - 1) * SEPARATOR_PX
}

/**
 * Did the renderer actually give the panes the heights the layout asked for?
 *
 * Returns the failure MESSAGE, or `null` when everything landed. A message and
 * not a boolean because the number is the whole point: "pane 1 is 87px, expected
 * 88px" is attributable and "the panes are wrong" is a week of bisecting.
 *
 * ⚠️⚠️ THIS CANNOT BE READ IN THE SAME TICK THE STRETCH FACTORS WERE WRITTEN.
 * LWC computes pane heights in `_private__adjustSizeImpl`, which runs from
 * `_private__syncGuiWithModel`, which the invalidate handler defers to
 * `requestAnimationFrame`. MEASURED on the installed bundle: a two-pane chart
 * reads `[400, 0]` synchronously after `addSeries`, and reads the PREVIOUS
 * heights synchronously after `setStretchFactor` — so the check the plan wrote
 * inline in `binder.js` would have thrown on every single sync, for every chart,
 * forever. It is the same rAF blindness that nearly pinned `SEPARATOR_PX` at 0
 * (B5 Task 3). `binder.js` therefore verifies the PREVIOUS pass's layout at the
 * top of the NEXT sync, once a frame has been through.
 *
 * 🔴 D2 — AND DEFERRING IT BY ONE FRAME WAS STILL NOT ENOUGH, MEASURED: B5 Task
 * 11 saw `paneLayout: pane 2 is 77px, expected 78px` reach StockChart's
 * ErrorBoundary on 3 of 14 then 1 of 8 COLD LOADS, and the same build with the
 * throw removed produced 15 identical manifests out of 15. **The geometry was
 * never unstable; the assertion was.** One deferred frame is not a settle: the
 * price-axis width ratchet re-measures, the time axis re-optimises, and LWC
 * re-lays-out — which it is free to do — between the write and the read, and the
 * old code paid for that disagreement with the WHOLE CHART.
 *
 * ⛔ SO THIS IS A REPORT, NOT AN ASSERTION, AND `binder.js` DOES NOT THROW ON IT.
 * A one-pixel drift is worth a loud console warning and a counter a test can
 * read; it is not worth a blank chart, and a blank chart is what an exception on
 * the paint path buys. `binder.js` CONVERGES first — re-applies the layout once
 * and re-arms — because a transient disagreement is exactly the thing a re-apply
 * fixes, and only a drift that survives its own correction is reported. The
 * number is still attributable, which was the whole point of returning a message
 * instead of a boolean.
 *
 * @param {object} chart an `IChartApi`
 * @param {object} layout `computePaneLayout`'s output
 * @returns {string|null}
 */
export function paneHeightMismatch(chart, layout) {
  if (!layout || !Array.isArray(layout.panes)) return null
  const heights = paneHeights(chart)
  if (!heights) return null
  const first = Number.isInteger(layout.firstPaneIndex) ? layout.firstPaneIndex : 1

  const wantPanes = first + layout.panes.length
  if (heights.length < wantPanes) {
    return `paneLayout: the chart has ${heights.length} panes, expected at least ${wantPanes}`
  }
  for (let i = 0; i < layout.panes.length; i++) {
    const idx = first + i
    const want = layout.panes[i].stretchFactor
    if (heights[idx] !== want) {
      return `paneLayout: pane ${idx} is ${heights[idx]}px, expected ${want}px`
    }
  }
  // Each pane above the stack has its OWN target now (`layout.above`), so each is
  // checked by name. It used to be checked as a SUM against the price-pane
  // budget, which is what made D1's one-pixel over-allocation read as
  // `panes 0-1 total is 451px, expected 452px` — a true statement that named no
  // pane and no cause.
  const above = Array.isArray(layout.above) ? layout.above : []
  for (let i = 0; i < Math.min(first, heights.length); i++) {
    const want = above[i]
    if (!Number.isFinite(want)) continue
    if (heights[i] !== want) {
      return `paneLayout: pane ${i} is ${heights[i]}px, expected ${want}px`
    }
  }
  return null
}

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
