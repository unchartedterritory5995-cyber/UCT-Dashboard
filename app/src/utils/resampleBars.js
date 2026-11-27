// Client-side timeframe aggregation — the Phase-A "instant TF switch" core.
//
// When the user switches to Weekly/Monthly and we already hold Daily bars in the
// mem/IDB cache, we can synthesize the higher timeframe and paint it in the SAME
// frame (no network round-trip, no skeleton), then let the normal SWR fetch
// replace it with the authoritative server bars. For that optimistic paint to be
// seamless, the synthesized bars MUST match the server bar-for-bar — so this
// mirrors the server resamplers EXACTLY:
//   • Weekly  → api/services/bars_fetch._resample_weekly_iso  (ISO-Friday key)
//   • Monthly → api/services/bars_fetch._resample_monthly_iso (1st-of-month key)
//
// Pure + unit-tested: correctness lives here, not in the 6000-line chart, and a
// mismatch would be a visible data bug the moment the server response lands.
//
// `t` is an ISO date string ("YYYY-MM-DD"), as /api/bars returns for D/W/M.

import { isRthBar, etMinuteOfDay } from '../components/chart/barTime'
import { INTRADAY_ANCHOR_MIN } from '../components/chart/timeframes'

// The Friday of the ISO week containing ISO date `t`. ISO weeks are Mon-Sun, so
// Friday = Monday-of-that-week + 4 days — identical to the server's
// datetime.fromisocalendar(iso_year, iso_week, 5). All math in UTC so it is
// timezone-independent (the date string carries no zone).
function isoFridayOf(t) {
  const d = new Date(t + 'T00:00:00Z')
  const mondayOffset = (d.getUTCDay() + 6) % 7   // Mon=0 .. Sun=6
  const friday = new Date(d)
  friday.setUTCDate(d.getUTCDate() - mondayOffset + 4)
  return friday.toISOString().slice(0, 10)
}

// A bar's `t` is either a date string (D/W/M bases) or unix seconds (intraday). The
// wrong kind for a bucket has no place in it, and passing it to the key functions
// throws (Invalid Date / no .slice), which takes the whole chart to its error
// boundary. Those bars are skipped instead: one bad bar costs one bar, not the chart.
const isDateT = t => typeof t === 'string' && !Number.isNaN(Date.parse(t + 'T00:00:00Z'))
// ⚡ (2026-11-26) NO DATE PER ROW. `new Date(t * 1000).getTime()` is NaN exactly when `t * 1000` is NaN, ±Infinity or past
// the Date range (TimeClip: |ms| > 8.64e15), so the same verdict, for every input ('' included), without the allocation:
// it ran twice per base row on every custom-intraday resample (the 4h board's switch, resampleBars.onePass.test.js).
const _MAX_DATE_MS = 8.64e15
const isUnixT = (t) => {
  if (t === '') return false
  const ms = t * 1000
  return ms === ms && Math.abs(ms) <= _MAX_DATE_MS
}

const _byT = (a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0)
function _aggregate(rawBars, keyFn, isValidT) {
  // ⚡ (2026-11-26) ONE PASS: the valid rows, and whether they already ascend (they do, from every store and server answer)
  const bars = []
  let ascending = true
  for (let i = 0; i < rawBars.length; i++) {
    const b = rawBars[i]
    if (!(b && b.t != null && isValidT(b.t))) continue
    if (ascending && bars.length && !(b.t >= bars[bars.length - 1].t)) ascending = false
    bars.push(b)
  }
  // bars MUST be ascending by date so the FIRST bar of a bucket supplies the
  // open and the LAST supplies the close (matches the server's iteration).
  const sorted = ascending ? bars : bars.slice().sort(_byT)
  const buckets = new Map()
  // the buckets come out sorted by key; they are created in key order whenever each new key is above the last one
  // (a session key never goes back as the rows ascend), and then the sort below would change nothing: it is skipped
  let inOrder = true
  let lastKey
  for (const b of sorted) {
    const key = keyFn(b.t)
    const cur = buckets.get(key)
    if (!cur) {
      if (inOrder && buckets.size && !(key > lastKey)) inOrder = false
      lastKey = key
      buckets.set(key, { t: key, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 })
    } else {
      cur.h = Math.max(cur.h, b.h)
      cur.l = Math.min(cur.l, b.l)
      cur.c = b.c
      cur.v += (b.v || 0)
    }
  }
  const out = [...buckets.values()]
  return inOrder ? out : out.sort(_byT)
}

// Daily → Weekly, keyed at the ISO Friday of each week.
export function resampleDailyToWeekly(daily) {
  if (!daily || !daily.length) return []
  return _aggregate(daily, isoFridayOf, isDateT)
}

// Daily → Monthly, keyed at the 1st of each calendar month.
export function resampleDailyToMonthly(daily) {
  if (!daily || !daily.length) return []
  return _aggregate(daily, t => `${t.slice(0, 7)}-01`, isDateT)
}

// Dispatcher. Returns the resampled bars, or null when the (fromTf, toTf) pair
// isn't a supported client-side aggregation (caller then falls back to the
// network). Only DOWN-sampling from a finer cached TF is possible; this pass
// supports D→W and D→M (the highest-value, lowest-risk case). Intraday
// aggregation (1/5 → 15/30/60) is a later phase and returns null here for now.
export function resample(bars, fromTf, toTf) {
  if (!bars || !bars.length) return null
  if (fromTf !== 'D') return null
  if (toTf === 'W') return resampleDailyToWeekly(bars)
  if (toTf === 'M') return resampleDailyToMonthly(bars)
  return null
}

// ── Custom-timeframe aggregation ─────────────────────────────────────────────
// These power the arbitrary intervals in the timeframe menu (2m/45m/65m/4h/3d/…).
// The base bars come from the native fetch; the bucket key becomes each output
// bar's `t`. Buckets are STABLE (a bar's bucket never changes as new bars arrive)
// so the developing bar updates in place instead of the whole series re-bucketing.

// ET hours+minutes for a UTC-seconds timestamp (intraday `t` is unix seconds), as h * 60 + m.
// ⛔⛔ (2026-11-26, measured on production's build: a 4h regular board's symbol switch spent 784-950 ms of its KEY
// TASK here, and as much again a second later). This built a NEW `Intl.DateTimeFormat` on every call, and the
// session key calls it once per base row: tens of thousands of formatter constructions per custom-intraday
// resample, on every switch, since 2026-07-17. It now reads barTime's ET offset, which is memoised per UTC day
// (`etOffsetSec`: two formatToParts per new day, an exact {a, b, at} on the two DST days, a map hit per row), so a
// resample pays at most two Intl reads per day and constructs no formatter. ONE authority for ET wall time.
// The old reading's one engine quirk is kept, byte for byte: an `hour12: false` en-US formatter may print the
// midnight hour as 24 (the h24 cycle), so 00:xx read as 1440 + xx there. `_MIDNIGHT_HOUR` asks the engine once.
const _MIDNIGHT_HOUR = (() => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(Date.UTC(2026, 0, 15, 5, 0)))        // 2026-01-15 00:00 ET (EST)
    return +parts.find(p => p.type === 'hour').value
  } catch { return 0 }
})()
function _etHM(tSec) {
  const m = etMinuteOfDay(+tSec)                     // + : a numeric-string time is read as its number, as before
  return m < 60 && _MIDNIGHT_HOUR === 24 ? m + 1440 : m
}

// Intraday minutes/hours, anchored to the SESSION START (TradingView builds intraday bars from it): 09:30 ET for the
// regular session (a 45m chart breaks at 9:30, 10:15, 11:00 …), `anchorMin` minutes after ET midnight otherwise.
// ⭐ (2026-11-25, Fred RS 4h captures) TradingView's EXTENDED-hours (04:00-20:00) 4h bars start at 04:00, 08:00, 12:00
// and 16:00 ET (SPY, RDDT, ADT, every bar of every day, EST and EDT alike); anchored at 09:30 ours started at 01:30,
// 05:30, 09:30, 13:30 and 17:30. The extended view passes the session start, 04:00 (timeframes.resampleSpec).
// The bucket START = this bar's time minus its offset within the bucket, so all bars in one bucket share a key WITHOUT
// any wall-clock→unix reconversion (no DST hazard — a bucket never spans a day).
function _sessionKey(B, A) {
  return (t) => {
    const minsSinceOpen = _etHM(t) - A                 // A = the session start (570 = 9:30 ET, 240 = 04:00 ET)
    const off = ((minsSinceOpen % B) + B) % B          // 0..B-1, correct for pre-open (negative)
    return t - off * 60                                // unix-sec bucket start
  }
}
export function resampleIntradaySession(bars, bucketMinutes, { anchorMin = 570 } = {}) {
  return _resampleIntraday(bars, bucketMinutes, anchorMin, isUnixT)
}
function _resampleIntraday(bars, bucketMinutes, anchorMin, isValidT) {
  if (!bars || !bars.length || !(bucketMinutes > 0)) return []
  const B = bucketMinutes
  const A = Number.isFinite(anchorMin) ? anchorMin : 570
  return _aggregate(bars, _sessionKey(B, A), isValidT)
}

// N-of-a-native-daily-bucket, calendar-anchored for STABILITY:
//   nDaily   → group calendar days into fixed N-day windows from the unix epoch
//   nWeekly  → group ISO weeks into fixed N-week windows
//   nMonthly → group calendar months into fixed N-month windows (12M = calendar
//              year, 3M = calendar quarter — anchored to January)
// Base `t` is 'YYYY-MM-DD'; the key is the window-start date string.
function _epochDay(t) { return Math.floor(Date.parse(t + 'T00:00:00Z') / 86400000) }
function _dayStr(epochDay) { return new Date(epochDay * 86400000).toISOString().slice(0, 10) }

const _nDailyKey = (n) => (t) => _dayStr(Math.floor(_epochDay(t) / n) * n)
// Base weekly bars are ISO-Fridays; bucket by ISO-week index (Friday's epochDay/7).
const _nWeeklyKey = (n) => (t) => {
  const wk = Math.floor(_epochDay(t) / 7)
  const bucketWk = Math.floor(wk / n) * n
  return _dayStr(bucketWk * 7)   // representative window-start date (a Thursday); label only
}
const _nMonthlyKey = (n) => (t) => {
  const [y, mo] = t.split('-').map(Number)
  const idx = y * 12 + (mo - 1)
  const start = Math.floor(idx / n) * n
  return `${Math.floor(start / 12)}-${String((start % 12) + 1).padStart(2, '0')}-01`
}
export function resampleNDaily(daily, n) {
  if (!daily || !daily.length || !(n > 1)) return daily || []
  return _aggregate(daily, _nDailyKey(n), isDateT)
}
export function resampleNWeekly(weekly, n) {
  if (!weekly || !weekly.length || !(n > 1)) return weekly || []
  return _aggregate(weekly, _nWeeklyKey(n), isDateT)
}
export function resampleNMonthly(monthly, n) {
  if (!monthly || !monthly.length || !(n > 1)) return monthly || []
  return _aggregate(monthly, _nMonthlyKey(n), isDateT)
}

// ⛔⛔ A REGULAR-SESSION CUSTOM TIMEFRAME IS BUILT FROM REGULAR-SESSION ROWS ONLY (2026-11-26, TradingView SPY 240 regular
// capture vs production). The regular view's base answer carries the extended rows too (the 60m session grid serves
// 04:00-09:00 and 16:00-20:00 beside 09:30-15:30), and they were resampled with the rest: anchored at 09:30, the 16:00
// and 17:00 rows fell in the 13:30 bucket (13:30-17:30), so every regular 4h day's last bar closed on the 17:00 row's close
// and carried post-market highs, lows and volume (8 of TradingView's last 30 bars matched; 22 once filtered); on a
// half-day the 13:00 row fell in the 09:30 bucket. A spec anchored at the regular session's start resamples only the
// rows `barTime.isRthBar` keeps (09:30 to the day's close, 13:00 on a half-day): what TradingView's regular chart is
// built from. Rows the resampler could not bucket anyway (no time, or not a unix time) pass through to be dropped there,
// as before; an extended spec (04:00 anchor) is untouched. ONE entry, so every caller gets it: the chart's own bars (the
// store and legacy paths), other-symbol bars (secondaryBars) and benchmark tails (liveTail).
/** Is `spec` anchored at the regular session's start (built from regular-session rows only)? */
export function isRegularSessionSpec(spec) {
  const a = Number.isFinite(spec.anchorMin) ? spec.anchorMin : INTRADAY_ANCHOR_MIN.rth   // resampleIntradaySession's default
  return a === INTRADAY_ANCHOR_MIN.rth
}
// A regular-session row the resample takes: a valid unix time inside the regular session. ⚡ (2026-11-26) ONE PASS: this
// was a filter of its own (the regular rows, kept with the rows it could not judge) before `_aggregate`'s (the valid
// ones); the rows both kept are exactly these, judged in the same order (isRthBar's day window sees the same calls).
const _isRegularUnixT = (t) => isUnixT(t) && isRthBar(Number(t))

/** ⭐ (2026-11-26) THE BUCKET OF ONE BASE ROW for a custom `spec`, by the very rule `resampleForSpec` builds the chart's
 *  bars with: `(t) => key`, the key a base row at `t` lands under (the bucket start, unix seconds or a window-start date),
 *  or null for a row the resample does not take (a time it cannot bucket; an extended row of a regular-session spec).
 *  ONE authority: the server lane folds its base-timeframe columns with it (engine/serverCompute.js), so a folded value
 *  sits on exactly the bar the chart drew from the same rows. null for a spec it cannot bucket. */
export function bucketKeyOf(spec) {
  if (!spec) return null
  switch (spec.kind) {
    case 'intradaySession': {
      if (!(spec.minutes > 0)) return null
      const key = _sessionKey(spec.minutes, Number.isFinite(spec.anchorMin) ? spec.anchorMin : 570)
      const regular = isRegularSessionSpec(spec)
      return (t) => (t != null && isUnixT(t) && (!regular || isRthBar(Number(t))) ? key(Number(t)) : null)
    }
    case 'nDaily': case 'nWeekly': case 'nMonthly': {
      const n = spec.n
      const key = !(n > 1) ? ((t) => t) : spec.kind === 'nDaily' ? _nDailyKey(n) : spec.kind === 'nWeekly' ? _nWeeklyKey(n) : _nMonthlyKey(n)
      return (t) => (t != null && isDateT(t) ? key(t) : null)
    }
    default: return null
  }
}

// Dispatch base bars → the custom timeframe described by `spec` (from
// timeframes.resampleSpec). Returns base bars unchanged when spec is null (native).
export function resampleForSpec(baseBars, spec) {
  if (!spec || !baseBars) return baseBars || []
  switch (spec.kind) {
    case 'intradaySession':
      return _resampleIntraday(baseBars, spec.minutes, spec.anchorMin, isRegularSessionSpec(spec) ? _isRegularUnixT : isUnixT)
    case 'nDaily': return resampleNDaily(baseBars, spec.n)
    case 'nWeekly': return resampleNWeekly(baseBars, spec.n)
    case 'nMonthly': return resampleNMonthly(baseBars, spec.n)
    default: return baseBars
  }
}
