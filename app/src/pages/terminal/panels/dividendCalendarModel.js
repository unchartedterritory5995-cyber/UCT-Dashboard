// DVD's pure half: the dividend calendar route's answer -> what the panel draws. No React.
//
// The route (GET /api/calendar/dividends[?syms=], api/routers/calendar.py, paid) answers a bare list
// of DECLARED, FUTURE events: for each stock ONE dividend (its next ex-date) and every split ahead.
// With no `syms` it reads the caller's own stocks (the Calendar page's My Stocks set, at most 200);
// with `syms=NVDA` it reads that one stock. It holds no past event: history is CACT's.
// A vendor failure behind a 200 is labelled in a header (`X-Calendar-Read`), which
// calendarEventsRead.js keeps: `failed` with no rows is a failed read, `partial` says some stocks
// could not be read.
import { amountWords, splitWords } from './corporateActionsModel'

export const DVD_CODE = 'DVD'
/** The thing read, as a failed read names it ("The dividend calendar could not be read just now."). */
export const DVD_WHAT = 'The dividend calendar'
export const DVD_SOURCE = 'Massive reference data'
/** The most stocks the route reads for one answer. */
export const DVD_SYMBOL_CAP = 200
/** Where one stock's past dividends and splits are. */
export const DVD_HISTORY_CODE = 'CACT'

export const dvdUrl = (sym) => (sym ? `/api/calendar/dividends?syms=${encodeURIComponent(sym)}` : '/api/calendar/dividends')
export const dvdHistoryCommand = (sym) => `${sym} ${DVD_HISTORY_CODE}`

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const utcDay = (iso) => {
  const m = ISO_DAY.exec(String(iso ?? ''))
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCMonth() === Number(m[2]) - 1 ? d : null
}

/** `2026-11-18` -> "Wed Nov 18"; the year is added when it is not `today`'s ("Fri Jan 8, 2027"). */
export function dayWords(iso, today) {
  const d = utcDay(iso)
  if (!d) return 'an unknown day'
  const base = `${WEEKDAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
  return today && String(today).slice(0, 4) !== String(iso).slice(0, 4) ? `${base}, ${String(iso).slice(0, 4)}` : base
}

/** The Sunday that ends `today`'s week (weeks run Monday to Sunday), `weeks` weeks on. */
export function weekEnd(today, weeks = 0) {
  const d = utcDay(today)
  if (!d) return null
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7) + 7 * weeks)
  return d.toISOString().slice(0, 10)
}

/** The three blocks, in order. */
export const DVD_BUCKETS = Object.freeze([
  Object.freeze({ key: 'this', label: 'This week' }),
  Object.freeze({ key: 'next', label: 'Next week' }),
  Object.freeze({ key: 'later', label: 'Later' }),
])

export function bucketOf(date, today) {
  const [end, nextEnd] = [weekEnd(today, 0), weekEnd(today, 1)]
  if (!end || date <= end) return 'this'
  return date <= nextEnd ? 'next' : 'later'
}

function readRow(raw) {
  if (!raw || typeof raw !== 'object' || !utcDay(raw.date)) return null
  const sym = typeof raw.sym === 'string' ? raw.sym.trim().toUpperCase() : ''
  if (!sym || (raw.type !== 'dividend' && raw.type !== 'split')) return null
  return {
    sym,
    type: raw.type,
    date: raw.date,
    amount: typeof raw.amount === 'number' && Number.isFinite(raw.amount) && raw.amount > 0 ? raw.amount : null,
    ratio: typeof raw.ratio === 'string' && raw.ratio.trim() ? raw.ratio.trim() : null,
  }
}

/** "Ex-dividend" (the row's day is the ex-date) or "Split" (the day it takes effect). */
export const eventWords = (row) => (row.type === 'split' ? 'Split' : 'Ex-dividend')

/** "$0.25 a share" as declared, or the split in words. A missing figure is said, never $0. */
export function detailWords(row) {
  if (row.type === 'split') return splitWords(row.ratio)
  return row.amount == null ? amountWords(null) : `${amountWords(row.amount)} a share`
}

/** The route's answer -> the panel's view. `state`: 'failed' (not a list, or the server labelled an
 *  empty read failed), 'none' (an answered, empty list) or 'ok'. `partial` is the server's own word
 *  that some stocks could not be read. `buckets` holds only the blocks with rows, each grouped by day,
 *  soonest first. */
export function dvdRead(body, readStatus, today) {
  const failed = { state: 'failed', partial: false, buckets: [], count: 0, dividends: 0, splits: 0, dropped: 0 }
  if (!Array.isArray(body)) return failed
  const rows = body.map(readRow).filter(Boolean)
    .sort((a, b) => (a.date === b.date ? (a.sym === b.sym ? (a.type < b.type ? -1 : 1) : a.sym < b.sym ? -1 : 1) : a.date < b.date ? -1 : 1))
  if (readStatus === 'failed' && !rows.length) return failed
  const buckets = DVD_BUCKETS.map((b) => ({ ...b, days: [], count: 0 }))
  for (const r of rows) {
    const b = buckets.find((x) => x.key === bucketOf(r.date, today))
    const last = b.days[b.days.length - 1]
    if (last && last.date === r.date) last.rows.push(r)
    else b.days.push({ date: r.date, rows: [r] })
    b.count += 1
  }
  return {
    state: rows.length ? 'ok' : 'none',
    partial: readStatus === 'partial' || readStatus === 'failed',
    buckets: buckets.filter((b) => b.count),
    count: rows.length,
    dividends: rows.filter((r) => r.type === 'dividend').length,
    splits: rows.filter((r) => r.type === 'split').length,
    dropped: body.length - rows.length,
  }
}

const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** The line above the table. `sym` is the one stock asked for, or null for the member's own stocks. */
export function countLine(view, sym) {
  const whose = sym || 'your stocks'
  if (!view.count) return `No dividend or split is declared ahead for ${whose}.`
  const parts = []
  if (view.dividends) parts.push(plural(view.dividends, 'ex-dividend date', 'ex-dividend dates'))
  if (view.splits) parts.push(plural(view.splits, 'split', 'splits'))
  return `${parts.join(' and ')} ahead for ${whose}.`
}
