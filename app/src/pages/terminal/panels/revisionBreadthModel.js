// EEHSC: estimate revisions by sector, the pure half (no React, so the Agent can reuse it).
//
// ONE paid route, behind the same switch as EEH (ESTIMATE_HISTORY_ENABLED: 404 while it is off):
//   GET /api/research/estimate-history?metric=eps|revenue&window=7|30
// (api/routers/research_cov.py over api/services/estimate_revisions.py). The server adds up UCT's OWN daily snapshots
// of each tracked stock's consensus estimate for its next fiscal quarter, by sector, and holds the answer; a request
// never reads the store.
//   status   'ok' | 'computing' (the first read of the store is running) | 'failed' (it could not be read)
//   tracked  {n, cap, origins: {sp500, viewed}, no_sector}: ONLY the stocks UCT tracks (the S&P 500 list the daily job
//            seeds and the stocks members opened the estimate history of), never the whole market
//   asof     the store's newest snapshot day; covers_from its first
//   total    {members, counted, up, down, held, net, not_counted: {collecting, gap, not_comparable}}
//   sectors  net breadth highest first, then sectors with too few counted, then the stocks with no sector on file;
//            each with the counts above, `raises` / `cuts` (the three largest by percent) and every symbol
//   a symbol {symbol, state: up|down|held|collecting|gap|not_comparable, pct, from, to, from_date, to_date,
//            period_end, reason}
//
// ⛔ A MISSING NUMBER IS NEVER 0: a sector with fewer than `min_counted` counted stocks gives its counts and no net
//    figure; a stock that cannot be measured says why, by state. Every number goes through the shared formatters.
import { formatCompactTerminal, formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { dateText } from './fundMetricsModel'

export const EEHSC_CODE = 'EEHSC'
export const REVISION_BREADTH_URL = '/api/research/estimate-history'
export const REVISION_BREADTH_WHAT = 'Estimate revisions by sector'
export const REVISION_BREADTH_SOURCE = "UCT's daily snapshots of the analyst consensus (FMP)"
/** The store changes once each weekday evening: asking every 30 minutes is plenty. */
export const REVISION_BREADTH_POLL_MS = 30 * 60 * 1000
/** While the server's first read of the store runs, the panel asks again this often. */
export const REVISION_BREADTH_COMPUTING_POLL_MS = 3000
export const MIN_COUNTED = 5

export const EEHSC_WINDOWS = Object.freeze({
  7: Object.freeze({ label: '7 days', word: '7D' }),
  30: Object.freeze({ label: '30 days', word: '30D' }),
})
export const DEFAULT_EEHSC_WINDOW = 30
export const EEHSC_METRICS = Object.freeze({
  eps: Object.freeze({ label: 'EPS', what: 'EPS estimate', word: 'EPS' }),
  revenue: Object.freeze({ label: 'Revenue', what: 'revenue estimate', word: 'REVENUE' }),
})
export const DEFAULT_EEHSC_METRIC = 'eps'

/** EEHSC's words (args.js keeps a copy, pinned by functions.revisionBreadth.test.js). No word is a function code. */
export const EEHSC_WINDOW_ARG_WORDS = Object.freeze({ '7D': 7, '1W': 7, '30D': 30, '1M': 30 })
export const EEHSC_METRIC_ARG_WORDS = Object.freeze({ EPS: 'eps', REVENUE: 'revenue', REV: 'revenue', SALES: 'revenue' })

const own = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k)
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v) => (Number.isInteger(v) && v >= 0 ? v : null)
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const count = (n) => formatNumber(n, { decimals: 0 })
const plural = (n, one, many) => `${count(n)} ${n === 1 ? one : many}`

export const parseEehscWindow = (tok) => { const k = String(tok ?? '').trim().toUpperCase(); return own(EEHSC_WINDOW_ARG_WORDS, k) ? EEHSC_WINDOW_ARG_WORDS[k] : null }
export const parseEehscMetric = (tok) => { const k = String(tok ?? '').trim().toUpperCase(); return own(EEHSC_METRIC_ARG_WORDS, k) ? EEHSC_METRIC_ARG_WORDS[k] : null }
export const normEehscWindow = (v) => (own(EEHSC_WINDOWS, v) ? Number(v) : parseEehscWindow(v) || DEFAULT_EEHSC_WINDOW)
export const normEehscMetric = (v) => (own(EEHSC_METRICS, v) ? v : parseEehscMetric(v) || DEFAULT_EEHSC_METRIC)

/** The command arguments for a choice: the window and the estimate, each left out at its default. */
export function eehscCommandArgs({ metric = DEFAULT_EEHSC_METRIC, window = DEFAULT_EEHSC_WINDOW } = {}) {
  const w = normEehscWindow(window)
  const m = normEehscMetric(metric)
  return [w === DEFAULT_EEHSC_WINDOW ? null : EEHSC_WINDOWS[w].word, m === DEFAULT_EEHSC_METRIC ? null : EEHSC_METRICS[m].word].filter(Boolean)
}
export const eehscCommand = (choice = {}) => [EEHSC_CODE, ...eehscCommandArgs(choice)].join(' ')

export const revisionBreadthUrl = ({ metric = DEFAULT_EEHSC_METRIC, window = DEFAULT_EEHSC_WINDOW } = {}) =>
  `${REVISION_BREADTH_URL}?metric=${normEehscMetric(metric)}&window=${normEehscWindow(window)}`

// ── words a member reads ────────────────────────────────────────────────────────────────────────

/** 'Nov 20, 2031' for an ISO day, or null. */
export const dayWords = (iso) => (isDay(iso) ? dateText(iso) : null)
/** An ISO day plus n calendar days. */
export function plusDays(iso, n) {
  if (!isDay(iso)) return null
  const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000
  return new Date(t).toISOString().slice(0, 10)
}
/** Net breadth as a member reads it: '+42%', '-8%', '0%'; null when there is no figure. */
export const netText = (v) => (num(v) === null ? null : formatPercent(v, { decimals: 0, signed: v !== 0, absent: null }))
/** One stock's change: '+12.3%'. */
export const pctText = (v) => (num(v) === null ? null : formatPercent(v, { decimals: 1, signed: v !== 0, absent: null }))
/** An estimate in its own units: EPS to the cent, revenue on the terminal's compact ladder (in the company's own
 *  reporting currency, which the store does not name, so no currency sign). */
export function estimateText(v, metric) {
  if (num(v) === null) return null
  return metric === 'revenue' ? formatCompactTerminal(v, { absent: null }) : formatNumber(v, { decimals: 2 })
}
/** The tone a change takes: 'up' | 'down' | null. */
export const toneOf = (v) => (num(v) === null || v === 0 ? null : v > 0 ? 'up' : 'down')

export const STATE_WORDS = Object.freeze({
  up: 'raised', down: 'cut', held: 'held',
  collecting: 'still collecting', gap: 'a gap in the snapshots', not_comparable: 'no comparable estimate',
})
/** Why a stock is not counted, one line per state (the group headings in an opened sector). */
export const NOT_COUNTED_WORDS = Object.freeze({
  collecting: 'Still collecting: snapshots too new to span the window',
  gap: 'A gap in the snapshots: none near one end of the window',
  not_comparable: 'No comparable estimate: no consensus for the next quarter at one end, or a zero start',
})

// ── the answer ──────────────────────────────────────────────────────────────────────────────────

function readCounts(c) {
  const o = isObj(c) ? c : {}
  const nc = isObj(o.not_counted) ? o.not_counted : {}
  return {
    members: int(o.members) ?? 0, counted: int(o.counted) ?? 0, up: int(o.up) ?? 0, down: int(o.down) ?? 0, held: int(o.held) ?? 0,
    net: num(o.net), notCounted: { collecting: int(nc.collecting) ?? 0, gap: int(nc.gap) ?? 0, notComparable: int(nc.not_comparable) ?? 0 },
  }
}

const STATES = ['up', 'down', 'held', 'collecting', 'gap', 'not_comparable']

function readSymbol(s) {
  if (!isObj(s) || !str(s.symbol) || !STATES.includes(s.state)) return null
  return {
    symbol: str(s.symbol).toUpperCase(), state: s.state, pct: num(s.pct), from: num(s.from), to: num(s.to),
    fromDate: isDay(s.from_date) ? s.from_date : null, toDate: isDay(s.to_date) ? s.to_date : null,
    periodEnd: isDay(s.period_end) ? s.period_end : null, reason: str(s.reason),
  }
}

const readTop = (list) => (Array.isArray(list) ? list : [])
  .filter((x) => isObj(x) && str(x.symbol) && num(x.pct) !== null).map((x) => ({ symbol: str(x.symbol).toUpperCase(), pct: x.pct }))

/**
 * The route's answer -> `{ state, ... }`. `state` 'ok' | 'collecting' (nothing spans the window yet) | 'empty' (UCT
 * tracks no stock yet) | 'computing' | 'failed' | 'bad_shape'.
 */
export function readRevisionBreadth(body) {
  if (!isObj(body)) return { state: 'bad_shape', sectors: [] }
  if (body.status === 'computing') return { state: 'computing', sectors: [] }
  if (body.status === 'failed' || body.status === 'unavailable') return { state: 'failed', reason: str(body.reason), sectors: [] }
  if (body.status !== 'ok' || !Array.isArray(body.sectors) || !isObj(body.tracked)) return { state: 'bad_shape', sectors: [] }
  const t = body.tracked
  const origins = isObj(t.origins) ? t.origins : {}
  const sectors = []
  for (const s of body.sectors) {
    if (!isObj(s) || !str(s.name)) continue
    sectors.push({
      name: str(s.name), onFile: s.on_file !== false, ...readCounts(s),
      raises: readTop(s.raises), cuts: readTop(s.cuts),
      symbols: (Array.isArray(s.symbols) ? s.symbols : []).map(readSymbol).filter(Boolean),
    })
  }
  const view = {
    metric: own(EEHSC_METRICS, body.metric) ? body.metric : null,
    window: own(EEHSC_WINDOWS, body.window) ? Number(body.window) : null,
    asof: isDay(body.asof) ? body.asof : null, coversFrom: isDay(body.covers_from) ? body.covers_from : null,
    builtAt: str(body.built_at), source: str(body.source),
    tolerancePct: num(body.tolerance_pct), slackDays: int(body.slack_days), minCounted: int(body.min_counted) || MIN_COUNTED,
    tracked: { n: int(t.n) ?? 0, cap: int(t.cap), sp500: int(origins.sp500) ?? 0, viewed: int(origins.viewed) ?? 0, noSector: int(t.no_sector) ?? 0 },
    total: readCounts(body.total), sectors, check: isObj(body.check) ? body.check : null,
  }
  const state = view.tracked.n === 0 ? 'empty' : view.total.counted === 0 ? 'collecting' : 'ok'
  return { state, ...view }
}

/** "Among the 587 stocks UCT tracks (the S&P 500 list and stocks members have looked at), not the whole market." */
export function trackedLine(view) {
  const { n, sp500, viewed } = view.tracked
  const from = sp500 && viewed ? 'the S&P 500 list and stocks members have looked at' : sp500 ? 'the S&P 500 list' : 'stocks members have looked at'
  return `Among the ${count(n)} ${n === 1 ? 'stock' : 'stocks'} UCT tracks (${from}), not the whole market.`
}

/** "Next-quarter EPS estimates, the change over 30 days to Nov 20, 2031 (the newest snapshot)." */
export function windowLine(view, metric, window) {
  const m = EEHSC_METRICS[normEehscMetric(metric)]
  const w = EEHSC_WINDOWS[normEehscWindow(window)]
  const day = dayWords(view.asof)
  return `Next-quarter ${m.label === 'EPS' ? 'EPS' : 'revenue'} estimates, the change over ${w.label}${day ? ` to ${day} (the newest snapshot)` : ''}.`
}

/** "480 counted; 20 still collecting, 5 with a gap in their snapshots, 3 with no comparable estimate." */
export function coverageLine(c) {
  const parts = []
  if (c.notCounted.collecting) parts.push(`${count(c.notCounted.collecting)} still collecting`)
  if (c.notCounted.gap) parts.push(`${count(c.notCounted.gap)} with a gap in ${c.notCounted.gap === 1 ? 'its' : 'their'} snapshots`)
  if (c.notCounted.notComparable) parts.push(`${count(c.notCounted.notComparable)} with no comparable estimate`)
  return `${count(c.counted)} counted${parts.length ? `; ${parts.join(', ')}` : ''}.`
}

/** "3 / 1 / 1" and its words. */
export const countsText = (c) => `${count(c.up)} / ${count(c.down)} / ${count(c.held)}`
export const countsWords = (c) => `${plural(c.up, 'raised', 'raised')}, ${count(c.down)} cut, ${count(c.held)} held`

/** A net figure in words, or why there is none. */
export function netWords(c, minCounted = MIN_COUNTED) {
  if (c.net === null) return `${plural(c.counted, 'stock', 'stocks')} counted, fewer than ${count(minCounted)}, so no net figure`
  return `net ${netText(c.net)} (${countsWords(c)}; ${count(c.counted)} counted)`
}

/** The line for every tracked stock together. */
export const totalLine = (view) => `All tracked stocks: ${netWords(view.total, view.minCounted)}.`

/** A row's sector cell sub line: '48 of 52 counted'. */
export const countedText = (s) => `${count(s.counted)} of ${count(s.members)} counted`

/** One counted stock's change in words: '+20.0%, 1.00 to 1.20 (Feb 12 to Mar 14, 2031)'. */
export function changeWords(s, metric) {
  const a = estimateText(s.from, metric)
  const b = estimateText(s.to, metric)
  const span = s.fromDate && s.toDate ? ` (${dayWords(s.fromDate)} to ${dayWords(s.toDate)})` : ''
  return `${pctText(s.pct) || ''}${a && b ? `, ${a} to ${b}` : ''}${span}`
}

/** An opened sector's stocks: the counted ones (largest raise first) and each not-counted state's symbols. */
export function sectorGroups(sector) {
  const counted = sector.symbols.filter((s) => s.state === 'up' || s.state === 'down' || s.state === 'held')
  const rest = ['collecting', 'gap', 'not_comparable'].map((state) => ({ state, words: NOT_COUNTED_WORDS[state], symbols: sector.symbols.filter((s) => s.state === state) }))
    .filter((g) => g.symbols.length)
  return { counted, rest }
}

/** When nothing spans the window yet: the day the first changes are due. */
export function collectingWords(view, window) {
  const w = normEehscWindow(window)
  const begun = dayWords(view.coversFrom)
  const due = dayWords(plusDays(view.coversFrom, w))
  if (!begun) return 'No snapshot has been taken yet. The daily job adds one each weekday evening, and history begins with the first.'
  return `Snapshots began on ${begun}, so the first ${w}-day changes are due from about ${due}.`
}

/** The symbols the panel lists (counted ones, in table order), for the shell's list. */
export const countedSymbols = (view) => (view?.sectors || []).flatMap((s) => s.symbols.filter((x) => x.state === 'up' || x.state === 'down' || x.state === 'held').map((x) => x.symbol))

/** The method line's figures in words: where the tracked stocks came from and the rule. */
export function originWords(view) {
  const { sp500, viewed, cap, noSector } = view.tracked
  const parts = []
  if (sp500) parts.push(`${count(sp500)} from the S&P 500 list the daily job follows`)
  if (viewed) parts.push(`${count(viewed)} added when a member opened ${viewed === 1 ? 'its' : 'their'} estimate history`)
  const capWords = cap ? ` (at most ${count(cap)})` : ''
  const sectorWords = noSector ? ` ${plural(noSector, 'stock has', 'stocks have')} no sector on file and ${noSector === 1 ? 'is' : 'are'} listed on ${noSector === 1 ? 'its' : 'their'} own row.` : ''
  return `${parts.length ? `${parts.join(', ')}${capWords}.` : ''}${sectorWords}`
}
