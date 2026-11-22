// IPO LOCKUP's pure half: the lockup route's answer -> what the panel draws. No React.
//
// GET /api/scans/ipo-lockups (paid; api/services/ipo_lockups.py) answers from what the server already holds: the
// companies of the last-year listings scan (the list LEAD IPO shows) whose ESTIMATED lockup expiry, the listing date
// plus 180 calendar days rolled to the next session, falls in the next 30 days or the past 7. The server reads no
// prospectus, so every date is an estimate and every row says so. A request never builds: the route answers the
// held list, or `computing` while its one build runs, or `warming` until the listings scan has answered once.
//
// What this module never does:
//   * it never calls a date stated: every row carries the basis the server sent ("estimated: ...");
//   * it never draws a missing change as 0: a stock whose first days of closes are not held says why in words;
//   * it never calls the change since listing a change since the IPO price: the offer price is not held.
import { formatNumber, formatPercent, formatCurrency } from '../../../lib/presentation/presentationPrimitives'
import { formatSessionDate } from '../../../lib/presentation/presentationDates'
import { dayWords } from './ipoCalendarModel'

export const IPO_LOCKUP_URL = '/api/scans/ipo-lockups'
/** The source the panel header names. */
export const IPO_LOCKUP_SOURCE = "The site's last-year listings scan"
/** The thing read, as a failed read names it ("The IPO lockup list could not be read just now."). */
export const IPO_LOCKUP_WHAT = 'The IPO lockup list'
/** The words every row and the header carry (the server sends its own; this is the same sentence). */
export const IPO_LOCKUP_BASIS = 'estimated: 180 days after listing; the prospectus sets the actual date'
/** The list changes once a day; while the server works it out the panel asks again soon. */
export const IPO_LOCKUP_POLL_MS = 30 * 60 * 1000
export const IPO_LOCKUP_BUSY_POLL_MS = 15 * 1000

/** IPO's two views. `token` is what the command carries; the calendar is the bare command. */
export const IPO_VIEWS = Object.freeze({
  calendar: Object.freeze({ label: 'IPO calendar', token: null }),
  lockup: Object.freeze({ label: 'Lockups ending', token: 'LOCKUP' }),
})
/** The words the command takes after the code (args.js keeps a pinned copy). None is a function code, a listed
 *  stock the site follows, or a word another argument takes (args.ipoLockup.test.js checks). */
export const IPO_VIEW_ARG_WORDS = Object.freeze({ LOCKUP: 'lockup', LOCKUPS: 'lockup' })

export function parseIpoView(tok) {
  const key = String(tok ?? '').trim().toUpperCase()
  return Object.prototype.hasOwnProperty.call(IPO_VIEW_ARG_WORDS, key) ? IPO_VIEW_ARG_WORDS[key] : null
}

/** A view the panel can show; anything else is the calendar (the default IPO, unchanged). */
export const normIpoView = (v) => (v === 'lockup' ? 'lockup' : 'calendar')

/** The tokens after the code for this view (`[]` for the calendar). */
export function ipoViewCommandArgs({ view } = {}) {
  const token = IPO_VIEWS[normIpoView(view)].token
  return token ? [token] : []
}

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null)
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const isoDay = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.slice(0, 10)) ? v.slice(0, 10) : null)
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/

function readChange(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  return {
    pct: finite(c.pct),
    firstClose: finite(c.first_close),
    firstDate: isoDay(c.first_date),
    lastClose: finite(c.last_close),
    lastDate: isoDay(c.last_date),
    reason: text(c.reason),
  }
}

function readRow(raw, order) {
  if (!raw || typeof raw !== 'object') return null
  const sym = typeof raw.symbol === 'string' ? raw.symbol.trim().toUpperCase() : ''
  const listing = isoDay(raw.listing_date)
  const expiry = isoDay(raw.estimated_expiry)
  const days = Number.isInteger(raw.days_to_go) ? raw.days_to_go : null
  if (!SYMBOL.test(sym) || !listing || !expiry || days === null) return null
  return {
    key: `${sym} ${listing}`,
    sym,
    order,
    company: text(raw.company),
    listing,
    listingSource: text(raw.listing_source_words),
    expiry,
    days,
    // a row the server did not mark is still an estimate: nothing here is ever called stated
    basis: raw.basis === 'stated' ? 'stated' : 'estimated',
    basisWords: text(raw.basis_words) || IPO_LOCKUP_BASIS,
    change: readChange(raw.change_since_listing),
  }
}

/** The route's answer -> the panel's view. `state`: 'failed' (not this route's shape, or the server's build broke),
 *  'computing' (the one build is running), 'warming' (the listings scan has not answered since the server started),
 *  or 'ok' (`ahead`: today and later, soonest first; `behind`: the past days, oldest first). */
export function lockupRead(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { state: 'failed' }
  if (body.status === 'computing') return { state: 'computing' }
  if (body.status === 'warming') return { state: 'warming' }
  if (body.status !== 'ok' || !Array.isArray(body.rows)) return { state: 'failed' }
  const rows = body.rows.map((r, i) => readRow(r, i)).filter(Boolean)
    .sort((a, b) => (a.expiry === b.expiry ? (a.sym < b.sym ? -1 : 1) : a.expiry < b.expiry ? -1 : 1))
  const w = body.window && typeof body.window === 'object' ? body.window : {}
  const c = body.counts && typeof body.counts === 'object' ? body.counts : {}
  const bySource = c.by_source && typeof c.by_source === 'object' ? c.by_source : {}
  return {
    state: 'ok',
    rows,
    ahead: rows.filter((r) => r.days >= 0),
    behind: rows.filter((r) => r.days < 0),
    dropped: body.rows.length - rows.length,
    today: isoDay(body.today),
    from: isoDay(w.from),
    to: isoDay(w.to),
    aheadDays: count(w.ahead_days) ?? 30,
    behindDays: count(w.behind_days) ?? 7,
    lockupDays: count(body.lockup_days) ?? 180,
    basisWords: text(body.basis_words) || IPO_LOCKUP_BASIS,
    builtAt: text(body.built_at),
    listingsAsOf: text(body.listings_as_of),
    counts: {
      listings: count(c.listings) ?? 0,
      withDate: count(c.with_listing_date) ?? 0,
      withoutDate: count(c.without_listing_date) ?? 0,
      inWindow: count(c.in_window) ?? rows.length,
      bySource: {
        firstBar: count(bySource.first_bar) ?? 0,
        relisting: count(bySource.relisting) ?? 0,
        reference: count(bySource.reference) ?? 0,
        unknown: count(bySource.unknown) ?? 0,
      },
    },
  }
}

/** How often the panel asks: soon while the server works the list out, else every 30 minutes. */
export const lockupPollMs = (body) => (body && (body.status === 'computing' || body.status === 'warming')
  ? IPO_LOCKUP_BUSY_POLL_MS : IPO_LOCKUP_POLL_MS)

const n0 = (v) => formatNumber(v, { decimals: 0 })
const plural = (n, one, many) => `${n0(n)} ${n === 1 ? one : many}`

/** Pure: a day in words, "Mon Dec 7". */
export const dateText = (iso) => dayWords(iso)

/** Pure: how far the estimated expiry is from today, in words. */
export function daysText(days) {
  if (!Number.isInteger(days)) return ''
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return days > 0 ? `in ${n0(days)} days` : `${n0(-days)} days ago`
}

/** Pure: the change since listing, signed ("+23.4%"), or '' when it is not held. */
export const changeText = (change) => (finite(change?.pct) === null ? '' : formatPercent(change.pct, { signed: true, decimals: 1 }))

/** Pure: what the change reads, or why there is none. */
export function changeWhy(change) {
  const c = change || {}
  if (finite(c.pct) !== null) {
    return `${formatCurrency(c.lastClose)} on ${formatSessionDate(c.lastDate)} against its first close, ${formatCurrency(c.firstClose)} on ${formatSessionDate(c.firstDate)}`
  }
  if (c.reason === 'no_first_day' && c.firstDate) return `The site's closes start ${formatSessionDate(c.firstDate)}, after its first days.`
  if (c.reason === 'no_later_close') return 'Only its first close is held.'
  if (c.reason === 'bars_unreadable') return 'Its closes could not be read just now.'
  return 'The site holds no daily closes for it.'
}

/** Pure: the line above the table: how many, over which days, and the basis of every date. */
export function countLine(view) {
  const range = view.from && view.to ? ` from ${dateText(view.from)} to ${dateText(view.to)}` : ''
  if (!view.rows.length) return `No estimated lockup expiry falls${range}.`
  return `${plural(view.rows.length, 'estimated lockup expiry', 'estimated lockup expiries')}${range}: ${n0(view.ahead.length)} today or ahead, ${n0(view.behind.length)} in the past ${n0(view.behindDays)} days.`
}

/** Pure: what was read, how many listing dates it held, and where those dates come from. */
export function readText(view) {
  const c = view.counts
  const parts = [`Read from ${plural(c.listings, 'stock', 'stocks')} listed in the last year; ${n0(c.withDate)} ${c.withDate === 1 ? 'has' : 'have'} a listing date.`]
  if (c.withoutDate) parts.push(`${plural(c.withoutDate, 'stock has', 'stocks have')} no listing date and ${c.withoutDate === 1 ? 'is' : 'are'} left out.`)
  const s = c.bySource
  const from = [
    s.firstBar ? `${n0(s.firstBar)} from the first daily bar in the site's bar store` : null,
    s.reference ? `${n0(s.reference)} from the listing date in Massive's reference data` : null,
    s.relisting ? `${n0(s.relisting)} from the day a reused ticker's current listing began` : null,
    s.unknown ? `${n0(s.unknown)} from a source the server did not record` : null,
  ].filter(Boolean)
  if (from.length) parts.push(`The listing dates in this list: ${from.join(', ')}.`)
  return parts.join(' ')
}
