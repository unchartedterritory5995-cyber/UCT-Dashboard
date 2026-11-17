// LEAD: the long-run leader lists, the pure half (no React, so an agent capability can reuse it).
//
// Six preset scans the app already serves (api/routers/scans.py, each `Depends(require_paid)`),
// until now reachable only through the Scanner widget on /charts (ScannerResults.jsx):
//   GET /api/scans/top-gainers-30d | -60d | -90d   top 5% of liquid US common stocks by the move
//                                                  over 30 / 60 / 90 trading sessions
//   GET /api/scans/highest-volume-1y | -ever       stocks trading more shares today than on any day
//                                                  in the last year / on record
//   GET /api/scans/ipo-1y                          stocks that first traded in the last year
// Every one answers `{ status, results[], count, as_of, coverage? }`:
//   status    'computing' while the server builds its reference (results empty, as_of null), else 'ok'
//   as_of     an Eastern-time ISO instant: when the list was last worked out
//   coverage  the four-count receipt, present only while COVERAGE_RECEIPTS_SCANS_ENABLED is on
// Row fields (api/services/scan_gainers.py, scan_volume.py, scan_ipo.py):
//   gainers   sym, change_nd (the window's % move), ref_close, price, prev_close, change_pct
//   volume    sym, volume, ref_max (the old record), ratio (volume / ref_max), price, prev_close, change_pct
//   ipo       sym, ipo_date (YYYYMMDD of the first daily bar), price, prev_close, change_pct
//
// ⛔ 'ok' with no results is NOT only "nothing qualifies": the services also answer it when the live
// price snapshot is missing (before the open, or a feed miss). The panel says so.
//
// No imports on purpose: args.js can take `parseLongRunLens` without pulling a panel into the shell.
// The route per lens (`LONG_RUN_ROUTES`, `longRunUrl`) lives in LongRunPanel.jsx, the module that
// draws the results, because the coverage-receipt census finds a result surface by the scan routes
// its OWN module names (components/provenance/panelAdoption.ratchet.test.js, TERM-047).

/** The lenses, in chip order. `kind` picks the columns; `window` is what the list measures. */
export const LONG_RUN_LENSES = Object.freeze({
  '30D': Object.freeze({ kind: 'gain', sessions: 30, chip: '30-day gainers', what: 'the 30-day gainers' }),
  '60D': Object.freeze({ kind: 'gain', sessions: 60, chip: '60-day gainers', what: 'the 60-day gainers' }),
  '90D': Object.freeze({ kind: 'gain', sessions: 90, chip: '90-day gainers', what: 'the 90-day gainers' }),
  VOL1Y: Object.freeze({ kind: 'volume', span: 'the last year', chip: '1-year volume highs', what: 'the 1-year volume highs' }),
  VOLMAX: Object.freeze({ kind: 'volume', span: 'its whole history', chip: 'All-time volume highs', what: 'the all-time volume highs' }),
  IPO: Object.freeze({ kind: 'ipo', chip: 'New listings', what: 'the new listings' }),
})
export const DEFAULT_LENS = '30D'
export const LONG_RUN_LENS_KEYS = Object.freeze(Object.keys(LONG_RUN_LENSES))
/** The terminal code this panel is registered under (the panel reads the live one from its frame). */
export const LONG_RUN_CODE = 'LEAD'

/** A lens key the panel can show: the one asked for when it exists, else the default. */
export const lensOrDefault = (lens) => (LONG_RUN_LENSES[lens] ? lens : DEFAULT_LENS)

const LENS_WORDS = Object.freeze({
  '30D': '30D', 30: '30D', '60D': '60D', 60: '60D', '90D': '90D', 90: '90D',
  VOL1Y: 'VOL1Y', VOLUME1Y: 'VOL1Y', '1YVOL': 'VOL1Y',
  VOLMAX: 'VOLMAX', VOLEVER: 'VOLMAX', MAXVOL: 'VOLMAX', ALLTIME: 'VOLMAX',
  IPO: 'IPO', IPOS: 'IPO', LISTINGS: 'IPO',
})

/** Pure: a typed word as a lens key (`60d` -> '60D', `ipos` -> 'IPO'), or null. For an args.js kind. */
export function parseLongRunLens(token) {
  const t = String(token ?? '').trim().toUpperCase()
  return Object.prototype.hasOwnProperty.call(LENS_WORDS, t) ? LENS_WORDS[t] : null
}

/** Pure: the command a lens is written back as (`LEAD`, `LEAD 60D`), so a reload keeps the chip. */
export function longRunCommand(lens, code = LONG_RUN_CODE) {
  const key = lensOrDefault(lens)
  return key === DEFAULT_LENS ? code : `${code} ${key}`
}

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/** Pure: `20260212` (the first daily bar's date) as `2026-02-12`, or null. */
export function listedDate(raw) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(raw ?? '').trim())
  if (!m) return null
  const [, y, mo, d] = m
  return Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(d) <= 31 ? `${y}-${mo}-${d}` : null
}

/**
 * Pure: one scan answer as rows, in the server's order. Every row carries every field, null where
 * its lens does not send it, so a caller (the panel, an agent) reads one shape for all six lists.
 *   sym, last, todayPct          every lens
 *   gainPct, refClose            gainers: the window's move, and the close it is measured from
 *   volume, record, timesRecord  volume highs: today's shares, the old record, today over the record
 *   listed                       new listings: the first trading day (YYYY-MM-DD)
 */
export function longRunRows(body, lens) {
  const kind = LONG_RUN_LENSES[lens]?.kind
  if (!kind) return []
  const seen = new Set()
  const out = []
  for (const r of Array.isArray(body?.results) ? body.results : []) {
    const sym = String(r?.sym || '').trim().toUpperCase()
    if (!sym || seen.has(sym)) continue
    seen.add(sym)
    out.push({
      sym,
      order: out.length,
      last: num(r.price),
      todayPct: num(r.change_pct),
      gainPct: kind === 'gain' ? num(r.change_nd) : null,
      refClose: kind === 'gain' ? num(r.ref_close) : null,
      volume: kind === 'volume' ? num(r.volume) : null,
      record: kind === 'volume' ? num(r.ref_max) : null,
      timesRecord: kind === 'volume' ? num(r.ratio) : null,
      listed: kind === 'ipo' ? listedDate(r.ipo_date) : null,
    })
  }
  return out
}

/**
 * Pure: everything the panel shows for one answer.
 *   building  the server said 'computing' and sent no rows (never the same as an empty list)
 *   rows      longRunRows
 *   asOf      the server's own as_of, or null
 *   coverage  the receipt when the route sends one, else null
 */
export function longRunView(body, lens) {
  const rows = longRunRows(body, lens)
  return {
    building: rows.length === 0 && String(body?.status || '').toLowerCase() === 'computing',
    rows,
    asOf: typeof body?.as_of === 'string' && body.as_of ? body.as_of : null,
    coverage: body?.coverage && typeof body.coverage === 'object' ? body.coverage : null,
  }
}

/** The order each kind of list opens in: biggest gain, furthest past the record, newest listing. */
export function defaultLongRunSort(lens) {
  const kind = LONG_RUN_LENSES[lens]?.kind
  if (kind === 'volume') return { key: 'timesRecord', dir: 'desc' }
  if (kind === 'ipo') return { key: 'listed', dir: 'desc' }
  return { key: 'gainPct', dir: 'desc' }
}
