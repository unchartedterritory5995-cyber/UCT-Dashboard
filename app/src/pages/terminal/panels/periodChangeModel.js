// PCHG: every US common stock ranked by its percent change between two dates, the pure half (no
// React and no imports, so an agent capability can reuse it and args.js can take the parsers
// without pulling a panel in).
//
// ⭐ NO NEW ROUTE. `GET /api/scans/period-change?start=YYYYMMDD&end=YYYYMMDD`
// (api/routers/scans.py -> api/services/scan_period.py get_period_change). Until now only the
// Custom-Period Sort tool on /charts read it (pages/charts/widgets/PeriodSortResults.jsx).
//
// GATE   `Depends(require_paid)`: 401 signed out, 402 not on a paid plan. No feature flag on the
//        route. (`coverage` below is published only while COVERAGE_RECEIPTS_SCANS_ENABLED is on.)
//
// WHAT IT ANSWERS
//   ok          { status: 'ok', results: [...], count, start, end, as_of, partial, coverage? }
//     start/end  the trading days the server ACTUALLY used, as YYYYMMDD ints. Each typed date is
//                snapped BACK to the first trading day on or before it (a weekend, a holiday, or
//                today before the close has been published), up to 9 days.
//     a row      { sym, period_change (PERCENT, already times 100), net_change ($), start_close,
//                  end_close (split-adjusted closes), price, volume (live, null when the snapshot
//                  has none), industry, sector }
//     results    the WHOLE market (about 5,000 rows), biggest gainer first. Not cut by the server.
//     partial    true when the range was served from our own bar history (dates before the
//                provider's whole-market history, about 2003): only stocks still in that history
//                are ranked, so names that have since delisted are missing.
//     coverage   { evaluated, answered, dropped, not_computable, dropped_symbols } when armed.
//   computing   { status: 'computing', results: [], count: 0, as_of: null }: the server is still
//               reading the two days (or building an old range in the background). Ask again.
//   unavailable { status: 'unavailable', results: [], error }: no market-wide data that far back.
//   error       { status: 'error', error: 'start must be before end' }.
//
// ⛔ THE DATES ARE VALIDATED HERE, BEFORE ANY REQUEST. The service turns the ints into dates with
// no check of its own: an impossible day (20260230) is a 500, and an end date more than 9 days
// ahead answers "computing" for ever. `periodRequest` refuses both and says why.
// ⛔ THE SERVER SNAPS DATES, AND THE PANEL SAYS WHICH DAYS IT USED. `periodRead` returns them, and
// `sameDay` when both typed dates landed on ONE trading day (every change would read 0%).

/** The terminal code this panel is registered under (the panel reads the live one from its frame). */
export const PERIOD_CHANGE_CODE = 'PCHG'

/** The provider's whole-market history starts around here; earlier ranges come from our own bars. */
export const PERIOD_FLOOR = '1990-01-01'

/** The one-click ranges, in chip order. `token` is what a chip writes into the command (`PCHG YTD`). */
export const PERIOD_RANGES = Object.freeze({
  mtd: Object.freeze({ chip: 'This month', token: 'MTD', words: 'this month' }),
  qtd: Object.freeze({ chip: 'This quarter', token: 'QTD', words: 'this quarter' }),
  ytd: Object.freeze({ chip: 'Year to date', token: 'YTD', words: 'this year' }),
  m1: Object.freeze({ chip: '1 month', token: '1M', words: 'the last month' }),
  m3: Object.freeze({ chip: '3 months', token: '3M', words: 'the last 3 months' }),
  m6: Object.freeze({ chip: '6 months', token: '6M', words: 'the last 6 months' }),
  y1: Object.freeze({ chip: '1 year', token: '1Y', words: 'the last year' }),
})
export const DEFAULT_PERIOD_RANGE = 'ytd'

/** The words a range is typed as (`PCHG QTD`). For an args.js kind. */
export const PERIOD_RANGE_ARG_WORDS = Object.freeze({
  MTD: 'mtd', MONTH: 'mtd',
  QTD: 'qtd', QUARTER: 'qtd',
  YTD: 'ytd', YEAR: 'ytd',
  '1M': 'm1', '3M': 'm3', '6M': 'm6', '1Y': 'y1', '12M': 'y1',
})
/** The words an end of the list is typed as (`PCHG YTD LOSERS`). For an args.js kind. */
export const PERIOD_SIDE_ARG_WORDS = Object.freeze({
  GAINERS: 'gainers', GAINER: 'gainers', UP: 'gainers', TOP: 'gainers', BEST: 'gainers',
  LOSERS: 'losers', LOSER: 'losers', DOWN: 'losers', BOTTOM: 'losers', WORST: 'losers',
})
export const PERIOD_SIDES = Object.freeze({
  gainers: Object.freeze({ chip: 'Biggest gainers', token: null }),
  losers: Object.freeze({ chip: 'Biggest losers', token: 'LOSERS' }),
})

const own = (map, key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null)
const word = (token) => String(token ?? '').trim().toUpperCase()

/** Pure: a typed word as a range key (`qtd` -> 'qtd'), or null. */
export const parsePeriodRange = (token) => own(PERIOD_RANGE_ARG_WORDS, word(token))
/** Pure: a typed word as a list end ('gainers' | 'losers'), or null. */
export const parsePeriodSide = (token) => own(PERIOD_SIDE_ARG_WORDS, word(token))
/** Pure: the list end a prop or a typed word names; anything unknown is the gainers. */
export const normPeriodSide = (raw) => parsePeriodSide(raw) || 'gainers'

const pad2 = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`
/** A calendar date is real when it survives a round trip (2026-02-30 does not). */
function realDate(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/**
 * Pure: a typed date as `YYYY-MM-DD`, or null. Reads `2026-01-02`, `20260102` and `1/2/2026`.
 * Never parsed into a time: a trading day has no time zone to convert.
 */
export function parsePeriodDate(token) {
  const t = String(token ?? '').trim()
  let parts = null
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (m) parts = [m[1], m[2], m[3]]
  if (!parts) { m = /^(\d{4})(\d{2})(\d{2})$/.exec(t); if (m) parts = [m[1], m[2], m[3]] }
  if (!parts) { m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t); if (m) parts = [m[3], m[1], m[2]] }
  if (!parts) return null
  const [y, mo, d] = parts.map(Number)
  return realDate(y, mo, d) ? iso(y, mo, d) : null
}

/** Pure: `YYYY-MM-DD` moved by whole days (UTC arithmetic, so no clock change can shift it). */
export function shiftDay(day, days) {
  const p = parsePeriodDate(day)
  if (!p) return null
  const [y, m, d] = p.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

/** `YYYY-MM-DD` moved back by whole months, clamped to that month's last day (May 31 -> Feb 28). */
function monthsBack(day, months) {
  const [y, m, d] = day.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 - months, 1))
  const yy = first.getUTCFullYear()
  const mm = first.getUTCMonth() + 1
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate()
  return iso(yy, mm, Math.min(d, last))
}

/**
 * Pure: the two dates a one-click range asks for, given today's date in New York.
 * "This month", "this quarter" and "year to date" start from the LAST DAY BEFORE the period, so
 * the change is measured from the prior period's final close (the server snaps that day back to a
 * trading day). Returns `{ start, end }` as `YYYY-MM-DD`, or null for an unknown range or date.
 */
export function rangeDates(range, today) {
  const t = parsePeriodDate(today)
  if (!t || !own(PERIOD_RANGES, range)) return null
  const [y, m] = t.split('-').map(Number)
  const dayBefore = (yy, mm) => shiftDay(iso(yy, mm, 1), -1)
  const start = range === 'mtd' ? dayBefore(y, m)
    : range === 'qtd' ? dayBefore(y, m - ((m - 1) % 3))
      : range === 'ytd' ? dayBefore(y, 1)
        : monthsBack(t, { m1: 1, m3: 3, m6: 6, y1: 12 }[range])
  return { start, end: t }
}

const ymd = (day) => Number(day.replace(/-/g, ''))
/** Pure: a server `YYYYMMDD` int (or a typed date) as `YYYY-MM-DD`, or null. */
export const dayOfYmd = (v) => parsePeriodDate(v === null || v === undefined ? '' : String(v))

/** The route for two validated dates. */
export const periodChangeUrl = (start, end) => `/api/scans/period-change?start=${ymd(start)}&end=${ymd(end)}`

/**
 * Pure: what to ask the server for, or why not.
 *   in    { range, start, end, today }: typed dates win over a range; an end date alone is not a
 *         request; a start date alone means "since that day" (the end is today); neither is the
 *         range, and no range is the default one.
 *   out   { ok: true, range (the key, or null for typed dates), start, end, url, endIsToday }
 *         { ok: false, problem: 'today' | 'start' | 'end' | 'order' | 'future' | 'floor', message }
 */
export function periodRequest({ range = null, start = null, end = null, today = null } = {}) {
  const t = parsePeriodDate(today)
  if (!t) return { ok: false, problem: 'today', message: 'Today\'s date could not be read, so no range can be worked out.' }
  const typedStart = start !== null && start !== undefined && String(start).trim() !== ''
  const typedEnd = end !== null && end !== undefined && String(end).trim() !== ''
  if (!typedStart && !typedEnd) {
    const key = parsePeriodRange(range) || (own(PERIOD_RANGES, range) ? range : DEFAULT_PERIOD_RANGE)
    const d = rangeDates(key, t)
    return { ok: true, range: key, start: d.start, end: d.end, url: periodChangeUrl(d.start, d.end), endIsToday: true }
  }
  if (!typedStart) return { ok: false, problem: 'start', message: 'Pick a start date as well as an end date.' }
  const s = parsePeriodDate(start)
  if (!s) return { ok: false, problem: 'start', message: `"${String(start).trim()}" is not a date this panel can read. Use YYYY-MM-DD.` }
  const e = typedEnd ? parsePeriodDate(end) : t
  if (!e) return { ok: false, problem: 'end', message: `"${String(end).trim()}" is not a date this panel can read. Use YYYY-MM-DD.` }
  if (s > t) return { ok: false, problem: 'future', message: `The start date ${s} is after today (${t}). No stock has traded then yet.` }
  if (e > t) return { ok: false, problem: 'future', message: `The end date ${e} is after today (${t}). No stock has traded then yet.` }
  if (s >= e) return { ok: false, problem: 'order', message: `The start date ${s} has to be before the end date ${e}.` }
  if (s < PERIOD_FLOOR) return { ok: false, problem: 'floor', message: `The start date has to be ${PERIOD_FLOOR} or later.` }
  return { ok: true, range: null, start: s, end: e, url: periodChangeUrl(s, e), endIsToday: e === t }
}

/**
 * Pure: the arguments a choice writes into the panel's command. Typed dates win over a range; the
 * default range and the gainers are the bare command.
 */
export function periodChangeCommandArgs({ range = null, start = null, end = null, side = null } = {}) {
  const s = parsePeriodDate(start)
  const e = parsePeriodDate(end)
  const key = parsePeriodRange(range) || (own(PERIOD_RANGES, range) ? range : null)
  const dates = s ? [s, e].filter(Boolean) : []
  const rangeTok = !dates.length && key && key !== DEFAULT_PERIOD_RANGE ? PERIOD_RANGES[key].token : null
  return [...dates, rangeTok, PERIOD_SIDES[normPeriodSide(side)].token].filter(Boolean)
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v))
const pos = (v) => { const n = num(v); return n !== null && n > 0 ? n : null }
const text = (v) => (v === null || v === undefined ? '' : String(v).trim())
const whole = (v) => { const n = num(v); return n === null || n < 0 ? null : Math.round(n) }

function coverageOf(raw) {
  if (!isObj(raw)) return null
  const c = { evaluated: whole(raw.evaluated), ranked: whole(raw.answered), leftOut: whole(raw.dropped), noPrice: whole(raw.not_computable) }
  return Object.values(c).some((v) => v === null) ? null : c
}

/**
 * Pure: the route's answer as the panel needs it.
 *   state     'ok' (rows, possibly none) | 'computing' (the server is still working: ask again) |
 *             'unavailable' (no market-wide data for that range) | 'refused' (the server's own
 *             "start must be before end") | 'failed' (not this route's answer at all)
 *   rows      { key, sym, pct (percent), dollars, startClose, endClose, price, industry, sector },
 *             biggest gainer first, one per stock, a row with no percent dropped (never drawn as 0)
 *   startDay, endDay   the trading days the server used, as `YYYY-MM-DD` (null when not sent)
 *   sameDay   both dates landed on one trading day, so every change reads 0%
 *   partial   ranked from our own bar history: stocks that have since delisted are missing
 *   coverage  { evaluated, ranked, leftOut, noPrice } when the server sent a receipt that reads, else null
 *   asOf      when the server worked the list out, as it sent it (an ISO instant), or null
 */
export function periodRead(body) {
  const none = { state: 'failed', rows: [], startDay: null, endDay: null, sameDay: false, partial: false, coverage: null, asOf: null }
  if (!isObj(body)) return none
  const status = text(body.status).toLowerCase()
  if (status === 'computing') return { ...none, state: 'computing' }
  if (status === 'unavailable') return { ...none, state: 'unavailable' }
  if (status === 'error') return { ...none, state: 'refused' }
  if (status !== 'ok' || !Array.isArray(body.results)) return none
  const seen = new Set()
  const rows = []
  for (const it of body.results) {
    const sym = text(it?.sym).toUpperCase()
    const pct = num(it?.period_change)
    if (!sym || pct === null || seen.has(sym)) continue
    seen.add(sym)
    rows.push({
      key: `pchg-${sym}`,
      sym,
      pct,
      dollars: num(it.net_change),
      startClose: pos(it.start_close),
      endClose: pos(it.end_close),
      price: pos(it.price),
      industry: text(it.industry) || null,
      sector: text(it.sector) || null,
      sent: rows.length,
    })
  }
  rows.sort((a, b) => b.pct - a.pct || a.sent - b.sent)
  const startDay = dayOfYmd(body.start)
  const endDay = dayOfYmd(body.end)
  return {
    state: 'ok',
    rows: rows.map((r) => { const row = { ...r }; delete row.sent; return row }),
    startDay,
    endDay,
    sameDay: !!startDay && startDay === endDay,
    partial: body.partial === true,
    coverage: coverageOf(body.coverage),
    asOf: text(body.as_of) || null,
  }
}

/**
 * Pure: the rows one end of the list shows.
 *   gainers   the biggest percent gains first
 *   losers    the biggest percent falls first
 * Returns `{ rows, total, cut }`: `cut` says the list is longer than `limit` (the panel says so).
 */
export function sideRows(rows, side = 'gainers', limit = Infinity) {
  const all = Array.isArray(rows) ? rows : []
  const ordered = normPeriodSide(side) === 'losers' ? [...all].reverse() : all
  const shown = ordered.slice(0, Math.max(0, limit))
  return { rows: shown, total: all.length, cut: all.length > shown.length }
}

/** Pure: how many stocks rose, fell and did not move. */
export function breadthOf(rows) {
  const out = { up: 0, down: 0, flat: 0 }
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r.pct > 0) out.up += 1
    else if (r.pct < 0) out.down += 1
    else out.flat += 1
  }
  return out
}

/**
 * Pure: what the server did with the two dates that were asked for.
 *   startMoved / endMoved   the server used an earlier trading day than the one asked for
 * A date it did not send back is reported as not moved (nothing can be said about it).
 */
export function snapNote({ askedStart, askedEnd, startDay, endDay }) {
  return {
    startMoved: !!startDay && !!askedStart && startDay !== askedStart,
    endMoved: !!endDay && !!askedEnd && endDay !== askedEnd,
  }
}
