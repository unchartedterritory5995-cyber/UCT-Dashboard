// FTD with no ticker: the biggest fails-to-deliver across the market, the pure half of FtdMarketPanel.jsx.
//
//   FTD           by shares: each security's largest single-day fail balance in the newest SEC period
//   FTD VALUE     by value: that balance times the SEC file's own price that day
//   NVDA FTD      one stock's series (the Research > Depth panel, unchanged)
//
// GET /api/research/ftd-market?rank=shares|value (api/routers/research_depth.py over
// api/services/ftd_dataset.py `market_list`): FTD_DATASET_ENABLED (404 off), paid (402). Read from the
// server's local store of the SEC's twice-monthly cnsfails files; worked out once per ingested file.
// States: `ok`, `not_ingested` (no file read yet), `none_reported` (a period with no fails).

export const FTD_MARKET_CODE = 'FTD'
export const FTD_MARKET_URL = '/api/research/ftd-market'
export const FTD_MARKET_SOURCE = 'SEC fails-to-deliver files'

export const FTD_RANKS = Object.freeze({
  shares: Object.freeze({ label: 'Shares', token: null, what: 'by shares failed' }),
  value: Object.freeze({ label: 'Dollar value', token: 'VALUE', what: 'by dollar value' }),
})
export const DEFAULT_FTD_RANK = 'shares'

/** The words a member types (upper case: the shell upper-cases typed tokens). */
export const FTD_RANK_ARG_WORDS = Object.freeze({
  SHARES: 'shares', SHARE: 'shares', QTY: 'shares', QUANTITY: 'shares',
  VALUE: 'value', DOLLARS: 'value', DOLLAR: 'value', USD: 'value',
})

const own = (map, key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null)
export const parseFtdRank = (token) => own(FTD_RANK_ARG_WORDS, String(token ?? '').trim().toUpperCase())
export const normFtdRank = (raw) => (own(FTD_RANKS, String(raw ?? '').toLowerCase()) ? String(raw).toLowerCase() : parseFtdRank(raw)) || DEFAULT_FTD_RANK
export const ftdMarketUrl = (rank) => `${FTD_MARKET_URL}?rank=${normFtdRank(rank)}`
/** What a pick writes back after the code (the default writes nothing: bare `FTD`). */
export const ftdCommandArgs = (rank) => [FTD_RANKS[normFtdRank(rank)].token].filter(Boolean)

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const point = (p) => (p && typeof p === 'object'
  ? { date: day(p.settle_date), shares: num(p.quantity), price: num(p.price), value: num(p.value) }
  : null)

/**
 * The body as `{ state, rows, period, settleDates, securities, total, cut, cap, noPrice, mismatch, file, reason }`.
 * `state`: 'ok' | 'not_ingested' | 'none_reported' | 'unknown'. Rows keep the server's order.
 */
export function ftdMarketRead(body) {
  if (!body || typeof body !== 'object') return { state: 'unknown', rows: [] }
  const rows = (Array.isArray(body.rows) ? body.rows : [])
    .filter((r) => r && typeof r.symbol === 'string' && r.symbol.trim())
    .map((r, i) => ({
      key: `${r.symbol}-${i}`,
      sym: r.symbol.trim().toUpperCase(),
      name: typeof r.description === 'string' && r.description.trim() ? r.description.trim() : null,
      peak: point(r.peak),
      peakValue: point(r.peak_value),
      latest: point(r.latest),
      days: num(r.days_listed),
    }))
  const state = ['ok', 'not_ingested', 'none_reported'].includes(body.state) ? body.state : 'unknown'
  return {
    state,
    rows,
    rank: normFtdRank(body.rank),
    period: body.period && day(body.period.from) && day(body.period.through) ? { from: body.period.from, through: body.period.through } : null,
    settleDates: num(body.settle_dates),
    securities: num(body.securities),
    total: num(body.total),
    cut: body.cut === true,
    cap: num(body.cap),
    noPrice: num(body.no_price),
    mismatch: body.count_mismatch === true,
    file: typeof body.file === 'string' ? body.file : null,
    reason: typeof body.reason === 'string' ? body.reason : null,
  }
}

/** The sentence a cut list carries (a share repeats it). */
export function ftdCutNote(view) {
  if (!view?.cut || view.total == null || !view.rows?.length) return null
  return `Showing the ${view.rows.length} largest of ${view.total.toLocaleString('en-US')} securities ${FTD_RANKS[view.rank].what}.`
}
