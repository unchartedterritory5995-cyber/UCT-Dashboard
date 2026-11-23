// ERNSC: earnings season by sector, the pure half (no React, so the Agent can reuse it).
//
// ONE paid route (api/routers/group_stats.py over api/services/sector_earnings.py):
//   GET /api/research/sector-earnings?season=current|previous|year_ago             every sector and the total
//   GET /api/research/sector-earnings?season=current|previous|year_ago&sector=NAME one sector: every reporter, the stocks
//                                                                                  still to report and the pending ones
// The server rolls up the earnings results it ALREADY HOLDS (each stock's copy of the Research Earnings tab's model:
// actual and consensus EPS and revenue, the report date, the measured move), by sector, and holds the answer; a request
// never reads a copy.
//   status    'ok' | 'computing' (the first read of the copies is running) | 'failed' (it could not be read)
//   coverage  {universe, held, not_held, no_sector, oldest_copy, newest_copy, copies_old, old_days}: ONLY the stocks UCT
//             holds results for, never every company that reports
//   seasons   {current, previous, year_ago}: each {label 'Q3 2031', from, to, through, complete}
//   total     the figures over every sector (and `year_ago`, the same season a year earlier, on the current season)
//   sectors   the EPS beat share highest first, then sectors below the floor, then the stocks with no sector on file;
//             each {name, on_file, reported, to_report, awaiting, eps, rev, move, year_ago}
//   a measure {n (with a consensus), beat, in_line, miss, none, beat_pct, in_line_pct, miss_pct, median, median_n}
//   a move    {n, median, rose, rose_pct, not_settled, not_measured}
//   sector    (with `sector=`) the figures plus `reporters` [{symbol, date, label, eps_act, eps_est, eps_pct, eps_abs,
//             eps_state, rev_act, rev_est, rev_pct, rev_state, move, move_state}], `upcoming` and `late` [{symbol, date}]
//
// ⛔ A MISSING NUMBER IS NEVER 0: a share or a median with fewer than `min_reporters` behind it is null and the panel says
//    "too few" with the count; a reporter with no consensus, or a move not settled or not held, says so in words. Every
//    number goes through the shared formatters.
import { formatCompactTerminal, formatCurrency, formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { dateText, shortDay } from './fundMetricsModel'

export const ERNSC_CODE = 'ERNSC'
export const SECTOR_EARNINGS_URL = '/api/research/sector-earnings'
export const SECTOR_EARNINGS_WHAT = 'Earnings season by sector'
export const SECTOR_EARNINGS_SOURCE = "UCT's held earnings results (the consensus from FMP and Finnhub)"
/** The server re-reads its copies at most every 30 minutes: asking as often is plenty. */
export const SECTOR_EARNINGS_POLL_MS = 30 * 60 * 1000
/** While the server's first read of the copies runs, the panel asks again this often. */
export const SECTOR_EARNINGS_COMPUTING_POLL_MS = 3000
export const MIN_REPORTERS = 5

export const ERNSC_SEASONS = Object.freeze({
  current: Object.freeze({ label: 'This season', word: null }),
  previous: Object.freeze({ label: 'The season before', word: 'PRIOR' }),
  year_ago: Object.freeze({ label: 'A year earlier', word: 'YEARAGO' }),
})
export const DEFAULT_ERNSC_SEASON = 'current'
export const ERNSC_METRICS = Object.freeze({
  eps: Object.freeze({ label: 'EPS', what: 'EPS', withA: 'an EPS', word: 'EPS' }),
  revenue: Object.freeze({ label: 'Revenue', what: 'revenue', withA: 'a revenue', word: 'REVENUE' }),
})
export const DEFAULT_ERNSC_METRIC = 'eps'

/** ERNSC's words (args.js keeps a copy, pinned by functions.sectorEarnings.test.js). No word is a function code or a
 *  stock; the estimate words are EEHSC's own, with the same meaning. The season that holds today is the bare command. */
export const ERNSC_SEASON_ARG_WORDS = Object.freeze({ PRIOR: 'previous', PREVIOUS: 'previous', YEARAGO: 'year_ago', LASTYEAR: 'year_ago' })
export const ERNSC_METRIC_ARG_WORDS = Object.freeze({ EPS: 'eps', REVENUE: 'revenue', REV: 'revenue', SALES: 'revenue' })

const own = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k)
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v) => (Number.isInteger(v) && v >= 0 ? v : null)
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const count = (n) => formatNumber(n, { decimals: 0 })
const plural = (n, one, many) => `${count(n)} ${n === 1 ? one : many}`

export const parseErnscSeason = (tok) => { const k = String(tok ?? '').trim().toUpperCase(); return own(ERNSC_SEASON_ARG_WORDS, k) ? ERNSC_SEASON_ARG_WORDS[k] : null }
export const parseErnscMetric = (tok) => { const k = String(tok ?? '').trim().toUpperCase(); return own(ERNSC_METRIC_ARG_WORDS, k) ? ERNSC_METRIC_ARG_WORDS[k] : null }
export const normErnscSeason = (v) => (typeof v === 'string' && own(ERNSC_SEASONS, v) ? v : parseErnscSeason(v) || DEFAULT_ERNSC_SEASON)
export const normErnscMetric = (v) => (typeof v === 'string' && own(ERNSC_METRICS, v) ? v : parseErnscMetric(v) || DEFAULT_ERNSC_METRIC)

/** The command arguments for a choice: the season and the measure, each left out at its default. */
export function ernscCommandArgs({ season = DEFAULT_ERNSC_SEASON, metric = DEFAULT_ERNSC_METRIC } = {}) {
  const s = normErnscSeason(season)
  const m = normErnscMetric(metric)
  return [ERNSC_SEASONS[s].word, m === DEFAULT_ERNSC_METRIC ? null : ERNSC_METRICS[m].word].filter(Boolean)
}
export const ernscCommand = (choice = {}) => [ERNSC_CODE, ...ernscCommandArgs(choice)].join(' ')

export const sectorEarningsUrl = ({ season = DEFAULT_ERNSC_SEASON } = {}) => `${SECTOR_EARNINGS_URL}?season=${normErnscSeason(season)}`
export const sectorDetailUrl = ({ season = DEFAULT_ERNSC_SEASON, sector } = {}) =>
  `${sectorEarningsUrl({ season })}&sector=${encodeURIComponent(String(sector ?? ''))}`

// ── the answer ──────────────────────────────────────────────────────────────────────────────────

function readMeasure(m) {
  const o = isObj(m) ? m : {}
  return {
    n: int(o.n) ?? 0, beat: int(o.beat) ?? 0, inLine: int(o.in_line) ?? 0, miss: int(o.miss) ?? 0, none: int(o.none) ?? 0,
    beatPct: num(o.beat_pct), inLinePct: num(o.in_line_pct), missPct: num(o.miss_pct), median: num(o.median), medianN: int(o.median_n) ?? 0,
  }
}

function readMove(m) {
  const o = isObj(m) ? m : {}
  return {
    n: int(o.n) ?? 0, median: num(o.median), rose: int(o.rose) ?? 0, rosePct: num(o.rose_pct),
    notSettled: int(o.not_settled) ?? 0, notMeasured: int(o.not_measured) ?? 0,
  }
}

function readFigures(f, { withYearAgo = true } = {}) {
  const o = isObj(f) ? f : {}
  return {
    name: str(o.name), onFile: o.on_file !== false,
    reported: int(o.reported) ?? 0, toReport: int(o.to_report) ?? 0, awaiting: int(o.awaiting) ?? 0,
    eps: readMeasure(o.eps), revenue: readMeasure(o.rev), move: readMove(o.move),
    yearAgo: withYearAgo && isObj(o.year_ago) ? readFigures(o.year_ago, { withYearAgo: false }) : null,
  }
}

function readSeason(s) {
  if (!isObj(s) || !str(s.label)) return null
  return {
    label: str(s.label), from: isDay(s.from) ? s.from : null, to: isDay(s.to) ? s.to : null,
    through: isDay(s.through) ? s.through : null, complete: s.complete === true,
  }
}

const STATE_SET = ['beat', 'in_line', 'miss', 'none']
const MOVE_SET = ['ok', 'not_settled', 'not_measured']

function readReporter(r) {
  if (!isObj(r) || !str(r.symbol)) return null
  return {
    symbol: str(r.symbol).toUpperCase(), date: isDay(r.date) ? r.date : null, label: str(r.label),
    epsAct: num(r.eps_act), epsEst: num(r.eps_est), epsPct: num(r.eps_pct), epsAbs: num(r.eps_abs),
    epsState: STATE_SET.includes(r.eps_state) ? r.eps_state : 'none',
    revAct: num(r.rev_act), revEst: num(r.rev_est), revPct: num(r.rev_pct),
    revState: STATE_SET.includes(r.rev_state) ? r.rev_state : 'none',
    move: r.move_state === 'ok' ? num(r.move) : null, moveState: MOVE_SET.includes(r.move_state) ? r.move_state : 'not_measured',
  }
}

const readDue = (list) => (Array.isArray(list) ? list : [])
  .filter((x) => isObj(x) && str(x.symbol)).map((x) => ({ symbol: str(x.symbol).toUpperCase(), date: isDay(x.date) ? x.date : null }))

function readCommon(body) {
  const c = isObj(body.coverage) ? body.coverage : {}
  const seasons = {}
  for (const id of Object.keys(ERNSC_SEASONS)) seasons[id] = readSeason(isObj(body.seasons) ? body.seasons[id] : null)
  return {
    season: own(ERNSC_SEASONS, body.season) ? body.season : null,
    seasons, today: isDay(body.today) ? body.today : null, builtAt: str(body.built_at),
    source: str(body.source), reactionSource: str(body.reaction_source), map: str(body.map),
    inLinePct: num(body.in_line_pct), inLineAbs: num(body.in_line_abs), minReporters: int(body.min_reporters) || MIN_REPORTERS,
    coverage: {
      universe: int(c.universe) ?? 0, held: int(c.held) ?? 0, notHeld: int(c.not_held) ?? 0, noSector: int(c.no_sector) ?? 0,
      oldestCopy: isDay(c.oldest_copy) ? c.oldest_copy : null, newestCopy: isDay(c.newest_copy) ? c.newest_copy : null,
      copiesOld: int(c.copies_old) ?? 0, oldDays: int(c.old_days) ?? 7,
    },
    check: isObj(body.check) ? body.check : null,
  }
}

function failState(body) {
  if (!isObj(body)) return 'bad_shape'
  if (body.status === 'computing') return 'computing'
  if (body.status === 'failed' || body.status === 'unavailable') return 'failed'
  return null
}

/**
 * The route's answer (no `sector`) -> `{ state, ... }`. `state` 'ok' | 'none_yet' (nothing reported or due in the season)
 * | 'empty' (UCT holds no stock's results yet) | 'computing' | 'failed' | 'bad_shape'.
 */
export function readSectorEarnings(body) {
  const failed = failState(body)
  if (failed) return { state: failed, reason: str(body?.reason), sectors: [] }
  if (body.status !== 'ok' || !Array.isArray(body.sectors) || !isObj(body.coverage) || !isObj(body.total)) return { state: 'bad_shape', sectors: [] }
  const view = { ...readCommon(body), total: readFigures(body.total), sectors: [] }
  for (const s of body.sectors) {
    if (!isObj(s) || !str(s.name)) continue
    view.sectors.push(readFigures(s))
  }
  const t = view.total
  const state = view.coverage.held === 0 ? 'empty' : t.reported + t.toReport + t.awaiting === 0 ? 'none_yet' : 'ok'
  return { state, ...view }
}

/** The route's answer for one sector -> `{ state, sector }`. `state` 'ok' | 'not_found' | 'computing' | 'failed' | 'bad_shape'. */
export function readSectorDetail(body) {
  const failed = failState(body)
  if (failed) return { state: failed, sector: null }
  if (body.status !== 'ok') return { state: 'bad_shape', sector: null }
  if (body.found === false) return { state: 'not_found', sector: null }
  if (!isObj(body.sector) || !Array.isArray(body.sector.reporters)) return { state: 'bad_shape', sector: null }
  const s = body.sector
  return {
    state: 'ok', today: isDay(body.today) ? body.today : null,
    sector: { ...readFigures(s), reporters: s.reporters.map(readReporter).filter(Boolean), upcoming: readDue(s.upcoming), late: readDue(s.late) },
  }
}

// ── order ───────────────────────────────────────────────────────────────────────────────────────

const measureOf = (fig, metric) => (normErnscMetric(metric) === 'revenue' ? fig.revenue : fig.eps)

/** The server's sector order applied to the chosen measure: its beat share highest first, then the sectors below the
 *  floor (most reported first), then the stocks with no sector on file. */
export function sortSectors(sectors, metric = DEFAULT_ERNSC_METRIC) {
  return [...(sectors || [])].sort((a, b) => {
    const ma = measureOf(a, metric)
    const mb = measureOf(b, metric)
    return (a.onFile === b.onFile ? 0 : a.onFile ? -1 : 1)
      || ((ma.beatPct === null) - (mb.beatPct === null))
      || ((mb.beatPct ?? 0) - (ma.beatPct ?? 0))
      || (b.reported - a.reported)
      || String(a.name).localeCompare(String(b.name))
  })
}

function reporterKey(r, metric) {
  const pct = metric === 'revenue' ? r.revPct : r.epsPct
  if (pct !== null) return [0, -Math.abs(pct)]
  if (metric !== 'revenue' && r.epsAbs !== null) return [1, -Math.abs(r.epsAbs)]
  return [2, 0]
}

/** The biggest beats and misses first, by the chosen measure's surprise; no consensus last; the symbol breaks ties. */
export function sortReporters(reporters, metric = DEFAULT_ERNSC_METRIC) {
  const m = normErnscMetric(metric)
  return [...(reporters || [])].sort((a, b) => {
    const ka = reporterKey(a, m)
    const kb = reporterKey(b, m)
    return (ka[0] - kb[0]) || (ka[1] - kb[1]) || a.symbol.localeCompare(b.symbol)
  })
}

// ── words a member reads ────────────────────────────────────────────────────────────────────────

/** '78%' (no decimals), or null. */
export const rateText = (v) => (num(v) === null ? null : formatPercent(v, { decimals: 0, absent: null }))
/** A surprise or a move: '+4.2%', '-3.1%', '0.0%'; null when there is none. */
export const pctText = (v) => (num(v) === null ? null : formatPercent(v, { decimals: 1, signed: v !== 0, absent: null }))
/** The tone a figure takes: 'up' | 'down' | null. */
export const toneOf = (v) => (num(v) === null || v === 0 ? null : v > 0 ? 'up' : 'down')
/** A state's tone: a beat is up, a miss down, the rest none. */
export const stateTone = (s) => (s === 'beat' ? 'up' : s === 'miss' ? 'down' : null)
export const STATE_WORDS = Object.freeze({ beat: 'beat', in_line: 'in line', miss: 'missed', none: 'no consensus' })

/** "78 / 6 / 16%" for a measure with enough reporters, else null. */
export function triText(m) {
  if (m.beatPct === null || m.inLinePct === null || m.missPct === null) return null
  return `${formatNumber(m.beatPct, { decimals: 0 })} / ${formatNumber(m.inLinePct, { decimals: 0 })} / ${rateText(m.missPct)}`
}

/** 'of 205' */
export const ofText = (n) => `of ${count(n)}`

/** The beat cell in words, or why there is no share. */
export function triWords(m, metric, minReporters = MIN_REPORTERS) {
  const { what, withA } = ERNSC_METRICS[normErnscMetric(metric)]
  if (m.beatPct === null) return `${plural(m.n, 'reporter', 'reporters')} with ${withA} consensus, fewer than ${count(minReporters)}, so no share`
  return `${rateText(m.beatPct)} beat, ${rateText(m.inLinePct)} in line, ${rateText(m.missPct)} missed the ${what} consensus `
    + `(${count(m.beat)}, ${count(m.inLine)} and ${count(m.miss)} of ${count(m.n)} with a consensus)`
}

/** The median surprise in words, or why there is none. */
export function medianWords(m, metric, minReporters = MIN_REPORTERS) {
  const what = ERNSC_METRICS[normErnscMetric(metric)].what
  if (m.median === null) return `${plural(m.medianN, 'percent surprise', 'percent surprises')}, fewer than ${count(minReporters)}, so no median`
  return `median ${what} surprise ${pctText(m.median)}, over ${plural(m.medianN, 'reporter', 'reporters')} with a percent surprise`
}

/** '54% of 198 rose'; with too few behind it, how many moves were measured ('3 measured'). */
export const roseText = (mv) => (mv.rosePct === null ? `${count(mv.n)} measured` : `${rateText(mv.rosePct)} of ${count(mv.n)} rose`)

/** The reaction in words, or why there is none. */
export function moveWords(mv, minReporters = MIN_REPORTERS) {
  const extra = []
  if (mv.notSettled) extra.push(`${count(mv.notSettled)} not settled yet`)
  if (mv.notMeasured) extra.push(`${count(mv.notMeasured)} with no move held`)
  const tail = extra.length ? `; ${extra.join(', ')}` : ''
  if (mv.median === null) return `${plural(mv.n, 'measured move', 'measured moves')}, fewer than ${count(minReporters)}, so no median${tail}`
  return `median move ${pctText(mv.median)} from the close before the report to the close after, ${rateText(mv.rosePct)} rose `
    + `(${count(mv.rose)} of ${count(mv.n)})${tail}`
}

/** An opened sector's line for the same season a year earlier (its figures stay in reach where that column folds). */
export function yearAgoLine(f, metric, label, minReporters = MIN_REPORTERS) {
  const m = normErnscMetric(metric) === 'revenue' ? f.revenue : f.eps
  return `A year earlier${label ? ` (${label})` : ''}: ${triWords(m, metric, minReporters)}; ${medianWords(m, metric, minReporters)}; `
    + `${moveWords(f.move, minReporters)}.`
}

/** A row's sector cell sub line: '212 reported, 14 to come, 3 pending'. */
export function reportedText(f) {
  const parts = [`${count(f.reported)} reported`]
  if (f.toReport) parts.push(`${count(f.toReport)} to come`)
  if (f.awaiting) parts.push(`${count(f.awaiting)} pending`)
  return parts.join(', ')
}

/** The same sub line in full words (the cell's title). */
export function reportedWords(f) {
  const parts = [`${plural(f.reported, 'stock', 'stocks')} reported`]
  if (f.toReport) parts.push(`${count(f.toReport)} still to report later in the season`)
  if (f.awaiting) parts.push(`${count(f.awaiting)} past ${f.awaiting === 1 ? 'its' : 'their'} report date with the result not in UCT's copy yet`)
  return parts.join(', ')
}

/** "Only the stocks UCT holds earnings results for: 3,301 of the 3,512 stocks in its universe, not every company that reports." */
export function coverageLine(view) {
  const { held, universe } = view.coverage
  return `Only the stocks UCT holds earnings results for: ${count(held)} of the ${plural(universe, 'stock', 'stocks')} in its universe, not every company that reports.`
}

/** 'The Q3 2031 season: reports dated Oct 1 to Dec 31, 2031, so far through Nov 20, 2031.' */
export function seasonLine(view, season = DEFAULT_ERNSC_SEASON) {
  const s = view.seasons?.[normErnscSeason(season)]
  if (!s) return ''
  const span = s.from && s.to ? `: reports dated ${shortDay(s.from, s.to)} to ${dateText(s.to)}` : ''
  const sofar = !s.complete && s.through ? `, so far through ${dateText(s.through)}` : ''
  return `The ${s.label} season${span}${sofar}.`
}

/** "1,842 reported, 214 still to report, 12 past their report date with the result not in UCT's copy yet." */
export const countsLine = (t) => `${reportedWords(t)}.`

/** A season's name for the picker: 'This season (Q3 2031)'. */
export const seasonOption = (view, id) => `${ERNSC_SEASONS[id].label}${view?.seasons?.[id]?.label ? ` (${view.seasons[id].label})` : ''}`

/** One reporter's surprise on the chosen measure: '+10.0%', '+$0.02' for an EPS estimate under 5 cents, or null. */
export function surpriseText(r, metric = DEFAULT_ERNSC_METRIC) {
  if (normErnscMetric(metric) === 'revenue') return pctText(r.revPct)
  if (r.epsPct !== null) return pctText(r.epsPct)
  if (r.epsAbs !== null) return `${r.epsAbs >= 0 ? '+' : '-'}${formatCurrency(Math.abs(r.epsAbs))}`
  return null
}

/** EPS to the cent, revenue on the terminal's compact ladder (in the company's own reporting currency: no sign). */
export function figureText(v, metric) {
  if (num(v) === null) return null
  return normErnscMetric(metric) === 'revenue' ? formatCompactTerminal(v, { absent: null }) : formatNumber(v, { decimals: 2 })
}

/** The move in a few words: 'moved +4.2%', 'move not settled', 'no move held'. */
export function moveText(r) {
  if (r.moveState === 'ok' && r.move !== null) return `moved ${pctText(r.move)}`
  return r.moveState === 'not_settled' ? 'move not settled' : 'no move held'
}

/** The second line of a reporter: the date, the figures against the consensus, the other measure, the move. */
export function reporterLine(r, metric, today) {
  const m = normErnscMetric(metric)
  const other = m === 'revenue' ? 'EPS' : 'rev'
  const act = figureText(m === 'revenue' ? r.revAct : r.epsAct, m)
  const est = figureText(m === 'revenue' ? r.revEst : r.epsEst, m)
  const otherPct = m === 'revenue' ? surpriseText(r, 'eps') : pctText(r.revPct)
  const parts = []
  if (r.date) parts.push(shortDay(r.date, today || r.date))
  if (act && est) parts.push(`${act} vs ${est}`)
  parts.push(`${other} ${otherPct || 'no consensus'}`)
  parts.push(moveText(r))
  return parts.join(' · ')
}

/** One reporter in full words (its title). */
export function reporterWords(r) {
  const said = (state) => (state === 'none' ? 'no comparable consensus' : state === 'in_line' ? 'in line' : `a ${state}`)
  const part = (name, metric, act, est, surprise, state) => {
    if (act === null) return `${name}: ${said(state)}.`
    if (est === null) return `${name} ${figureText(act, metric)}, ${said(state)}.`
    return `${name} ${figureText(act, metric)} against ${figureText(est, metric)} expected${surprise ? `: ${surprise}` : ''}, ${said(state)}.`
  }
  const eps = part('EPS', 'eps', r.epsAct, r.epsEst, surpriseText(r, 'eps'), r.epsState)
  const rev = part('Revenue', 'revenue', r.revAct, r.revEst, pctText(r.revPct), r.revState)
  const move = r.moveState === 'ok' && r.move !== null
    ? `The stock moved ${pctText(r.move)} from the close before the report to the close after.`
    : r.moveState === 'not_settled' ? 'The move is not settled yet in UCT\'s copy.' : 'UCT holds no move for this report.'
  const when = r.date ? `Reported ${dateText(r.date)}${r.label ? ` (${r.label})` : ''}. ` : ''
  return `${when}${eps} ${rev} ${move}`
}

/** The method line: the season, the tolerance, the reaction, the floor, the sectors and the copies, in words. */
export function methodWords(view) {
  const tol = view.inLinePct ?? 0.5
  const c = view.coverage
  const copies = c.oldestCopy && c.newestCopy
    ? ` UCT read these copies between ${dateText(c.oldestCopy)} and ${dateText(c.newestCopy)}${c.copiesOld ? ` (${plural(c.copiesOld, 'copy is', 'copies are')} more than ${count(c.oldDays)} days old)` : ''}.`
    : ''
  const noSector = c.noSector ? ` ${plural(c.noSector, 'stock has', 'stocks have')} no sector on file and ${c.noSector === 1 ? 'is' : 'are'} counted on ${c.noSector === 1 ? 'its' : 'their'} own row.` : ''
  return `How it is counted: a season is the reports dated in one calendar quarter (Oct 1 to Dec 31 is the Q3 season, when `
    + `most companies give the quarter that ended Sep 30), and each stock counts once in it, by its newest report. A beat, in line `
    + `or miss is against the consensus in UCT's copy: a surprise within ${formatNumber(tol, { decimals: 1 })}% either way is in line `
    + `(for an EPS estimate under 5 cents, within half a cent). The median surprise is over the percent surprises. The reaction is `
    + `the close before the report to the close after it, from UCT's stored daily bars, counted once both sessions that could `
    + `trade the result have closed. A share or a median shows with at least ${count(view.minReporters)} reporters. To come: the next `
    + `report date in UCT's copy is later in the season; pending: that date has passed and the result is not in UCT's copy yet. `
    + `Sectors are the company details GRPS and GRP group by.${noSector} Source: ${view.source || SECTOR_EARNINGS_SOURCE}; the moves `
    + `from ${view.reactionSource || "UCT's stored daily bars"}.${copies}`
}

/** The symbols the panel lists (an opened sector's reporters, in order), for the shell's list. */
export const reporterSymbols = (detail, metric) => (detail?.sector ? sortReporters(detail.sector.reporters, metric).map((r) => r.symbol) : [])
