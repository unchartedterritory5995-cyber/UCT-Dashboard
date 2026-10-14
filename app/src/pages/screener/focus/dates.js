// Dates the Focus layout shows, read in market time (ET) and against the NYSE session calendar.
import { isTradingDay, closeTime } from '../../../lib/marketClock/sessionCalendar'
import { etYmd, etCalendarDaysBetween } from '../../../lib/marketClock/etTime'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "2026-10-12" (or an ISO stamp) -> "2026-10-12", or null. A bare date has no time zone, so it
// is read as the calendar date it names, never converted.
export function isoDay(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof v === 'string' ? v : '')
  if (!m) return null
  const mo = +m[2], d = +m[3]
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? m[0] : null
}

// "2026-10-12" -> "Oct 12", or null.
export function shortDay(v) {
  const k = isoDay(v)
  return k ? `${MONTHS[+k.slice(5, 7) - 1]} ${+k.slice(8, 10)}` : null
}

// "Oct 12 close", or null when there is no usable date.
export const closeLabel = v => { const d = shortDay(v); return d ? `${d} close` : null }

const nextDay = k => {
  const t = new Date(`${k}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() + 1)
  return t.toISOString().slice(0, 10)
}

// P7: how many sessions have CLOSED after the session a snapshot describes, as of `now`.
// Weekends and holidays are not sessions; today counts only once its close has passed.
export function sessionsSince(snapshotDate, now = Date.now()) {
  const from = isoDay(snapshotDate)
  if (!from) return null
  const nowMs = typeof now === 'number' ? now : now.getTime()
  const today = etYmd(nowMs)
  let n = 0
  for (let k = nextDay(from), guard = 0; k <= today && guard < 400; k = nextDay(k), guard++) {
    if (!isTradingDay(k)) continue
    const close = closeTime(k)
    if (close && close.getTime() <= nowMs) n += 1
  }
  return n
}

// The nightly snapshot is normally one session behind between a close and the next nightly run;
// more than that is stale.
export const isStaleSnapshot = (snapshotDate, now = Date.now()) => (sessionsSince(snapshotDate, now) ?? 0) > 1

// P8: "Earnings Nov 18 (in 35d)", soon when 0–7 days away (ET). A date already past is named
// without a countdown, so a stale field never reads as upcoming.
export const EARNINGS_SOON_DAYS = 7
export function earningsText(v, now = Date.now()) {
  const d = shortDay(v)
  if (!d) return null
  const days = etCalendarDaysBetween(typeof now === 'number' ? now : now.getTime(), isoDay(v))
  if (!Number.isFinite(days) || days < 0) return { text: `Earnings ${d}`, soon: false }
  const when = days === 0 ? 'today' : `in ${days}d`
  return { text: `Earnings ${d} (${when})`, soon: days <= EARNINGS_SOON_DAYS }
}
