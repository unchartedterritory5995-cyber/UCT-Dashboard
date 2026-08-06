/**
 * Chart indicator math.
 *
 * ## Output contract (Phase B1)
 *
 * Every compute function returns values **aligned to the input bars**: index
 * `i` of the output describes `bars[i]`, and positions before the first
 * computable bar hold `NaN`. Nothing is rounded — precision is a presentation
 * concern, applied at render/legend time.
 *
 * Both of those used to be false, and both mattered:
 *
 * - Output was **trimmed** (a short array starting at the first computable bar),
 *   so nothing could be indexed alongside the bars, and multi-output functions
 *   disagreed with themselves — `computeStochastic` returned `k` and `d` at
 *   different lengths, `computeADX` returned `adx` shorter than its DIs. Padding
 *   removes those mismatches by construction.
 * - Values were rounded with `parseFloat(x.toFixed(n))` here and `round(x, n)`
 *   in `api/services/indicator_compute.py` — half-away-from-zero versus
 *   banker's. Two roundings of the same number that disagree, which made the
 *   shared golden fixtures in `tests/fixtures/indicators/` (rel-tol 1e-9,
 *   asserted by BOTH lanes) arithmetically impossible.
 *
 * `NaN` — not `null`/`undefined` — is the padding value, so `Number.isFinite`
 * is the single "is there a value here" test and arithmetic on a gap yields
 * `NaN` rather than a silent `0`. **Lightweight Charts rejects `value: NaN`**,
 * so `StockChart.jsx` converts a non-finite point into an LWC *whitespace* item
 * (`{ time }`, no `value`) at the render boundary. That conversion is the only
 * correct way to hand these arrays to a series.
 *
 * When a series is too short to compute anything at all, the guard still returns
 * an empty array (or empty arrays inside the multi-output object). That is the
 * renderer's "no pane / remove the series" signal — `StockChart` keys every
 * indicator block off `data.length` — so it is preserved deliberately. The
 * Python lane returns all-`None` at input length for the same case; unifying
 * the two belongs with the B2 binding layer, which is where pane creation moves.
 *
 * ## Three behaviours preserved EXACTLY, on purpose
 *
 * These are real deviations from the textbook, kept as-is so Phase B1 is pixel
 * identical. Correcting them is a deliberate, owner-signed-off change in B3:
 *
 * 1. **Ichimoku** — `chikou` is plotted 26 bars BACK (correct), but `spanA` /
 *    `spanB` are NOT forward-displaced 26 bars (standard Ichimoku displaces the
 *    cloud into the future). The cloud here sits over the price that produced
 *    it.
 * 2. **Parabolic SAR** — returns a third field, `isUptrend`, alongside
 *    `time`/`value`; the consumer strips it before handing data to LWC.
 *    ⭐ AS OF PHASE C IT IS ALSO READ: `computeParabolicSAREvents` DERIVES SAR's
 *    two `{0,1,NaN}` event columns from this same pass (`trendFlipped` is
 *    literally this flag changing). The quirk is unchanged — the flag still
 *    rides along and the chart consumer still strips it — it simply stopped
 *    being a behaviour with no reader.
 * 3. **OBV** — already full-length and seeded with `{ value: 0 }` at bar 0
 *    rather than a NaN pad, so its line starts at zero on the first bar.
 */

// Not-yet-computable. See the whitespace note above before handing this to LWC.
const NA = NaN

/** A full-length output array pre-filled with the NaN pad. */
function blank(bars) {
  return bars.map(b => ({ time: b.t, value: NA }))
}

export function toHeikinAshi(bars) {
  if (!bars?.length) return bars
  const result = []
  let prevHaOpen  = (bars[0].o + bars[0].c) / 2
  let prevHaClose = (bars[0].o + bars[0].h + bars[0].l + bars[0].c) / 4
  for (const bar of bars) {
    const haClose = (bar.o + bar.h + bar.l + bar.c) / 4
    const haOpen  = (prevHaOpen + prevHaClose) / 2
    const haHigh  = Math.max(bar.h, haOpen, haClose)
    const haLow   = Math.min(bar.l, haOpen, haClose)
    result.push({ ...bar, o: haOpen, h: haHigh, l: haLow, c: haClose })
    prevHaOpen  = haOpen
    prevHaClose = haClose
  }
  return result
}

export function computeRSI(bars, period = 14) {
  if (!bars || bars.length < period + 1) return []
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const diff = bars[i].c - bars[i - 1].c
    if (diff > 0) avgGain += diff; else avgLoss -= diff
  }
  avgGain /= period
  avgLoss /= period
  const result = blank(bars)
  for (let i = period; i < bars.length; i++) {
    if (i > period) {
      const diff = bars[i].c - bars[i - 1].c
      const gain = diff > 0 ? diff : 0
      const loss = diff < 0 ? -diff : 0
      avgGain = (avgGain * (period - 1) + gain) / period
      avgLoss = (avgLoss * (period - 1) + loss) / period
    }
    result[i].value = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return result
}

function _ema(values, period) {
  if (values.length < period) return []
  const k = 2 / (period + 1)
  const out = [values.slice(0, period).reduce((s, v) => s + v, 0) / period]
  for (let i = period; i < values.length; i++) {
    out.push(out[out.length - 1] * (1 - k) + values[i] * k)
  }
  return out  // out[i] corresponds to values[period - 1 + i]
}

export function computeMACD(bars, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (!bars || bars.length < slowPeriod + signalPeriod) return { macd: [], signal: [], histogram: [] }
  const closes  = bars.map(b => b.c)
  const fastEMA = _ema(closes, fastPeriod)  // fastEMA[i] → bars[fastPeriod-1+i]
  const slowEMA = _ema(closes, slowPeriod)  // slowEMA[i] → bars[slowPeriod-1+i]
  const offset  = slowPeriod - fastPeriod   // = 14 for default 12/26
  // MACD line: aligned to bars[slowPeriod-1+i]
  const macdValues = slowEMA.map((s, i) => fastEMA[i + offset] - s)
  const signalEMA  = _ema(macdValues, signalPeriod)
  const sigOffset  = signalPeriod - 1
  const macd = blank(bars), signal = blank(bars), histogram = blank(bars)
  // The MACD LINE exists wherever both EMAs do — from bars[slowPeriod-1], which
  // is `signalPeriod - 1` bars EARLIER than the signal line. This used to be
  // trimmed to the signal's start, and the golden fixtures caught it: the Python
  // lane has always emitted the line from bars[slowPeriod-1], so the two
  // implementations disagreed on 8 bars of a default 12/26/9 MACD.
  // The chart's look is unchanged — StockChart masks the line's head back to the
  // signal's first bar, which is a deliberate B1 pixel-parity hold, not this
  // function's business.
  for (let i = 0; i < macdValues.length; i++) {
    macd[slowPeriod - 1 + i].value = macdValues[i]
  }
  for (let i = 0; i < signalEMA.length; i++) {
    const barIdx = slowPeriod - 1 + sigOffset + i
    signal[barIdx].value = signalEMA[i]
    // No per-point `color` here any more: the histogram's up/down colour is a
    // RENDER concern (StockChart derives it from the sign of this value, which
    // is the same test the old `m >= s` was). Keeping colour out of the data is
    // what lets B2 express it declaratively as colorMode: 'sign'.
    histogram[barIdx].value = macdValues[sigOffset + i] - signalEMA[i]
  }
  return { macd, signal, histogram }
}

export function computeBB(bars, period = 20, stdDev = 2) {
  if (!bars || bars.length < period) return { upper: [], middle: [], lower: [] }
  const upper = blank(bars), middle = blank(bars), lower = blank(bars)
  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += bars[j].c
    const avg = sum / period
    let sqSum = 0
    for (let j = i - period + 1; j <= i; j++) sqSum += (bars[j].c - avg) ** 2
    const std = Math.sqrt(sqSum / period)
    upper[i].value  = avg + stdDev * std
    middle[i].value = avg
    lower[i].value  = avg - stdDev * std
  }
  return { upper, middle, lower }
}

/** The ET calendar day an instant falls in, as `YYYY-MM-DD`.
 *
 *  ⚠️ THIS IS DELIBERATELY NOT `StockChart.jsx`'s `_ET_OFFSET`. That constant is
 *  resolved ONCE at module load (−14400 or −18000 seconds), so a series spanning
 *  a DST change would be an hour off across one half of itself depending on when
 *  the page happened to load — correct for half the year and silently wrong for
 *  the other half, which is the same class of defect `VWAP_SESSION_ANCHOR` is
 *  about. `Intl.DateTimeFormat` resolves the zone PER INSTANT, from the IANA
 *  database, which is the same authority `tests/fixtures/indicators/_generate.py`
 *  used (`zoneinfo.ZoneInfo("America/New_York")`) to derive the fixture column
 *  this function is asserted against.
 *
 *  `formatToParts` rather than a locale whose pattern happens to be ISO: the key
 *  is built from the named parts, so it cannot drift with the host's CLDR data.
 */
const ET_DAY_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
})

function etDayKey(msInstant) {
  const parts = ET_DAY_PARTS.formatToParts(new Date(msInstant))
  let y = '', m = '', d = ''
  for (const p of parts) {
    if (p.type === 'year') y = p.value
    else if (p.type === 'month') m = p.value
    else if (p.type === 'day') d = p.value
  }
  return `${y}-${m}-${d}`
}

export function computeVWAP(bars) {
  if (!bars?.length) return []
  const result = blank(bars)
  let cumPV = 0, cumVol = 0, currentDay = null
  // One-entry memo on the UTC HOUR. This is exact, not an approximation: every
  // `America/New_York` offset is a whole number of hours and every transition
  // lands on a whole UTC hour, so the ET date cannot change inside one UTC hour.
  // Bars arrive in ascending time, so consecutive bars hit it — a 5,000-bar
  // 5-minute series costs ~420 formatter calls instead of 5,000. It is a local,
  // not a module cache, so it cannot grow across calls.
  let memoHour = null, memoKey = null
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]
    // Session boundary = ET CALENDAR DAY (`VWAP_SESSION_ANCHOR`, accepted
    // 2026-08-03 — `docs/decisions/2026-08-02-vwap-utc-day-bucketing.md`).
    //
    // This used to be the UTC calendar day, which agrees with the session only
    // for regular hours (09:30–16:00 ET is always inside one UTC day) and is
    // severely wrong on extended hours: 20:00 ET is 00:00 UTC the next day, so
    // the accumulator was wiped on the LAST bar of a session that had not ended
    // — and because that had already opened the next UTC day, the following
    // 04:00 ET open was not a UTC boundary at all and a WHOLE session
    // accumulated on top of the previous evening's post-market volume, opening
    // $14.45 away from the session mean. The hour that tripped it moved with the
    // UTC offset (20:00 ET on EDT, 19:00 ET on EST), not with the trading day.
    //
    // ET midnight IS the extended-hours session boundary for US equity bars,
    // whose first print is 04:00 ET — and it is deliberately NOT 09:30, which
    // would reset a pre-market session that is already running. It would split a
    // true overnight (20:00–04:00 ET) tape, which this feed does not serve;
    // §7 of the record and the report carry that as a named limit rather than an
    // unmeasured second behaviour change inside an attributable commit.
    const ms = bar.t * 1000
    const hour = Math.floor(bar.t / 3600)
    let dayKey
    if (hour === memoHour) {
      dayKey = memoKey
    } else if (Number.isFinite(ms)) {
      dayKey = etDayKey(ms)
      memoHour = hour; memoKey = dayKey
    } else {
      // A non-numeric `t` (a 'YYYY-MM-DD' daily bar) used to yield the stable
      // string 'NaN-NaN-NaN' and therefore never reset. `formatToParts` would
      // THROW on it and blank the chart, so the sentinel is kept explicitly.
      // The intraday gate (`eligibility.VWAP_TIMEFRAMES`) keeps this function on
      // timeframes where `t` is unix seconds.
      dayKey = 'invalid'
    }
    if (dayKey !== currentDay) { cumPV = 0; cumVol = 0; currentDay = dayKey }
    const tp = (bar.h + bar.l + bar.c) / 3
    cumPV += tp * bar.v
    cumVol += bar.v
    if (cumVol > 0) result[i].value = cumPV / cumVol
  }
  return result
}

export function computeStochastic(bars, kPeriod = 14, dPeriod = 3) {
  if (!bars || bars.length < kPeriod) return { k: [], d: [] }
  // Fast %K
  const kValues = blank(bars)
  for (let i = kPeriod - 1; i < bars.length; i++) {
    let lowestLow = Infinity, highestHigh = -Infinity
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (bars[j].l < lowestLow) lowestLow = bars[j].l
      if (bars[j].h > highestHigh) highestHigh = bars[j].h
    }
    const range = highestHigh - lowestLow
    kValues[i].value = range === 0 ? 50 : ((bars[i].c - lowestLow) / range) * 100
  }
  // %D = SMA(dPeriod) of %K. Both arrays are now bar-aligned and the same
  // length — they used to differ by dPeriod-1, so nothing could read them
  // together at a given bar.
  const dValues = blank(bars)
  for (let i = (kPeriod - 1) + (dPeriod - 1); i < bars.length; i++) {
    let sum = 0
    for (let j = i - dPeriod + 1; j <= i; j++) sum += kValues[j].value
    dValues[i].value = sum / dPeriod
  }
  return { k: kValues, d: dValues }
}

export function computeATR(bars, period = 14) {
  if (!bars || bars.length < period + 1) return []
  // True Range for each bar starting at index 1 (needs previous close).
  // trs[j] describes bars[j + 1].
  const trs = []
  for (let i = 1; i < bars.length; i++) {
    trs.push(Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c)
    ))
  }
  // Seed with simple average of first `period` TRs, then Wilder's smoothing.
  // First value lands on bars[period].
  let atr = trs.slice(0, period).reduce((s, x) => s + x, 0) / period
  const result = blank(bars)
  result[period].value = atr
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period
    result[i + 1].value = atr
  }
  return result
}

export function computeIchimoku(bars, tenkanPeriod = 9, kijunPeriod = 26, senkouBPeriod = 52) {
  if (!bars || bars.length < senkouBPeriod) return { tenkan: [], kijun: [], spanA: [], spanB: [], chikou: [] }

  function periodMid(bars, end, period) {
    let hi = -Infinity, lo = Infinity
    for (let j = end - period + 1; j <= end; j++) {
      if (bars[j].h > hi) hi = bars[j].h
      if (bars[j].l < lo) lo = bars[j].l
    }
    return (hi + lo) / 2
  }

  const tenkan = blank(bars), kijun = blank(bars)
  const spanA = blank(bars), spanB = blank(bars), chikou = blank(bars)
  const displacement = kijunPeriod  // 26

  for (let i = senkouBPeriod - 1; i < bars.length; i++) {
    const tk = periodMid(bars, i, tenkanPeriod)
    const kj = periodMid(bars, i, kijunPeriod)
    tenkan[i].value = tk
    kijun[i].value  = kj
    // NOT forward-displaced — see the module docstring. Preserved as-is.
    spanA[i].value  = (tk + kj) / 2
    spanB[i].value  = periodMid(bars, i, senkouBPeriod)
    // Chikou: this bar's close, plotted 26 bars BACK. So the last `displacement`
    // slots of the padded array are the NaN pad too, not just the first ones.
    if (i >= displacement) chikou[i - displacement].value = bars[i].c
  }

  return { tenkan, kijun, spanA, spanB, chikou }
}

// ─── Money Flow Index (MFI) ──────────────────────────────────────────────────
// Typical price = (h + l + c) / 3
// Money flow = typical * volume
// Positive money flow accumulates when typical[i] > typical[i-1]; negative when <.
// MFI = 100 - (100 / (1 + PMF_sum / NMF_sum)) over the rolling `period`.

export function computeMFI(bars, period = 14) {
  if (!bars || bars.length < period + 1) return []
  // Pre-compute typical price and raw money flow for every bar
  const tp = new Array(bars.length)
  const flow = new Array(bars.length)
  for (let i = 0; i < bars.length; i++) {
    tp[i] = (bars[i].h + bars[i].l + bars[i].c) / 3
    flow[i] = tp[i] * (bars[i].v || 0)
  }
  const result = blank(bars)
  // First MFI value lands at bars[period] (needs `period` directional flows starting at i=1)
  for (let i = period; i < bars.length; i++) {
    let pmf = 0, nmf = 0
    for (let j = i - period + 1; j <= i; j++) {
      if (tp[j] > tp[j - 1])      pmf += flow[j]
      else if (tp[j] < tp[j - 1]) nmf += flow[j]
    }
    result[i].value = nmf === 0 ? 100 : 100 - 100 / (1 + pmf / nmf)
  }
  return result
}

// ─── Commodity Channel Index (CCI) ───────────────────────────────────────────
// Typical = (h + l + c) / 3
// SMA over `period` of typical
// MAD = mean(|typical - SMA|) over period
// CCI = (typical - SMA) / (0.015 * MAD)

export function computeCCI(bars, period = 20) {
  if (!bars || bars.length < period) return []
  const tp = new Array(bars.length)
  for (let i = 0; i < bars.length; i++) tp[i] = (bars[i].h + bars[i].l + bars[i].c) / 3
  const result = blank(bars)
  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += tp[j]
    const sma = sum / period
    let mad = 0
    for (let j = i - period + 1; j <= i; j++) mad += Math.abs(tp[j] - sma)
    mad /= period
    result[i].value = mad === 0 ? 0 : (tp[i] - sma) / (0.015 * mad)
  }
  return result
}

// ─── Williams %R ─────────────────────────────────────────────────────────────
// HH = max(high) over period, LL = min(low) over period
// %R = -100 * (HH - close) / (HH - LL)
// Range is [-100, 0]; -20 is overbought, -80 oversold.

export function computeWilliamsR(bars, period = 14) {
  if (!bars || bars.length < period) return []
  const result = blank(bars)
  for (let i = period - 1; i < bars.length; i++) {
    let hh = -Infinity, ll = Infinity
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j].h > hh) hh = bars[j].h
      if (bars[j].l < ll) ll = bars[j].l
    }
    const range = hh - ll
    result[i].value = range === 0 ? 0 : -100 * (hh - bars[i].c) / range
  }
  return result
}

// ─── Average Directional Index (ADX / DMI) ───────────────────────────────────
// +DM = h[i] - h[i-1]  (if positive AND greater than l[i-1] - l[i], else 0)
// -DM = l[i-1] - l[i]  (if positive AND greater than h[i] - h[i-1], else 0)
// TR  = max(h-l, |h - c[i-1]|, |l - c[i-1]|)
// Wilder smoothing of +DM, -DM, TR over `period`
// +DI = 100 * smoothed_+DM / smoothed_TR
// -DI = 100 * smoothed_-DM / smoothed_TR
// DX  = 100 * |+DI - -DI| / (+DI + -DI)
// ADX = Wilder-smoothed DX over `period`
// First ADX value lands at bars[2*period - 1].

export function computeADX(bars, period = 14) {
  const empty = { adx: [], plusDI: [], minusDI: [] }
  if (!bars || bars.length < 2 * period) return empty
  // Step 1: per-bar +DM, -DM, TR (starting at i=1)
  const plusDM  = new Array(bars.length).fill(0)
  const minusDM = new Array(bars.length).fill(0)
  const tr      = new Array(bars.length).fill(0)
  for (let i = 1; i < bars.length; i++) {
    const up   = bars[i].h - bars[i - 1].h
    const down = bars[i - 1].l - bars[i].l
    plusDM[i]  = (up > down && up > 0)   ? up   : 0
    minusDM[i] = (down > up && down > 0) ? down : 0
    tr[i] = Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c),
    )
  }
  // Step 2: Wilder-smooth +DM, -DM, TR. Seed = sum of first `period` values (indices 1..period).
  let sPlus = 0, sMinus = 0, sTR = 0
  for (let i = 1; i <= period; i++) { sPlus += plusDM[i]; sMinus += minusDM[i]; sTR += tr[i] }
  // After seeding, first +DI/-DI/DX value corresponds to bars[period]. All three
  // outputs are bar-aligned and the same length now — adx used to be shorter
  // than the DIs by period-1.
  const plusDI = blank(bars), minusDI = blank(bars), adxOut = blank(bars)
  const dxValues = new Array(bars.length).fill(NA)
  const pushDI = (idx) => {
    const pdi = sTR === 0 ? 0 : 100 * sPlus / sTR
    const mdi = sTR === 0 ? 0 : 100 * sMinus / sTR
    const sum = pdi + mdi
    plusDI[idx].value  = pdi
    minusDI[idx].value = mdi
    dxValues[idx] = sum === 0 ? 0 : 100 * Math.abs(pdi - mdi) / sum
  }
  pushDI(period)
  for (let i = period + 1; i < bars.length; i++) {
    sPlus  = sPlus  - sPlus  / period + plusDM[i]
    sMinus = sMinus - sMinus / period + minusDM[i]
    sTR    = sTR    - sTR    / period + tr[i]
    pushDI(i)
  }
  // Step 3: Wilder-smooth DX over `period` to get ADX. dxValues is defined from
  // index `period` on, so the seed spans bars[period .. 2*period-1] and the
  // first ADX value lands on bars[2*period - 1].
  let adx = 0
  for (let i = period; i < 2 * period; i++) adx += dxValues[i]
  adx /= period
  adxOut[2 * period - 1].value = adx
  for (let i = 2 * period; i < bars.length; i++) {
    adx = (adx * (period - 1) + dxValues[i]) / period
    adxOut[i].value = adx
  }
  return { adx: adxOut, plusDI, minusDI }
}

// ─── On-Balance Volume (OBV) ────────────────────────────────────────────────
// OBV[0] = 0
// OBV[i] = OBV[i-1] + v[i] if c[i] > c[i-1]
//        = OBV[i-1] - v[i] if c[i] < c[i-1]
//        = OBV[i-1]        otherwise

export function computeOBV(bars) {
  if (!bars?.length) return []
  // Already input-length; bar 0 is seeded with 0 rather than the NaN pad. Kept
  // as-is on purpose — see the module docstring.
  const result = [{ time: bars[0].t, value: 0 }]
  let obv = 0
  for (let i = 1; i < bars.length; i++) {
    const v = bars[i].v || 0
    if (bars[i].c > bars[i - 1].c)      obv += v
    else if (bars[i].c < bars[i - 1].c) obv -= v
    result.push({ time: bars[i].t, value: obv })
  }
  return result
}

// ─── Donchian Channels ───────────────────────────────────────────────────────
// upper  = highest high over `period`
// lower  = lowest  low  over `period`
// middle = (upper + lower) / 2

export function computeDonchian(bars, period = 20) {
  const empty = { upper: [], middle: [], lower: [] }
  if (!bars || bars.length < period) return empty
  const upper = blank(bars), middle = blank(bars), lower = blank(bars)
  for (let i = period - 1; i < bars.length; i++) {
    let hi = -Infinity, lo = Infinity
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j].h > hi) hi = bars[j].h
      if (bars[j].l < lo) lo = bars[j].l
    }
    upper[i].value  = hi
    middle[i].value = (hi + lo) / 2
    lower[i].value  = lo
  }
  return { upper, middle, lower }
}

export function computeParabolicSAR(bars, step = 0.02, maxStep = 0.2) {
  if (!bars || bars.length < 2) return []
  // bars[0] has no SAR (the trend seed consumes it), so index 0 is the NaN pad.
  const result = blank(bars)
  let isUptrend = bars[1].c > bars[0].c
  let sar = isUptrend ? bars[0].l : bars[0].h
  let ep  = isUptrend ? bars[0].h : bars[0].l
  let af  = step

  for (let i = 1; i < bars.length; i++) {
    const bar = bars[i]
    // Project SAR for this bar
    let nextSar = sar + af * (ep - sar)
    if (isUptrend) {
      // SAR must be at or below the two prior lows
      if (i >= 2) nextSar = Math.min(nextSar, bars[i - 1].l, bars[i - 2].l)
      else        nextSar = Math.min(nextSar, bars[i - 1].l)
      if (bar.l < nextSar) {
        // Reversal to downtrend
        isUptrend = false
        nextSar = ep
        ep = bar.l
        af = step
      } else {
        if (bar.h > ep) { ep = bar.h; af = Math.min(af + step, maxStep) }
      }
    } else {
      // SAR must be at or above the two prior highs
      if (i >= 2) nextSar = Math.max(nextSar, bars[i - 1].h, bars[i - 2].h)
      else        nextSar = Math.max(nextSar, bars[i - 1].h)
      if (bar.h > nextSar) {
        // Reversal to uptrend
        isUptrend = true
        nextSar = ep
        ep = bar.h
        af = step
      } else {
        if (bar.l < ep) { ep = bar.l; af = Math.min(af + step, maxStep) }
      }
    }
    sar = nextSar
    // `isUptrend` rides along as a third field — preserved, see the docstring.
    result[i].value = sar
    result[i].isUptrend = isUptrend
  }
  return result
}

// ─── SAR's two EVENT columns ─────────────────────────────────────────────────
//
// ⭐ THE VALUE HAS ALWAYS BEEN THERE; ONLY THE NAME IS NEW. `computeParabolicSAR`
// already rides an `isUptrend` boolean on every point, and the Python lane
// already carries it as a numeric ±1 `trend` column pinned by
// `tests/fixtures/indicators/sar_default.json`. These two columns are DERIVED
// from that output — never a second SAR loop, which is the twin this programme
// exists to retire.
//
// WHY SAR NEEDS EVENTS AT ALL. `sar` is deliberately not alertable by a fixed
// threshold: the value JUMPS TO THE OTHER SIDE OF PRICE at every flip, so the
// same number means "trailing below an uptrend" on one bar and "above a
// downtrend" on the next. A level is meaningless; the two things a trader
// actually watches for are events, and these are them.
//
//   priceCrossedSar — the CLOSE moved to the other side of the stop this bar
//   trendFlipped    — the SAR itself jumped sides this bar
//
// THEY ARE NOT THE SAME COLUMN, and the difference is a real bar shape rather
// than a rounding artefact. In an uptrend that does not reverse, `close >= sar`
// always holds (SAR is clamped at or below the two prior lows, and the reversal
// test is `low < sar`); by symmetry a downtrend keeps `close <= sar`. So a side
// change without a trend change is impossible EXCEPT around a reversal bar — and
// there it is reachable: on reversal the new SAR is the prior leg's extreme
// point, which an OUTSIDE bar can close beyond. That bar flips the trend without
// flipping the side, and the next bar flips the side without flipping the trend.
//
// ⚠️ THE DOMAIN IS `{0, 1, NaN}` AND `NaN` IS NOT "NO EVENT". It is the warmup
// pad, exactly as it is in every plot column: bar 0 has no SAR at all (the trend
// seed consumes it), so there is nothing to have crossed. `0` means "computed,
// did not happen". Bar 1 is `0` in both columns for the same reason read the
// other way round: it is computable, and no prior side or trend exists for it to
// have moved away from, so nothing happened. Collapsing NaN into 0 would make a
// 200-bar indicator's warmup read as 199 non-events.
//
// ⚠️ `close > sar` IS STRICT, in both lanes, and an exact tie therefore reads as
// "not above". Ties are measure-zero on real tape; what matters is that
// `api/services/indicator_compute.compute_sar_events` makes the identical choice,
// because the two are asserted against one fixture at rel-tol 1e-9.

/** Was the close above the stop on this bar? `null` where either is unusable. */
function sarSideAbove(close, sar) {
  if (!Number.isFinite(close) || !Number.isFinite(sar)) return null
  return close > sar
}

/**
 * SAR's two event columns, as `[{time, value}]` series in the `{0, 1, NaN}`
 * domain.
 *
 * ⚠️ DERIVED FROM `computeParabolicSAR`, NOT RE-IMPLEMENTED. It recomputes the
 * SAR pass rather than taking the points as an argument, so there is exactly one
 * public shape and one place the maths lives; the cost is one extra O(n) walk
 * that the binder memoises per (instance, bars, inputs) anyway.
 *
 * @returns {{priceCrossedSar: Array, trendFlipped: Array}}
 */
export function computeParabolicSAREvents(bars, step = 0.02, maxStep = 0.2) {
  const empty = { priceCrossedSar: [], trendFlipped: [] }
  if (!bars || bars.length < 2) return empty
  const points = computeParabolicSAR(bars, step, maxStep)
  if (!points.length) return empty

  const priceCrossedSar = blank(bars)
  const trendFlipped = blank(bars)

  for (let i = 1; i < bars.length; i++) {
    const trend = points[i] ? points[i].isUptrend : undefined
    const prevTrend = points[i - 1] ? points[i - 1].isUptrend : undefined
    const side = sarSideAbove(bars[i].c, points[i] ? points[i].value : NA)
    const prevSide = sarSideAbove(bars[i - 1].c, points[i - 1] ? points[i - 1].value : NA)

    // Bar 1 has a trend and a side but no PRIOR of either — the seed bar is the
    // pad. "Nothing happened" is the honest answer, not a gap.
    if (typeof trend === 'boolean') {
      trendFlipped[i].value = (typeof prevTrend === 'boolean' && prevTrend !== trend) ? 1 : 0
    }
    if (side !== null) {
      priceCrossedSar[i].value = (prevSide !== null && prevSide !== side) ? 1 : 0
    }
  }
  return { priceCrossedSar, trendFlipped }
}
