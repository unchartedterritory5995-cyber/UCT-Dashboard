// Day helpers for routine and tracker blocks (Notebook widgets phase 2, wave 9, Task 9.12): which day a
// note belongs to, the "For Tue Oct 27" line, the search text a block contributes, and a release time shown
// beside the member's own clock. Pure functions: no network, no storage, no state.
import { etDayOf, todayET } from '../calendar'
import { isTradingDay } from '../../../../lib/marketClock/sessionCalendar'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
// A timestamp: a day, then a time after `T` or a space (the server's trading_days._STAMP_RE).
const STAMP_RE = /^\d{4}-\d{2}-\d{2}[T ]/
const ZONED_RE = /(?:[Zz]|[+-]\d{2}(?::?\d{2})?)$/
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
 *  the UTC day: 03:30Z on the 28th is still the 27th in New York).
 *  Wave 11 (ruling W11-R15): the server's rule (`tool_binding.note_day` over `trading_days.et_day_of`), so the
 *  shared vectors bind the same day on both sides: a bare day must be a real date, a timestamp must start with
 *  `YYYY-MM-DD` then `T` or a space, and a NAIVE timestamp (no `Z`, no offset) is UTC, never the browser's own zone
 *  (`Date.parse` alone reads a naive date-time as local time). Anything else is today in New York. */
export function noteDayOf(note) {
  const daily = note?.dailyDate
  if (typeof daily === 'string' && partsOf(daily)) return daily
  const created = note?.createdAt
  if (typeof created === 'string') {
    const s = created.trim()
    if (DAY_RE.test(s)) return partsOf(s) ? s : todayET()
    if (!STAMP_RE.test(s)) return todayET()
    const iso = `${s.slice(0, 10)}T${s.slice(11)}`
    const ms = Date.parse(ZONED_RE.test(iso) ? iso : `${iso}Z`)
    return Number.isFinite(ms) ? (etDayOf(ms) || todayET()) : todayET()
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

/** `Tue Oct 27`: the day as a block's sentences name it (forDayLabel without its "For "). */
export function dayWords(day) {
  return forDayLabel(day).replace(/^For /, '')
}

function addDays(day, n) {
  const t = new Date(`${day}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

/** The session strictly after `day` (the shared market calendar; weekdays past its horizon). */
export function sessionAfter(day) {
  let d = day
  for (let i = 0; i < 15; i += 1) {
    d = addDays(d, 1)
    if (isTradingDay(d)) return d
  }
  return addDays(day, 1)
}

/** The last session of the Monday-to-Sunday week containing `day` (a Saturday or Sunday belongs to the week just
 *  ended). Wave 11 (ruling W11-R15), the server's rule (`trading_days.last_session_of_week`): a week with no session
 *  answers the session on or before its Sunday, i.e. the previous week's last session, never a holiday Friday. */
export function weekLastSession(day) {
  const sunday = addDays(day, 6 - ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7))
  let d = sunday
  for (let i = 0; i < 21; i += 1) {
    if (isTradingDay(d)) return d
    d = addDays(d, -1)
  }
  return addDays(sunday, -2)
}

/** The note's own day, from the editor (Task 9.19 stores it, as a day or a function of none); else today ET. */
export function editorNoteDay(editor) {
  const v = editor?.storage?.uctJournalWidgets?.noteDay
  let d = null
  try { d = typeof v === 'function' ? v() : v } catch { d = null }
  return typeof d === 'string' && DAY_RE.test(d) ? d : todayET()
}

/** The day a routine or tracker block reads (ruling W9-R33): 'today' (the server resolves it) when it follows
 *  today; else its own day; else from the note's day, `next-trading-day` the session after it, `week` that week's
 *  last trading day, and `note-day` the day itself. */
export function readKeyOf(params, noteDay) {
  const p = params || {}
  if (p.bind === 'today') return 'today'
  if (typeof p.day === 'string' && DAY_RE.test(p.day)) return p.day
  if (p.bind === 'next-trading-day') return sessionAfter(noteDay)
  if (p.bind === 'week') return weekLastSession(noteDay)
  return noteDay
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
