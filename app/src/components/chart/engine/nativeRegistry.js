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
import { serverColumnsFor } from './serverCompute'

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
    { name: 'Relative Strength Index', shortName: 'RSI', category: 'Momentum', legendParams: ['period'],
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
    { name: 'MACD', shortName: 'MACD', category: 'Momentum',
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
    { name: 'Bollinger Bands', shortName: 'BB', category: 'Volatility',
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
      name: 'Session VWAP', shortName: 'VWAP', category: 'Volume',
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
    ]), compute: { kind: 'native', fn: 'vwap', rev: 2 } }),

  // ── Stochastic ───────────────────────────────────────────────────────────
  nativeDef('stoch', 'stoch',
    { name: 'Stochastic Oscillator', shortName: 'Stoch', category: 'Momentum',
      description: 'Where price closed inside its recent high-low range, smoothed.',
      tags: ['oscillator', 'momentum'] },
    fixedPane(0, 100, 0.15),
    [
      periodInput('kPeriod', '%K Period', 14, 1, 100),
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
    { name: 'Average True Range', shortName: 'ATR', category: 'Volatility',
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
    { name: 'Parabolic SAR', shortName: 'SAR', category: 'Trend',
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
    { name: 'Ichimoku Cloud', shortName: 'Ichimoku', category: 'Trend',
      description: 'A trend system in one picture: two averages, a projected cloud and a lagging line.',
      tags: ['overlay', 'trend'] },
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
    { name: 'Money Flow Index', shortName: 'MFI', category: 'Volume',
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
    { name: 'Commodity Channel Index', shortName: 'CCI', category: 'Momentum',
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
    { name: 'Williams %R', shortName: '%R', category: 'Momentum',
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
    { name: 'Average Directional Index', shortName: 'ADX', category: 'Trend',
      description: 'How strong the trend is, regardless of direction, with the two directional lines.',
      legendParams: ['period'],
      tags: ['trend', 'strength'] },
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
    { name: 'On-Balance Volume', shortName: 'OBV', category: 'Volume',
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
    { name: 'Donchian Channels', shortName: 'Donchian', category: 'Volatility',
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
      name: 'Anchored VWAP', shortName: 'AVWAP', category: 'Volume',
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
    { name: 'ATR Bands', shortName: 'ATR Bands', category: 'Volatility',
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
]

// ─── the compute adapter ─────────────────────────────────────────────────────

/**
 * `compute.fn` → a function returning the native's raw output keyed BY COLUMN
 * NAME. Each entry is a translation only: it picks the inputs the native takes,
 * calls it, and re-keys the result. No maths lives here — that would be a second
 * implementation of an indicator, which is the thing the golden fixtures exist
 * to prevent.
 */
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

  vwap: (bars) => ({ vwap: computeVWAP(bars) }),

  stoch: (bars, p) => {
    const raw = computeStochastic(bars, p.kPeriod, p.dPeriod)
    return { k: raw.k, d: raw.d }
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
function astColumnsFor(def, bars, inputs, ctx) {
  const keys = astPlotKey(def)
  const trees = def && def.compute && def.compute.trees
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
  if (trees && typeof trees === 'object') {
    const out = {}
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
      out[key] = interpret(trees[key], bars, inputs, def.compute.budget,
        undefined, { tf: ctx && ctx.tf })
    }
    return out
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
  return {
    [keys[0]]: interpret(def.compute.ast, bars, inputs, def.compute.budget,
      undefined, { tf: ctx && ctx.tf }),
  }
}

/** Merge a caller's inputs over the definition's declared defaults. */
function resolveInputs(def, inputs) {
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
export function computeFor(def, bars, inputs, ctx) {
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
  const raw = fn(series, resolveInputs(def, inputs))

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
 * @returns {string[]} errors, empty when the definition can run here.
 */
function validateAstLane(def) {
  const errors = []
  const dataPlots = astPlotKey(def)
  const rawTrees = def.compute.trees
  const trees = (rawTrees && typeof rawTrees === 'object' && !Array.isArray(rawTrees)) ? rawTrees : null

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
    // ⚠️ THIS IS A BACKSTOP, NOT THE DOOR. `defSchema.validateTreesAgainstPlots`
    // refuses the key-set disagreement in both directions and runs first, so
    // nothing reaching here through `validateUserDefinitions` can fail this —
    // it exists because the loop below indexes `trees[k]` and an absent tree
    // must be a named refusal rather than an `undefined` handed to a linter.
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

  for (const def of base.defs) {
    const kind = def.compute.kind
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

  return { defs, errors }
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
    name: 'Relative Strength Line', shortName: 'RS', category: 'Momentum',
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
  const { defs, errors } = validateUserDefinitions(rawDefs)
  const installed = []
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
