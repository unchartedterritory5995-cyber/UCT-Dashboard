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
