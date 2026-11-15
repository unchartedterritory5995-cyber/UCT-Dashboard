// TEST-ONLY ORACLE for Replay Mode's cutoff (D20). INDEPENDENT of components/chart/replayCutoff.js and of the product's
// time helpers (etTime / barTime / sessionCalendar): its own ET session table, read straight from the SAME exchange-calendar
// dataset the product uses (lib/marketClock/market_calendar.json), and its own US DST rule (EDT from the 2nd Sunday of
// March 02:00 to the 1st Sunday of November 02:00). It also generates the fixture bars every D20 test steps through.
import CAL from '../../../lib/marketClock/market_calendar.json'

const HOL = new Set(CAL.holidays.map(h => h.date))
const EARLY = new Map(CAL.early_closes.map(e => [e.date, e.close]))
const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
const OPEN = hm(CAL.sessions.open), CLOSE = hm(CAL.sessions.close), PRE = hm(CAL.sessions.pre_start), POST = hm(CAL.sessions.post_end)

const ymd = (d) => d.toISOString().slice(0, 10)
const dayDate = (day) => new Date(`${day}T12:00:00Z`)
export const addDays = (day, n) => { const d = dayDate(day); d.setUTCDate(d.getUTCDate() + n); return ymd(d) }
const weekday = (day) => dayDate(day).getUTCDay()
export const isSession = (day) => weekday(day) !== 0 && weekday(day) !== 6 && !HOL.has(day)
export const closeMin = (day) => (EARLY.has(day) ? hm(EARLY.get(day)) : CLOSE)

// US DST (since 2007): the n-th Sunday of a month
function nthSunday(y, m, n) { const d = new Date(Date.UTC(y, m, 1, 12)); const first = (7 - d.getUTCDay()) % 7; return 1 + first + 7 * (n - 1) }
/** ET offset in minutes (−240 EDT / −300 EST) for an ET WALL date + minute-of-day. */
export function offsetMin(day, minute) {
  const [y, mo, d] = day.split('-').map(Number)
  const start = nthSunday(y, 2, 2), end = nthSunday(y, 10, 1)
  const after = (dd, mm) => (mo - 1 > mm || (mo - 1 === mm && (d > dd || (d === dd && minute >= 120))))
  const inDst = after(start, 2) && !after(end, 10)
  return inDst ? -240 : -300
}
/** ET wall (day, minute) → unix seconds. */
export function etToUnix(day, minute) {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d, 0, minute) / 1000 - offsetMin(day, minute) * 60
}
/** unix seconds → { day, minute } on the ET wall clock. */
export function unixToEt(sec) {
  // try both offsets; the one that round-trips is the answer
  for (const off of [-240, -300]) {
    const w = new Date((sec + off * 60) * 1000)
    const day = ymd(w), minute = w.getUTCHours() * 60 + w.getUTCMinutes()
    if (offsetMin(day, minute) === off) return { day, minute }
  }
  const w = new Date((sec - 300 * 60) * 1000)
  return { day: ymd(w), minute: w.getUTCHours() * 60 + w.getUTCMinutes() }
}
const pad = (n) => String(n).padStart(2, '0')
/** The precise cutoff string for an instant (ET wall clock to the minute + its offset). */
export function preciseOf(sec) {
  const { day, minute } = unixToEt(sec)
  const off = offsetMin(day, minute)
  return `${day}T${pad(Math.floor(minute / 60))}:${pad(minute % 60)}-${pad(Math.abs(off) / 60)}:00`
}

/** The fixture sessions between two days (inclusive). */
export function sessions(from, to) { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) if (isSession(d)) out.push(d); return out }
const TF_MIN = { '1': 1, '5': 5, '15': 15, '30': 30, '60': 60 }
/** Intraday fixture bars (unix-second `t`): RTH 09:30..close (or 04:00..20:00 extended) every `tf` minutes. */
export function intradayBars(days, tf, { extended = false } = {}) {
  const out = []
  const step = TF_MIN[tf]
  for (const day of days) {
    const from = extended ? PRE : OPEN, to = extended ? POST : closeMin(day)
    for (let m = from; m < to; m += step) out.push({ t: etToUnix(day, m), o: 1, h: 1, l: 1, c: 1, v: 1 })
  }
  return out
}
/** Weekly (Friday-stamped, as the server keys them) / monthly (1st) / daily fixture bars over the sessions. */
export function dwmBars(days, tf) {
  if (tf === 'D') return days.map(d => ({ t: d, o: 1, h: 1, l: 1, c: 1, v: 1 }))
  const keys = []
  for (const d of days) {
    const k = tf === 'W' ? fridayOf(d) : `${d.slice(0, 7)}-01`
    if (keys[keys.length - 1] !== k) keys.push(k)
  }
  return keys.map(k => ({ t: k, o: 1, h: 1, l: 1, c: 1, v: 1 }))
}
export function fridayOf(day) { const wd = (weekday(day) + 6) % 7; return addDays(day, 4 - wd) }
/** The sessions a D/W/M bar holds: every session of its ISO week / calendar month, from the calendar itself (a fixture
 *  window that stops mid-period does not shorten the period). */
export function sessionsOfBar(bar, tf) {
  if (tf === 'D') return [bar.t]
  if (tf === 'W') { const mon = addDays(bar.t, -((weekday(bar.t) + 6) % 7)); return sessions(mon, addDays(mon, 6)) }
  const first = `${bar.t.slice(0, 7)}-01`
  const next = new Date(Date.UTC(+first.slice(0, 4), +first.slice(5, 7), 1, 12)).toISOString().slice(0, 10)
  return sessions(first, addDays(next, -1))
}

/** ORACLE: when does a bar's last session end (unix s)? */
export function barEnd(bar, tf, { extended = false, allDays } = {}) {
  if (TF_MIN[tf]) {
    const { day, minute } = unixToEt(bar.t)
    const endMin = Math.min(minute + TF_MIN[tf], extended ? POST : closeMin(day))
    return etToUnix(day, endMin)
  }
  const ss = sessionsOfBar(bar, tf, allDays)
  const last = ss[ss.length - 1]
  return etToUnix(last, closeMin(last))
}
/** ORACLE: is `bar` shown under cutoff `v`? (every session it holds is ≤ the cutoff) */
export function visible(bar, tf, v, { extended = false, allDays } = {}) {
  if (v == null) return true
  const precise = v.length > 10
  if (!precise) {
    if (TF_MIN[tf]) return unixToEt(bar.t).day <= v
    if (tf === 'D') return bar.t <= v
    const ss = sessionsOfBar(bar, tf, allDays)
    return ss[ss.length - 1] <= v
  }
  const inst = Date.parse(v) / 1000
  return barEnd(bar, tf, { extended, allDays }) <= inst
}
/** ORACLE: the cutoff a step lands on — through the bar `n` bars from the last visible one (null when out of range). */
export function expectedStep(bars, tf, v, direction, n, { extended = false, allDays, nowSec = Infinity } = {}) {
  let pos = -1
  for (let i = 0; i < bars.length; i++) if (visible(bars[i], tf, v, { extended, allDays })) pos = i
  const j = direction === 'forward' ? pos + n : pos - n
  if (pos < 0 && direction === 'back') return null
  if (j < 0 || j >= bars.length) return null
  const b = bars[j]
  if (direction === 'forward' && barEnd(b, tf, { extended, allDays }) > nowSec) return null
  if (TF_MIN[tf]) return preciseOf(barEnd(b, tf, { extended, allDays }))
  if (tf === 'D') return b.t
  const ss = sessionsOfBar(b, tf, allDays)
  return ss[ss.length - 1]
}
