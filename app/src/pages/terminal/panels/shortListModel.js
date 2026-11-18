// SHRTS: the newest FINRA short interest report across the stocks UCT follows, ranked.
// The pure half (no React and no imports, so an agent capability can reuse it and args.js can
// take the parser without pulling a panel in).
//
//   GET /api/research/short-interest-list?rank=dtc|up|down|float[&limit=N]
//                                            api/routers/short_data.py -> api/services/short_data.py
//     GATE   `Depends(require_paid)`: 401 signed out, 402 not on a paid plan. No feature flag.
//     SPEED  never built on the request: the list the server holds (in memory and on disk), else a
//            few seconds' wait on ONE background build, else `{ status: 'computing' }` and this
//            panel asks again. The server looks for a newer report a few times a day and rebuilds
//            only when the settlement date is newer.
//
//   status   'ok' | 'computing' | 'unavailable' | 'failed' | 'bad_rank'
//   unavailable: { reason: 'refused' (the vendor answered 401 / 403 / 404 for this site's key) |
//                  'not_configured' (no vendor key on the server) | 'shape' | 'thin' (the vendor
//                  answered, but not with a report that can be read as a market), http_status }
//   ok: { rank, settlement_date, previous_settlement_date (or null), newer_report_landing (a newer
//         settlement date the vendor has only part of, or null), published (always null),
//         publication_estimate, read_at (ISO instant: when the site read the report),
//         count (stocks of the universe in the report), universe (stocks UCT follows),
//         ranked (stocks this rank covers), limit, cut (the answer is only the first `limit`),
//         floor_shares (up / down only), rows: [...],
//         float: { state, with_float, withheld, source }, check, source }
//     a row   { sym, short_interest (SHARES), avg_daily_volume, days_to_cover (days),
//               prev_short_interest, change_shares, change_pct (PERCENT), float_shares, pct_float }
//     rank    dtc    days to cover, highest first; a stock with none is not ranked
//             up     biggest percent increase since the previous report, ONLY for stocks whose
//                    previous report was at least `floor_shares` (so a tiny base cannot top it)
//             down   biggest percent decrease, same floor
//             float  short interest as a percent of float, highest first; needs a float on file
//     check   null, or { state, reason, http_status, at }: the last look for a newer report did
//             not go well, and the list shown is the last one read
//
// ⛔ A MISSING NUMBER IS NEVER 0: null stays null and the panel prints "not given".
// ⛔ THE LIST IS AS OLD AS ITS SETTLEMENT DATE. FINRA collects short interest twice a month and
// publishes it about two weeks later, so the newest report is two to four weeks old.

/** The terminal code this panel is registered under (the panel reads the live one from its frame). */
export const SHORT_LIST_CODE = 'SHRTS'
export const SOURCE = 'FINRA, through Massive'

/** The ranks, in chip order. `token` is what a chip writes into the command (`SHRTS UP`). */
export const SHORT_RANKS = Object.freeze({
  dtc: Object.freeze({ chip: 'Days to cover', token: null, words: 'most days to cover first' }),
  up: Object.freeze({ chip: 'Biggest increase', token: 'UP', words: 'biggest percent increase in short interest first' }),
  down: Object.freeze({ chip: 'Biggest decrease', token: 'DOWN', words: 'biggest percent decrease in short interest first' }),
  float: Object.freeze({ chip: 'Percent of float', token: 'FLOAT', words: 'highest percent of float first' }),
})
export const DEFAULT_SHORT_RANK = 'dtc'

/** The words each rank is typed as. For the args.js kind. */
export const SHORT_RANK_ARG_WORDS = Object.freeze({
  DTC: 'dtc', DAYS: 'dtc', COVER: 'dtc',
  UP: 'up', INCREASE: 'up', INCREASES: 'up', RISING: 'up', BUILDING: 'up',
  DOWN: 'down', DECREASE: 'down', DECREASES: 'down', FALLING: 'down', COVERING: 'down',
  FLOAT: 'float', PCT: 'float', PERCENT: 'float',
})

const own = (map, key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null)
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const whole = (v) => (num(v) != null && v >= 0 ? v : null)
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const day = (v) => (typeof v === 'string' && ISO_DAY.test(v) ? v : null)

/** Pure: a typed word as a rank key ('dtc' | 'up' | 'down' | 'float'), or null. */
export const parseShortRank = (token) => own(SHORT_RANK_ARG_WORDS, String(token ?? '').trim().toUpperCase())
/** Pure: what a prop or a typed word names. A key is taken as it is; anything unknown is the default. */
export const normShortRank = (raw) => parseShortRank(raw) || (typeof raw === 'string' && own(SHORT_RANKS, raw) ? raw : null) || DEFAULT_SHORT_RANK
/** Pure: the arguments a choice writes into the panel's command. The default is the bare command. */
export const shortListCommandArgs = ({ rank = null } = {}) => [SHORT_RANKS[normShortRank(rank)].token].filter(Boolean)
/** The route for one rank. */
export const shortListUrl = (rank) => `/api/research/short-interest-list?rank=${normShortRank(rank)}`

function rowOf(r) {
  const sym = isObj(r) && typeof r.sym === 'string' ? r.sym.trim().toUpperCase() : ''
  const short = isObj(r) ? whole(r.short_interest) : null
  if (!sym || short == null) return null
  return {
    sym, short, adv: whole(r.avg_daily_volume), dtc: whole(r.days_to_cover),
    prevShort: whole(r.prev_short_interest), changeShares: num(r.change_shares), changePct: num(r.change_pct),
    floatShares: whole(r.float_shares), pctFloat: whole(r.pct_float),
  }
}

/**
 * Pure: the route's answer as the panel draws it.
 *   state   'ok' | 'computing' | 'unavailable' | 'failed' (a failed build, or not this route's answer)
 *   ok:     rank, settlementDate, previousDate, landing, publicationEstimate, readAt, count, universe,
 *           ranked, limit, cut, floorShares, rows, unread (rows that came without a symbol or a short
 *           interest), float { state, withFloat, withheld }, check
 *   unavailable: reason, httpStatus
 */
export function shortListRead(body) {
  if (!isObj(body)) return { state: 'failed' }
  const status = String(body.status || '')
  if (status === 'computing') return { state: 'computing' }
  if (status === 'unavailable') {
    return { state: 'unavailable', reason: typeof body.reason === 'string' ? body.reason : null, httpStatus: num(body.http_status) }
  }
  const settlementDate = day(body.settlement_date)
  if (status !== 'ok' || !Array.isArray(body.rows) || !settlementDate || !own(SHORT_RANKS, String(body.rank))) return { state: 'failed' }
  const rows = body.rows.map(rowOf).filter(Boolean)
  const flt = isObj(body.float) ? body.float : {}
  const check = isObj(body.check) && typeof body.check.state === 'string'
    ? { state: body.check.state, reason: typeof body.check.reason === 'string' ? body.check.reason : null, httpStatus: num(body.check.http_status) }
    : null
  return {
    state: 'ok',
    rank: String(body.rank),
    settlementDate,
    previousDate: day(body.previous_settlement_date),
    landing: day(body.newer_report_landing),
    publicationEstimate: day(body.publication_estimate),
    readAt: typeof body.read_at === 'string' ? body.read_at : null,
    count: whole(body.count),
    universe: whole(body.universe),
    ranked: whole(body.ranked) ?? rows.length,
    limit: whole(body.limit),
    cut: body.cut === true,
    floorShares: whole(body.floor_shares),
    rows,
    unread: body.rows.length - rows.length,
    float: {
      state: typeof flt.state === 'string' ? flt.state : 'missing',
      withFloat: whole(flt.with_float), withheld: whole(flt.withheld),
    },
    check,
  }
}

/** Pure: which way short interest went since the report before: 'up' | 'down' | 'flat' | null (nothing to compare). */
export function changeWay(row) {
  const v = row?.changeShares
  if (v == null) return null
  return v > 0 ? 'up' : v < 0 ? 'down' : 'flat'
}
