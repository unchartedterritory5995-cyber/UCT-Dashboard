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
    // ⛔ `avgLoss === 0` IS TWO DIFFERENT FACTS AND ONLY ONE OF THEM IS 100.
    // With `avgGain > 0` it is a genuine unbroken advance — RS is unbounded and
    // 100 is the textbook answer (pinned by fixtures/indicators/rsi_ramp_14).
    // With `avgGain === 0` NOTHING MOVED: 0/0 is not a number, so the point
    // keeps the `NA` the warm-up pad uses. Reading a frozen ticker as maximally
    // overbought put SIM/TMTS/CWEN-A/DRDB/OBA at the top of an "RSI > 70" screen
    // on 2026-08-09. Python's `indicator_compute.rsi_from_wilder_averages` makes
    // the identical distinction — these two lanes are compared bar-for-bar
    // against one golden fixture, so they decide it the same way or not at all.
    if (avgLoss !== 0) result[i].value = 100 - 100 / (1 + avgGain / avgLoss)
    else if (avgGain !== 0) result[i].value = 100
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
  // ⛔ THE LONGER PERIOD IS THE START BAR, AND IT IS NOT ALWAYS `slowPeriod`.
  //
  // Both the guard and the alignment below used to assume `slow >= fast`, which
  // the settings form does not enforce — Fast's declared max is 100 and Slow's is
  // 200, so a member can set Fast above Slow from the Inputs tab. When they did,
  // `slowPeriod - fastPeriod` went NEGATIVE, `fastEMA[negative]` was `undefined`,
  // and `undefined - s` seeded `macdValues` with NaN. Only the first `fast - slow`
  // entries were NaN, so the MACD LINE STILL DREW — but those are exactly the
  // seed window of the signal EMA (`_ema` starts from the mean of the first
  // `period` values), so the signal seed was NaN and NaN propagated through every
  // later value. Measured in production on WMT 1D: Fast 30 / Slow 26 printed
  // `MACD 0.2008` beside a legend chip reading a bare `SIG` with no number.
  //
  // The fix aligns BOTH series onto the later of the two starts rather than
  // assuming which one that is. For `slow >= fast` this is arithmetically
  // identical to what it replaced (`slowOffset` is 0 and `fastOffset` is the old
  // `offset`), which is why the golden fixtures and every default-parameter test
  // are untouched. Gate: `indicators.macdAlignment.test.js`, whose oracle is the
  // antisymmetry `macd(f,s) === -macd(s,f)` — a property of the definition, not
  // of this code, so it cannot be satisfied by clamping or swapping the inputs.
  const longPeriod = Math.max(fastPeriod, slowPeriod)
  if (!bars || bars.length < longPeriod + signalPeriod) return { macd: [], signal: [], histogram: [] }
  const closes  = bars.map(b => b.c)
  const fastEMA = _ema(closes, fastPeriod)  // fastEMA[i] → bars[fastPeriod-1+i]
  const slowEMA = _ema(closes, slowPeriod)  // slowEMA[i] → bars[slowPeriod-1+i]
  const fastOffset = longPeriod - fastPeriod
  const slowOffset = longPeriod - slowPeriod
  // MACD line: aligned to bars[longPeriod-1+i]
  const span = Math.min(fastEMA.length - fastOffset, slowEMA.length - slowOffset)
  const macdValues = []
  for (let i = 0; i < span; i++) macdValues.push(fastEMA[i + fastOffset] - slowEMA[i + slowOffset])
  const signalEMA  = _ema(macdValues, signalPeriod)
  const sigOffset  = signalPeriod - 1
  const macd = blank(bars), signal = blank(bars), histogram = blank(bars)
  // The MACD LINE exists wherever both EMAs do — from bars[longPeriod-1], which
  // is `signalPeriod - 1` bars EARLIER than the signal line. This used to be
  // trimmed to the signal's start, and the golden fixtures caught it: the Python
  // lane has always emitted the line from bars[slow-1], so the two
  // implementations disagreed on 8 bars of a default 12/26/9 MACD.
  // The chart's look is unchanged — StockChart masks the line's head back to the
  // signal's first bar, which is a deliberate B1 pixel-parity hold, not this
  // function's business.
  for (let i = 0; i < macdValues.length; i++) {
    macd[longPeriod - 1 + i].value = macdValues[i]
  }
  for (let i = 0; i < signalEMA.length; i++) {
    const barIdx = longPeriod - 1 + sigOffset + i
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

/**
 * The earliest instant a bar's `t` may carry and still be believed as a real
 * point in time: 1990-01-01T00:00:00Z. Anything below it is not an instant, it
 * is a number in some OTHER unit that happens to fit in the same field.
 *
 * ⛔ IT EXISTS BECAUSE THE DEFECT WAS LIVE AND MEASURED, ON THE PYTHON SIDE OF
 * THIS EXACT FUNCTION. `bars_sqlite` stores daily timestamps as `YYYYMMDD` ints
 * and `indicator_alert_evaluator._fetch_bars_for_alert` passes them through, so
 * `compute_vwap` anchored 400 daily bars in **1970-08-23** — one "session" for
 * two years of tape — and never raised. THIS lane reaches the same place by a
 * different door: a daily bar arrives here with `t` as the STRING '2026-08-05',
 * `bar.t * 1000` is NaN, and the old code fell to a stable 'invalid' day key,
 * which is one bucket for the whole series. Same output, same silence.
 *
 * ⛔ THE REFUSAL IS AN ALL-NaN COLUMN, NOT A PLAUSIBLE ANSWER. "One bucket for
 * the whole series" IS the defect's output, so a fallback shaped like it could
 * never be told apart from it. `hasAnyFinite` reads false and the indicator
 * visibly does not draw. Regular use never notices: `eligibility.VWAP_TIMEFRAMES`
 * keeps this function on timeframes whose `t` is unix seconds, and this is that
 * gate restated where a regression in it cannot route around the maths.
 */
export const VWAP_MIN_INSTANT = 631152000

export function computeVWAP(bars) {
  if (!bars?.length) return []
  // THE UNIT GATE — all-or-nothing, before any accumulation. A per-bar skip
  // would leave the surviving bars in one bucket, which is the shape refused.
  for (let i = 0; i < bars.length; i++) {
    const t = bars[i].t
    if (!Number.isFinite(t) || t < VWAP_MIN_INSTANT) return blank(bars)
  }
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
    // `bar.t` is a real instant: the gate at the top already refused everything
    // else, so there is no 'invalid' sentinel branch here to fall through to.
    const hour = Math.floor(bar.t / 3600)
    let dayKey
    if (hour === memoHour) {
      dayKey = memoKey
    } else {
      dayKey = etDayKey(bar.t * 1000)
      memoHour = hour; memoKey = dayKey
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
  // ⛔ THE FIRST COMPUTABLE BAR IS THE LONGEST PERIOD, AND SENKOU B IS NOT ALWAYS IT.
  //
  // Both the guard and the loop below assumed `senkouBPeriod` was the largest of
  // the three, because at the shipped 9/26/52 it is. The form does not enforce
  // that: `tenkanPeriod` declares `max: 75`, `kijunPeriod` declares `max: 200`,
  // and `senkouBPeriod` can be taken down to `1`. Set any of those and the loop
  // started at `senkouBPeriod - 1`, where `periodMid(bars, i, kijunPeriod)` reads
  // from `i - kijunPeriod + 1` — a NEGATIVE index. `bars[-n]` is `undefined` and
  // `undefined.h` THROWS.
  //
  // ⚰️ That is worse than the sibling defect in `computeMACD`, which produced NaN
  // and drew a blank line: this one raises a TypeError out of the render path.
  // Found by `engine/__tests__/everyIndicatorParameterSweep.test.js`, which sweeps
  // every definition across the range its own inputs advertise rather than
  // trusting the defaults — the corner no fixture had ever visited.
  //
  // At 9/26/52 `longest === senkouBPeriod`, so the start bar, the guard and every
  // emitted value are byte-identical to before for every shipped chart.
  const longest = Math.max(tenkanPeriod, kijunPeriod, senkouBPeriod)
  if (!bars || bars.length < longest) return { tenkan: [], kijun: [], spanA: [], spanB: [], chikou: [] }

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

  for (let i = longest - 1; i < bars.length; i++) {
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

// ═══════════════════════════════════════════════════════════════════════════
// PHASE C TASK 14 — Anchored VWAP · ATR bands · the RS line
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The anchors `computeAVWAP` accepts. Exported and frozen so the DEFINITION's
 * `enum` options and this function read ONE list — a second copy is how an
 * option a user can pick becomes an anchor the maths does not know.
 *
 * ⭐ AN `enum`, NOT A `time` (decision A3). Spec §3.1 reserves `time` and
 * `defSchema` fails closed on it, and click-to-anchor already ships as the
 * DRAWING TOOL in `ChartDrawingOverlay.jsx` — which is anchored by a click and
 * needs no definition. These seven are the anchors a *definition* can name.
 */
export const AVWAP_ANCHORS = Object.freeze([
  'session', 'week', 'month', 'quarter', 'year', 'swingHigh', 'swingLow',
])

/**
 * 🔴 THE UNIT GUARD, AND IT IS NOT A MAGNITUDE HEURISTIC ABOUT THE ANCHOR.
 *
 * `1990-01-01T00:00:00Z`. A bar older than this is not a bar this application
 * has ever served (`bars_fetch` caps daily/weekly lookback at 30 years), so a
 * `t` below it is a **unit error** — a value that is not unix seconds at all —
 * and never "a very old bar".
 *
 * It existed because the defect WAS LIVE and MEASURED elsewhere in this repo:
 * `_fetch_bars_for_alert` handed `compute_vwap` the store's `YYYYMMDD` integer
 * (`20250101`) where real unix seconds are expected, so the anchor resolved to
 * **1970-08-23**, two years of daily bars spanned 11,130 seconds, and 56 bars of
 * "daily VWAP" produced exactly ONE reset — at index 0. Nothing raised, so
 * nothing surfaced it: the line was plausible and wrong. `computeVWAP` and
 * `compute_vwap_raw` now carry this same guard, which is what closed it.
 *
 * ⚠️ READ THE DISTINCTION THE PHASE MAKES. The ANCHOR is encoded by calendar
 * semantics resolved per instant from the IANA database — never by how big the
 * number is. This constant does not decide *which* anchor a bar falls in; it
 * decides whether the bar carries an INSTANT at all, and refuses the whole
 * column when it does not. "Encode by timeframe, never by magnitude" is a rule
 * about the anchor; validating the unit is the thing that makes it possible to
 * obey, because a date-shaped integer silently answers every calendar question
 * with 1970.
 *
 * ⛔ AND THE REFUSAL IS AN ALL-NaN COLUMN, NOT A PLAUSIBLE ANSWER. A "one bucket
 * for the whole series" fallback is exactly what the live defect produces, so it
 * could not be told apart from it. `hasAnyFinite` reads false, the pane is
 * dropped, and the indicator visibly does not draw.
 *
 * ⭐ IT IS `VWAP_MIN_INSTANT` ITSELF, NOT A COPY OF ITS VALUE, AND THAT IS
 * LOAD-BEARING. `computeAVWAP(bars, 'session')` is documented to be
 * `computeVWAP(bars)` bar for bar; while only one of them validated the unit
 * that promise was FALSE on precisely the inputs that carry the defect. Two
 * constants that happen to be equal today is how that gap reopens.
 */
export const AVWAP_MIN_INSTANT = VWAP_MIN_INSTANT

/** Named ET calendar parts, including the weekday the `week` anchor needs.
 *  `formatToParts` rather than a locale whose pattern happens to be ISO: the key
 *  is built from the NAMED parts, so it cannot drift with the host's CLDR data. */
const ET_ANCHOR_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
})

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** `{y, m, d, wd}` in `America/New_York` for a unix-seconds instant. */
function etParts(t) {
  const parts = ET_ANCHOR_PARTS.formatToParts(new Date(t * 1000))
  let y = 0, m = 0, d = 0, wd = 0
  for (const p of parts) {
    if (p.type === 'year') y = Number(p.value)
    else if (p.type === 'month') m = Number(p.value)
    else if (p.type === 'day') d = Number(p.value)
    else if (p.type === 'weekday') wd = WEEKDAY_INDEX[p.value] ?? 0
  }
  return { y, m, d, wd }
}

/**
 * The anchor bucket a bar falls in, as a string key.
 *
 * ⚠️ THE ZONE IS RESOLVED PER INSTANT, NOT FROM ONE OFFSET CAPTURED AT IMPORT.
 * A module-load `_ET_OFFSET` is correct for half the year and silently an hour
 * wrong for the other half depending on when the page loaded — the same class of
 * defect `VWAP_SESSION_ANCHOR` retired, and the reason `StockChart.jsx:517`'s
 * constant must never become this function's source.
 *
 * The `week` key is the ET civil date of the preceding MONDAY, computed with
 * plain civil arithmetic (`Date.UTC` on the already-resolved y/m/d), so it
 * cannot re-enter a timezone and pick up an offset a second time.
 */
function etAnchorKey(t, anchor) {
  const { y, m, d, wd } = etParts(t)
  if (anchor === 'session') return `${y}-${m}-${d}`
  if (anchor === 'month') return `${y}-${m}`
  if (anchor === 'quarter') return `${y}-Q${Math.floor((m - 1) / 3) + 1}`
  if (anchor === 'year') return `${y}`
  // week — back up to Monday. `wd` is 0=Sun..6=Sat, so Sunday is six days in.
  const back = (wd + 6) % 7
  const monday = new Date(Date.UTC(y, m - 1, d) - back * 86400000)
  return `W${monday.getUTCFullYear()}-${monday.getUTCMonth() + 1}-${monday.getUTCDate()}`
}

/**
 * Anchored VWAP — the session VWAP's accumulator, restarted at a NAMED anchor.
 *
 * `session` is the same boundary `computeVWAP` uses (the ET calendar day), so on
 * a one-session series the two are the same number, bar for bar. The other six
 * anchors are what makes it a different indicator: `week`/`month`/`quarter`/
 * `year` restart on the ET calendar boundary, and `swingHigh`/`swingLow` restart
 * at every bar that makes a NEW RUNNING EXTREME — causal, no lookahead, so the
 * value at bar `i` never changes when bar `i+1` arrives.
 *
 * ⚠️ ONLY THE CALENDAR ANCHORS TOUCH TIME AT ALL. The two swing anchors are pure
 * price, so they are unaffected by the unit guard — which is correct, and worth
 * stating: a guard that fired on them would refuse a column it has no reason to
 * doubt.
 *
 * @param {Array}  bars   `[{t,o,h,l,c,v}]`, `t` in UNIX SECONDS
 * @param {string} anchor one of `AVWAP_ANCHORS`
 * @returns {Array} `[{time, value}]`, NaN-padded, aligned to `bars`
 */
export function computeAVWAP(bars, anchor = 'session') {
  if (!bars?.length) return []
  // Fail CLOSED on an anchor the maths does not know. `defSchema` already
  // refuses an out-of-vocabulary enum value at registration, so this is the
  // second door: `params_json` on a stored alert row is user-supplied.
  if (!AVWAP_ANCHORS.includes(anchor)) return blank(bars)

  const byPrice = anchor === 'swingHigh' || anchor === 'swingLow'
  if (!byPrice) {
    for (let i = 0; i < bars.length; i++) {
      const t = bars[i].t
      if (!Number.isFinite(t) || t < AVWAP_MIN_INSTANT) return blank(bars)
    }
  }

  const result = blank(bars)
  let cumPV = 0, cumVol = 0, anchorKey = null
  // One-entry memo on the UTC HOUR, exact rather than approximate for the same
  // reason `computeVWAP`'s is: every `America/New_York` offset is a whole number
  // of hours and every transition lands on a whole UTC hour, so no anchor
  // coarser than an hour can change inside one. Local, so it cannot grow across
  // calls.
  let memoHour = null, memoKey = null
  let extreme = null, swingAt = 0
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]
    let key
    if (byPrice) {
      if (anchor === 'swingHigh') {
        if (extreme === null || bar.h > extreme) { extreme = bar.h; swingAt = i }
      } else if (extreme === null || bar.l < extreme) { extreme = bar.l; swingAt = i }
      key = swingAt
    } else {
      const hour = Math.floor(bar.t / 3600)
      if (hour === memoHour) {
        key = memoKey
      } else {
        key = etAnchorKey(bar.t, anchor)
        memoHour = hour; memoKey = key
      }
    }
    if (key !== anchorKey) { cumPV = 0; cumVol = 0; anchorKey = key }
    const tp = (bar.h + bar.l + bar.c) / 3
    const v = Number(bar.v) || 0
    cumPV += tp * v
    cumVol += v
    if (cumVol > 0) result[i].value = cumPV / cumVol
  }
  return result
}

/**
 * ATR bands — the close, plus and minus `multiplier` × ATR(`period`).
 *
 * ⭐ IT COSTS NO NEW MATHS AND THAT IS DELIBERATE. Every number here is
 * `computeATR`'s, which `tests/fixtures/indicators/atr_14.json` has pinned in
 * BOTH lanes at rel-tol 1e-9 since B5 — so the fixture `atr_bands_14_2.json`
 * points at `atr_14.json` with `barsFrom` and both lanes re-derive the three
 * columns from that already-pinned `atr` column. The oracle is older than either
 * implementation, exactly as it is for SAR's two event columns, and a reseed of
 * `atr_14` turns this case red.
 *
 * ⚠️ THE MIDDLE IS THE CLOSE, AND IT SHARES THE EDGES' PAD. A middle that
 * existed where the edges did not would be a band with nothing to draw between —
 * the unrenderable shape `defSchema.validateBandEdges` exists to refuse one
 * level up — so all three columns start at `bars[period]`, where ATR does.
 *
 * ⚠️ `multiplier` IS AN INPUT READ BY THE COMPUTE, NOT A `$ref` IN A PLOT.
 * `$<inputKey>` substitution is legal in `color`, `width`, `levels` and
 * `lineStyle` only (`SUBSTITUTABLE_PLOT_FIELDS`); a band's WIDTH IN PRICE is
 * none of those. Writing it as a plot literal would render one multiplier for
 * every user while the settings form offered a control that changed nothing.
 */
export function computeATRBands(bars, period = 14, multiplier = 2) {
  const empty = { upper: [], middle: [], lower: [] }
  if (!bars || bars.length < period + 1) return empty
  const atr = computeATR(bars, period)
  if (!atr.length) return empty
  const upper = blank(bars), middle = blank(bars), lower = blank(bars)
  for (let i = 0; i < bars.length; i++) {
    const a = atr[i] ? atr[i].value : NA
    if (!Number.isFinite(a)) continue
    const c = bars[i].c
    middle[i].value = c
    upper[i].value = c + multiplier * a
    lower[i].value = c - multiplier * a
  }
  return { upper, middle, lower }
}

/**
 * The relative-strength line — this symbol's close over the BENCHMARK's close.
 *
 * ⛔ IT TAKES A SECOND SYMBOL, WHICH IS WHY ITS DEFINITION IS `compute.kind:
 * 'server'` AND NOT A NATIVE. The compute contract (spec §4) is
 * `compute({bars, inputs, prevState, barstate})` — ONE `bars` — so a native
 * adapter could only ever hand this function the chart's own series, and
 * `close / close` is **1.0 on every bar**. That is the silent failure this
 * function's shape refuses: a single-symbol RS line is a flat line at one, and
 * it looks exactly like an indicator that is working.
 *
 * ⚠️ JOINED BY BAR TIME, NEVER BY INDEX. A benchmark series missing one bar —
 * a halt, a late print, a different session filter — would shift every
 * subsequent ratio by one bar under an index join, and the line would be
 * plausible and wrong for the whole history rather than absent for one bar.
 * A bar with no benchmark print is the NaN pad, which is the honest answer.
 *
 * @param {Array} bars           the chart's bars
 * @param {Array} benchmarkBars  the benchmark's bars, same shape
 * @returns {Array} `[{time, value}]`, NaN-padded, aligned to `bars`
 */
export function computeRSLine(bars, benchmarkBars) {
  if (!bars?.length) return []
  const result = blank(bars)
  if (!benchmarkBars?.length) return result
  const closeAt = new Map()
  for (const b of benchmarkBars) {
    if (b && Number.isFinite(b.c)) closeAt.set(b.t, b.c)
  }
  for (let i = 0; i < bars.length; i++) {
    const bc = closeAt.get(bars[i].t)
    if (!Number.isFinite(bc) || bc === 0) continue
    result[i].value = bars[i].c / bc
  }
  return result
}

// ─── THE BAR CLOCK — the closed table's `clock` section, computed HERE ────────
//
// ⭐⭐ IT LIVES IN THIS FILE FOR A MEASURED REASON, NOT A STYLISTIC ONE.
// `interpret.test.js` BANS `Date` and `Intl` inside `interpret.js` and
// `budget.js` by an AST scan over their own source, and widens the allowlist for
// exactly one module: this one (`WIDENED_BY = ['Date', 'Intl']`, for `etDayKey`).
// So the wall-clock fields cannot be computed where they are consumed — they are
// computed here and BOUND there, exactly the way `rsi` is. Writing them into
// `interpret.js` would either break that proof or force it to be widened, and a
// purity claim that widens whenever something needs a clock is not one.
//
// ⚠️ THE ET ZONE IS RESOLVED PER INSTANT from the IANA database, never from one
// offset captured at import — see `etDayKey`'s header for the full argument.
// This function's fixture (`tests/fixtures/ast/clock_parity.json`) spans the
// 2025-11-02 EDT→EST fallback and a weekend precisely so that is MEASURED.

/** ET calendar parts INCLUDING the wall clock — what `etParts` has plus hour.
 *  A THIRD formatter rather than a widening of `ET_ANCHOR_PARTS`, because
 *  `etAnchorKey` reads that one on every AVWAP bar and two fields it never uses
 *  are cost with no reader.
 *
 *  `hourCycle: 'h23'` because `hour12: false` in `en-US` renders midnight as the
 *  string `24` — a documented ICU behaviour `intraday5m.test.js` already works
 *  around with `% 24`. The cycle is declared instead, and the `% 24` is kept
 *  below as the belt: a host whose ICU predates `hourCycle` would otherwise put
 *  a 24 into a column this table declares as 0..23. */
const ET_CLOCK_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  hour: '2-digit', hourCycle: 'h23',
})

/** The timeframe codes this platform ships, and the ones that are intraday.
 *
 *  ⛔ ANYTHING ELSE IS NOT CLASSIFIED, IT IS REFUSED. A custom 3-minute chart is
 *  genuinely intraday, but `tf` is a string that reaches here from a stored
 *  definition and from a widget's saved options, and guessing from its SHAPE
 *  ("it parses as a number, so it must be minutes") is how a `2D` or a `1H`
 *  spelling silently becomes an intraday claim. An unrecognised code makes the
 *  four booleans NaN — the same answer an ABSENT `tf` gets, and never a
 *  confident 0, which would read as "no, this is not intraday". */
const CLOCK_INTRADAY_TFS = ['1', '5', '15', '30', '60']
const CLOCK_TIMEFRAMES = [...CLOCK_INTRADAY_TFS, 'D', 'W', 'M']

/** The eight columns that read the bar's `t`, and therefore the eight the unit
 *  gate below refuses together. Derived from nothing: it IS the partition, and
 *  `computeClock` reads it in both directions so the two halves cannot drift. */
const CLOCK_TIME_DERIVED = ['time', 'year', 'month', 'dayofmonth', 'dayofweek',
  'hour', 'minute', 'sessionfirst']

/** Every column `computeClock` produces.
 *
 *  ⚠️ THE CLOSED TABLE IS THE AUTHORITY OVER WHICH OF THESE NAMES A FORMULA MAY
 *  SPELL; this is the authority over what each one MEANS. `interpret` seeds the
 *  manifest's `clock` keys out of this bundle and throws BY NAME on an entry the
 *  bundle has no column for — a declared name quietly seeded NaN would be a
 *  clock that reads "not computable" forever, on every bar, silently. */
export const CLOCK_COLUMNS = Object.freeze([
  ...CLOCK_TIME_DERIVED, 'barindex', 'isintraday', 'isdaily', 'isweekly', 'ismonthly',
])

/**
 * The clock columns for a bar series, aligned to `bars`.
 *
 * `time` is the bar's own `t` IN UNIX SECONDS — this platform's unit everywhere
 * a bar carries one — and NOT Pine's milliseconds. The manifest's sentence says
 * so, because a member comparing `time` against a number read off a Pine script
 * would otherwise be out by a factor of a thousand with nothing to see.
 *
 * `dayofweek` is 1 on Sunday through 7 on Saturday, which IS Pine's convention
 * (`dayofweek.sunday == 1`) and deliberately not `Date`'s 0..6. The table's whole
 * import story is Pine, and two off-by-one conventions for one name is the defect
 * `williams_r` / `williamsR` already cost this repo once.
 *
 * ⛔ THE UNIT GATE IS `computeVWAP`'S, AND IT IS PARTIAL ON PURPOSE.
 * `bars_sqlite` stores daily/weekly/monthly `t` as `YYYYMMDD` INTS, and
 * `20250101` read as unix seconds is 1970-08-23 — so a series that is not in
 * seconds must not be answered for. It refuses the EIGHT time-derived columns
 * all-or-nothing (a per-bar skip leaves the survivors in one ET day, which is
 * the shape being refused) and it leaves `barindex` and the four timeframe
 * booleans alone: those read no `t` at all, and a guard firing on them would
 * refuse a column it has no reason to doubt. `computeAVWAP` draws the same line
 * between its calendar anchors and its swing ones, for the same reason.
 *
 * ⛔ AND AN ABSENT `tf` FAILS CLOSED, NEVER TO A DEFAULT. A guessed `'D'` makes
 * `isdaily` a confident 1 on a 5-minute chart, which is a wrong answer wearing a
 * right one's clothes. NaN is "nobody told me", which every consumer of this
 * table already knows how to render.
 *
 * @param {Array}  bars `[{t,o,h,l,c,v}]`, `t` in UNIX SECONDS
 * @param {string} [tf] one of `1 5 15 30 60 D W M`; absent or unknown ⇒ the four
 *                      timeframe booleans are NaN
 * @returns {object} `{<name>: Float64Array}` — one entry per `CLOCK_COLUMNS`
 */
export function computeClock(bars, tf) {
  const length = bars && bars.length ? bars.length : 0
  const cols = {}
  for (const name of CLOCK_COLUMNS) cols[name] = new Float64Array(length)
  if (!length) return cols

  // The timeframe half reads no bar at all, so it is decided ONCE and written
  // flat. `known` is a membership test over the declared codes — never a parse.
  const known = CLOCK_TIMEFRAMES.includes(tf)
  cols.isintraday.fill(known ? (CLOCK_INTRADAY_TFS.includes(tf) ? 1 : 0) : NA)
  cols.isdaily.fill(known ? (tf === 'D' ? 1 : 0) : NA)
  cols.isweekly.fill(known ? (tf === 'W' ? 1 : 0) : NA)
  cols.ismonthly.fill(known ? (tf === 'M' ? 1 : 0) : NA)

  // `barindex` is the loop counter and nothing else. It is HERE rather than in
  // `interpret` so the clock has ONE owner: a second place that knew what bar
  // number a bar is would be a second authority over a value both lanes compare.
  for (let i = 0; i < length; i++) cols.barindex[i] = i

  // THE UNIT GATE — before any formatter work, so a refused series costs none.
  let instants = true
  for (let i = 0; i < length; i++) {
    const t = bars[i] ? bars[i].t : undefined
    if (!Number.isFinite(t) || t < VWAP_MIN_INSTANT) { instants = false; break }
  }
  if (!instants) {
    for (const name of CLOCK_TIME_DERIVED) cols[name].fill(NA)
    return cols
  }

  // One-entry memo on the UTC hour, exactly as `computeVWAP` does and EXACT for
  // the same reason: every `America/New_York` offset is a whole number of hours
  // and every transition lands on a whole UTC hour, so no ET field down to the
  // hour can change inside one UTC hour. Bars arrive ascending, so consecutive
  // bars hit it. ⚠️ THE MINUTE IS NOT IN THE MEMO — it changes inside the hour by
  // definition — so it is derived from the instant in hand rather than formatted.
  let memoHour = null
  let memoParts = null
  let prevDay = -1
  for (let i = 0; i < length; i++) {
    const t = bars[i].t
    const utcHour = Math.floor(t / 3600)
    let p
    if (utcHour === memoHour) {
      p = memoParts
    } else {
      p = etClockParts(t)
      memoHour = utcHour
      memoParts = p
    }
    cols.time[i] = t
    cols.year[i] = p.y
    cols.month[i] = p.m
    cols.dayofmonth[i] = p.d
    cols.dayofweek[i] = p.wd + 1
    cols.hour[i] = p.h
    // ET minutes ARE UTC minutes: every ET offset is a whole number of hours.
    // Derived rather than formatted, which is what keeps the memo above exact.
    cols.minute[i] = Math.floor((t - utcHour * 3600) / 60)
    // The ET calendar day as ONE number, so the comparison below is numeric and
    // no string key has to be built per bar. `sessionfirst` is 1 on the first
    // bar of the series by construction: no previous bar means no previous day.
    const day = p.y * 10000 + p.m * 100 + p.d
    cols.sessionfirst[i] = day === prevDay ? 0 : 1
    prevDay = day
  }
  return cols
}

/** `{y, m, d, wd, h}` in `America/New_York` for a unix-seconds instant, where
 *  `wd` is 0=Sun..6=Sat — the RAW index; `computeClock` is what shifts it onto
 *  Pine's 1-based day, in one place. */
function etClockParts(t) {
  const parts = ET_CLOCK_PARTS.formatToParts(new Date(t * 1000))
  let y = 0, m = 0, d = 0, wd = 0, h = 0
  for (const p of parts) {
    if (p.type === 'year') y = Number(p.value)
    else if (p.type === 'month') m = Number(p.value)
    else if (p.type === 'day') d = Number(p.value)
    else if (p.type === 'weekday') wd = WEEKDAY_INDEX[p.value] ?? 0
    else if (p.type === 'hour') h = Number(p.value) % 24
  }
  return { y, m, d, wd, h }
}
