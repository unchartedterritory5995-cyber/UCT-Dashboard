// app/src/components/chart/engine/tvRunStart.js
//
// ─── ⭐⭐ HISTORY PARITY — "ON WHICH BAR DOES TRADINGVIEW'S RUN OF THIS SCRIPT START?" ──────
//
// A Pine script carries state from bar to bar (`var` latches, recursive averages, cumulative
// sums). Its values match TradingView's only when its run starts on TradingView's first bar.
// This module answers which bar that is, for a series the chart holds. It is PURE: no fetch, no
// store, no clock. Design and evidence: `docs/pine/HISTORY-PARITY.md`.
//
// THE RULE (derived from 1,921 TradingView captures, 374 distinct rows; the rail
// `__tests__/tvRunStart.test.js` re-derives every number below from the capture fixture):
//   • D / W / M: the vendor's whole history. The deepest daily series witnessed held 16,333 bars
//     and no cap was hit, so beyond that depth nothing is known and nothing is claimed.
//   • Intraday: a ~20,000-bar cap, counted in the chart's OWN session (extended hours on: the
//     pre/post-market bars count), rounded BACK to the start of a calendar chunk in the
//     exchange's timezone: the first held bar of the chunk that contains the cap-th newest bar.
//     Chunk = ISO week (1m, 5m), calendar month (15m), calendar year (30m and up, to 240m).
//     With fewer bars than the cap, the run starts on the first bar the vendor has.
//
// ⛔ THE CAP IS A RANGE, NOT A NUMBER. The captures pin it only to 19,963..20,024 (every row is
// consistent with any value in it), and whether TradingView counts the forming bar is unknown.
// So a start is PROVEN only when every cap in the range (widened by `toleranceBars`) lands in
// the SAME chunk. A series whose cap-th newest bar sits near a chunk boundary is ambiguous and
// is never called exact.
//
// ⛔ WHAT `proven` DOES NOT COVER: that our bar population equals TradingView's. A thin name's
// extended-hours bars differ between vendors (RDDT 5m: ours +1,583), which moves the cap-th
// newest bar. `toleranceBars` widens the range for that; the design names the data-side fix.

/** The point estimate of TradingView's intraday bar cap (bars in the chart's session). */
export const TV_INTRADAY_CAP = 20000

/**
 * The range the captures pin the cap to: [max(bars after the first chunk) + 1, min(bars held at
 * the cap)]. DERIVED from the capture fixture by the rail; never edit one without the other.
 */
export const TV_INTRADAY_CAP_BOUNDS = Object.freeze([19963, 20024])

/** The deepest D/W/M series a capture witnessed reaching the vendor's first bar (NYSE:HPQ 1D). */
export const DATE_TF_MAX_WITNESSED_BARS = 16333

/** The chunk TradingView rounds an intraday start back to, per MEASURED timeframe (minutes). */
export const TV_CHUNK_BY_TF = Object.freeze({
  '1': 'week', '5': 'week',
  '15': 'month',
  '30': 'year', '45': 'year', '60': 'year', '65': 'year', '120': 'year', '195': 'year', '240': 'year',
})

const DATE_TFS = new Set(['D', '1D', 'W', '1W', 'M', '1M'])
const DEFAULT_TZ = 'America/New_York'
const DAY_MS = 86400000

const _fmt = new Map()
function formatterFor(tz) {
  let f = _fmt.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' })
    _fmt.set(tz, f)
  }
  return f
}

/** The calendar date of an instant (unix seconds) in `tz`: `{ y, m, d }` (m 1..12). */
export function localDateOf(tSec, tz = DEFAULT_TZ) {
  const parts = formatterFor(tz).formatToParts(new Date(tSec * 1000))
  const out = { y: 0, m: 0, d: 0 }
  for (const p of parts) {
    if (p.type === 'year') out.y = +p.value
    else if (p.type === 'month') out.m = +p.value
    else if (p.type === 'day') out.d = +p.value
  }
  return out
}

/** Day of the week of a local date, 0 = Sunday .. 6 = Saturday. */
function weekdayOf({ y, m, d }) {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/**
 * A number that is equal for two instants exactly when they fall in the same chunk in `tz`, and
 * grows with time. week: the day number of the ISO week's Monday; month: y*12+m; year: y.
 */
export function chunkKeyOf(tSec, chunk, tz = DEFAULT_TZ) {
  const ld = localDateOf(tSec, tz)
  if (chunk === 'year') return ld.y
  if (chunk === 'month') return ld.y * 12 + (ld.m - 1)
  if (chunk === 'week') {
    const dayNum = Math.floor(Date.UTC(ld.y, ld.m - 1, ld.d) / DAY_MS)
    return dayNum - ((weekdayOf(ld) + 6) % 7)
  }
  throw new Error(`tvRunStart: unknown chunk ${chunk}`)
}

/** Bar time in unix seconds (accepts a bar `{t}`, seconds or milliseconds). */
function secondsOf(bar) {
  const t = bar && typeof bar === 'object' ? bar.t : bar
  if (typeof t !== 'number' || !Number.isFinite(t)) return NaN
  return t > 1e11 ? t / 1000 : t
}

function normTf(tf) {
  const s = String(tf == null ? '' : tf).trim()
  if (DATE_TFS.has(s.toUpperCase())) return s.toUpperCase().replace(/^1/, '')
  return s
}

/**
 * The index of the first bar whose chunk is the cap-th newest bar's chunk, for one cap value.
 * `null` when the series is shorter than the cap (the run starts at the vendor's first bar).
 */
function chunkStartIndex(times, cap, chunk, tz) {
  const n = times.length
  if (n < cap) return null
  const k = n - cap // the cap-th newest bar
  const key = chunkKeyOf(times[k], chunk, tz)
  // times ascend, so chunk keys never decrease: the first index in [0, k] whose key is `key`
  let lo = 0
  let hi = k
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (chunkKeyOf(times[mid], chunk, tz) < key) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * ⭐ TRADINGVIEW'S FIRST BAR OF A SCRIPT RUN, within the series `sessionBars`.
 *
 * @param {string} tf               the chart's timeframe code ('1', '5', '15', '30', '60', '240', 'D', 'W', 'M')
 * @param {Array<number|{t:number}>} sessionBars the bars the run would compute on, OLDEST FIRST, already in the
 *                                  chart's session (extended hours off: regular-session bars only). Intraday
 *                                  times are unix seconds (milliseconds accepted).
 * @param {string} [tz]             the exchange's IANA timezone (default America/New_York)
 * @param {object} [opts]
 * @param {boolean} [opts.startsAtListing] the caller has PROVED the series' first bar is the vendor's first bar of
 *                                  the symbol (the listing statement); without it a series that never reaches the
 *                                  cap is not known to start where TradingView's does
 * @param {number} [opts.toleranceBars] widen the cap range by this many bars each way (population mismatch)
 * @param {number} [opts.cap]       the cap point estimate (tests); default TV_INTRADAY_CAP
 * @param {number[]} [opts.capBounds] the cap range (tests); default TV_INTRADAY_CAP_BOUNDS
 * @returns {{index: number|null, rule: string, chunk: string|null, proven: boolean, ambiguous: boolean, why: string}}
 *   `index`: the run's first bar in `sessionBars` (slice there), or null when no rule applies.
 *   `proven`: true only when that bar IS TradingView's first bar, given equal bar populations.
 */
export function tvRunStart(tf, sessionBars, tz = DEFAULT_TZ, opts = {}) {
  const code = normTf(tf)
  const bars = Array.isArray(sessionBars) ? sessionBars : []
  const n = bars.length
  const listing = opts.startsAtListing === true
  const out = (index, rule, chunk, proven, ambiguous, why) => ({ index, rule, chunk, proven, ambiguous, why })
  if (!n) return out(null, 'empty', null, false, false, 'no bars')

  if (code === 'D' || code === 'W' || code === 'M') {
    if (n > DATE_TF_MAX_WITNESSED_BARS) {
      return out(0, 'date-full-history', null, false, false,
        `${n} bars is deeper than any capture witnessed (${DATE_TF_MAX_WITNESSED_BARS}); a cap there is unknown`)
    }
    if (!listing) return out(0, 'date-full-history', null, false, false, 'the series is not proved to start at the vendor\'s first bar')
    return out(0, 'date-full-history', null, true, false, '')
  }

  const chunk = TV_CHUNK_BY_TF[code] || null
  if (!chunk) return out(null, 'unmeasured-timeframe', null, false, false, `no capture measured timeframe ${code}`)

  const times = new Array(n)
  for (let i = 0; i < n; i++) {
    const t = secondsOf(bars[i])
    if (!Number.isFinite(t) || (i && t <= times[i - 1])) {
      return out(null, 'bad-series', chunk, false, false, `bar ${i} has no time, or is not after the bar before it`)
    }
    times[i] = t
  }

  const cap = Number.isFinite(opts.cap) ? opts.cap : TV_INTRADAY_CAP
  const bounds = Array.isArray(opts.capBounds) ? opts.capBounds : TV_INTRADAY_CAP_BOUNDS
  const tol = Number.isFinite(opts.toleranceBars) && opts.toleranceBars > 0 ? Math.floor(opts.toleranceBars) : 0
  const lo = Math.max(1, bounds[0] - tol)
  const hi = bounds[1] + tol

  const point = chunkStartIndex(times, cap, chunk, tz)
  const atLo = chunkStartIndex(times, lo, chunk, tz)
  const atHi = chunkStartIndex(times, hi, chunk, tz)
  const ambiguous = atLo !== atHi
  const rule = point == null ? 'whole-history' : 'cap-chunk'
  const index = point == null ? 0 : point

  if (ambiguous) {
    return out(index, rule, chunk, false, true,
      `the cap's range (${lo}..${hi}) puts the start in different chunks (index ${atLo} vs ${atHi})`)
  }
  if (atHi == null) {
    // fewer bars than any cap in the range: the vendor's first bar, if this series holds it
    if (!listing) return out(0, 'whole-history', chunk, false, false, 'below the cap, and the series is not proved to start at the vendor\'s first bar')
    return out(0, 'whole-history', chunk, true, false, '')
  }
  if (index === 0 && !listing) {
    return out(0, rule, chunk, false, false,
      'the held history begins inside TradingView\'s first chunk: earlier bars of that chunk may exist at the vendor')
  }
  if (chunk === 'week' && index > 0) {
    // ⛔ measured on weekday-only sessions: where a week chunk meets weekend trading (crypto, Sunday-evening
    // futures), which day TradingView's week starts on is unmeasured
    const before = weekdayOf(localDateOf(times[index - 1], tz))
    const first = weekdayOf(localDateOf(times[index], tz))
    if (before === 0 || before === 6 || first === 0 || first === 6) {
      return out(index, rule, chunk, false, false, 'a week chunk on a symbol that trades at the weekend is unmeasured')
    }
  }
  return out(index, rule, chunk, true, false, '')
}
