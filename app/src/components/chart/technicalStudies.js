// app/src/components/chart/technicalStudies.js
//
// ─── THE TECHNICAL LIBRARY'S STUDIES (Tier 1, 2026-10-01) ───────────────────
//
// Pure maths for the studies added to Chart Settings → Indicators → Technical in
// the Tier 1 expansion. Every function takes bars (`{t,o,h,l,c,v}`) and/or a
// plain numeric series and returns PLAIN NUMBER ARRAYS, input-length, with NaN
// wherever the study has no value. `engine/nativeRegistry.js` adapts them to
// columns; nothing here knows about panes, colours or the registry.
//
// The exact semantics — lookbacks, seeds, zero-denominator answers, σ and
// annualisation conventions — are recorded per function below and in
// `docs/decisions/2026-10-01-technical-library-tier1.md`. Where a convention is
// shared with a study that already ships (Wilder ATR, population-σ Bollinger,
// Wilder RSI), the shipped implementation is REUSED rather than restated, so two
// studies on one chart can never disagree about the same intermediate.
//
// ── SHARED RULES ─────────────────────────────────────────────────────────────
// • Output is NaN, never ±Infinity: every division checks its denominator.
// • A non-finite input inside a window makes that window's output NaN; it does
//   not poison later windows.
// • A length is floored and clamped to ≥ 1.

import { computeATR, computeBB } from './indicators.js'
import {
  sma, ema, lsma, maSeries, pointsToNumbers,
} from './movingAverages.js'

const len = (p) => Math.max(1, Math.floor(p) || 1)
const nanArray = (n) => { const a = new Array(n); a.fill(NaN); return a }
const fin = Number.isFinite
const field = (bars, k) => bars.map((b) => (b ? Number(b[k]) : NaN))
const hl2Of = (bars) => bars.map((b) => (b ? (Number(b.h) + Number(b.l)) / 2 : NaN))

/** True range per bar; bar 0 (no previous close) is NaN — `computeATR`'s rule. */
export function trueRange(bars) {
  const n = bars.length
  const out = nanArray(n)
  for (let i = 1; i < n; i++) {
    const h = bars[i].h, l = bars[i].l, pc = bars[i - 1].c
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))
    if (fin(tr)) out[i] = tr
  }
  return out
}

/** Wilder ATR as numbers — the shipped `computeATR`, so ATR% / Keltner /
 *  SuperTrend / Squeeze agree with the ATR indicator to the last bit. */
export function atrNumbers(bars, period) {
  return pointsToNumbers(computeATR(bars, len(period)), bars.length)
}

/** Rolling sum over exactly `p` finite values (NaN if any is missing). */
function rollingSum(src, p) {
  const n = src.length
  const out = nanArray(n)
  let run = 0
  for (let i = 0; i < n; i++) {
    run = fin(src[i]) ? run + 1 : 0
    if (run < p) continue
    let s = 0
    for (let j = i - p + 1; j <= i; j++) s += src[j]
    out[i] = s
  }
  return out
}

function rollingMax(src, p) {
  const n = src.length
  const out = nanArray(n)
  let run = 0
  for (let i = 0; i < n; i++) {
    run = fin(src[i]) ? run + 1 : 0
    if (run < p) continue
    let m = -Infinity
    for (let j = i - p + 1; j <= i; j++) if (src[j] > m) m = src[j]
    out[i] = m
  }
  return out
}

function rollingMin(src, p) {
  const n = src.length
  const out = nanArray(n)
  let run = 0
  for (let i = 0; i < n; i++) {
    run = fin(src[i]) ? run + 1 : 0
    if (run < p) continue
    let m = Infinity
    for (let j = i - p + 1; j <= i; j++) if (src[j] < m) m = src[j]
    out[i] = m
  }
  return out
}

/** Population (÷n) or sample (÷(n−1)) standard deviation over a window. */
function rollingStdev(src, p, sample = false) {
  const n = src.length
  const out = nanArray(n)
  if (sample && p < 2) return out
  let run = 0
  for (let i = 0; i < n; i++) {
    run = fin(src[i]) ? run + 1 : 0
    if (run < p) continue
    let s = 0
    for (let j = i - p + 1; j <= i; j++) s += src[j]
    const m = s / p
    let q = 0
    for (let j = i - p + 1; j <= i; j++) q += (src[j] - m) ** 2
    out[i] = Math.sqrt(q / (sample ? p - 1 : p))
  }
  return out
}

const sub = (a, b) => a.map((x, i) => (fin(x) && fin(b[i]) ? x - b[i] : NaN))
const ratio = (a, b, k = 1) => a.map((x, i) => (fin(x) && fin(b[i]) && b[i] !== 0 ? k * x / b[i] : NaN))

/** Wilder RSI over a numeric series — the shipped `computeRSI`, restated for a
 *  series: seed = mean of the first n gains/losses, then Wilder smoothing; a
 *  non-finite change HOLDS (skips the bar, keeps the state); avgLoss 0 → 100,
 *  else avgGain 0 → 0. Over `close` it equals `computeRSI` exactly. */
export function rsiOfSeries(src, period) {
  const n = src.length
  const p = len(period)
  const out = nanArray(n)
  let avgGain = NaN, avgLoss = NaN, seen = 0, sumGain = 0, sumLoss = 0
  for (let i = 1; i < n; i++) {
    const diff = src[i] - src[i - 1]
    if (!fin(diff)) continue
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    if (Number.isNaN(avgGain)) {
      sumGain += gain; sumLoss += loss; seen += 1
      if (seen < p) continue
      avgGain = sumGain / p; avgLoss = sumLoss / p
    } else {
      avgGain = (avgGain * (p - 1) + gain) / p
      avgLoss = (avgLoss * (p - 1) + loss) / p
    }
    if (avgLoss === 0) out[i] = 100
    else if (avgGain === 0) out[i] = 0
    else out[i] = 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}

// ═══ TREND ═══════════════════════════════════════════════════════════════════

/**
 * SuperTrend (Olivier Seban). ATR = Wilder ATR(atrPeriod) (the shipped ATR);
 * basic bands = hl2 ± mult·ATR; the final lower band only rises and the final
 * upper band only falls while price stays on their side; direction flips when
 * the close crosses the active band. The first bar with an ATR starts on the
 * UPPER band (down-trend), as TradingView's `ta.supertrend` does.
 *
 * Output: `up` (the line while trending up, else NaN), `down` (while trending
 * down), `direction` (+1 up / −1 down).
 */
export function superTrend(bars, atrPeriod = 10, mult = 3) {
  const n = bars.length
  const atr = atrNumbers(bars, atrPeriod)
  const up = nanArray(n), down = nanArray(n), direction = nanArray(n)
  let fu = NaN, fl = NaN, dir = 0, prevLine = NaN
  for (let i = 0; i < n; i++) {
    const a = atr[i]
    const mid = (bars[i].h + bars[i].l) / 2
    const c = bars[i].c
    if (!fin(a) || !fin(mid) || !fin(c)) { fu = NaN; fl = NaN; dir = 0; prevLine = NaN; continue }
    const bu = mid + mult * a
    const bl = mid - mult * a
    const pc = i > 0 ? bars[i - 1].c : NaN
    const nfl = (!fin(fl) || bl > fl || pc < fl) ? bl : fl
    const nfu = (!fin(fu) || bu < fu || pc > fu) ? bu : fu
    if (dir === 0) dir = -1
    else if (prevLine === fu) dir = c > nfu ? 1 : -1
    else dir = c < nfl ? -1 : 1
    fl = nfl; fu = nfu
    const line = dir === 1 ? fl : fu
    prevLine = line
    direction[i] = dir
    if (dir === 1) up[i] = line; else down[i] = line
  }
  // ⛔ NO JOIN AT A FLIP. The line jumps from one band to the other there, and
  // bridging the two halves would draw a diagonal across price that is not a
  // level the study ever held; each trend is its own run, broken at the flip.
  return { up, down, direction }
}

/**
 * Aroon over `period`: the window is the last period+1 bars (the current bar
 * and `period` before it). Up = 100·(period − bars since the highest high)/period,
 * Down likewise for the lowest low. On a tie the MOST RECENT extreme counts
 * (TA-Lib's convention). First value at index `period`.
 */
export function aroon(bars, period = 14) {
  const n = bars.length
  const p = len(period)
  const up = nanArray(n), down = nanArray(n)
  for (let i = p; i < n; i++) {
    let hi = -Infinity, lo = Infinity, hiAt = -1, loAt = -1, ok = true
    for (let j = i - p; j <= i; j++) {
      const h = bars[j].h, l = bars[j].l
      if (!fin(h) || !fin(l)) { ok = false; break }
      if (h >= hi) { hi = h; hiAt = j }
      if (l <= lo) { lo = l; loAt = j }
    }
    if (!ok) continue
    up[i] = (100 * (p - (i - hiAt))) / p
    down[i] = (100 * (p - (i - loAt))) / p
  }
  return { up, down }
}

/** Vortex: VI± = Σ|h−l₋₁| (resp. |l−h₋₁|) / ΣTR over `period`. First value at
 *  index `period`. ΣTR = 0 → NaN. */
export function vortex(bars, period = 14) {
  const n = bars.length
  const p = len(period)
  const vmPlus = nanArray(n), vmMinus = nanArray(n)
  for (let i = 1; i < n; i++) {
    const a = Math.abs(bars[i].h - bars[i - 1].l)
    const b = Math.abs(bars[i].l - bars[i - 1].h)
    if (fin(a)) vmPlus[i] = a
    if (fin(b)) vmMinus[i] = b
  }
  const tr = rollingSum(trueRange(bars), p)
  return {
    plus: ratio(rollingSum(vmPlus, p), tr),
    minus: ratio(rollingSum(vmMinus, p), tr),
  }
}

/** Choppiness Index: 100·log10(ΣTR / (HH − LL)) / log10(n) over `period`
 *  (TR is a one-bar ATR). Range 0 or n = 1 → NaN. First value at `period`. */
export function choppiness(bars, period = 14) {
  const n = bars.length
  const p = len(period)
  const out = nanArray(n)
  if (p < 2) return out
  const str = rollingSum(trueRange(bars), p)
  const hh = rollingMax(field(bars, 'h'), p)
  const ll = rollingMin(field(bars, 'l'), p)
  const lg = Math.log10(p)
  for (let i = 0; i < n; i++) {
    const range = hh[i] - ll[i]
    if (!fin(str[i]) || !fin(range) || range <= 0 || str[i] <= 0) continue
    out[i] = (100 * Math.log10(str[i] / range)) / lg
  }
  return out
}

// ═══ MOMENTUM ════════════════════════════════════════════════════════════════

/**
 * Stochastic RSI: RSI(rsiLen) of the source (Wilder, = the RSI indicator), its
 * position in its own `stochLen` range ×100 (a flat range answers 50 — the
 * shipped Stochastic's rule), %K = SMA(kSmooth) of that, %D = SMA(dSmooth) of %K.
 */
export function stochRsi(src, rsiLen = 14, stochLen = 14, kSmooth = 3, dSmooth = 3) {
  const n = src.length
  const r = rsiOfSeries(src, rsiLen)
  const p = len(stochLen)
  const raw = nanArray(n)
  const hi = rollingMax(r, p), lo = rollingMin(r, p)
  for (let i = 0; i < n; i++) {
    if (!fin(hi[i]) || !fin(lo[i]) || !fin(r[i])) continue
    const range = hi[i] - lo[i]
    raw[i] = range === 0 ? 50 : (100 * (r[i] - lo[i])) / range
  }
  const k = sma(raw, kSmooth)
  return { k, d: sma(k, dSmooth) }
}

/** PPO = 100·(EMA fast − EMA slow)/EMA slow; signal = EMA(signal) of PPO;
 *  histogram = PPO − signal. EMA slow = 0 → NaN. */
export function ppo(src, fast = 12, slow = 26, signal = 9) {
  const f = ema(src, fast), s = ema(src, slow)
  const line = ratio(sub(f, s), s, 100)
  const sig = ema(line, signal)
  return { line, signal: sig, histogram: sub(line, sig) }
}

/** Rate of change, %: 100·(x − x[n])/x[n]; x[n] = 0 → NaN. */
export function rateOfChange(src, period = 12) {
  const p = len(period)
  return src.map((x, i) => (i >= p && fin(x) && fin(src[i - p]) && src[i - p] !== 0
    ? (100 * (x - src[i - p])) / src[i - p] : NaN))
}

/** Momentum: x − x[n]. */
export function momentum(src, period = 10) {
  const p = len(period)
  return src.map((x, i) => (i >= p && fin(x) && fin(src[i - p]) ? x - src[i - p] : NaN))
}

/** True Strength Index: 100·EMA(EMA(Δx, long), short) / EMA(EMA(|Δx|, long), short);
 *  signal = EMA(signal). A zero denominator (no movement) → NaN. */
export function tsi(src, long = 25, short = 13, signal = 13) {
  const d = src.map((x, i) => (i > 0 && fin(x) && fin(src[i - 1]) ? x - src[i - 1] : NaN))
  const ad = d.map((x) => (fin(x) ? Math.abs(x) : NaN))
  const num = ema(ema(d, long), short)
  const den = ema(ema(ad, long), short)
  const line = ratio(num, den, 100)
  return { line, signal: ema(line, signal) }
}

/** Chande Momentum Oscillator (Chande's sums, as TradingView): over the last n
 *  one-bar changes, 100·(ΣUp − ΣDown)/(ΣUp + ΣDown). No movement → NaN. */
export function cmo(src, period = 14) {
  const n = src.length
  const p = len(period)
  const upv = nanArray(n), dnv = nanArray(n)
  for (let i = 1; i < n; i++) {
    const d = src[i] - src[i - 1]
    if (!fin(d)) continue
    upv[i] = d > 0 ? d : 0
    dnv[i] = d < 0 ? -d : 0
  }
  const su = rollingSum(upv, p), sd = rollingSum(dnv, p)
  return su.map((u, i) => (fin(u) && fin(sd[i]) && u + sd[i] !== 0 ? (100 * (u - sd[i])) / (u + sd[i]) : NaN))
}

/** TRIX: one-bar % change of a triple EMA, ×100 (the TA-Lib / StockCharts form);
 *  signal = EMA(signal) of TRIX. */
export function trix(src, period = 15, signal = 9) {
  const e3 = ema(ema(ema(src, period), period), period)
  const line = e3.map((x, i) => (i > 0 && fin(x) && fin(e3[i - 1]) && e3[i - 1] !== 0
    ? (100 * (x - e3[i - 1])) / e3[i - 1] : NaN))
  return { line, signal: ema(line, signal) }
}

/** Awesome Oscillator: SMA(hl2, fast) − SMA(hl2, slow). `rising` is 1 when the
 *  bar is above the previous value, 0 otherwise (NaN with no comparison). */
export function awesome(bars, fast = 5, slow = 34) {
  const m = hl2Of(bars)
  const ao = sub(sma(m, fast), sma(m, slow))
  return { ao, ...splitRising(ao) }
}

/** Two copies of a histogram: one holding the rising bars, one the falling. */
function splitRising(values) {
  const rising = nanArray(values.length), falling = nanArray(values.length)
  for (let i = 0; i < values.length; i++) {
    if (!fin(values[i])) continue
    if (i > 0 && fin(values[i - 1]) && values[i] < values[i - 1]) falling[i] = values[i]
    else rising[i] = values[i]
  }
  return { rising, falling }
}

/** Ultimate Oscillator (Williams): BP = c − min(l, c₋₁), TR = max(h, c₋₁) −
 *  min(l, c₋₁); A_n = ΣBP/ΣTR; UO = 100·(4A₁ + 2A₂ + A₃)/7. ΣTR = 0 → NaN. */
export function ultimate(bars, p1 = 7, p2 = 14, p3 = 28) {
  const n = bars.length
  const bp = nanArray(n), tr = nanArray(n)
  for (let i = 1; i < n; i++) {
    const pc = bars[i - 1].c
    const lo = Math.min(bars[i].l, pc), hi = Math.max(bars[i].h, pc)
    if (!fin(lo) || !fin(hi) || !fin(bars[i].c)) continue
    bp[i] = bars[i].c - lo
    tr[i] = hi - lo
  }
  const a = (p) => ratio(rollingSum(bp, len(p)), rollingSum(tr, len(p)))
  const a1 = a(p1), a2 = a(p2), a3 = a(p3)
  return a1.map((x, i) => (fin(x) && fin(a2[i]) && fin(a3[i]) ? (100 * (4 * x + 2 * a2[i] + a3[i])) / 7 : NaN))
}

/** Balance of Power: (c − o)/(h − l), 0 on a bar with no range; then SMA(smooth)
 *  (smooth 1 = the raw value). Bounded −1..1. */
export function balanceOfPower(bars, smooth = 14) {
  const raw = bars.map((b) => {
    const r = b.h - b.l
    const x = b.c - b.o
    if (!fin(r) || !fin(x)) return NaN
    return r === 0 ? 0 : x / r
  })
  return len(smooth) === 1 ? raw : sma(raw, smooth)
}

/** Elder-ray Bull and Bear Power: high − EMA(close, n), low − EMA(close, n). */
export function bullBearPower(bars, period = 13) {
  const e = ema(field(bars, 'c'), period)
  return { bull: sub(field(bars, 'h'), e), bear: sub(field(bars, 'l'), e) }
}

// ═══ VOLATILITY & BANDS ══════════════════════════════════════════════════════

/** Keltner Channels: EMA(close, period) ± mult·ATR(atrPeriod) (Wilder ATR). */
export function keltner(bars, period = 20, mult = 2, atrPeriod = 10) {
  const mid = ema(field(bars, 'c'), period)
  const a = atrNumbers(bars, atrPeriod)
  const upper = mid.map((m, i) => (fin(m) && fin(a[i]) ? m + mult * a[i] : NaN))
  const lower = mid.map((m, i) => (fin(m) && fin(a[i]) ? m - mult * a[i] : NaN))
  return { upper, middle: mid.map((m, i) => (fin(upper[i]) ? m : NaN)), lower }
}

/** Moving Average Envelope: MA(type, period) of the source × (1 ± pct/100). */
export function envelope(src, period = 20, pct = 2.5, type = 'sma', vol = null) {
  const mid = maSeries(type, src, period, vol)
  const f = pct / 100
  return {
    upper: mid.map((m) => (fin(m) ? m * (1 + f) : NaN)),
    middle: mid,
    lower: mid.map((m) => (fin(m) ? m * (1 - f) : NaN)),
  }
}

/** Bollinger %B and BandWidth from the SHIPPED `computeBB` (SMA basis,
 *  population σ), so both read exactly the bands the Bollinger study draws.
 *  %B = (c − lower)/(upper − lower) (zero width → NaN);
 *  BandWidth = 100·(upper − lower)/basis (basis 0 → NaN) — the formula engine's
 *  `bbw` convention. */
export function bollingerDerived(bars, period = 20, mult = 2) {
  const n = bars.length
  const raw = computeBB(bars, len(period), mult)
  const up = pointsToNumbers(raw.upper, n), mid = pointsToNumbers(raw.middle, n), lo = pointsToNumbers(raw.lower, n)
  const percentB = nanArray(n), bandwidth = nanArray(n)
  for (let i = 0; i < n; i++) {
    const w = up[i] - lo[i]
    if (fin(w) && w !== 0 && fin(bars[i].c)) percentB[i] = (bars[i].c - lo[i]) / w
    if (fin(w) && fin(mid[i]) && mid[i] !== 0) bandwidth[i] = (100 * w) / mid[i]
  }
  return { percentB, bandwidth }
}

/** ATR as a percentage of the close. */
export function atrPercent(bars, period = 14) {
  return ratio(atrNumbers(bars, period), field(bars, 'c'), 100)
}

/** ADR % (average daily range): 100·(SMA(high/low, n) − 1). A bar with a
 *  non-positive low has no ratio. On a daily chart this is the classic ADR %;
 *  on another timeframe it is that timeframe's average bar range. */
export function adrPercent(bars, period = 20) {
  const r = bars.map((b) => (fin(b.h) && fin(b.l) && b.l > 0 ? b.h / b.l : NaN))
  return sma(r, period).map((x) => (fin(x) ? 100 * (x - 1) : NaN))
}

/** Rolling standard deviation of the source — POPULATION (÷n), the same σ the
 *  Bollinger study and the formula engine's `stdev` use. */
export function standardDeviation(src, period = 20) {
  return rollingStdev(src, len(period), false)
}

/** Periods per year for annualising: daily = 252 trading sessions, weekly 52,
 *  monthly 12. */
export const HV_PERIODS_PER_YEAR = Object.freeze({ D: 252, W: 52, M: 12 })

/**
 * Which of those the BARS are, from their own median spacing — so the study
 * needs no timeframe from outside and annualises correctly on whatever frame it
 * is computed on (including a higher calculation timeframe). Median, not mean,
 * so weekends and holidays do not move a daily series. Up to 4 days → daily,
 * up to 10 → weekly, up to 45 → monthly; anything else (intraday, or too few
 * bars to tell) → null, and the study draws nothing rather than guess.
 */
export function periodsPerYearOf(bars) {
  const n = Array.isArray(bars) ? bars.length : 0
  if (n < 3) return null
  const gaps = []
  let prev = barSeconds(bars[0] && bars[0].t)
  for (let i = 1; i < n; i++) {
    const t = barSeconds(bars[i] && bars[i].t)
    if (fin(prev) && fin(t) && t > prev) gaps.push(t - prev)
    prev = t
  }
  if (!gaps.length) return null
  gaps.sort((a, b) => a - b)
  const days = gaps[Math.floor(gaps.length / 2)] / DAY
  if (days < 0.9) return null
  if (days <= 4) return HV_PERIODS_PER_YEAR.D
  if (days <= 10) return HV_PERIODS_PER_YEAR.W
  if (days <= 45) return HV_PERIODS_PER_YEAR.M
  return null
}

/** Historical (close-to-close) volatility, %: SAMPLE σ (÷(n−1)) of ln(c/c₋₁)
 *  over n returns, × √(periods per year) × 100. A non-positive close has no
 *  log return. Undefined timeframe → all NaN. */
export function historicalVolatility(bars, period = 20, periodsPerYear = periodsPerYearOf(bars)) {
  const n = bars.length
  if (!fin(periodsPerYear) || periodsPerYear <= 0) return nanArray(n)
  const lr = nanArray(n)
  for (let i = 1; i < n; i++) {
    const a = bars[i].c, b = bars[i - 1].c
    if (fin(a) && fin(b) && a > 0 && b > 0) lr[i] = Math.log(a / b)
  }
  const k = Math.sqrt(periodsPerYear) * 100
  return rollingStdev(lr, len(period), true).map((s) => (fin(s) ? s * k : NaN))
}

/**
 * Squeeze. The volatility "squeeze" is Bollinger Bands contracting inside
 * Keltner Channels (a published, non-proprietary condition). UCT's version:
 *   BB  = SMA(close, len) ± bbMult·σ (population — the Bollinger study's σ)
 *   KC  = SMA(close, len) ± kcMult·ATR(len) (Wilder ATR)
 *   on  = BB upper < KC upper AND BB lower > KC lower
 *   momentum = least-squares value (len) of close − ((HH + LL)/2 + SMA)/2,
 *              HH/LL = highest high / lowest low over len.
 * Output: `histogram` (the momentum), and `on` (1 while squeezed, 0 otherwise).
 */
export function squeeze(bars, period = 20, bbMult = 2, kcMult = 1.5) {
  const n = bars.length
  const p = len(period)
  const c = field(bars, 'c')
  const basis = sma(c, p)
  const sd = rollingStdev(c, p, false)
  const a = atrNumbers(bars, p)
  const hh = rollingMax(field(bars, 'h'), p), ll = rollingMin(field(bars, 'l'), p)
  const on = nanArray(n)
  const delta = nanArray(n)
  for (let i = 0; i < n; i++) {
    if (fin(basis[i]) && fin(sd[i]) && fin(a[i])) {
      const bu = basis[i] + bbMult * sd[i], bl = basis[i] - bbMult * sd[i]
      const ku = basis[i] + kcMult * a[i], kl = basis[i] - kcMult * a[i]
      on[i] = bu < ku && bl > kl ? 1 : 0
    }
    if (fin(hh[i]) && fin(ll[i]) && fin(basis[i]) && fin(c[i])) {
      delta[i] = c[i] - ((hh[i] + ll[i]) / 2 + basis[i]) / 2
    }
  }
  return { histogram: lsma(delta, p), on }
}

// ═══ VOLUME & MONEY FLOW ═════════════════════════════════════════════════════

/** Close-location value × volume (the money-flow volume); a bar with no range
 *  contributes 0. */
function moneyFlowVolume(bars) {
  return bars.map((b) => {
    const r = b.h - b.l
    if (!fin(r) || !fin(b.c) || !fin(b.v)) return NaN
    return r === 0 ? 0 : (((b.c - b.l) - (b.h - b.c)) / r) * b.v
  })
}

/** Relative volume: this bar's volume ÷ the average of the PREVIOUS n bars'
 *  volume (the current bar is excluded so a spike is not diluted by itself).
 *  An average of 0 → NaN. */
export function relativeVolume(bars, period = 50) {
  const n = bars.length
  const p = len(period)
  const v = field(bars, 'v')
  const avg = sma(v, p)
  const out = nanArray(n)
  for (let i = 1; i < n; i++) {
    if (fin(v[i]) && fin(avg[i - 1]) && avg[i - 1] > 0) out[i] = v[i] / avg[i - 1]
  }
  return out
}

/** Accumulation/Distribution line: cumulative money-flow volume from the first
 *  loaded bar (a level, like OBV — its absolute value depends on history
 *  loaded; its shape does not). A bar with missing data adds nothing. */
export function accumulationDistribution(bars) {
  const mfv = moneyFlowVolume(bars)
  const out = nanArray(bars.length)
  let acc = 0
  for (let i = 0; i < bars.length; i++) {
    if (fin(mfv[i])) acc += mfv[i]
    out[i] = acc
  }
  return out
}

/** Chaikin Money Flow: Σ money-flow volume / Σ volume over n. Σv = 0 → NaN. */
export function chaikinMoneyFlow(bars, period = 20) {
  const p = len(period)
  return ratio(rollingSum(moneyFlowVolume(bars), p), rollingSum(field(bars, 'v'), p))
}

/** Chaikin Oscillator: EMA(fast) − EMA(slow) of the A/D line (SMA-seeded EMA). */
export function chaikinOscillator(bars, fast = 3, slow = 10) {
  const ad = accumulationDistribution(bars)
  return sub(ema(ad, fast), ema(ad, slow))
}

/** Elder Force Index: EMA(n) of (c − c₋₁)·v. n = 1 is the raw force. */
export function forceIndex(bars, period = 13) {
  const raw = bars.map((b, i) => (i > 0 && fin(b.c) && fin(bars[i - 1].c) && fin(b.v)
    ? (b.c - bars[i - 1].c) * b.v : NaN))
  return len(period) === 1 ? raw : ema(raw, period)
}

/** Price Volume Trend: cumulative ((c − c₋₁)/c₋₁)·v from the first loaded bar,
 *  which starts at 0. A bar with a missing value or a zero previous close adds
 *  nothing (the shipped `computePVT`'s rule). */
export function priceVolumeTrend(bars) {
  const n = bars.length
  const out = nanArray(n)
  if (!n) return out
  let acc = 0
  out[0] = 0
  for (let i = 1; i < n; i++) {
    const pc = bars[i - 1].c, c = bars[i].c, v = bars[i].v
    if (fin(pc) && pc !== 0 && fin(c) && fin(v)) acc += ((c - pc) / pc) * v
    out[i] = acc
  }
  return out
}

/** Up/Down Volume Ratio of THIS SYMBOL: over the last n bars, the volume of up
 *  bars (close above the previous close) ÷ the volume of down bars. Unchanged
 *  bars count in neither. No down volume → NaN. */
export function upDownVolumeRatio(bars, period = 50) {
  const n = bars.length
  const p = len(period)
  const upv = nanArray(n), dnv = nanArray(n)
  for (let i = 1; i < n; i++) {
    const c = bars[i].c, pc = bars[i - 1].c, v = bars[i].v
    if (!fin(c) || !fin(pc) || !fin(v)) continue
    upv[i] = c > pc ? v : 0
    dnv[i] = c < pc ? v : 0
  }
  const su = rollingSum(upv, p), sd = rollingSum(dnv, p)
  return su.map((u, i) => (fin(u) && fin(sd[i]) && sd[i] > 0 ? u / sd[i] : NaN))
}

// ═══ RELATIVE STRENGTH ══════════════════════════════════════════════════════

/** % from moving average: 100·(x/MA − 1). MA = 0 → NaN. */
export function percentFromMa(src, period = 50, type = 'sma', vol = null) {
  const m = maSeries(type, src, period, vol)
  return src.map((x, i) => (fin(x) && fin(m[i]) && m[i] !== 0 ? 100 * (x / m[i] - 1) : NaN))
}

const DAY = 86400
const ISO = /^(\d{4})-(\d{2})-(\d{2})/
/** A bar time as unix seconds — numeric seconds, or an ISO `YYYY-MM-DD` day. */
export function barSeconds(t) {
  if (typeof t === 'number') return fin(t) ? t : NaN
  if (typeof t === 'string') {
    const m = ISO.exec(t)
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000
    const x = Number(t)
    return fin(x) ? x : NaN
  }
  return NaN
}

/**
 * Distance from the 52-week high and low, %. The window is CALENDAR time: every
 * bar whose time is within 364 days (52 weeks) before this bar, inclusive of
 * this bar's own high/low. A bar is emitted only once the loaded history spans
 * the full 52 weeks, so a short chart never reports a partial-window "high".
 *   fromHigh = 100·(close/HH − 1)  (≤ 0; 0 = at the high)
 *   fromLow  = 100·(close/LL − 1)  (≥ 0; 0 = at the low)
 */
export function fiftyTwoWeek(bars, weeks = 52) {
  const n = bars.length
  const span = len(weeks) * 7 * DAY
  const fromHigh = nanArray(n), fromLow = nanArray(n)
  const ts = bars.map((b) => barSeconds(b.t))
  if (!n || !fin(ts[0])) return { fromHigh, fromLow }
  let lo = 0
  for (let i = 0; i < n; i++) {
    const t = ts[i]
    if (!fin(t)) continue
    if (t - ts[0] < span) continue
    while (lo < i && fin(ts[lo]) && ts[lo] <= t - span) lo++
    let hh = -Infinity, ll = Infinity, ok = true
    for (let j = lo; j <= i; j++) {
      const h = bars[j].h, l = bars[j].l
      if (!fin(h) || !fin(l)) { ok = false; break }
      if (h > hh) hh = h
      if (l < ll) ll = l
    }
    const c = bars[i].c
    if (!ok || !fin(c) || hh <= 0 || ll <= 0) continue
    fromHigh[i] = 100 * (c / hh - 1)
    fromLow[i] = 100 * (c / ll - 1)
  }
  return { fromHigh, fromLow }
}
