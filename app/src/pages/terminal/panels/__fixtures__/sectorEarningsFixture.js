// GET /api/research/sector-earnings answers (api/services/sector_earnings.py `get_season`), in the route's real shape.
// Every ticker, figure and date here is INVENTED (the tickers are not stocks the site follows:
// functions.sectorEarnings.test.js checks them against its universe). The figures are worked out from the invented
// reporters the way the server does (sector_earnings_calc.figures: a share or a median needs 5 reporters).

const TODAY = '2031-11-20'
const FLOOR = 5
const share = (k, n) => (n >= FLOOR ? Math.round((k / n) * 1000) / 10 : null)
function median(vals) {
  if (vals.length < FLOOR) return null
  const s = [...vals].sort((a, b) => a - b)
  const m = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
  return Math.round(m * 100) / 100
}
const state = (pct, abs = null) => {
  if (pct !== null) return pct > 0.5 ? 'beat' : pct < -0.5 ? 'miss' : 'in_line'
  if (abs !== null) return abs > 0.005 ? 'beat' : abs < -0.005 ? 'miss' : 'in_line'
  return 'none'
}

/** One reporter as the route gives it (a measure with no surprise has no consensus held: its estimate is null). */
export function rep(symbol, date, epsPct, revPct, move, { moveState = 'ok', epsAbs = null, eps: epsGiven = null, rev: revGiven = null, label = 'FY2031 Q3' } = {}) {
  const eps = epsGiven || (epsPct === null && epsAbs === null ? [1.1, null] : [1.1, 1.0])
  const rev = revGiven || (revPct === null ? [2.05e9, null] : [2.05e9, 2.0e9])
  return {
    symbol, date, label, eps_act: eps[0], eps_est: eps[1], eps_pct: epsPct, eps_abs: epsAbs, eps_state: state(epsPct, epsPct === null ? epsAbs : null),
    rev_act: rev[0], rev_est: rev[1], rev_pct: revPct, rev_state: state(revPct),
    move: moveState === 'ok' ? move : null, move_state: moveState,
  }
}

function measure(rows, pctKey, stateKey) {
  const c = { beat: 0, in_line: 0, miss: 0, none: 0 }
  for (const r of rows) c[r[stateKey]] += 1
  const n = c.beat + c.in_line + c.miss
  const pcts = rows.map((r) => r[pctKey]).filter((v) => v !== null)
  return { n, ...c, beat_pct: share(c.beat, n), in_line_pct: share(c.in_line, n), miss_pct: share(c.miss, n), median: median(pcts), median_n: pcts.length }
}

function figures(rows) {
  const moved = rows.filter((r) => r.move_state === 'ok' && r.move !== null).map((r) => r.move)
  const rose = moved.filter((m) => m > 0).length
  return {
    reported: rows.length, eps: measure(rows, 'eps_pct', 'eps_state'), rev: measure(rows, 'rev_pct', 'rev_state'),
    move: { n: moved.length, median: median(moved), rose, rose_pct: share(rose, moved.length),
      not_settled: rows.filter((r) => r.move_state === 'not_settled').length, not_measured: rows.filter((r) => r.move_state === 'not_measured').length },
  }
}

/** A sector worked out from its reporters, in full (the `sector=` answer's shape). */
export function sectorOf(name, reporters, { upcoming = [], late = [], onFile = true } = {}) {
  return { name, on_file: onFile, ...figures(reporters), to_report: upcoming.length, awaiting: late.length, reporters, upcoming, late }
}

const brief = (s) => {
  if (!s) return null
  const { reporters: _r, upcoming: _u, late: _l, ...rest } = s
  return rest
}

const TECH_REPORTERS = [
  rep('ZQKA', '2031-10-22', 18.0, 5.1, 6.1, { eps: [1.18, 1.0], rev: [2.102e9, 2.0e9] }),
  rep('ZQKB', '2031-10-23', 9.5, 2.0, 3.4),
  rep('ZQKC', '2031-10-28', 6.0, 1.2, -1.2),
  rep('ZQKD', '2031-11-04', 4.2, 0.9, 2.0),
  rep('ZQKE', '2031-11-05', 0.3, 0.7, 0.5),
  rep('ZQKF', '2031-11-11', -2.5, -1.5, -4.0),
  rep('ZQKG', '2031-11-18', -12.0, null, null, { moveState: 'not_settled', eps: [0.88, 1.0] }),
  rep('ZQKH', '2031-10-30', null, null, null, { moveState: 'not_measured', epsAbs: 0.02, eps: [0.04, 0.02] }),
]
const TECH = sectorOf('Technology', TECH_REPORTERS, {
  upcoming: [{ symbol: 'ZQKJ', date: '2031-11-25' }, { symbol: 'ZQKK', date: '2031-12-04' }],
  late: [{ symbol: 'ZQKL', date: '2031-11-12' }],
})
const HEALTH = sectorOf('Healthcare', [
  rep('ZQHA', '2031-10-21', 8.0, 2.2, -2.0), rep('ZQHB', '2031-10-29', 3.1, 0.1, 1.5), rep('ZQHC', '2031-11-03', 1.0, -3.0, 0.8),
  rep('ZQHD', '2031-11-06', 0.9, 1.0, -0.5), rep('ZQHE', '2031-11-13', -6.0, 4.0, 3.0),
])
const ENERGY = sectorOf('Energy', [rep('ZQEA', '2031-10-30', 2.0, 1.0, 1.0), rep('ZQEB', '2031-10-31', -5.0, -2.0, -3.0), rep('ZQEC', '2031-11-04', 1.0, 0.2, 0.4)])
const UTIL = sectorOf('Utilities', [], { upcoming: [{ symbol: 'ZQUA', date: '2031-12-10' }] })
const NONE = sectorOf('Sector not on file', [rep('ZQXA', '2031-11-07', 25.0, 3.0, 7.5)], { onFile: false })

/** A year earlier: Technology and Healthcare only. */
const AGO_TECH = sectorOf('Technology', [
  rep('ZQKA', '2030-10-21', 7.0, 2.0, 1.0), rep('ZQKB', '2030-10-22', 3.0, 1.0, -1.0), rep('ZQKC', '2030-10-27', -4.0, -2.0, -3.0),
  rep('ZQKD', '2030-11-03', 2.0, 0.6, 2.0), rep('ZQKE', '2030-11-04', 0.1, -0.9, 0.2), rep('ZQKF', '2030-11-10', 5.0, 1.5, 4.0),
])
const AGO_HEALTH = sectorOf('Healthcare', [rep('ZQHA', '2030-10-20', 1.0, 1.0, 1.0)])

const SEASONS = {
  current: { label: 'Q3 2031', quarter: '2031-Q3', from: '2031-10-01', to: '2031-12-31', through: TODAY, complete: false },
  previous: { label: 'Q2 2031', quarter: '2031-Q2', from: '2031-07-01', to: '2031-09-30', through: '2031-09-30', complete: true },
  year_ago: { label: 'Q3 2030', quarter: '2030-Q3', from: '2030-10-01', to: '2030-12-31', through: '2030-12-31', complete: true },
}

export const COMMON = {
  status: 'ok', v: 1, built_at: '2031-11-20T15:10:00+00:00', today: TODAY,
  source: "UCT's held copy of each stock's earnings results (the Research Earnings tab's model: actual and consensus EPS and revenue from FMP and Finnhub)",
  reaction_source: "UCT's stored daily bars: the close before the report to the close after it",
  map: "the sector and industry each company's details name (the map GRP and PCHG group by)",
  universe_name: "UCT's stock universe ($300M market value and up), less the funds it lists",
  season_rule: 'The reports dated in one calendar quarter.', in_line_pct: 0.5, in_line_abs: 0.005, min_reporters: 5,
  coverage: { universe: 26, held: 24, not_held: 2, no_sector: 1, oldest_copy: '2031-11-12', newest_copy: '2031-11-20', copies_old: 1, old_days: 7 },
  seasons: SEASONS, check: null,
}

function total(sectors) {
  const all = sectors.flatMap((s) => s.reporters)
  return { ...figures(all), to_report: sectors.reduce((n, s) => n + s.to_report, 0), awaiting: sectors.reduce((n, s) => n + s.awaiting, 0) }
}

const CURRENT_SECTORS = [HEALTH, TECH, ENERGY, UTIL, NONE]
const AGO_SECTORS = [AGO_TECH, AGO_HEALTH]
const agoOf = (name) => brief(AGO_SECTORS.find((s) => s.name === name) || null)

/** This season: every sector (EPS beat share highest first), each beside the same season a year earlier. */
export const CURRENT = {
  ...COMMON, season: 'current',
  total: { ...total(CURRENT_SECTORS), year_ago: total(AGO_SECTORS) },
  sectors: CURRENT_SECTORS.map((s) => ({ ...brief(s), year_ago: agoOf(s.name) })), count: CURRENT_SECTORS.length,
}

/** One sector in full (this season). */
export const TECH_DETAIL = { ...COMMON, season: 'current', total: CURRENT.total, asked: 'Technology', found: true, sector: { ...TECH, year_ago: agoOf('Technology') } }
export const UTIL_DETAIL = { ...COMMON, season: 'current', total: CURRENT.total, asked: 'Utilities', found: true, sector: { ...UTIL, year_ago: null } }
export const NOT_FOUND = { ...COMMON, season: 'current', total: CURRENT.total, asked: 'Nothing', found: false, sector: null }

/** A year earlier: no comparison beside it. */
export const YEAR_AGO = { ...COMMON, season: 'year_ago', total: { ...total(AGO_SECTORS), year_ago: null },
  sectors: AGO_SECTORS.map((s) => ({ ...brief(s), year_ago: null })), count: AGO_SECTORS.length }

/** The season before, with nothing held in it. */
export const NONE_YET = { ...COMMON, season: 'previous', total: { ...total([]), year_ago: null }, sectors: [], count: 0 }

/** UCT holds no stock's results yet. */
export const EMPTY = { ...COMMON, season: 'current', coverage: { ...COMMON.coverage, held: 0, not_held: 26, no_sector: 0, oldest_copy: null, newest_copy: null, copies_old: 0 },
  total: { ...total([]), year_ago: total([]) }, sectors: [], count: 0 }

export const COMPUTING = { status: 'computing', season: 'current' }
export const FAILED = { status: 'failed', reason: 'error', http_status: null, season: 'current' }

/** Every invented ticker above. */
export const FIXTURE_TICKERS = [...new Set([...CURRENT_SECTORS, ...AGO_SECTORS].flatMap((s) => [...s.reporters, ...s.upcoming, ...s.late].map((x) => x.symbol)))]
