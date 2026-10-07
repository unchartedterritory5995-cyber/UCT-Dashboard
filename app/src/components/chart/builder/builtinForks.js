// app/src/components/chart/builder/builtinForks.js
//
// ─── ⭐⭐ PHASE 4 — CUSTOMIZE A UCT BUILT-IN: A USER-OWNED COPY, NEVER A MUTATION ─
//
// PREBUILT     = a UCT-owned canonical implementation (`compute.kind: 'native'`).
// CUSTOM COPY  = a user-owned, independent formula definition derived from it.
// The built-in is never touched: "Create custom copy" builds a NEW `ast` document
// whose maths reproduces the native one, and stores it through the ordinary save
// door (POST — the server mints the id and decides the semantics).
//
// ⛔ ONLY WHERE THE COPY IS FAITHFUL. A built-in is customizable only when the
// formula below reproduces the native columns within the parity tolerance on every
// fixture history (`builtinForks.parity.test.js`, which runs EVERY entry here, under
// the semantics the store will actually stamp). Anything not listed — or whose maths
// a formula cannot express (SAR's coupled state, Supertrend's trailing band,
// Ichimoku's forward cloud, OBV/A-D's history-dependent level, an MA of another
// indicator, annualisation that depends on the bar spacing …) — stays available
// exactly as it is and answers "Not customizable yet". Nothing is approximated.
//
// ⭐ ONE DOCUMENT ARCHITECTURE. The copy is assembled through the Builder's own row
// model (`authoring/model.js` → `buildDefinition`), every row gated by the Builder's
// own `evaluateFormula` — so it opens in the Formula editor and in a conversation
// exactly like a formula the member typed.

// ⛔ THIS MODULE IS LIGHT ON PURPOSE: the legend, the inspector and the toolbar read
// `customizability` while rendering, and must not pull the Builder (and through it the
// chart) into their import graph. The document assembly lives in `builtinCopy.js`,
// loaded only when a member actually makes a copy.

/** The parity tolerance, stated once (see the parity test for the justification). */
export const PARITY_EPSILON = 1e-9

const int = (v, d) => (Number.isInteger(Number(v)) && Number(v) >= 1 ? Number(v) : d)
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)
/** Colour inputs: a plain CSS colour string, else null (the Builder's default applies). */
const col = (v) => (typeof v === 'string' && v.trim() && !v.startsWith('$') ? v : null)
const SRC_FIELDS = Object.freeze(['close', 'open', 'high', 'low', 'volume'])
/** A native `source` input the formula can read directly (an OHLCV field), else null. */
const srcOf = (v) => (SRC_FIELDS.includes(v) ? v : null)

/** The MA types a formula reproduces, as formula text over `s` and `p`. */
const MA_TEXT = Object.freeze({
  sma: (s, p) => `sma(${s}, ${p})`,
  ema: (s, p) => `ema(${s}, ${p})`,
  wma: (s, p) => `wma(${s}, ${p})`,
  hma: (s, p) => `hma(${s}, ${p})`,
  smma: (s, p) => `rma(${s}, ${p})`,
})

/**
 * Per built-in id: `(inputs) => spec | {refused}`. A spec is
 * `{name, target: 'price'|'pane', outputs: [{key, label, text, style?, color?, presentation?}], levels?}`.
 * Output keys mirror the native plot keys, so the parity test compares like for like.
 */
export const SPECS = Object.freeze({
  rsi: (p) => ({
    name: `RSI ${int(p.period, 14)}`, target: 'pane', levels: [70, 30, 50],
    outputs: [{ key: 'rsi', label: 'RSI', text: `rsi(close, ${int(p.period, 14)})`, color: col(p.color) }],
  }),
  macd: (p) => {
    const f = int(p.fastPeriod, 12); const s = int(p.slowPeriod, 26); const g = int(p.signalPeriod, 9)
    const line = `ema(close, ${f}) - ema(close, ${s})`
    return {
      name: `MACD ${f} ${s} ${g}`, target: 'pane', levels: [0],
      outputs: [
        { key: 'macd', label: 'MACD', text: line, color: col(p.macdColor) },
        { key: 'signal', label: 'Signal', text: `ema(${line}, ${g})`, color: col(p.signalColor) },
        { key: 'histogram', label: 'Histogram', text: `${line} - ema(${line}, ${g})`, style: 'histogram',
          presentation: { colorMode: 'sign', colorUp: 'rgba(76,175,80,0.75)', colorDown: 'rgba(244,67,54,0.75)' } },
      ],
    }
  },
  bb: (p) => {
    const n = int(p.period, 20); const k = num(p.stdDev, 2)
    return {
      name: `Bollinger Bands ${n} ${k}`, target: 'price',
      outputs: [
        { key: 'upper', label: 'Upper', text: `sma(close, ${n}) + ${k} * stdev(close, ${n})`, color: col(p.color) },
        { key: 'middle', label: 'Basis', text: `sma(close, ${n})`, color: col(p.color) },
        { key: 'lower', label: 'Lower', text: `sma(close, ${n}) - ${k} * stdev(close, ${n})`, color: col(p.color) },
      ],
    }
  },
  stoch: (p) => {
    const k = int(p.kPeriod, 14); const sk = int(p.smoothK, 1); const d = int(p.dPeriod, 3)
    const kText = sk > 1 ? `sma(stoch(high, low, close, ${k}), ${sk})` : `stoch(high, low, close, ${k})`
    return {
      name: `Stochastic ${k} ${sk} ${d}`, target: 'pane', levels: [80, 20],
      outputs: [
        { key: 'k', label: '%K', text: kText, color: col(p.kColor) },
        { key: 'd', label: '%D', text: `sma(${kText}, ${d})`, color: col(p.dColor) },
      ],
    }
  },
  atr: (p) => ({
    name: `ATR ${int(p.period, 14)}`, target: 'pane',
    outputs: [{ key: 'atr', label: 'ATR', text: `atr(high, low, close, ${int(p.period, 14)})`, color: col(p.color) }],
  }),
  cci: (p) => ({
    name: `CCI ${int(p.period, 20)}`, target: 'pane', levels: [100, -100, 0],
    outputs: [{ key: 'cci', label: 'CCI', text: `cci(high, low, close, ${int(p.period, 20)})`, color: col(p.color) }],
  }),
  williamsR: (p) => ({
    name: `Williams %R ${int(p.period, 14)}`, target: 'pane', levels: [-20, -80],
    outputs: [{ key: 'williams_r', label: '%R', text: `williamsR(high, low, close, ${int(p.period, 14)})`, color: col(p.color) }],
  }),
  mfi: (p) => ({
    name: `MFI ${int(p.period, 14)}`, target: 'pane', levels: [80, 20],
    outputs: [{ key: 'mfi', label: 'MFI', text: `mfi(high, low, close, volume, ${int(p.period, 14)})`, color: col(p.color) }],
  }),
  adx: (p) => {
    const n = int(p.period, 14)
    return {
      name: `ADX ${n}`, target: 'pane', levels: [25],
      outputs: [
        { key: 'adx', label: 'ADX', text: `adx(high, low, close, ${n})`, color: col(p.adxColor) },
        { key: 'plusDI', label: '+DI', text: `plusDI(high, low, close, ${n})`, color: col(p.plusDIColor) },
        { key: 'minusDI', label: '-DI', text: `minusDI(high, low, close, ${n})`, color: col(p.minusDIColor) },
      ],
    }
  },
  donchian: (p) => {
    const n = int(p.period, 20)
    return {
      name: `Donchian ${n}`, target: 'price',
      outputs: [
        { key: 'upper', label: 'Upper', text: `donchianUpper(high, low, ${n})`, color: col(p.color) },
        { key: 'middle', label: 'Middle', text: `donchianMiddle(high, low, ${n})`, color: col(p.color) },
        { key: 'lower', label: 'Lower', text: `donchianLower(high, low, ${n})`, color: col(p.color) },
      ],
    }
  },
  roc: (p) => {
    const s = srcOf(p.source); const n = int(p.period, 12)
    if (!s) return { refused: 'its source is another indicator' }
    return { name: `ROC ${n}`, target: 'pane', levels: [0],
      outputs: [{ key: 'roc', label: 'ROC', text: `100 * (${s} - ${s}[${n}]) / ${s}[${n}]`, color: col(p.color) }] }
  },
  momentum: (p) => {
    const s = srcOf(p.source); const n = int(p.period, 10)
    if (!s) return { refused: 'its source is another indicator' }
    return { name: `Momentum ${n}`, target: 'pane', levels: [0],
      outputs: [{ key: 'mom', label: 'MOM', text: `${s} - ${s}[${n}]`, color: col(p.color) }] }
  },
  movingAverage: (p) => {
    const s = srcOf(p.source); const n = int(p.period, 5); const t = MA_TEXT[p.maType || 'sma']
    if (!s) return { refused: 'its source is another indicator' }
    if (!t) return { refused: `the ${String(p.maType).toUpperCase()} type has no formula equivalent yet` }
    return { name: `${String(p.maType || 'sma').toUpperCase()} ${n}`, target: 'price',
      outputs: [{ key: 'ma', label: String(p.maType || 'sma').toUpperCase(), text: t(s, n), color: col(p.color) }] }
  },
  standardDeviation: (p) => {
    const s = srcOf(p.source); const n = int(p.period, 20)
    if (!s) return { refused: 'its source is another indicator' }
    return { name: `Std Dev ${n}`, target: 'pane',
      outputs: [{ key: 'stdev', label: 'StDev', text: `stdev(${s}, ${n})`, color: col(p.color) }] }
  },
  atrPercent: (p) => ({
    name: `ATR % ${int(p.period, 14)}`, target: 'pane',
    outputs: [{ key: 'atrPct', label: 'ATR%', text: `100 * atr(high, low, close, ${int(p.period, 14)}) / close`, color: col(p.color) }],
  }),
  bullBearPower: (p) => {
    const n = int(p.period, 13)
    return {
      name: `Bull Bear Power ${n}`, target: 'pane', levels: [0],
      outputs: [
        { key: 'bull', label: 'Bull', text: `high - ema(close, ${n})`, style: 'histogram', color: col(p.bullColor) },
        { key: 'bear', label: 'Bear', text: `low - ema(close, ${n})`, style: 'histogram', color: col(p.bearColor) },
      ],
    }
  },
  awesome: (p) => {
    const f = int(p.fastPeriod, 5); const s = int(p.slowPeriod, 34)
    return { name: `Awesome ${f} ${s}`, target: 'pane', levels: [0],
      outputs: [{ key: 'ao', label: 'AO', text: `sma((high + low) / 2, ${f}) - sma((high + low) / 2, ${s})`, style: 'histogram' }] }
  },
})

/** Is this built-in customizable? `{ok: true}` or `{ok: false, reason}` (member words). */
export function customizability(def, inputs = {}) {
  if (!def || !def.compute || def.compute.kind !== 'native') return { ok: false, reason: 'This is not a UCT built-in.' }
  const spec = SPECS[def.id]
  if (!spec) return { ok: false, reason: 'Not customizable yet — this built-in can’t be reproduced exactly as your own formula, so it stays as it is.' }
  const s = spec(inputs || {})
  if (s.refused) return { ok: false, reason: `Not customizable yet — ${s.refused}.` }
  return { ok: true }
}

/** The ids with a parity-proven custom copy (the parity test runs every one). */
export const CUSTOMIZABLE_BUILTINS = Object.freeze(Object.keys(SPECS))
