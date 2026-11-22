// DVD MARKET's pure half: the market dividend calendar route's answer -> what the panel draws. No React.
//
// The route (GET /api/research/market-dividends, api/routers/market_dividends.py, paid) answers from a
// list the server holds: every ex-dividend date in this week and next, and every split taking effect in
// the same days, across the market, for the stocks the site follows (api/data/cap_universe.json), read
// from Massive's reference dividends and splits endpoints by date range. Rows the feed lists for funds,
// preferred shares and stocks the site does not follow are counted, not listed. The server never asks
// the vendor on the request: with nothing held it says `computing` and the panel asks again.
//
// `DVD MARKET` (args.js `marketView`, the word shared with MNA and IDXC: marketViewModel.js). Bare `DVD` stays the
// member's own stocks and `NVDA DVD` one stock (dividendCalendarModel.js); on a panel that follows a group's stock
// the word is what asks for the whole market.
import { formatNumber } from '../../../lib/presentation/presentationPrimitives'
import { amountWords, splitWords } from './corporateActionsModel'
import { DVD_BUCKETS, bucketOf, dayWords } from './dividendCalendarModel'
import { MARKET_VIEW_ARG_WORDS, MARKET_VIEW_WORD, isMarketView, marketViewArgs, parseMarketView } from './marketViewModel'

export const DVD_MARKET_URL = '/api/research/market-dividends'
/** The thing read, as a failed read names it. */
export const DVD_MARKET_WHAT = 'The market dividend calendar'
export const DVD_MARKET_SOURCE = 'Massive reference data'
export const DVD_MARKET_WORD = MARKET_VIEW_WORD
/** The view words (`DVD MARKET`): the shared market view word. ALL is not one: it is a stock. */
export const DVD_VIEW_ARG_WORDS = MARKET_VIEW_ARG_WORDS
export const DVD_VIEWS = Object.freeze({
  mine: Object.freeze({ label: 'Your stocks', title: 'The declared dividends and splits ahead for your own stocks (DVD)' }),
  market: Object.freeze({ label: 'Whole market', title: 'Every ex-dividend date and split this week and next, for every stock the site follows (DVD MARKET)' }),
})
/** While the server reads the list, ask every 3 seconds; once held, every half hour. */
export const DVD_MARKET_COMPUTING_POLL_MS = 3 * 1000
export const DVD_MARKET_HELD_POLL_MS = 30 * 60 * 1000

export const parseDvdView = parseMarketView
export const normDvdView = (v) => (isMarketView(v) ? 'market' : 'mine')
/** The arguments that run a view: `DVD MARKET`, or bare `DVD` (the member's own stocks, or the panel's stock). */
export const dvdViewCommandArgs = ({ view } = {}) => marketViewArgs(normDvdView(view) === 'market')
export const marketPollMs = (body) => (body && body.status === 'computing' ? DVD_MARKET_COMPUTING_POLL_MS : DVD_MARKET_HELD_POLL_MS)

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const day = (v) => (typeof v === 'string' && ISO_DAY.test(v.slice(0, 10)) ? v.slice(0, 10) : null)
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const positive = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
const whole = (v) => (Number.isInteger(v) && v >= 0 ? v : 0)

/** Payouts a year, in words (Massive's `frequency`). */
export const FREQUENCY_WORDS = Object.freeze({
  0: 'One-time', 1: 'Yearly', 2: 'Twice a year', 4: 'Quarterly', 12: 'Monthly', 24: 'Twice a month', 52: 'Weekly',
})
/** Massive's `dividend_type`: CD is a regular dividend and needs no word. */
export const TYPE_WORDS = Object.freeze({ SC: 'Special', LT: 'Long-term capital gain', ST: 'Short-term capital gain' })

/** "Quarterly", "Special, one-time", or "Frequency not given". */
export function cadenceWords(row) {
  const freq = Number.isInteger(row?.frequency) && Object.prototype.hasOwnProperty.call(FREQUENCY_WORDS, row.frequency)
    ? FREQUENCY_WORDS[row.frequency] : null
  const kind = row?.type && TYPE_WORDS[row.type] ? TYPE_WORDS[row.type] : null
  if (kind && freq) return `${kind}, ${freq.toLowerCase()}`
  return kind || freq || 'Frequency not given'
}

/** The cash amount per share as declared: "$0.31", "0.4500 CAD" in another currency, or "Amount not given". */
export function cashWords(row) {
  const n = positive(row?.amount)
  if (n == null) return amountWords(null)
  if (row.currency && row.currency !== 'USD') {
    const cents = n * 100
    return `${formatNumber(n, { decimals: Math.abs(cents - Math.round(cents)) < 1e-6 ? 2 : 4 })} ${row.currency}`
  }
  return amountWords(n)
}

/** "Pays Dec 1" (or "Pay date not given"); the declared day, when given, as a second line. */
export const payWords = (row, today) => (row?.payDate ? `Pays ${dayWords(row.payDate, today)}` : 'Pay date not given')
export const declaredWords = (row, today) => (row?.declaredDate ? `Declared ${dayWords(row.declaredDate, today)}` : '')

function readDividend(raw) {
  if (!raw || typeof raw !== 'object') return null
  const sym = text(raw.sym)
  const exDate = day(raw.ex_date)
  if (!sym || !exDate) return null
  return {
    sym: sym.toUpperCase(), name: text(raw.name), exDate, amount: positive(raw.amount),
    currency: text(raw.currency)?.toUpperCase() || null,
    frequency: Number.isInteger(raw.frequency) ? raw.frequency : null, type: text(raw.type)?.toUpperCase() || null,
    payDate: day(raw.pay_date), declaredDate: day(raw.declared_date),
  }
}

function readSplit(raw) {
  if (!raw || typeof raw !== 'object') return null
  const sym = text(raw.sym)
  const date = day(raw.date)
  if (!sym || !date) return null
  return { sym: sym.toUpperCase(), name: text(raw.name), date, ratio: text(raw.ratio) }
}

const byDayThenSym = (k) => (a, b) => (a[k] === b[k] ? (a.sym < b.sym ? -1 : a.sym > b.sym ? 1 : 0) : a[k] < b[k] ? -1 : 1)

function grouped(rows, key, today) {
  const buckets = DVD_BUCKETS.map((b) => ({ ...b, days: [], count: 0 }))
  for (const r of rows) {
    const b = buckets.find((x) => x.key === bucketOf(r[key], today))
    const last = b.days[b.days.length - 1]
    if (last && last.date === r[key]) last.rows.push(r)
    else b.days.push({ date: r[key], rows: [r] })
    b.count += 1
  }
  return buckets.filter((b) => b.count)
}

const window = (w) => (w && day(w.from) && day(w.to) ? { from: day(w.from), to: day(w.to) } : null)

/** The route's answer -> the panel's view. `state`: 'failed' (not an answer this panel can read),
 *  'computing', 'unavailable' (the server says neither read answered), 'none' (an answered, empty
 *  list) or 'ok'. */
export function marketDividendsRead(body, today) {
  const failed = { state: 'failed' }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return failed
  if (body.status === 'computing') return { state: 'computing' }
  if (body.status === 'failed' || body.status === 'unavailable') return { state: 'unavailable', reason: text(body.reason) }
  if (body.status !== 'ok' || !Array.isArray(body.dividends) || !Array.isArray(body.splits)) return failed
  const dividends = body.dividends.map(readDividend).filter(Boolean).sort(byDayThenSym('exDate'))
  const splits = body.splits.map(readSplit).filter(Boolean).sort(byDayThenSym('date'))
  const counts = body.counts && typeof body.counts === 'object' ? body.counts : {}
  const legs = body.legs && typeof body.legs === 'object' ? body.legs : {}
  const cut = body.cut && typeof body.cut === 'object' ? body.cut : {}
  const dropped = body.dropped && typeof body.dropped === 'object' ? body.dropped : {}
  const caps = body.caps && typeof body.caps === 'object' ? body.caps : {}
  return {
    state: dividends.length || splits.length ? 'ok' : 'none',
    window: window(body.window),
    staleWindow: body.stale_window === true,
    currentWindow: window(body.current_window),
    readAt: text(body.read_at),
    check: body.check && typeof body.check === 'object' ? body.check : null,
    legs: { dividends: legs.dividends === 'failed' ? 'failed' : 'ok', splits: legs.splits === 'failed' ? 'failed' : 'ok' },
    dividendBuckets: grouped(dividends, 'exDate', today),
    splitBuckets: grouped(splits, 'date', today),
    dividendCount: dividends.length,
    splitCount: splits.length,
    notFollowed: { dividends: whole(counts.not_followed_dividends), splits: whole(counts.not_followed_splits) },
    cut: { dividends: cut.dividends === true, splits: cut.splits === true },
    caps: { dividends: whole(caps.dividends), splits: whole(caps.splits) },
    dropped: whole(dropped.dividends) + whole(dropped.splits) + (body.dividends.length - dividends.length) + (body.splits.length - splits.length),
    symbols: [...new Set([...dividends, ...splits].map((r) => r.sym))],
  }
}

const plural = (n, one, many) => `${formatNumber(n, { decimals: 0 })} ${n === 1 ? one : many}`

/** "Mon Nov 16 to Sun Nov 29". */
export const windowWords = (w, today) => (w ? `${dayWords(w.from, today)} to ${dayWords(w.to, today)}` : 'this week and next')

/** The line above the tables. */
export function marketCountLine(view, today) {
  const span = windowWords(view.window, today)
  if (!view.dividendCount && !view.splitCount) return `No ex-dividend date or split is listed for the stocks the site follows, ${span}.`
  const parts = []
  if (view.dividendCount) parts.push(plural(view.dividendCount, 'ex-dividend date', 'ex-dividend dates'))
  if (view.splitCount) parts.push(plural(view.splitCount, 'split', 'splits'))
  return `${parts.join(' and ')} for the stocks the site follows, ${span}.`
}

/** What the feed listed that is not shown, or ''. */
export function notFollowedWords(view) {
  const { dividends, splits } = view.notFollowed || {}
  if (!dividends && !splits) return ''
  const parts = []
  if (dividends) parts.push(plural(dividends, 'ex-dividend date', 'ex-dividend dates'))
  if (splits) parts.push(plural(splits, 'split', 'splits'))
  return `The feed also lists ${parts.join(' and ')} for funds, preferred shares and stocks the site does not follow; they are not shown.`
}

/** Each failed read, in words, or ''. */
export function legWords(view) {
  const failed = Object.entries(view.legs || {}).filter(([, v]) => v === 'failed').map(([k]) => k)
  if (!failed.length) return ''
  if (failed.length === 2) return 'Neither list could be read from the data vendor just now.'
  return failed[0] === 'splits'
    ? 'The splits could not be read from the data vendor just now, so none are shown. That is not the same as no splits.'
    : 'The dividends could not be read from the data vendor just now, so none are shown. That is not the same as no dividends.'
}

/** A capped list, in words, or ''. The soonest days are kept. */
export function cutWords(view) {
  const parts = []
  if (view.cut?.dividends) parts.push(`the first ${formatNumber(view.caps.dividends, { decimals: 0 })} ex-dividend dates`)
  if (view.cut?.splits) parts.push(`the first ${formatNumber(view.caps.splits, { decimals: 0 })} splits`)
  return parts.length ? `The list is longer than the panel holds: it shows ${parts.join(' and ')}, soonest first; the latest days are left out.` : ''
}

/** A split in words ("4 for 1", "1 for 10 (reverse split)", "Ratio not given"). */
export const marketSplitWords = (row) => splitWords(row?.ratio)
