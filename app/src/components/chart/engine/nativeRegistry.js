// app/src/components/chart/engine/nativeRegistry.js
//
// ─── The 15 shipped indicators, expressed as engine definitions ──────────────
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
//   2. computeFor() — the adapter that turns fifteen bespoke return shapes into
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
// The chart ships 15 indicators; this registry has 14. `volumeProfile` is a
// CANVAS OVERLAY: it has no compute function in `indicators.js`, it draws
// horizontal volume bins directly onto a canvas primitive rather than through a
// lightweight-charts series, and no v1 plot style can express it (`bgband` and
// `fill` are schema-RESERVED, and neither is what it draws anyway). Adding a
// definition for it would mean adding one that cannot be computed or bound — a
// registry entry that lies. It is a deliberate B3 carve-out; leave it out.
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

/** A pane with a FIXED range (RSI 0-100 …). `placement.scale` present ⇒ the
 *  binder applies `{autoScale:false, minimum, maximum}`; absent ⇒ autoscale.
 *  That is the same distinction StockChart makes today by passing (or not
 *  passing) `bandExtra` to `applyIndScale`. */
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
    { name: 'Relative Strength Index', shortName: 'RSI', category: 'Momentum' },
    fixedPane(0, 100),
    [
      periodInput('period', 'Period', 14, 2, 100),
      colorInput('color', 'Color', '#7b68ee'),
    ],
    [
      { key: 'rsi', label: 'RSI', style: 'line', color: '$color', width: 1, role: 'primary' },
      // 70/30 and 50 are separate plots because they are separate price lines with
      // different alphas and line styles — one `hlines` plot carries one style.
      { key: 'bands', label: '70 / 30', style: 'hlines', levels: [70, 30], color: 'rgba(123,104,238,0.4)', width: 1, lineStyle: 'dashed', role: 'context' },
      { key: 'midline', label: '50', style: 'hlines', levels: [50], color: 'rgba(123,104,238,0.2)', width: 1, lineStyle: 'largeDashed', role: 'context' },
    ]),

  // ── MACD ─────────────────────────────────────────────────────────────────
  nativeDef('macd', 'macd',
    { name: 'MACD', shortName: 'MACD', category: 'Momentum' },
    autoPane,
    [
      periodInput('fastPeriod', 'Fast', 12, 1, 100),
      periodInput('slowPeriod', 'Slow', 26, 1, 200),
      periodInput('signalPeriod', 'Signal', 9, 1, 50),
      colorInput('macdColor', 'MACD', '#2196F3'),
      colorInput('signalColor', 'Signal', '#FF9800'),
    ],
    [
      { key: 'macd', label: 'MACD', style: 'line', color: '$macdColor', width: 1, role: 'primary' },
      { key: 'signal', label: 'Signal', style: 'line', color: '$signalColor', width: 1, role: 'secondary' },
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
      {
        key: 'histogram', label: 'Histogram', style: 'histogram', colorMode: 'sign',
        colorUp: 'rgba(76,175,80,0.75)', colorDown: 'rgba(244,67,54,0.75)',
        precision: 5, role: 'secondary',
      },
      { key: 'zero', label: '0', style: 'hlines', levels: [0], color: 'rgba(255,255,255,0.12)', width: 1, lineStyle: 'largeDashed', role: 'context' },
    ]),

  // ── Bollinger Bands ──────────────────────────────────────────────────────
  nativeDef('bb', 'bb',
    { name: 'Bollinger Bands', shortName: 'BB', category: 'Volatility' },
    onPrice,
    [
      periodInput('period', 'Period', 20, 2, 200),
      { key: 'stdDev', type: 'float', label: 'Std Dev', default: 2, min: 0.5, max: 5, step: 0.5 },
      colorInput('color', 'Color', 'rgba(156,39,176,0.85)'),
    ],
    [
      { key: 'upper', label: 'Upper', style: 'line', color: '$color', width: 1, lineStyle: 'dashed', role: 'secondary' },
      // The middle IS the band's centre column; `edges` names the two that bound
      // it. See defSchema's validateBandEdges for why the edges stay real plots.
      { key: 'middle', label: 'Basis', style: 'band', edges: { upper: 'upper', lower: 'lower' }, color: '$color', width: 1, lineStyle: 'solid', role: 'primary' },
      { key: 'lower', label: 'Lower', style: 'line', color: '$color', width: 1, lineStyle: 'dashed', role: 'secondary' },
    ]),

  // ── Session VWAP ─────────────────────────────────────────────────────────
  nativeDef('vwap', 'vwap',
    { name: 'Session VWAP', shortName: 'VWAP', category: 'Volume' },
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
      { key: 'vwap', label: 'VWAP', style: 'line', color: '$color', width: '$lineWidth', role: 'primary' },
    ]),

  // ── Stochastic ───────────────────────────────────────────────────────────
  nativeDef('stoch', 'stoch',
    { name: 'Stochastic Oscillator', shortName: 'Stoch', category: 'Momentum' },
    fixedPane(0, 100),
    [
      periodInput('kPeriod', '%K Period', 14, 1, 100),
      periodInput('dPeriod', '%D Period', 3, 1, 20),
      colorInput('kColor', '%K', '#FF6B6B'),
      colorInput('dColor', '%D', '#4ECDC4'),
    ],
    [
      { key: 'k', label: '%K', style: 'line', color: '$kColor', width: 1, role: 'primary' },
      { key: 'd', label: '%D', style: 'line', color: '$dColor', width: 1, lineStyle: 'dashed', role: 'secondary' },
      // 80 takes %K's colour and 20 takes %D's — two guides, two plots.
      { key: 'overbought', label: '80', style: 'hlines', levels: [80], color: 'rgba(255,107,107,0.4)', width: 1, lineStyle: 'dashed', role: 'context' },
      { key: 'oversold', label: '20', style: 'hlines', levels: [20], color: 'rgba(78,205,196,0.4)', width: 1, lineStyle: 'dashed', role: 'context' },
    ]),

  // ── ATR ──────────────────────────────────────────────────────────────────
  nativeDef('atr', 'atr',
    { name: 'Average True Range', shortName: 'ATR', category: 'Volatility' },
    autoPane,
    [
      periodInput('period', 'Period', 14, 1, 100),
      colorInput('color', 'Color', '#FFA726'),
    ],
    [
      { key: 'atr', label: 'ATR', style: 'line', color: '$color', width: 1, role: 'primary' },
    ]),

  // ── Parabolic SAR ────────────────────────────────────────────────────────
  nativeDef('sar', 'sar',
    { name: 'Parabolic SAR', shortName: 'SAR', category: 'Trend' },
    onPrice,
    [
      { key: 'step', type: 'float', label: 'Step', default: 0.02, min: 0.001, max: 0.1, step: 0.001 },
      { key: 'maxStep', type: 'float', label: 'Max step', default: 0.2, min: 0.01, max: 1, step: 0.01 },
      colorInput('color', 'Color', '#ffeb3b'),
    ],
    [
      // Dots, not a line: StockChart builds a LineSeries with lineWidth 0 and
      // pointMarkersVisible/Radius. `markers` is the style that says that.
      { key: 'sar', label: 'SAR', style: 'markers', color: '$color', width: 3, role: 'primary' },
    ]),

  // ── Ichimoku Cloud ───────────────────────────────────────────────────────
  nativeDef('ichimoku', 'ichimoku',
    { name: 'Ichimoku Cloud', shortName: 'Ichimoku', category: 'Trend' },
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
      { key: 'tenkan', label: 'Tenkan', style: 'line', color: '$tenkanColor', width: 1, role: 'primary' },
      { key: 'kijun', label: 'Kijun', style: 'line', color: '$kijunColor', width: 1, role: 'primary' },
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
    { name: 'Money Flow Index', shortName: 'MFI', category: 'Volume' },
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
    { name: 'Commodity Channel Index', shortName: 'CCI', category: 'Momentum' },
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
    { name: 'Williams %R', shortName: '%R', category: 'Momentum' },
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
    { name: 'Average Directional Index', shortName: 'ADX', category: 'Trend' },
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
    { name: 'On-Balance Volume', shortName: 'OBV', category: 'Volume' },
    autoPane,
    [
      colorInput('color', 'Color', '#9ca3af'),
    ],
    [
      { key: 'obv', label: 'OBV', style: 'line', color: '$color', width: 1, role: 'primary' },
    ]),

  // ── Donchian Channels ────────────────────────────────────────────────────
  nativeDef('donchian', 'donchian',
    { name: 'Donchian Channels', shortName: 'Donchian', category: 'Volatility' },
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
 * ⚠️ THE MACD HEAD-MASK — a deliberate B1 pixel-parity hold, carried here from
 * `StockChart.jsx:3952-3965`. Do not "simplify" it away.
 *
 * `computeMACD` emits the MACD line from bar `slowPeriod-1`, which is
 * `signalPeriod-1` bars EARLIER than the signal line — mathematically right, and
 * what the Python lane has always done (the golden fixtures caught the two
 * disagreeing on 8 bars of a default 12/26/9). This chart has always started the
 * line together with its signal, so the head is masked back to the signal's
 * first bar. Dropping the mask draws the line ~8 bars earlier at the very start
 * of history: correct, visible, and therefore owner-signed-off in B3 — not
 * something that rides along with an engine refactor.
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

/** Per-`compute.fn` post-processing that is a RENDER hold rather than maths. */
const COLUMN_HOLDS = { macd: maskMacdHead }

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

const _byId = new Map(NATIVE_DEFS.map(d => [d.id, d]))

/** @returns {object|null} the definition, or null when nothing is registered under `defId`. */
export function getDefinition(defId) {
  return _byId.get(defId) || null
}

/** @returns {object[]} every registered native definition. */
export function listDefinitions() {
  return [...NATIVE_DEFS]
}
