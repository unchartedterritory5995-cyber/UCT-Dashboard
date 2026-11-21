// AUCT: Treasury auctions, the ones coming up and the results of the recent ones. The pure half
// (no React; the formatters are the app's own).
//
//   GET /api/research/treasury-auctions     api/routers/treasury_auctions.py -> api/services/treasury_auctions.py
//     GATE   `Depends(require_paid)`: 401 signed out, 402 not on a paid plan. No feature flag.
//     SPEED  never built on the request: the answer the server holds, else a few seconds' wait on ONE
//            background build, else `{ status: 'computing' }` and this panel asks again. The server
//            looks for new records once after each weekday evening (18:15 New York time).
//
//   status   'ok' | 'computing' | 'unavailable' | 'failed'
//   unavailable: { reason: 'refused' | 'shape', http_status }
//   failed:      { reason: 'source' | 'error', http_status }
//   ok: { as_of, upcoming_as_of (the day of the Treasury's newest list of coming auctions),
//         results_through (the newest auction day with a result), window_days, read_at, source, check,
//         upcoming: [{ security_type, security_term, auction_date, issue_date, announced_date,
//                      offering_amount (US DOLLARS), reopening, cusip }]   soonest first
//         results:  [{ security_type, security_term, auction_date, issue_date, maturity_date,
//                      offering_amount, rate (PERCENT), rate_kind ('high_yield' | 'high_rate' |
//                      'high_discount_margin' | null), bid_to_cover, reopening, tips, floating_rate,
//                      cash_management, cusip,
//                      bidders: null | { primary_dealers: { amount, share }, direct, indirect, total } }]
//                   newest first
//         dropped: { upcoming, results },
//         cut: { upcoming, results }   true when the publisher held more rows than the one page the
//                                      server reads; each list is read newest first, so the oldest are left out }
//
// A MISSING NUMBER IS NEVER 0: null stays null and the panel prints "No figure".
// A SHARE IS THE SERVER'S: the bidder split is never worked out here.
import { formatCompactTerminal, formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { dayWords } from './ipoCalendarModel'
import { dayText } from './ratesModel'

export const AUCT_CODE = 'AUCT'
export const AUCT_URL = '/api/research/treasury-auctions'
export const AUCT_SOURCE = 'US Treasury Fiscal Data'
export const AUCT_WHAT = 'The Treasury auction list'
const NOT_AVAILABLE = 'Treasury auctions are not available right now: '
export const NO_FIGURE = 'No figure'
/** Results on screen before "Show all". */
export const AUCT_RESULTS_SHOWN = 12

const RATE_KINDS = Object.freeze({
  high_yield: 'high yield', high_rate: 'high rate', high_discount_margin: 'high discount margin',
})
const BIDDERS = Object.freeze([['indirect', 'indirect'], ['direct', 'direct'], ['primary_dealers', 'dealers']])

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const day = (v) => (typeof v === 'string' && ISO_DAY.test(v) ? v : null)
const flag = (v) => (v === true ? true : v === false ? false : null)

function common(r) {
  const type = text(r.security_type)
  const auctionDate = day(r.auction_date)
  if (!type || !auctionDate) return null
  return {
    type, term: text(r.security_term), auctionDate, issueDate: day(r.issue_date),
    amount: num(r.offering_amount), reopening: flag(r.reopening), cusip: text(r.cusip),
  }
}

function upcomingOf(r) {
  const base = isObj(r) ? common(r) : null
  return base ? { ...base, announcedDate: day(r.announced_date) } : null
}

function biddersOf(b) {
  if (!isObj(b)) return null
  const out = {}
  for (const [key, name] of BIDDERS) {
    const share = isObj(b[key]) ? num(b[key].share) : null
    if (share == null) return null                     // a split with a class missing is no split
    out[name] = { share, amount: num(b[key].amount) }
  }
  return out
}

function resultOf(r) {
  const base = isObj(r) ? common(r) : null
  if (!base) return null
  const rate = num(r.rate)
  return {
    ...base,
    maturityDate: day(r.maturity_date),
    rate,
    rateKind: rate != null && RATE_KINDS[r.rate_kind] ? r.rate_kind : null,
    cover: num(r.bid_to_cover),
    tips: r.tips === true, frn: r.floating_rate === true, cmb: r.cash_management === true,
    bidders: biddersOf(r.bidders),
  }
}

/** Rows grouped by auction day, keeping the order they came in. */
function byDay(rows) {
  const days = []
  for (const r of rows) {
    const last = days[days.length - 1]
    if (last && last.date === r.auctionDate) last.rows.push(r)
    else days.push({ date: r.auctionDate, rows: [r] })
  }
  return days
}

const whole = (v) => (num(v) != null && v >= 0 ? Math.round(v) : 0)

/**
 * Pure: the route's answer as the panel draws it.
 *   state   'ok' | 'none' (answered, and both lists are empty) | 'computing' | 'unavailable' | 'failed'
 *   ok:     asOf, upcomingAsOf, resultsThrough, windowDays, readAt, check,
 *           upcoming / results: [{ date, rows }] by auction day, upcomingCount, resultCount, dropped,
 *           cut { upcoming, results } (the server read one page and the publisher held more: the oldest are not shown)
 */
export function auctionsRead(body) {
  if (!isObj(body)) return { state: 'failed' }
  const status = String(body.status || '')
  if (status === 'computing') return { state: 'computing' }
  if (status === 'unavailable') {
    return { state: 'unavailable', reason: text(body.reason), httpStatus: num(body.http_status) }
  }
  if (status !== 'ok' || !Array.isArray(body.upcoming) || !Array.isArray(body.results)) return { state: 'failed' }
  const upcoming = body.upcoming.map(upcomingOf).filter(Boolean)
  const results = body.results.map(resultOf).filter(Boolean)
  const sent = isObj(body.dropped) ? whole(body.dropped.upcoming) + whole(body.dropped.results) : 0
  const check = isObj(body.check) && typeof body.check.state === 'string'
    ? { state: body.check.state, reason: text(body.check.reason), httpStatus: num(body.check.http_status) }
    : null
  return {
    state: upcoming.length || results.length ? 'ok' : 'none',
    asOf: day(body.as_of),
    upcomingAsOf: day(body.upcoming_as_of),
    resultsThrough: day(body.results_through),
    windowDays: num(body.window_days),
    readAt: text(body.read_at),
    check,
    upcoming: byDay(upcoming),
    results: byDay(results),
    upcomingCount: upcoming.length,
    resultCount: results.length,
    // rows the server skipped, and rows this panel could not place
    dropped: sent + (body.upcoming.length - upcoming.length) + (body.results.length - results.length),
    cut: { upcoming: isObj(body.cut) && body.cut.upcoming === true, results: isObj(body.cut) && body.cut.results === true },
  }
}

/** Plain words for a list the server cut (it reads one page, newest first), or null. */
export function cutWords(cut) {
  if (!cut?.upcoming && !cut?.results) return null
  const parts = [
    cut.results ? 'the oldest results are not shown' : null,
    cut.upcoming ? 'the oldest copies of the list of coming auctions are not read, so an auction listed only there is not shown' : null,
  ].filter(Boolean)
  const what = cut.upcoming && cut.results ? 'Both lists' : cut.results ? 'The results' : 'The list of coming auctions'
  return `${what} held more rows than the site reads at once, newest first: ${parts.join(', and ')}.`
}

/** The first `limit` rows of a day list, keeping whole-day groups in order. */
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

// ── words ──────────────────────────────────────────────────────────────────────────────────

/** "7-Year Note", "13-Week Bill"; the type alone when the Treasury gives no term. */
export const securityWords = (r) => (r.term ? `${r.term} ${r.type}` : r.type)

/** What kind of sale it is, beyond its name ("TIPS, reopening"), or ''. */
export function tagWords(r) {
  return [r.tips ? 'TIPS' : null, r.frn ? 'floating rate' : null, r.cmb ? 'cash management' : null, r.reopening === true ? 'reopening' : null]
    .filter(Boolean).join(', ')
}

/** The amount offered ("$58.00B"), or "No figure". */
export const amountWords = (v) => formatCompactTerminal(num(v), { money: true, absent: NO_FIGURE })

/** The auction's rate as the Treasury quotes it, three decimals ("4.117%"), or "No figure". */
export const rateWords = (v) => formatPercent(num(v), { decimals: 3, absent: NO_FIGURE })

/** Which rate it is ("high yield"), or '' when there is none. */
export const rateKindWords = (kind) => RATE_KINDS[kind] || ''

/** The bid-to-cover ratio ("2.58"), or "No figure". */
export const coverWords = (v) => formatNumber(num(v), { decimals: 2, absent: NO_FIGURE })

/** A bidder class's share of the competitive award ("70.0%"), or "No figure". */
export const shareWords = (v) => formatPercent(num(v), { decimals: 1, absent: NO_FIGURE })

/** A calendar date in a cell ("Nov 30"), or "Not given". */
export const dateCell = (iso) => dayText(iso, { short: true }) || 'Not given'

const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** The line above the tables: how many are coming, the next one, and how many were held. */
export function countLine(view, today) {
  const next = view.upcoming[0]
  const coming = view.upcomingCount
    ? `${plural(view.upcomingCount, 'auction is', 'auctions are')} coming up, the next ${next.date === today ? 'today' : `on ${dayWords(next.date)}`}.`
    : 'The Treasury lists no auction from today on.'
  const held = view.resultCount
    ? `${plural(view.resultCount, 'auction', 'auctions')} in the last ${view.windowDays || 45} days ${view.resultCount === 1 ? 'is' : 'are'} listed with ${view.resultCount === 1 ? 'its' : 'their'} results.`
    : `No auction is listed for the last ${view.windowDays || 45} days.`
  return `${coming} ${held}`
}

/** The dates the two lists carry, and the source, in one sentence that is always on screen. */
export function asOfSentence(view) {
  const parts = []
  if (view.upcomingAsOf) parts.push(`The list of coming auctions is the Treasury's as of ${dayText(view.upcomingAsOf)}.`)
  if (view.resultsThrough) parts.push(`Results run through ${dayText(view.resultsThrough)}.`)
  if (!parts.length) parts.push('The answer carries no date of its own.')
  return `${parts.join(' ')} Source: ${AUCT_SOURCE}.`
}

/** Plain words for an `unavailable` answer. */
export function unavailableWords(reason, httpStatus) {
  if (reason === 'shape') return `${NOT_AVAILABLE}the Treasury's data service answered, but not with rows this screen can read.`
  return `${NOT_AVAILABLE}the Treasury's data service refused the server's request${httpStatus ? ` (it answered ${httpStatus})` : ''}.`
}

/** A look for newer records that did not go well, said above the last good ones (with their date). */
export function checkWords(check, asOf) {
  const what = check?.state === 'unavailable'
    ? unavailableWords(check.reason, check.httpStatus).replace(NOT_AVAILABLE, '').replace(/^t/, 'T')
    : 'The last look for newer auction records did not get an answer.'
  return `${what} These are the last records the site read${dayText(asOf) ? `, through ${dayText(asOf)}` : ''}.`
}
