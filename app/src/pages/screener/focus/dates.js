// Dates the Focus layout shows, read in market time (ET) and against the NYSE session calendar.
import { isTradingDay, closeTime } from '../../../lib/marketClock/sessionCalendar'
import { etYmd, etCalendarDaysBetween, etWallToEpochMs } from '../../../lib/marketClock/etTime'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "2026-10-12", "20261012" (a bars_asof) or an ISO stamp -> "2026-10-12", or null. A bare date has no time zone, so it
// is read as the calendar date it names, never converted.
export function isoDay(v) {
  const t = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t) || /^(\d{4})(\d{2})(\d{2})$/.exec(t)
  if (!m) return null
  const mo = +m[2], d = +m[3]
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${m[1]}-${m[2]}-${m[3]}` : null
}

// "2026-10-12" -> "Oct 12", or null.
export function shortDay(v) {
  const k = isoDay(v)
  return k ? `${MONTHS[+k.slice(5, 7) - 1]} ${+k.slice(8, 10)}` : null
}

// "Oct 12 close", or null when there is no usable date.
export const closeLabel = v => { const d = shortDay(v); return d ? `${d} close` : null }

const shiftDay = (k, n) => {
  const t = new Date(`${k}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

// ⛔ `snapshot_date` IS THE BUILD DATE, NOT THE SESSION. snapshot_builder stamps
// date.today() at the 03:00 ET nightly build, so a Wednesday stamp describes Tuesday's close
// (a Saturday, Sunday or Monday stamp describes Friday's). The ONE mapping from a stamp to the
// session its numbers describe: a row's own `bars_asof` (YYYYMMDD, the last bar it was built
// from) when there is one, else the last trading day before the build date.
export function describedSession(snapshotDate, barsAsof = null) {
  const own = isoDay(barsAsof)
  if (own) return own
  const built = isoDay(snapshotDate)
  if (!built) return null
  let k = shiftDay(built, -1)
  for (let guard = 0; guard < 15 && !isTradingDay(k); guard++) k = shiftDay(k, -1)
  return k
}

// "Oct 12 close" for the session a stamp describes.
export const sessionCloseLabel = (snapshotDate, barsAsof = null) => closeLabel(describedSession(snapshotDate, barsAsof))

// The nightly build runs at 03:00 ET every day; a session's numbers are due by this ET time on
// the calendar day after it (three hours of grace for the build itself).
export const NIGHTLY_DUE_ET = { hour: 6, minute: 0 }
const dueAfter = k => {
  const [y, m, d] = shiftDay(k, 1).split('-').map(Number)
  return etWallToEpochMs(y, m, d, NIGHTLY_DUE_ET.hour, NIGHTLY_DUE_ET.minute)
}

// P7: how many CLOSED sessions after the described one should already be in the data (their
// nightly build is due) but are not. Weekends and holidays are not sessions.
export function sessionsMissed(snapshotDate, now = Date.now(), barsAsof = null) {
  const from = describedSession(snapshotDate, barsAsof)
  if (!from) return null
  const nowMs = typeof now === 'number' ? now : now.getTime()
  const today = etYmd(nowMs)
  let n = 0
  for (let k = shiftDay(from, 1), guard = 0; k <= today && guard < 400; k = shiftDay(k, 1), guard++) {
    if (!isTradingDay(k)) continue
    const close = closeTime(k)
    if (close && close.getTime() <= nowMs && dueAfter(k) <= nowMs) n += 1
  }
  return n
}

// Stale = at least one nightly build has been missed: the data is more than one session behind
// what the nightly schedule promises by now.
export const isStaleSnapshot = (snapshotDate, now = Date.now(), barsAsof = null) =>
  (sessionsMissed(snapshotDate, now, barsAsof) ?? 0) >= 1

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
