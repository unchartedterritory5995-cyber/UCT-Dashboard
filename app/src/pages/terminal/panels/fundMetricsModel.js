// FUND's pure half: one company's metrics over time (and up to three more to compare), point in time
// from SEC filings, -> what the panel draws. No React.
//
// Two existing routes (api/routers/fundamentals_pit.py over api/services/fundamentals_pit/serving.py),
// both answering 404 unless FUNDAMENTALS_PIT_ENABLED=1, both behind the chart-data gate
// (`require_bars_access`: 401 signed out, 403 a plan without chart data):
//   GET /api/fundamentals/pit/catalog                  the metrics library (catalog.py): id, label,
//                                                      category, unit, fmt, cadence, methodology,
//                                                      limitations, `series` OR a named `compose` + inputs
//   GET /api/fundamentals/pit/series/{SYM}?series=...  each stored series asked, as
//                                                      [[t_eff, value | null, 'YYYY-MM-DD' period end, method]]
//                                                      ascending by t_eff (Beta: [[t_close, beta]]); `missing`
//                                                      names a series the company does not have. 404 = no
//                                                      company held for the symbol. The route reads the
//                                                      first 40 ids; the catalog lists 24 stored series in
//                                                      all, so one read always carries every row shown.
// and, only when a valuation metric is shown, the chart's own bars route (the same gate):
//   GET /api/bars/{SYM}?tf=W&bars=600                  weekly closes, split-adjusted as the chart draws them
//
// ⛔ THE CATALOG IS READ FIRST. jsonFetcher keeps no 404 body, so a 404 from the catalog is the feature
//    switched off for this server and a 404 from a series read (asked only after the catalog answered)
//    is the symbol. Only series the catalog lists are ever asked for (an unknown id is a 400).
// ⛔ A MISSING NUMBER IS NEVER 0: a series the company does not have, a quarter it did not file, a
//    figure its filing does not give (the server's `gap`) and a ratio with a zero or negative base are
//    all words.
// ⛔ VALUATION IS COMPOSED WITH PRICES. Market cap, P/E, P/S, P/B and FCF yield are not stored: like
//    the chart (components/chart/engine/fundamentalSource.js COMPOSERS) they are UCT's stored close
//    against the filing figures known at that close (the chart's own as-of rule, fundamentalAsOf.js).
//    In a quarter's column the close is the first weekly close at or after its filing became public.
// ⛔ FISCAL QUARTERS ACROSS COMPANIES. Each company's fiscal quarter goes in the CALENDAR quarter
//    that holds most of it (the one its middle day, 45 days before its last day, falls in). Fiscal
//    years that differ are said in a note, with each company's year end read from its own filings.
// Every number goes through the shared formatters (presentationPrimitives.js).
import { formatCompactTerminal, formatCurrency, formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { etDateOf } from '../../../components/chart/engine/economicSource'
import { closeUtcSeconds, projectAsOfIndices } from '../../../components/chart/engine/fundamentalAsOf'
import { shortDate } from '../../../components/chart/economic/econUi'
import { isCode } from '../functions'
import { closesFromBars, isoWeekFriday } from './relativeMath'
import { pathThrough, spreadGeometry } from './ratesModel'

export const FUND_CODE = 'FUND'
/** The thing read, as a failed read names it. */
export const FUND_WHAT = 'Company metrics from SEC filings'
/** The source as the panel header names it. */
export const FUND_SOURCE = 'SEC filings (XBRL), as filed'
/** The source line under the table, word for word. */
export const FUND_SOURCE_LINE = "SEC filings (XBRL), as filed; each value dated by when its filing became public. Valuation uses UCT's stored prices."
export const FUND_CATALOG_URL = '/api/fundamentals/pit/catalog'
/** The server holds each answer five minutes and a company changes when it files: asking every 15 minutes is plenty. */
export const FUND_POLL_MS = 15 * 60 * 1000
/** Tickers compared beside the main one. */
export const MAX_PEERS = 3
/** Metrics on the table at once (a default chosen here: four companies of twelve rows still read). */
export const MAX_METRICS = 12
/** Quarters the table shows before "Show all". */
export const TABLE_QUARTERS = 12
/** The series route reads the first 40 ids it is sent. */
export const SERIES_CAP = 40
/** Weekly bars asked for a valuation metric: the chart's own first-paint depth for W, about 11 years. */
export const BARS_WEEKS = 600

/** The default rows: revenue TTM, EPS TTM, revenue growth, net margin, FCF margin, P/E (catalog order). */
export const DEFAULT_METRICS = Object.freeze(['revenue_ttm', 'eps_ttm', 'revenue_growth_ttm', 'net_margin', 'fcf_margin', 'pe_ttm'])

/**
 * One command word per catalog metric (catalog.py V1 ids, which are never renamed once served). The
 * command line keeps a choice: a word on its own draws that metric as a line (`NVDA FUND PE`), words
 * joined by + are the table's rows (`NVDA FUND REV+EPS+PE`). No word is a function code or a stock in
 * the site's universe (FCF, PB and BETA are tickers, so they read FREECF, PBOOK and BETA1Y); args.js
 * keeps a copy, pinned to this one by functions.fundMetrics.test.js.
 */
export const FUND_METRIC_ARG_WORDS = Object.freeze({
  REV: 'revenue_ttm', REVQ: 'revenue_q', NETINC: 'net_income_ttm', NETINCQ: 'net_income_q',
  EPS: 'eps_ttm', EPSQ: 'eps_q', OCF: 'operating_cash_flow_ttm', FREECF: 'fcf_ttm',
  REVG: 'revenue_growth_ttm', REVGQ: 'revenue_growth_q', EPSG: 'eps_growth_ttm', EPSGQ: 'eps_growth_q',
  GROSSM: 'gross_margin', OPM: 'operating_margin', NETM: 'net_margin', FCFM: 'fcf_margin', ROE: 'roe', ROA: 'roa',
  CASHEQ: 'cash', ASSETS: 'total_assets', LIAB: 'total_liabilities', EQUITY: 'shareholders_equity',
  SHARES: 'shares_outstanding',
  MCAP: 'market_cap', PE: 'pe_ttm', PS: 'ps_ttm', PBOOK: 'pb', FCFY: 'fcf_yield',
  BETA1Y: 'beta_1y_spy',
})
/** catalog id -> its word. */
export const WORD_OF_METRIC = Object.freeze(Object.fromEntries(Object.entries(FUND_METRIC_ARG_WORDS).map(([w, id]) => [id, w])))

/** Stored series every read also asks for, so a company always has its quarters even when only a
 *  valuation or a share count is shown: two of the widest-covered series (catalog coverage 0.96, 0.94). */
export const ANCHOR_SERIES = Object.freeze(['assets', 'net_income_ttm'])
/** A series dated by its own stated date, not by the fiscal quarter end: the cover-page share count. */
export const AS_OF_SERIES = Object.freeze(['shares_outstanding'])
/** A cover-page date belongs to the quarter it follows when it is at most this many days after the quarter end. */
export const COVER_DAYS = 120
/** The trailing series a fiscal year end can be read from: their year-end points say `fiscal_year`. */
const YEAR_END_SERIES = ['net_income_ttm', 'revenue_ttm', 'operating_cash_flow_ttm', 'eps_diluted_ttm']

/** The composers the chart uses (fundamentalSource.js COMPOSERS), same names, same blanks. */
const COMPOSE = Object.freeze({
  market_cap: (c, x) => c * x.shares_outstanding,
  pe: (c, x) => (x.eps_diluted_ttm > 0 ? c / x.eps_diluted_ttm : NaN),
  ps: (c, x) => (x.revenue_ttm > 0 ? (c * x.shares_outstanding) / x.revenue_ttm : NaN),
  pb: (c, x) => (x.equity > 0 ? (c * x.shares_outstanding) / x.equity : NaN),
  fcf_yield: (c, x) => (c * x.shares_outstanding > 0 ? x.fcf_ttm / (c * x.shares_outstanding) : NaN),
})
/** Why a composed value is blank, in words (the catalog's own reasons). */
const NOT_MEANINGFUL = Object.freeze({
  pe: 'EPS TTM is zero or negative', ps: 'revenue TTM is zero or negative', pb: "shareholders' equity is zero or negative",
  fcf_yield: 'market cap is zero', market_cap: 'the share count is zero',
})

const UNIT_WORDS = Object.freeze({
  usd: 'US dollars', usd_per_share: 'dollars per share', percent: 'percent', ratio: 'times', shares: 'shares',
})
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const dayMs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
const pad2 = (n) => String(n).padStart(2, '0')
const isoOf = (ms) => {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}
const own = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k)

/** `iso` moved by `n` calendar days. */
export const addDays = (iso, n) => isoOf(dayMs(iso) + n * 86400000)
/** 'Aug 28, 2026', always with the year. */
export const dateText = (iso) => (isDay(iso) ? shortDate(iso, { nowIso: '0001-01-01' }) : '')
/** 'Aug 28' this year, 'Aug 28, 2025' another year. */
export const shortDay = (iso, today) => (isDay(iso) ? shortDate(iso, { nowIso: today }) : '')
/** The New York calendar day an instant (unix seconds) falls on. */
export const etDay = (sec) => (Number.isFinite(sec) ? etDateOf(sec) : null)

// ── words and arguments ─────────────────────────────────────────────────────────────────────────

/** A typed word as a metric id, or null. */
export function parseFundMetric(tok) {
  const k = String(tok ?? '').trim().toUpperCase()
  return own(FUND_METRIC_ARG_WORDS, k) ? FUND_METRIC_ARG_WORDS[k] : null
}

/** A typed set (`REV+EPS+PE`, or `REV+` for one) as metric ids in the typed order, or null. */
export function parseFundMetrics(tok) {
  const t = String(tok ?? '').trim().toUpperCase()
  if (!t.includes('+')) return null
  const parts = t.split('+').filter(Boolean)
  if (!parts.length || parts.length > MAX_METRICS) return null
  const ids = parts.map(parseFundMetric)
  if (ids.some((x) => !x) || new Set(ids).size !== ids.length) return null
  return ids
}

const TICKER_RE = /^[A-Z][A-Z0-9]{0,5}(?:[.-][A-Z]{1,2})?$/

/** A ticker typed to compare (`AMD`, `$GP`), or null. A function code or a metric word reads as a
 *  ticker only with `$`, as everywhere on the command line. */
export function parsePeerTicker(tok) {
  const t = String(tok ?? '').trim().toUpperCase()
  const forced = t.startsWith('$')
  const s = t.replace(/^\$/, '')
  if (!TICKER_RE.test(s)) return null
  if (!forced && (isCode(s) || own(FUND_METRIC_ARG_WORDS, s))) return null
  return s
}

/** The tickers typed to compare, as one list (`AMD AVGO`), or null: at most three, none twice. */
export function parseFundPeers(tok) {
  const words = String(tok ?? '').trim().split(/\s+/).filter(Boolean)
  if (!words.length || words.length > MAX_PEERS) return null
  const out = []
  for (const w of words) {
    const s = parsePeerTicker(w)
    if (!s || out.includes(s)) return null
    out.push(s)
  }
  return out
}

/** How a compared ticker is written back: with `$` when the bare word is a code or a metric word. */
export const peerToken = (sym) => (isCode(sym) || own(FUND_METRIC_ARG_WORDS, sym) ? `$${sym}` : sym)

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x))

/** The set token for a list of metric ids: `REV+EPS+PE`, `REV+` for one. */
export function metricsToken(ids) {
  const words = ids.map((id) => WORD_OF_METRIC[id]).filter(Boolean)
  return words.length === 1 ? `${words[0]}+` : words.join('+')
}

/** The command arguments for the panel's choice: compared tickers, the rows when they are not the
 *  default six, and the line's metric when the line is showing. The default is the bare command. */
export function fundCommandArgs({ peers = [], metrics = DEFAULT_METRICS, line = null } = {}) {
  const out = (peers || []).map(peerToken)
  const ids = (metrics || []).filter((id) => WORD_OF_METRIC[id])
  if (ids.length && !sameSet(ids, DEFAULT_METRICS)) out.push(metricsToken(ids))
  if (line && WORD_OF_METRIC[line]) out.push(WORD_OF_METRIC[line])
  return out
}

/** The compared tickers from a prop: upper case, not the main ticker, none twice, at most three. */
export function normPeers(peers, sym) {
  const out = []
  for (const p of Array.isArray(peers) ? peers : []) {
    const s = String(p || '').replace(/^\$/, '').trim().toUpperCase()
    if (s && s !== sym && !out.includes(s)) out.push(s)
  }
  return out.slice(0, MAX_PEERS)
}

/** The rows from a prop: known ids, none twice, at most twelve; the default six when there are none. */
export function normMetrics(metrics) {
  const ids = [...new Set((Array.isArray(metrics) ? metrics : []).filter((id) => WORD_OF_METRIC[id]))].slice(0, MAX_METRICS)
  return ids.length ? ids : [...DEFAULT_METRICS]
}

/** A ticker typed into the panel's own box: `{ sym }` or `{ error }` in words. */
export function peerInput(text, { sym, peers = [] } = {}) {
  const raw = String(text ?? '').trim().toUpperCase().replace(/^\$/, '')
  if (!raw) return { error: 'Type a ticker to compare, like AMD.' }
  if (!TICKER_RE.test(raw)) return { error: `${raw} is not a ticker. A ticker is letters, like AMD or BRK.B.` }
  if (raw === sym) return { error: `${raw} is the main ticker already.` }
  if (peers.includes(raw)) return { error: `${raw} is compared already.` }
  if (peers.length >= MAX_PEERS) return { error: `Up to ${MAX_PEERS} tickers can be compared. Remove one first.` }
  return { sym: raw }
}

// ── the catalog ─────────────────────────────────────────────────────────────────────────────────

/** In words, what a metric is measured in. */
export const unitWords = (unit) => UNIT_WORDS[unit] || 'as the filing states it'

/**
 * The catalog's answer -> `{ state, categories, metrics, byId, unknown }`. `metrics` are the ones this
 * panel can show (a command word, a stored series or a composer it knows), in the catalog's category
 * order; `unknown` counts any other. `state` 'ok', 'empty' (nothing it can show) or 'bad_shape'.
 */
export function readCatalog(body) {
  if (!isObj(body) || !Array.isArray(body.metrics)) return { state: 'bad_shape', categories: [], metrics: [], byId: new Map(), unknown: 0 }
  const order = (Array.isArray(body.categories) ? body.categories : []).filter((c) => str(c))
  const list = []
  let unknown = 0
  for (const raw of body.metrics) {
    if (!isObj(raw) || !str(raw.id) || !str(raw.name)) continue
    if (raw.status != null && raw.status !== 'READY') continue
    const id = raw.id.trim()
    const series = str(raw.series)
    const compose = str(raw.compose)
    const inputs = Array.isArray(raw.inputs) ? raw.inputs.filter((i) => str(i)) : []
    const usable = !!WORD_OF_METRIC[id] && (series ? !compose : !!(compose && own(COMPOSE, compose) && inputs.length))
    if (!usable) { unknown += 1; continue }
    list.push({
      id,
      word: WORD_OF_METRIC[id],
      name: raw.name.trim(),
      category: str(raw.category) || 'Other',
      unit: str(raw.unit),
      fmt: str(raw.fmt),
      cadence: raw.cadence === 'daily' ? 'daily' : 'quarterly',
      subtitle: str(raw.subtitle),
      methodology: str(raw.methodology),
      limitations: str(raw.limitations),
      series,
      compose: series ? null : compose,
      inputs: series ? [] : inputs,
      requires: Array.isArray(raw.requires) ? raw.requires.filter((r) => str(r)) : [],
    })
  }
  const cats = [...order.filter((c) => list.some((m) => m.category === c)), ...new Set(list.map((m) => m.category).filter((c) => !order.includes(c)))]
  const metrics = cats.flatMap((c) => list.filter((m) => m.category === c))
  return {
    state: metrics.length ? 'ok' : 'empty',
    categories: cats,
    metrics,
    byId: new Map(metrics.map((m) => [m.id, m])),
    unknown,
  }
}

/** The stored series a metric reads: its own, or its composer's inputs. */
export const seriesOfMetric = (m) => (!m ? [] : m.compose ? [...m.inputs] : m.series ? [m.series] : [])

/** Every stored series the catalog serves (direct and composer inputs). */
export const servedSeries = (catalog) => new Set((catalog?.metrics || []).flatMap(seriesOfMetric))

/** The series one read asks for: what the shown metrics need, plus the anchors, sorted, at most 40. */
export function seriesIdsFor(metricIds, catalog) {
  const served = servedSeries(catalog)
  const want = new Set()
  for (const id of metricIds || []) for (const s of seriesOfMetric(catalog?.byId?.get(id))) if (served.has(s)) want.add(s)
  for (const a of ANCHOR_SERIES) if (served.has(a)) want.add(a)
  return [...want].sort().slice(0, SERIES_CAP)
}

export function seriesUrl(sym, ids) {
  const s = String(sym || '').trim().toUpperCase()
  if (!s || !ids?.length) return null
  return `/api/fundamentals/pit/series/${encodeURIComponent(s)}?series=${ids.map(encodeURIComponent).join(',')}`
}

export const barsUrl = (sym) => {
  const s = String(sym || '').trim().toUpperCase()
  return s ? `/api/bars/${encodeURIComponent(s)}?tf=W&bars=${BARS_WEEKS}` : null
}

// ── one company ─────────────────────────────────────────────────────────────────────────────────

/** A series' points, ascending by t: `{ t, v (number | null for a gap), pe, m }`. A malformed point is dropped. */
export function pointsOf(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && (Number.isFinite(p[1]) || (p[1] === null && p[3] === 'gap')))
    .map((p) => ({ t: p[0], v: Number.isFinite(p[1]) ? p[1] : null, pe: isDay(p[2]) ? p[2] : null, m: typeof p[3] === 'string' ? p[3] : null }))
    .sort((a, b) => a.t - b.t)
}

/** A series read -> `{ sym, name, points: { series: points }, missing: Set, withheld, splitStatus }`, or
 *  null when the answer is not the route's shape (drawn as a failed read). */
export function readSeries(body, sym) {
  if (!isObj(body) || !isObj(body.metrics)) return null
  if (typeof body.symbol === 'string' && sym && body.symbol.trim().toUpperCase() !== sym) return null
  const points = {}
  for (const [id, raw] of Object.entries(body.metrics)) {
    const p = pointsOf(raw)
    if (p.length) points[id] = p
  }
  return {
    sym,
    name: str(body.name),
    points,
    missing: new Set(Array.isArray(body.missing) ? body.missing.filter((m) => str(m)) : []),
    withheld: body.withheld_split_sensitive === true,
    splitStatus: str(body.split_status),
  }
}

/** The calendar quarter that holds most of a fiscal quarter ending on `pe`: the one its middle day
 *  (45 days before its last day) falls in. `{ key: '2026Q2', year, q, months: 'Apr-Jun' }`. */
export function quarterBucket(pe) {
  if (!isDay(pe)) return null
  const mid = new Date(dayMs(pe) - 45 * 86400000)
  const year = mid.getUTCFullYear()
  const q = Math.floor(mid.getUTCMonth() / 3) + 1
  return { key: `${year}Q${q}`, year, q, months: `${MON[(q - 1) * 3]}-${MON[(q - 1) * 3 + 2]}` }
}

/**
 * A company's fiscal quarters from its period-dated series (every stored series but the cover-page
 * share count and Beta): `{ byBucket: Map(bucketKey -> { pe, firstT, lastT, bucket }), merged: [pe] }`.
 * `firstT` is when the quarter's first figure became public. Two quarters that fall in one calendar
 * quarter (a change of fiscal year) keep the later one; the earlier is listed in `merged`.
 */
export function companyQuarters(series) {
  const periods = new Map()
  for (const [id, pts] of Object.entries(series?.points || {})) {
    if (AS_OF_SERIES.includes(id) || pts.every((p) => !p.pe)) continue
    for (const p of pts) {
      if (!p.pe) continue
      const c = periods.get(p.pe)
      if (!c) periods.set(p.pe, { pe: p.pe, firstT: p.t, lastT: p.t })
      else { c.firstT = Math.min(c.firstT, p.t); c.lastT = Math.max(c.lastT, p.t) }
    }
  }
  const byBucket = new Map()
  const merged = []
  for (const per of [...periods.values()].sort((a, b) => a.pe.localeCompare(b.pe))) {
    const bucket = quarterBucket(per.pe)
    const had = byBucket.get(bucket.key)
    if (had) merged.push(had.pe)
    byBucket.set(bucket.key, { ...per, bucket })
  }
  return { byBucket, merged }
}

/** The month a company's fiscal year ends (1-12), from the newest year-end point of a trailing
 *  series (the server marks it `fiscal_year`), or null when none is held. */
export function fiscalYearEnd(series) {
  let best = null
  for (const id of YEAR_END_SERIES) {
    for (const p of series?.points?.[id] || []) if (p.m === 'fiscal_year' && p.pe && (!best || p.pe > best)) best = p.pe
  }
  return best ? +best.slice(5, 7) : null
}

/** The weekly closes in a bars answer, oldest first (`[{ d: Friday, c }]`), or null when it is not one. */
export function weeklyCloses(body) {
  if (!body || (typeof body !== 'object')) return null
  const bars = Array.isArray(body) ? body : body.bars
  if (!Array.isArray(bars)) return null
  return closesFromBars(body, { weekly: true })
}

// ── cells ───────────────────────────────────────────────────────────────────────────────────────

/** Points grouped by period end, each group ascending by t. */
function byPeriod(pts) {
  const m = new Map()
  for (const p of pts || []) {
    if (!p.pe) continue
    if (!m.has(p.pe)) m.set(p.pe, [])
    m.get(p.pe).push(p)
  }
  return m
}

/** The figure a quarter holds in a period-dated series: the newest point for that quarter end (a
 *  later filing can revise it; the first figure is kept as `revised`). */
function periodCell(group) {
  if (!group?.length) return { state: 'none' }
  const last = group[group.length - 1]
  if (last.v == null) return { state: 'gap', t: last.t }
  const first = group.find((p) => p.v != null)
  const revised = first && first !== last && first.v !== last.v ? { v: first.v, t: first.t } : null
  return { state: 'ok', v: last.v, t: last.t, revised }
}

/** The cover-page share count of a quarter's filing: the newest point stated on or after the quarter
 *  end and at most COVER_DAYS after it. */
function coverCell(pts, pe) {
  const end = addDays(pe, COVER_DAYS)
  return periodCell((pts || []).filter((p) => p.pe && p.pe >= pe && p.pe <= end))
}

/** The weekly close a quarter's daily-cadence figures are read at: the first weekly close at or after
 *  its filing became public. `{ d, c, refT, forming }`, `{ state: 'no_price' }`. */
export function closeFor(closes, publicT, nowSec) {
  const day = etDay(publicT)
  if (!day) return { state: 'no_price' }
  let key = isoWeekFriday(day)
  if (closeUtcSeconds(key) < publicT) key = addDays(key, 7)
  if (!closes?.length) return { state: 'no_price' }
  const bar = closes.find((b) => b.d >= key)
  if (!bar) return { state: 'no_price', after: true }
  if (dayMs(bar.d) - dayMs(key) > 14 * 86400000) return { state: 'no_price' }
  const close = closeUtcSeconds(bar.d)
  return { state: 'ok', d: bar.d, c: bar.c, refT: Math.min(close, nowSec ?? close), forming: nowSec != null && close > nowSec }
}

/** The point in force at a weekly close by the chart's own rule (fundamentalAsOf.js), or null. */
function asOfAt(pts, d, nowSec, maxPeriodAgeDays) {
  const i = projectAsOfIndices(pts, [{ t: d }], 'W', { nowSec, ...(maxPeriodAgeDays != null ? { maxPeriodAgeDays } : {}) })[0]
  return i >= 0 ? pts[i] : null
}

/** A composed (valuation) figure at a quarter: the close, the inputs known then, the composer. */
function composedCell(metric, company, period, prices, nowSec) {
  const at = closeFor(prices.closes, period.firstT, nowSec)
  if (at.state !== 'ok') return { state: at.after ? 'no_price_yet' : 'no_price' }
  const x = {}
  const inputs = {}
  for (const id of metric.inputs) {
    const p = asOfAt(company.series.points[id] || [], at.d, nowSec)
    if (!p) return { state: 'not_known', d: at.d }
    if (p.v == null) return { state: 'gap', d: at.d }
    if (!AS_OF_SERIES.includes(id) && p.pe !== period.pe) return { state: 'other_period', d: at.d }
    x[id] = p.v
    inputs[id] = p
  }
  const raw = COMPOSE[metric.compose](at.c, x)
  const v = metric.unit === 'percent' ? raw * 100 : raw
  if (!Number.isFinite(v)) return { state: 'not_meaningful', d: at.d, why: NOT_MEANINGFUL[metric.compose] }
  return { state: 'ok', v, d: at.d, close: at.c, forming: at.forming, inputs }
}

/** A stored daily-cadence figure (Beta) at a quarter: the value in force at that weekly close. */
function dailyCell(metric, company, period, nowSec) {
  const day = etDay(period.firstT)
  if (!day) return { state: 'not_known' }
  let key = isoWeekFriday(day)
  if (closeUtcSeconds(key) < period.firstT) key = addDays(key, 7)
  const p = asOfAt(company.series.points[metric.series] || [], key, nowSec, Infinity)
  if (!p || p.v == null) return { state: 'not_known', d: key }
  return { state: 'ok', v: p.v, d: key, t: p.t, forming: nowSec != null && closeUtcSeconds(key) > nowSec }
}

/** The short words a cell shows, and the full words it says (its title and its screen-reader text). */
const CELL_WORDS = Object.freeze({
  none: ['Not reported', 'Not reported in its filings for this quarter.'],
  no_quarter: ['No filing', 'No quarter of its filings falls in this column.'],
  gap: ['Not derivable', 'Its filing for this quarter does not give this figure.'],
  no_price: ['No price', "No stored weekly close for the week its filing became public."],
  no_price_yet: ['No price yet', 'No weekly close is stored yet after its filing became public.'],
  not_known: ['Not known', 'No filing figure was known at that close.'],
  other_period: ['Not known', 'The filing figure known at that close is for another quarter.'],
  not_meaningful: ['n/m', 'Not meaningful.'],
})

/** One table cell: `{ state, text, words, v, date (YYYY-MM-DD), dateWords, line2 }`. */
export function metricCell(metric, company, column, ctx = {}) {
  const { nowSec = null, today = null, prices = null } = ctx
  const period = company.quarters.byBucket.get(column.key)
  const say = (state, extra = {}) => {
    const [text, words] = CELL_WORDS[state]
    const why = extra.why ? `Not meaningful: ${extra.why}.` : words
    return { state, text, words: why, v: null, ...extra }
  }
  if (!period) return say('no_quarter')
  let c
  if (metric.compose) c = composedCell(metric, company, period, prices, nowSec)
  else if (metric.cadence === 'daily') c = dailyCell(metric, company, period, nowSec)
  else if (AS_OF_SERIES.includes(metric.series)) c = coverCell(company.series.points[metric.series], period.pe)
  else c = periodCell(company.byPeriod[metric.series]?.get(period.pe))
  const quarter = `quarter ended ${dateText(period.pe)}`
  if (c.state !== 'ok') return { ...say(c.state, { why: c.why }), pe: period.pe, quarter }
  const text = valueText(c.v, metric.fmt)
  if (metric.compose || metric.cadence === 'daily') {
    const close = metric.compose ? ` (close ${formatCurrency(c.close, { decimals: 2 })})` : ''
    const forming = c.forming ? ', the week still open' : ''
    return {
      state: 'ok', v: c.v, text, pe: period.pe, quarter, date: c.d, line2: shortDay(c.d, today),
      words: `${text} at the weekly close of ${dateText(c.d)}${close}${forming}, from the figures known then (${quarter}).`,
    }
  }
  const revised = c.revised
    ? ` A later filing revised it; first made public ${dateText(etDay(c.revised.t))} as ${valueText(c.revised.v, metric.fmt)}.`
    : ''
  const day = etDay(c.t)
  return {
    state: 'ok', v: c.v, text, pe: period.pe, quarter, date: day, line2: shortDay(day, today), revised: !!c.revised,
    words: `${text}, ${quarter}, public ${dateText(day)}.${revised}`,
  }
}

// ── formatting ──────────────────────────────────────────────────────────────────────────────────

/** A value in the catalog's own format, through the shared formatters; null for no number. */
export function valueText(v, fmt) {
  if (!Number.isFinite(v)) return null
  switch (fmt) {
    case 'compact_usd': return formatCompactTerminal(v, { money: true })
    case 'usd2': return formatCurrency(v, { decimals: 2 })
    case 'pct1': return formatPercent(v, { decimals: 1 })
    case 'x2': return `${formatNumber(v, { decimals: 2 })}x`
    case 'num2': return formatNumber(v, { decimals: 2 })
    case 'compact': return formatCompactTerminal(v)
    default: return formatNumber(v, { decimals: 2 })
  }
}

// ── reads in words ──────────────────────────────────────────────────────────────────────────────

/**
 * A failed catalog read in words. The routes answer 403 (not 402) to a plan without chart data and 404
 * when the feature is switched off for this server: neither is something Retry can change.
 *   { kind: 'error' | 'locked', state: 'signed_out' | 'plan' | 'off' | 'timeout' | 'error', title, hint, retry }
 */
export function fundFailure(err) {
  const status = err?.status
  if (status === 401) return { kind: 'error', state: 'signed_out', title: 'You are signed out, so company metrics from SEC filings cannot be read. Sign in again.', hint: null, retry: true }
  if (status === 402 || status === 403) return { kind: 'locked', state: 'plan', title: 'Company metrics from SEC filings need a paid plan, the same one as chart data.', hint: null, retry: false }
  if (status === 404) {
    return {
      kind: 'locked', state: 'off', title: 'Company metrics from SEC filings are switched off for this server.',
      hint: 'The point-in-time figures this panel shows (revenue, EPS, margins, cash flow, valuation) are not served here right now. Nothing is wrong with your account.',
      retry: false,
    }
  }
  if (err?.timedOut) return { kind: 'error', state: 'timeout', title: 'Company metrics from SEC filings did not answer within 30 seconds.', hint: null, retry: true }
  return { kind: 'error', state: 'error', title: 'Company metrics from SEC filings could not be read just now.', hint: null, retry: true }
}

/** One company's read -> `{ sym, state: 'loading' | 'ok' | 'not_held' | 'failed', words, ... }`. */
export function companyOf(sym, read) {
  if (!read || read.loading) return { sym, state: 'loading', words: `Loading ${sym}'s figures.`, short: 'Loading.' }
  if (!read.body) {
    const err = read.error
    if (err?.status === 404) {
      return {
        sym, state: 'not_held', short: `No figures held for ${sym}.`,
        words: `No figures from SEC filings are held for ${sym} here. They are built from 10-Q and 10-K filings in US GAAP, so funds and companies that file abroad (20-F, 40-F) are not in them.`,
      }
    }
    const f = fundFailure(err)
    return {
      sym, state: 'failed', retry: f.retry, short: 'Could not be read just now.',
      words: f.state === 'error' ? `${sym}'s figures could not be read just now.` : f.title,
    }
  }
  const series = readSeries(read.body, sym)
  if (!series) return { sym, state: 'failed', words: `${sym}'s figures could not be read just now.`, short: 'Could not be read just now.', retry: true }
  const byPeriodMap = {}
  for (const [id, pts] of Object.entries(series.points)) byPeriodMap[id] = byPeriod(pts)
  return { sym, state: 'ok', series, quarters: companyQuarters(series), byPeriod: byPeriodMap, yearEnd: fiscalYearEnd(series) }
}

/** One company's weekly prices -> `{ state: 'loading' | 'ok' | 'warming' | 'not_held' | 'failed', closes, words }`. */
export function pricesOf(sym, read, { warming = false } = {}) {
  if (!read) return { state: 'none', closes: null }
  if (read.loading) return { state: 'loading', closes: null, words: `Loading UCT's stored prices for ${sym}.` }
  const closes = read.body ? weeklyCloses(read.body) : null
  if (closes?.length) return { state: 'ok', closes }
  if (read.body) return { state: 'not_held', closes: null, words: `No stored prices for ${sym}, so its valuation cannot be worked out.` }
  if (warming) return { state: 'warming', closes: null, words: `The server is still preparing ${sym}'s prices. Retry in a minute.` }
  if (read.error?.status === 404) return { state: 'not_held', closes: null, words: `No stored prices for ${sym}, so its valuation cannot be worked out.` }
  return { state: 'failed', closes: null, words: `UCT's stored prices for ${sym} could not be read just now.` }
}

// ── the table ───────────────────────────────────────────────────────────────────────────────────

const MONTH_LIST = (months) => {
  const names = months.map((m) => MON[m - 1])
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || ''
}

/**
 * How the companies' fiscal quarters line up, in words, or null when there is one company or nothing
 * to say. Reads each company's fiscal year end from its own filings and the widest gap between the
 * quarter ends that share a column.
 */
export function alignmentNote(companies, columns) {
  const ok = companies.filter((c) => c.state === 'ok')
  if (ok.length < 2) return null
  let spread = 0
  for (const col of columns) {
    const ends = ok.map((c) => c.quarters.byBucket.get(col.key)?.pe).filter(Boolean)
    if (ends.length < 2) continue
    const ms = ends.map(dayMs)
    spread = Math.max(spread, Math.round((Math.max(...ms) - Math.min(...ms)) / 86400000))
  }
  const ends = ok.map((c) => ({ sym: c.sym, m: c.yearEnd }))
  const known = ends.filter((e) => e.m)
  const yearsDiffer = new Set(known.map((e) => e.m)).size > 1
  const unknown = ends.filter((e) => !e.m).map((e) => e.sym)
  const lead = yearsDiffer
    ? `Fiscal years differ: ${known.map((e) => `${e.sym}'s ends in ${MONTH[e.m - 1]}`).join(', ')}.`
    : null
  const tail = unknown.length ? ` ${unknown.join(', ')}: the fiscal year end is not in the filings held here.` : ''
  if (spread <= 7) {
    if (!lead) return unknown.length && known.length ? tail.trim() : null
    return `${lead} Their quarters end within a week of each other, so each column is the same three months for every company.${tail}`
  }
  const weeks = Math.round(spread / 7)
  const quarterMonths = ok.map((c) => {
    const newest = [...c.quarters.byBucket.values()].sort((a, b) => a.pe.localeCompare(b.pe)).slice(-4)
    const months = [...new Set(newest.map((p) => +p.pe.slice(5, 7)))].sort((a, b) => a - b)
    return `${c.sym}'s quarters end in ${MONTH_LIST(months)}`
  })
  return `${lead ? `${lead} ` : ''}${quarterMonths.join('; ')}. Each column is a calendar quarter and holds each company's fiscal quarter that falls mostly inside it, so the quarter ends in one column can be up to ${weeks} week${weeks === 1 ? '' : 's'} apart. Hover a figure for its own quarter end.${tail}`
}

/** The columns: every calendar quarter any readable company has, newest first. */
export function columnsOf(companies, { single = false } = {}) {
  const keys = new Map()
  for (const c of companies) {
    if (c.state !== 'ok') continue
    for (const [key, per] of c.quarters.byBucket) if (!keys.has(key)) keys.set(key, { key, bucket: per.bucket, pe: per.pe })
  }
  return [...keys.values()].sort((a, b) => b.key.localeCompare(a.key)).map(({ key, bucket, pe }) => (single
    ? { key, top: shortDate(pe, { nowIso: pe }), bottom: pe.slice(0, 4), title: `Fiscal quarter ended ${dateText(pe)}` }
    : { key, top: bucket.months, bottom: String(bucket.year), title: `Calendar quarter ${bucket.months} ${bucket.year}: each company's fiscal quarter that falls mostly in it` }))
}

const needsSplit = (m) => m.requires.includes('split_ledger')

/** A whole row in words, or null when the row has cells. */
export function rowWords(metric, company, prices) {
  if (company.state !== 'ok') return company.short || company.words
  if (needsSplit(metric) && company.series.withheld) {
    return `Withheld for ${company.sym}: its split history could not be verified, so per-share and share-count figures are not shown.`
  }
  const absent = seriesOfMetric(metric).filter((s) => !company.series.points[s])
  if (absent.length) {
    if (metric.cadence === 'daily' && !metric.compose) return `No ${metric.name} is held for ${company.sym} yet: it needs about a year of daily prices.`
    if (!metric.compose) return 'Not reported in its filings.'
    return `Not reported in its filings: ${absent.map((s) => INPUT_WORDS[s] || s).join(' and ')}, which ${metric.name} is worked out from.`
  }
  if (metric.compose && prices?.state !== 'ok') return prices?.words || `Loading UCT's stored prices for ${company.sym}.`
  return null
}

const INPUT_WORDS = Object.freeze({
  shares_outstanding: 'shares outstanding', eps_diluted_ttm: 'EPS TTM', revenue_ttm: 'revenue TTM', equity: "shareholders' equity", fcf_ttm: 'free cash flow TTM',
})

/**
 * Everything the panel draws from the reads:
 *   metrics    the rows' metrics (catalog order); `notInCatalog` ids asked for that the catalog lacks
 *   columns    every calendar quarter held, newest first
 *   groups     [{ metric, rows: [{ sym, words | null, cells: [cell per column] }] }]
 *   note       how the fiscal quarters line up (compare only); `merged` quarters left out per company
 *   newestT    when the newest figure on the table became public (the main company)
 */
export function fundView({ catalog, companies, metricIds, prices = {}, nowSec = null, today = null }) {
  const ids = (metricIds || []).filter((id) => catalog.byId.has(id))
  const metrics = catalog.metrics.filter((m) => ids.includes(m.id))
  const notInCatalog = (metricIds || []).filter((id) => !catalog.byId.has(id))
  const single = companies.length === 1
  const columns = columnsOf(companies, { single })
  const groups = metrics.map((metric) => ({
    metric,
    rows: companies.map((company) => {
      const p = prices[company.sym] || null
      const words = rowWords(metric, company, p)
      return {
        sym: company.sym,
        words,
        cells: words ? [] : columns.map((col) => metricCell(metric, company, col, { nowSec, today, prices: p })),
      }
    }),
  }))
  const main = companies[0]
  let newestT = null
  if (main?.state === 'ok') {
    for (const m of metrics) {
      for (const s of seriesOfMetric(m)) for (const p of main.series.points[s] || []) if (p.pe && (newestT == null || p.t > newestT)) newestT = p.t
    }
  }
  const merged = companies.filter((c) => c.state === 'ok' && c.quarters.merged.length)
    .map((c) => ({ sym: c.sym, ends: c.quarters.merged }))
  return { metrics, notInCatalog, columns, groups, note: single ? null : alignmentNote(companies, columns), merged, newestT }
}

/** The quarters the table shows: the newest TABLE_QUARTERS, or all. */
export const shownColumns = (columns, all) => (all ? columns : columns.slice(0, TABLE_QUARTERS))

// ── the line ────────────────────────────────────────────────────────────────────────────────────

/**
 * One box, one range for every line, a null breaking a line (never bridged): the RATES / LIQ picture
 * (ratesModel.spreadGeometry) for one series, and the same box, padding and arithmetic with ONE shared
 * range when companies are compared (a range per line would draw a $5B and a $500B company the same height).
 * `withZero` puts zero in the range. Returns { w, h, min, max, zeroY, lines: [{ key, path }] } or null.
 */
export function lineGeometry(series, { w = 320, h = 120, padX = 2, padY = 8, withZero = false } = {}) {
  const list = (series || []).filter((s) => Array.isArray(s.values))
  const all = list.flatMap((s) => s.values.filter((v) => Number.isFinite(v)))
  if (all.length < 2) return null
  if (list.length === 1) {
    const s = list[0]
    const geo = spreadGeometry({ dates: s.values.map((_, i) => String(i + 1)), v: s.values.map((v) => (Number.isFinite(v) ? v : null)) }, 'v', { w, h, padX, padY, withZero })
    if (!geo) return null
    return { w, h, min: geo.min, max: geo.max, zeroY: geo.zeroY, lines: [{ key: s.key, path: geo.path }] }
  }
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const min = withZero ? Math.min(lo, 0) : lo
  const max = withZero ? Math.max(hi, 0) : hi
  const span = max - min || 1
  const n = Math.max(...list.map((s) => s.values.length))
  const x = (i) => padX + (n > 1 ? i / (n - 1) : 0) * (w - 2 * padX)
  const y = (v) => padY + (1 - (v - min) / span) * (h - 2 * padY)
  const r1 = (v) => Math.round(v * 10) / 10
  return {
    w, h, min, max, zeroY: min <= 0 && max >= 0 ? r1(y(0)) : null,
    lines: list.map((s) => ({ key: s.key, path: pathThrough(s.values.map((v, i) => (Number.isFinite(v) ? { x: x(i), y: y(v) } : null))) })),
  }
}

/** The column's short name in the line's words: 'Jul 27, 2026' (one company) or 'Apr-Jun 2026'. */
const columnWords = (col) => (col.title.startsWith('Fiscal') ? col.title.replace('Fiscal quarter ended ', '') : `${col.top} ${col.bottom}`)

/**
 * The line for one metric over every quarter held, oldest first:
 *   { state: 'ok' | 'thin' | 'words', metric, geo, fromText, toText, rangeText, words: [per company], legend }
 * Zero joins the range when a value is below zero, so a line of large values is never flattened.
 */
export function fundLine(view, metricId) {
  const group = view.groups.find((g) => g.metric.id === metricId)
  if (!group) return { state: 'words', words: ['Pick a metric to draw.'] }
  const metric = group.metric
  const cols = [...view.columns].reverse()
  const rows = group.rows.filter((r) => !r.words)
  const series = rows.map((r) => ({ key: r.sym, values: [...r.cells].reverse().map((c) => (c.state === 'ok' ? c.v : null)) }))
  let first = cols.length
  let last = -1
  series.forEach((s) => s.values.forEach((v, i) => { if (Number.isFinite(v)) { first = Math.min(first, i); last = Math.max(last, i) } }))
  const said = group.rows.filter((r) => r.words).map((r) => `${r.sym}: ${r.words}`)
  if (last < 0) return { state: 'words', metric, words: said.length ? said : [`No quarter has a figure for ${metric.name}.`] }
  const span = cols.slice(first, last + 1)
  const trimmed = series.map((s) => ({ key: s.key, values: s.values.slice(first, last + 1) }))
  const values = trimmed.flatMap((s) => s.values.filter((v) => Number.isFinite(v)))
  const geo = lineGeometry(trimmed, { withZero: Math.min(...values) < 0 })
  if (!geo) {
    const s = trimmed.find((t) => t.values.some((v) => Number.isFinite(v)))
    const i = s.values.findIndex((v) => Number.isFinite(v))
    return { state: 'thin', metric, words: [`Only one quarter has a figure: ${s.key} ${valueText(s.values[i], metric.fmt)} (${columnWords(span[i])}). A line needs two.`, ...said] }
  }
  const words = trimmed.map((s) => {
    const have = s.values.map((v, i) => ({ v, i })).filter((p) => Number.isFinite(p.v))
    if (!have.length) return `${s.key}: no figure in these quarters.`
    const lo = have.reduce((a, b) => (b.v < a.v ? b : a))
    const hi = have.reduce((a, b) => (b.v > a.v ? b : a))
    const now = have[have.length - 1]
    const gaps = s.values.length - have.length
    return `${s.key}: low ${valueText(lo.v, metric.fmt)} (${columnWords(span[lo.i])}), high ${valueText(hi.v, metric.fmt)} (${columnWords(span[hi.i])}), `
      + `newest ${valueText(now.v, metric.fmt)} (${columnWords(span[now.i])})${gaps ? `; ${gaps} of ${s.values.length} quarters have no figure and the line breaks there` : ''}.`
  })
  return {
    state: 'ok',
    metric,
    geo,
    fromText: columnWords(span[0]),
    toText: columnWords(span[span.length - 1]),
    rangeText: `${valueText(geo.min, metric.fmt)} to ${valueText(geo.max, metric.fmt)}`,
    words: [...words, ...said],
    legend: trimmed.map((s, i) => {
      const v = [...s.values].reverse().find((x) => Number.isFinite(x))
      return { sym: s.key, style: i, last: Number.isFinite(v) ? valueText(v, metric.fmt) : 'no figure' }
    }),
    quarters: span.length,
  }
}

// ── notes ───────────────────────────────────────────────────────────────────────────────────────

/** The catalog's filing-lag sentence (it closes every SEC metric's limitations), said once under the table. */
export const LAG_START = 'Updates when the 10-Q/10-K is filed'

/** A metric's limitations without the filing-lag sentence (shown once for all). */
export function ownLimitations(m) {
  const t = m?.limitations || ''
  const i = t.indexOf(LAG_START)
  return (i >= 0 ? t.slice(0, i) : t).trim() || null
}

/** The filing-lag sentence as the catalog words it, from the first shown metric that carries it, or null. */
export function lagNote(metrics) {
  for (const m of metrics || []) {
    const t = m.limitations || ''
    const i = t.indexOf(LAG_START)
    if (i >= 0) return t.slice(i).trim()
  }
  return null
}

/** The valuation note: which shown metrics are composed with prices, and how a column reads them. */
export function valuationNote(metrics) {
  const names = (metrics || []).filter((m) => m.compose).map((m) => m.name)
  if (!names.length) return null
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]
  return `${list} ${names.length > 1 ? 'are' : 'is'} not filed: UCT works ${names.length > 1 ? 'them' : 'it'} out from its stored weekly close and the filing figures known at that close, as the chart does. A quarter's column reads the first weekly close after its filing became public.`
}

/** The metric's unit and its one-line method, as a picker or a row shows it. */
export const metricSub = (m) => [unitWords(m.unit), m.subtitle].filter(Boolean).join(', ')
