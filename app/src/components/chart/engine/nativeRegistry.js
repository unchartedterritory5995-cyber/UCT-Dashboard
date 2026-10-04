// app/src/components/chart/engine/nativeRegistry.js
//
// ─── The 15 shipped indicators — 14 of them as engine definitions ────────────
//
// Two things live here and they are deliberately in one file, because they are
// two halves of one claim:
//
//   1. NATIVE_DEFS — a definition per native, mirroring `CHART_DEFAULTS.indicators`
//      and each render block in `StockChart.jsx` EXACTLY (periods, colours, plot
//      counts, guide levels, scale hints). Exactness is the point: B3 migrates
//      the legacy blocks onto these, and a migration is only a no-op if the
//      definition already says what the chart already does.
//
//   2. computeFor() — the adapter that turns fourteen bespoke return shapes into
//      ONE columnar contract. `indicators.js` returns bare `[{time,value}]`
//      arrays, `{upper,middle,lower}`, `{macd,signal,histogram}`, `{k,d}`,
//      `{adx,plusDI,minusDI}`, `{tenkan,kijun,spanA,spanB,chikou}` — and SAR
//      quietly attaches a third field, `isUptrend`, to every point. Downstream
//      (the binder, the alert engine, the screener) must not know any of that.
//
// THE COLUMNAR CONTRACT
// ---------------------
// `computeFor(def, bars, inputs)` returns `{ [plotKey]: Float64Array }` where
// every column is `bars.length` long and NaN-padded before the first computable
// bar. NaN is the gap value (not null, not 0) so `Number.isFinite` is the single
// "is there a value here" test, exactly as `indicators.js` established in B1.
//
// One column per DATA-BEARING plot AND ONE PER DECLARED EVENT. `hlines` plots —
// the 70/50/30 guides and friends — are static levels, not series: they declare
// `levels` and return no column. `columnKeys(def)` is the authority on which
// keys bear data, and nothing else in the engine should re-derive that rule.
//
// ⭐ THIS PARAGRAPH USED TO SAY "one column per DATA-BEARING PLOT" and stop
// there, which was true for the whole of B1-B5 and is now half the rule.
// `events[]` was in the schema from B1 and read by nothing: `columnKeys` looked
// at `def.plots` only, so an event could be declared, computed nothing, and
// register cleanly. Phase C Task 4 widened `columnKeys` to the union and added a
// REGISTRATION-TIME gate (`validateEventColumns`) that runs the compute over a
// probe series and refuses a definition whose event names no column or whose
// event column holds anything but 0, 1 or NaN. `sar` is the first definition to
// declare any.
//
// hasAnyFinite() REPLACES `.length` AS THE PANE-EXISTENCE TEST
// ------------------------------------------------------------
// `StockChart.jsx` keys every indicator block off `data.length` (`:5761` and
// friends). That worked while a too-short series returned `[]`. Post-B1 every
// column is input-length, so `.length` is always truthy and every pane would be
// created for every indicator, empty. `tests/fixtures/indicators/_schema.md`
// assigns this unification to B2, and this is it: ask whether a column has any
// finite value, never whether it has any elements.
//
// WHY volumeProfile IS NOT HERE — AND MUST NOT BE "COMPLETED"
// -----------------------------------------------------------
// Because it is a CANVAS OVERLAY, not a series. The decision, its reason and
// its expiry condition are written on `CARVED_OUT_INDICATOR_KEYS` at the bottom
// of this file, and `nativeRegistry.test.js` FAILS if anyone completes the
// registry to 15 — read that export before adding a definition for it.
//
// NAMING: NO SECOND VOCABULARY
// ----------------------------
// Column names come from `api/services/indicator_compute.py::_CASE_COLUMNS` for
// the seven the Python lane implements (rsi · macd/signal/histogram ·
// upper/middle/lower · k/d · williams_r · cci · mfi) and from the JS return
// shape for the rest (tenkan/kijun/spanA/spanB/chikou, adx/plusDI/minusDI, …).
// Both lanes assert the same golden fixtures, so a column named twice is a
// column that will eventually be reconciled by hand. `williams_r` is snake_case
// inside a camelCase definition for exactly this reason: it is the Python lane's
// name, and one name beats a tidy one.
//
// Definition IDs are the LEGACY SETTINGS KEYS (`rsi`, `bb`, `williamsR`, …), not
// prettier names. Three things key off them today: `indTarget(key)` builds the
// price-scale id from the settings key, the pane layout stacks panes by it, and
// Task 3's migrator maps `cs.indicators[key]` onto a definition. Keeping
// defId == settings key makes all three an identity rather than a lookup table.

import {
  validateDefinition,
  validateSourceReferents,
  isEventColumnValue,
  SCHEMA_VERSION,
  SUPPORTED_KINDS,
  SOURCE_BAR_FIELDS,
} from './defSchema'
// ⭐ THE THIRD LANE'S FOUR PIECES, WIRED HERE AT PHASE D TASK 8. Until this
// commit `interpret`, `checkBudget` and `lintRepaint` were shipped and had NO
// caller in the product — deliberately, each task landing its piece pure and
// unwired. This module is where they stop being unwired: `computeFor` runs
// `interpret`, and `validateUserDefinitions` runs the other two. That makes them
// reachable from `StockChart.jsx`'s module graph rather than only from a test,
// which is a fact `__tests__/enumerationSites.test.js` asserts by walking
// IMPORTS rather than by grepping for a name (a plain substring search for these
// on this branch returned ten matches and every one was prose in a comment).
import { interpret } from './ast/interpret'
import { ENGINE_ERROR, isRefusal } from './ast/parse'
// ⭐⭐ THE BIND STAGE, WIRED HERE FOR THE SAME REASON THE NOTE ABOVE GIVES:
// `bind.js` had ZERO live importers — the whole module, not just `foldBound` —
// so a timeframe-conditional length refused at the door and nothing ever folded
// it. This is where it stops being unwired.
// ⛔ IT BELONGS HERE AND NOT AT THE DOOR. `translatePine` runs at SAVE time, with
// no symbol and no timeframe, so folding there would bake ONE binding's answer
// into a shared definition — and `foldBound`'s header names the cost: the next
// symbol folds it differently, so the second symbol of a sweep would inherit the
// first's lengths. That shows as a WRONG NUMBER, not an error.
import { foldBound, bindConstsFor } from './ast/bind'
import { resolveOtherSymbols, symTickersOf } from './otherSymbols'
import { resolveLowerTf } from './lowerTf'
import { periodReadsRefusalFor, PERIOD_READS_GUARD } from './periodReads'
import { blockRunsRefusal, BLOCK_RUNS_GUARD } from './blockRuns'
import { runtimeErrorWords } from './runtimeErrorText'
// ⭐⭐ RE-EXPORTED, NOT REDEFINED. `objectColumns` has imported `bindConstsFor`
// from here since step 6 and the IR lane now needs it too; the assembly itself
// moved to `ast/bind.js`, beside `bindingConstants` and `symbolConstantsWith`,
// so a THIRD lane could reach it without importing this whole registry.
// ⛔ One authority, three callers — this line is an alias, never a second copy.
export { bindConstsFor }
import { timeframeFlags } from '../indicators'
import { smaOfSeries, emaOfSeries, maSeries, MA_TYPES, numbersToPoints } from '../movingAverages'
import { TECH_CATEGORY as CAT } from '../technicalCategories'
import * as S from '../technicalStudies'
import { checkBudget } from './ast/budget'
import { lintRepaint, declaredInputs } from './ast/lint'
import { freshnessFor } from './ast/freshness'
// ⭐ W1b — THE BADGE AGGREGATORS ARE IMPORTED, NEVER RE-DERIVED HERE.
// `BuilderSheet.buildDefinition` WRITES `meta.repaint`/`meta.freshness` through
// these two and `validateAstLane` below RE-MEASURES against them; a second
// aggregation rule in this file would mean a multi-plot document could be saved
// under a badge this door would not have chosen, or could never be saved at all.
// They also fail CLOSED on an empty list — see the `lanes` comment in
// `validateAstLane`, which is why the tree-less document is pinned explicitly
// rather than routed through `Object.values(compute.trees || {})`.
import { worstRepaint, stalestFreshness } from './ast/trees'
import {
  computeRSI,
  computeVWAPDeviation,
  computeMACD,
  computeBB,
  computeVWAP,
  computeStochastic,
  computeATR,
  computeIchimoku,
  computeMFI,
  computeCCI,
  computeWilliamsR,
  computeADX,
  computeOBV,
  computeDonchian,
  computeParabolicSAR,
  computeParabolicSAREvents,
  computeAVWAP,
  computeATRBands,
  AVWAP_ANCHORS,
} from '../indicators'
import { serverColumnsFor, notifyColumnsLanded } from './serverCompute'
import { runtimeKillOf } from './runtimeKill'
import { runtimePaneEnabled } from './runtimePaneGate'

// ─── shared fragments ────────────────────────────────────────────────────────

/** Every native WAS declared here as a `native`-lane, non-repainting, free-tier
 *  indicator. The repaint half of that sentence is now PAST TENSE, and it was
 *  falsified by measurement rather than by opinion.
 *
 *  🔴 `repaint: 'non-repainting'` BELOW IS A SHARED DEFAULT, NOT AN AUDIT. It sits
 *  before the `...meta` spread, so every native inherits it and no native
 *  overrides it — a uniform column, which is indistinguishable from an unset one.
 *  Phase D's machine linter measured the catalogue on 2026-08-07 and DISAGREES
 *  with one plot of one definition: `ichimoku`'s `chikou` writes bar `i`'s close
 *  to index `i - 26`, so the point drawn at a historical index moves while the
 *  newest bar forms. The measurement, the reasoning and the owner question are in
 *  `docs/decisions/2026-08-06-machine-repaint-linter.md` (§3.1, §3.2).
 *
 *  ⛔ THE VALUE HAS NOT MOVED, AND MOVING IT IS NOT THE RESPONSE TO READING THIS.
 *  A disagreement between the linter and a shipped badge is a FINDING FOR THE
 *  OWNER (record §2). Editing it fails three separate rails on purpose.
 *
 *  ⭐ WHAT DID MOVE IS THE SURFACE, AND IT MOVED ONE LEVEL DOWN. The owner's
 *  ruling is per PLOT, so `chikou` now declares `plots[].forward` — the number of
 *  bars ahead of its own index that column reads — and `ast/lint.js` derives
 *  `preview-repaints` from it. That is a WINDOW, not a badge: `defSchema` REFUSES
 *  a `plots[].repaint`, so this field stays the only per-definition statement of
 *  the badge in the file and no plot may ever contradict or duplicate it. The
 *  chart's About page renders the linter's per-plot MEASUREMENT and no longer
 *  prints this shared default as prose; the library dialog still reads it. See
 *  record §4.2 and `engine/repaintVerdict.js`.
 *
 *  ⏳ The TIER half of the original sentence is ALSO a shared default, and Task 14
 *  — the commit this paragraph was left standing for — DELIBERATELY DID NOT MOVE
 *  IT. The owner's ruling of 2026-08-06 is *"everything is paid, almost nothing is
 *  accessible for free"*, and applied here it would re-tier SIXTEEN natives in one
 *  edit: every indicator on the chart today, for every member, on a surface that
 *  has shipped free since B1. That is a PAYWALL decision with a blast radius, not
 *  a Phase D implementation detail, so it goes to the owner as a finding exactly
 *  the way the `chikou` badge above did (record §2) rather than being taken here.
 *
 *  ⭐ WHAT TASK 14 DID TAKE IS THE LANE IT OWNS. The `ast` lane — a user's own
 *  formula — is served ONLY by `/api/user-definitions`, every route of which
 *  declares `Depends(require_paid)` on its own handler, so a `free` claim on an
 *  `ast` definition would be a badge promising data its lane refuses to hand over.
 *  `AST_LANE_TIER` below is that reading, and `validateAstLane`'s GATE 4 refuses a
 *  definition whose badge disagrees with it — the same shape, and the same
 *  argument, that put `premium` on `rsLine` when its server lane landed. */
const nativeDef = (id, fn, meta, placement, inputs, plots) => ({
  schemaVersion: SCHEMA_VERSION,
  id,
  version: 1,
  compute: { kind: 'native', fn, rev: 1 },
  meta: { tier: 'free', repaint: 'non-repainting', ...meta },
  placement,
  inputs,
  plots,
})

/** A pane whose author DECLARES a range (RSI 0-100 …). `placement.scale` present
 *  ⇒ the binder applies `{autoScale:false, minimum, maximum}`; absent ⇒
 *  `{autoScale:true}`. That is the same distinction StockChart makes today by
 *  passing (or not passing) `bandExtra` to `applyIndScale`.
 *
 *  ⚠️ "FIXED" IS ASPIRATIONAL, NOT WHAT THE RENDERER DOES. `minimum`/`maximum`
 *  are not lightweight-charts 5.2.0 `PriceScaleOptions` members; `merge` copies
 *  them into the options bag and nothing reads them. Measured, RSI's band renders
 *  at its COLUMN's extent (~30..70), not 0..100
 *  (`engine/__tests__/autoscaleOnARealScale.test.js`). The declaration is kept
 *  because it is byte-for-byte what legacy passes — Flip A parity — and because
 *  it is the metadata a real pin would read the day one is wired
 *  (`priceScale().setVisibleRange`, which IS a pixel change). The half that does
 *  work is `autoScale:false`: it FREEZES the range against re-invalidation, which
 *  is exactly the pooling hazard `placement`'s TRAP #2 exists for. */
/**
 * `pane.height` — THE PANE'S DEFAULT HEIGHT, AS A FRACTION OF THE CHART.
 *
 * ⭐ These nine numbers are `paneMargins.PANES`' nine `baseH` values, and this is
 * where they retire to. That table was three different facts wearing one coat —
 * nine heights, a stack ORDER, and a volume row — and only the heights are a
 * per-indicator property. So the heights become definition data (here), the
 * order becomes the instance list's order, and volume becomes one constant
 * (`paneLayout.VOLUME_PANE_HEIGHT`). Moving the whole table would have been a
 * rename; this is the retirement (plan §A5).
 *
 * The payoff is that a sixteenth oscillator costs ONE definition and zero edits
 * to any list: `paneLayout.computePaneLayout` reads
 * `placement.pane.height ?? DEFAULT_PANE_HEIGHT`, so a definition that says
 * nothing gets 0.15 — the value six of these nine already use.
 *
 * ⚠️ A PRICE OVERLAY DECLARES NO `pane` AT ALL. `bb`, `vwap`, `sar`, `ichimoku`
 * and `donchian` share the candles' pane, so a height on one of them would
 * reserve vertical space for something that draws inside somebody else's — the
 * successor of the claim `enumerationSites.test.js` already makes about them
 * gaining no key in `paneMargins.js`. `paneLayout.test.js` asserts it.
 *
 * ⚠️ `paneLayout.test.js` READS `paneMargins.js` AND COMPARES, key by key, so
 * these values cannot drift from the shipped table while it still ships.
 */
const fixedPane = (min, max, height) => ({ target: 'pane', scale: { min, max }, pane: { height } })
const autoPane = (height) => ({ target: 'pane', pane: { height } })
const onPrice = { target: 'price' }

/** The `enum` labels for `indicators.AVWAP_ANCHORS` (Phase C Task 14).
 *
 *  ⛔ A LOOKUP KEYED BY THE FROZEN LIST, NOT A SECOND LIST. `avwap`'s options are
 *  `AVWAP_ANCHORS.map(a => [a, AVWAP_ANCHOR_LABELS[a]])`, so the VALUES can only
 *  ever be the anchors the compute accepts. A hand-typed options array is how a
 *  value a user can PICK becomes an anchor the maths REFUSES — a control that
 *  silently draws nothing — and an anchor added without a label here surfaces as
 *  an `undefined` label at registration rather than as a missing dropdown row. */
const AVWAP_ANCHOR_LABELS = {
  session: 'Session', week: 'Week', month: 'Month', quarter: 'Quarter',
  year: 'Year', swingHigh: 'Swing high', swingLow: 'Swing low',
}

const colorInput = (key, label, dflt) => ({ key, type: 'color', label, default: dflt })
const periodInput = (key, label, dflt, min, max) => ({
  key, type: 'int', label, default: dflt, min, max, step: 1,
})

/** ⭐⭐ ICHIMOKU'S KIJUN PERIOD, HOISTED, BECAUSE IT IS TWO FACTS THAT ARE ONE
 *  NUMBER — and the whole point of `plots[].forward` is that the number is not
 *  typed a second time.
 *
 *  `indicators.computeIchimoku` opens with `const displacement = kijunPeriod` and
 *  then writes `chikou[i - displacement].value = bars[i].c`. So the Kijun period
 *  IS the lagging line's back-shift, which IS its forward dependency: the point
 *  drawn at index `i - 26` is bar `i`'s close, and it moves until bar `i` closes.
 *  Declared once here and read twice below — as the input's default and as
 *  `chikou`'s forward window — so a change to one is a change to both.
 *
 *  ⚠️ THE OBJECT, NOT A `find()` OVER THE INPUT LIST. A lookup by key returns
 *  `undefined` the day somebody renames the input, and `undefined.default` throws
 *  at module load — i.e. the whole chart registry fails to import because a label
 *  changed. One binding cannot be got wrong that way.
 *
 *  ⛔ AND THE NUMBER IS STILL A DECLARATION, WHICH IS SAID HERE RATHER THAN
 *  DISCOVERED LATER. Nothing in this file reads `computeIchimoku`'s source —
 *  spec §11 forbids static analysis of hand-written JS, so the compute and this
 *  declaration are held equal by a TEST that measures the artefact (the trailing
 *  null run in the committed golden fixture, `ast/lint.test.js`) rather than by
 *  the type system. That is the same standing the Python lane's `TRAILING_PAD`
 *  has, and its own comment says why it is a declaration rather than a waiver:
 *  *"change the back-shift and this goes red with the two numbers in hand."* */
const ICHIMOKU_KIJUN = periodInput('kijunPeriod', 'Kijun', 26, 1, 200)

/** The one-series `source` input the Tier 1 transforms declare (2026-10-01) —
 *  the same vocabulary the Moving Average has always used. */
const SOURCE_INPUT = Object.freeze({ key: 'source', type: 'source', label: 'Source', default: 'close' })

// ─── the definitions ─────────────────────────────────────────────────────────
//
// Colours, periods and bounds are copied from `CHART_DEFAULTS.indicators`
// (chartDefaults.js:126-154) and the ChartToolbar inputs; guide levels, widths
// and line styles from each render block in StockChart.jsx (~5704-6101). A test
// asserts the CHART_DEFAULTS half key by key, so a drift there fails loudly.
//
// ⚠️ THREE GUIDES BELOW ARE `largeDashed` (LWC LineStyle 3): RSI's 50, MACD's 0
// and CCI's 0. They used to declare NO lineStyle, because `PLOT_LINE_STYLES` was
// solid|dashed|dotted and the note here said extending it was a B3 decision. The
// Task 8 rehearsal took that decision by measuring it: an omitted `lineStyle` on
// a `createPriceLine` does not mean "keep what's there", it means "use LWC's
// default", and LWC's price-line default is Dashed — so RSI's 50 came out
// 2-on/2-off against the shipped 6-on/6-off, **379 changed pixels**. The
// vocabulary now names the style, and these three say what they draw.

// ⭐ TASK 2 (2026-08-06) — EVERY DEFINITION THAT BINDS A DATA PLOT DECLARES A CHIP.
// TEN of the seventeen declared none that the readout could print — `bb`, `vwap`,
// `mfi`, `cci`, `williamsR`, `adx`, `obv`, `donchian`, `avwap` and `atrBands` —
// so a user who enabled MFI or OBV got a line with NO LABEL AT ANY TIME, hovering
// or not, because `readout.chipsFrom:167` emits nothing for a plot with no
// `legend` block. (The phase plan measured NINE and missed `atrBands`, whose three
// plots all declared `legend: { hide: true }`; the rail in
// `__tests__/legendFromDefinitions.test.jsx` is DERIVED from this array for
// exactly that reason, and it named the tenth.)
//
// ⚠️ A `legend.label` SHORT-CIRCUITS `meta.legendParams` (`readout.chipLabel:107`),
// so the two are never declared together below: a definition whose `shortName` is
// already the chip's stem declares params and no label, and `donchian` — the one
// whose stem is not — declares a label and no params. Declaring both is how a
// control that looks live becomes inert, which is the trap `stoch`'s own comment
// records from the other side.
//
// ⚠️ AND A PARAM MUST NAME A DECLARED INPUT (`defSchema:544`): `obv` takes only a
// colour, so it declares NO `legendParams` — one there would refuse registration.
const RAW_DEFS = [
  // ── RSI ──────────────────────────────────────────────────────────────────
  nativeDef('rsi', 'rsi',
    { name: 'Relative Strength Index', shortName: 'RSI', category: CAT.MOMENTUM, legendParams: ['period'],
      description: 'Momentum on a 0-100 scale: how much of recent movement has been up.',
      tags: ['oscillator', 'momentum'] },
    fixedPane(0, 100, 0.15),
    [
      periodInput('period', 'Period', 14, 2, 100),
      colorInput('color', 'Color', '#7b68ee'),
    ],
    [
      { key: 'rsi', label: 'RSI', style: 'line', color: '$color', width: 1, role: 'primary',
        // StockChart.jsx:9590 — `RSI(14) 54.3`. One decimal, and the period in
        // parentheses, verbatim. `legendParams: ['period']` above is what puts
        // the number in the brackets; dropping it reads "RSI 54.3".
        legend: { decimals: 1 } },
      // 70/30 and 50 are separate plots because they are separate price lines with
      // different alphas and line styles — one `hlines` plot carries one style.
      { key: 'bands', label: '70 / 30', style: 'hlines', levels: [70, 30], color: 'rgba(123,104,238,0.4)', width: 1, lineStyle: 'dashed', role: 'context' },
      { key: 'midline', label: '50', style: 'hlines', levels: [50], color: 'rgba(123,104,238,0.2)', width: 1, lineStyle: 'largeDashed', role: 'context' },
    ]),

  // ── MACD ─────────────────────────────────────────────────────────────────
  //
  // ⚠️ `version: 2` — the ONLY definition off the shared `version: 1`. Dropping
  // the head-mask (2026-08-02, decision `MACD_HEAD_MASK`) changed what this
  // definition RENDERS without changing the maths, which is exactly the split
  // `version` (presentation) and `compute.rev` (numbers) exist to express:
  // `compute.rev` stays 1 because `computeMACD` is untouched and the Python lane
  // still agrees at 1e-9. A `defVersion: 1` on a stored instance is TOLERATED by
  // `validateInstance` on purpose — an old instance still draws, it just draws
  // the 8 bars it always should have.
  ({ ...nativeDef('macd', 'macd',
    { name: 'MACD', shortName: 'MACD', category: CAT.MOMENTUM,
      description: 'The gap between two moving averages, and how fast that gap is changing.',
      tags: ['oscillator', 'momentum', 'trend'] },
    autoPane(0.17),
    [
      periodInput('fastPeriod', 'Fast', 12, 1, 100),
      periodInput('slowPeriod', 'Slow', 26, 1, 200),
      periodInput('signalPeriod', 'Signal', 9, 1, 50),
      colorInput('macdColor', 'MACD', '#2196F3'),
      colorInput('signalColor', 'Signal', '#FF9800'),
    ],
    [
      { key: 'macd', label: 'MACD', style: 'line', color: '$macdColor', width: 1, role: 'primary',
        // StockChart.jsx:9591 — `MACD 0.1234`, no parentheses, four decimals.
        // `meta.legendParams` is deliberately ABSENT on this definition: the
        // shipped chip prints no periods, and adding them would be a change.
        legend: { decimals: 4 } },
      { key: 'signal', label: 'Signal', style: 'line', color: '$signalColor', width: 1, role: 'secondary',
        // :9592 — the chip says SIG, not "MACD". `meta.shortName` cannot express
        // a per-plot name, which is what `legend.label` is for.
        legend: { label: 'SIG', decimals: 4 } },
      // colorMode 'sign' IS the up/down bar colouring StockChart derives inline
      // (MACD_HIST_UP / MACD_HIST_DOWN at `p.value >= 0`). Declaring it is what
      // let B1 take the per-point colour back out of the compute output.
      //
      // ⚠️ colorUp / colorDown are `StockChart.jsx:69-70` VERBATIM. Declaring the
      // mode without them used to be legal, and the binder had no per-point
      // colour at all, so an engine-drawn MACD histogram came out in one flat LWC
      // default across the whole pane where the legacy one is green above zero
      // and red below. The schema now refuses a `sign` plot that names neither,
      // so the mode cannot be half-declared again.
      //
      // ⭐ AND SINCE B3 TASK 11 THEY LIVE ONLY HERE. `MACD_HIST_UP` and
      // `MACD_HIST_DOWN` were module constants in `StockChart.jsx`; MACD is
      // FLIPPED, its `indicatorData` branch is deleted, and those two literals
      // went with it. There is no second copy to keep in sync any more — which
      // also means these two strings are no longer "verbatim" of anything, they
      // are the source. `grep -rn "MACD_HIST_" app/src/` returns only
      // `macdFlipAParity.test.js` and `stockChartWiring.test.jsx`, which declare
      // their own copies precisely so a silent edit here fails a test.
      {
        key: 'histogram', label: 'Histogram', style: 'histogram', colorMode: 'sign',
        colorUp: 'rgba(76,175,80,0.75)', colorDown: 'rgba(244,67,54,0.75)',
        precision: 5, role: 'secondary',
        // The shipped legend has no histogram chip. Adding one is a regression.
        legend: { hide: true },
      },
      { key: 'zero', label: '0', style: 'hlines', levels: [0], color: 'rgba(255,255,255,0.12)', width: 1, lineStyle: 'largeDashed', role: 'context' },
    ]), version: 2 }),

  // ── Bollinger Bands ──────────────────────────────────────────────────────
  nativeDef('bb', 'bb',
    { name: 'Bollinger Bands', shortName: 'BB', category: CAT.VOLATILITY,
      description: 'A moving average with volatility bands, so you can see when range is unusual.',
      // ⭐ TASK 2 — the chip reads `BB(20, 2) 431.20`. `shortName` is ALREADY the
      // stem, so the basis declares no `legend.label`: one would short-circuit
      // these two params and leave them inert. They earn their place — a chart
      // can hold BB(20,2) and BB(50,2) at once, and two chips reading `BB 431.20`
      // name neither.
      legendParams: ['period', 'stdDev'],
      tags: ['overlay', 'volatility', 'bands'] },
    onPrice,
    [
      periodInput('period', 'Period', 20, 2, 200),
      { key: 'stdDev', type: 'float', label: 'Std Dev', default: 2, min: 0.5, max: 5, step: 0.5 },
      colorInput('color', 'Color', 'rgba(156,39,176,0.85)'),
    ],
    [
      // 🔴 THIS READ "The shipped legend has no Bollinger chip." IT WAS TRUE, AND
      // IT WAS THE DEFECT — not a preference. Three lines on the price scale and
      // no label at any time is an indicator a user cannot name, and no test in
      // the tree could see it because this file's legend fixture enables only the
      // six definitions that already had chips.
      //
      // The BASIS gets the chip and the two EDGES stay hidden: three numbers for
      // one indicator is the readout regression MACD's histogram is hidden for,
      // and the basis is the line a trader reads.
      { key: 'upper', label: 'Upper', style: 'line', color: '$color', width: 1, lineStyle: 'dashed', role: 'secondary', legend: { hide: true } },
      // The middle IS the band's centre column; `edges` names the two that bound
      // it. See defSchema's validateBandEdges for why the edges stay real plots.
      //
      // TWO decimals because it is a PRICE on the candles' own scale — the same
      // precision `ichimoku`'s TK/KJ print, and `readout.DEFAULT_DECIMALS`' own
      // stated reason: a chip should agree with the axis it sits above.
      { key: 'middle', label: 'Basis', style: 'band', edges: { upper: 'upper', lower: 'lower' }, color: '$color', width: 1, lineStyle: 'solid', role: 'primary', legend: { decimals: 2 } },
      { key: 'lower', label: 'Lower', style: 'line', color: '$color', width: 1, lineStyle: 'dashed', role: 'secondary', legend: { hide: true } },
    ]),

  // ── Session VWAP ─────────────────────────────────────────────────────────
  //
  // ⚠️ `compute.rev: 2` — the ONLY definition off the shared `rev: 1`, and the
  // exact MIRROR IMAGE of MACD's `version: 2` above. `VWAP_SESSION_ANCHOR`
  // (accepted 2026-08-03, `docs/decisions/2026-08-02-vwap-utc-day-bucketing.md`)
  // re-anchored `computeVWAP` from the UTC calendar day onto the ET session, so
  // this definition's NUMBERS changed while what it renders did not: that is
  // `compute.rev`, not `version`. Under spec §3.1 the bump force-migrates every
  // binding with user notification, resets evaluator `last_value` and suppresses
  // the first post-migration cycle — anything pinned to `vwap@rev 1` stops being
  // reproducible, which is the cost the owner accepted at 2,590 changed pixels.
  ({ ...nativeDef('vwap', 'vwap',
    {
      name: 'Session VWAP', shortName: 'VWAP', category: CAT.VWAP,
      description: 'The session\'s volume-weighted average price — where the day\'s money traded.',
      tags: ['overlay', 'volume', 'session'],
      // The old `VWAP_TFS` in `StockChart.jsx`, which is DELETED as of Flip B
      // along with the legacy memo that returned [] above 60m. A session indicator
      // does not exist on a daily bar.
      // `engine/eligibility.js` is what ENFORCES it; declaring it here
      // is what lets the Style tab say "intraday only" without a hardcoded list,
      // and what makes the rule apply to the next session indicator without
      // anyone editing the hook.
      timeframes: ['1', '5', '15', '30', '60'],
    },
    onPrice,
    [
      colorInput('color', 'Color', '#26C6DA'),
      { key: 'opacity', type: 'int', label: 'Opacity %', default: 100, min: 5, max: 100, step: 5 },
      {
        key: 'lineStyle', type: 'enum', label: 'Line style', default: 'solid',
        options: [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']],
      },
      { key: 'lineWidth', type: 'int', label: 'Line width', default: 1, min: 1, max: 4, step: 1 },
      // ⭐⭐ σ BANDS (2026-10-01) — AN OPTION ON THIS ONE VWAP, NOT A SECOND VWAP ROW.
      // Off by default, and an instance saved without the key reads Off, so every
      // existing chart draws exactly the single line it always did. The bands are
      // `vwap ± k·σ` with σ the session's volume-weighted standard deviation
      // (`indicators.computeVWAPDeviation`), at the conventional 1/2/3 multipliers.
      {
        key: 'bands', type: 'enum', label: 'Std dev bands', default: 'off',
        options: [['off', 'Off'], ['1', '±1σ'], ['2', '±1σ, ±2σ'], ['3', '±1σ, ±2σ, ±3σ']],
      },
    ],
    [
      // 🔴 THIS READ "The shipped legend has no VWAP chip." Task 2 gives it one:
      // TWO decimals, because it is a dollar price on the candles' own scale.
      //
      // ⚠️ NO `legendParams`, and that is a reading of the inputs rather than an
      // omission — this definition declares colour, opacity, line style and line
      // width, and not one of them changes WHAT IS MEASURED. A param that names a
      // cosmetic would print `VWAP(100)` and mean nothing.
      //
      // ⚠️ `lineStyle: '$lineStyle'` IS LOAD-BEARING, and VWAP is the first
      // definition to need it. `StockChart.jsx:6004` maps the user's stored
      // solid/dashed/dotted onto the LWC enum; without the reference this plot
      // would carry an author's literal (or nothing, which `seriesOptionsForPlot`
      // reads as solid) and every user who ever picked dashed would get a solid
      // line the moment the engine took over. The three enum option values are
      // deliberately the SCHEMA's own `PLOT_LINE_STYLES` names, so the input's
      // vocabulary and the plot's are one vocabulary and cannot drift.
      {
        key: 'vwap', label: 'VWAP', style: 'line',
        color: '$color', width: '$lineWidth', lineStyle: '$lineStyle',
        role: 'primary', legend: { decimals: 2 },
      },
      { key: 'upper1', label: '+1σ', style: 'line', color: '$color', width: 1, lineStyle: 'dotted', opacity: 0.6, role: 'secondary', legend: { hide: true } },
      { key: 'lower1', label: '−1σ', style: 'line', color: '$color', width: 1, lineStyle: 'dotted', opacity: 0.6, role: 'secondary', legend: { hide: true } },
      { key: 'upper2', label: '+2σ', style: 'line', color: '$color', width: 1, lineStyle: 'dotted', opacity: 0.6, role: 'secondary', legend: { hide: true } },
      { key: 'lower2', label: '−2σ', style: 'line', color: '$color', width: 1, lineStyle: 'dotted', opacity: 0.6, role: 'secondary', legend: { hide: true } },
      { key: 'upper3', label: '+3σ', style: 'line', color: '$color', width: 1, lineStyle: 'dotted', opacity: 0.6, role: 'secondary', legend: { hide: true } },
      { key: 'lower3', label: '−3σ', style: 'line', color: '$color', width: 1, lineStyle: 'dotted', opacity: 0.6, role: 'secondary', legend: { hide: true } },
    ]), compute: { kind: 'native', fn: 'vwap', rev: 2 } }),

  // ── Stochastic ───────────────────────────────────────────────────────────
  nativeDef('stoch', 'stoch',
    { name: 'Stochastic Oscillator', shortName: 'Stoch', category: CAT.MOMENTUM,
      description: 'Where price closed inside its recent high-low range, smoothed.',
      tags: ['oscillator', 'momentum', 'slow stochastic', 'fast stochastic'],
      // ⭐⭐ SLOW 14/3/3 FOR A NEW INSTANCE, FAST FOR EVERY SAVED ONE (2026-10-01).
      // `smoothK` is %K's smoothing. Every Stochastic saved before it existed was
      // FAST (unsmoothed %K), so an ABSENT key must keep meaning 1 — that is the
      // declared default, and it is what the inspector shows for those charts. A
      // member adding Stochastic now gets the mainstream slow stochastic: the add
      // doors write `createInputs` onto the new instance (`instanceControls`).
      createInputs: { smoothK: 3 } },
    fixedPane(0, 100, 0.15),
    [
      periodInput('kPeriod', '%K Period', 14, 1, 100),
      periodInput('smoothK', '%K Smoothing', 1, 1, 20),
      periodInput('dPeriod', '%D Period', 3, 1, 20),
      colorInput('kColor', '%K', '#FF6B6B'),
      colorInput('dColor', '%D', '#4ECDC4'),
    ],
    [
      // ⭐ B4 TASK 10 — TRANSCRIBED VERBATIM from the `legChips` row it replaces
      // (`StockChart.jsx` at `d2733adc`: `` `%K ${v.toFixed(1)}` ``). ⚠️ `stoch`
      // deliberately declares NO `meta.legendParams`: the shipped chips print
      // `%K` / `%D` with no parentheses. `legend.label` short-circuits
      // `legendParams` in `chipLabel` anyway, so a `legendParams` here would be
      // inert — which is exactly why its ABSENCE is asserted rather than assumed.
      { key: 'k', label: '%K', style: 'line', color: '$kColor', width: 1, role: 'primary',
        legend: { label: '%K', decimals: 1 } },
      { key: 'd', label: '%D', style: 'line', color: '$dColor', width: 1, lineStyle: 'dashed', role: 'secondary',
        legend: { label: '%D', decimals: 1 } },
      // 80 takes %K's colour and 20 takes %D's — two guides, two plots.
      { key: 'overbought', label: '80', style: 'hlines', levels: [80], color: 'rgba(255,107,107,0.4)', width: 1, lineStyle: 'dashed', role: 'context' },
      { key: 'oversold', label: '20', style: 'hlines', levels: [20], color: 'rgba(78,205,196,0.4)', width: 1, lineStyle: 'dashed', role: 'context' },
    ]),

  // ── ATR ──────────────────────────────────────────────────────────────────
  nativeDef('atr', 'atr',
    { name: 'Average True Range', shortName: 'ATR', category: CAT.VOLATILITY,
      description: 'Average size of a bar\'s true range — a volatility number in price units.',
      // ⭐ B4 TASK 10. The shipped chip is `ATR(14) 2.7000` — the period IS in the
      // brackets, so unlike `stoch` this definition needs `legendParams`. Without
      // it the chip reads `ATR 2.7000`, which is the mutation that proves it.
      legendParams: ['period'],
      tags: ['volatility'] },
    autoPane(0.13),
    [
      periodInput('period', 'Period', 14, 1, 100),
      colorInput('color', 'Color', '#FFA726'),
    ],
    [
      // `StockChart.jsx` at `d2733adc`: `` `ATR(${period}) ${v.toFixed(4)}` ``.
      { key: 'atr', label: 'ATR', style: 'line', color: '$color', width: 1, role: 'primary',
        legend: { decimals: 4 } },
    ]),

  // ── Parabolic SAR ────────────────────────────────────────────────────────
  //
  // ⭐ THE FIRST DEFINITION IN THE PLATFORM TO DECLARE `events`, and the reason
  // the array stopped being inert. `sar` is deliberately NOT alertable by a fixed
  // threshold — the value jumps to the other side of price at every flip, so the
  // same number means "trailing below an uptrend" one bar and "above a downtrend"
  // the next (`indicator_alert_evaluator._SAR_IS_NOT_OFFERED` writes that out and
  // a test asserts the prose survives). Phase C's answer is to address it BY
  // EVENT instead, and these two are the addresses.
  ({ ...nativeDef('sar', 'sar',
    { name: 'Parabolic SAR', shortName: 'SAR', category: CAT.TREND,
      description: 'A trailing dot that flips side when the trend does.',
      tags: ['overlay', 'trend', 'stops'] },
    onPrice,
    [
      { key: 'step', type: 'float', label: 'Step', default: 0.02, min: 0.001, max: 0.1, step: 0.001 },
      { key: 'maxStep', type: 'float', label: 'Max step', default: 0.2, min: 0.01, max: 1, step: 0.01 },
      colorInput('color', 'Color', '#ffeb3b'),
    ],
    [
      // Dots, not a line: StockChart builds a LineSeries with lineWidth 0 and
      // pointMarkersVisible/Radius. `markers` is the style that says that.
      //
      // ⭐ B4 TASK 10 — `` `SAR ${v.toFixed(4)}` `` at `d2733adc`. No
      // `meta.legendParams`: the shipped chip prints no step/maxStep, and
      // `meta.shortName` ('SAR') supplies the whole label, so no `legend.label`
      // is needed either. Four decimals, because it is a PRICE.
      { key: 'sar', label: 'SAR', style: 'markers', color: '$color', width: 3, role: 'primary',
        legend: { decimals: 4 } },
    ]),
    // ⚠️ AN EVENT IS A COLUMN, NOT A SERIES. These two draw nothing — they gain no
    // pool key, no pane and no legend chip — which is why they are `events[]` and
    // not plots with a style. `NATIVE_COMPUTE.sar` returns a `{0,1,NaN}` column
    // for each, `registerDefinitions` refuses this definition if it does not, and
    // the shared fixture `tests/fixtures/indicators/sar_events_default.json` pins
    // both against the Python lane at rel-tol 1e-9.
    events: [
      { key: 'priceCrossedSar', label: 'Price crossed SAR' },
      { key: 'trendFlipped', label: 'SAR trend flipped' },
    ] }),

  // ── Ichimoku Cloud ───────────────────────────────────────────────────────
  nativeDef('ichimoku', 'ichimoku',
    { name: 'Ichimoku Cloud', shortName: 'Ichimoku', category: CAT.TREND,
      description: 'A trend system in one picture: two averages, a projected cloud and a lagging line.',
      tags: ['overlay', 'trend'],
      // ⛔ ALWAYS THE CHART'S TIMEFRAME (2026-09-28). Its cloud is PROJECTED and its
      // lagging line SHIFTED by a count of ITS OWN bars inside the compute, so a
      // higher-timeframe copy moved onto lower bars would be displaced by the wrong
      // distance — see `calcTimeframeCapability.js`.
      calcTimeframe: false },
    onPrice,
    [
      // The three periods are NOT user-editable today (the toolbar exposes only
      // colours, and StockChart calls computeIchimoku(bars) with no arguments),
      // so these defaults are the values the chart already uses. Declaring them
      // is additive: identical numbers, and the Style tab gains them for free.
      periodInput('tenkanPeriod', 'Tenkan', 9, 1, 100),
      ICHIMOKU_KIJUN,
      periodInput('senkouBPeriod', 'Senkou B', 52, 1, 400),
      colorInput('tenkanColor', 'Tenkan', '#26C6DA'),
      colorInput('kijunColor', 'Kijun', '#EF5350'),
      colorInput('spanAColor', 'Span A', 'rgba(76,175,80,0.2)'),
      colorInput('spanBColor', 'Span B', 'rgba(239,83,80,0.2)'),
      colorInput('chikouColor', 'Chikou', 'rgba(255,235,59,0.7)'),
    ],
    [
      // ⭐ B4 TASK 10 — `` `TK ${v.toFixed(2)}` `` / `` `KJ ${v.toFixed(2)}` `` at
      // `d2733adc`. The chips say TK / KJ, which `meta.shortName` ('Ichimoku')
      // cannot express — that is what a per-plot `legend.label` is for. ⛔ AND
      // ONLY THESE TWO: `spanA`, `spanB` and `chikou` declare no `legend` block,
      // so the cloud and the lagging line stay chip-less exactly as they ship.
      { key: 'tenkan', label: 'Tenkan', style: 'line', color: '$tenkanColor', width: 1, role: 'primary',
        legend: { label: 'TK', decimals: 2 } },
      { key: 'kijun', label: 'Kijun', style: 'line', color: '$kijunColor', width: 1, role: 'primary',
        legend: { label: 'KJ', decimals: 2 } },
      // spanA/spanB are the cloud, and every other product fills between them —
      // this chart draws two translucent lines and no fill. They are NOT a
      // `band` here: a band's own key is its CENTRE column, and Ichimoku has no
      // centre series. Expressing the cloud is a B3 decision with a pixel change.
      { key: 'spanA', label: 'Span A', style: 'line', color: '$spanAColor', width: 1, role: 'secondary' },
      { key: 'spanB', label: 'Span B', style: 'line', color: '$spanBColor', width: 1, role: 'secondary' },
      // ⭐⭐⭐ THE ONE PLOT IN THE CATALOGUE THAT DECLARES A FORWARD WINDOW, AND
      // THE OWNER'S PER-PLOT RULING IS WHY IT IS HERE AND ON NOTHING ELSE.
      //
      // `forward` is a FACT about the maths, not a badge: this column's value at
      // index `i - kijun` is bar `i`'s CLOSE, so it reads `kijun` bars ahead of
      // the index it writes. `ast/lint.js` turns that number into the verdict
      // through `modeFromReach` — a known finite window is `preview-repaints`,
      // which is the value the owner took on 2026-08-07 (record §4.1) and the
      // first thing in this catalogue ever to emit it. Nothing here declares the
      // verdict; `defSchema` refuses a plot that tries.
      //
      // ⛔ AND IT SITS ON `chikou` ALONE, WHICH IS THE ENTIRE POINT. `tenkan`,
      // `kijun`, `spanA` and `spanB` read `[i-n, i]` and declare nothing, so the
      // linter has no opinion on them and no surface badges them. Putting a
      // window on the DEFINITION would have slandered four honest columns —
      // record §4 in the owner's own words: *"a per-definition badge cannot
      // express this without lying in one direction or the other."*
      { key: 'chikou', label: 'Chikou', style: 'line', color: '$chikouColor', width: 1, lineStyle: 'dashed', role: 'secondary',
        forward: ICHIMOKU_KIJUN.default },
    ]),

  // ── MFI ──────────────────────────────────────────────────────────────────
  nativeDef('mfi', 'mfi',
    { name: 'Money Flow Index', shortName: 'MFI', category: CAT.VOLUME,
      description: 'RSI weighted by volume — momentum that only counts when size shows up.',
      legendParams: ['period'],
      tags: ['oscillator', 'volume', 'momentum'] },
    fixedPane(0, 100, 0.15),
    [
      periodInput('period', 'Period', 14, 2, 100),
      colorInput('color', 'Color', '#c084fc'),
    ],
    [
      // ⭐ TASK 2 — `MFI(14) 54.3`. ONE decimal: a 0-100 BOUNDED oscillator read
      // against its 80/20 guides, which is `rsi`'s family and `rsi`'s precision.
      { key: 'mfi', label: 'MFI', style: 'line', color: '$color', width: 1, role: 'primary',
        legend: { decimals: 1 } },
      { key: 'bands', label: '80 / 20', style: 'hlines', levels: [80, 20], color: 'rgba(192,132,252,0.4)', width: 1, lineStyle: 'dashed', role: 'context' },
    ]),

  // ── CCI ──────────────────────────────────────────────────────────────────
  nativeDef('cci', 'cci',
    { name: 'Commodity Channel Index', shortName: 'CCI', category: CAT.MOMENTUM,
      description: 'How far price sits from its own average, in units of its typical deviation.',
      legendParams: ['period'],
      tags: ['oscillator', 'momentum'] },
    autoPane(0.15),
    [
      periodInput('period', 'Period', 20, 2, 200),
      colorInput('color', 'Color', '#fbbf24'),
    ],
    [
      // ⭐ TASK 2 — `CCI(20) 118.4`. ONE decimal: an oscillator, unbounded but read
      // against the ±100 guides declared right below, so the tenth is the
      // meaningful digit and the hundredth is noise — `rsi`'s convention applied
      // to `cci`'s range rather than a second one invented for it.
      { key: 'cci', label: 'CCI', style: 'line', color: '$color', width: 1, role: 'primary',
        legend: { decimals: 1 } },
      { key: 'bands', label: '±100', style: 'hlines', levels: [100, -100], color: 'rgba(251,191,36,0.4)', width: 1, lineStyle: 'dashed', role: 'context' },
      { key: 'zero', label: '0', style: 'hlines', levels: [0], color: 'rgba(251,191,36,0.2)', width: 1, lineStyle: 'largeDashed', role: 'context' },
    ]),

  // ── Williams %R ──────────────────────────────────────────────────────────
  nativeDef('williamsR', 'williams_r',
    { name: 'Williams %R', shortName: '%R', category: CAT.MOMENTUM,
      description: 'Where price closed in its recent range, on a -100 to 0 scale.',
      // ⭐ TASK 2 — `%R(14) -18.6`. NO `legend.label`: `shortName` is already the
      // `%R` that `stoch` has to spell out per plot, so the params stay live.
      legendParams: ['period'],
      tags: ['oscillator', 'momentum'] },
    fixedPane(-100, 0, 0.15),
    [
      periodInput('period', 'Period', 14, 2, 100),
      colorInput('color', 'Color', '#60a5fa'),
    ],
    [
      // `williams_r`, not `williamsR`: _CASE_COLUMNS names it that, and the two
      // lanes assert the same fixtures. See the module docstring.
      // ONE decimal: a -100..0 BOUNDED oscillator, the same family as `rsi` and
      // `stoch` (whose %K/%D ship at one) and read against the -20/-80 guides.
      { key: 'williams_r', label: '%R', style: 'line', color: '$color', width: 1, role: 'primary',
        legend: { decimals: 1 } },
      { key: 'bands', label: '-20 / -80', style: 'hlines', levels: [-20, -80], color: 'rgba(96,165,250,0.4)', width: 1, lineStyle: 'dashed', role: 'context' },
    ]),

  // ── ADX / DMI ────────────────────────────────────────────────────────────
  nativeDef('adx', 'adx',
    { name: 'Average Directional Index', shortName: 'ADX', category: CAT.TREND,
      description: 'How strong the trend is, regardless of direction, with the two directional lines.',
      legendParams: ['period'],
      // ⭐ 2026-10-01 — DMI / +DI / −DI are this study's own two lines.
      tags: ['trend', 'strength', 'dmi', 'directional movement', '+di', '-di', 'di+', 'di-'] },
    fixedPane(0, 100, 0.15),
    [
      periodInput('period', 'Period', 14, 2, 100),
      colorInput('adxColor', 'ADX', '#e5e7eb'),
      colorInput('plusDIColor', '+DI', '#22c55e'),
      colorInput('minusDIColor', '-DI', '#ef4444'),
    ],
    [
      // ⭐ TASK 2 — `ADX(14) 27.5`. ONE decimal: a 0-100 bounded oscillator read
      // against the 25 guide below, so the tenth is where the answer changes.
      //
      // ⛔ AND ONLY THE ADX LINE. `plusDI`/`minusDI` stay chip-less on purpose:
      // the ADX line is the one a trader reads a NUMBER off, and three numbers for
      // one indicator is the readout regression the band edges are hidden for.
      { key: 'adx', label: 'ADX', style: 'line', color: '$adxColor', width: 2, role: 'primary',
        legend: { decimals: 1 } },
      { key: 'plusDI', label: '+DI', style: 'line', color: '$plusDIColor', width: 1, role: 'secondary' },
      { key: 'minusDI', label: '-DI', style: 'line', color: '$minusDIColor', width: 1, role: 'secondary' },
      { key: 'trend', label: '25', style: 'hlines', levels: [25], color: 'rgba(229,231,235,0.3)', width: 1, lineStyle: 'dashed', role: 'context' },
    ]),

  // ── OBV ──────────────────────────────────────────────────────────────────
  nativeDef('obv', 'obv',
    { name: 'On-Balance Volume', shortName: 'OBV', category: CAT.VOLUME,
      description: 'A running volume total that adds on up bars and subtracts on down bars.',
      tags: ['volume', 'accumulation'] },
    autoPane(0.13),
    [
      colorInput('color', 'Color', '#9ca3af'),
    ],
    [
      // ⭐ TASK 2, AND THE ONE PRECISION THE CONTROLLER RULED ON (2026-08-06):
      // ZERO decimals. OBV is a CUMULATIVE SHARE COUNT — tens or hundreds of
      // millions — so a decimal on it is two characters of noise on a number
      // whose last six digits nobody reads.
      //
      // ⚠️ NO `legendParams`, and NOT as an omission: this definition declares
      // ONE input and it is a colour. `defSchema:544` refuses a param naming no
      // declared input, so `legendParams: ['period']` here would not print `OBV`
      // without brackets — it would refuse to register the definition at all.
      { key: 'obv', label: 'OBV', style: 'line', color: '$color', width: 1, role: 'primary',
        legend: { decimals: 0 } },
    ]),

  // ── Donchian Channels ────────────────────────────────────────────────────
  nativeDef('donchian', 'donchian',
    { name: 'Donchian Channels', shortName: 'Donchian', category: CAT.VOLATILITY,
      description: 'The highest high and lowest low of the last N bars, as a channel.',
      tags: ['overlay', 'breakout', 'channel'] },
    onPrice,
    [
      periodInput('period', 'Period', 20, 2, 200),
      colorInput('color', 'Color', 'rgba(96,165,250,0.5)'),
    ],
    [
      { key: 'upper', label: 'Upper', style: 'line', color: '$color', width: 1, lineStyle: 'solid', role: 'secondary' },
      // Same band shape as BB, opposite styling: Donchian's edges are solid and
      // its middle is LWC LineStyle 3 (LargeDashed).
      //
      // 🔴 THIS LINE USED TO CARRY NO `lineStyle` AND A COMMENT SAYING LineStyle
      // 3 WAS *"unnameable, so unstated"*. That was true when `PLOT_LINE_STYLES`
      // was `solid|dashed|dotted` and FALSE from the moment `largeDashed` joined
      // it — the same extension RSI's 50-midline forced at 379 changed pixels,
      // recorded at the top of this file for the three GUIDES that needed it and
      // not applied to the one SERIES that did. And "unstated" is not "keep what
      // is there" one level down either: `pool.seriesOptionsForPlot` resolves an
      // absent plot `lineStyle` to **solid** on purpose (complete key set — a
      // re-purposed series must not inherit a dash), so the engine would have
      // drawn Donchian's mid-line SOLID where `StockChart.jsx:6550` draws it
      // large-dashed. No series count, no scale assertion and no `edges` check
      // can see that; `adxObvDonchianFlipParity.test.js` asserts it directly.
      // ⭐ TASK 2 — `DC 431.20`, on the BASIS only; the channel edges stay
      // chip-less for the same reason BB's do. TWO decimals because it is a price
      // on the candles' own scale.
      //
      // ⚠️ THE ONE `legend.label` AMONG THE TEN, AND THEREFORE THE ONE WITH NO
      // `legendParams`. `shortName` is 'Donchian', which is the right name for the
      // library dialog and too long for a chip row that Task 3 is about to make
      // PERMANENT — so this plot names itself 'DC'. A label short-circuits
      // `legendParams` in `chipLabel`, so declaring params beside it would leave
      // them inert, which is exactly the shape `stoch`'s comment warns about. The
      // period stays readable in the settings row and the library.
      { key: 'middle', label: 'Mid', style: 'band', edges: { upper: 'upper', lower: 'lower' }, color: '$color', width: 1, lineStyle: 'largeDashed', role: 'primary',
        legend: { label: 'DC', decimals: 2 } },
      { key: 'lower', label: 'Lower', style: 'line', color: '$color', width: 1, lineStyle: 'solid', role: 'secondary' },
    ]),

  // ══ PHASE C TASK 14 — the first definitions that are NOT a migration ═══════
  //
  // Every definition above this line is a legacy `StockChart.jsx` render block
  // wearing the schema. These two are new indicators, authored as definitions
  // from the start, and that is the whole claim spec §A5 makes: a sixteenth
  // indicator costs ONE definition and zero edits to any list.
  //
  // ⚠️ THEY ARE APPENDED, AND THE ORDER IS Z-ORDER. `instances.js`'s stack order
  // and the binder's draw order both read this array's order, so inserting
  // ANYWHERE ELSE would re-stack the five shipped price overlays behind or in
  // front of one another and move pixels on charts that never enabled these.

  // ── Anchored VWAP ────────────────────────────────────────────────────────
  nativeDef('avwap', 'avwap',
    {
      name: 'Anchored VWAP', shortName: 'AVWAP', category: CAT.VWAP,
      description: 'Volume-weighted average price measured from a chosen anchor, not from the session open.',
      tags: ['overlay', 'volume', 'anchored'],
      // ⭐ TASK 2 — `AVWAP(session) 431.20`. The ANCHOR is the only thing that
      // distinguishes two AVWAPs on one chart, which is precisely the case Phase C
      // Task 14 authored this definition for, so it is the param the chip carries
      // — the same reading `rsLine` makes of its `benchmark` below.
      legendParams: ['anchor'],
      // ⚠️ INTRADAY ONLY, AND FOR A HARDER REASON THAN VWAP'S. Session VWAP is
      // gated because a session indicator is meaningless on a daily bar. AVWAP
      // is gated because ABOVE 60m THIS REPO'S BARS DO NOT CARRY AN INSTANT: the
      // daily series `t` is a 'YYYY-MM-DD' string on this lane (asserted by
      // `test_the_parity_fixture_is_intraday_bars_the_chart_can_actually_draw`)
      // and a `YYYYMMDD` integer on the alert lane's — and reading that integer
      // as unix seconds is the LIVE defect at `_fetch_bars_for_alert`, which
      // anchors the daily VWAP in **1970-08-23** and produces exactly one reset.
      // `computeAVWAP` refuses such a series outright (an all-NaN column, never a
      // plausible one-bucket answer); this declaration is what stops a user ever
      // reaching that refusal, and `engine/eligibility.js` enforces it.
      timeframes: ['1', '5', '15', '30', '60'],
    },
    onPrice,
    [
      // ⭐ AN `enum`, NOT A `time` — decision A3, and the reserved input types
      // stay reserved. `defSchema` fails closed on `time`, and click-to-anchor
      // already ships as the DRAWING TOOL in `ChartDrawingOverlay.jsx`, which is
      // anchored by a click and needs no definition (nor a settings-form control
      // the spec has never described).
      //
      // ⛔ THE OPTIONS ARE BUILT FROM `indicators.AVWAP_ANCHORS`, NOT RETYPED.
      // The compute fails closed on an anchor outside that list, so a hand-typed
      // option here is how a value a user can PICK becomes an anchor the maths
      // REFUSES — a control that silently draws nothing.
      {
        key: 'anchor', type: 'enum', label: 'Anchor', default: 'session',
        options: AVWAP_ANCHORS.map(a => [a, AVWAP_ANCHOR_LABELS[a]]),
      },
      colorInput('color', 'Color', '#F5A623'),
      {
        key: 'lineStyle', type: 'enum', label: 'Line style', default: 'solid',
        options: [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']],
      },
      { key: 'lineWidth', type: 'int', label: 'Line width', default: 1, min: 1, max: 4, step: 1 },
    ],
    [
      // ⭐ THE DECISION THIS BLOCK ASKED FOR, TAKEN. It used to read: *"A chip for
      // it is a separate, declarable decision — one `legend` edit and one line in
      // that table, taken deliberately"*, and it hid the chip so that the frozen
      // "the NINE the shipped legend rendered" records in `readout.test.js` and
      // `enumerationSites.test.js` would not have to grow.
      //
      // ⛔ THAT TRADE INVERTED THE MOMENT IT APPLIED TO TEN DEFINITIONS RATHER
      // THAN ONE. The record was protecting users from a chip that silently
      // DISAPPEARS; what it was actually holding in place was ten indicators that
      // never had one — "AVWAP is read off the price scale it sits on" is true of
      // every price overlay and is not a reason a line should be unnameable. The
      // records stay EQUALITIES (a drop among the shipped nine still fails); what
      // they stop being is a cap on how many indicators may be readable.
      //
      // TWO decimals, like its session sibling: a price on the candles' scale.
      {
        key: 'avwap', label: 'AVWAP', style: 'line',
        color: '$color', width: '$lineWidth', lineStyle: '$lineStyle',
        role: 'primary', legend: { decimals: 2 },
      },
    ]),

  // ── ATR bands ────────────────────────────────────────────────────────────
  nativeDef('atrBands', 'atrBands',
    { name: 'ATR Bands', shortName: 'ATR Bands', category: CAT.VOLATILITY,
      // ⚠️ THE WORDING IS LOAD-BEARING AND THIS IS THE SECOND DRAFT. It read
      // "…a multiple of Average True Range", and the library dialog builds an
      // option's ACCESSIBLE NAME from name + description — so that phrase made
      // `getByRole('option', {name: /Average True Range/})` match TWO rows and
      // four existing tests failed on ambiguity rather than on anything real.
      // A description is user-facing copy AND a selector; keep the other
      // indicator's full name out of it.
      description: 'The close with a volatility envelope — a multiple of ATR either side of it.',
      tags: ['overlay', 'volatility', 'bands'], legendParams: ['period', 'multiplier'] },
    onPrice,
    [
      periodInput('period', 'Period', 14, 2, 200),
      // ⭐ `multiplier` IS AN INPUT THE COMPUTE READS, AND IT HAD TO BE.
      // `$<inputKey>` substitution is legal in `color`, `width`, `levels` and
      // `lineStyle` — `SUBSTITUTABLE_PLOT_FIELDS`, locked by spec §3.1 — and a
      // band's WIDTH IN PRICE is none of those. Written as a plot literal it
      // would render one multiplier for every user while the settings form
      // offered a control that changed nothing, and `atr_bands_14_2.json`
      // (multiplier 2) would stay green the whole time.
      { key: 'multiplier', type: 'float', label: 'Multiplier', default: 2, min: 0.1, max: 10, step: 0.1 },
      colorInput('color', 'Color', 'rgba(245,166,35,0.75)'),
    ],
    [
      { key: 'upper', label: 'Upper', style: 'line', color: '$color', width: 1, lineStyle: 'dashed', role: 'secondary', legend: { hide: true } },
      // The middle IS the band's centre column — the close — and `edges` names
      // the two that bound it. Same shape as BB and Donchian; see defSchema's
      // `validateBandEdges` for why the edges stay first-class plots.
      // ⭐ TASK 2 — `ATR Bands(14, 2) 431.20`. THE TENTH SILENT DEFINITION, and
      // the one the phase plan's hand-typed list of nine did not contain: all
      // three of its plots declared `legend: { hide: true }`, so it drew an
      // envelope nobody could name while its `meta.legendParams` sat INERT beside
      // them — declared, and read by nothing, because a hidden plot never reaches
      // `chipLabel`. The derived rail is what named it.
      //
      // TWO decimals, because the basis is the CLOSE and the close is a price.
      { key: 'middle', label: 'Close', style: 'band', edges: { upper: 'upper', lower: 'lower' }, color: '$color', width: 1, lineStyle: 'solid', role: 'primary', legend: { decimals: 2 } },
      { key: 'lower', label: 'Lower', style: 'line', color: '$color', width: 1, lineStyle: 'dashed', role: 'secondary', legend: { hide: true } },
    ]),

  // ── MOVING AVERAGE ───────────────────────────────────────────────────────
  //
  // ⭐⭐ THE FIRST DEFINITION WHOSE INPUT IS A SERIES, AND THE ONLY ONE THIS PHASE
  // NEEDS. `MA(Close)`, `MA(Volume)`, `MA(RSI)` and `MA(MACD.signal)` are the SAME
  // indicator with different numeric sources — which is the whole point. Building
  // an "RSI Moving Average" would have been a second implementation of an average
  // and a third place for the maths to drift.
  //
  // ⚠️ IT DOES NOT REPLACE THE LEGACY PRICE MAs. `cs.overlays` still holds the
  // shipped SMA/EMA-on-close overlays, computed in `StockChart` exactly as they
  // are today: they have no instance id, no placement and no presentation, and
  // migrating them is a separate decision with its own backward-compatibility
  // story. This is ADDITIVE — an old chart gains nothing and loses nothing.
  //
  // ⚠️ `domainBehavior: 'inherit'` IS THE ANALYTICAL CLAIM, not a convenience.
  // An average of a 0-100 series is itself 0-100; an average of volume is not
  // bounded by anything. Saying so in metadata is what lets `MA(RSI)` read against
  // RSI's ladder without the renderer knowing what an RSI is — and what stops a
  // FUTURE transform that does not preserve its domain (a difference, a ratio)
  // from inheriting one it has no right to.
  ({
    ...nativeDef('movingAverage', 'movingAverage',
      // ⭐⭐ THIS IS **THE** MOVING AVERAGE NOW (2026-09-15). It used to be called
      // "Moving Average (Source)" because `cs.overlays`' price averages already
      // occupied the name, and two rows reading the same in a browse list is a
      // control a member cannot choose between. That was the right call while both
      // were offered; the resolution is not to qualify this one's name but to stop
      // offering the other, which `discoveryCatalog.LIBRARY_HIDDEN_IDS` now does.
      //
      // ⛔ NOTHING WAS MIGRATED, AND THE ID IS UNCHANGED. `cs.overlays` is a
      // POSITIONAL ARRAY with its own writers and its own compute; this is an
      // ENGINE INSTANCE. They are different persistence mechanisms, so merging them
      // would be a saved-chart rewrite. Existing overlays keep rendering, keep
      // their own rows in Chart Data's active list, and keep their ✕ — only the
      // browse entry that offered a SECOND way to create one is gone.
      //
      // ⚠️ "MOVING AVERAGE" IS THE WHOLE NAME because the capability is no longer
      // the distinguishing word — there is nothing left to distinguish it from. A
      // member picks Moving Average and then picks what it averages, which is the
      // point of the feature.
      //
      // ⭐⭐ AND IT NAMES ITSELF `EMA 9`, NOT `MA (9)` (2026-09-16). A member does
      // not have a "Moving Average" on their chart — they have a 9 EMA and a 50
      // SMA, and every other surface already spells it that way: `cs.overlays`'
      // own rows read `EMA 9` / `SMA 200` (`indicatorRegistry.listIndicators`),
      // and so does the shipped legend. The engine MA reading `Moving Average` was
      // the one place the two persistence mechanisms produced two different WORDS
      // for one user-facing concept — and with two at default inputs it read
      // `Moving Average #1` / `Moving Average #2`, because `disambiguateLabels`
      // had nothing but an ordinal to tell identical names apart.
      //
      // ⛔ THE STEM IS THE MEMBER'S OWN CHOICE, READ BACK FROM THE CONTROL THEY
      // MADE IT IN. `nameFrom.stem: 'maType'` resolves through the enum's OPTION
      // LABEL, so the word in the name is the word in the dropdown; a third MA
      // type added to `options` names itself with no edit here. `legendParams`
      // stays as the `MA (9)` fallback for a blob whose `maType` is unreadable.
      { name: 'Moving Average', shortName: 'MA', category: CAT.TREND, legendParams: ['period'],
        nameFrom: { stem: 'maType', params: ['period'] },
        // ⭐⭐ THE APPEARANCE A MOVING AVERAGE HAS ALWAYS HAD, DECLARED AS A
        // CAPABILITY (2026-09-28). `cs.overlays`' averages carried Overlap candles,
        // Line style, Line width and a reserved Offset; adopting them as instances
        // (`maAdoption.js`) must not take those controls away, and an average added
        // through + Add Indicator must have the same ones. They are PRESENTATION —
        // stored in `inst.presentation`, never `inputs` — so the inspector reads
        // this list rather than learning a definition id.
        appearance: ['overlap', 'lineStyle', 'lineWidth', 'offset'],
        // ⛔ ADD-ONLY at the DEFINITION level: a chart holds many averages (its
        // defaults among them), so a per-definition "off" would delete them all.
        // `IndicatorLibraryDialog.toggledRow` reads this.
        addOnly: true,
        description: 'The average of any series — price, volume, or another indicator output.',
        // ⭐ 2026-10-01 — the seven kit types are TYPES of this one row, so a member
        // who searches the type's own name (HMA, Hull, SMMA, Wilder…) lands here.
        // `moving vwap` too: a VWMA of HLC3 IS the moving VWAP (Σ(hlc3·v)/Σv).
        tags: ['ma', 'sma', 'ema', 'moving average', 'average', 'trend', 'smoothing', 'derived',
          'wma', 'weighted moving average', 'vwma', 'volume weighted moving average',
          'hma', 'hull', 'smma', 'rma', 'wilder', 'smoothed moving average',
          'dema', 'double exponential', 'tema', 'triple exponential',
          'lsma', 'least squares', 'linear regression', 'moving vwap', 'rolling vwap'] },
      // ⭐⭐ DECLARED ON PRICE, AND THAT IS THE BASE CASE RATHER THAN A COMPROMISE.
      // `MA(Close)` belongs on the candles — it is what a moving average has
      // always been — so the STATIC declaration says so and MA-on-close needs no
      // special handling to look like the shipped overlay. The DERIVED cases
      // (`MA(RSI)`, `MA(Volume)`) are resolved from the SOURCE by
      // `displayTarget.resolveDisplayTarget`, which is where a default that
      // depends on other state belongs. Declaring `pane` instead would have given
      // every MA-on-close its own empty pane by default, which is the one answer
      // nobody wants.
      onPrice,
      [
        // ⛔ THE SOURCE IS AN INPUT, WHICH IS WHY CHANGING IT RECOMPUTES. It rides
        // `inst.inputs` like `period`, so `inputsSignature` already invalidates the
        // memo when it changes and nothing had to be taught that a source is
        // special. A source held anywhere else would have needed its own
        // invalidation rule, and that rule would eventually be wrong.
        { key: 'source', type: 'source', label: 'Source', default: 'close' },
        // ⚠️ 500, NOT 400 (2026-09-28). The overlay averages this definition now
        // adopts were bounded at 500 by every editor they had (Settings, toolbar and
        // `StockChart.sanitizeOverlayPeriods`), and `validateInstance` DROPS an
        // instance whose input is out of range — a member's 450-day average would
        // have vanished on adoption rather than been kept. `maAdoption.MA_PERIOD_MAX`
        // mirrors it.
        periodInput('period', 'Period', 5, 1, 500),
        // ⭐ NINE TYPES SINCE 2026-10-01 — `../movingAverages.MA_TYPES`, the one
        // list the compute switches on, so a type a member can PICK is always a
        // type the maths implements. SMA stays the default: an instance stored
        // without `maType` reads exactly as it did.
        { key: 'maType', type: 'enum', label: 'Type', default: 'sma',
          options: MA_TYPES.map(([id, label]) => [id, label]) },
        colorInput('color', 'Color', '#f0b90b'),
      ],
      [
        { key: 'ma', label: 'MA', style: 'line', color: '$color', width: 1, role: 'primary',
          legend: { decimals: 2 } },
      ]),
    domainBehavior: 'inherit',
  }),

  // ── DIRECT SERIES ─────────────────────────────────────────────
  //
  // ⭐⭐ THE DEFINITION THAT IS NOT AN INDICATOR. Every other native in this file
  // computes something FROM a series; this one IS its series. `QQQ` on an AAPL
  // chart, `UCTA50`, `MACD.signal` lifted into its own pane — one definition, and
  // the member-facing identity is the SOURCE rather than the definition.
  //
  // ⛔⛔ SOURCE-FAMILY BLIND, AND THAT IS THE WHOLE DESIGN. There is no `if
  // breadth`, no `if security`, no symbol list. A security and a breadth
  // pseudo-ticker differ in DISCOVERY metadata and in the string after `sym:` —
  // nowhere else. `api/routers/bars.py` is the layer that knows what a symbol IS,
  // and it stays the only one.
  //
  // ⚠️ WHY IT IS NOT A MOVING AVERAGE WITH `period: 1`. An average of one is an
  // identity only by arithmetic accident, it carries a period control that means
  // nothing, and it names itself "MA" in every legend, menu and settings row. A
  // member plotting QQQ is not smoothing anything.
  //
  // ⛔⛔ AND WHY THE ID IS `dataSeries` AND NOT THE OBVIOUS `series`. `'series'` is
  // already an AST NODE TYPE (`ast/parse.js` `NODE_TYPES`), and `ast/lint.test.js`
  // proves the repaint linter has NO per-indicator exemption by asserting that no
  // string literal in `lint.js` equals a shipped definition id. A definition
  // called `series` makes that literal match forever, and the rail can no longer
  // tell "the linter mentions an indicator" from "the linter mentions a node
  // type" — it would go red on the true statement and stay red. The rail is worth
  // more than the shorter id. MEASURED on the originating branch: naming it
  // `series` failed that case with `expected ['series'] to deeply equal []`.
  //
  // ⚠️ AND WHY IT DECLARES `autoPane` RATHER THAN A FIXED SCALE. Its range is its
  // source's: QQQ is ~715, UCTA50 is 0-100, a MACD signal straddles zero. A
  // declared `scale` would be a claim about numbers this definition has never
  // seen. `domainBehavior: 'inherit'` says the same thing to the scale system —
  // the identity transform preserves its source's domain EXACTLY.
  ({
    ...nativeDef('dataSeries', 'dataSeries',
      { name: 'Data Series', shortName: 'Series', category: 'Data',
        description: 'Plots a numeric source directly, with no calculation applied — '
          + 'the values exactly as they are.',
        tags: ['series', 'source', 'derived'],
        // ⛔ NO `legendParams`. The parameter that identifies this instance is its
        // SOURCE, and a raw `sym:QQQ:close` in a legend chip is an address, not a
        // name. `sourceRef.instanceLabel` reads `labelFrom` instead and derives
        // `QQQ` from the parsed source — see its header.
        labelFrom: 'source' },
      autoPane(0.15),
      [
        // ⛔ THE SOURCE IS AN INPUT, WHICH IS WHY CHANGING IT RECOMPUTES. It rides
        // `inst.inputs` like any parameter, so `inputsSignature` already
        // invalidates the memo when it changes and nothing had to be taught that
        // a source is special. A source held anywhere else would have needed its
        // own invalidation rule, and that rule would eventually be wrong.
        // ⭐ `type: 'source'` WAS ALREADY THE SCHEMA'S VOCABULARY before this
        // definition existed — `defSchema` validates it — but nothing shipped
        // declared one, so `indicatorRegistry.fieldFromInput` answered `null` and
        // the tab drew nothing. This is the definition that made that answer
        // wrong, and the source control landed in the same change.
        { key: 'source', type: 'source', label: 'Source', default: 'close' },
        colorInput('color', 'Color', '#4f9cf9'),
      ],
      [
        // ⛔ `label: 'Series'` READ AS ENGINE VOCABULARY WHERE A MEMBER SEES IT.
        // A plot label names an indicator's OUTPUT — `RSI (14) → RSI`,
        // `MACD → MACD | SIG` — and in the source picker this one produced
        // `QQQ → Series`, which says nothing the group has not already said and
        // says it in the internal word. The passthrough's output is its value.
        // ⚠️ `meta.shortName` IS STILL `Series`, deliberately: it is the generic
        // stem for a series over an INSTANCE source, which has no symbol to be
        // named after.
        { key: 'value', label: 'Value', style: 'line', color: '$color', width: 1,
          role: 'primary', legend: { decimals: 2 } },
      ]),
    domainBehavior: 'inherit',
    // ⭐⭐ THE IDENTITY CLAIM, AND IT IS NOT `domainBehavior` SAID TWICE.
    // `domainBehavior: 'inherit'` is a claim about RANGE — an average of a
    // 0-100 series is still 0-100. This is the stronger and rarer claim that the
    // output IS the source, unchanged: no window, no smoothing, no arithmetic.
    //
    // ⚰️ MEASURED IN A BROWSER 2026-09-13 — the defect that made this explicit.
    // OHLC capability was asked of the instance's SOURCE, so `MA(sym:QQQ:close)`
    // answered yes, was offered Candles, and drew QQQ'S OWN BARS in the moving
    // average's pane: the legend read `MA(5) 714.88` against `QQQ 714.88`, the
    // same number, and the average was gone. A candle is a presentation of an
    // INSTRUMENT, so only a row whose output is that instrument may wear one.
    //
    // ⚠️ READ BY NOTHING ON THIS BRANCH YET — `ohlcCapability.js` is the consumer
    // and it is not ported. The claim is declared now because it belongs to the
    // definition, not to its reader, and because a definition that acquires the
    // claim later acquires it by argument rather than by design.
    //
    // ⛔ DECLARED, NOT INFERRED, AND ABSENT MEANS NO. A future identity
    // transform says so here; a difference, a ratio or a smoothing cannot
    // acquire the claim by being named like one.
    passthrough: true,
  }),

  // ─── DOLLAR VOLUME — AN INDICATOR, NOT A FREEBIE ─────────────────────────
  //
  // ⚰️⚰️ IT USED TO BE A LINE IN THE VOLUME PANE'S LABEL THAT NOBODY ASKED FOR.
  // `StockChart` computed `volume × close` on every crosshair frame and printed
  // `$ Vol $6.48B` beside `Vol 9.1M`, on every chart, for everyone, with NO
  // setting anywhere in the product to turn it off, move it, recolour it or plot
  // it. Owner, 2026-09-16: *"I do NOT want Dollar Volume and Average 50-Day Volume
  // automatically bundled into the Volume pane… If the member wants Dollar Volume,
  // they add it."*
  //
  // ⭐⭐ SO IT BECOMES AN ORDINARY DEFINITION AND GAINS EVERYTHING ONE HAS — a
  // catalogue row, a colour, a plot style, a display destination, a legend row
  // with a micro-rail, a ✕, duplication, alerts. Nothing about it is special any
  // more, which is the whole point of the change.
  //
  // ⛔⛔ AND IT DEFAULTS TO ITS OWN PANE, NOT TO VOLUME'S — which is arithmetic,
  // not timidity. Dollar volume is price × shares: ~$6.5B against 9.1M shares, two
  // orders of magnitude apart. Declared into the volume pane it would share
  // volume's ladder and flatten the bars it sits over into a solid line at zero.
  // A member who wants the two together moves it there through "Display in", and
  // `placement.js` gives a PARKED guest its own axis for exactly this reason (see
  // `displayTarget.derivedTargetOf` — units, not only position).
  //
  // ⚠️ NO `legendParams` AND NO INPUTS BUT COLOUR. It has no period, no source and
  // no choice to make: it is one number per bar, defined by the bar. A definition
  // with a parameter nobody can vary is a control that writes nowhere.
  nativeDef('dollarVolume', 'dollarVolume',
    { name: 'Dollar Volume', shortName: '$ Vol', category: CAT.VOLUME,
      description: 'The cash traded in each bar — volume multiplied by the closing price.',
      tags: ['dollar volume', 'turnover', 'notional', 'liquidity', 'volume', '$ vol'],
      // ⛔ A MAGNITUDE, NOT A LEVEL (2026-09-28): a day's dollar volume held across
      // 5m bars reads as a 5m quantity ~78× too large. Always the chart's frame.
      calcTimeframe: false },
    autoPane(0.15),
    [colorInput('color', 'Color', '#8fb7d9')],
    [
      // ⭐⭐ `compact: true` — AND IT IS THE REASON THAT FIELD EXISTS. Measured in
      // the pane harness 2026-09-16: this printed `Dollar Volume 4609414802`, ten
      // digits in a readout, over a chart whose own axis read `4.61B` two inches
      // away. `decimals` cannot express "print this like a magnitude"; a
      // definition declaring it can. See `readout.chipValueText`.
      { key: 'dv', label: '$ Vol', style: 'histogram', color: '$color', width: 1,
        role: 'primary', legend: { decimals: 0, compact: true } },
    ]),

  // ═══════════════════════════════════════════════════════════════════════════
  // ═══ THE TECHNICAL LIBRARY — TIER 1 (2026-10-01) ═══════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Thirty-three studies, each an ordinary native definition over the maths in
  // `../technicalStudies.js` (and the shared moving-average kit). Semantics,
  // defaults and every convention choice are recorded per function there and in
  // `docs/decisions/2026-10-01-technical-library-tier1.md`.
  //
  // ⭐ CHART-ONLY, DELIBERATELY. None of these has a server (Python) twin, so none
  // is an alert address yet — the same standing `dollarVolume`, `movingAverage`
  // and `atrBands` already ship with. Alert parity is a separate project.
  //
  // ⭐ `quickMenu: false` — the chart's right-click "Indicators" quick toggles
  // stay the shipped set; a Tier 1 study appears there only while it is ON (so it
  // can be switched off from where it is seen). The library is its door.
  //
  // ⭐ A `source` INPUT appears only where the study is a transform of ONE series
  // (ROC of RSI is meaningful; Ultimate Oscillator of RSI is not). Those that do
  // not preserve their source's units stay in their own pane — see the
  // `domainBehavior` gate in `sourceRef.derivedTargetFor`.

  // ── TREND & MOVING AVERAGES ──────────────────────────────────────────────
  nativeDef('superTrend', 'superTrend',
    { name: 'SuperTrend', shortName: 'SuperTrend', category: CAT.TREND, quickMenu: false,
      legendParams: ['atrPeriod', 'multiplier'],
      description: 'An ATR trailing line that flips sides when the close crosses it.',
      tags: ['supertrend', 'super trend', 'trailing stop', 'atr', 'trend'] },
    onPrice,
    [
      periodInput('atrPeriod', 'ATR Period', 10, 1, 100),
      { key: 'multiplier', type: 'float', label: 'Multiplier', default: 3, min: 0.5, max: 10, step: 0.5 },
      colorInput('upColor', 'Up trend', '#2faf68'),
      colorInput('downColor', 'Down trend', '#df4646'),
    ],
    [
      // ⭐ 2026-10-01 (polish) — BOTH HALVES ARE `sparse`: each is blank by design
      // while the other trend holds. The line BREAKS at a flip (one render series
      // per run — lightweight-charts would otherwise bridge the blank bars with a
      // diagonal), and the legend shows only the ACTIVE side — one
      // `SuperTrend(10, 3)` chip in that side's colour — never a bare "Down" or a
      // stale value. The maths is unchanged.
      { key: 'up', label: 'Up', style: 'line', color: '$upColor', width: 2, role: 'primary', sparse: true, legend: { decimals: 2 } },
      { key: 'down', label: 'Down', style: 'line', color: '$downColor', width: 2, role: 'secondary', sparse: true, legend: { decimals: 2 } },
    ]),

  nativeDef('aroon', 'aroon',
    { name: 'Aroon', shortName: 'Aroon', category: CAT.TREND, quickMenu: false, legendParams: ['period'],
      description: 'How recently the period high and low were set — trend start and strength.',
      tags: ['aroon', 'aroon up', 'aroon down', 'trend strength'] },
    fixedPane(0, 100, 0.15),
    [
      periodInput('period', 'Period', 14, 1, 200),
      colorInput('upColor', 'Aroon Up', '#3fae75'),
      colorInput('downColor', 'Aroon Down', '#d9534f'),
    ],
    [
      { key: 'up', label: 'Aroon Up', style: 'line', color: '$upColor', width: 1, role: 'primary', legend: { label: 'Up', decimals: 1 } },
      { key: 'down', label: 'Aroon Down', style: 'line', color: '$downColor', width: 1, role: 'secondary', legend: { label: 'Down', decimals: 1 } },
      { key: 'bands', label: '70 / 30', style: 'hlines', levels: [70, 30], color: 'rgba(255,255,255,0.14)', width: 1, lineStyle: 'dashed', role: 'context' },
    ]),

  nativeDef('vortex', 'vortex',
    { name: 'Vortex Indicator', shortName: 'VI', category: CAT.TREND, quickMenu: false, legendParams: ['period'],
      description: 'Positive and negative trend movement compared with true range.',
      tags: ['vortex', 'vi+', 'vi-', 'trend strength'] },
    autoPane(0.15),
    [
      periodInput('period', 'Period', 14, 2, 200),
      colorInput('plusColor', 'VI+', '#3fae75'),
      colorInput('minusColor', 'VI−', '#d9534f'),
    ],
    [
      { key: 'plus', label: 'VI+', style: 'line', color: '$plusColor', width: 1, role: 'primary', legend: { label: 'VI+', decimals: 3 } },
      { key: 'minus', label: 'VI−', style: 'line', color: '$minusColor', width: 1, role: 'secondary', legend: { label: 'VI−', decimals: 3 } },
      { key: 'one', label: '1.0', style: 'hlines', levels: [1], color: 'rgba(255,255,255,0.12)', width: 1, lineStyle: 'largeDashed', role: 'context' },
    ]),

  nativeDef('choppiness', 'choppiness',
    { name: 'Choppiness Index', shortName: 'CHOP', category: CAT.TREND, quickMenu: false, legendParams: ['period'],
      description: 'Whether the market is trending (low) or moving sideways (high), 0-100.',
      tags: ['choppiness', 'chop', 'ci', 'range', 'trend strength'] },
    fixedPane(0, 100, 0.15),
    [periodInput('period', 'Period', 14, 2, 200), colorInput('color', 'Color', '#d4a72c')],
    [
      { key: 'chop', label: 'CHOP', style: 'line', color: '$color', width: 1, role: 'primary', legend: { decimals: 1 } },
      { key: 'bands', label: '61.8 / 38.2', style: 'hlines', levels: [61.8, 38.2], color: 'rgba(212,167,44,0.35)', width: 1, lineStyle: 'dashed', role: 'context' },
    ]),

  // ── MOMENTUM & OSCILLATORS ───────────────────────────────────────────────
  nativeDef('stochRsi', 'stochRsi',
    { name: 'Stochastic RSI', shortName: 'Stoch RSI', category: CAT.MOMENTUM, quickMenu: false,
      legendParams: ['rsiPeriod', 'stochPeriod'],
      description: 'A stochastic of RSI — where RSI sits inside its own recent range.',
      tags: ['stoch rsi', 'stochrsi', 'stochastic rsi', 'oscillator', 'momentum'] },
    fixedPane(0, 100, 0.15),
    [
      SOURCE_INPUT,
      periodInput('rsiPeriod', 'RSI Length', 14, 2, 200),
      periodInput('stochPeriod', 'Stochastic Length', 14, 1, 200),
      periodInput('kSmooth', '%K Smoothing', 3, 1, 50),
      periodInput('dSmooth', '%D Smoothing', 3, 1, 50),
      colorInput('kColor', '%K', '#d4a72c'),
      colorInput('dColor', '%D', '#7f8ea3'),
    ],
    [
      { key: 'k', label: '%K', style: 'line', color: '$kColor', width: 1, role: 'primary', legend: { decimals: 1 } },
      { key: 'd', label: '%D', style: 'line', color: '$dColor', width: 1, lineStyle: 'dashed', role: 'secondary', legend: { label: '%D', decimals: 1 } },
      { key: 'bands', label: '80 / 20', style: 'hlines', levels: [80, 20], color: 'rgba(212,167,44,0.35)', width: 1, lineStyle: 'dashed', role: 'context' },
    ]),

  nativeDef('ppo', 'ppo',
    { name: 'Percentage Price Oscillator', shortName: 'PPO', category: CAT.MOMENTUM, quickMenu: false,
      legendParams: ['fastPeriod', 'slowPeriod', 'signalPeriod'],
      description: 'MACD expressed as a percentage of the slow average, so it compares across prices.',
      tags: ['ppo', 'percentage price oscillator', 'price oscillator', 'macd %', 'momentum'] },
    autoPane(0.17),
    [
      SOURCE_INPUT,
      periodInput('fastPeriod', 'Fast', 12, 1, 200),
      periodInput('slowPeriod', 'Slow', 26, 1, 400),
      periodInput('signalPeriod', 'Signal', 9, 1, 100),
      colorInput('lineColor', 'PPO', '#d4a72c'),
      colorInput('signalColor', 'Signal', '#7f8ea3'),
    ],
    [
      { key: 'ppo', label: 'PPO', style: 'line', color: '$lineColor', width: 1, role: 'primary', legend: { decimals: 3 } },
      { key: 'signal', label: 'Signal', style: 'line', color: '$signalColor', width: 1, role: 'secondary', legend: { label: 'SIG', decimals: 3 } },
      { key: 'histogram', label: 'Histogram', style: 'histogram', colorMode: 'sign',
        colorUp: 'rgba(47,175,104,0.6)', colorDown: 'rgba(223,70,70,0.6)', precision: 4, role: 'secondary', legend: { hide: true } },
      { key: 'zero', label: '0', style: 'hlines', levels: [0], color: 'rgba(255,255,255,0.12)', width: 1, lineStyle: 'largeDashed', role: 'context' },
    ]),

  nativeDef('roc', 'roc',
    { name: 'Rate of Change', shortName: 'ROC', category: CAT.MOMENTUM, quickMenu: false, legendParams: ['period'],
      description: 'Percentage change from N bars ago.',
      tags: ['roc', 'rate of change', 'percent change', 'momentum'] },
    autoPane(0.15),
    [SOURCE_INPUT, periodInput('period', 'Period', 12, 1, 500), colorInput('color', 'Color', '#d4a72c')],
    [
      { key: 'roc', label: 'ROC', style: 'line', color: '$color', width: 1, role: 'primary', legend: { decimals: 2 } },
      { key: 'zero', label: '0', style: 'hlines', levels: [0], color: 'rgba(255,255,255,0.12)', width: 1, lineStyle: 'largeDashed', role: 'context' },
    ]),

  nativeDef('momentum', 'momentum',
    { name: 'Momentum', shortName: 'MOM', category: CAT.MOMENTUM, quickMenu: false, legendParams: ['period'],
      description: 'The difference between the value now and N bars ago, in price units.',
      tags: ['momentum', 'mom', 'mtm'] },
    autoPane(0.15),
    [SOURCE_INPUT, periodInput('period', 'Period', 10, 1, 500), colorInput('color', 'Color', '#d4a72c')],
    [
      { key: 'mom', label: 'MOM', style: 'line', color: '$color', width: 1, role: 'primary', legend: { decimals: 2 } },
      { key: 'zero', label: '0', style: 'hlines', levels: [0], color: 'rgba(255,255,255,0.12)', width: 1, lineStyle: 'largeDashed', role: 'context' },
    ]),

  nativeDef('tsi', 'tsi',
    { name: 'True Strength Index', shortName: 'TSI', category: CAT.MOMENTUM, quickMenu: false,
      legendParams: ['longPeriod', 'shortPeriod'],
      description: 'Double-smoothed momentum as a share of double-smoothed absolute momentum.',
      tags: ['tsi', 'true strength index', 'momentum'] },
    autoPane(0.15),
    [
      SOURCE_INPUT,
      periodInput('longPeriod', 'Long', 25, 1, 200),
      periodInput('shortPeriod', 'Short', 13, 1, 200),
      periodInput('signalPeriod', 'Signal', 13, 1, 100),
      colorInput('lineColor', 'TSI', '#d4a72c'),
      colorInput('signalColor', 'Signal', '#7f8ea3'),
    ],
    [
      { key: 'tsi', label: 'TSI', style: 'line', color: '$lineColor', width: 1, role: 'primary', legend: { decimals: 2 } },
      { key: 'signal', label: 'Signal', style: 'line', color: '$signalColor', width: 1, role: 'secondary', legend: { label: 'SIG', decimals: 2 } },
      { key: 'zero', label: '0', style: 'hlines', levels: [0], color: 'rgba(255,255,255,0.12)', width: 1, lineStyle: 'largeDashed', role: 'context' },
    ]),

  nativeDef('cmo', 'cmo',
    { name: 'Chande Momentum Oscillator', shortName: 'CMO', category: CAT.MOMENTUM, quickMenu: false, legendParams: ['period'],
      description: 'Up moves minus down moves over their total, from −100 to +100.',
      tags: ['cmo', 'chande momentum oscillator', 'chande', 'oscillator', 'momentum'] },
    fixedPane(-100, 100, 0.15),
    [SOURCE_INPUT, periodInput('period', 'Period', 14, 1, 200), colorInput('color', 'Color', '#d4a72c')],
    [
      { key: 'cmo', label: 'CMO', style: 'line', color: '$color', width: 1, role: 'primary', legend: { decimals: 1 } },
      { key: 'bands', label: '50 / −50', style: 'hlines', levels: [50, -50], color: 'rgba(212,167,44,0.35)', width: 1, lineStyle: 'dashed', role: 'context' },
      { key: 'zero', label: '0', style: 'hlines', levels: [0], color: 'rgba(255,255,255,0.12)', width: 1, lineStyle: 'largeDashed', role: 'context' },
    ]),

  nativeDef('trix', 'trix',
    { name: 'TRIX', shortName: 'TRIX', category: CAT.MOMENTUM, quickMenu: false, legendParams: ['period'],
      description: 'The one-bar percentage change of a triple-smoothed EMA.',
      tags: ['trix', 'triple exponential', 'momentum'] },
    autoPane(0.15),
    [
      SOURCE_INPUT,
      periodInput('period', 'Period', 15, 1, 200),
      periodInput('signalPeriod', 'Signal', 9, 1, 100),
      colorInput('lineColor', 'TRIX', '#d4a72c'),
      colorInput('signalColor', 'Signal', '#7f8ea3'),
    ],
    [
      { key: 'trix', label: 'TRIX', style: 'line', color: '$lineColor', width: 1, role: 'primary', legend: { decimals: 4 } },
      { key: 'signal', label: 'Signal', style: 'line', color: '$signalColor', width: 1, role: 'secondary', legend: { label: 'SIG', decimals: 4 } },
      { key: 'zero', label: '0', style: 'hlines', levels: [0], color: 'rgba(255,255,255,0.12)', width: 1, lineStyle: 'largeDashed', role: 'context' },
    ]),

  nativeDef('awesome', 'awesome',
    { name: 'Awesome Oscillator', shortName: 'AO', category: CAT.MOMENTUM, quickMenu: false, legendParams: ['fastPeriod', 'slowPeriod'],
      description: 'A fast minus a slow average of the bar midpoint, coloured by whether it is rising.',
      tags: ['awesome oscillator', 'ao', 'bill williams', 'momentum'] },
    autoPane(0.15),
    [periodInput('fastPeriod', 'Fast', 5, 1, 100), periodInput('slowPeriod', 'Slow', 34, 1, 300)],
    [
      { key: 'ao', label: 'AO', style: 'histogram', colorMode: 'column:rising',
        colorUp: 'rgba(47,175,104,0.75)', colorDown: 'rgba(223,70,70,0.75)', precision: 4, role: 'primary', legend: { decimals: 4 } },
      { key: 'rising', label: 'Rising', style: 'line', hidden: true, color: '#7f8ea3', width: 1, role: 'context', legend: { hide: true } },
      { key: 'zero', label: '0', style: 'hlines', levels: [0], color: 'rgba(255,255,255,0.12)', width: 1, lineStyle: 'largeDashed', role: 'context' },
    ]),

  nativeDef('ultimate', 'ultimate',
    { name: 'Ultimate Oscillator', shortName: 'UO', category: CAT.MOMENTUM, quickMenu: false,
      legendParams: ['fastPeriod', 'midPeriod', 'slowPeriod'],
      description: 'Buying pressure over three windows, weighted toward the shortest, 0-100.',
      tags: ['ultimate oscillator', 'uo', 'williams', 'oscillator', 'momentum'] },
    fixedPane(0, 100, 0.15),
    [
      periodInput('fastPeriod', 'Fast', 7, 1, 100),
      periodInput('midPeriod', 'Middle', 14, 1, 200),
      periodInput('slowPeriod', 'Slow', 28, 1, 400),
      colorInput('color', 'Color', '#d4a72c'),
    ],
    [
      { key: 'uo', label: 'UO', style: 'line', color: '$color', width: 1, role: 'primary', legend: { decimals: 1 } },
      { key: 'bands', label: '70 / 30', style: 'hlines', levels: [70, 30], color: 'rgba(212,167,44,0.35)', width: 1, lineStyle: 'dashed', role: 'context' },
    ]),

  nativeDef('balanceOfPower', 'balanceOfPower',
    { name: 'Balance of Power', shortName: 'BOP', category: CAT.MOMENTUM, quickMenu: false, legendParams: ['smoothing'],
      description: 'Where each bar closed relative to its open, as a share of its range, smoothed.',
      tags: ['balance of power', 'bop', 'momentum'] },
    autoPane(0.15),
    [periodInput('smoothing', 'Smoothing', 14, 1, 200)],
    [
      { key: 'bop', label: 'BOP', style: 'histogram', colorMode: 'sign',
        colorUp: 'rgba(47,175,104,0.7)', colorDown: 'rgba(223,70,70,0.7)', precision: 3, role: 'primary', legend: { decimals: 3 } },
      { key: 'zero', label: '0', style: 'hlines', levels: [0], color: 'rgba(255,255,255,0.12)', width: 1, lineStyle: 'largeDashed', role: 'context' },
    ]),

  nativeDef('bullBearPower', 'bullBearPower',
    { name: 'Bull/Bear Power', shortName: 'Bull/Bear', category: CAT.MOMENTUM, quickMenu: false, legendParams: ['period'],
      description: 'Elder-ray: how far the high and the low are from an EMA of the close.',
      tags: ['bull bear power', 'bull power', 'bear power', 'elder ray', 'elder-ray', 'momentum'] },
    autoPane(0.15),
    [
      periodInput('period', 'EMA Period', 13, 1, 200),
      colorInput('bullColor', 'Bull Power', 'rgba(47,175,104,0.7)'),
      colorInput('bearColor', 'Bear Power', 'rgba(223,70,70,0.7)'),
    ],
    [
      { key: 'bull', label: 'Bull Power', style: 'histogram', color: '$bullColor', precision: 2, role: 'primary', legend: { label: 'Bull', decimals: 2 } },
      { key: 'bear', label: 'Bear Power', style: 'histogram', color: '$bearColor', precision: 2, role: 'secondary', legend: { label: 'Bear', decimals: 2 } },
      { key: 'zero', label: '0', style: 'hlines', levels: [0], color: 'rgba(255,255,255,0.12)', width: 1, lineStyle: 'largeDashed', role: 'context' },
    ]),

  // ── VOLATILITY & BANDS ───────────────────────────────────────────────────
  nativeDef('keltner', 'keltner',
    { name: 'Keltner Channels', shortName: 'KC', category: CAT.VOLATILITY, quickMenu: false,
      legendParams: ['period', 'multiplier'],
      description: 'An EMA of the close with bands a multiple of ATR either side.',
      tags: ['keltner', 'keltner channels', 'kc', 'channel', 'bands', 'volatility'] },
    onPrice,
    [
      periodInput('period', 'EMA Period', 20, 1, 400),
      { key: 'multiplier', type: 'float', label: 'Multiplier', default: 2, min: 0.1, max: 10, step: 0.1 },
      periodInput('atrPeriod', 'ATR Period', 10, 1, 200),
      colorInput('color', 'Color', 'rgba(79,156,249,0.8)'),
    ],
    [
      { key: 'upper', label: 'Upper', style: 'line', color: '$color', width: 1, lineStyle: 'dashed', role: 'secondary', legend: { hide: true } },
      { key: 'middle', label: 'Basis', style: 'band', edges: { upper: 'upper', lower: 'lower' }, color: '$color', width: 1, lineStyle: 'solid', role: 'primary', legend: { decimals: 2 } },
      { key: 'lower', label: 'Lower', style: 'line', color: '$color', width: 1, lineStyle: 'dashed', role: 'secondary', legend: { hide: true } },
    ]),

  ({
    ...nativeDef('envelope', 'envelope',
      { name: 'MA Envelope', shortName: 'Envelope', category: CAT.VOLATILITY, quickMenu: false,
        legendParams: ['period', 'percent'],
        description: 'A moving average with bands a fixed percentage above and below it.',
        tags: ['envelope', 'envelopes', 'ma envelope', 'moving average envelope', 'percent bands', 'bands'] },
      onPrice,
      [
        SOURCE_INPUT,
        periodInput('period', 'Period', 20, 1, 500),
        { key: 'percent', type: 'float', label: 'Percent', default: 2.5, min: 0.1, max: 50, step: 0.1 },
        { key: 'maType', type: 'enum', label: 'Type', default: 'sma', options: MA_TYPES.map(([id, label]) => [id, label]) },
        colorInput('color', 'Color', 'rgba(212,167,44,0.8)'),
      ],
      [
        { key: 'upper', label: 'Upper', style: 'line', color: '$color', width: 1, lineStyle: 'dashed', role: 'secondary', legend: { hide: true } },
        { key: 'middle', label: 'Basis', style: 'band', edges: { upper: 'upper', lower: 'lower' }, color: '$color', width: 1, lineStyle: 'solid', role: 'primary', legend: { decimals: 2 } },
        { key: 'lower', label: 'Lower', style: 'line', color: '$color', width: 1, lineStyle: 'dashed', role: 'secondary', legend: { hide: true } },
      ]),
    // ⭐ An envelope of a series is on that series' scale — an envelope of RSI
    // belongs in RSI's pane, exactly like `MA(RSI)`.
    domainBehavior: 'inherit',
  }),

  nativeDef('bbPercentB', 'bbPercentB',
    { name: 'Bollinger %B', shortName: '%B', category: CAT.VOLATILITY, quickMenu: false, legendParams: ['period', 'stdDev'],
      description: 'Where the close sits within the Bollinger Bands: 0 at the lower band, 1 at the upper.',
      tags: ['%b', 'percent b', 'bollinger %b', 'bollinger', 'bands'] },
    autoPane(0.15),
    [
      periodInput('period', 'Period', 20, 2, 200),
      { key: 'stdDev', type: 'float', label: 'Std Dev', default: 2, min: 0.5, max: 5, step: 0.5 },
      colorInput('color', 'Color', '#d4a72c'),
    ],
    [
      { key: 'percentB', label: '%B', style: 'line', color: '$color', width: 1, role: 'primary', legend: { decimals: 3 } },
      { key: 'bands', label: '1 / 0', style: 'hlines', levels: [1, 0], color: 'rgba(212,167,44,0.35)', width: 1, lineStyle: 'dashed', role: 'context' },
      { key: 'midline', label: '0.5', style: 'hlines', levels: [0.5], color: 'rgba(255,255,255,0.12)', width: 1, lineStyle: 'largeDashed', role: 'context' },
    ]),

  nativeDef('bbWidth', 'bbWidth',
    { name: 'Bollinger BandWidth', shortName: 'BBW', category: CAT.VOLATILITY, quickMenu: false, legendParams: ['period', 'stdDev'],
      description: 'The width of the Bollinger Bands as a percentage of their basis.',
      tags: ['bandwidth', 'bbw', 'bollinger bandwidth', 'bollinger', 'squeeze', 'bands'] },
    autoPane(0.13),
    [
      periodInput('period', 'Period', 20, 2, 200),
      { key: 'stdDev', type: 'float', label: 'Std Dev', default: 2, min: 0.5, max: 5, step: 0.5 },
      colorInput('color', 'Color', '#d4a72c'),
    ],
    [{ key: 'bandwidth', label: 'BBW', style: 'line', color: '$color', width: 1, role: 'primary', legend: { decimals: 2 } }]),

  nativeDef('atrPercent', 'atrPercent',
    { name: 'ATR %', shortName: 'ATR %', category: CAT.VOLATILITY, quickMenu: false, legendParams: ['period'],
      // ⚠️ NOT "Average True Range …": a description is part of the row's
      // accessible name, and that phrase would make the ATR row ambiguous.
      description: 'ATR as a percentage of the close — volatility you can compare across prices.',
      tags: ['atr%', 'atr percent', 'natr', 'normalized atr', 'volatility'] },
    autoPane(0.13),
    [periodInput('period', 'Period', 14, 1, 100), colorInput('color', 'Color', '#FFA726')],
    [{ key: 'atrPct', label: 'ATR %', style: 'line', color: '$color', width: 1, role: 'primary', legend: { decimals: 2 } }]),

  nativeDef('adrPercent', 'adrPercent',
    { name: 'ADR %', shortName: 'ADR %', category: CAT.VOLATILITY, quickMenu: false, legendParams: ['period'],
      description: 'Average daily range: the average of each bar\'s high ÷ low, as a percentage.',
      tags: ['adr', 'adr%', 'average daily range', 'daily range', 'volatility'] },
    autoPane(0.13),
    [periodInput('period', 'Period', 20, 1, 200), colorInput('color', 'Color', '#d4a72c')],
    [{ key: 'adrPct', label: 'ADR %', style: 'line', color: '$color', width: 1, role: 'primary', legend: { decimals: 2 } }]),

  nativeDef('historicalVolatility', 'historicalVolatility',
    { name: 'Historical Volatility', shortName: 'HV', category: CAT.VOLATILITY, quickMenu: false, legendParams: ['period'],
      description: 'Annualised close-to-close volatility, in percent.',
      tags: ['historical volatility', 'hv', 'realized volatility', 'volatility'],
      // ⛔ ANNUALISED BY TRADING PERIODS PER YEAR — 252 daily, 52 weekly, 12
      // monthly. An intraday bar has no honest annualisation here (extended-hours
      // sessions vary), so it is not offered there rather than guessed.
      timeframes: ['D', 'W', 'M'] },
    autoPane(0.13),
    [periodInput('period', 'Period', 20, 2, 400), colorInput('color', 'Color', '#d4a72c')],
    [{ key: 'hv', label: 'HV', style: 'line', color: '$color', width: 1, role: 'primary', legend: { decimals: 2 } }]),

  nativeDef('squeeze', 'squeeze',
    { name: 'Squeeze', shortName: 'Squeeze', category: CAT.VOLATILITY, quickMenu: false,
      legendParams: ['period'],
      description: 'Bollinger Bands inside Keltner Channels marks a squeeze; the histogram is momentum.',
      tags: ['squeeze', 'volatility squeeze', 'bb kc', 'bollinger keltner', 'momentum'] },
    autoPane(0.15),
    [
      periodInput('period', 'Length', 20, 2, 200),
      { key: 'bbMult', type: 'float', label: 'BB Multiplier', default: 2, min: 0.5, max: 5, step: 0.1 },
      { key: 'kcMult', type: 'float', label: 'KC Multiplier', default: 1.5, min: 0.5, max: 5, step: 0.1 },
    ],
    [
      { key: 'momentum', label: 'Momentum', style: 'histogram', colorMode: 'sign',
        colorUp: 'rgba(47,175,104,0.7)', colorDown: 'rgba(223,70,70,0.7)', precision: 4, role: 'primary', legend: { decimals: 4 } },
      // The squeeze STATE, drawn as a band of colour along the zero line: gold
      // while the bands are inside the channels, slate once they are not.
      { key: 'state', label: 'Squeeze', style: 'line', width: 3, colorMode: 'column:on',
        color: '#d4a72c', colorUp: '#d4a72c', colorDown: 'rgba(127,142,163,0.55)', role: 'secondary', legend: { hide: true } },
      { key: 'on', label: 'Squeeze on', style: 'line', hidden: true, color: '#7f8ea3', width: 1, role: 'context', legend: { hide: true } },
    ]),

  // ── VOLUME & MONEY FLOW ──────────────────────────────────────────────────
  nativeDef('relativeVolume', 'relativeVolume',
    { name: 'Relative Volume', shortName: 'RVOL', category: CAT.VOLUME, quickMenu: false, legendParams: ['period'],
      description: 'This bar\'s volume divided by the average volume of the previous N bars.',
      tags: ['relative volume', 'rvol', 'volume ratio', 'volume surge', 'volume'] },
    autoPane(0.13),
    [periodInput('period', 'Average Period', 50, 1, 500), colorInput('color', 'Color', 'rgba(143,183,217,0.85)')],
    [
      { key: 'rvol', label: 'RVOL', style: 'histogram', color: '$color', precision: 2, role: 'primary', legend: { decimals: 2 } },
      { key: 'one', label: '1.0', style: 'hlines', levels: [1], color: 'rgba(212,167,44,0.45)', width: 1, lineStyle: 'dashed', role: 'context' },
    ]),

  nativeDef('accumDist', 'accumDist',
    { name: 'Accumulation/Distribution', shortName: 'A/D', category: CAT.VOLUME, quickMenu: false,
      description: 'A running total of volume weighted by where each bar closed in its range.',
      tags: ['accumulation distribution', 'a/d', 'ad line', 'adl', 'chaikin', 'volume'] },
    autoPane(0.13),
    [colorInput('color', 'Color', '#9ca3af')],
    [{ key: 'ad', label: 'A/D', style: 'line', color: '$color', width: 1, role: 'primary', legend: { decimals: 0, compact: true } }]),

  nativeDef('chaikinMoneyFlow', 'chaikinMoneyFlow',
    { name: 'Chaikin Money Flow', shortName: 'CMF', category: CAT.VOLUME, quickMenu: false, legendParams: ['period'],
      description: 'Money-flow volume over total volume for the window, from −1 to +1.',
      tags: ['cmf', 'chaikin money flow', 'money flow', 'chaikin', 'volume'] },
    autoPane(0.13),
    [periodInput('period', 'Period', 20, 1, 200)],
    [
      { key: 'cmf', label: 'CMF', style: 'histogram', colorMode: 'sign',
        colorUp: 'rgba(47,175,104,0.7)', colorDown: 'rgba(223,70,70,0.7)', precision: 3, role: 'primary', legend: { decimals: 3 } },
      { key: 'zero', label: '0', style: 'hlines', levels: [0], color: 'rgba(255,255,255,0.12)', width: 1, lineStyle: 'largeDashed', role: 'context' },
    ]),

  nativeDef('chaikinOscillator', 'chaikinOscillator',
    { name: 'Chaikin Oscillator', shortName: 'Chaikin Osc', category: CAT.VOLUME, quickMenu: false,
      legendParams: ['fastPeriod', 'slowPeriod'],
      description: 'The momentum of the Accumulation/Distribution line: a fast minus a slow EMA of it.',
      tags: ['chaikin oscillator', 'chaikin osc', 'chaikin', 'a/d', 'volume'] },
    autoPane(0.13),
    [periodInput('fastPeriod', 'Fast', 3, 1, 100), periodInput('slowPeriod', 'Slow', 10, 1, 200), colorInput('color', 'Color', '#d4a72c')],
    [
      { key: 'osc', label: 'Chaikin Osc', style: 'line', color: '$color', width: 1, role: 'primary', legend: { decimals: 0, compact: true } },
      { key: 'zero', label: '0', style: 'hlines', levels: [0], color: 'rgba(255,255,255,0.12)', width: 1, lineStyle: 'largeDashed', role: 'context' },
    ]),

  nativeDef('forceIndex', 'forceIndex',
    { name: 'Elder Force Index', shortName: 'EFI', category: CAT.VOLUME, quickMenu: false, legendParams: ['period'],
      description: 'Price change times volume, smoothed — the force behind a move.',
      tags: ['force index', 'elder force index', 'efi', 'elder', 'volume'] },
    autoPane(0.13),
    [periodInput('period', 'Period', 13, 1, 200), colorInput('color', 'Color', '#d4a72c')],
    [
      { key: 'efi', label: 'EFI', style: 'line', color: '$color', width: 1, role: 'primary', legend: { decimals: 0, compact: true } },
      { key: 'zero', label: '0', style: 'hlines', levels: [0], color: 'rgba(255,255,255,0.12)', width: 1, lineStyle: 'largeDashed', role: 'context' },
    ]),

  nativeDef('pvt', 'pvt',
    { name: 'Price Volume Trend', shortName: 'PVT', category: CAT.VOLUME, quickMenu: false,
      description: 'A running total of volume weighted by each bar\'s percentage change.',
      tags: ['pvt', 'price volume trend', 'volume price trend', 'vpt', 'volume'] },
    autoPane(0.13),
    [colorInput('color', 'Color', '#9ca3af')],
    [{ key: 'pvt', label: 'PVT', style: 'line', color: '$color', width: 1, role: 'primary', legend: { decimals: 0, compact: true } }]),

  nativeDef('upDownVolume', 'upDownVolume',
    { name: 'Up/Down Volume Ratio', shortName: 'U/D Vol', category: CAT.VOLUME, quickMenu: false, legendParams: ['period'],
      // ⛔ THIS SYMBOL'S OWN BARS — not the Breadth datasets' market-wide
      // advancing/declining volume, which is a different concept on another tab.
      description: 'This symbol\'s volume on up bars divided by its volume on down bars, over N bars.',
      tags: ['up/down volume', 'up down volume', 'u/d volume', 'ud ratio', 'accumulation', 'volume'] },
    autoPane(0.13),
    [periodInput('period', 'Period', 50, 2, 500), colorInput('color', 'Color', '#d4a72c')],
    [
      { key: 'ratio', label: 'U/D', style: 'line', color: '$color', width: 1, role: 'primary', legend: { decimals: 2 } },
      { key: 'one', label: '1.0', style: 'hlines', levels: [1], color: 'rgba(255,255,255,0.14)', width: 1, lineStyle: 'dashed', role: 'context' },
    ]),

  // ── RELATIVE STRENGTH ────────────────────────────────────────────────────
  nativeDef('percentFromMa', 'percentFromMa',
    // ⭐ `% From MA`, NOT "% From Moving Average": the library offers exactly ONE
    // row named Moving Average (owner §34), and this is a different study.
    { name: '% From MA', shortName: '% From MA', category: CAT.RELATIVE_STRENGTH, quickMenu: false,
      legendParams: ['period'],
      description: 'How far the value is above or below its moving average, in percent.',
      tags: ['% from ma', 'percent from moving average', 'distance from ma', 'extension', 'extended'] },
    autoPane(0.13),
    [
      SOURCE_INPUT,
      periodInput('period', 'Period', 50, 1, 500),
      { key: 'maType', type: 'enum', label: 'Type', default: 'sma', options: MA_TYPES.map(([id, label]) => [id, label]) },
      colorInput('color', 'Color', '#d4a72c'),
    ],
    [
      { key: 'pct', label: '% From MA', style: 'line', color: '$color', width: 1, role: 'primary', legend: { decimals: 2 } },
      { key: 'zero', label: '0', style: 'hlines', levels: [0], color: 'rgba(255,255,255,0.12)', width: 1, lineStyle: 'largeDashed', role: 'context' },
    ]),

  nativeDef('fiftyTwoWeek', 'fiftyTwoWeek',
    { name: '52-Week High/Low', shortName: '52W', category: CAT.RELATIVE_STRENGTH, quickMenu: false,
      description: 'How far the close is below its 52-week high and above its 52-week low, in percent.',
      tags: ['52 week', '52-week', '52w', '52 week high', '52 week low', 'off high', 'yearly high'],
      // ⛔ A CALENDAR WINDOW. It needs a full 52 weeks of loaded bars before it
      // answers, which an intraday chart does not hold.
      timeframes: ['D', 'W', 'M'] },
    autoPane(0.13),
    [colorInput('highColor', 'From high', '#df4646'), colorInput('lowColor', 'From low', '#2faf68')],
    [
      { key: 'fromHigh', label: 'From 52W high', style: 'line', color: '$highColor', width: 1, role: 'primary', legend: { label: 'Off high %', decimals: 2 } },
      { key: 'fromLow', label: 'From 52W low', style: 'line', color: '$lowColor', width: 1, role: 'secondary', legend: { label: 'Above low %', decimals: 2 } },
      { key: 'zero', label: '0', style: 'hlines', levels: [0], color: 'rgba(255,255,255,0.12)', width: 1, lineStyle: 'largeDashed', role: 'context' },
    ]),

  // ── LEVELS & STATISTICS ──────────────────────────────────────────────────
  nativeDef('standardDeviation', 'standardDeviation',
    { name: 'Standard Deviation', shortName: 'StdDev', category: CAT.LEVELS, quickMenu: false, legendParams: ['period'],
      description: 'The rolling standard deviation of the source (population, the same σ Bollinger uses).',
      tags: ['standard deviation', 'stdev', 'std dev', 'sigma', 'dispersion', 'statistics'] },
    autoPane(0.13),
    [SOURCE_INPUT, periodInput('period', 'Period', 20, 2, 500), colorInput('color', 'Color', '#d4a72c')],
    [{ key: 'stdev', label: 'StdDev', style: 'line', color: '$color', width: 1, role: 'primary', legend: { decimals: 2 } }]),

]

// ─── the compute adapter ─────────────────────────────────────────────────────

/**
 * `compute.fn` → a function returning the native's raw output keyed BY COLUMN
 * NAME. Each entry is a translation only: it picks the inputs the native takes,
 * calls it, and re-keys the result. No maths lives here — that would be a second
 * implementation of an indicator, which is the thing the golden fixtures exist
 * to prevent.
 */
/**
 * SMA and EMA over a PLAIN NUMERIC SERIES live in `../movingAverages.js` now
 * (2026-10-01), MOVED VERBATIM with the seven other moving-average types the
 * Technical library added. Every existing SMA/EMA instance computes through the
 * same two functions it always did; `movingAverages.test.js` pins them against a
 * frozen copy of the code that used to sit here.
 */
/** Whether a VWMA may weight this source by the chart's own bar volume: only a
 *  bar field (`close`, `hlc3`, …) or another instance's output on this chart. */
function vwmaSourceAllowed(source) {
  if (source === undefined || source === null || source === '') return true
  if (typeof source !== 'string') return false
  // `@<instanceId>::<plot>` is `sourceRef`'s instance grammar; read here by its
  // mark rather than by importing `sourceRef`, which would close an import cycle.
  return source[0] === '@' || SOURCE_BAR_FIELDS.includes(source)
}

// ─── Tier 1 adapter helpers (2026-10-01) ─────────────────────────────────────
const barsOf = (bars) => (Array.isArray(bars) ? bars : [])
/** numbers (NaN = no value) → the `{value}` points `toColumn` reads. */
const col = (values, bars) => numbersToPoints(values, barsOf(bars).length)
/** The bar volume column, index-aligned with the bars. */
const volumeOf = (bars) => barsOf(bars).map((b) => (b ? Number(b.v) : NaN))
/** The resolved `source` column as plain numbers, bar-length; all NaN when the
 *  source has not resolved (a GAP, never zeros — `movingAverage`'s rule). */
function sourceOf(bars, ctx) {
  const n = barsOf(bars).length
  const src = (ctx && ctx.source && typeof ctx.source.length === 'number') ? ctx.source : null
  const out = new Array(n)
  for (let i = 0; i < n; i++) {
    const v = src && i < src.length ? src[i] : NaN
    out[i] = Number.isFinite(v) ? v : NaN
  }
  return out
}

const NATIVE_COMPUTE = {
  rsi: (bars, p) => ({ rsi: computeRSI(bars, p.period) }),

  macd: (bars, p) => {
    const raw = computeMACD(bars, p.fastPeriod, p.slowPeriod, p.signalPeriod)
    return { macd: raw.macd, signal: raw.signal, histogram: raw.histogram }
  },

  bb: (bars, p) => {
    const raw = computeBB(bars, p.period, p.stdDev)
    return { upper: raw.upper, middle: raw.middle, lower: raw.lower }
  },

  vwap: (bars, p) => {
    // ⛔ THE LINE IS THE SHIPPED `computeVWAP`, UNTOUCHED (still `rev: 2`). The six
    // band columns are EMPTY unless the member turned bands on — an empty column
    // binds no series, so a chart without bands is exactly the chart it was.
    const vwap = computeVWAP(bars)
    const out = { vwap }
    const n = Array.isArray(bars) ? bars.length : 0
    const k = { 1: 1, 2: 2, 3: 3 }[(p && p.bands) || 'off'] || 0
    const sd = k ? computeVWAPDeviation(bars) : null
    for (const m of [1, 2, 3]) {
      const up = new Array(n), dn = new Array(n)
      if (sd && m <= k) {
        for (let i = 0; i < n; i++) {
          const v = vwap[i] ? vwap[i].value : NaN
          if (Number.isFinite(v) && Number.isFinite(sd[i])) {
            up[i] = { value: v + m * sd[i] }
            dn[i] = { value: v - m * sd[i] }
          }
        }
      }
      out[`upper${m}`] = up
      out[`lower${m}`] = dn
    }
    return out
  },

  stoch: (bars, p) => {
    const smooth = Math.max(1, Math.floor(Number(p.smoothK)) || 1)
    // ⛔ smoothing 1 IS THE SHIPPED FAST STOCHASTIC, untouched — same function,
    // same floats — so every saved instance (absent `smoothK` ⇒ 1) is unchanged.
    if (smooth === 1) {
      const raw = computeStochastic(bars, p.kPeriod, p.dPeriod)
      return { k: raw.k, d: raw.d }
    }
    // SLOW: %K = SMA(smoothK) of the fast %K, %D = SMA(dPeriod) of that %K.
    const n = Array.isArray(bars) ? bars.length : 0
    const fast = computeStochastic(bars, p.kPeriod, 1)
    const fastK = Array.from({ length: n }, (_, i) => {
      const v = fast.k && fast.k[i] ? fast.k[i].value : NaN
      return Number.isFinite(v) ? v : NaN
    })
    const k = smaOfSeries(fastK, smooth, n)
    const kNum = Array.from({ length: n }, (_, i) => (k[i] ? k[i].value : NaN))
    return { k, d: smaOfSeries(kNum, p.dPeriod, n) }
  },

  atr: (bars, p) => ({ atr: computeATR(bars, p.period) }),

  // `isUptrend` rides on every SAR point (a preserved quirk — indicators.js
  // docstring §2). Reading only `.value` here is what keeps it out of the
  // columns; a generic "copy the object" adapter would have carried it through.
  //
  // ⭐ AND SINCE PHASE C IT RETURNS THREE COLUMNS, NOT ONE. `priceCrossedSar` and
  // `trendFlipped` are `sar`'s two declared events, and events are columns — the
  // schema now refuses to register a definition whose events name no column, so
  // these two are not optional. They are DERIVED from the same SAR pass (see
  // `computeParabolicSAREvents`), never a second loop, and `isUptrend` still does
  // not reach a column: `trendFlipped` is the flag's CHANGE, which is a number.
  sar: (bars, p) => ({
    sar: computeParabolicSAR(bars, p.step, p.maxStep),
    ...computeParabolicSAREvents(bars, p.step, p.maxStep),
  }),

  ichimoku: (bars, p) => {
    const raw = computeIchimoku(bars, p.tenkanPeriod, p.kijunPeriod, p.senkouBPeriod)
    return {
      tenkan: raw.tenkan, kijun: raw.kijun,
      spanA: raw.spanA, spanB: raw.spanB, chikou: raw.chikou,
    }
  },

  mfi: (bars, p) => ({ mfi: computeMFI(bars, p.period) }),

  cci: (bars, p) => ({ cci: computeCCI(bars, p.period) }),

  williams_r: (bars, p) => ({ williams_r: computeWilliamsR(bars, p.period) }),

  adx: (bars, p) => {
    const raw = computeADX(bars, p.period)
    return { adx: raw.adx, plusDI: raw.plusDI, minusDI: raw.minusDI }
  },

  obv: (bars) => ({ obv: computeOBV(bars) }),

  donchian: (bars, p) => {
    const raw = computeDonchian(bars, p.period)
    return { upper: raw.upper, middle: raw.middle, lower: raw.lower }
  },

  // ── Phase C Task 14 ──
  avwap: (bars, p) => ({ avwap: computeAVWAP(bars, p.anchor) }),

  atrBands: (bars, p) => {
    const raw = computeATRBands(bars, p.period, p.multiplier)
    return { upper: raw.upper, middle: raw.middle, lower: raw.lower }
  },

  // ⛔ THERE IS NO `rsLine` ENTRY, AND ITS ABSENCE IS THE POINT. This adapter's
  // signature is `(bars, inputs)` — ONE series — so a native RS line could only
  // divide the chart's closes by themselves, which is 1.0 on every bar: a flat
  // line that looks exactly like an indicator that is working. `RS_LINE_DEF`
  // below is `compute.kind: 'server'` for that reason (decision A3), and
  // `computeFor` throwing here is what a mutation adding the row would have to
  // silence. See `test_a_single_symbol_rs_line_is_ONE_POINT_ZERO…` in
  // `tests/test_indicator_golden.py` for the number.
  // ⭐⭐ THE PASSTHROUGH, AND IT READS `ctx.source` RATHER THAN `bars`. Every
  // other entry in this table takes the chart's bars and computes something; this
  // one copies the numeric series the binder already resolved from whatever the
  // member pointed the instance at — a bar field, another indicator's output, or
  // another symbol's close. That is what makes it source-blind.
  //
  // ⛔ NO SOURCE → AN ALL-EMPTY COLUMN, NEVER AN EXCEPTION AND NEVER ZEROS. A
  // series whose source has not resolved yet is a GAP, and `toColumn` turns a
  // hole into NaN, which is what the renderer and the warm-up rules already
  // understand. Emitting 0 would draw a flat line at zero and look like data.
  //
  // ⚠️ `Number.isFinite` GATES EVERY VALUE for the same reason: a NaN in the
  // source is a gap in the output, not a number.
  movingAverage: (bars, p, ctx) => {
    const n = Array.isArray(bars) ? bars.length : 0
    // ⛔⛔ NOT `Array.isArray`. A resolved column is a **Float64Array** — `toColumn`
    // has always built one — and `Array.isArray(new Float64Array(3))` is FALSE.
    // The first live run had a perfectly good RSI source of 10,203 values and
    // returned an all-NaN column, silently: no error, no warning, just an MA that
    // never bound because `hasAnyFinite` said no. Indexable-with-a-length is the
    // honest test, and it accepts a plain array too.
    const src = (ctx && ctx.source && typeof ctx.source.length === 'number') ? ctx.source : null
    if (!src) return { ma: new Array(n) }
    // ⛔ SMA AND EMA TAKE THEIR SHIPPED PATHS UNCHANGED — every saved average.
    if (p.maType === 'ema') return { ma: emaOfSeries(src, p.period, n) }
    if (!p.maType || p.maType === 'sma') return { ma: smaOfSeries(src, p.period, n) }
    const values = Array.from({ length: n }, (_, i) => (i < src.length ? src[i] : NaN))
    // ⛔ VWMA WEIGHTS BY **THIS CHART'S** VOLUME, so it is only offered a source
    // that lives on this chart's bars: a bar field or another instance's output.
    // A foreign symbol (`sym:QQQ`), a fundamental or an economic series has no
    // bar-aligned volume of its own, and weighting it by the chart symbol's
    // volume would draw a plausible line that means nothing — so it draws none.
    if (p.maType === 'vwma' && !vwmaSourceAllowed(p.source)) return { ma: new Array(n) }
    const vol = p.maType === 'vwma' ? bars.map((b) => (b ? Number(b.v) : NaN)) : null
    return { ma: numbersToPoints(maSeries(p.maType, values, p.period, vol), n) }
  },

  // ⛔ THE BARS' OWN TWO FIELDS, MULTIPLIED — no window, no smoothing, no
  // parameter. A bar with either field missing produces NO point rather than a
  // zero: `toColumn` leaves it NaN, the binder draws no bar there, and a gap in
  // the data reads as a gap instead of as a day nothing traded.
  dollarVolume: (bars) => {
    const n = Array.isArray(bars) ? bars.length : 0
    const out = new Array(n)
    for (let i = 0; i < n; i++) {
      const b = bars[i]
      const v = b ? Number(b.v) : NaN
      const c = b ? Number(b.c) : NaN
      if (Number.isFinite(v) && Number.isFinite(c)) out[i] = { value: v * c }
    }
    return { dv: out }
  },

  dataSeries: (bars, p, ctx) => {
    const n = Array.isArray(bars) ? bars.length : 0
    const src = (ctx && ctx.source && typeof ctx.source.length === 'number') ? ctx.source : null
    if (!src) return { value: new Array(n) }
    const out = new Array(n)
    const m = Math.min(src.length, n)
    for (let i = 0; i < m; i++) {
      const v = src[i]
      if (Number.isFinite(v)) out[i] = { value: v }
    }
    return { value: out }
  },

  // ═══ THE TECHNICAL LIBRARY — TIER 1 (2026-10-01) ═══════════════════════════
  // Translations only — the maths is in `../technicalStudies.js`. `col` turns a
  // number array (NaN = no value) into the `{value}` points `toColumn` reads.
  superTrend: (bars, p) => {
    const r = S.superTrend(barsOf(bars), p.atrPeriod, p.multiplier)
    return { up: col(r.up, bars), down: col(r.down, bars) }
  },
  aroon: (bars, p) => {
    const r = S.aroon(barsOf(bars), p.period)
    return { up: col(r.up, bars), down: col(r.down, bars) }
  },
  vortex: (bars, p) => {
    const r = S.vortex(barsOf(bars), p.period)
    return { plus: col(r.plus, bars), minus: col(r.minus, bars) }
  },
  choppiness: (bars, p) => ({ chop: col(S.choppiness(barsOf(bars), p.period), bars) }),
  stochRsi: (bars, p, ctx) => {
    const r = S.stochRsi(sourceOf(bars, ctx), p.rsiPeriod, p.stochPeriod, p.kSmooth, p.dSmooth)
    return { k: col(r.k, bars), d: col(r.d, bars) }
  },
  ppo: (bars, p, ctx) => {
    const r = S.ppo(sourceOf(bars, ctx), p.fastPeriod, p.slowPeriod, p.signalPeriod)
    return { ppo: col(r.line, bars), signal: col(r.signal, bars), histogram: col(r.histogram, bars) }
  },
  roc: (bars, p, ctx) => ({ roc: col(S.rateOfChange(sourceOf(bars, ctx), p.period), bars) }),
  momentum: (bars, p, ctx) => ({ mom: col(S.momentum(sourceOf(bars, ctx), p.period), bars) }),
  tsi: (bars, p, ctx) => {
    const r = S.tsi(sourceOf(bars, ctx), p.longPeriod, p.shortPeriod, p.signalPeriod)
    return { tsi: col(r.line, bars), signal: col(r.signal, bars) }
  },
  cmo: (bars, p, ctx) => ({ cmo: col(S.cmo(sourceOf(bars, ctx), p.period), bars) }),
  trix: (bars, p, ctx) => {
    const r = S.trix(sourceOf(bars, ctx), p.period, p.signalPeriod)
    return { trix: col(r.line, bars), signal: col(r.signal, bars) }
  },
  awesome: (bars, p) => {
    const r = S.awesome(barsOf(bars), p.fastPeriod, p.slowPeriod)
    // `rising` is the colour column: 1 where the bar is not below the last one.
    const rising = r.ao.map((v, i) => (Number.isFinite(v) ? (Number.isFinite(r.falling[i]) ? 0 : 1) : NaN))
    return { ao: col(r.ao, bars), rising: col(rising, bars) }
  },
  ultimate: (bars, p) => ({ uo: col(S.ultimate(barsOf(bars), p.fastPeriod, p.midPeriod, p.slowPeriod), bars) }),
  balanceOfPower: (bars, p) => ({ bop: col(S.balanceOfPower(barsOf(bars), p.smoothing), bars) }),
  bullBearPower: (bars, p) => {
    const r = S.bullBearPower(barsOf(bars), p.period)
    return { bull: col(r.bull, bars), bear: col(r.bear, bars) }
  },
  keltner: (bars, p) => {
    const r = S.keltner(barsOf(bars), p.period, p.multiplier, p.atrPeriod)
    return { upper: col(r.upper, bars), middle: col(r.middle, bars), lower: col(r.lower, bars) }
  },
  envelope: (bars, p, ctx) => {
    if (p.maType === 'vwma' && !vwmaSourceAllowed(p.source)) return { upper: [], middle: [], lower: [] }
    const r = S.envelope(sourceOf(bars, ctx), p.period, p.percent, p.maType, volumeOf(bars))
    return { upper: col(r.upper, bars), middle: col(r.middle, bars), lower: col(r.lower, bars) }
  },
  bbPercentB: (bars, p) => ({ percentB: col(S.bollingerDerived(barsOf(bars), p.period, p.stdDev).percentB, bars) }),
  bbWidth: (bars, p) => ({ bandwidth: col(S.bollingerDerived(barsOf(bars), p.period, p.stdDev).bandwidth, bars) }),
  atrPercent: (bars, p) => ({ atrPct: col(S.atrPercent(barsOf(bars), p.period), bars) }),
  adrPercent: (bars, p) => ({ adrPct: col(S.adrPercent(barsOf(bars), p.period), bars) }),
  // Annualised from the bars' own spacing (`periodsPerYearOf`), never from a ctx.
  historicalVolatility: (bars, p) => ({ hv: col(S.historicalVolatility(barsOf(bars), p.period), bars) }),
  squeeze: (bars, p) => {
    const r = S.squeeze(barsOf(bars), p.period, p.bbMult, p.kcMult)
    const state = r.on.map((v) => (Number.isFinite(v) ? 0 : NaN))
    return { momentum: col(r.histogram, bars), state: col(state, bars), on: col(r.on, bars) }
  },
  relativeVolume: (bars, p) => ({ rvol: col(S.relativeVolume(barsOf(bars), p.period), bars) }),
  accumDist: (bars) => ({ ad: col(S.accumulationDistribution(barsOf(bars)), bars) }),
  chaikinMoneyFlow: (bars, p) => ({ cmf: col(S.chaikinMoneyFlow(barsOf(bars), p.period), bars) }),
  chaikinOscillator: (bars, p) => ({ osc: col(S.chaikinOscillator(barsOf(bars), p.fastPeriod, p.slowPeriod), bars) }),
  forceIndex: (bars, p) => ({ efi: col(S.forceIndex(barsOf(bars), p.period), bars) }),
  pvt: (bars) => ({ pvt: col(S.priceVolumeTrend(barsOf(bars)), bars) }),
  upDownVolume: (bars, p) => ({ ratio: col(S.upDownVolumeRatio(barsOf(bars), p.period), bars) }),
  percentFromMa: (bars, p, ctx) => {
    if (p.maType === 'vwma' && !vwmaSourceAllowed(p.source)) return { pct: [] }
    return { pct: col(S.percentFromMa(sourceOf(bars, ctx), p.period, p.maType, volumeOf(bars)), bars) }
  },
  fiftyTwoWeek: (bars) => {
    const r = S.fiftyTwoWeek(barsOf(bars), 52)
    return { fromHigh: col(r.fromHigh, bars), fromLow: col(r.fromLow, bars) }
  },
  standardDeviation: (bars, p, ctx) => ({ stdev: col(S.standardDeviation(sourceOf(bars, ctx), p.period), bars) }),

}

/**
 * `[{time, value}]` (or `[]`) → an input-length NaN-padded Float64Array.
 *
 * The `[]` case is the unification `_schema.md` assigns to B2: a too-short
 * series returns an empty array from `indicators.js`, which was the renderer's
 * "no pane" signal. It becomes an all-NaN column here, and `hasAnyFinite` is
 * the signal instead.
 */
function toColumn(points, length) {
  const col = new Float64Array(length)
  col.fill(NaN)
  if (!points) return col
  const n = Math.min(points.length, length)
  for (let i = 0; i < n; i++) {
    const v = points[i] ? points[i].value : undefined
    if (Number.isFinite(v)) col[i] = v
  }
  return col
}

/**
 * ✅ DECIDED 2026-08-02 — the owner dropped the mask. `false` is the shipped look.
 *
 * `false` (TODAY) = the mathematically correct line, drawn from bar `slowPeriod-1`
 *           — **8 bars earlier** at the default 12/26/9 — matching the Python lane
 *           (`api/services/indicator_compute.compute_macd_raw`) and the shared
 *           golden fixture `tests/fixtures/indicators/macd_default.json` exactly.
 * `true`  (HISTORY) = the pre-2026-08-02 look. The MACD line started on the same
 *           bar as its signal, hiding 8 bars of a line it had already computed.
 *
 * **Measured cost of the flip: 88 changed pixels (0.011828%)** on `macd_headmask`,
 * 20/20 runs, builds `9f566cd22874` (mask on) vs `9045bb69fc56` (mask off) — one
 * contiguous 44×4 px region at `x ∈ [136,179]`, `y ∈ [394,397]`. Re-measured at
 * the flip itself and confirmed. Record: `docs/decisions/2026-08-02-macd-head-mask.md`.
 *
 * ⭐ ONE CONSTANT, ONE READER — AND THIS PARAGRAPH USED TO CLAIM TWO.
 *
 * It read *"BOTH lanes still read it: the engine's `COLUMN_HOLDS` below, and —
 * because `macd` is not migrated — the legacy `indicatorData` memo in
 * `StockChart.jsx`, which is what a user actually sees."* **`macd` was migrated
 * AND flipped at B3 Task 11 (`400005ee`)**, which deleted that memo branch with
 * the rest of the block — that commit's own message says the mask "drops from two
 * readers to one", and this comment did not move. So the sentence stayed green
 * while its stated REASON went false, and it named the wrong lane as the one a
 * user sees. See `StockChart.jsx:4144-4146`, which records the deletion in place.
 *
 * `COLUMN_HOLDS` below is now the ONLY consumer, and it is `{}` while
 * `MACD_HEAD_MASK` is false. Kept, not deleted: reversal is one edit, and it is
 * priced at the same 88 px (`docs/decisions/2026-08-02-macd-head-mask.md`).
 * Turning it back on is a VISIBLE change at the very start of history on every
 * MACD chart, so it would need the same treatment the drop got:
 *
 *     python tools/chart_parity.py --base-a $MASK_OFF --base-b $MASK_ON --cases macd_headmask --repeat 20
 *
 * ⚠️ The constant is KEPT rather than deleted so `macd_headmask` still measures
 * something: post-flip it prices the same distance in the other direction, and a
 * **0** from it means a future edit stopped one of the two lanes reading this
 * switch. See the adjudication row in the indicator-platform spec §11.
 */
export const MACD_HEAD_MASK = false

/**
 * ⚠️ THE MACD HEAD-MASK — DORMANT since 2026-08-02. `MACD_HEAD_MASK` is `false`,
 * so `COLUMN_HOLDS` is `{}` and this function is not applied to anything.
 *
 * It is kept, not deleted, because the decision it implements is reversible in
 * ONE edit (`MACD_HEAD_MASK = true`) and `macd_headmask` still exists to price
 * that edit. Deleting it would make re-instating the old look a rewrite instead
 * of a flag flip, and would leave the parity case measuring a shape nothing in
 * the tree can produce.
 *
 * What it does when it IS on: `computeMACD` emits the MACD line from bar
 * `slowPeriod-1`, which is `signalPeriod-1` bars EARLIER than the signal line —
 * mathematically right, and what the Python lane has always done (the golden
 * fixtures caught the two disagreeing on 8 bars of a default 12/26/9). Until
 * 2026-08-02 this chart started the line together with its signal, so the head
 * was masked back to the signal's first bar.
 *
 * ⚠️ THIS FUNCTION IS NOT THE SWITCH. `MACD_HEAD_MASK` above is. Editing the
 * body here would change the mask WITHOUT the flag saying so — `nativeRegistry.test.js`
 * and `__tests__/macdHeadMaskRendered.test.jsx` both go red if it happens.
 */
function maskMacdHead(columns) {
  const { macd, signal } = columns
  if (!macd || !signal) return columns
  let sigStart = -1
  for (let i = 0; i < signal.length; i++) {
    if (Number.isFinite(signal[i])) { sigStart = i; break }
  }
  if (sigStart <= 0) return columns          // no signal at all, or it starts at bar 0
  for (let i = 0; i < sigStart && i < macd.length; i++) macd[i] = NaN
  return columns
}

/**
 * Per-`compute.fn` post-processing that is a RENDER hold rather than maths.
 *
 * Derived from `MACD_HEAD_MASK`, not written out, so that flipping the decision
 * is ONE edit and the holds table cannot drift away from the flag that documents
 * it. The flag is OFF as of 2026-08-02, so **this table is empty**: there is no
 * hold at all and the `macd` column is the Python lane's column, element for
 * element. §9.1's render-boundary exception is closed.
 */
const COLUMN_HOLDS = MACD_HEAD_MASK ? { macd: maskMacdHead } : {}

/**
 * The ONE data-bearing plot key an `ast` definition declares.
 *
 * ⛔ READ OFF `def.plots`, NOT `columnKeys(def)`, AND THE DIFFERENCE IS LOAD-
 * BEARING. `columnKeys` is the union of plots and EVENTS. If this read that
 * union, an `ast` definition that declared an event would compute its event key
 * instead of its plot — a column with the wrong name, full of the right numbers.
 * Reading the plots means an `ast` definition's events simply never come back,
 * and `validateEventColumns` — which already refuses a definition whose event
 * names no returned column — refuses it BY NAME at registration. One guard, at
 * the door it was built for, rather than a second one bolted on here.
 */
function astPlotKey(def) {
  const plots = Array.isArray(def?.plots) ? def.plots : []
  const keys = plots
    .filter(p => p && p.style !== 'hlines' && typeof p.key === 'string')
    .map(p => p.key)
  return keys
}

/**
 * The definition's tree MAP, or `null` for the single-tree (pre-W1b) shape.
 *
 * ⛔ ONE PREDICATE, TWO CALLERS, ON PURPOSE. `astColumnsFor` and
 * `validateAstLane` both branch on "does this document carry trees", and they
 * must branch identically or a document could validate down one shape and
 * compute down the other — the second-authority-over-one-value defect this repo
 * names most often. Anything that is not a plain object is `null` here and takes
 * the single-tree path in BOTH; `defSchema.validateTrees` is what refuses the
 * malformed map by name, and it runs first.
 */
function astTrees(def) {
  const trees = def && def.compute && def.compute.trees
  return (trees && typeof trees === 'object' && !Array.isArray(trees)) ? trees : null
}

/**
 * Compute an `ast` definition: ONE TREE, ONE COLUMN — as many of each as the
 * document declares.
 *
 * `interpret` returns a single `Float64Array` of `bars.length` — the columnar
 * contract already, with no adaptation to do — so the only question this
 * function answers is WHICH KEY each one goes under.
 *
 * ⭐ TWO SHAPES, ONE RULE (W1b). A document carrying `compute.trees` names a
 * tree PER PLOT and gets a column per plot. A document without one carries a
 * single tree in `compute.ast` and must declare exactly one data plot —
 * `validateUserDefinitions` refuses a second, and the throw below is the
 * backstop for a definition that reached `computeFor` without passing through
 * that door. The second shape is every definition saved before W1b, and it
 * computes byte-identically to the way it did then.
 *
 * ⛔ IT DOES NOT CATCH. `interpret` throws `TableRefusal` for anything the table
 * refuses and a plain `RangeError` for a tree that overflows; relabelling either
 * as "computed nothing" is the wrong-door defect this phase has now found four
 * times. A refusal must reach the caller as the refusal it is.
 */
/** The key every partial-compute result carries its reasons under.
 *  ⛔ NON-ENUMERABLE, AND THAT IS THE WHOLE DESIGN. Every consumer of a column
 *  map walks it with `Object.keys` (the binder's `for (const plotKey of
 *  Object.keys(cols))` is the one that matters), and a visible extra key would
 *  become a phantom plot on every chart. */
const COLUMN_ERRORS = '__columnErrors'

/** Attach the per-column reasons to a column map without widening its key set. */
function withColumnErrors(out, errors) {
  if (errors && Object.keys(errors).length) {
    Object.defineProperty(out, COLUMN_ERRORS, { value: Object.freeze(errors), enumerable: false })
  }
  return out
}

/**
 * ⭐⭐ WHY A COLUMN IS MISSING — the structured state C2A.8 asks be preserved.
 *
 * A column map returned by `computeFor` holds only the columns that COMPUTED.
 * This is how a caller learns that a key is absent because it exceeded a limit
 * rather than because the definition never declared it — which are different
 * facts and, without this, indistinguishable.
 *
 * ⛔ IT IS NOT UX. No surface renders it yet, deliberately (C2A.8: "do not build
 * broad new UX in this wave"). It exists so that the day one does, the product
 * can say WHICH output and WHICH limit instead of re-deriving a guess — and so
 * that "the indicator drew nothing" and "one of its seven columns is too
 * expensive" stop being the same observation.
 *
 * @returns {Record<string, {guard: string, message: string}>} possibly empty
 */
export function columnErrors(columns) {
  const e = columns && columns[COLUMN_ERRORS]
  return e || {}
}

// ─── ⭐⭐ RT4 — A RUNTIME DOCUMENT'S DRAWINGS GO WITH ITS RUN ─────────────────────
//
// A runtime-lane document (`memberPaneDefinition.js::runtimeLaneDefinition`)
// draws its lines from its own per-bar run and carries the HOST lane's object
// program beside them. The object reader evaluates that program on its own, so
// on a chart where the run computed NOTHING — refused at its listing check
// (`runtime:history-start`), its time budget, a request, a reached
// `runtime.error`, or a run still in flight — the drawings were drawn alone.
// Measured (RT2, harness dir, runtime flag on): `vw-int-array-avg` and its `-neg`
// probe drew labels 25 vendor vs 1 ours from a document whose every line was
// withheld — a wrong drawing on a pane that otherwise said "nothing is drawn".
// Integrator ruling (RT4): such a document does not draw its object program.

/** The guard a runtime document's withheld drawings carry. */
export const RUNTIME_OBJECTS_GUARD = 'runtime:objects-without-run'

/**
 * Why a runtime document's object program is NOT drawn over these columns, or
 * `null` when it may be (any other document, a runtime document with no object
 * program, or a run that produced at least one of its columns).
 *
 * @param {object} def the installed definition
 * @param {object|null|undefined} cols what `computeFor` answered for it on THIS
 *   chart (`undefined`/`null`: nothing was computed)
 * @returns {{guard: string, message: string} | null}
 */
export function runtimeObjectsWithheld(def, cols) {
  if (!def || !def.compute || def.compute.kind !== 'runtime') return null
  if (!def.objects || !Array.isArray(def.objects.ops) || !def.objects.ops.length) return null
  const keys = Object.keys(def.compute.outputs || {})
  if (cols && keys.some((k) => cols[k] && typeof cols[k].length === 'number')) return null
  const first = Object.values(columnErrors(cols))[0]
  const why = first
    ? `its run computed nothing on this chart (${first.guard})`
    : 'its run has not computed on this chart'
  return {
    guard: RUNTIME_OBJECTS_GUARD,
    message: `This script's drawings are not drawn: ${why}, and its drawings belong to that run — `
      + 'drawn alone they would be a picture TradingView does not draw. Nothing is drawn rather than a guess.',
  }
}

// ─── ⭐⭐ RF — A RUNTIME PANE THAT DREW NOTHING SAYS WHY ───────────────────────
//
// `columnErrors` is "not UX" (C2A.8) and no surface rendered it, so a runtime
// document whose run was refused on this chart — `runtime:history-start` (every
// chart that does not start at the listing: every intraday chart, most daily
// ones), the time budget, a VM limit, a failed worker — drew an EMPTY pane with
// no sentence. Measured before RF: the six runtime-only corpus scripts are all
// fallback documents, so on an intraday chart every one was a silent blank. The
// script's own `runtime.error` already had its sentence (C43); this is the same
// strip, for every other stop of the run.

/**
 * The sentence for a runtime document whose run produced NONE of its columns on
 * this chart, or `null` (any other document; a run that drew; a run in flight;
 * the script's own `runtime.error`, which C43's stop words).
 *
 * @param {object} def the installed definition
 * @param {object|null|undefined} cols what `computeFor` answered for it
 * @returns {{guard: string, sentence: string} | null}
 */
export function runtimeRunStopOf(def, cols) {
  if (!def || !def.compute || def.compute.kind !== 'runtime' || !cols) return null
  const keys = Object.keys(def.compute.outputs || {})
  if (keys.some((k) => cols[k] && typeof cols[k].length === 'number')) return null
  if (runtimeErrorStopOf(cols)) return null
  const first = Object.values(columnErrors(cols))[0]
  if (!first || !first.guard) return null
  const why = String(first.message || '').trim()
  return {
    guard: first.guard,
    sentence: `not drawn on this chart (${first.guard}): ${why || 'the per-bar run computed nothing'}`,
  }
}

// ─── ⭐⭐ C43 — A REACHED `runtime.error` LEAVES NO COLUMN ────────────────────────
//
// TradingView's study holds NOTHING once the script's own `runtime.error` is
// reached on any bar (measured — see `runtimeErrorStop.js`). The evaluator is
// REGISTERED here by that module rather than imported: it reads the object
// lane's warm-up probe, and this module must not pull the object lane into its
// chunk. Unregistered (a caller that computes columns without the object lane
// loaded), every document computes as it always did.
let runtimeErrorStopFn = null
export function registerRuntimeErrorStop(fn) {
  runtimeErrorStopFn = typeof fn === 'function' ? fn : null
}

/** The guard a column refused by the script's own error carries. */
export const RUNTIME_ERROR_GUARD = 'pine:runtime.error'

/** The key a column map carries the stop decision under — non-enumerable for the
 *  reason `__columnErrors` is (a visible key is a phantom plot). */
const RUNTIME_ERROR_STOP = '__runtimeErrorStop'

/** What the script's `runtime.error` calls did on the bars a column map was
 *  computed over: `{reached, bar, sentence, unknown, unread, …}`, or null for a
 *  document that carries none. `unknown` names each call this binding could not
 *  evaluate — the columns are then the unstopped ones, as before C43. */
export function runtimeErrorStopOf(columns) {
  return (columns && columns[RUNTIME_ERROR_STOP]) || null
}

function withRuntimeErrorStop(out, stop) {
  if (stop) Object.defineProperty(out, RUNTIME_ERROR_STOP, { value: stop, enumerable: false })
  return out
}

function astColumnsFor(def, bars, inputs, ctx) {
  const stop = runtimeErrorStopFn && def && def.meta && def.meta.runtimeErrors
    ? runtimeErrorStopFn(def, bars, inputs, ctx)
    : null
  if (stop && stop.reached) {
    // ⛔ EVERY COLUMN, AND BY NAME: an absent column with no reason reads as "the
    // definition never declared it" (`columnErrors`).
    const errors = {}
    for (const key of astPlotKey(def)) errors[key] = { guard: RUNTIME_ERROR_GUARD, message: stop.sentence }
    return withRuntimeErrorStop(withColumnErrors({}, errors), stop)
  }
  const out = astColumnsUnstopped(def, bars, inputs, ctx)
  return stop ? withRuntimeErrorStop(out, stop) : out
}

function astColumnsUnstopped(def, bars, inputs, ctx) {
  const keys = astPlotKey(def)
  const trees = astTrees(def)
  // ⭐⭐ C29 — a document folded at another chart period does not answer here
  // (`periodReads.js`): every column is refused by name, none drawn off the
  // other period's constants.
  const periodWhy = new Map()
  for (const k of keys) {
    const why = periodReadsRefusalFor(def, k, ctx && ctx.tf)
    if (why) periodWhy.set(k, why)
  }
  if (periodWhy.size && (!trees || periodWhy.size === keys.length)) {
    const errors = {}
    for (const key of keys) errors[key] = { guard: PERIOD_READS_GUARD, message: periodWhy.get(key) || [...periodWhy.values()][0] }
    return withColumnErrors({}, errors)
  }
  // ⭐⭐ THE BIND STAGE. One symbolic definition, folded per (symbol, timeframe)
  // into the integers THIS binding needs. `Uncharted Volume` line 233's
  // `timeframe.isweekly ? 5 : 20` becomes 5 on a weekly binding and 20 on a
  // daily one — measured against the vendor on 2026-09-10 (job B: `fold==sma20`
  // on 400/400 daily bars, `fold==sma5` on 400/400 weekly).
  // ⛔ COMPUTE-SCOPED AND DISCARDED. `foldBound` returns a NEW tree and mutates
  // nothing, and `bound` is a local — the SAVED definition stays symbolic, which
  // is the only thing that keeps the next binding free to fold it differently.
  // ⛔ AN UNFOLDABLE LENGTH IS LEFT EXACTLY AS IT WAS, never guessed: the window
  // check downstream then refuses the member's own expression, naming the field
  // that stopped it. An unknown timeframe folds NOTHING — `timeframeFlags`
  // returns null rather than a default, because a guessed `isdaily` is a
  // confident wrong length.
  const bindConsts = bindConstsFor({ tf: ctx && ctx.tf, inputs, symbol: ctx && ctx.symbol })
  const bound = (tree) => foldBound(tree, bindConsts)
  // ⭐⭐ C26 — which other symbols this binding may read, decided ONCE for every
  // tree of the document (`otherSymbolsFor`).
  const other = otherSymbolsFor(def, ctx)
  // ⭐⭐ C41 — which lower-timeframe codes this binding may read, decided ONCE for
  // every tree of the document (`lowerTfFor`). Null for a document that reads none.
  const lower = lowerTfFor(def, ctx)
  // ⭐⭐ W1b — MANY TREES, ONE COLUMN EACH. `interpret` runs once PER PLOT and the
  // result is keyed by the plot, which is the whole of the multi-plot lane: the
  // MACD's three lines are three trees, not one column reshaped. The single-tree
  // path below is untouched, so a document saved before today computes the same
  // bytes through the same call.
  //
  // ⛔ A PLOT WITH NO TREE IS REFUSED BY THE PLOT'S NAME, NOT LEFT TO
  // `interpret`. `defSchema.validateTreesAgainstPlots` already refuses the
  // key-set disagreement in both directions, so a definition that walked through
  // `validateUserDefinitions` cannot arrive here short a tree — but `computeFor`
  // takes a definition object from ANY caller (which is the reason the
  // "computes ONE column" throw below has always existed), and handing
  // `interpret` an `undefined` tree would surface as a parse-shaped error about
  // a node, blaming the formula for a document defect.
  if (trees) {
    const out = {}
    const errors = {}
    // ⭐⭐ C2C.11 — ONE MEMO FOR THE WHOLE DOCUMENT'S COLUMNS, CREATED HERE AND
    // DROPPED HERE. A multi-plot import computes one consensus expression and
    // plots several views of it (C2A: 77-84% of a real document's counted nodes
    // are repeated subtrees), and until now every view paid for the whole thing
    // again because `interpret`'s own memo is scoped to one tree.
    //
    // ⛔ ITS LIFETIME IS THIS CALL. The columns it holds were computed against
    // THESE bars and THESE inputs; a memo that outlived the pass would serve
    // stale numbers with nothing red anywhere. It is a local, never a module
    // cache, and it is not keyed — so there is nothing to invalidate and no way
    // to forget to.
    //
    // ⚠️ IT ONLY PAYS WHEN THE TREES ACTUALLY SHARE NODES, which is what a
    // document stored as a shared graph gives (its expansion materialises each
    // distinct node once). On an inlined document every lookup misses and the
    // cost is one Map probe per self-free node.
    const crossMemo = new Map()
    // ⭐ C36 — why a plot's `time(<timeframe>)` is withheld on this chart, per plot.
    const clock = {}
    // ⭐ F5 — per plot, the bars a recursive series' seed withholds (`seedWarmupMask`).
    const seed = {}
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(trees, key)) {
        throw new Error(
          `computeFor: plot ${JSON.stringify(key)} of ${JSON.stringify(def?.id)} has no tree in ` +
          `compute.trees (${Object.keys(trees).join(', ') || 'none'}) — a plot with no tree is a key ` +
          `nothing ever fills.`,
        )
      }
      // ⚠️ SAME ARGUMENTS AS THE SINGLE-TREE CALL BELOW, INCLUDING `ctx.tf` AND
      // THE `undefined` SCALARS — see that call's comments. One budget covers
      // every tree because the budget is the DOCUMENT's (`compute.budget`), and
      // a map over `interpret` that dropped it would run every plot uncapped.
      //
      // ⛔⛔ ONE COLUMN'S FAILURE IS ONE COLUMN'S FAILURE (C2A).
      //
      // ⚰️ MEASURED ON A REAL SCRIPT. `mid_engagement__14-master-line-lite`
      // declares 7 columns. Three of them — Consensus and the two bands —
      // compute cleanly at the 5,000 bars a chart loads (4,945 finite values
      // each, 6-20 ms). The other four are `accum` recurrences whose
      // `bars × warmup` exceeds `MAX_RECURRENCE_STEPS`, and they refuse.
      //
      // This loop had no `try`. The fourth tree threw, the loop unwound,
      // `computeFor` threw, and the binder's `attempt(...)` caught it and
      // `continue`d PAST THE WHOLE INSTANCE — so all seven plots drew nothing.
      // Measured through this very function: OK at 1, 2 and 3 columns; throws
      // from the 4th on. Three good columns were erased by a fourth.
      //
      // ⛔ THE BUDGET WAS NEVER SHARED. Each `interpret` call is capped on its
      // own tree; nothing accumulates across siblings. The loss was CONTAINMENT,
      // and the two are worth telling apart: a shared budget would mean the
      // document is too big, and it is not — one column of it is.
      //
      // ⛔ A FAILED COLUMN IS ABSENT, NOT ALL-NaN. `hasAnyFinite` already reads
      // an absent key as "no data" and gives the plot no series, so absence
      // needs no new handling anywhere; a 5,000-long NaN array per failed column
      // would allocate for nothing and read as a column that computed.
      // The REASON is preserved instead — see `columnErrors`.
      // ⭐ C29 — only the plots that folded the other period's value are refused.
      if (periodWhy.has(key)) {
        errors[key] = { guard: PERIOD_READS_GUARD, message: periodWhy.get(key) }
        continue
      }
      try {
        out[key] = interpret(bound(trees[key]), bars, inputs, def.compute.budget,
          // ⛔ `newestBarIsForming` IS READ THE SAME WAY `tf` IS, and fails closed
          // the same way. `ctx` absent -> `null` -> UNKNOWN -> the four
          // CLOCK_REALTIME columns blank. `false` would assert SETTLED.
          undefined, { tf: ctx && ctx.tf,
            newestBarIsForming: (ctx && ctx.newestBarIsForming) ?? null,
            ...listingOptsFor(def, ctx),
            ...(barIndexAbsoluteFor(def, ctx) ? { barIndexAbsolute: true } : {}),
            ...(other ? { symbols: other.symbols } : {}),
            ...(lower ? { lowerTf: lower.supply } : {}), crossMemo,
            chartClockSink: (clock[key] = new Map()), seedWarmupSink: (seed[key] = {}) })
      } catch (err) {
        // ⛔ A CRASH IS NOT A REFUSAL. `|| 'compute:error'` gave EVERY
        // exception a guard name, so a TypeError inside a walker was
        // indistinguishable from the table declining to compute a column.
        errors[key] = isRefusal(err)
          ? { guard: err.guard, message: String(err.message) }
          : { status: ENGINE_ERROR, engineError: (err && err.name) || 'Error',
            message: String((err && err.message) || err) }
        continue
      }
      // ⭐⭐ C48 — a plot that reads a call in a block that may not run on every
      // bar (`blockRuns.js`): its guard is computed over THESE bars, and where
      // the block runs after a bar it skipped the plot is refused by name —
      // never drawn off the every-bar number. Same budget, same options, same
      // memo as the plot's own tree (the guard is a subtree of it).
      // ⛔ AFTER the plot's own tree, never before it: a plot that cannot be
      // computed at all keeps ITS reason (`interpret:bind-time-text` on a chart
      // whose symbol is not resolved, `symbolThread.test.js`) — the guard is a
      // subtree of that tree, and asked first it failed the same way and the
      // member was told about blocks instead of about the symbol.
      const runsWhy = blockRunsRefusal(def, key, (tree) => interpret(bound(tree), bars, inputs, def.compute.budget,
        undefined, { tf: ctx && ctx.tf,
          newestBarIsForming: (ctx && ctx.newestBarIsForming) ?? null,
          ...listingOptsFor(def, ctx),
          ...(other ? { symbols: other.symbols } : {}), crossMemo,
          chartClockSink: new Map() }))
      if (runsWhy) {
        delete out[key]
        delete clock[key]
        delete seed[key]
        errors[key] = { guard: BLOCK_RUNS_GUARD, message: runsWhy }
      }
    }
    seedColourOntoValue(def, out, seed)
    return withSeedWarmup(withLowerTf(withChartClock(withOtherSymbols(withColumnErrors(out, errors), other), clock), lower), seed)
  }
  if (keys.length !== 1) {
    throw new Error(
      `computeFor: an "ast" definition computes ONE column and definition ` +
      `${JSON.stringify(def?.id)} declares ${keys.length} data-bearing plots ` +
      `(${keys.join(', ') || 'none'}). One formula is one series; a second plot would be a ` +
      `key nothing ever fills.`,
    )
  }
  // ⭐ `ctx.tf` IS THREADED (closed table v2). `computeFor` has had the timeframe
  // all along and dropped it here, which was harmless while the table held
  // nothing that needed one. It now holds four: `isintraday`, `isdaily`,
  // `isweekly` and `ismonthly` are answerable ONLY from what the caller knows,
  // and `interpret` fails them CLOSED (not-computable) when nobody says. So the
  // cost of not passing it is not a crash — it is a member's session filter that
  // silently never fires, which is the quietest failure this lane has.
  //
  // ⚠️ `undefined` FOR BUDGET'S NEIGHBOURS, NOT `{}`. `scalars` is genuinely
  // absent on the chart lane (a chart draws one symbol's bars; the scalar map is
  // the scan lane's), and spelling it `{}` would turn "no scalars were offered"
  // into "an empty scalar map was", which seeds every declared scalar NaN by a
  // different route and reads identically at the call site.
  const clock = { [keys[0]]: new Map() }
  const seed = { [keys[0]]: {} }
  const sole = interpret(bound(def.compute.ast), bars, inputs, def.compute.budget,
    undefined, { tf: ctx && ctx.tf,
      newestBarIsForming: (ctx && ctx.newestBarIsForming) ?? null,
      ...listingOptsFor(def, ctx),
      ...(barIndexAbsoluteFor(def, ctx) ? { barIndexAbsolute: true } : {}),
      ...(other ? { symbols: other.symbols } : {}),
      ...(lower ? { lowerTf: lower.supply } : {}),
      chartClockSink: clock[keys[0]], seedWarmupSink: seed[keys[0]] })
  // ⭐ C48 — the single-tree document's own block-run check (`blockRuns.js`),
  // AFTER its tree computed (a tree that cannot keeps its own reason, above).
  const soleRunsWhy = blockRunsRefusal(def, keys[0], (tree) => interpret(bound(tree), bars, inputs, def.compute.budget,
    undefined, { tf: ctx && ctx.tf,
      newestBarIsForming: (ctx && ctx.newestBarIsForming) ?? null,
      ...listingOptsFor(def, ctx),
      ...(barIndexAbsoluteFor(def, ctx) ? { barIndexAbsolute: true } : {}),
      ...(other ? { symbols: other.symbols } : {}),
      ...(lower ? { lowerTf: lower.supply } : {}),
      chartClockSink: new Map() }))
  if (soleRunsWhy) return withColumnErrors({}, { [keys[0]]: { guard: BLOCK_RUNS_GUARD, message: soleRunsWhy } })
  return withSeedWarmup(withLowerTf(withChartClock(withOtherSymbols({ [keys[0]]: sole }, other), clock), lower), seed)
}

/** ⭐⭐ C41 — the lower-timeframe codes THIS binding may read
 *  (`engine/lowerTf.js::resolveLowerTf`), or null when the document reads none.
 *  Only the member door's Pine documents write an `ltf` node; the codes are its
 *  stamp (`meta.lowerTf`), so a document that reads none costs one property read.
 *  `ctx.lowerTf` is the chart's OWN symbol at each store timeframe
 *  (`useLowerTfSources`); `ctx.tf` the chart's — or the frame's — timeframe. */
export function lowerTfFor(def, ctx) {
  if (!def || !def.meta || def.meta.recurrenceOrigin !== PINE_RECURRENCE_ORIGIN) return null
  if (!Array.isArray(def.meta.lowerTf) || !def.meta.lowerTf.length) return null
  return resolveLowerTf(def, {
    tf: ctx && ctx.tf,
    lowerTf: ctx && ctx.lowerTf,
    framed: !!(ctx && ctx.framed),
  })
}

/** The key a column map carries its lower-timeframe decision under —
 *  non-enumerable, like `__otherSymbols`. */
const LOWER_TF = '__lowerTf'

function withLowerTf(out, lower) {
  if (lower) {
    Object.defineProperty(out, LOWER_TF, {
      value: Object.freeze({ served: lower.served, refused: lower.refused }), enumerable: false,
    })
  }
  return out
}

/** ⭐ C41 — which lower-timeframe codes a computed column map was served, and
 *  which were refused and why: `{served, refused: [{code, refusal, reason}]}`, or null. */
export function lowerTfReport(columns) {
  return (columns && columns[LOWER_TF]) || null
}

/** ⭐⭐ C26 — the other symbols THIS binding may read (`engine/otherSymbols.js`),
 *  or null when the document reads none. The member door's Pine documents are
 *  the only ones decided here: a `sym` in a document from any other translator
 *  keeps the unsupplied answer it always had. */
export function otherSymbolsFor(def, ctx) {
  if (!def || !def.meta || def.meta.recurrenceOrigin !== PINE_RECURRENCE_ORIGIN) return null
  if (!symTickersOf(def).length && !(def.meta.otherSymbols || []).length) return null
  return resolveOtherSymbols(def, {
    secondary: ctx && ctx.secondary,
    exchangeOf: ctx && ctx.exchangeOf,
    symbol: ctx && ctx.symbol,
    framed: !!(ctx && ctx.framed),
  })
}

/** The key a column map carries its other-symbol decision under — non-enumerable
 *  for the same reason `__columnErrors` is (a visible key is a phantom plot). */
const OTHER_SYMBOLS = '__otherSymbols'

function withOtherSymbols(out, other) {
  if (other) {
    Object.defineProperty(out, OTHER_SYMBOLS, {
      value: Object.freeze({ served: other.served, refused: other.refused }), enumerable: false,
    })
  }
  return out
}

/** ⭐ C26 — which other symbols a computed column map was served, and which were
 *  refused and why: `{served, refused: [{ticker, code, reason}]}`, or null. */
export function otherSymbolReport(columns) {
  return (columns && columns[OTHER_SYMBOLS]) || null
}

/** The key a column map carries its `time(<timeframe>)` withholdings under —
 *  non-enumerable for the reason `__columnErrors` is. */
const CHART_CLOCK = '__chartClock'

/** `byKey`: plot key → Map(code → sentence), filled by `interpret` through
 *  `opts.chartClockSink` (`interpret.js::periodAnchorMask` is the ONE place the
 *  decision is made). Folded to one row per code, naming the plots it covers. */
function withChartClock(out, byKey) {
  const rows = new Map()
  for (const [key, reasons] of Object.entries(byKey || {})) {
    for (const [code, reason] of reasons) {
      if (!rows.has(code)) rows.set(code, { code, reason, plots: [] })
      rows.get(code).plots.push(key)
    }
  }
  if (rows.size) {
    Object.defineProperty(out, CHART_CLOCK, {
      value: Object.freeze({ withheld: Object.freeze([...rows.values()]) }), enumerable: false,
    })
  }
  return out
}

/** ⭐⭐ C36 — WHY EVERY BAR OF A PLOT THAT READS `time(<timeframe>)` IS WITHHELD
 *  ON THIS CHART: `{withheld: [{code, reason, plots}]}`, or null when nothing is.
 *  The codes and sentences are `interpret.js::CHART_CLOCK_WITHHELD`'s — a chart
 *  that is not daily, daily bars that include a weekend, a chart timeframe no
 *  capture measured. The binder publishes it to the member's disclosure strip
 *  (`chartClockNotice.js`); the vendor harness prints it as a note. Modelled on
 *  `otherSymbolReport`: the decision rides on the columns it was made for. */
export function chartClockReport(columns) {
  return (columns && columns[CHART_CLOCK]) || null
}

/** ⭐⭐ F5 — A PLOT WHOSE PER-BAR COLOUR IS WITHHELD FOR A SEED IS WITHHELD WHOLE ON
 *  THAT BAR. The colour column (`colorMode: 'column:K'`) is its own tree and is
 *  withheld by its own bound; a value drawn beside a withheld colour would fall
 *  back to the series colour — a colour the script never chose on that bar
 *  (measured: pivot-point-supertrend AMEX:SPY bar 1043 drew the pane's gold where
 *  TradingView drew red). So the value is withheld there too, reported with an
 *  unbounded bound (its colour, not its number, is what could not be vouched for). */
function seedColourOntoValue(def, out, seed) {
  for (const p of (def && Array.isArray(def.plots) ? def.plots : [])) {
    const mode = p && typeof p.colorMode === 'string' ? p.colorMode : ''
    if (!mode.startsWith('column:') || !p.key) continue
    const k = mode.slice('column:'.length)
    const cs = seed[k]
    const col = out[p.key]
    if (!cs || !cs.mask || !col || typeof col.length !== 'number') continue
    const own = seed[p.key] && seed[p.key].mask ? seed[p.key] : null
    const mask = own ? Float64Array.from(own.mask) : new Float64Array(col.length)
    const bound = own ? Float64Array.from(own.bound) : new Float64Array(col.length)
    const raw = own ? own.raw : Float64Array.from(col)
    const next = Float64Array.from(col)
    let moved = false
    for (let i = 0; i < next.length; i++) {
      if (!cs.mask[i] || next[i] !== next[i]) continue
      next[i] = NaN
      mask[i] = 1
      bound[i] = Infinity
      moved = true
    }
    if (!moved) continue
    out[p.key] = next
    seed[p.key] = { mask, bound, raw }
  }
}

/** The key a column map carries its seed withholdings under — non-enumerable,
 *  like `__chartClock`. */
const SEED_WARMUP = '__seedWarmup'

/** `byKey`: plot key → the sink `interpret.js::seedWarmupMask` filled (`{mask,
 *  bound, raw}`, or empty when nothing was withheld). Only the filled ones ride. */
function withSeedWarmup(out, byKey) {
  const plots = {}
  for (const [key, s] of Object.entries(byKey || {})) {
    if (s && s.mask) plots[key] = Object.freeze({ ...s, withheld: countWithheld(s.mask) })
  }
  if (Object.keys(plots).length) {
    Object.defineProperty(out, SEED_WARMUP, { value: Object.freeze(plots), enumerable: false })
  }
  return out
}

function countWithheld(mask) {
  let n = 0
  for (let i = 0; i < mask.length; i++) if (mask[i]) n += 1
  return n
}

/** ⭐⭐ F5 — PER PLOT, THE BARS A RECURSIVE SERIES' SEED WITHHOLDS OFF THE LISTING:
 *  `{[key]: {mask, bound, raw, withheld}}`, or null when none is. `mask` (1 =
 *  withheld) is decided by `interpret.js::seedWarmupMask` from each series' own
 *  decay; `bound` is the per-bar bound on |ours − TradingView's| it was decided
 *  from; `raw` the value the bar would have shown. The member's disclosure strip
 *  reads the reason through `chartClockReport` (`seed:window`); the vendor
 *  harness reads THIS, so a withheld bar is graded by its own bound
 *  (`compare.mjs::comparePlot`). */
export function seedWarmupReport(columns) {
  return (columns && columns[SEED_WARMUP]) || null
}

/** ⭐⭐ C12w — THE DECLARATION A DOCUMENT MAKES ABOUT ITS RECURRENCES. The Pine
 *  member door (`memberPaneDefinition`) stamps it; nothing else does. */
export const PINE_RECURRENCE_ORIGIN = 'pine'

/** Whether the listing exception (ruling R-W) applies to THIS document on THIS
 *  bar series: `interpret`'s `historyFromListing`.
 *
 *  Two facts, both required, and neither inferred:
 *   - the CALLER states the series starts at the symbol's first-ever bar
 *     (`ctx.historyFromListing === true` — `StockChart` derives it from the
 *     listing date, the vendor harness from the capture's `startsAtBar0`);
 *   - the DOCUMENT declares its `accum` recurrences are Pine translations
 *     (`meta.recurrenceOrigin === 'pine'`).
 *
 *  ⛔ WHY THE SECOND ONE EXISTS. `accum` is shared by three translators and only
 *  one of them means "carried since the first bar". TC2000's `CountTrue(b, x)`
 *  (`pcf.js`) IS a window of `x` bars — run from bar 0 it would count the whole
 *  history, a different indicator. A document that says nothing is left exactly
 *  as it was.
 *  ⛔ Absent, `false`, or anything but `true` on either side means NO. */
export function historyFromListingFor(def, ctx) {
  return !!(ctx && ctx.historyFromListing === true
    && def && def.meta && def.meta.recurrenceOrigin === PINE_RECURRENCE_ORIGIN)
}

/** ⭐⭐ F1 — the listing facts `interpret` reads, as ONE spread: the listing
 *  (`historyFromListingFor`) and, with it, whether this document's Pine version
 *  reads an `na` `?:` test as false (`meta.naConditionFalse`, written by the
 *  member door from `interpret.js::naConditionIsFalse`; `interpret.js::
 *  pineTernaryFor`). Off the listing, or for a document that does not declare
 *  it, nothing changes. */
export function listingOptsFor(def, ctx) {
  if (!historyFromListingFor(def, ctx)) return {}
  return { historyFromListing: true,
    ...(def.meta.naConditionFalse === true ? { naConditionFalse: true } : {}) }
}

/** ⭐⭐ C45 — DOES THIS DOCUMENT'S `barindex` MEAN PINE'S `bar_index`?
 *
 *  Pine's `bar_index` counts from the first bar of the symbol's history; the
 *  engine's `barindex` leaf counts from the first bar it is handed. A document
 *  the Pine member door built claims TradingView's number, so off the listing a
 *  value that depends on the count is withheld (`interpret.js::barIndexMask`).
 *  A formula a member typed in the formula language reads `barindex` by ITS
 *  declared sentence ("the bar's position in the series") and is not touched.
 *
 *  ⛔ The same declaration `historyFromListingFor` reads, and for the same
 *  reason: the tree cannot say which translator wrote it. A document that says
 *  nothing (saved before C12w, or from another translator) is left as it was.
 *
 *  ⭐ ONE OTHER FACT ANSWERS IT, AND ONLY A CALLER CAN STATE IT:
 *  `ctx.barIndexFromFirstBar === true` — the series' first bar IS the bar
 *  TradingView counts as 0. The listing implies it on a daily chart
 *  (`historyFromListing`, which `interpret` asks itself); nothing else a member
 *  surface holds does — on an intraday chart TradingView's bar 0 is the first bar
 *  ITS plan loaded, which this product cannot know. So no member surface states
 *  it (`StockChart` does not, railed). The vendor harness does, for a capture
 *  whose OWN `bar_index` control row reads 0..n-1 on its bars: there the fact is
 *  the vendor's own print, and the count is graded instead of withheld.
 *  ⛔ It says nothing about the listing: no seed is lifted, no history read is
 *  served by it. Absent, `false`, or anything but `true` means NO. */
export function barIndexAbsoluteFor(def, ctx) {
  return !!(def && def.meta && def.meta.recurrenceOrigin === PINE_RECURRENCE_ORIGIN)
    && !(ctx && ctx.barIndexFromFirstBar === true)
}

/** Merge a caller's inputs over the definition's declared defaults. */
// ⭐⭐ EXPORTED FOR THE OBJECT LANE (C3B-CLOSE item 6), NOT COPIED INTO IT.
// `objectColumns.objectReaderFor` needs exactly this merge — declared defaults
// under the instance's overrides — to evaluate an object's coordinate the way
// the plot beside it is evaluated. A second copy there would be a second
// authority over one value, and the two would disagree the first time a default
// rule moved (`lesson_a_second_authority_over_one_value`).
export function resolveInputs(def, inputs) {
  const out = {}
  for (const input of def?.inputs || []) {
    if (input && typeof input.key === 'string') out[input.key] = input.default
  }
  if (inputs) {
    for (const [k, v] of Object.entries(inputs)) {
      if (v !== undefined) out[k] = v
    }
  }
  return out
}

// ─── public surface ──────────────────────────────────────────────────────────

/**
 * The column keys a definition's compute must return: every plot except static
 * `hlines` guides, PLUS every declared event.
 *
 * ⭐ EVENTS JOIN PLOTS HERE, AND THAT ONE-LINE WIDENING IS WHAT MAKES `events[]`
 * REAL. Until Phase C this function read `def.plots` only, so an event could be
 * declared and was inert: nothing computed a column for it, nothing checked that
 * one came back, and `defSchema.validateEvent` guarded only the key's SHAPE.
 * `validateEvent` has always guaranteed events and plots share ONE namespace (a
 * collision is a registration error), so the union cannot alias.
 *
 * ⚠️ THIS IS NO LONGER "the data-bearing PLOTS", and a caller that wants those
 * must say so. `pool.js::dataPlots` is the one that does — it filters
 * `def.plots` itself because a plan needs the whole plot object (style, colour,
 * width), and an event has no plot object at all. Feeding an event key to
 * `poolKey` would ask the renderer for a series to draw a signal in.
 *
 * The engine's one place for this rule. `computeFor` deliberately does NOT build
 * its output from this list — it builds from what the native actually returned —
 * so a definition and its compute drifting apart is a test failure, not a
 * silently empty column.
 */
export function columnKeys(def) {
  return [
    ...(def?.plots || [])
      .filter(p => p && p.style !== 'hlines' && typeof p.key === 'string')
      .map(p => p.key),
    ...(def?.events || [])
      .filter(e => e && typeof e.key === 'string')
      .map(e => e.key),
  ]
}

/**
 * Does this column contain anything to draw?
 *
 * THE PANE-EXISTENCE TEST (trap #4). Post-B1 every column is input-length, so
 * `.length` — which `StockChart.jsx` uses today — is always truthy and would
 * create a pane for every indicator whether or not it computed anything.
 *
 * `Infinity` is not finite and not plottable, so it counts as a gap.
 */
export function hasAnyFinite(col) {
  if (!col || typeof col.length !== 'number') return false
  for (let i = 0; i < col.length; i++) {
    if (Number.isFinite(col[i])) return true
  }
  return false
}

/**
 * Compute one definition into the columnar contract.
 *
 * @param {object} def   a registry definition (its `compute.fn` selects the native)
 * @param {Array}  bars  `[{t,o,h,l,c,v}]` — columns are index-aligned to these
 * @param {object} inputs partial input map; anything missing uses the declared default
 * @param {object} [ctx] `{sym, tf}` — REQUIRED for the server lane, ignored by natives
 * @returns {{[plotKey]: Float64Array}} one input-length NaN-padded column per data plot
 *
 * THROWS on an unknown `compute.fn`. Loud on purpose, mirroring
 * `indicator_compute.compute_case`: a definition naming a native this adapter
 * does not know must fail where it is wrong, not return `{}` and render blank.
 *
 * ⭐ THE SERVER LANE (Phase C Task 13). `compute.kind: 'server'` does NOT resolve
 * a native — its columns are FETCHED. It is dispatched on the KIND, before the
 * `compute.fn` lookup, because a server definition naming `fn: 'rsLine'` has no
 * entry in `NATIVE_COMPUTE` and never will: the throw below is right for a
 * native that lost its function and wrong for a definition that never had one.
 *
 * ⛔ AND IT RETURNS `{}` RATHER THAN THROWING WHILE THE FETCH IS IN FLIGHT.
 * `rsLine` was kept OUT of `listDefinitions()` by Task 14 for exactly one reason
 * — *"registering it would publish an indicator the binder throws on"* — so the
 * lane is only allowed to close that hand-back if it cannot throw. An empty
 * column set is the same thing `hasData` already reads for a warmup pad: the
 * binding draws nothing this paint and draws on the next.
 */
/** ⭐⭐ THE RUNTIME LANE'S COMPUTE, REGISTERED BY THE DOOR THAT MINTS ITS
 *  DOCUMENTS (`builder/memberPane/runtimePaneDefinition.js`), not imported here.
 *
 *  ⛔ WHY A REGISTRATION AND NOT AN IMPORT: this module is on every chart's path,
 *  and the runtime lane (front end + lowering + VM) is only reachable from a
 *  member pane that routed a script to it. Importing it here would ship it to
 *  every chart for a document only the member pane can produce. Unregistered, a
 *  runtime definition computes NOTHING and says why (`columnErrors`) — it never
 *  throws on the paint path. */
let _runtimeLane = null
export function registerRuntimeLane(fn) {
  _runtimeLane = typeof fn === 'function' ? fn : null
}

/** ⭐ RT1 — a SAVED runtime document on a chart that never opened the member
 *  door: the lane is loaded on demand by a LOADER the app registers
 *  (`hooks/useUserDefinitions.js` → `runtime/runtimeAsync.js`, its own chunk), and
 *  the chart repaints when it is in. In flight, the definition draws nothing this
 *  paint — the same `{}` the server lane answers with.
 *
 *  ⛔ A REGISTERED LOADER, NOT AN `import()` HERE: this module is reachable from
 *  the runtime lane's own worker bundle, and a dynamic import inside a worker
 *  makes it a code-splitting build the worker format cannot take. */
let _runtimeLoader = null
let _runtimeLoading = null
// ⛔ RF — A LOAD THAT FAILED IS SAID, NOT RETRIED ON EVERY PAINT. Before RF a
// failed `import()` (a stale chunk after a deploy, a dropped connection) cleared
// the in-flight mark and told nobody, so every later paint asked again, drew
// `{}` and said nothing: a pane blank forever with no reason. Now the failure is
// remembered for this tab, the chart is told once, and the definition answers it
// by name.
let _runtimeLoadFailed = null
export function registerRuntimeLaneLoader(fn) {
  _runtimeLoader = typeof fn === 'function' ? fn : null
  _runtimeLoadFailed = null
}
function loadRuntimeLane() {
  if (_runtimeLoading) return true
  if (!_runtimeLoader) return false
  _runtimeLoading = Promise.resolve()
    .then(() => _runtimeLoader())
    .then(() => { _runtimeLoading = null; notifyColumnsLanded('runtime:lane') })
    .catch((err) => {
      _runtimeLoading = null
      _runtimeLoadFailed = String((err && err.message) || err || 'the load failed')
      notifyColumnsLanded('runtime:lane')
    })
  return true
}

/** ⭐ RF — the guard a runtime document carries when this tab could not load the
 *  lane at all. */
export const RUNTIME_LOAD_FAILED_GUARD = 'runtime:load-failed'

function runtimeColumnsOrReasons(def, bars, inputs, ctx) {
  const keys = Object.keys((def.compute && def.compute.outputs) || {})
  const reasonFor = (guard, message) => withColumnErrors({},
    Object.fromEntries(keys.map((k) => [k, { guard, message }])))
  if (!_runtimeLane) {
    if (_runtimeLoadFailed !== null && runtimePaneEnabled()) {
      return reasonFor(RUNTIME_LOAD_FAILED_GUARD, 'the part of the app that draws a script bar by bar could not '
        + `be loaded in this tab (${_runtimeLoadFailed.slice(0, 160)}), so nothing is drawn. The chart is `
        + 'unaffected; reloading the page tries again.')
    }
    if (runtimePaneEnabled() && loadRuntimeLane()) return {}
    return reasonFor('runtime:unregistered',
      'the per-bar runtime lane is not loaded in this client, so this definition computes nothing')
  }
  try {
    return _runtimeLane(def, bars, inputs, ctx)
  } catch (err) {
    // ⭐⭐ C43 — THE SCRIPT'S OWN `runtime.error`, REACHED BY THE RUN (C35's
    // `PineRuntimeError`). The witnessed result is the host lane's too: no column
    // at all, and the member reads the script's message in TradingView's words
    // (`runtimeErrorText.js`). The run executed the bar, so the stop is exact;
    // its bar number is TradingView's only on a series that starts at the listing
    // bar.
    if (err && err.name === 'runtime.error') {
      const bar = Number.isInteger(err.bar) ? err.bar : 0
      const barKnown = Number.isInteger(err.bar) && !!(ctx && ctx.historyFromListing === true)
      const message = String(err.message)
      const stop = {
        reached: true, bar, barKnown, line: null, message,
        ...runtimeErrorWords({ message, bar, barKnown }), unknown: [], unread: [],
      }
      return withRuntimeErrorStop(reasonFor(RUNTIME_ERROR_GUARD, stop.sentence), stop)
    }
    // ⛔ A FAILED BUILD IS EVERY COLUMN'S FAILURE, reported, never a throw on the
    // paint path — the binder would otherwise skip the whole instance silently.
    return reasonFor((err && err.guard) || ENGINE_ERROR,
      String((err && err.message) || err))
  }
}

export function computeFor(def, bars, inputs, ctx) {
  if (def?.compute?.kind === 'runtime') {
    return runtimeColumnsOrReasons(def, Array.isArray(bars) ? bars : [], inputs, ctx)
  }
  if (def?.compute?.kind === 'server') {
    return serverColumnsFor(def, Array.isArray(bars) ? bars : [], resolveInputs(def, inputs), ctx)
  }
  // ⭐ THE AST LANE (Phase D Task 8), DISPATCHED ON THE KIND AND **BEFORE** THE
  // `NATIVE_COMPUTE` LOOKUP — exactly where Task 13 put the server lane, and for
  // the same reason one level sharper. An `ast` definition's `compute.fn` is its
  // `astHash`: a 71-character `sha256:…` string that has no entry in
  // `NATIVE_COMPUTE` and never will. Placed AFTER the lookup, the throw below
  // fires first and an `ast` definition can never draw — a lane that registers,
  // validates, budgets and lints, and then renders nothing. The throw is right
  // for a native that lost its function and wrong for a definition that never
  // had one.
  if (def?.compute?.kind === 'ast') {
    return astColumnsFor(def, Array.isArray(bars) ? bars : [], resolveInputs(def, inputs), ctx)
  }
  const fn = NATIVE_COMPUTE[def?.compute?.fn]
  if (!fn) {
    throw new Error(
      `computeFor: no native compute registered for compute.fn ` +
      `${JSON.stringify(def?.compute?.fn)} (definition ${JSON.stringify(def?.id)}). ` +
      `Known: ${Object.keys(NATIVE_COMPUTE).join(', ')}`,
    )
  }
  const series = Array.isArray(bars) ? bars : []
  // ⭐ THE CTX REACHES THE NATIVE LANE NOW. The server and AST lanes above were
  // already handed it; only this one dropped it, which is why a definition whose
  // input is a SERIES rather than the bars had nowhere to read it from.
  //
  // ⛔ INERT FOR EVERY SHIPPED NATIVE, and that is a property of the language
  // rather than a promise: all sixteen declare `(bars, p)` and JavaScript
  // discards an argument a function does not name. `nativeRegistry.test.js`
  // asserts it rather than trusting it.
  const raw = fn(series, resolveInputs(def, inputs), ctx)

  const columns = {}
  for (const key of Object.keys(raw)) columns[key] = toColumn(raw[key], series.length)

  const hold = COLUMN_HOLDS[def.compute.fn]
  return hold ? hold(columns) : columns
}

/**
 * The canned series every event-declaring definition is computed over at
 * registration.
 *
 * 200 bars because the longest warmup among the natives is Ichimoku's 52 and the
 * check has to see COMPUTED bars, not just pad — a probe short enough to leave a
 * column entirely NaN would pass the domain check while measuring nothing.
 *
 * Deterministic and DELIBERATELY OSCILLATING: `t` steps a real 5-minute bar,
 * and the price walks a sum of two out-of-phase sines so it reverses hard enough
 * to make SAR flip repeatedly. A monotonic ramp would leave `trendFlipped` all
 * zeros, which is still a legal column — but then a definition whose events were
 * silently constant would look exactly like one whose events work.
 */
const EVENT_PROBE_BARS = (() => {
  const bars = []
  for (let i = 0; i < 200; i++) {
    const mid = 100 + 6 * Math.sin(i / 5.5) + 2.5 * Math.sin(i / 1.7)
    bars.push({
      t: 1780272000 + i * 300,
      o: mid - 0.15, h: mid + 0.7, l: mid - 0.7, c: mid,
      v: 100000 + (i * 7919) % 50000,
    })
  }
  return bars
})()

/**
 * Every declared event returns a column, and every value in it is 0, 1 or NaN.
 *
 * ⭐ THIS IS THE HALF `defSchema` CANNOT DO. `validateDefinition` is a pure
 * function of one definition and never runs a compute lane, so "the key names a
 * returned column" and "that column is {0,1,NaN}" have to be asked HERE, where a
 * compute exists. A schema that only checks the DECLARATION is a schema that
 * lets a bad column ship: before this, a definition could name three events,
 * return nothing for any of them, and register cleanly.
 *
 * ⚠️ IT RUNS ONLY FOR DEFINITIONS THAT DECLARE EVENTS, on purpose. Thirteen of
 * the fourteen natives declare none, so there is nothing to check and no probe
 * compute to pay for; the day one grows an event it starts paying, which is the
 * right shape. (The PLOT columns are covered by `nativeRegistry.test.js`'s
 * column-set assertion, which is a test rather than a registration gate because
 * a plot that returns nothing renders nothing — visible — while an event that
 * returns nothing is a signal nobody can see is missing.)
 *
 * ⚠️ A compute that THROWS is an error, not a skip. `computeFor` throws on an
 * unknown `compute.fn`, and a definition whose events cannot be computed at all
 * is exactly the definition this gate exists to refuse.
 *
 * @returns {string[]} errors, empty when every event column is honest.
 */
function validateEventColumns(def) {
  const events = Array.isArray(def?.events) ? def.events : []
  if (!events.length) return []

  let columns
  try {
    columns = computeFor(def, EVENT_PROBE_BARS, {})
  } catch (err) {
    return [
      `events: compute could not be run to check the event columns `
      + `(${err && err.message ? err.message : String(err)}) — a definition that declares `
      + `events must be computable, or the events are a promise nothing keeps`,
    ]
  }

  const errors = []
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    if (!ev || typeof ev.key !== 'string') continue   // already reported by defSchema
    const path = `events[${i}]`
    const col = columns[ev.key]
    if (col === undefined || col === null || typeof col.length !== 'number') {
      errors.push(
        `${path}.key: ${JSON.stringify(ev.key)} returned no column — an event IS a column `
        + `(spec §3.1), so a key its compute never produces is a signal that can never fire. `
        + `Columns returned: ${Object.keys(columns).join(', ') || 'none'}`,
      )
      continue
    }
    for (let j = 0; j < col.length; j++) {
      if (isEventColumnValue(col[j])) continue
      errors.push(
        `${path}.key: column ${JSON.stringify(ev.key)}[${j}] must be 0, 1 or NaN — got ${col[j]}. `
        + `An event column is a {0, 1, NaN} domain: 1 is "it happened", 0 is "computed, did not `
        + `happen", NaN is the warmup pad. Any other value would be read as a signal by the `
        + `alert grammar, the screener and the AST lane alike.`,
      )
      break   // one bad column, one error — a mis-scaled column would report 200
    }
  }
  return errors
}

/**
 * Validate and index a batch of definitions.
 *
 * THREE passes, because they answer three different questions:
 *   1. `validateDefinition` — is each definition well-formed ON ITS OWN?
 *   2. `validateSourceReferents` — do its `source` inputs point at columns that
 *      EXIST? That needs the whole batch, which is why it could not live in
 *      defSchema's per-definition validator (B2 Task 2 carry-in b). A `source`
 *      resolving to nothing would silently compute over the wrong series, so it
 *      is rejected at registration exactly like an unresolvable `$ref`.
 *   3. `validateEventColumns` — does every declared event actually COME BACK,
 *      valued `{0, 1, NaN}`? That needs a compute, which is why it could not
 *      live there either (Phase C Task 4). **A definition that lies about its
 *      events must not register.**
 *
 * Never throws: a bad definition is DATA about a problem. Callers decide whether
 * a rejection is fatal — for the natives below it is, because they are authored
 * in this repo and a broken one is a build bug.
 *
 * @returns {{defs: object[], errors: string[]}}
 */
export function registerDefinitions(rawDefs) {
  const errors = []
  const valid = []

  for (const raw of rawDefs || []) {
    const r = validateDefinition(raw)
    if (!r.ok) {
      const id = raw && raw.id ? raw.id : '<unknown>'
      errors.push(...r.errors.map(e => `${id}: ${e}`))
      continue
    }
    valid.push(r.def)
  }

  // Columns of every definition that survived pass 1 — including the one being
  // checked, so a definition may legally source from its own plots.
  const columnsById = new Map(valid.map(d => [d.id, columnKeys(d)]))
  const resolve = (id) => (columnsById.has(id) ? columnsById.get(id) : null)

  const defs = []
  for (const def of valid) {
    const srcErrors = validateSourceReferents(def, resolve)
    if (srcErrors.length) {
      errors.push(...srcErrors.map(e => `${def.id}: ${e}`))
      continue
    }
    const eventErrors = validateEventColumns(def)
    if (eventErrors.length) {
      errors.push(...eventErrors.map(e => `${def.id}: ${e}`))
      continue
    }
    defs.push(def)
  }

  return { defs, errors }
}

/**
 * ⭐ THE OWNER'S RULING, 2026-08-06, CARRIED AS A TIER: *"everything is paid,
 * almost nothing is accessible for free."*
 *
 * ⛔ AND IT IS A READING OF A GATE, NOT A PREFERENCE. `meta.tier` is a badge in
 * `IndicatorLibraryDialog` and gates nothing by itself — the gate is the handler.
 * An `ast` definition is a USER's formula and the ONLY lane that serves one is
 * `/api/user-definitions`, whose every route declares `Depends(require_paid)` on
 * its own handler (asserted from `router.routes`, count included, in
 * `tests/test_user_definitions_auth.py`). So `free` on this lane would be a badge
 * promising data the lane refuses to hand over: the silently-dead indicator this
 * phase exists to retire, wearing a price tag instead of a compute.
 *
 * ⭐ THE PRECEDENT IS `rsLine`, AND IT WAS CONFIRMED RATHER THAN WAIVED. Phase C
 * Task 14 authored it `free` before the lane that serves it existed; Task 13
 * corrected it to `premium` because `/api/signature/columns` declares the same
 * dependency, and the owner confirmed. The `ast` lane declares the same
 * dependency, so it carries the same tier by the same argument.
 *
 * ⚠️ THIS IS DELIBERATELY NOT APPLIED TO THE SIXTEEN NATIVES. See `nativeDef`'s
 * header: their `tier: 'free'` is a shared default with a paywall blast radius,
 * and it is a FINDING FOR THE OWNER, not this task's edit.
 */
export const AST_LANE_TIER = 'premium'

/**
 * The `ast` lane's REGISTRATION-TIME gates — the questions `validateDefinition`
 * cannot answer about a formula. Four in the numbered list below, plus GATE 5
 * (`plots[].forward`) and GATE 6 (`meta.freshness`), each written at the line it
 * guards. ⚠️ THIS SENTENCE SAID "THE FOUR QUESTIONS" WHILE THE FUNCTION BELOW
 * ALREADY CARRIED FIVE — the same prose-count-beside-a-real-list drift the
 * single-writer index in `StockChart.jsx` was rebuilt to stop. Read the `GATE n`
 * comments, never a number in a paragraph.
 *
 * `defSchema` already asked the three it CAN (the tree is canonical, the source
 * parses back to it, the handle is the hash). Those are pure facts about one
 * definition. These four are not:
 *
 *   1. ONE TREE IS ONE SERIES. `interpret` returns a single column, so a plot
 *      with no tree behind it would be filled by nothing and stay permanently
 *      NaN — `hasAnyFinite` false, nothing drawn, no error anywhere. Invisible,
 *      which is why it is refused rather than tolerated. (Its EVENTS are refused
 *      by `validateEventColumns`, which already runs and already says "returned
 *      no column" by name — no second guard is added here.)
 *      ⭐ W1b MOVED THIS ONE FIELD OVER, AND ONLY ONE. A document carrying
 *      `compute.trees` names a tree per plot, so the question is no longer "is
 *      there exactly one data plot" but "are the plots and the trees the same key
 *      set" — the same defect, counted per tree. A document carrying NO trees is
 *      unchanged and is refused with the sentence it has always carried.
 *      ⛔ GATES 2, 3 AND 6 THEREFORE RUN PER TREE, and 3 and 6 compare against
 *      the WORST/STALEST of them (`ast/trees.js`), because a document draws
 *      every plot at once: a member reading one badge above a pane is being told
 *      about all of them, and a MACD whose signal line repaints does repaint.
 *
 *   2. THE BUDGET. `checkBudget` is the UX half of Task 6's pair: an author gets
 *      a MESSAGE at registration, where `assertBudget` inside `interpret` is the
 *      safety half that throws at compute. Both exist because registration-only
 *      lets a definition registered under one budget run forever under a later,
 *      smaller one, and compute-only turns an authoring mistake into a chart
 *      that draws sometimes.
 *
 *   3. THE REPAINT BADGE MUST BE THE MEASUREMENT. ⭐ THIS IS THE ONE LANE WHERE
 *      IT IS DECIDABLE. Spec §11 forbids static analysis of hand-written JS, so
 *      all seventeen shipped definitions are `undecidable-hand-written` and their
 *      badges are declarations nobody can check. An `ast` definition's compute IS
 *      a tree this repo can read, so the badge stops being a claim and becomes an
 *      answer — and a declaration that disagrees with the answer is refused in
 *      BOTH directions. Under-claiming (`repaints` on maths that does not) is as
 *      false as over-claiming, and a badge a user reads is a decision they make.
 *
 *   4. THE TIER BADGE MUST MATCH THE LANE'S GATE (Phase D Task 14). Exactly the
 *      shape of 3, one field over: `AST_LANE_TIER` above is a reading of
 *      `/api/user-definitions`, which declares `Depends(require_paid)` on every
 *      one of its handlers, so a `free` badge here is a definition promising data
 *      its own lane refuses. Required AND checked, for the same reason the badge
 *      in 3 is: `defSchema` lets `meta.tier` be omitted (a definition need not
 *      gate itself) and an omitted badge on a paid lane reads as free to the
 *      library dialog — an absent claim and a false one land a user in the same
 *      place.
 *
 * ⛔ EVERY REFUSAL NAMES THE DOOR THAT DECIDED IT. `checkBudget` can raise a
 * `TableRefusal` from ANOTHER guard (`maxLookback` resolves functions and
 * arities on its way), and reporting that as "over budget" would be the
 * wrong-door defect this branch has now found four separate times. The guard on
 * the refusal is what gets printed, never the function that happened to be on
 * the stack.
 *
 * ⭐ EXPORTED FOR ONE REASON: so its key-set backstop can be SEEN REFUSING.
 * Every other gate here is reachable through `validateUserDefinitions` and is
 * tested there; the `compute.trees` key-set check is not, because `defSchema`
 * refuses the same document first. A guard nobody has watched fire is not a
 * guard, so the test calls this directly rather than asserting in a comment that
 * it cannot be reached. It is NOT a door for product code — `validateUserDefinitions`
 * is the door, and it is the only caller in `app/src`.
 *
 * @returns {string[]} errors, empty when the definition can run here.
 */
export function validateAstLane(def) {
  const errors = []
  const dataPlots = astPlotKey(def)
  const trees = astTrees(def)

  // ⭐⭐ GATE 1, W1b: ONE FORMULA IS ONE SERIES — **PER TREE**. A document
  // carrying `compute.trees` names a tree per plot, so N data plots are exactly
  // as legal as N trees and the question becomes whether the two are the SAME
  // key set. A document carrying no trees is unchanged: one tree, one plot, and
  // the sentence it is refused with is the one it has always carried (asserted
  // by `BuilderSheet.test.jsx` and `nativeRegistry.test.js` alike).
  if (!trees) {
    if (dataPlots.length !== 1) {
      errors.push(
        `plots: an "ast" definition computes ONE column — one formula is one series — so it must ` +
        `declare exactly one data-bearing plot, and this one declares ${dataPlots.length} ` +
        `(${dataPlots.join(', ') || 'none'}). A second plot is a key nothing ever fills: it draws ` +
        `nothing, reports nothing, and looks exactly like a warmup pad.`,
      )
      return errors
    }
  } else {
    // ⚠️ THIS IS A BACKSTOP, NOT THE DOOR — AND IT IS WATCHED FIRING RATHER THAN
    // DESCRIBED AS UNFIREABLE. `defSchema.validateTreesAgainstPlots`
    // (`defSchema.js`) refuses the key-set disagreement in both directions and
    // runs FIRST: measured against nine hostile shapes (missing tree, extra
    // tree, extra plot, dropped plot, `{}`, `[]`, `null`, a falsy tree, zero data
    // plots), `validateUserDefinitions` short-circuits before this function every
    // time, with a better message. So a member never meets this sentence.
    //
    // It stays because the loop below indexes `trees[k]` and an absent tree must
    // be a named refusal rather than an `undefined` handed to `checkBudget` —
    // which would report a DOCUMENT defect as a budget refusal, the wrong-door
    // defect this file names four separate times. A comment saying "this cannot
    // fire" would have been a gate that cannot fail (`lesson_gate_that_cannot_fail`),
    // so `validateAstLane` is EXPORTED and `treesLane.test.js` calls it directly
    // and watches it refuse — beside the case showing which door a member
    // actually meets for the same document.
    const missing = dataPlots.filter((k) => !Object.prototype.hasOwnProperty.call(trees, k))
    const extra = Object.keys(trees).filter((k) => !dataPlots.includes(k))
    if (missing.length || extra.length || !dataPlots.length) {
      errors.push(
        `compute.trees — the data-bearing plots and the trees must be ONE key set: a plot with no ` +
        `tree is a key nothing ever fills and a tree with no plot is computed for nobody. Plots ` +
        `(${dataPlots.join(', ') || 'none'}) against trees (${Object.keys(trees).join(', ') || 'none'}); ` +
        `missing ${missing.join(', ') || 'none'}, extra ${extra.join(', ') || 'none'}.`,
      )
      return errors
    }
  }

  // ⛔⛔ THE LANE LIST IS PINNED FOR THE TREE-LESS DOCUMENT, NEVER DERIVED FROM
  // `Object.values(def.compute.trees || {})`. `worstRepaint`/`stalestFreshness`
  // fail CLOSED on an EMPTY list, deliberately — no tree makes no promise — so
  // that spelling would hand them `[]` for every document saved before W1b (one
  // data plot, no trees map) and brand it `repaints`/`unknown` at the next
  // validation. Every existing saved definition, worst badge, no code change
  // anywhere near it. `treesLane.test.js` pins the empty-list aggregation AND
  // the single-tree document side by side so the shortcut cannot come back.
  const lanes = trees ? dataPlots.map((k) => [k, trees[k]]) : [[dataPlots[0], def.compute.ast]]

  // ⭐ THE DEFINITION'S OWN DECLARED INPUTS, DERIVED — the same set
  // `lintDefinition` (and therefore `repaintVerdict`, and therefore the legend
  // chip) derives. `parse.js` turns every identifier into a `series` node, so
  // a formula naming a declared knob reads as an unknown series to a linter
  // handed no inputs; this door and the chip would then disagree about one
  // definition, which is the contract divergence this pair keeps paying for.
  // Every definition that declares no inputs gets `{}` and is unmoved.
  const scope = { inputs: declaredInputs(def) }
  const verdicts = []
  const freshnesses = []
  for (const [key, ast] of lanes) {
    // The FIELD PATH the member reads: `compute.ast` on a tree-less document,
    // the tree's own path on a multi-tree one. A member reads WHERE to look.
    const treePath = trees ? `compute.trees.${key}` : 'compute.ast'
    let budget
    try {
      budget = checkBudget(ast, def.compute.budget)
    } catch (err) {
      errors.push(
        `${treePath}: refused at registration by ${JSON.stringify(err && err.guard ? err.guard : 'an unnamed guard')} ` +
        `— ${err && err.message ? err.message : String(err)}`,
      )
      return errors
    }
    if (!budget.ok) {
      errors.push(
        `compute.budget: ${budget.error} (guard ${JSON.stringify(budget.guard)}). Measured ` +
        `${JSON.stringify(budget.measured)} against caps ${JSON.stringify(budget.caps)}.` +
        (trees ? ` The tree measured is ${treePath}.` : ''),
      )
      return errors
    }
    let treeVerdict
    try {
      treeVerdict = lintRepaint(ast, scope)
    } catch (err) {
      errors.push(
        `${treePath}: the repaint linter could not read this tree ` +
        `(${err && err.message ? err.message : String(err)})`,
      )
      return errors
    }
    verdicts.push([key, treeVerdict])
    freshnesses.push([key, freshnessFor(ast, scope)])
  }

  // ⭐⭐ THE BADGE IS THE WORST TREE, AND THAT IS THE ONLY HONEST AGGREGATION.
  // A document draws every plot at once, so a member reading one badge above a
  // pane is being told about all of them; a MACD whose signal line repaints does
  // repaint, however clean its histogram is. The tree that produced the worst
  // answer is NAMED in the refusal, because "one of your four formulas" is not
  // something a member can act on.
  // ⛔ THE AGGREGATED MODE IS THE AUTHORITY AND THE `find` ONLY NAMES A TREE.
  // Comparing against the aggregate and printing a tree's own reasons keeps one
  // decision with one owner (`ast/trees.js`); a fallback that could never fire
  // would still be a second rule for the same value if it decided the verdict.
  const worstMode = worstRepaint(verdicts.map(([, v]) => v.mode))
  const [worstTree, verdict] = verdicts.find(([, v]) => v.mode === worstMode) || verdicts[0]
  const stalestMode = stalestFreshness(freshnesses.map(([, f]) => f.mode))
  const [stalestTree, stalest] = freshnesses.find(([, f]) => f.mode === stalestMode) || freshnesses[0]
  const verdictByPlot = new Map(verdicts)
  // Named only on a multi-tree document: on a tree-less one there is one tree
  // and the sentence it has always carried says everything there is to say.
  const named = (key) => (trees ? ` (measured on compute.trees.${key})` : '')
  // ⚠️ THESE TWO MESSAGES DELIBERATELY DO NOT WRITE THE FIELD FOLLOWED BY A
  // COLON, WHICH IS THIS FILE'S USUAL `path: problem` house style. The ledger's
  // repaint biconditional counts `repaint\s*:` occurrences in this module's
  // COMMENT-STRIPPED source to know how many places DECLARE the badge — and a
  // string is not stripped, so an error message written in house style is
  // counted as a declaration. It caught these two on their first run (2 → 4).
  // The rail is right and the messages moved: an em dash says the same thing and
  // is not a declaration.
  if (def.meta.repaint === undefined) {
    errors.push(
      `meta.repaint — required on the "ast" lane, because this is the one lane where the badge is ` +
      `DECIDABLE (spec §11 forbids analysing hand-written computes, so every other definition's ` +
      `badge is an unauditable claim). The linter measures ${JSON.stringify(worstMode)} for ` +
      `this formula${named(worstTree)}; declare it.`,
    )
  } else if (def.meta.repaint !== worstMode) {
    errors.push(
      `meta.repaint — declared ${JSON.stringify(def.meta.repaint)} but the linter MEASURES ` +
      `${JSON.stringify(worstMode)}${named(worstTree)} (forward=${verdict.forward}) — ` +
      `${verdict.reasons.join('; ')}. ` +
      `A badge is a truth claim a user makes decisions on; on a lane where it can be computed, a ` +
      `declaration that disagrees is refused in BOTH directions, because under-claiming is as ` +
      `false as over-claiming.` +
      (trees ? ` A document draws every plot at once, so the badge is the WORST of its trees.` : ''),
    )
  }
  // ⚠️ SAME EM-DASH REASON AS THE TWO ABOVE, ONE FIELD OVER. These messages name
  // `meta.tier` without a following colon so a source-text census of the badge
  // cannot count a sentence about it as a declaration of it.
  if (def.meta.tier === undefined) {
    errors.push(
      `meta.tier — required on the "ast" lane. A user's formula is served only by ` +
      `\`/api/user-definitions\`, which declares \`Depends(require_paid)\` on every one of its ` +
      `handlers, so this lane is ${JSON.stringify(AST_LANE_TIER)} by the owner's 2026-08-06 ruling ` +
      `("everything is paid, almost nothing is accessible for free"). \`defSchema\` lets the badge ` +
      `be omitted because a definition need not gate itself; on THIS lane an omitted badge reads ` +
      `as free in the library dialog, which is the same lie as declaring it.`,
    )
  } else if (def.meta.tier !== AST_LANE_TIER) {
    errors.push(
      `meta.tier — declared ${JSON.stringify(def.meta.tier)} but this lane is ` +
      `${JSON.stringify(AST_LANE_TIER)}: every route of \`/api/user-definitions\` declares ` +
      `\`Depends(require_paid)\` on its own handler, so this badge would promise data the lane ` +
      `refuses to hand over — a definition a user can see, choose and never receive. This is ` +
      `\`rsLine\`'s correction (Phase C Task 13, confirmed by the owner rather than waived) ` +
      `applied to the lane that declares the same dependency.`,
    )
  }
  // ⭐⭐ GATE 6 — FRESHNESS, AND IT IS REFUSED IN BOTH DIRECTIONS BECAUSE
  // UNDER-CLAIMING IS AS FALSE AS OVER-CLAIMING. Gate 3 says the same about the
  // repaint badge, one field over. Over-claiming `live` on a nightly market cap
  // tells a user a number is current when it is up to a day old. Under-claiming
  // `as-of-snapshot` on a pure price formula tells them a live signal is stale,
  // and a user who discounts a true signal has been misled just as precisely.
  //
  // ⛔ AND IT IS REQUIRED, NOT OPTIONAL, ON THIS LANE — WHICH IS THE WHOLE
  // REASON THIS GATE EXISTS. `astReach` returns 0 for a table-declared scalar,
  // so GATE 3 passes `market_cap > 1e9` with `non-repainting` and NOTHING ELSE
  // FIRES. The repaint linter is not wrong: a scalar reads no future bar. It is
  // answering a question nobody asked. An omitted freshness badge then reads as
  // `live` to the library dialog, which is the absent-claim-and-false-claim-
  // land-in-the-same-place argument GATE 4 already makes about `meta.tier`.
  //
  // ⚠️ SAME EM-DASH REASON AS THE MESSAGES ABOVE. The ledger's biconditional
  // counts field declarations in this module's COMMENT-STRIPPED source, and a
  // string written in this file's usual `path: problem` house style is counted
  // as a declaration of the field it names. An em dash says the same thing and
  // is not one.
  //
  // ⚠️ IT RUNS AFTER THE BUDGET GATE, WHICH IS WHY IT DOES NOT RE-CHECK CALL
  // NAMES. `checkBudget` resolves every function and arity on its way to a
  // lookback and returns early above, so a tree naming something undeclared
  // never reaches this line.
  if (def.meta.freshness === undefined) {
    errors.push(
      `meta.freshness — required on the "ast" lane. The repaint badge cannot cover this: ` +
      `\`astReach\` answers 0 for a table-declared scalar, correctly, so a formula reading a ` +
      `nightly per-symbol value passes GATE 3 as non-repainting and nothing else fires. The ` +
      `linter measures ${JSON.stringify(stalestMode)} for this formula${named(stalestTree)}; declare it.`,
    )
  } else if (def.meta.freshness !== stalestMode) {
    errors.push(
      `meta.freshness — declared ${JSON.stringify(def.meta.freshness)} but the linter MEASURES ` +
      `${JSON.stringify(stalestMode)}${named(stalestTree)} (${stalest.reasons.join('; ')}). A badge is the ` +
      `MEASUREMENT, and this one is refused in BOTH directions: over-claiming "live" on a value ` +
      `that is a day old and under-claiming "as-of-snapshot" on a live one mislead a user just ` +
      `as precisely as each other.` +
      (trees ? ` A document draws every plot at once, so the badge is the STALEST of its trees.` : ''),
    )
  }
  // ⭐ GATE 5 — AN `ast` PLOT MAY NOT DECLARE ITS OWN FORWARD WINDOW, AND THIS IS
  // THE SAME SENTENCE AS 3, ONE LEVEL DOWN.
  //
  // `plots[].forward` exists so a HAND-WRITTEN compute can tell the linter the
  // one fact it cannot derive (`defSchema` documents it; `ichimoku.chikou` is the
  // one shipped user). On this lane the linter has the TREE, so the window is an
  // answer rather than a claim — and a declaration beside it is a second source
  // for one number that nothing keeps honest. Left accepted, an author could
  // widen a clean formula's window by hand and move its badge without touching a
  // line of maths, which is a hand-set badge taking the long way round.
  //
  // ⚠️ AND THE PYTHON LANE IS THE SECOND REASON, MEASURED RATHER THAN ASSUMED.
  // `api/services/user_definitions.lint_verdict` stores `{plotKey: mode}` from
  // `api/services/ast_lint.lint_definition`, which reads the tree and knows
  // nothing about this field. Accepting it here would let a stored definition
  // carry a verdict the two lanes computed differently — the cross-lane
  // divergence `tools/ast_conformance.py` exists to make impossible.
  for (const plot of (Array.isArray(def.plots) ? def.plots : [])) {
    if (plot && Object.prototype.hasOwnProperty.call(plot, 'forward')) {
      // ⭐ THE PLOT'S **OWN** TREE ANSWERS, when it has one. A guide (`hlines`)
      // owns no tree and no column, so the number it is shown is the scan
      // tree's — which is precisely what a tree-less document has always been
      // shown, one tree being the only tree there is.
      const own = verdictByPlot.get(plot && plot.key) || verdict
      errors.push(
        `plots[].forward — declared on ${JSON.stringify(plot.key)}, but an "ast" definition's ` +
        `forward window is DERIVED from its tree (${JSON.stringify(String(own.forward))} bars, ` +
        `measured). The field exists for a hand-written compute the linter cannot read; on this ` +
        `lane it is a second declaration of a number the linter already knows, and the two have ` +
        `nothing keeping them equal.`,
      )
    }
  }
  return errors
}

/**
 * VALIDATE definitions THIS CLIENT DID NOT AUTHOR — the `supportedKinds` door.
 *
 * ⭐⭐ IT WAS CALLED `registerUserDefinitions` UNTIL PHASE D TASK 16, AND THE
 * NAME IS PART OF WHY THE FEATURE WAS DEAD FOR SIX TASKS. "Register" reads as
 * "put it in the registry", and every caller — the builder, the plan, three
 * comments in this file — read it that way. It never did: it runs `defSchema`,
 * the lane filter and the `ast` gates, and RETURNS `{defs, errors}`. Nothing was
 * installed anywhere, so a user's saved formula validated cleanly and then could
 * not be resolved by `getDefinition`, dropped out of `normalizeInstances` and
 * drew nothing on any chart. The function is unchanged; the name now says what
 * it does, and `installUserDefinitions` (below) is the one that does the other
 * thing. A rename rather than a comment because the comment would have to be
 * read to help, and six tasks of evidence say the name is what gets read.
 *
 * ⭐ THE SENTENCE `defSchema.js` HAS CARRIED SINCE B1 — *"the registry's
 * `supportedKinds` filter decides what a given client will actually run"* — and
 * the filter it named did not exist. Measured 2026-08-06: repo-wide, in
 * `app/src` and `api/` alike, `supportedKinds` appeared exactly twice, in that
 * comment and in spec §3.1, and as an IDENTIFIER zero times. This function is
 * the filter, and `defSchema.SUPPORTED_KINDS` is the list it reads.
 *
 * ⛔ AN UNSUPPORTED KIND IS LISTED, NOT DELETED. It comes back in `errors` with
 * a "cannot run it" sentence and NOT in `defs` — which is a refusal to RENDER,
 * not a refusal to EXIST. Spec §3.1 has the catalog fetch filter by client
 * `supportedKinds` and §5 keeps premium entries listed while locked; a client
 * that treated "I cannot run this" as "this is malformed" would drop the entire
 * server lane the moment its bundle fell a version behind, and the user would
 * see indicators vanish rather than grey out.
 *
 * ⚠️ IT IS A SUPERSET OF `registerDefinitions`, NOT A REPLACEMENT FOR IT. The
 * natives below still go through the three-pass version directly: they are
 * authored in this repo, every one is on a supported lane by construction, and a
 * lane filter on them could only ever be a no-op that made the import path
 * harder to read.
 *
 * @returns {{defs: object[], errors: string[]}}
 */
export function validateUserDefinitions(rawDefs) {
  const base = registerDefinitions(rawDefs)
  const errors = [...base.errors]
  const defs = []
  // ⭐ RF — the ids refused because the server lists them (`runtimeKilled` or
  // the latched list): `installUserDefinitions` takes an already-installed copy
  // of each off this tab, so a kill reaches an open chart on its next read.
  const killedIds = []

  for (const def of base.defs) {
    const kind = def.compute.kind
    // ⭐⭐ THE RUNTIME LANE IS ADMITTED ONLY WHILE ITS GATE IS ON (2026-09-28).
    // It is not in `SUPPORTED_KINDS` — that list is also the registry's lane
    // partition and the shipped-definition contract — so the admission is its
    // own clause, asked of the ONE gate the member pane's router also asks.
    if (kind === 'runtime' && runtimePaneEnabled()) {
      // ⛔ RT1 — THE KILL SWITCH, AT THE INSTALL DOOR. A runtime document the
      // server lists (`PINE_RUNTIME_KILL_LIST`: stamped on the row it serves as
      // `meta.runtimeKilled`, or latched from the auth payload) is not drawn —
      // refused with the reason, and left in the store untouched.
      const meta = def.meta || {}
      // ⭐ GT (D6) — a stored row whose script is not on the server's starter
      // allowlist is served stamped `meta.runtimeNotGraded` and refused the same
      // way: kept in the store, drawn again once the script is listed. The server
      // stamp is the authority here (a saved pane must not wait on the preview's
      // read of the list to learn it may draw).
      const killed = (typeof meta.runtimeKilled === 'string' && meta.runtimeKilled)
        || (typeof meta.runtimeNotGraded === 'string' && meta.runtimeNotGraded)
        || runtimeKillOf({ defId: def.id, source: def.compute && def.compute.source })
      if (killed) {
        errors.push(`${def.id}: ${killed} — the saved definition is kept; it comes back when it is taken off the list.`)
        killedIds.push(def.id)
        continue
      }
      defs.push(def)
      continue
    }
    if (!SUPPORTED_KINDS.includes(kind)) {
      errors.push(
        `${def.id}: compute.kind ${JSON.stringify(kind)} is declared but this client cannot run it ` +
        `— it is a DECLARED kind (defSchema.COMPUTE_KINDS) and an UNSUPPORTED one ` +
        `(defSchema.SUPPORTED_KINDS: ${SUPPORTED_KINDS.join(', ')}). The definition stays ` +
        `listable and describable; it will not be rendered here.`,
      )
      continue
    }
    if (kind === 'ast') {
      const laneErrors = validateAstLane(def)
      if (laneErrors.length) {
        errors.push(...laneErrors.map(e => `${def.id}: ${e}`))
        continue
      }
    }
    defs.push(def)
  }

  return { defs, errors, killedIds }
}

const _registered = registerDefinitions(RAW_DEFS)
if (_registered.errors.length) {
  // The natives are authored in this repo, so an invalid one can only ever be a
  // build-time defect — failing at import surfaces it in the first test that
  // touches the engine rather than as an indicator that quietly stops existing.
  throw new Error(`nativeRegistry: invalid native definitions:\n  ${_registered.errors.join('\n  ')}`)
}

/** The 16 NATIVE definitions, frozen. `volumeProfile` is NOT among them, and
 *  neither is `rsLine` — see `SERVER_DEFS` below, which is a different LANE
 *  rather than a different list. `listDefinitions()` is the union of the two. */
export const NATIVE_DEFS = Object.freeze(_registered.defs)

/**
 * The RS line — the first `compute.kind: 'server'` definition, and DELIBERATELY
 * NOT IN `NATIVE_DEFS`.
 *
 * ⭐ WHY IT IS SERVER-LANE (decision A3). Spec §4's compute contract is
 * `compute({bars, inputs, prevState, barstate})` — ONE `bars`. The RS line needs
 * two series, its own and the benchmark's, and a second symbol is not reachable
 * from that signature. Extending it is a schema change, not a C feature, so the
 * indicator moves lanes instead: its columns are FETCHED, not computed here.
 * Its benchmark is an `enum` of a fixed list for the same reason its cousin's
 * anchor is — `symbol` is a RESERVED input type and `defSchema` fails closed.
 *
 * ✅ AND IT IS NOW REGISTERED — TASK 14'S HAND-BACK, CLOSED BY TASK 13.
 * Task 14 wrote here: *"Putting this in `RAW_DEFS` today would publish an
 * indicator a user can enable and the binder cannot draw: `computeFor` resolves
 * `NATIVE_COMPUTE[compute.fn]` and THROWS on a miss, by design."* That was the
 * whole objection and it is answered, not waived: `computeFor` now dispatches on
 * `compute.kind` BEFORE the `NATIVE_COMPUTE` lookup, and the server branch
 * returns `{}` while the fetch is in flight instead of throwing. So
 * `listDefinitions()` is the UNION of the two lanes — **16 → 17** — and the
 * definition is reachable, drawable and addressable like any other.
 *
 * ⚠️ `meta.tier` IS `premium`, AND THAT IS A CORRECTION, NOT A DECORATION. Task
 * 14 authored it `free`, before the lane that serves it existed. The lane is
 * `/api/signature/columns`, which declares `Depends(require_paid)` on its own
 * handler like every other route in that module — so a `free` claim here would
 * be a definition promising data its lane refuses to hand over, which is exactly
 * the silently-dead indicator this phase exists to retire. The tier is a badge
 * in `IndicatorLibraryDialog` and gates nothing by itself; the gate is the
 * handler, and this is the declaration matching it.
 */
const RS_LINE_RAW = {
  schemaVersion: SCHEMA_VERSION,
  id: 'rsLine',
  version: 1,
  compute: { kind: 'server', fn: 'rsLine', rev: 1 },
  meta: {
    name: 'Relative Strength Line', shortName: 'RS', category: CAT.RELATIVE_STRENGTH,
    description: 'This symbol\'s close divided by a benchmark\'s — is it leading or lagging the market?',
    tags: ['comparative', 'momentum'], tier: 'premium', repaint: 'non-repainting',
    legendParams: ['benchmark'],
  },
  placement: { target: 'pane', pane: { height: 0.15 } },
  inputs: [
    // ⭐ AN `enum` OF A FIXED LIST, NOT A `symbol` (decision A3). `symbol` is in
    // `RESERVED_INPUT_TYPES` and `defSchema` refuses it with a distinct message;
    // three benchmarks cover the question this indicator answers and need no new
    // input type, no symbol picker and no second data-entitlement question.
    {
      key: 'benchmark', type: 'enum', label: 'Benchmark', default: 'SPY',
      options: [['SPY', 'S&P 500 (SPY)'], ['QQQ', 'Nasdaq 100 (QQQ)'], ['IWM', 'Russell 2000 (IWM)']],
    },
    colorInput('color', 'Color', '#4ECDC4'),
    { key: 'lineWidth', type: 'int', label: 'Line width', default: 1, min: 1, max: 4, step: 1 },
  ],
  plots: [
    { key: 'rsLine', label: 'RS', style: 'line', color: '$color', width: '$lineWidth', role: 'primary', legend: { decimals: 4 } },
  ],
}

const _serverRegistered = registerDefinitions([RS_LINE_RAW])
if (_serverRegistered.errors.length) {
  throw new Error(`nativeRegistry: invalid server definitions:\n  ${_serverRegistered.errors.join('\n  ')}`)
}

/** Server-lane definitions — authored, VALIDATED and, since Task 13's
 *  `serverCompute` lane landed, IN `listDefinitions()`. Kept as its own export
 *  because the lane is the thing that differs: a caller asking "which of these
 *  do I have to fetch?" reads this, not a `compute.kind` scan it would have to
 *  keep in step by hand. */
export const SERVER_DEFS = Object.freeze(_serverRegistered.defs)

// ─── the ast lane ships NOTHING, and there is no array to say so twice ───────
// An `ast` definition is a USER's formula: it arrives from the builder or the
// concierge, through `validateUserDefinitions`, and is INSTALLED per session by
// `installUserDefinitions` below. The shipped manifest (`registrySizes.js`,
// `SHIPPED_DEF_IDS.ast`) is the ONE declaration that this build ships none;
// `idsByLane(listDefinitions())` proves it by partition. (W0.3 retired the
// frozen-empty `AST_DEFS` that used to stand here as a second authority.)

/**
 * The `CHART_DEFAULTS.indicators` keys that deliberately have NO definition.
 *
 * ⛔ B3 DECISION, 2026-08-02, recorded so it is not re-litigated: `volumeProfile`
 * NEVER becomes a `plots[]` definition. It is a CANVAS OVERLAY — `StockChart`
 * draws horizontal volume bins straight onto a 2D context (the "Volume Profile
 * canvas overlay" effect → `drawVolumeProfile`), there is no compute function
 * for it in `indicators.js`, and no v1 plot style expresses it. `bgband` and
 * `fill` are schema-RESERVED and neither is what it draws anyway. A definition
 * for it would be one that cannot be computed and cannot be bound: a registry
 * entry that lies.
 *
 * It gets a `compute.kind: 'primitive'` lane when one exists — the same lane
 * `zones` and `bgband` are waiting on, Phase C/D. Until then the legacy canvas
 * effect IS the implementation, and no flip may delete it. ⭐ B5 TASK 13 MADE THAT
 * STRUCTURAL RATHER THAN A RULE: it used to read *"adding a carved-out key to
 * `flipState.ENGINE_MIGRATED_DEF_IDS` would stand its legacy block down with no
 * engine series to take over"*, and that hand-written set is deleted —
 * `flipState.engineOwnsDefId` asks THIS registry, so a carved-out key cannot be
 * added to it at all without first being given the definition that cannot exist.
 *
 * THE COUNT, CORRECTED. The platform has **15 indicator settings keys and 14
 * series-expressible indicators**. Spec §2/§5's "the 15 natives" counted settings
 * keys. `nativeRegistry.test.js` asserts `settings keys − definitions == this
 * set`, so the arithmetic cannot quietly drift in either direction: a 16th
 * settings key that nobody defined fails it, and so does a definition for a key
 * that is still listed here.
 *
 * WHY IT IS A LITERAL AND NOT DERIVED FROM `CHART_DEFAULTS`. A set computed as
 * "the keys with no definition" would be true by construction and could never
 * fail — the exact vacuous-gate shape this rail exists to avoid. It is written
 * down by hand so the test can disagree with it.
 */
export const CARVED_OUT_INDICATOR_KEYS = Object.freeze(new Set(['volumeProfile']))

/** ⭐ ONE INDEX ACROSS BOTH LANES. `getDefinition` is what `instances.js` and the
 *  binder resolve through, so a server definition missing from here would be an
 *  instance the chart drops on the floor — visible as nothing at all. */
const _byId = new Map([...NATIVE_DEFS, ...SERVER_DEFS].map(d => [d.id, d]))

// ─── the RUNTIME lane: definitions installed by THIS SESSION ────────────────
//
// 🔴 PHASE D TASK 16 — THE DOOR THAT DID NOT EXIST, AND THE SIX TASKS IT COST.
// Task 11 shipped a builder a trader could type `sma(close, 20)` into. It
// parsed, budgeted, linted, passed `validateUserDefinitions` and persisted to
// `/api/user-definitions` — and could not draw one pixel on any chart. The cause
// was one line: `_byId` above is built ONCE at module import out of two FROZEN
// arrays, and the ONLY operation this file ever performed on `_byId` was
// `.get`. So `getDefinition('u_…')` answered null, `validateInstance` failed
// with *"names no registered definition"*, `normalizeInstances` dropped the
// instance before layout, and the chart built two panes where three were asked
// for. ~6,100 frontend tests were green over it: every component was correct
// alone, and the defect lived in the CONTRACT between them — the fifth on this
// project, and the reason the repo's own lesson says budget a live-surface pass
// on every visual feature.
//
// ⛔ IT IS A SECOND INDEX, NOT A MUTATION OF `_byId`, and the separation is the
// design rather than an implementation detail. `NATIVE_DEFS` / `SERVER_DEFS`
// are frozen catalogues of WHAT SHIPS; `registrySizes.js` is a hand-written
// manifest this registry must PROVE it equals, by lane and by name, and it
// imports NOTHING so it cannot derive from the thing it checks. A user's
// formula is not shipped — it arrives per user, per session — and it must not
// be able to make that manifest true by joining it. Two indexes keep both facts
// sayable at once, and the split is by QUESTION:
// `listDefinitions()` answers *what does this build ship*, `getDefinition`
// answers *what can this chart resolve*.

/** User definitions installed at RUNTIME — one tab's worth, never persisted.
 *
 *  The durable copy is the append-only store behind `/api/user-definitions`;
 *  this Map is an index a reload rebuilds from it. A module that remembered
 *  across reloads would be a fourth place a definition lives. */
const _userById = new Map()

/**
 * Bumped iff the installed SET actually changed.
 *
 * ⚠️ IT EXISTS BECAUSE A DERIVED SET WAS MEMOISED FOREVER. `paneLayout`'s
 * `paneTargetIds()` cached "the ids that reserve a pane" on its FIRST call and
 * never again — correct while the catalogue was frozen at import, and silently
 * wrong the moment a definition can arrive later: a user's oscillator installed
 * after the first paint would never get a band, so the series would be created
 * into a pane the layout never reserved. Any memo over this registry must be
 * keyed on this counter rather than on `null`.
 *
 * @returns {number}
 */
let _generation = 0

export function registryGeneration() { return _generation }

/** `id@version#fn` — the identity an install compares on.
 *
 *  Two documents with the same id, version and compute handle are the SAME
 *  CLAIM, so re-installing one must not bump the generation: `useUserDefinitions`
 *  is an SWR list that revalidates, and a bump per poll would rebuild every
 *  registry-derived memo on the chart path each time the tab regained focus. */
function installKey(def) {
  return `${def.id}@${def.version}#${def.compute && def.compute.fn}`
}

/**
 * Install user definitions so `getDefinition` — and through it the instance
 * validator, the binder and the pane layout — can resolve them.
 *
 * ⛔ VALIDATION IS NEITHER SKIPPED NOR DUPLICATED. This calls
 * `validateUserDefinitions`, the one door, and installs ONLY what comes back in
 * `defs`. A definition whose repaint badge disagrees with the linter, whose
 * budget is blown, whose lane this client cannot run or which declares two
 * data-bearing plots is refused HERE exactly as it is refused in the builder —
 * because "it is already saved" is not a reason to draw something the gates say
 * is wrong. ⚠️ Task 10 named this directly: a stored verdict goes STALE. A
 * closed-table entry removed, a budget cap lowered or a linter that learns
 * something new can invalidate a definition that was legal the day it was
 * written, and the honest outcome is that it stops drawing and returns a
 * sentence — not that it draws on a verdict nobody re-measured.
 *
 * ⛔ A SHIPPED ID IS NOT OVERWRITABLE. A user definition claiming `rsi` would
 * shadow the native for every chart in the tab: the settings row, the legend
 * chip, the alert address and the pane height all resolve through one lookup.
 * `getDefinition` consults the shipped index FIRST, and an install under a
 * shipped id is REFUSED with a sentence rather than silently ignored — a silent
 * ignore reads, from the builder, exactly like a save that worked.
 *
 * @param {object[]} rawDefs
 * @returns {{installed: object[], errors: string[]}} `installed` is what
 *          `getDefinition` will now answer with — never the input documents.
 */
export function installUserDefinitions(rawDefs) {
  const { defs, errors, killedIds } = validateUserDefinitions(rawDefs)
  const installed = []
  // ⛔ RF — A KILL TAKES THE INSTALLED COPY OFF THIS TAB. Before RF a re-read
  // that served a listed runtime document (same id and version, now stamped
  // `meta.runtimeKilled`) was refused here while the copy installed before the
  // kill stayed in `_userById` and kept drawing until a full page reload. The
  // stored row is untouched (the server never deletes it); only this tab's
  // installed copy goes, and the binder draws nothing for the instance.
  for (const id of killedIds || []) {
    if (_userById.has(id)) { _userById.delete(id); _generation += 1 }
  }
  for (const def of defs) {
    if (_byId.has(def.id)) {
      errors.push(
        `${def.id}: a SHIPPED definition already owns this id — installing over it would shadow ` +
        `the one this repo authored for every chart in this tab, and the settings row, the legend ` +
        `chip, the alert address and the pane height all resolve through the same lookup.`,
      )
      continue
    }
    const prev = _userById.get(def.id)
    if (prev && installKey(prev) === installKey(def)) { installed.push(prev); continue }
    _userById.set(def.id, def)
    _generation += 1
    installed.push(def)
  }
  return { installed, errors }
}

/** Forget every installed user definition — a sign-out, or a test's teardown.
 *
 *  ⚠️ CALLERS MUST NOT USE THIS AS A GENERAL "the fetch failed" RESET. A
 *  transport failure is not evidence that a user has no definitions, and
 *  clearing on one would take a drawn indicator off a chart on a network blip.
 *  `useInstalledUserDefinitions` clears only on an AUTHORITATIVE refusal. */
export function clearUserDefinitions() {
  if (_userById.size === 0) return
  _userById.clear()
  _generation += 1
}

/** Forget ONE installed user definition — the editor's live preview when the
 *  sheet closes or the draft stops evaluating (W1a hand-back, additive).
 *  ⚠️ NOT a save-path door: a stored definition is replaced by re-install, never
 *  uninstalled, because an instance on a chart still names its id.
 *  @returns {boolean} whether anything was forgotten */
export function uninstallUserDefinition(defId) {
  if (!_userById.has(defId)) return false
  _userById.delete(defId)
  _generation += 1
  return true
}

/** @returns {object[]} the user definitions installed in THIS session. */
export function listUserDefinitions() {
  return [..._userById.values()]
}

/**
 * @returns {object|null} the definition, or null when nothing is registered under `defId`.
 *
 * ⭐ IT READS BOTH INDEXES AND THE SHIPPED ONE FIRST. This is the door every
 * consumer that has to RESOLVE an id goes through — `instances.validateInstance`,
 * `binder`, `paneLayout.paneHeightFor`, `flipState.engineOwnsDefId` and through
 * it `ENGINE_OWNED.has` — so widening it here is what makes a user's formula
 * addressable everywhere at once, with no second lookup anybody can forget.
 */
export function getDefinition(defId) {
  return _byId.get(defId) || _userById.get(defId) || null
}

/**
 * @returns {object[]} every registered definition — BOTH LANES.
 *
 * ⭐ THE UNION IS THE ONE LINE TASK 14 HANDED BACK — this used to be
 * `[...NATIVE_DEFS]` (Phase C Task 13; the ast lane joined at Phase D Task 8).
 * A caller that wants only the natives asks `NATIVE_DEFS`; a caller enumerating
 * "what indicators exist" must see every lane that HAS members, because a
 * definition invisible to this list is invisible to the catalog, the settings
 * migration and the alert addressing alike. The ast lane has none to spread —
 * W0.3 retired its frozen-empty array, and `SHIPPED_DEF_IDS.ast` is the one
 * place that claim is now declared.
 *
 * ⛔ AND THE NUMBER IS NOT WRITTEN DOWN HERE. `registrySizes.js` holds the one
 * hand-written manifest of what ships, by lane, by name; a count typed into a
 * comment is a count that rots, and this one already did — it read "16 NATIVE +
 * 1 SERVER" through a phase that added a lane.
 */
export function listDefinitions() {
  return [...NATIVE_DEFS, ...SERVER_DEFS]
}

/**
 * Every definition THIS CHART CAN RESOLVE — the shipped catalogue plus the user
 * definitions installed in this session, shipped first.
 *
 * ⭐⭐ THE SPLIT IS PHASE D TASK 16'S ONE EXPLICIT DECISION, AND IT IS ASSERTED
 * RATHER THAN INTENDED. The alternative — teaching `listDefinitions()` to answer
 * with the session too — was rejected because THREE rails read that function to
 * prove what SHIPS:
 *
 *   * `idsByLane(listDefinitions())` must equal `SHIPPED_DEF_IDS`, ordered, by
 *     lane, by name — the one equality thirty-three hand-typed assertions
 *     collapsed into;
 *   * `listDefinitions().length` must equal `REGISTRY_SIZES.total`;
 *   * `REGISTRY_SIZES.ast` must be 0, which is the claim *"Task 8 built the lane
 *     and registered nothing on it"*.
 *
 * `registrySizes.js` imports NOTHING precisely so the manifest cannot derive
 * from the registry it checks (asserted by AST, with a positive control). If
 * `listDefinitions()` answered with installed definitions, all three of those
 * rails would silently become statements about WHO IS SIGNED IN — and they would
 * still pass in a suite that installs nothing, which is the worst outcome
 * available: a gate that reads green while measuring something other than what
 * it says. A user's formula is not a shipped definition and must never be able
 * to make the shipped manifest true by joining it.
 *
 * So: `listDefinitions()` = the CATALOGUE. `getDefinition` = the SESSION.
 * This function = the session's whole answer, for the two places that need the
 * set rather than one id (`paneLayout.paneTargetIds`, and any future catalogue
 * that means to offer a user their own formulas). `nativeRegistry.test.js`
 * proves the choice cannot weaken the rails by INSTALLING a valid user
 * definition and re-checking all three while `getDefinition` resolves it.
 *
 * ⚠️ SHIPPED FIRST, AND THE ORDER IS LOAD-BEARING WHERE IT IS READ AS Z-ORDER.
 * `instanceControls.stackOrderRank` ranks by position in the SHIPPED list and
 * files anything unranked last, so a user's formula already stacks below the
 * shipped overlays; this function keeps the same relation for any caller that
 * takes its order from here instead.
 *
 * @returns {object[]}
 */
export function listAllDefinitions() {
  return [...listDefinitions(), ...listUserDefinitions()]
}
