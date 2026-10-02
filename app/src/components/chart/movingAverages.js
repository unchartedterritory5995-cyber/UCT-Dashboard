// app/src/components/chart/movingAverages.js
//
// ─── THE ONE MOVING-AVERAGE KIT ─────────────────────────────────────────────
//
// Every moving average the chart can draw, over a PLAIN NUMERIC SERIES (a
// resolved source column — close, volume, another indicator's output). The
// `movingAverage` definition picks one by `maType`; the Technical library's
// other studies (Keltner, Envelopes, PPO, TRIX, TSI, Stoch RSI, % from MA, …)
// compose the same functions rather than carrying private copies.
//
// ⛔⛔ SMA AND EMA ARE THE SHIPPED FUNCTIONS, MOVED, NOT REWRITTEN. `smaOfSeries`
// and `emaOfSeries` lived in `engine/nativeRegistry.js` and drew every Moving
// Average on every saved chart. They are byte-for-byte what they were — same
// running-sum order, same seed, same gap rule — so an existing SMA 50 or EMA 9
// produces the identical IEEE-754 numbers it produced before this file existed.
// `movingAverages.test.js` pins that against a copy of the original code.
//
// ── THE CONVENTIONS EVERY TYPE HERE SHARES ──────────────────────────────────
//
// • A NON-FINITE INPUT IS A GAP, AND A GAP RESTARTS THE WARM-UP. That is the
//   shipped SMA/EMA rule, so the new types follow it rather than inventing a
//   second one: an average is emitted only over a run of finite values long
//   enough to fill its window(s). No NaN/Infinity ever reaches an output value.
// • RECURSIVE AVERAGES SEED ON THE FIRST FULL SMA WINDOW (EMA, SMMA), the
//   TradingView `ta.ema` / `ta.rma` convention and what `computeEMA` does.
// • A LENGTH IS FLOORED AND CLAMPED TO ≥ 1.
//
// ── PER TYPE ────────────────────────────────────────────────────────────────
//
//   sma   Σx/n over the last n values.
//   ema   α = 2/(n+1), seeded with the SMA of the first n values.
//   wma   linear weights 1..n, newest heaviest: Σ(w·x)/Σw.
//   vwma  Σ(x·v)/Σv over n, v = the BAR's volume at the same index. A window
//         whose volume sums to 0 emits nothing (0/0 is not a price).
//   hma   Hull: wma(2·wma(x, ⌊n/2⌋) − wma(x, n), round(√n)), each length ≥ 1 —
//         the same arithmetic as the formula engine's `hma` (ast/interpret.js),
//         and TradingView's `ta.hma`.
//   smma  Wilder / RMA: seeded with SMA(n), then (prev·(n−1) + x)/n. The
//         smoothing RSI and ATR already use.
//   dema  2·e1 − e2, e1 = ema(x), e2 = ema(e1). First value at index 2n−2.
//   tema  3·e1 − 3·e2 + e3. First value at index 3n−3.
//   lsma  least-squares line fitted to the last n values, evaluated at the
//         newest bar (TradingView `ta.linreg(x, n, 0)`). n = 1 is the value.

/** The member-facing types, in dropdown order. The label is also the name stem
 *  (`HMA 21`) through `meta.nameFrom.stem`, so it is the short trader term. */
export const MA_TYPES = Object.freeze([
  Object.freeze(['sma', 'SMA']),
  Object.freeze(['ema', 'EMA']),
  Object.freeze(['wma', 'WMA']),
  Object.freeze(['vwma', 'VWMA']),
  Object.freeze(['hma', 'HMA']),
  Object.freeze(['smma', 'SMMA']),
  Object.freeze(['dema', 'DEMA']),
  Object.freeze(['tema', 'TEMA']),
  Object.freeze(['lsma', 'LSMA']),
])

export const MA_TYPE_IDS = Object.freeze(MA_TYPES.map(([id]) => id))

const len = (period) => Math.max(1, Math.floor(period) || 1)

// ─── the shipped two, verbatim ──────────────────────────────────────────────

/**
 * SMA over a plain numeric series → `{value}` points (holes undefined).
 *
 * ⚠️ NaN IS A GAP, NOT A ZERO, AND THE WARM-UP IS WHY THIS IS NOT `reduce`. A
 * window is emitted only when it is FULL of finite values — the reason
 * `MA(5, RSI(14))` starts at bar 18 rather than bar 4.
 */
export function smaOfSeries(src, period, n) {
  const out = new Array(n)
  const p = Math.max(1, Math.floor(period) || 1)
  let sum = 0
  let have = 0
  for (let i = 0; i < n; i++) {
    const v = src[i]
    if (Number.isFinite(v)) { sum += v; have++ } else { sum = 0; have = 0; continue }
    if (have > p) { const drop = src[i - p]; if (Number.isFinite(drop)) sum -= drop; have-- }
    if (have === p) out[i] = { value: sum / p }
  }
  return out
}

/** EMA over a plain numeric series, SEEDED ON THE FIRST FULL SMA WINDOW. */
export function emaOfSeries(src, period, n) {
  const out = new Array(n)
  const p = Math.max(1, Math.floor(period) || 1)
  const k = 2 / (p + 1)
  let prev = null
  let sum = 0
  let have = 0
  for (let i = 0; i < n; i++) {
    const v = src[i]
    if (!Number.isFinite(v)) { prev = null; sum = 0; have = 0; continue }
    if (prev === null) {
      sum += v; have++
      if (have === p) { prev = sum / p; out[i] = { value: prev } }
      continue
    }
    prev = v * k + prev * (1 - k)
    out[i] = { value: prev }
  }
  return out
}

// ─── numeric cores (NaN for "nothing here") ─────────────────────────────────

const nanArray = (n) => { const a = new Array(n); a.fill(NaN); return a }

/** `{value}` points → numbers, NaN where there is no point. */
export function pointsToNumbers(points, n) {
  const out = nanArray(n)
  if (!points) return out
  const m = Math.min(points.length, n)
  for (let i = 0; i < m; i++) {
    const v = points[i] ? points[i].value : undefined
    if (Number.isFinite(v)) out[i] = v
  }
  return out
}

/** numbers → `{value}` points, a hole wherever the number is not finite. */
export function numbersToPoints(values, n) {
  const out = new Array(n)
  const m = Math.min(values ? values.length : 0, n)
  for (let i = 0; i < m; i++) {
    const v = values[i]
    if (Number.isFinite(v)) out[i] = { value: v }
  }
  return out
}

export const sma = (src, period) => pointsToNumbers(smaOfSeries(src, period, src.length), src.length)
export const ema = (src, period) => pointsToNumbers(emaOfSeries(src, period, src.length), src.length)

/** Length of the run of consecutive finite values ending at each index. */
function finiteRuns(src) {
  const run = new Array(src.length)
  let r = 0
  for (let i = 0; i < src.length; i++) {
    r = Number.isFinite(src[i]) ? r + 1 : 0
    run[i] = r
  }
  return run
}

export function wma(src, period) {
  const n = src.length
  const p = len(period)
  const out = nanArray(n)
  const run = finiteRuns(src)
  const denom = (p * (p + 1)) / 2
  for (let i = 0; i < n; i++) {
    if (run[i] < p) continue
    let acc = 0
    for (let j = 0; j < p; j++) acc += src[i - p + 1 + j] * (j + 1)
    out[i] = acc / denom
  }
  return out
}

export function vwma(src, vol, period) {
  const n = src.length
  const p = len(period)
  const out = nanArray(n)
  let r = 0
  for (let i = 0; i < n; i++) {
    const x = src[i]
    const v = vol ? vol[i] : NaN
    r = (Number.isFinite(x) && Number.isFinite(v)) ? r + 1 : 0
    if (r < p) continue
    let pv = 0
    let sv = 0
    for (let j = i - p + 1; j <= i; j++) { pv += src[j] * vol[j]; sv += vol[j] }
    if (sv !== 0) out[i] = pv / sv
  }
  return out
}

export function smma(src, period) {
  const n = src.length
  const p = len(period)
  const out = nanArray(n)
  let prev = NaN
  let sum = 0
  let have = 0
  for (let i = 0; i < n; i++) {
    const v = src[i]
    if (!Number.isFinite(v)) { prev = NaN; sum = 0; have = 0; continue }
    if (Number.isNaN(prev)) {
      sum += v; have++
      if (have === p) { prev = sum / p; out[i] = prev }
      continue
    }
    prev = (prev * (p - 1) + v) / p
    out[i] = prev
  }
  return out
}

export function dema(src, period) {
  const e1 = ema(src, period)
  const e2 = ema(e1, period)
  return e1.map((a, i) => (Number.isFinite(a) && Number.isFinite(e2[i]) ? 2 * a - e2[i] : NaN))
}

export function tema(src, period) {
  const e1 = ema(src, period)
  const e2 = ema(e1, period)
  const e3 = ema(e2, period)
  return e1.map((a, i) => (Number.isFinite(a) && Number.isFinite(e2[i]) && Number.isFinite(e3[i])
    ? 3 * a - 3 * e2[i] + e3[i] : NaN))
}

export function hma(src, period) {
  const p = len(period)
  const half = Math.max(1, Math.floor(p / 2))
  const root = Math.max(1, Math.round(Math.sqrt(p)))
  const near = wma(src, half)
  const full = wma(src, p)
  const raw = near.map((v, i) => (Number.isFinite(v) && Number.isFinite(full[i]) ? 2 * v - full[i] : NaN))
  return wma(raw, root)
}

/** Least-squares endpoint over the last n values (x = 0..n−1, value at n−1). */
export function lsma(src, period) {
  const n = src.length
  const p = len(period)
  const out = nanArray(n)
  const run = finiteRuns(src)
  if (p === 1) {
    for (let i = 0; i < n; i++) if (run[i] >= 1) out[i] = src[i]
    return out
  }
  const sx = (p * (p - 1)) / 2
  const sxx = ((p - 1) * p * (2 * p - 1)) / 6
  const d = p * sxx - sx * sx
  for (let i = 0; i < n; i++) {
    if (run[i] < p) continue
    let sy = 0
    let sxy = 0
    for (let j = 0; j < p; j++) {
      const y = src[i - p + 1 + j]
      sy += y
      sxy += j * y
    }
    const slope = (p * sxy - sx * sy) / d
    const intercept = (sy - slope * sx) / p
    out[i] = intercept + slope * (p - 1)
  }
  return out
}

/**
 * The one entry point: `type` × numeric source → numbers (NaN = no value).
 *
 * `vol` is the bar volume column, index-aligned with `src`; only `vwma` reads
 * it. An unknown type answers SMA — the definition's own default — so a stored
 * blob carrying a type this build does not know still draws an average rather
 * than nothing.
 */
export function maSeries(type, src, period, vol) {
  switch (type) {
    case 'ema': return ema(src, period)
    case 'wma': return wma(src, period)
    case 'vwma': return vwma(src, vol, period)
    case 'hma': return hma(src, period)
    case 'smma': return smma(src, period)
    case 'dema': return dema(src, period)
    case 'tema': return tema(src, period)
    case 'lsma': return lsma(src, period)
    default: return sma(src, period)
  }
}
