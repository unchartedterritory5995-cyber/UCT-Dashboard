// ANLG's pure half: the breadth analogues answer -> what the panel draws. No React.
//
// The route (GET /api/breadth-monitor/analogues?top_n=N, paid) compares the newest stored session's
// breadth with the last 500 trading days of our own breadth history and returns the N closest past
// sessions, each with what the S&P 500 close did 5, 10, 20 and 60 trading days later. It is the same
// answer the Analogue Deck on Breadth -> Views draws for paying members.
//
// What the answer does NOT carry, so this file never invents it:
//   * no sample-size field: every count here is counted from the list itself;
//   * no "too recent" flag: a forward window the calendar has not reached yet is simply ABSENT from
//     that match's `forward_returns`. Absent is "not yet", never 0.
import { dayWords } from './tideHistoryModel'

export const ANLG_CODE = 'ANLG'
/** The thing read, as a failed read names it ("Days like today could not be read just now."). */
export const ANLG_WHAT = 'Days like today'
export const ANLG_SOURCE = 'UCT breadth history (16 weighted breadth measures)'
/** The route's own bounds and default (`top_n: ge=3, le=10, default 5`). */
export const ANLG_COUNT_MIN = 3
export const ANLG_COUNT_MAX = 10
export const ANLG_COUNT_DEFAULT = 5
/** The server holds each answer for six hours; the panel asks again this often while it is on screen. */
export const ANLG_POLL_MS = 30 * 60 * 1000
/** The forward windows the service reports, in trading days, in the order it reports them. */
export const ANLG_WINDOWS = Object.freeze([
  Object.freeze({ key: 'fwd_5d', days: 5 }),
  Object.freeze({ key: 'fwd_10d', days: 10 }),
  Object.freeze({ key: 'fwd_20d', days: 20 }),
  Object.freeze({ key: 'fwd_60d', days: 60 }),
])
/** The sentence the panel leads with, word for word. */
export const ANLG_RECORD_LINE = 'A record of what followed similar days, not a forecast.'

/** `7` -> 7 when the route takes it (3 to 10), else null. A whole number only: `5.5` and `05x` are not one. */
export function parseAnlgCount(tok) {
  const t = String(tok ?? '').trim()
  if (!/^\d{1,2}$/.test(t)) return null
  const n = Number(t)
  return n >= ANLG_COUNT_MIN && n <= ANLG_COUNT_MAX ? n : null
}

/** A count the panel can ask for; anything else is the route's default. */
export const normAnlgCount = (v) => parseAnlgCount(v) ?? ANLG_COUNT_DEFAULT

/** The tokens after the code for this pick (`[]` for the default). */
export function anlgCommandArgs({ count } = {}) {
  const n = normAnlgCount(count)
  return n === ANLG_COUNT_DEFAULT ? [] : [String(n)]
}

export const anlgUrl = (count) => `/api/breadth-monitor/analogues?top_n=${normAnlgCount(count)}`

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/** `2025-03-04` -> "Tue Mar 4, 2025". A match can be two years old, so the year is always said. */
export function dayWithYear(iso) {
  const m = ISO_DAY.exec(String(iso ?? ''))
  const words = dayWords(iso)
  return m && words !== 'an unknown day' ? `${words}, ${m[1]}` : 'an unknown day'
}

/** A percent return with its sign: "+1.23%", "-0.40%", "0.00%". */
export function returnText(v) {
  const n = finite(v)
  if (n == null) return 'n/a'
  const r = Math.round(n * 100) / 100
  return `${r > 0 ? '+' : r < 0 ? '-' : ''}${Math.abs(r).toFixed(2)}%`
}

/** 'up' | 'down' | 'flat' | null (no figure). The sign of the number, nothing more. */
export function returnSign(v) {
  const n = finite(v)
  if (n == null) return null
  return n > 0 ? 'up' : n < 0 ? 'down' : 'flat'
}

/** "97.3% match"; "n/a" when the service sent no closeness. 100% is an identical day. */
export const matchText = (v) => (finite(v) == null ? 'n/a' : `${finite(v).toFixed(1)}% match`)

function readRow(raw) {
  if (!isObj(raw) || !ISO_DAY.test(String(raw.date ?? ''))) return null
  const fwd = isObj(raw.forward_returns) ? raw.forward_returns : {}
  const returns = Object.fromEntries(ANLG_WINDOWS.map((w) => [w.key, finite(fwd[w.key])]))
  return {
    date: raw.date,
    similarity: finite(raw.similarity),
    returns,
    // no window at all: the S&P 500 close for that day (or everything after it) is not stored
    noReturns: ANLG_WINDOWS.every((w) => returns[w.key] == null),
  }
}

/**
 * The route's body -> the panel's view. `state`:
 *   'failed'   not the route's shape
 *   'thin'     too little breadth history is stored to compare anything (no reference day)
 *   'nomatch'  there is a reference day, and no past session came back for it
 *   'ok'       rows, closest first, as the route sends them
 */
export function anlgRead(body) {
  if (!isObj(body) || !Array.isArray(body.analogues)) return { state: 'failed', reference: null, rows: [] }
  const reference = ISO_DAY.test(String(body.reference_date ?? '')) ? body.reference_date : null
  const rows = body.analogues.map(readRow).filter(Boolean)
  if (!reference) return { state: rows.length ? 'failed' : 'thin', reference: null, rows: [] }
  return { state: rows.length ? 'ok' : 'nomatch', reference, rows }
}

/** The cell of one match in one window: `{ kind: 'value', text, sign }`, `{ kind: 'notyet' }` (the
 *  calendar has not reached it) or `{ kind: 'none' }` (no close is stored to measure from). */
export function cellFor(row, key) {
  const v = row.returns[key]
  if (v != null) return { kind: 'value', text: returnText(v), sign: returnSign(v) }
  return row.noReturns ? { kind: 'none' } : { kind: 'notyet' }
}

const median = (values) => {
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const sessions = (n) => `${n} ${n === 1 ? 'session' : 'sessions'}`

/**
 * What followed over one window, counted from the rows on screen:
 *   `{ key, days, label, of, n, notYet, noFigure, higher, lower, flat, median, text }`
 * `of` is how many matches there are, `n` how many of them have this window behind them, `notYet`
 * how many the calendar has not reached and `noFigure` how many have no stored close. The count is
 * in every sentence, so "2 of 3 higher" is never read as a rate.
 */
export function windowSummary(rows, win) {
  const vals = rows.map((r) => r.returns[win.key]).filter((v) => v != null)
  // why a session has no figure here: the calendar has not reached the window, or no close is stored for it
  const noFigure = rows.filter((r) => r.noReturns).length
  const notYet = rows.length - vals.length - noFigure
  const base = { key: win.key, days: win.days, label: `${win.days} trading days later`, of: rows.length, n: vals.length, notYet, noFigure }
  if (!vals.length) {
    return { ...base, higher: 0, lower: 0, flat: 0, median: null,
      text: notYet
        ? `Not yet: none of the ${sessions(rows.length)} has ${win.days} trading days of history after it.`
        : `No figure: no S&P 500 close is stored to measure the ${sessions(rows.length)} from.` }
  }
  const higher = vals.filter((v) => v > 0).length
  const lower = vals.filter((v) => v < 0).length
  const med = median(vals)
  const left = `${notYet ? `; ${notYet} not yet` : ''}${noFigure ? `; ${noFigure} with no figure` : ''}`
  return { ...base, higher, lower, flat: vals.length - higher - lower, median: med,
    text: `${higher} of ${vals.length} higher, ${lower} lower, median ${returnText(med)} (${sessions(vals.length)}${left})` }
}

export const summaryFor = (rows) => ANLG_WINDOWS.map((w) => windowSummary(rows, w))

/** The sentence under the lede: how many came back against how many were asked, and for which day. */
export function countLine(view, asked) {
  const n = view.rows.length
  const day = dayWords(view.reference)
  if (n < asked) return `Only ${sessions(n)} came back of the ${asked} asked for, compared with ${day}. That is too few to read as a pattern.`
  return `The ${n} past sessions whose breadth looked most like ${day}, closest first, and what the S&P 500 did after each. ${n} sessions is a small sample.`
}
