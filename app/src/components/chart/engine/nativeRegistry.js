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
// One column per DATA-BEARING plot. `hlines` plots — the 70/50/30 guides and
// friends — are static levels, not series: they declare `levels` and return no
// column. `columnKeys(def)` is the authority on which plots bear data, and
// nothing else in the engine should re-derive that rule.
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
// price-scale id from the settings key, `computePaneMargins` stacks panes by it,
// and Task 3's migrator maps `cs.indicators[key]` onto a definition. Keeping
// defId == settings key makes all three an identity rather than a lookup table.

import {
  validateDefinition,
  validateSourceReferents,
  SCHEMA_VERSION,
} from './defSchema'
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
} from '../indicators'

// ─── shared fragments ────────────────────────────────────────────────────────

/** Every native is a `native`-lane, non-repainting, free-tier indicator today. */
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
const fixedPane = (min, max) => ({ target: 'pane', scale: { min, max } })
const autoPane = { target: 'pane' }
const onPrice = { target: 'price' }

const colorInput = (key, label, dflt) => ({ key, type: 'color', label, default: dflt })
const periodInput = (key, label, dflt, min, max) => ({
  key, type: 'int', label, default: dflt, min, max, step: 1,
})

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

const RAW_DEFS = [
  // ── RSI ──────────────────────────────────────────────────────────────────
  nativeDef('rsi', 'rsi',
    { name: 'Relative Strength Index', shortName: 'RSI', category: 'Momentum', legendParams: ['period'],
      description: 'Momentum on a 0-100 scale: how much of recent movement has been up.',
      tags: ['oscillator', 'momentum'] },
    fixedPane(0, 100),
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
    autoPane,
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
      tags: ['overlay', 'volatility', 'bands'] },
    onPrice,
    [
      periodInput('period', 'Period', 20, 2, 200),
      { key: 'stdDev', type: 'float', label: 'Std Dev', default: 2, min: 0.5, max: 5, step: 0.5 },
      colorInput('color', 'Color', 'rgba(156,39,176,0.85)'),
    ],
    [
      // The shipped legend has no Bollinger chip.
      { key: 'upper', label: 'Upper', style: 'line', color: '$color', width: 1, lineStyle: 'dashed', role: 'secondary', legend: { hide: true } },
      // The middle IS the band's centre column; `edges` names the two that bound
      // it. See defSchema's validateBandEdges for why the edges stay real plots.
      { key: 'middle', label: 'Basis', style: 'band', edges: { upper: 'upper', lower: 'lower' }, color: '$color', width: 1, lineStyle: 'solid', role: 'primary', legend: { hide: true } },
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
      // The shipped legend has no VWAP chip.
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
        role: 'primary', legend: { hide: true },
      },
    ]), compute: { kind: 'native', fn: 'vwap', rev: 2 } }),

  // ── Stochastic ───────────────────────────────────────────────────────────
  nativeDef('stoch', 'stoch',
    { name: 'Stochastic Oscillator', shortName: 'Stoch', category: 'Momentum',
      description: 'Where price closed inside its recent high-low range, smoothed.',
      tags: ['oscillator', 'momentum'] },
    fixedPane(0, 100),
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
    autoPane,
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
  nativeDef('sar', 'sar',
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
      periodInput('kijunPeriod', 'Kijun', 26, 1, 200),
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
      { key: 'chikou', label: 'Chikou', style: 'line', color: '$chikouColor', width: 1, lineStyle: 'dashed', role: 'secondary' },
    ]),

  // ── MFI ──────────────────────────────────────────────────────────────────
  nativeDef('mfi', 'mfi',
    { name: 'Money Flow Index', shortName: 'MFI', category: 'Volume',
      description: 'RSI weighted by volume — momentum that only counts when size shows up.',
      tags: ['oscillator', 'volume', 'momentum'] },
    fixedPane(0, 100),
    [
      periodInput('period', 'Period', 14, 2, 100),
      colorInput('color', 'Color', '#c084fc'),
    ],
    [
      { key: 'mfi', label: 'MFI', style: 'line', color: '$color', width: 1, role: 'primary' },
      { key: 'bands', label: '80 / 20', style: 'hlines', levels: [80, 20], color: 'rgba(192,132,252,0.4)', width: 1, lineStyle: 'dashed', role: 'context' },
    ]),

  // ── CCI ──────────────────────────────────────────────────────────────────
  nativeDef('cci', 'cci',
    { name: 'Commodity Channel Index', shortName: 'CCI', category: 'Momentum',
      description: 'How far price sits from its own average, in units of its typical deviation.',
      tags: ['oscillator', 'momentum'] },
    autoPane,
    [
      periodInput('period', 'Period', 20, 2, 200),
      colorInput('color', 'Color', '#fbbf24'),
    ],
    [
      { key: 'cci', label: 'CCI', style: 'line', color: '$color', width: 1, role: 'primary' },
      { key: 'bands', label: '±100', style: 'hlines', levels: [100, -100], color: 'rgba(251,191,36,0.4)', width: 1, lineStyle: 'dashed', role: 'context' },
      { key: 'zero', label: '0', style: 'hlines', levels: [0], color: 'rgba(251,191,36,0.2)', width: 1, lineStyle: 'largeDashed', role: 'context' },
    ]),

  // ── Williams %R ──────────────────────────────────────────────────────────
  nativeDef('williamsR', 'williams_r',
    { name: 'Williams %R', shortName: '%R', category: 'Momentum',
      description: 'Where price closed in its recent range, on a -100 to 0 scale.',
      tags: ['oscillator', 'momentum'] },
    fixedPane(-100, 0),
    [
      periodInput('period', 'Period', 14, 2, 100),
      colorInput('color', 'Color', '#60a5fa'),
    ],
    [
      // `williams_r`, not `williamsR`: _CASE_COLUMNS names it that, and the two
      // lanes assert the same fixtures. See the module docstring.
      { key: 'williams_r', label: '%R', style: 'line', color: '$color', width: 1, role: 'primary' },
      { key: 'bands', label: '-20 / -80', style: 'hlines', levels: [-20, -80], color: 'rgba(96,165,250,0.4)', width: 1, lineStyle: 'dashed', role: 'context' },
    ]),

  // ── ADX / DMI ────────────────────────────────────────────────────────────
  nativeDef('adx', 'adx',
    { name: 'Average Directional Index', shortName: 'ADX', category: 'Trend',
      description: 'How strong the trend is, regardless of direction, with the two directional lines.',
      tags: ['trend', 'strength'] },
    fixedPane(0, 100),
    [
      periodInput('period', 'Period', 14, 2, 100),
      colorInput('adxColor', 'ADX', '#e5e7eb'),
      colorInput('plusDIColor', '+DI', '#22c55e'),
      colorInput('minusDIColor', '-DI', '#ef4444'),
    ],
    [
      { key: 'adx', label: 'ADX', style: 'line', color: '$adxColor', width: 2, role: 'primary' },
      { key: 'plusDI', label: '+DI', style: 'line', color: '$plusDIColor', width: 1, role: 'secondary' },
      { key: 'minusDI', label: '-DI', style: 'line', color: '$minusDIColor', width: 1, role: 'secondary' },
      { key: 'trend', label: '25', style: 'hlines', levels: [25], color: 'rgba(229,231,235,0.3)', width: 1, lineStyle: 'dashed', role: 'context' },
    ]),

  // ── OBV ──────────────────────────────────────────────────────────────────
  nativeDef('obv', 'obv',
    { name: 'On-Balance Volume', shortName: 'OBV', category: 'Volume',
      description: 'A running volume total that adds on up bars and subtracts on down bars.',
      tags: ['volume', 'accumulation'] },
    autoPane,
    [
      colorInput('color', 'Color', '#9ca3af'),
    ],
    [
      { key: 'obv', label: 'OBV', style: 'line', color: '$color', width: 1, role: 'primary' },
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
      // its middle is LWC LineStyle 3 (LargeDashed) — unnameable, so unstated.
      { key: 'middle', label: 'Mid', style: 'band', edges: { upper: 'upper', lower: 'lower' }, color: '$color', width: 1, role: 'primary' },
      { key: 'lower', label: 'Lower', style: 'line', color: '$color', width: 1, lineStyle: 'solid', role: 'secondary' },
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
  sar: (bars, p) => ({ sar: computeParabolicSAR(bars, p.step, p.maxStep) }),

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
 * This is still the ONE place to change it, and BOTH lanes still read it: the
 * engine's `COLUMN_HOLDS` below, and — because `macd` is not migrated — the legacy
 * `indicatorData` memo in `StockChart.jsx`, which is what a user actually sees.
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
 * The plot keys a definition returns a COLUMN for: every plot except static
 * `hlines` guides, which draw declared levels and compute nothing.
 *
 * The engine's one place for this rule. `computeFor` deliberately does NOT build
 * its output from this list — it builds from what the native actually returned —
 * so a definition and its compute drifting apart is a test failure, not a
 * silently empty column.
 */
export function columnKeys(def) {
  return (def?.plots || [])
    .filter(p => p && p.style !== 'hlines' && typeof p.key === 'string')
    .map(p => p.key)
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
 * Compute one native into the columnar contract.
 *
 * @param {object} def   a registry definition (its `compute.fn` selects the native)
 * @param {Array}  bars  `[{t,o,h,l,c,v}]` — columns are index-aligned to these
 * @param {object} inputs partial input map; anything missing uses the declared default
 * @returns {{[plotKey]: Float64Array}} one input-length NaN-padded column per data plot
 *
 * THROWS on an unknown `compute.fn`. Loud on purpose, mirroring
 * `indicator_compute.compute_case`: a definition naming a native this adapter
 * does not know must fail where it is wrong, not return `{}` and render blank.
 */
export function computeFor(def, bars, inputs) {
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
 * Validate and index a batch of definitions.
 *
 * Two passes, because they answer two different questions:
 *   1. `validateDefinition` — is each definition well-formed ON ITS OWN?
 *   2. `validateSourceReferents` — do its `source` inputs point at columns that
 *      EXIST? That needs the whole batch, which is why it could not live in
 *      defSchema's per-definition validator (B2 Task 2 carry-in b). A `source`
 *      resolving to nothing would silently compute over the wrong series, so it
 *      is rejected at registration exactly like an unresolvable `$ref`.
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

/** The 14 native definitions, frozen. `volumeProfile` is NOT among them. */
export const NATIVE_DEFS = Object.freeze(_registered.defs)

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
 * effect IS the implementation, and NO B3 flip may delete it: adding a carved-out
 * key to `flipState.ENGINE_MIGRATED_DEF_IDS` would stand its legacy block down
 * with no engine series to take over, and the profile would simply vanish.
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

const _byId = new Map(NATIVE_DEFS.map(d => [d.id, d]))

/** @returns {object|null} the definition, or null when nothing is registered under `defId`. */
export function getDefinition(defId) {
  return _byId.get(defId) || null
}

/** @returns {object[]} every registered native definition. */
export function listDefinitions() {
  return [...NATIVE_DEFS]
}
