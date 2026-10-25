// Day helpers for routine and tracker blocks (Notebook widgets phase 2, wave 9, Task 9.12): which day a
// note belongs to, the "For Tue Oct 27" line, the search text a block contributes, and a release time shown
// beside the member's own clock. Pure functions: no network, no storage, no state.
import { etDayOf, todayET } from '../calendar'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ET_ZONE = 'America/New_York'

/** A YYYY-MM-DD that is a real calendar day, as UTC parts (no time zone drift), else null. */
function partsOf(day) {
  if (typeof day !== 'string' || !DAY_RE.test(day)) return null
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t : null
}

/** The day a note belongs to: its daily date when it has one, else the ET day it was created, else today.
 *  ⛔ A created-at STRING with a time is read as a moment (etDayOf alone reads its leading date, which is
 *  the UTC day: 03:30Z on the 28th is still the 27th in New York). */
export function noteDayOf(note) {
  const daily = note?.dailyDate
  if (typeof daily === 'string' && partsOf(daily)) return daily
  const created = note?.createdAt
  if (typeof created === 'string') {
    if (DAY_RE.test(created)) return etDayOf(created) || todayET()
    const ms = Date.parse(created)
    if (Number.isFinite(ms)) return etDayOf(ms) || todayET()
    return todayET()
  }
  return etDayOf(created) || todayET()
}

/** The Monday on or before `day`, as YYYY-MM-DD. UTC parts throughout. Not a day: returns ''. */
export function weekMonday(day) {
  const t = partsOf(day)
  if (!t) return ''
  const back = (t.getUTCDay() + 6) % 7
  t.setUTCDate(t.getUTCDate() - back)
  return t.toISOString().slice(0, 10)
}

const short = (t) => `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}`

/** `For Tue Oct 27`; for `bind === 'week'`, `For the week of Oct 19` (the week's Monday). */
export function forDayLabel(day, bind) {
  const t = partsOf(day)
  if (!t) return ''
  if (bind === 'week') return `For the week of ${short(partsOf(weekMonday(day)))}`
  return `For ${WEEKDAYS[t.getUTCDay()]} ${short(t)}`
}

/** The line a block adds to a note's search text, e.g. `[routine: Pre-market routine · For Tue Oct 27]`. */
export function toolSearchText(kind, name, day, bind) {
  return `[${kind}: ${name} · ${forDayLabel(day, bind)}]`
}

/** The wall-clock parts of an instant in a zone. */
function wall(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(instant)
  const get = (type) => Number(parts.find((p) => p.type === type)?.value)
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute') }
}

const clock = (w) => `${w.h}:${String(w.mi).padStart(2, '0')}`

/** The instant at which `h:mi` ET falls on the ET calendar day `day` (DST-correct: one correction pass). */
function etInstant(day, h, mi) {
  const [y, m, d] = day.split('-').map(Number)
  const asUtc = Date.UTC(y, m - 1, d, h, mi)
  let guess = asUtc
  for (let i = 0; i < 2; i += 1) {
    const w = wall(new Date(guess), ET_ZONE)
    guess += asUtc - Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi)
  }
  return new Date(guess)
}

/**
 * `9:00 ET · 8:00 your time` through Intl; the local part is left off when the member's clock reads the
 * same as ET. `timeEt` is a 24-hour `H:MM` in Eastern time, on the ET day of `now`. `zone` is a test seam
 * (default: the browser's own zone).
 */
export function localTimeBeside(timeEt, now = new Date(), zone) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeEt ?? '').trim())
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return String(timeEt ?? '')
  const h = Number(m[1])
  const mi = Number(m[2])
  const etText = `${h}:${m[2]}`
  const instant = etInstant(todayET(now), h, mi)
  const own = zone || new Intl.DateTimeFormat().resolvedOptions().timeZone
  const localText = clock(wall(instant, own))
  return localText === etText ? `${etText} ET` : `${etText} ET · ${localText} your time`
}
