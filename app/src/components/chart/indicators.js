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

/** Wilder's RSI. ⭐⭐⭐ IT IS AN `rma` OF GAINS AND LOSSES, AND IT INHERITS THE
 *  `rma` `na` RULE — vendor-pinned 2026-09-08.
 *
 *  ⛔⛔ THIS USED TO BOOK A ZERO CHANGE ON AN `na` BAR, and that was the worst of
 *  the four composite defects because it did not LOOK like a defect. A non-finite
 *  `diff` failed both `diff > 0` and `diff < 0`, so the bar contributed gain 0 and
 *  loss 0 — which decays BOTH averages by `(period-1)/period` and leaves their
 *  RATIO unchanged. The printed value therefore repeated the previous bar and read
 *  exactly like a hold, while the state underneath had been scaled down. Every
 *  later bar was then wrong and never re-converged: measured on a 80-bar series
 *  with one hole, bar 42 read 74.94 against a true 78.97 and bar 79 was still off.
 *  A member saw a plausible line with no gap and no way to know.
 *
 *  ⛔ AND AN `na` INSIDE THE SEED KILLED THE WHOLE SERIES. The seed summed the
 *  first `period` diffs unconditionally, so one hole there made `avgGain` NaN and
 *  the recursion never recovered — `finite = 0` over 300 bars.
 *
 *  TradingView instead HOLDS: the output is `na` on the hole AND on the bar after
 *  it (that bar's `ta.change` reads the hole as its previous value), then resumes
 *  from the pre-hole state. 380 of 380 bars, and the values reconstruct to 1.3e-6
 *  with the residual decaying geometrically — seed truncation, not a model gap.
 */
export function computeRSI(bars, period = 14) {
  if (!bars || bars.length < period + 1) return []
  const result = blank(bars)
  let avgGain = NA, avgLoss = NA, seen = 0, sumGain = 0, sumLoss = 0
  for (let i = 1; i < bars.length; i++) {
    const diff = bars[i].c - bars[i - 1].c
    // ⭐ HOLD. Not a zero observation, not a reset — the state is simply not
    // advanced, and this bar emits nothing.
    if (!Number.isFinite(diff)) continue
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    if (Number.isNaN(avgGain)) {
      sumGain += gain; sumLoss += loss; seen += 1
      if (seen < period) continue
      avgGain = sumGain / period; avgLoss = sumLoss / period
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period
      avgLoss = (avgLoss * (period - 1) + loss) / period
    }
    // ⛔⛔ THE ZERO BRANCHES, IN PINE'S ORDER: `down == 0 -> 100` is tested FIRST,
    // and only then `up == 0 -> 0`. So a source that never moves at all reads
    // 100, not `na`.
    //
    // ⚰️ THIS ENGINE DELIBERATELY ANSWERED `na` THERE, and the reasoning was
    // sound: "0/0 is not a number", and reading a frozen ticker as maximally
    // overbought put SIM/TMTS/CWEN-A/DRDB/OBA at the top of an "RSI > 70" screen
    // on 2026-08-09. It is still a UCT INVENTION. `ta.rsi` of a constant reads
    // 100 on TradingView, measured directly. The screener's problem is a frozen
    // ticker reaching a momentum screen at all, and that belongs to the screener
    // — putting the fix in the definition of RSI made every Pine script this
    // engine runs disagree with the vendor on the same bar.
    if (avgLoss === 0) result[i].value = 100
    else if (avgGain === 0) result[i].value = 0
    else result[i].value = 100 - 100 / (1 + avgGain / avgLoss)
  }
  return result
}

/** ⭐⭐ FULL-LENGTH AND BAR-ALIGNED, and it HOLDS on a non-finite input.
 *
 *  ⚰️ THIS RETURNED A COMPACTED ARRAY (`out[i]` meaning `values[period-1+i]`),
 *  which forced `computeMACD` to carry offset arithmetic for the two periods and
 *  a third for the signal. That arithmetic is what the Fast>Slow defect lived in.
 *  Aligning here deletes it: two aligned series subtract element-wise, and the
 *  later-starting one supplies the start bar with no `Math.max` anywhere.
 *
 *  ⭐⭐⭐ AND IT HOLDS ON `na`, so a hole costs one bar instead of the series.
 *  `values.slice(0, period).reduce(...)` used to seed from the first `period`
 *  entries unconditionally — one `na` among them made the seed NaN and the
 *  recursion never recovered. Vendor-pinned: `ta.macd` over a gappy source is
 *  `na` on the hole ONLY and resumes on the very next bar (380 of 380). */
function _ema(values, period) {
  const out = new Array(values.length).fill(NA)
  if (values.length < period) return out
  const k = 2 / (period + 1)
  let prev = NA, seen = 0, sum = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (!Number.isFinite(v)) continue          // HOLD
    if (Number.isNaN(prev)) {
      sum += v; seen += 1
      if (seen < period) continue
      prev = sum / period
    } else {
      prev = prev * (1 - k) + v * k
    }
    out[i] = prev
  }
  return out
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
  const fastEMA = _ema(closes, fastPeriod)   // bar-aligned, NA before its seed
  const slowEMA = _ema(closes, slowPeriod)
  const macd = blank(bars), signal = blank(bars), histogram = blank(bars)
  // ⭐⭐ TWO ALIGNED SERIES SUBTRACT ELEMENT-WISE, and that is the whole
  // alignment. The later-starting EMA supplies the first computable bar by being
  // NA before it, so `longPeriod` needs no arithmetic here and the Fast>Slow case
  // is handled by construction rather than by a `Math.max` somebody has to keep
  // correct. It also means a HOLE costs exactly the bars it touches: `na` in,
  // `na` out, and the next finite bar resumes.
  const macdValues = new Array(bars.length).fill(NA)
  for (let i = 0; i < bars.length; i++) {
    const f = fastEMA[i], sl = slowEMA[i]
    if (Number.isFinite(f) && Number.isFinite(sl)) {
      macdValues[i] = f - sl
      macd[i].value = macdValues[i]
    }
  }
  // ⭐ THE SIGNAL IS AN EMA OF THE LINE, over the same bar axis. `_ema` skips
  // the NA head and any hole, so the signal seeds from the first `signalPeriod`
  // FINITE macd values -- exactly `ta.ema(macd, signal)`.
  const signalEMA = _ema(macdValues, signalPeriod)
  for (let i = 0; i < bars.length; i++) {
    if (!Number.isFinite(signalEMA[i])) continue
    signal[i].value = signalEMA[i]
    // No per-point `color` here: the histogram's up/down colour is a RENDER
    // concern (StockChart derives it from the sign of this value, which is the
    // same test the old `m >= s` was).
    if (Number.isFinite(macdValues[i])) histogram[i].value = macdValues[i] - signalEMA[i]
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

/** Wilder's ATR — an `rma` of true range, and it HOLDS on a non-finite bar.
 *
 *  ⛔⛔ A SINGLE HOLE USED TO DESTROY THE ENTIRE REMAINING SERIES. `Math.max` with
 *  a NaN operand is NaN, so one non-finite TR made `atr` NaN and the recursion
 *  `(atr*(p-1) + tr)/p` could never return — NaN is absorbing. Measured: 80 bars
 *  with one hole at bar 40 answered on 26 bars instead of 66, and every bar from
 *  the hole to the end of the chart was blank. With holes closer together than
 *  `period` the seed never completed either and the output was empty. */
export function computeATR(bars, period = 14) {
  if (!bars || bars.length < period + 1) return []
  const result = blank(bars)
  let atr = NA, seen = 0, sum = 0
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c)
    )
    if (!Number.isFinite(tr)) continue          // HOLD
    if (Number.isNaN(atr)) {
      sum += tr; seen += 1
      if (seen < period) continue
      atr = sum / period
    } else {
      atr = (atr * (period - 1) + tr) / period
    }
    result[i].value = atr
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

/** Wilder's ADX / +DI / -DI — three `rma`s over one forward pass, HOLDING on a
 *  non-finite bar.
 *
 *  ⛔⛔ THIS CARRIED THE SAME ABSORBING-NaN DEFECT AS `computeATR` **AND** A
 *  SECOND ONE THE OTHER THREE DID NOT HAVE: it FABRICATED directional movement.
 *  `plusDM[i] = (up > down && up > 0) ? up : 0` — with a NaN `up` both
 *  comparisons are false, so the bar booked a confident ZERO rather than
 *  refusing. The TR side then went NaN and stayed NaN, so the fabricated zeros
 *  were invisible: the series was blank from the first hole onward regardless.
 *  Fix one without the other and the fabrication becomes VISIBLE instead — which
 *  is why both move here, in one pass.
 *
 *  ⭐ ONE PASS, THREE SEEDS. The old shape was three passes over pre-built
 *  arrays (`plusDM`/`minusDM`/`tr`, then a seed loop over indices `1..period`,
 *  then a DX smoother seeded over `dxValues[period .. 2*period-1]`). Every one of
 *  those index ranges assumed each bar contributes exactly one observation, which
 *  is precisely what a hole breaks. Counting OBSERVATIONS instead of BARS is what
 *  makes the seeds hole-proof, and it is the same change `computeRSI` and
 *  `computeATR` needed.
 *
 *  ⚠️ REACHABILITY, STATED. Pine's `ta.adx` takes only a length — there is no
 *  source parameter — and this engine refuses `ta.adx` at the columnar door with
 *  `pine:role-order` anyway, so no Pine script currently reaches this code with a
 *  gappy source. It is corrected because it is the NATIVE chart/screener ADX and
 *  a hole in real OHLCV would have silently blanked it from that bar on, not
 *  because a fixture caught it. That is a smaller claim than the other three
 *  carry and it is made deliberately smaller. */
export function computeADX(bars, period = 14) {
  const empty = { adx: [], plusDI: [], minusDI: [] }
  if (!bars || bars.length < 2 * period) return empty
  const plusDI = blank(bars), minusDI = blank(bars), adxOut = blank(bars)

  let sPlus = 0, sMinus = 0, sTR = 0, diSeen = 0, diReady = false
  let adx = NA, dxSeen = 0, dxSum = 0

  for (let i = 1; i < bars.length; i++) {
    const up = bars[i].h - bars[i - 1].h
    const down = bars[i - 1].l - bars[i].l
    const tr = Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c),
    )
    // ⛔ HOLD — and this is the line that stops the fabrication. A bar whose
    // directional movement cannot be COMPUTED contributes nothing; it does not
    // contribute a zero.
    if (!Number.isFinite(up) || !Number.isFinite(down) || !Number.isFinite(tr)) continue
    const pDM = (up > down && up > 0) ? up : 0
    const mDM = (down > up && down > 0) ? down : 0

    if (!diReady) {
      sPlus += pDM; sMinus += mDM; sTR += tr; diSeen += 1
      if (diSeen < period) continue
      diReady = true
    } else {
      sPlus = sPlus - sPlus / period + pDM
      sMinus = sMinus - sMinus / period + mDM
      sTR = sTR - sTR / period + tr
    }
    const pdi = sTR === 0 ? 0 : 100 * sPlus / sTR
    const mdi = sTR === 0 ? 0 : 100 * sMinus / sTR
    plusDI[i].value = pdi
    minusDI[i].value = mdi
    const sum = pdi + mdi
    const dx = sum === 0 ? 0 : 100 * Math.abs(pdi - mdi) / sum

    if (Number.isNaN(adx)) {
      dxSum += dx; dxSeen += 1
      if (dxSeen < period) continue
      adx = dxSum / period
    } else {
      adx = (adx * (period - 1) + dx) / period
    }
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

// ─── Price-Volume Trend (PVT) ───────────────────────────────────────────────
// TradingView's own published reference-manual EXAMPLE source:
//   f_pvt() => ta.cum((ta.change(close) / close[1]) * volume)
// PVT[0] = 0 (seed; the LEVEL is never exposed to a formula — only a windowed
// DELTA is, via `pvtN` — so an unverified seed cannot leak into any answer
// this engine emits, the same justification `computeOBV`'s own seed carries).
// Zero-previous-close is treated as a 0 contribution: a defensive, UNVERIFIED
// boundary, since SPY (or any real equity) never presents one in a live
// capture. Verified against a real TradingView capture (exact match, 15 real
// SPY trading days, steady-state 5-bar windowed delta):
// tests/fixtures/vendor/observations/ta-pvt-delta5-2026-09-06.json

export function computePVT(bars) {
  if (!bars?.length) return []
  const result = [{ time: bars[0].t, value: 0 }]
  let pvt = 0
  for (let i = 1; i < bars.length; i++) {
    const prevClose = bars[i - 1].c
    const v = bars[i].v || 0
    const term = prevClose ? ((bars[i].c - prevClose) / prevClose) * v : 0
    pvt += term
    result.push({ time: bars[i].t, value: pvt })
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
 * The NAMED anchors `computeAVWAP` accepts. Exported and frozen so the
 * DEFINITION's `enum` options and this function read ONE list — a second copy is
 * how an option a user can pick becomes an anchor the maths does not know.
 *
 * ⚠️ NOT THE WHOLE VOCABULARY SINCE 2026-08-26: `computeAVWAP` also accepts a
 * NUMBER, read as a unix-seconds instant, because the closed table's `avwap`
 * has no argument kind that can carry a name. This list stays the ENUM — what a
 * definition may pick — and the numeric form has no picker.
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

/** The single bucket key an INSTANT anchor uses. There is only ever one bucket:
 *  a bar is either past the anchor or not computable, so the key never changes
 *  once it is set and the reset in `computeAVWAP` fires exactly once, at the
 *  anchor bar. */
const ANCHORED = 'anchored'

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
 * @param {string|number} anchor one of `AVWAP_ANCHORS`, or a unix-seconds
 *   INSTANT — see the numeric branch below
 * @returns {Array} `[{time, value}]`, NaN-padded, aligned to `bars`
 */
export function computeAVWAP(bars, anchor = 'session') {
  if (!bars?.length) return []
  // ⭐ A NUMBER IS AN INSTANT, AND IT IS THE ONE ANCHOR A CLOSED-TABLE FORMULA
  // CAN SPELL. `closedTable.json` has exactly two argument kinds, `series` and
  // `int`, and no string literal node — so `avwap`'s anchor reaches this
  // function as a unix-seconds epoch or not at all. It is a NEW anchor KIND
  // rather than a new accumulator: the loop, the typical price, the reset rule
  // and the unit guard below are the ones the named anchors already use.
  const byInstant = typeof anchor === 'number'
  // Fail CLOSED on an anchor the maths does not know. `defSchema` already
  // refuses an out-of-vocabulary enum value at registration, so this is the
  // second door: `params_json` on a stored alert row is user-supplied.
  if (!byInstant && !AVWAP_ANCHORS.includes(anchor)) return blank(bars)
  // ⛔ AND THE UNIT GUARD APPLIES TO THE ANCHOR ITSELF, not only to the bars.
  // A `YYYYMMDD` integer handed in as an instant resolves to 1970 and would
  // anchor at bar zero — a plausible line, silently wrong, which is the exact
  // shape `AVWAP_MIN_INSTANT` exists to refuse on the bar side.
  if (byInstant && (!Number.isFinite(anchor) || anchor < AVWAP_MIN_INSTANT)) return blank(bars)

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
    } else if (byInstant) {
      // ⛔ BEFORE THE ANCHOR IS NOT COMPUTABLE, NEVER A PARTIAL ACCUMULATION.
      // A running total of the bars that came FIRST is a confident wrong number
      // wearing a warm-up's clothes — the same refusal `accum` makes for bars
      // that have no seed to run from. Nothing is added and nothing is written,
      // so the accumulator is still empty at the anchor bar and the reset below
      // is the no-op it should be.
      if (bar.t < anchor) continue
      key = ANCHORED
      // ⚠️ NO HOUR MEMO HERE, deliberately: the key flips INSIDE an hour (at
      // whichever bar first reaches the anchor), and the memo is only exact for
      // buckets no finer than the UTC hour it is keyed on.
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

/** The four timeframe booleans for a code — or `null` when the code is unknown.
 *
 *  ⛔ ONE DERIVATION, TWO READERS. `computeClock` writes these into columns, and
 *  the BIND STAGE folds a timeframe-conditional length with them
 *  (`bind.js::bindingConstants`). A second place that decided what `isweekly`
 *  means would be a second authority over a value both lanes compare — and the
 *  two would disagree on exactly the day someone added a timeframe to one.
 *
 *  ⛔ `null` FOR AN UNKNOWN CODE, NEVER A GUESSED DEFAULT. A guessed `isdaily`
 *  is a confident 1 on a 5-minute chart: a wrong answer wearing a right one's
 *  clothes. The callers fail closed on `null` — blank columns for the clock, an
 *  unfolded length for the bind stage. */
export function timeframeFlags(tf) {
  if (!CLOCK_TIMEFRAMES.includes(tf)) return null
  return {
    isintraday: CLOCK_INTRADAY_TFS.includes(tf),
    isdaily: tf === 'D',
    isweekly: tf === 'W',
    ismonthly: tf === 'M',
  }
}

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
/** The two BARSTATE columns that read only the fetch's EXTENT — which bar this
 *  is out of how many — and no clock at all.
 *
 *  ⭐ THEY ARE OUTSIDE THE UNIT GATE FOR THE SAME REASON `barindex` IS: they
 *  never touch `t`, so a series stored in `YYYYMMDD` ints gives them no reason
 *  to doubt themselves. They also can never BLANK — there is no input they
 *  could be missing. `isfirst` is nonetheless WINDOW-DEPENDENT in the
 *  requirement-tag sense and `islast` is not — widen the fetch and the oldest
 *  bar moves while the newest one does not. That distinction is the ruling, and
 *  it is the reason these two are not one column with a flag. */
export const CLOCK_EXTENT = Object.freeze(['islast', 'isfirst'])

/** The four BARSTATE columns that need to know whether the newest bar's period
 *  has finished — a fact this module is TOLD, never one it computes.
 *
 *  ⛔⛔ ALL FOUR ARE TRI-STATE AND FAIL CLOSED TO NaN when `newestBarIsForming`
 *  is `null`, exactly as the four timeframe booleans fail closed without a
 *  `tf`. `null` means "nobody told me", which every consumer of this table
 *  already renders; it does NOT mean "not forming". Collapsing the two would
 *  make `isconfirmed` a confident 1 on a bar that is still forming — a wrong
 *  answer wearing a right one's clothes — and the whole point of these columns
 *  is that a member can trust the last bar. */
export const CLOCK_REALTIME = Object.freeze(['isrealtime', 'isconfirmed',
  'ishistory', 'islastconfirmedhistory'])

/** The six together. DERIVED, never retyped — a second literal listing these
 *  names would be a second authority over one set. */
export const CLOCK_BARSTATE = Object.freeze([...CLOCK_EXTENT, ...CLOCK_REALTIME])

export const CLOCK_COLUMNS = Object.freeze([
  ...CLOCK_TIME_DERIVED, 'barindex', 'isintraday', 'isdaily', 'isweekly', 'ismonthly',
  ...CLOCK_EXTENT, ...CLOCK_REALTIME,
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
 * @param {boolean|null} [newestBarIsForming] THE TRI-STATE: `true`, `false`, or
 *                      `null` for "nobody told me". `null` (or anything that is
 *                      not a boolean) ⇒ the four BARSTATE realtime columns are
 *                      NaN. ⛔ `null` IS NOT `false`: collapsing them would make
 *                      `isconfirmed` a confident 1 on a bar that may still be
 *                      open. ⛔ A PARAMETER RATHER THAN `Date.now()`: two
 *                      bindings of one fetch must agree bar for bar, and a
 *                      function that reads the wall clock cannot be asked the
 *                      same question twice — which is what the stability rails
 *                      ask it.
 *                      ⚰️ THERE WERE ONCE `now` AND `holidays` PARAMETERS HERE.
 *                      They are gone: the instant and both NYSE sets are read on
 *                      the Python side by `indicator_compute.py::bar_close_state`,
 *                      which reduces them to this one value. A date set in this
 *                      lane would be a second calendar authority in a second
 *                      language.
 * @returns {object} `{<name>: Float64Array}` — one entry per `CLOCK_COLUMNS`
 */
/** The two ways the six barstate columns can be derived from one fetch.
 *
 *  @@ `calendar` IS WHAT SHIPS. `vendor` reproduces what TradingView was measured
 *  doing on 2026-09-10, on three axes that are INDEPENDENT rather than a
 *  tri-state. Mirrors `indicator_compute.BARSTATE_MODE_*` value for value.
 *
 *  !! THE CALENDAR STILL DOES NOT CROSS THIS SEAM. `vendor` needs to know whether
 *  the closing update has happened, which is a calendar question -- so it arrives
 *  as a BOOLEAN from the producer, exactly as `newestBarIsForming` does. This file
 *  gains a mode, not a date set. */
export const BARSTATE_MODE_CALENDAR = 'calendar'
export const BARSTATE_MODE_VENDOR = 'vendor'
export const BARSTATE_MODES = Object.freeze([BARSTATE_MODE_CALENDAR, BARSTATE_MODE_VENDOR])

export function computeClock(bars, tf, newestBarIsForming = null, opts = {}) {
  const length = bars && bars.length ? bars.length : 0
  const cols = {}
  for (const name of CLOCK_COLUMNS) cols[name] = new Float64Array(length)
  if (!length) return cols

  // The timeframe half reads no bar at all, so it is decided ONCE and written
  // flat. `known` is a membership test over the declared codes — never a parse.
  const flags = timeframeFlags(tf)
  cols.isintraday.fill(flags ? (flags.isintraday ? 1 : 0) : NA)
  cols.isdaily.fill(flags ? (flags.isdaily ? 1 : 0) : NA)
  cols.isweekly.fill(flags ? (flags.isweekly ? 1 : 0) : NA)
  cols.ismonthly.fill(flags ? (flags.ismonthly ? 1 : 0) : NA)

  // `barindex` is the loop counter and nothing else. It is HERE rather than in
  // `interpret` so the clock has ONE owner: a second place that knew what bar
  // number a bar is would be a second authority over a value both lanes compare.
  for (let i = 0; i < length; i++) cols.barindex[i] = i

  // ── barstate ─────────────────────────────────────────────────────────────
  // ⭐ THE EXTENT PAIR reads no `t` and no clock, so it answers above the unit
  // gate — the same line `barindex` sits on, for the same reason. It can never
  // blank: there is no input it could be missing.
  cols.isfirst[0] = 1
  cols.islast[length - 1] = 1

  // ⛔⛔ THE REALTIME FOUR ARE TRI-STATE AND FAIL CLOSED FIRST.
  // `newestBarIsForming` is `true | false | null`, and `null` means UNKNOWN —
  // never "not forming". A confident `isconfirmed = 1` on a bar that is still
  // open is the one wrong answer these columns exist to prevent, so an unknown
  // blanks all four rather than guessing either way.
  //
  // ⛔⛔ NO TRADING CALENDAR IS CONSULTED HERE, AND THAT IS THE LOAD-BEARING
  // DESIGN DECISION, NOT AN IMPLEMENTATION DETAIL. Whether the newest bar is
  // still forming is settled ONCE, upstream, by
  // `indicator_compute.py::bar_close_state` — on the side the calendar actually
  // lives (`bars_fetch._NYSE_HOLIDAYS_YYYYMMDD` +
  // `liveflow_monitor._NYSE_EARLY_CLOSES_YYYYMMDD`, both Python). Restating
  // either set here would put a SECOND AUTHORITY over one value in a second
  // language, where the two drift silently and each looks correct on its own.
  // The seam carries the tri-state; the calendar does not cross it.
  //
  // ⚠️ AND NOTHING IN HERE READS THE WALL CLOCK. Two bindings of one fetch must
  // agree bar for bar, and a function that read `Date.now()` could not be asked
  // the same question twice — which is exactly what the stability rails ask it.
  for (const name of CLOCK_REALTIME) cols[name].fill(NA)
  // @@ THE SECOND DERIVATION, AND IT IS OFF BY DEFAULT.
  // !! THREE INDEPENDENT AXES, NOT A TRI-STATE. `isrealtime` is POSITION (the last
  // bar of a live dataset), `isconfirmed` is TIME (the closing update happened),
  // `ishistory` is the complement of the first. The vendor reads 1/1/0 in the
  // post-confirm, pre-open window -- a combination `calendar` cannot spell,
  // because there `isconfirmed` is `1 - isrealtime` by construction.
  // !! FAILS CLOSED the same way: either input missing blanks all four.
  const barstateMode = (opts && opts.mode) ? opts.mode : BARSTATE_MODE_CALENDAR
  if (!BARSTATE_MODES.includes(barstateMode)) {
    throw new Error('unknown barstate mode ' + barstateMode)
  }
  const confirmedIn = (opts && opts.confirmed !== undefined) ? opts.confirmed : null
  // @@@ `datasetLive` IS THE THIRD INPUT, AND TIMELINE ROW 7 IS WHY IT EXISTS.
  // This branch used to hard-code "the newest bar is the realtime one". Row 7
  // falsified that: at 23:57 ET the SAME daily bar that had read isrealtime=1 for
  // seven and a half hours -- across three separate page loads, so not a fetch
  // artifact -- read isrealtime=0, ishistory=1, islastconfirmedhistory=1. The
  // dataset had stopped being live and the POSITION axis moved with it.
  //
  // !! THE INSTANT IS NOT IN HERE AND MUST NOT BE GUESSED INTO IT. It is
  // bracketed (20:55, 23:57) ET, three hours wide, with no proposed mechanism at
  // all -- weaker footing than even the 20:00 confirmation hypothesis. Liveness
  // arrives as an INPUT the caller observes, exactly as `confirmed` does.
  const liveIn = (opts && opts.datasetLive !== undefined) ? opts.datasetLive : true
  if (barstateMode === BARSTATE_MODE_VENDOR) {
    if ((newestBarIsForming === true || newestBarIsForming === false)
        && (confirmedIn === true || confirmedIn === false)) {
      const lastI = length - 1
      const live = liveIn !== false
      const rtI = live ? lastI : -1
      const lchI = live ? lastI - 1 : lastI
      for (let i = 0; i < length; i++) {
        cols.isrealtime[i] = i === rtI ? 1 : 0
        cols.ishistory[i] = 1 - cols.isrealtime[i]
        cols.isconfirmed[i] = (i < lastI || confirmedIn === true) ? 1 : 0
        // !! the bar BEFORE the realtime one -- while there IS one. Measured 0 on
        // the newest bar in all six LIVE timeline rows, including the one where
        // that bar was already confirmed, so it is not "the newest confirmed
        // bar". @@ Row 7 completes the shape rather than contradicting it: with
        // no realtime bar to sit behind, it lands ON the last bar.
        cols.islastconfirmedhistory[i] = (lchI >= 0 && i === lchI) ? 1 : 0
      }
    }
  } else if (newestBarIsForming === true || newestBarIsForming === false) {
    const forming = newestBarIsForming === true
    const lastI = length - 1
    for (let i = 0; i < length; i++) {
      const rt = forming && i === lastI
      cols.isrealtime[i] = rt ? 1 : 0
      cols.isconfirmed[i] = rt ? 0 : 1
      // ⚠️ `ishistory` IS AN ALIAS OF `isconfirmed` HERE AND IS NOT ONE IN PINE.
      // TradingView distinguishes a bar the chart loaded as history from one it
      // watched form; this engine evaluates a STATIC FETCH, where every closed
      // bar arrived the same way, so the distinction has no referent. Recorded
      // rather than hidden — `divergences.json` and `closedTable.json::_barstate`.
      cols.ishistory[i] = cols.isconfirmed[i]
    }
    // The newest bar that is not still forming: the last bar normally, the one
    // before it while the last is forming, and NO bar when a 1-bar series forms.
    const lch = forming ? lastI - 1 : lastI
    for (let i = 0; i < length; i++) {
      cols.islastconfirmedhistory[i] = (lch >= 0 && i === lch) ? 1 : 0
    }
  }

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
    // no string key has to be built per bar.
    //
    // ⛔⛔ THE OLDEST BAR IS BLANK, NOT 1, AND THAT IS THE WHOLE OF WHY THIS
    // COLUMN DECLARES `lookback: 1`. It is a function of TWO bars -- this bar's
    // ET day against the previous bar's -- exactly as `change(close)` is. While
    // bar 0 answered 1 the value depended on the WINDOW rather than on the tape:
    // slice the same series anywhere and its leading bar claimed to open a
    // session whether or not it did (measured -- `bars[1:]` and `bars[4:]` both
    // read 1 where the full series read 0). NaN is the same warm-up pad every
    // windowed entry in this table carries, and it is what makes every bar this
    // column DOES answer for window-independent.
    const day = p.y * 10000 + p.m * 100 + p.d
    cols.sessionfirst[i] = prevDay < 0 ? NA : (day === prevDay ? 0 : 1)
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
