// IPO's pure half: the IPO calendar route's answer -> what the panel draws. No React.
//
// The route (GET /api/calendar/ipos?from=&to=, api/routers/calendar.py) answers a bare list of
// deals for a date range, merged from two vendor calendars. It carries no as-of of its own; the
// server keeps one range's answer for six hours. When both vendors failed the list is empty and the
// response says so in a header (`X-Calendar-Read: failed`), which calendarEventsRead.js reads: an
// empty list with that label is a failed read, never "no IPOs".
//
// A field the calendar does not give is "Not given", never 0: the wider of the two vendor calendars
// leaves shares, price and value empty for about two deals in three.
import { formatCompactTerminal, formatCurrency } from '../../../lib/presentation/presentationPrimitives'

export const IPO_CODE = 'IPO'
/** The thing read, as a failed read names it ("The IPO calendar could not be read just now."). */
export const IPO_WHAT = 'The IPO calendar'
export const IPO_SOURCE = 'Finnhub and FMP IPO calendars'
/** The stocks listed in the last year live on LEAD's own lens; this panel links there. */
export const IPO_LISTINGS_COMMAND = 'LEAD IPO'
/** Deals drawn in the earlier block before "Show all". */
export const IPO_EARLIER_SHOWN = 15
export const NOT_GIVEN = 'Not given'

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const utcDay = (iso) => {
  const m = ISO_DAY.exec(String(iso ?? ''))
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCMonth() === Number(m[2]) - 1 ? d : null
}

/** `2026-11-18` -> "Wed Nov 18". Read from the date's own parts, so no time zone can move the day. */
export function dayWords(iso) {
  const d = utcDay(iso)
  return d ? `${WEEKDAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` : 'an unknown day'
}

/** `iso` moved by `days` calendar days, or null when it is not a day. */
export function addDays(iso, days) {
  const d = utcDay(iso)
  if (!d) return null
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** The window the panel asks for: last week's Monday to next week's Friday around `today`
 *  (a New York day), so a deal priced last week and one expected next week are both in it. */
export function ipoWindow(today) {
  const d = utcDay(today)
  if (!d) return null
  const monday = addDays(today, -((d.getUTCDay() + 6) % 7))
  return { from: addDays(monday, -7), to: addDays(monday, 11) }
}

export function ipoUrl(today) {
  const w = ipoWindow(today)
  return w ? `/api/calendar/ipos?from=${w.from}&to=${w.to}` : null
}

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const positive = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)

const STATUS_WORDS = { expected: 'Expected', priced: 'Priced', filed: 'Filed', withdrawn: 'Withdrawn', postponed: 'Postponed' }

/** The calendar's status in a word; one it does not give is "Not given", one this panel does not
 *  know is shown as the calendar wrote it. */
export function statusWords(status) {
  const s = text(status)
  if (!s) return NOT_GIVEN
  return STATUS_WORDS[s.toLowerCase()] || s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

/** The calendar's price text ("$18.00-$20.00", "19.00") as words: a range reads "$18.00 to $20.00",
 *  one price reads "$19.00". Text with no number in it is shown as written; none is "Not given". */
export function priceWords(raw) {
  const s = text(raw)
  if (!s) return NOT_GIVEN
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter((n) => n > 0)
  if (!nums.length) return s
  const [low, high] = [Math.min(...nums), Math.max(...nums)]
  return low === high ? formatCurrency(low) : `${formatCurrency(low)} to ${formatCurrency(high)}`
}

export const sharesWords = (v) => (positive(v) == null ? NOT_GIVEN : formatCompactTerminal(v))
export const valueWords = (v) => (positive(v) == null ? NOT_GIVEN : formatCompactTerminal(v, { money: true }))

function readRow(raw) {
  if (!raw || typeof raw !== 'object' || !utcDay(raw.date)) return null
  const sym = text(raw.sym)
  const name = text(raw.name)
  if (!sym && !name) return null
  return {
    sym: sym ? sym.toUpperCase() : null,
    name,
    date: raw.date,
    exchange: text(raw.exchange),
    price: text(raw.price_range),
    shares: positive(raw.shares),
    value: positive(raw.value),
    status: text(raw.status) ? raw.status.trim().toLowerCase() : null,
  }
}

/** True when the deal has priced and its day has come: its symbol is one the terminal can load.
 *  An expected deal's symbol does not trade yet, so it stays plain text. */
export const tradesNow = (row, today) => !!row.sym && row.status === 'priced' && !!today && row.date <= today

function byDay(rows) {
  const days = []
  for (const r of rows) {
    const last = days[days.length - 1]
    if (last && last.date === r.date) last.rows.push(r)
    else days.push({ date: r.date, rows: [r] })
  }
  return days
}

/** The route's answer -> the panel's view. `state`: 'failed' (not a list, or the server labelled the
 *  read failed), 'none' (an answered, empty calendar) or 'ok'. `ahead` is today and later, soonest
 *  day first; `earlier` is before today, newest day first. `dropped` counts rows with no usable day
 *  or no name. */
export function ipoRead(body, readStatus, today) {
  const empty = { state: 'failed', ahead: [], earlier: [], count: 0, aheadCount: 0, earlierCount: 0, dropped: 0 }
  if (!Array.isArray(body) || readStatus === 'failed') return empty
  const rows = body.map(readRow).filter(Boolean)
  // within a day: deals with a symbol first, by symbol, then the ones with only a name, by name
  const key = (r) => `${r.date} ${r.sym ? `0${r.sym}` : `1${r.name || ''}`}`
  const ahead = rows.filter((r) => !today || r.date >= today).sort((a, b) => (key(a) < key(b) ? -1 : 1))
  const earlier = rows.filter((r) => today && r.date < today)
    .sort((a, b) => (a.date === b.date ? (key(a) < key(b) ? -1 : 1) : a.date < b.date ? 1 : -1))
  return {
    state: rows.length ? 'ok' : 'none',
    ahead: byDay(ahead),
    earlier: byDay(earlier),
    count: rows.length,
    aheadCount: ahead.length,
    earlierCount: earlier.length,
    dropped: body.length - rows.length,
  }
}

/** The first `limit` deals of a day list, keeping whole-day groups in order. */
export function cutDays(days, limit) {
  const out = []
  let left = limit
  for (const d of days) {
    if (left <= 0) break
    const rows = d.rows.slice(0, left)
    out.push({ date: d.date, rows })
    left -= rows.length
  }
  return out
}

const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** The line above the tables: how many deals, and the days asked for. */
export function countLine(view, today) {
  const w = ipoWindow(today)
  const range = w ? `, ${dayWords(w.from)} to ${dayWords(w.to)}` : ''
  if (!view.count) return `No IPO is on the calendar${range}.`
  return `${plural(view.count, 'IPO', 'IPOs')} on the calendar${range}: ${view.aheadCount} today or ahead, ${view.earlierCount} earlier.`
}
