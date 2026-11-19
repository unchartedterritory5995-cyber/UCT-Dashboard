// SHINT: one stock's FINRA short interest, report by report, and its daily short volume.
// The pure half (no React and no imports, so an agent capability can reuse it).
//
//   GET /api/research/short-data/{sym}      api/routers/short_data.py -> api/services/short_data.py
//     GATE   `Depends(require_paid)`: 401 signed out, 402 not on a paid plan. No feature flag.
//     SPEED  never built on the request: the held answer, else a few seconds' wait on ONE
//            background build, else `{ status: 'computing' }` and this panel asks again. A held
//            answer is fresh for four hours; past that the last good one is sent at once, marked
//            `refreshing`, while its replacement is built.
//
//   status   'ok' | 'computing' | 'unavailable' (the data vendor refused BOTH datasets for this
//            site's key) | 'failed' | 'bad_symbol' (not a US stock or fund symbol)
//   ok: { sym, settlement_date, published (always null: the vendor does not send it),
//         publication_estimate (FINRA's schedule: the 7th business day after settlement),
//         read_at (ISO instant), refreshing?, source,
//         interest: { state, http_status, reason, reports: [...], count, cut, first_date },
//         volume:   { state, http_status, reason, days: [...], count, window_days },
//         float:    { shares, pct_float, withheld, state ('ok' | 'stale' | 'missing'), source } }
//     a section's state   'ok' | 'none' (the vendor answered and has no rows for this symbol) |
//                         'unavailable' (refused: 401 / 403 / 404, or no key on the server) |
//                         'failed' (a read that failed, or rows this code could not read)
//     interest.reports    newest first: { settlement_date, short_interest (SHARES), avg_daily_volume
//                         (shares), days_to_cover (days, the vendor's own figure), change_shares,
//                         change_pct (PERCENT, against the report before; null with no earlier
//                         report or an earlier report of zero shares) }
//     volume.days         newest first, 60 trading days at most: { date, short_volume, total_volume,
//                         short_volume_ratio (PERCENT, the vendor's own: short / total x 100) }
//     float.pct_float     short interest / today's float from the nightly screener export, PERCENT.
//                         null with no float on file; `withheld` when the short interest is more
//                         than 150% of that float (the two do not describe the same share count).
//
// ⛔ A MISSING NUMBER IS NEVER 0. Every reader below answers null for a number that did not come,
// and the panel prints "not given".
// ⛔ THE TWO DATASETS FAIL APART. One can be shown while the other is unavailable.
// ⛔ DAILY SHORT VOLUME IS NOT SHORT INTEREST (FINRA's own caution): it counts short sales in one
// day's OFF-EXCHANGE trades, most of them bought back the same day, and says nothing about how
// many shares are still held short. The panel says so wherever the two sit together.

/** The terminal code this panel is registered under (the panel reads the live one from its frame). */
export const SHORT_INTEREST_CODE = 'SHINT'
export const shortDataUrl = (sym) => `/api/research/short-data/${encodeURIComponent(sym)}`
/** Reports drawn at first, and after "Show more". The answer holds the whole history. */
export const REPORTS_SHOWN = 12
export const REPORTS_MORE = 24
/** Short volume days drawn at first; "Show all" draws every day sent (60 at most). */
export const VOLUME_DAYS_SHOWN = 10
export const SOURCE = 'FINRA, through Massive'

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const whole = (v) => (num(v) != null && v >= 0 ? v : null)
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const day = (v) => (typeof v === 'string' && ISO_DAY.test(v) ? v : null)
const SECTION_STATES = new Set(['ok', 'none', 'unavailable', 'failed'])

/** Pure: a calendar date as "Oct 30, 2026" (`short`: "Oct 30"). Anything else comes back as it is. */
export function dayText(iso, { short = false } = {}) {
  const d = day(iso)
  if (!d) return iso ? String(iso) : ''
  const [y, m, dd] = d.split('-').map(Number)
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]
  return short ? `${mon} ${dd}` : `${mon} ${dd}, ${y}`
}

/** Pure: the New York calendar date of an ISO instant ('YYYY-MM-DD'), or null. */
export function etDayOf(iso) {
  const d = typeof iso === 'string' && iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
}

/** Pure: whole days from one calendar date to another (null when either is not one). */
export function daysBetween(fromIso, toIso) {
  const a = day(fromIso)
  const b = day(toIso)
  if (!a || !b) return null
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)
}

function reportOf(r) {
  const date = isObj(r) ? day(r.settlement_date) : null
  const short = isObj(r) ? whole(r.short_interest) : null
  if (!date || short == null) return null
  return {
    date, short, adv: whole(r.avg_daily_volume), dtc: whole(r.days_to_cover),
    changeShares: num(r.change_shares), changePct: num(r.change_pct),
  }
}

function volumeDayOf(r) {
  const date = isObj(r) ? day(r.date) : null
  const short = isObj(r) ? whole(r.short_volume) : null
  if (!date || short == null) return null
  const ratio = num(r.short_volume_ratio)
  return { date, short, total: whole(r.total_volume), ratio: ratio != null && ratio >= 0 && ratio <= 100 ? ratio : null }
}

function sectionOf(raw, rowsKey, rowOf) {
  const s = isObj(raw) ? raw : {}
  const state = SECTION_STATES.has(s.state) ? s.state : 'failed'
  const rows = state === 'ok' && Array.isArray(s[rowsKey]) ? s[rowsKey].map(rowOf).filter(Boolean) : []
  return {
    // an "ok" section with no row this code can read is a failed read, never an empty stock
    state: state === 'ok' && !rows.length ? 'failed' : state,
    httpStatus: num(s.http_status), reason: typeof s.reason === 'string' ? s.reason : null, rows,
  }
}

/**
 * Pure: the route's answer as the panel draws it.
 *   state     'ok' | 'computing' | 'unavailable' | 'bad-symbol' | 'failed' (a failed build, or not this route's answer)
 *   ok:       sym, settlementDate, publicationEstimate, readAt, refreshing,
 *             interest { state, httpStatus, reason, rows (newest first), latest, cut, firstDate, maxShort },
 *             volume   { state, httpStatus, reason, rows (newest first), windowDays },
 *             float    { shares, pct, withheld, state }
 *   unavailable: reason, httpStatus (of the short interest read)
 */
export function shortDataRead(body) {
  if (!isObj(body)) return { state: 'failed' }
  const status = String(body.status || '')
  if (status === 'computing') return { state: 'computing', busy: body.busy === true }
  if (status === 'bad_symbol') return { state: 'bad-symbol' }
  if (status !== 'ok' && status !== 'unavailable') return { state: 'failed' }
  const interest = sectionOf(body.interest, 'reports', reportOf)
  const volume = sectionOf(body.volume, 'days', volumeDayOf)
  if (status === 'unavailable') {
    const why = interest.state === 'unavailable' ? interest : volume
    return { state: 'unavailable', reason: why.reason, httpStatus: why.httpStatus }
  }
  if (![interest.state, volume.state].some((s) => s === 'ok' || s === 'none')) return { state: 'failed' }
  const src = isObj(body.interest) ? body.interest : {}
  const flt = isObj(body.float) ? body.float : {}
  return {
    state: 'ok',
    sym: typeof body.sym === 'string' ? body.sym : null,
    settlementDate: interest.rows[0]?.date || null,
    publicationEstimate: day(body.publication_estimate),
    readAt: typeof body.read_at === 'string' ? body.read_at : null,
    refreshing: body.refreshing === true,
    interest: {
      ...interest,
      latest: interest.rows[0] || null,
      cut: src.cut === true,
      firstDate: interest.rows.length ? interest.rows[interest.rows.length - 1].date : null,
      maxShort: interest.rows.reduce((m, r) => Math.max(m, r.short), 0),
    },
    volume: { ...volume, windowDays: num(isObj(body.volume) ? body.volume.window_days : null) },
    float: {
      shares: whole(flt.shares) || null, pct: num(flt.pct_float), withheld: flt.withheld === true,
      state: typeof flt.state === 'string' ? flt.state : 'missing',
    },
  }
}

/** Pure: a bar's width in percent of the biggest value on screen (0 to 100; null with nothing to draw). */
export function barShare(value, max) {
  if (num(value) == null || num(max) == null || max <= 0 || value < 0) return null
  return Math.max(0, Math.min(100, Math.round((value / max) * 1000) / 10))
}

/** Pure: the biggest short interest among the reports drawn (their bars share one scale). */
export const maxShortOf = (rows) => (rows || []).reduce((m, r) => Math.max(m, r.short), 0)

/** Pure: the short volume ratio across the days given: { n, avg, low, high }, or null when none has a ratio. */
export function ratioSummary(days) {
  const vals = (days || []).map((d) => d.ratio).filter((v) => v != null)
  if (!vals.length) return null
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length
  return { n: vals.length, avg: Math.round(avg * 10) / 10, low: Math.min(...vals), high: Math.max(...vals) }
}

/** Pure: which way short interest went since the report before: 'up' | 'down' | 'flat' | null (nothing to compare). */
export function changeWay(row) {
  const v = row?.changeShares
  if (v == null) return null
  return v > 0 ? 'up' : v < 0 ? 'down' : 'flat'
}

/** Pure: why a dataset is unavailable, in a sentence. `what` is the thing, capitalised ("Short interest"). */
export function unavailableWords(what, reason, httpStatus) {
  if (reason === 'not_configured') return `${what} is not available on this server: it has no key for the data vendor.`
  if (reason === 'shape' || reason === 'thin') {
    return `${what} is not available right now: the data vendor answered, but not with a report this screen can read.`
  }
  return `${what} is not available on the data plan right now${httpStatus ? ` (the data vendor answered ${httpStatus})` : ''}.`
}
