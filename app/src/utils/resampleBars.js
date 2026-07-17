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

function _aggregate(bars, keyFn) {
  // bars MUST be ascending by date so the FIRST bar of a bucket supplies the
  // open and the LAST supplies the close (matches the server's iteration).
  const sorted = bars.every((b, i) => i === 0 || b.t >= bars[i - 1].t)
    ? bars
    : [...bars].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0))
  const buckets = new Map()
  for (const b of sorted) {
    if (!b || b.t == null) continue
    const key = keyFn(b.t)
    const cur = buckets.get(key)
    if (!cur) {
      buckets.set(key, { t: key, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 })
    } else {
      cur.h = Math.max(cur.h, b.h)
      cur.l = Math.min(cur.l, b.l)
      cur.c = b.c
      cur.v += (b.v || 0)
    }
  }
  return [...buckets.values()].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0))
}

// Daily → Weekly, keyed at the ISO Friday of each week.
export function resampleDailyToWeekly(daily) {
  if (!daily || !daily.length) return []
  return _aggregate(daily, isoFridayOf)
}

// Daily → Monthly, keyed at the 1st of each calendar month.
export function resampleDailyToMonthly(daily) {
  if (!daily || !daily.length) return []
  return _aggregate(daily, t => `${t.slice(0, 7)}-01`)
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

// ET hours+minutes for a UTC-seconds timestamp (intraday `t` is unix seconds).
function _etHM(tSec) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(tSec * 1000))
  const h = +parts.find(p => p.type === 'hour').value
  const m = +parts.find(p => p.type === 'minute').value
  return h * 60 + m
}

// Intraday minutes/hours, anchored to the 9:30 ET session open (matches TV: a 45m
// chart breaks at 9:30, 10:15, 11:00 …). The bucket START = this bar's time minus
// its offset within the bucket, so all bars in one bucket share a key WITHOUT any
// wall-clock→unix reconversion (no DST hazard — a bucket never spans a day).
export function resampleIntradaySession(bars, bucketMinutes) {
  if (!bars || !bars.length || !(bucketMinutes > 0)) return []
  const B = bucketMinutes
  return _aggregate(bars, (t) => {
    const minsSinceOpen = _etHM(t) - 570               // 570 = 9:30 ET
    const off = ((minsSinceOpen % B) + B) % B          // 0..B-1, correct for pre-open (negative)
    return t - off * 60                                // unix-sec bucket start
  })
}

// N-of-a-native-daily-bucket, calendar-anchored for STABILITY:
//   nDaily   → group calendar days into fixed N-day windows from the unix epoch
//   nWeekly  → group ISO weeks into fixed N-week windows
//   nMonthly → group calendar months into fixed N-month windows (12M = calendar
//              year, 3M = calendar quarter — anchored to January)
// Base `t` is 'YYYY-MM-DD'; the key is the window-start date string.
function _epochDay(t) { return Math.floor(Date.parse(t + 'T00:00:00Z') / 86400000) }
function _dayStr(epochDay) { return new Date(epochDay * 86400000).toISOString().slice(0, 10) }

export function resampleNDaily(daily, n) {
  if (!daily || !daily.length || !(n > 1)) return daily || []
  return _aggregate(daily, t => _dayStr(Math.floor(_epochDay(t) / n) * n))
}
export function resampleNWeekly(weekly, n) {
  if (!weekly || !weekly.length || !(n > 1)) return weekly || []
  // Base weekly bars are ISO-Fridays; bucket by ISO-week index (Friday's epochDay/7).
  return _aggregate(weekly, t => {
    const wk = Math.floor(_epochDay(t) / 7)
    const bucketWk = Math.floor(wk / n) * n
    return _dayStr(bucketWk * 7)   // representative window-start date (a Thursday); label only
  })
}
export function resampleNMonthly(monthly, n) {
  if (!monthly || !monthly.length || !(n > 1)) return monthly || []
  return _aggregate(monthly, t => {
    const [y, mo] = t.split('-').map(Number)
    const idx = y * 12 + (mo - 1)
    const start = Math.floor(idx / n) * n
    return `${Math.floor(start / 12)}-${String((start % 12) + 1).padStart(2, '0')}-01`
  })
}

// Dispatch base bars → the custom timeframe described by `spec` (from
// timeframes.resampleSpec). Returns base bars unchanged when spec is null (native).
export function resampleForSpec(baseBars, spec) {
  if (!spec || !baseBars) return baseBars || []
  switch (spec.kind) {
    case 'intradaySession': return resampleIntradaySession(baseBars, spec.minutes)
    case 'nDaily': return resampleNDaily(baseBars, spec.n)
    case 'nWeekly': return resampleNWeekly(baseBars, spec.n)
    case 'nMonthly': return resampleNMonthly(baseBars, spec.n)
    default: return baseBars
  }
}
