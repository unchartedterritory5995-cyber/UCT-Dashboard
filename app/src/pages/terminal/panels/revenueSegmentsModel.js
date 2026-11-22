// SEG's pure half: the revenue-by-segment route's answer -> what the panel draws. No React.
//
// The route (GET /api/research/revenue-segments/{ticker}?period=annual|quarter, api/routers/revenue_segments.py,
// paid) answers one stock's revenue split two ways, by product (or business line) and by region, period by
// period, each segment's share of the listed segments worked out by the server. Each of the two is its own
// leg with its own state: `ok`, `none` (the data provider holds no such split for the stock), `not_in_plan`
// (the provider's plan for this site does not include the report: an answer, not an error),
// `not_configured`, `rate_limited` or `failed`. The server never asks the provider on the request: with
// nothing held it says `computing` and the panel asks again.
//
// `NVDA SEG REGION QUARTERLY` (args.js `segView` / `segPeriod`, copies pinned by functions.revenueSegments.test.js).
import { formatCompactTerminal, formatPercent, relabelDollarText, reportingCurrencyNote } from '../../../lib/presentation/presentationPrimitives'
import { formatSessionDate } from '../../../lib/presentation/presentationDates'

export const SEG_CODE = 'SEG'
export const SEG_SOURCE = 'Financial Modeling Prep'
/** The most periods drawn side by side (the newest first); the two oldest fold on a phone. */
export const SEG_COLUMNS = 4
export const SEG_COMPUTING_POLL_MS = 3 * 1000
export const SEG_HELD_POLL_MS = 60 * 60 * 1000

export const SEG_VIEW_ARG_WORDS = Object.freeze({
  PRODUCT: 'product', PRODUCTS: 'product', REGION: 'region', REGIONS: 'region', GEOGRAPHY: 'region',
})
export const SEG_PERIOD_ARG_WORDS = Object.freeze({ ANNUAL: 'annual', YEARLY: 'annual', QUARTERLY: 'quarter', QTRLY: 'quarter' })
export const SEG_VIEWS = Object.freeze({
  product: Object.freeze({ label: 'By product', noun: 'product', what: 'Revenue by product' }),
  region: Object.freeze({ label: 'By region', noun: 'region', what: 'Revenue by region' }),
})
export const SEG_PERIODS = Object.freeze({
  annual: Object.freeze({ label: 'Annual', noun: 'year' }),
  quarter: Object.freeze({ label: 'Quarterly', noun: 'quarter' }),
})

const lookup = (map) => (tok) => {
  const key = String(tok ?? '').trim().toUpperCase()
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null
}
export const parseSegView = lookup(SEG_VIEW_ARG_WORDS)
export const parseSegPeriod = lookup(SEG_PERIOD_ARG_WORDS)
export const normSegView = (v) => (v === 'region' ? 'region' : 'product')
export const normSegPeriod = (v) => (v === 'quarter' ? 'quarter' : 'annual')
/** The arguments that run a pick: the defaults (by product, annual) are the bare command. */
export function segCommandArgs({ view, period } = {}) {
  const out = []
  if (normSegView(view) === 'region') out.push('REGION')
  if (normSegPeriod(period) === 'quarter') out.push('QUARTERLY')
  return out
}
export const segUrl = (sym, period) => `/api/research/revenue-segments/${encodeURIComponent(sym)}?period=${normSegPeriod(period)}`
export const segPollMs = (body) => (body && body.status === 'computing' ? SEG_COMPUTING_POLL_MS : SEG_HELD_POLL_MS)

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const LEG_STATES = new Set(['ok', 'none', 'not_in_plan', 'not_configured', 'rate_limited', 'failed'])

function readPeriod(raw) {
  if (!raw || typeof raw !== 'object' || !ISO_DAY.test(String(raw.date || ''))) return null
  const segments = (Array.isArray(raw.segments) ? raw.segments : [])
    .map((s) => (s && text(s.name) && finite(s.revenue) != null ? { name: text(s.name), revenue: s.revenue, share: finite(s.share) } : null))
    .filter(Boolean)
  if (!segments.length) return null
  return { date: raw.date, label: text(raw.label) || raw.date, currency: text(raw.currency), total: finite(raw.total), segments, cut: raw.cut === true }
}

function readLeg(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const state = LEG_STATES.has(src.state) ? src.state : 'failed'
  const periods = (Array.isArray(src.periods) ? src.periods : []).map(readPeriod).filter(Boolean)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const dropped = (Number.isInteger(src.dropped) && src.dropped > 0 ? src.dropped : 0) + ((Array.isArray(src.periods) ? src.periods.length : 0) - periods.length)
  if (state === 'ok' && !periods.length) return { state: 'none', periods: [], dropped, cut: false, httpStatus: null }
  return { state, periods, dropped, cut: src.cut === true, httpStatus: Number.isInteger(src.http_status) ? src.http_status : null }
}

/** The route's answer -> `{state, sym, period, readAt, check, legs: {product, region}}`. `state`: 'failed'
 *  (not an answer), 'computing', 'unavailable' (neither leg answered) or 'ok' (each leg then says its own). */
export function segRead(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { state: 'failed' }
  if (body.status === 'computing') return { state: 'computing' }
  if (body.status === 'failed' || body.status === 'unavailable') return { state: 'unavailable', reason: text(body.reason) }
  if (body.status !== 'ok' || !body.product || !body.region) return { state: 'failed' }
  return {
    state: 'ok', sym: text(body.sym), period: normSegPeriod(body.period), readAt: text(body.read_at),
    check: body.check && typeof body.check === 'object' ? body.check : null,
    legs: { product: readLeg(body.product), region: readLeg(body.region) },
  }
}

/** One amount in the period's currency: "$1.20B", "EUR 950.0M", or bare when the currency is not given. */
export function moneyWords(v, currency) {
  if (finite(v) == null) return 'Not reported'
  return relabelDollarText(formatCompactTerminal(v, { money: true }), currency, { unknown: 'none' })
}
export const shareWords = (v) => (finite(v) == null ? 'No share' : formatPercent(v, { decimals: 1 }))
export const currencyNote = (period) => reportingCurrencyNote(period?.currency, { unknown: 'none' })
/** "Sep 28, 2030", or '' with no date. */
export function periodEndWords(period) {
  const day = formatSessionDate(period?.date, { absent: '' })
  return day ? `${day}, ${String(period.date).slice(0, 4)}` : ''
}

/** The newest period's ranked list and the last few periods side by side, for one leg. */
export function legTables(leg) {
  if (!leg || leg.state !== 'ok' || !leg.periods.length) return null
  const newest = leg.periods[0]
  const columns = leg.periods.slice(0, SEG_COLUMNS)
  const names = []
  for (const p of columns) for (const s of p.segments) if (!names.includes(s.name)) names.push(s.name)
  const grid = names.map((name) => ({ name, cells: columns.map((p) => p.segments.find((s) => s.name === name) || null) }))
  return { newest, ranked: newest.segments, columns, grid }
}

/** The line above the tables. */
export function segLede(sym, view, leg) {
  const t = legTables(leg)
  if (!t) return ''
  const n = t.ranked.length
  const end = periodEndWords(t.newest)
  return `${sym}: ${SEG_VIEWS[normSegView(view)].what.toLowerCase()}, ${t.newest.label}${end ? ` (period ended ${end})` : ''}. `
    + `${n} ${n === 1 ? 'segment' : 'segments'} listed, ${moneyWords(t.newest.total, t.newest.currency)} together.`
}

/** What a leg that is not `ok` says: a title, a body, and whether Retry can help. */
export function legStateWords(leg, view, sym) {
  const what = SEG_VIEWS[normSegView(view)].what
  switch (leg?.state) {
    case 'none':
      return { kind: 'empty', retry: false, title: `${SEG_SOURCE} holds no revenue split by ${SEG_VIEWS[normSegView(view)].noun} for ${sym}.`,
        body: 'Some companies report one segment, or none. That is an answer, not a failed read.' }
    case 'not_in_plan':
      return { kind: 'locked', retry: false, title: `${what} is not available from our data provider.`,
        body: `${SEG_SOURCE} did not include this report for the site's plan. That is an answer about the source, not a failed read.` }
    case 'not_configured':
      return { kind: 'locked', retry: false, title: `${what} is not switched on for this server yet.`, body: null }
    case 'rate_limited':
      return { kind: 'error', retry: true, title: `${SEG_SOURCE} is busy, so ${what.toLowerCase()} could not be read just now.`,
        body: 'That is not the same as no segments. The server asks again within a few minutes.' }
    default:
      return { kind: 'error', retry: true, title: `${what} could not be read from ${SEG_SOURCE} just now.`,
        body: 'That is not the same as no segments. The server asks again within a few minutes.' }
  }
}

/** A cut list or rows the server could not read, in words, or ''. */
export function legNoteWords(leg) {
  const parts = []
  if (leg?.cut) parts.push('More periods are held than the panel draws; the oldest are left out.')
  if (leg?.periods?.some((p) => p.cut)) parts.push('A period lists more segments than the panel draws; the smallest are left out.')
  if (leg?.dropped) parts.push(`${leg.dropped} ${leg.dropped === 1 ? 'row' : 'rows'} in the answer had no date or no segment figure and ${leg.dropped === 1 ? 'is' : 'are'} not shown.`)
  return parts.join(' ')
}
