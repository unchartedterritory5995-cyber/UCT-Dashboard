// OIL's pure half: the EIA's weekly oil report -> what the panel draws. No React; the Agent can reuse it.
//
// Reads (api/routers/econ.py over api/services/econ/serving.py: the econ routes' own flag and gate,
// ECON_ENABLED (404 when it is off for this server) and require_bars_access (401 signed out, 403 a plan
// without chart data; NOT 402)):
//   GET /api/econ/latest?symbols=...       each series' newest three points ([t first available, value,
//                                          period start, period end, pit]), its registry meta (units with
//                                          their format and scale), its currentness (the next release from
//                                          the release calendar) and when the econ service last read it
//   GET /api/econ/series/{symbol}?start=   a series' history: the week a year ago, and crude stocks' 2-year
//                                          line. Asked ONLY for a series the first read says is held: the
//                                          terminal's reader drops a 404's body, so "the feature is off" and
//                                          "this series is not held" would otherwise look alike.
// Nothing is computed on the server for this panel and no route was added.
//
// ⛔ A MISSING NUMBER IS NEVER 0: a series not held, a week the EIA published no figure for, a week
// before or a year ago that is not held, and a week missing from the line are words or a gap.
// ⛔ EACH SERIES IN ITS OWN UNITS (`units.fmt` with `units.scale`): stocks in thousands of barrels read
// as barrels, production in thousands of barrels a day, utilization in percent, pump prices in dollars
// a gallon. Every figure goes through the shared formatters.
// ⛔ THE WEEKLY BUILD OR DRAW IS THE ECON SERVICE'S OWN SERIES (USCRUDEINVCHG = diff(USCRUDEINV), a UCT
// calculation from the EIA's stock figures, `meta.derivation`), and the panel says so. The only
// arithmetic here is the change from the week before and from a year ago.
// ⛔ THE NEXT RELEASE IS THE CALENDAR'S DATE, never today: a date the server does not hold is words.
import { formatCompact } from '../../../lib/presentation/presentationPrimitives'
import { etDateOf } from '../../../components/chart/engine/economicSource'
import { shortDate } from '../../../components/chart/economic/econUi'
import { chartsLinkPath } from '../../../lib/chartDeepLink'
import { pathThrough } from './ratesModel'
import {
  ECON_POLL_MS, changeOf, creditLines, daysBetween, econFailure, nextReleaseOf, noFigureText, periodText, pointsOf, releaseNote,
  releasedText, valueText, weekdayOf,
} from './economyModel'

/** Missing value in words ('No figure for wk 11/13'): ECON's own. */
export { noFigureText }

export const OIL_CODE = 'OIL'
export const OIL_SOURCE = 'U.S. Energy Information Administration (Weekly Petroleum Status Report; Gasoline and Diesel Fuel Update)'
/** The econ service serves from a two-minute cache; asking more often finds nothing new. */
export const OIL_POLL_MS = ECON_POLL_MS
/** The histories only give the week a year ago and the line's older weeks (the newest weeks come with the
 *  latest read and are merged in), so they are asked again far less often. */
export const OIL_HISTORY_POLL_MS = 15 * 60 * 1000
/** The line covers two years of weeks: the newest week and the 104 before it. */
export const LINE_WEEKS = 104
/** "The same week a year ago": 52 weeks (364 days) before the newest week's end, give or take MATCH_DAYS. */
export const YEAR_DAYS = 364
export const MATCH_DAYS = 3

const SYM = Object.freeze({
  crude: 'USCRUDEINV', change: 'USCRUDEINVCHG', gasoline: 'USGASINV', distillate: 'USDISTINV', spr: 'USSPR',
  production: 'USCRUDEPROD', refining: 'USREFUTIL', gasPrice: 'USGASPRICE', dieselPrice: 'USDIESELPRICE',
})
export const OIL_SYMBOLS = Object.freeze(Object.values(SYM))
export const OIL_LATEST_URL = `/api/econ/latest?symbols=${OIL_SYMBOLS.join(',')}`
/** The series the line draws. */
export const LINE_SYMBOL = SYM.crude

/**
 * The table, group by group, in reading order. Only series the registry serves to members
 * (api/services/econ/registry/series.json: status enabled, source verified, cleared). Natural gas storage
 * (USNATGASSTOR, USNATGASCHG) is `unverified` there and is not served, so it is not asked for.
 */
export const OIL_GROUPS = Object.freeze([
  Object.freeze({ key: 'stocks', title: 'Inventories', rows: Object.freeze([
    Object.freeze({ key: 'crude', label: 'Crude oil, excluding the SPR', symbol: SYM.crude }),
    Object.freeze({ key: 'crude_change', label: 'Crude oil, weekly build or draw', symbol: SYM.change, buildDraw: true }),
    Object.freeze({ key: 'gasoline', label: 'Gasoline', symbol: SYM.gasoline }),
    Object.freeze({ key: 'distillate', label: 'Distillates (diesel and heating oil)', symbol: SYM.distillate }),
    Object.freeze({ key: 'spr', label: 'Strategic Petroleum Reserve', symbol: SYM.spr }),
  ]) }),
  Object.freeze({ key: 'supply', title: 'Production and refining', rows: Object.freeze([
    Object.freeze({ key: 'production', label: 'Crude oil production', symbol: SYM.production }),
    Object.freeze({ key: 'refining', label: 'Refinery utilization', symbol: SYM.refining }),
  ]) }),
  Object.freeze({ key: 'pump', title: 'Pump prices (U.S. average)', rows: Object.freeze([
    Object.freeze({ key: 'gas_price', label: 'Gasoline, regular', symbol: SYM.gasPrice }),
    Object.freeze({ key: 'diesel_price', label: 'Diesel', symbol: SYM.dieselPrice }),
  ]) }),
])

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const dayMs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
const pad2 = (n) => String(n).padStart(2, '0')
const isoOf = (ms) => {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}
const r1 = (v) => Math.round(v * 10) / 10

/** `iso` moved by `n` calendar days. */
export const addDays = (iso, n) => isoOf(dayMs(iso) + n * 86400000)

/** The first day of the month `months` before the month of `today`: a URL that stays the same all month,
 *  so every member's read shares one server cache entry. */
export function monthStartBefore(today, months) {
  if (!isDay(today)) return null
  return isoOf(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1 - months, 1))
}

/** `{ symbol: url }` for the history reads: crude stocks 25 months back (the 2-year line), the rest 14
 *  months back (the week a year ago, with room for a late release). */
export function historyUrls(today) {
  const long = monthStartBefore(today, 25)
  const short = monthStartBefore(today, 14)
  if (!long || !short) return {}
  return Object.fromEntries(OIL_SYMBOLS.map((s) => [s, `/api/econ/series/${s}?start=${s === LINE_SYMBOL ? long : short}`]))
}

/** 'Wed Nov 18' (with the year when it is not this year's). */
export const dayWords = (iso, today) => (isDay(iso) ? `${weekdayOf(iso)} ${shortDate(iso, { nowIso: today })}` : '')

// ── units ────────────────────────────────────────────────────────────────────────────────────────

/** A unit the shared formatter does not print itself: a pump price reads '$3.123/gal'. */
const UNIT_TAIL = Object.freeze({ 'USD/gal': '/gal' })

const unitsOf = (meta) => (isObj(meta) && isObj(meta.units) ? meta.units : {})

/** A series' `units.scale` (thousands of barrels -> barrels); 1 when it does not say. */
export function scaleOf(meta) {
  const s = Number(unitsOf(meta).scale)
  return Number.isFinite(s) && s > 0 ? s : 1
}

// thousands below a million, millions above (the shared ladder decides the suffix)
const BBL_TIERS = Object.freeze([Object.freeze({ at: 1e6, suffix: 'M', decimals: 1 }), Object.freeze({ at: 1e3, suffix: 'K', decimals: 0 })])
// barrels a day: the same ladder, two decimals in millions (13,812 thousand a day reads 13.81M, as traders quote it)
const BPD_TIERS = Object.freeze([Object.freeze({ at: 1e6, suffix: 'M', decimals: 2 }), Object.freeze({ at: 1e3, suffix: 'K', decimals: 0 })])

/**
 * The value in its own units, through the shared formatters, with the unit the formatter does not print.
 * Barrels a day (production, `num0` in thousands) read on the barrels' K/M ladder, '13.81M bbl/d': written
 * out ('13,812,000') it is the one word too long to break in a 340px phone's table. null for no figure.
 */
export function oilValueText(v, meta) {
  if (unitsOf(meta).display === 'bbl/d') return Number.isFinite(v) ? `${formatCompact(v * scaleOf(meta), { tiers: BPD_TIERS })} bbl/d` : null
  const t = valueText(v, meta)
  if (t == null) return null
  const tail = UNIT_TAIL[unitsOf(meta).display]
  return tail ? `${t}${tail}` : t
}
// always in millions; two decimals under 100,000 barrels, so a small change never reads "0.0"
const MILLION_TIER = Object.freeze([Object.freeze({ at: 1e6, suffix: '', decimals: (m) => (m < 1e5 ? 2 : 1) })])

/** A signed number of barrels (already in barrels): '+1.2M bbl', '-450K bbl', 'unchanged'. null for no figure. */
export function signedBarrels(bbl) {
  if (!Number.isFinite(bbl)) return null
  const r = Math.round(bbl)
  if (r === 0) return 'unchanged'
  return `${r > 0 ? '+' : ''}${formatCompact(r, { tiers: BBL_TIERS })} bbl`
}

/** A size in barrels as million barrels, without a sign: '2.3 million barrels', '0.04 million barrels'. */
export function millionBarrels(bbl) {
  if (!Number.isFinite(bbl)) return null
  return `${formatCompact(Math.abs(bbl), { tiers: MILLION_TIER, fixedUnit: true })} million barrels`
}

/** A weekly change of stocks in words: 'build' (stocks rose), 'draw' (they fell), 'no change'. null for no figure. */
export function buildDrawWord(v) {
  if (!Number.isFinite(v)) return null
  return v > 0 ? 'build' : v < 0 ? 'draw' : 'no change'
}

/**
 * The change from an earlier week in the series' own units:
 *   barrels (stocks)             '+1.2M bbl' / '-450K bbl'
 *   a rate (utilization)         '+0.8 pts'   (economyModel changeOf)
 *   barrels a day (production)   '+22K bbl/d'
 *   dollars a gallon             '+$0.031/gal'
 * 'unchanged' for no change; null without two real figures.
 */
export function oilChangeText(latest, earlier, meta) {
  if (!Number.isFinite(latest) || !Number.isFinite(earlier)) return null
  const fmt = String(unitsOf(meta).fmt || '')
  if (/^(pct|pp|bps)/.test(fmt)) return changeOf(latest, earlier, meta)?.text ?? null
  // every series here is published to three decimals or fewer: a float's dust is not a change
  const dv = Math.round((latest - earlier) * 1000) / 1000
  if (dv === 0) return 'unchanged'
  if (fmt === 'mbbl') return signedBarrels(dv * scaleOf(meta))
  return `${dv > 0 ? '+' : '-'}${oilValueText(Math.abs(dv), meta)}`
}

// ── reading the answers ──────────────────────────────────────────────────────────────────────────

const STATES = ['ok', 'no_data', 'not_found']

/** The latest read's rows by symbol: `{ symbol: { state, meta, points, currentness, retrievedAt } }`, or null (not the shape). */
export function latestBySymbol(body) {
  if (!isObj(body) || !Array.isArray(body.series)) return null
  const columns = Array.isArray(body.columns) && body.columns.length ? body.columns : undefined
  const out = {}
  for (const raw of body.series) {
    if (!isObj(raw) || typeof raw.symbol !== 'string' || !raw.symbol.trim()) continue
    const symbol = raw.symbol.trim().toUpperCase()
    if (out[symbol]) continue
    out[symbol] = {
      symbol,
      state: STATES.includes(raw.state) ? raw.state : 'not_found',
      meta: isObj(raw.meta) ? raw.meta : null,
      points: pointsOf(raw.points, columns),
      currentness: isObj(raw.currentness) ? raw.currentness : null,
      retrievedAt: Number.isInteger(raw.retrieved_at) ? raw.retrieved_at : null,
    }
  }
  return out
}

/** A history read's points (oldest first), or null when the body is not that series' answer. */
export function historyPoints(body, symbol) {
  if (!isObj(body) || !Array.isArray(body.points)) return null
  if (typeof body.symbol === 'string' && body.symbol.toUpperCase() !== symbol) return null
  const columns = Array.isArray(body.columns) && body.columns.length ? body.columns : undefined
  return pointsOf(body.points, columns)
}

/** History and the latest read's newest points as one list, one point per week, oldest first. The latest
 *  read wins a week both hold (it is the fresher of the two reads). */
export function mergePoints(history, latest) {
  const by = new Map()
  for (const p of [...(history || []), ...(latest || [])]) {
    if (!p || !isDay(p.pe)) continue
    by.set(`${p.ps || ''}|${p.pe}`, p)
  }
  return [...by.values()].sort((a, b) => a.pe.localeCompare(b.pe) || String(a.ps).localeCompare(String(b.ps)))
}

/**
 * One history read as a state, for a series the latest read says is held:
 *   'ok'        its points came (a later refresh that failed keeps them)
 *   'loading'   still out
 *   'not_held'  a 404: the feature is on (the latest read answered), so the series' history is not held
 *   'failed'    any other failure, or an answer that is not the series' shape
 * `read` = { wanted, body, error, loading }; a series not wanted is 'ok' (its row says why it has no figures).
 */
export function historyStateOf(read, symbol) {
  if (!read || !read.wanted) return 'ok'
  if (read.body && historyPoints(read.body, symbol)) return 'ok'
  if (read.error) return read.error.status === 404 ? 'not_held' : 'failed'
  if (read.body) return 'failed'
  return read.loading ? 'loading' : 'ok'
}

/** Whether each history read is wanted: only for a series the latest read says is held. */
export function wantedHistory(latest) {
  const by = latestBySymbol(latest) || {}
  return Object.fromEntries(OIL_SYMBOLS.map((s) => [s, by[s]?.state === 'ok']))
}

// ── one row ──────────────────────────────────────────────────────────────────────────────────────

/** The point nearest `day` (by period end) within `tolerance` days, or null. A point the EIA published no
 *  figure for is still returned: it is the week asked for, and it says "no figure". */
export function pointNear(points, day, tolerance = MATCH_DAYS) {
  if (!isDay(day)) return null
  let best = null
  let gap = Infinity
  for (const p of points || []) {
    if (!p || !isDay(p.pe)) continue
    const d = Math.abs(daysBetween(p.pe, day))
    if (d <= tolerance && d < gap) { best = p; gap = d }
  }
  return best
}

/** The week before the newest: the latest earlier point, if it ends 7 days earlier (give or take MATCH_DAYS). */
export function weekBeforeOf(points, last) {
  if (!last || !isDay(last.pe)) return null
  const earlier = (points || []).filter((p) => p && isDay(p.pe) && p.pe < last.pe)
  const p = earlier[earlier.length - 1]
  if (!p) return null
  const d = daysBetween(p.pe, last.pe)
  return d >= 7 - MATCH_DAYS && d <= 7 + MATCH_DAYS ? p : null
}

/** The same week a year ago: the point ending 52 weeks (364 days) before the newest, give or take MATCH_DAYS. */
export const yearAgoOf = (points, last) => (last && isDay(last.pe) ? pointNear(points, addDays(last.pe, -YEAR_DAYS)) : null)

const NOT_HELD = { not_found: 'Not among the economic series this server publishes.', no_data: 'No reading published here yet.' }
const YEAR_AGO_WORDS = {
  not_held: 'Not held for a year ago',
  loading: 'Reading the week a year ago',
  failed: 'The week a year ago could not be read just now',
}

/**
 * One table row from its spec, the latest read's row and the merged points (history + latest).
 * `history` is that series' history state (historyStateOf): it decides the words for a year ago not shown.
 */
export function oilRow(spec, series, points, { today = null, history = 'ok' } = {}) {
  const base = {
    key: spec.key, label: spec.label, symbol: spec.symbol, buildDraw: !!spec.buildDraw,
    chartHref: chartsLinkPath({ symbol: `ECON:${spec.symbol}` }),
  }
  if (!series || series.state === 'not_found') return { ...base, state: 'not_found', words: NOT_HELD.not_found }
  const meta = series.meta || {}
  const common = {
    ...base, meta, retrievedAt: series.retrievedAt, derived: isObj(meta.derivation),
    next: nextReleaseOf(series.currentness, today), note: releaseNote(series.currentness),
  }
  const pts = (points || []).filter((p) => p && isDay(p.pe))
  if (series.state === 'no_data' || !pts.length) return { ...common, state: 'no_data', words: NOT_HELD.no_data }
  // a build or draw reads as a signed number of barrels; every other figure in its own units
  const figure = (v) => (spec.buildDraw ? signedBarrels(Number.isFinite(v) ? v * scaleOf(meta) : null) : oilValueText(v, meta))
  const word = (v) => (spec.buildDraw ? buildDrawWord(v) : null)
  const last = pts[pts.length - 1]
  const latest = {
    value: num(last.v), text: figure(last.v), period: periodText(last, meta), released: releasedText(last, today), t: last.t, word: word(last.v),
  }
  const wb = weekBeforeOf(pts, last)
  const prior = wb ? { value: num(wb.v), text: figure(wb.v), period: periodText(wb, meta), word: word(wb.v) } : null
  const ya = yearAgoOf(pts, last)
  const yearAgo = ya
    ? {
      state: 'ok', value: num(ya.v), text: figure(ya.v), period: `${periodText(ya, meta)}, ${ya.pe.slice(0, 4)}`, word: word(ya.v),
      change: spec.buildDraw ? null : oilChangeText(last.v, ya.v, meta),
    }
    : { state: history === 'ok' ? 'not_held' : history, words: YEAR_AGO_WORDS[history === 'ok' ? 'not_held' : history] || YEAR_AGO_WORDS.failed }
  return {
    ...common,
    state: 'ok',
    latest,
    prior,
    // a change of a weekly change is noise, never shown: the build-or-draw row says build or draw instead
    change: !spec.buildDraw && wb ? oilChangeText(last.v, wb.v, meta) : null,
    yearAgo,
  }
}

// ── the top line ─────────────────────────────────────────────────────────────────────────────────

const NEXT_WORDS = 'next release not held'

/** The first next release held among `seriesList` (the calendar's own date, with its weekday), or the words for none. */
function nextOf(seriesList, today) {
  const all = seriesList.filter(Boolean).map((s) => nextReleaseOf(s.currentness, today))
  const ok = all.find((n) => n.state === 'ok')
  if (ok) return { ...ok, when: `${weekdayOf(ok.date)} ${ok.text}` }
  return all.find((n) => n.state === 'passed') || { state: 'not_held', text: NEXT_WORDS }
}

/**
 * A next release as a sentence, never today unless the calendar says today:
 *   'Next EIA weekly petroleum report: Wed Nov 25, 10:30 AM ET.'
 *   'EIA weekly petroleum report: was due Nov 18; not confirmed yet.'
 *   'EIA weekly petroleum report: next release not held.'
 */
export function nextSentence(what, next) {
  const cap = `${what.charAt(0).toUpperCase()}${what.slice(1)}`
  if (next?.state === 'ok') return `Next ${what}: ${next.when || next.text}.`
  if (next?.state === 'passed') return `${cap}: ${next.text.charAt(0).toLowerCase()}${next.text.slice(1)}.`
  return `${cap}: ${NEXT_WORDS}.`
}

/**
 * The week's crude build or draw, from the econ service's own weekly change (USCRUDEINVCHG):
 *   { state: 'ok', headline: 'Draw of 2.3 million barrels', word, week: 'the week to Fri Nov 13',
 *     released: 'Wed Nov 18', derived, next, pumpNext }
 *   { state: 'not_found' | 'no_data' | 'no_figure', words, next, pumpNext }
 * `next` is the next weekly petroleum report from the release calendar; `pumpNext` the next pump price survey.
 */
export function reportHead(by, points, today) {
  const ch = by[SYM.change]
  const next = nextOf([by[SYM.crude], ch], today)
  const pumpNext = nextOf([by[SYM.gasPrice], by[SYM.dieselPrice]], today)
  const shell = { next, pumpNext, note: releaseNote((by[SYM.crude] || ch)?.currentness) }
  if (!ch || ch.state === 'not_found') {
    return { ...shell, state: 'not_found', words: 'The weekly change in crude oil stocks is not among the economic series this server publishes.' }
  }
  const pts = (points || []).filter((p) => p && isDay(p.pe))
  if (ch.state === 'no_data' || !pts.length) return { ...shell, state: 'no_data', words: 'No weekly change in crude oil stocks is published here yet.' }
  const last = pts[pts.length - 1]
  const week = `the week to ${dayWords(last.pe, today)}`
  const released = Number.isFinite(last.t) ? dayWords(etDateOf(last.t), today) : ''
  const derived = isObj(ch.meta) && isObj(ch.meta.derivation)
  if (!Number.isFinite(last.v)) return { ...shell, state: 'no_figure', words: `No figure for ${week}.`, week, released, derived }
  const bbl = last.v * scaleOf(ch.meta)
  const word = buildDrawWord(last.v)
  const headline = word === 'no change' ? 'No change in crude oil stocks' : `${word === 'build' ? 'Build' : 'Draw'} of ${millionBarrels(bbl)}`
  return { ...shell, state: 'ok', headline, word, value: last.v, barrels: bbl, week, released, derived, t: last.t }
}

// ── the line ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Crude stocks, one value per week for the newest week and the LINE_WEEKS before it, on the series' own
 * weekly grid (each week ends on the same weekday): `{ rows: [{ date, v | null }], gaps, end }`. A week not
 * held, or one the EIA published no figure for, is null: a gap in the line, never 0. null with no points.
 */
export function stocksLine(points, { weeks = LINE_WEEKS } = {}) {
  const pts = (points || []).filter((p) => p && isDay(p.pe))
  if (!pts.length) return null
  const end = pts[pts.length - 1].pe
  const byDay = new Map(pts.map((p) => [p.pe, p]))
  const rows = []
  for (let i = weeks; i >= 0; i--) {
    const date = addDays(end, -7 * i)
    const p = byDay.get(date)
    rows.push({ date, v: p && Number.isFinite(p.v) ? p.v : null })
  }
  return { rows, gaps: rows.filter((r) => r.v == null).length, end }
}

/**
 * One line laid out in a `w` x `h` box: RATES' spread picture (ratesModel.spreadGeometry) with the
 * `withZero` option LIQ adds there (same name, same default). It lives here, not in ratesModel.js, so two
 * branches in flight do not edit that file; once LIQ is merged this is ratesModel's `spreadGeometry`.
 *   path, zeroY (null when zero is outside the range drawn), min, max, first / last / low / high: { date, v }
 * `withZero: false` draws the line's own range: crude stocks sit far from zero and would otherwise be a flat
 * line along the top. null when fewer than two dates have a figure.
 */
export function lineGeometry(history, key, { w = 320, h = 120, padX = 2, padY = 8, withZero = true } = {}) {
  const dates = history?.dates || []
  const vals = history?.[key] || []
  const have = dates.map((d, i) => ({ date: d, v: vals[i] })).filter((p) => p.date && p.v != null)
  if (have.length < 2) return null
  let low = have[0]
  let high = have[0]
  for (const p of have) {
    if (p.v < low.v) low = p
    if (p.v > high.v) high = p
  }
  const min = withZero ? Math.min(low.v, 0) : low.v
  const max = withZero ? Math.max(high.v, 0) : high.v
  const span = max - min || 1
  const n = dates.length
  const x = (i) => padX + (n > 1 ? i / (n - 1) : 0) * (w - 2 * padX)
  const y = (v) => padY + (1 - (v - min) / span) * (h - 2 * padY)
  const points = dates.map((d, i) => (d && vals[i] != null ? { x: x(i), y: y(vals[i]) } : null))
  return {
    w, h, min, max, path: pathThrough(points), zeroY: min <= 0 && max >= 0 ? r1(y(0)) : null, days: have.length,
    first: have[0], last: have[have.length - 1], low, high,
  }
}

/** The line's picture (its own range, never forced through zero) and its words. null with fewer than two values. */
export function stocksPicture(line, meta, today) {
  if (!line) return null
  const geo = lineGeometry({ dates: line.rows.map((r) => r.date), v: line.rows.map((r) => r.v) }, 'v', { withZero: false })
  if (!geo) return null
  const d = (iso) => shortDate(iso, { nowIso: today })
  const fig = (v) => oilValueText(v, meta)
  const total = line.rows.length
  const gapWords = line.gaps
    ? `${line.gaps} of ${total} weeks have no figure here, and the line breaks there.`
    : `All ${total} weeks have a figure.`
  const words = `Crude oil stocks excluding the SPR, weekly, week to ${d(geo.first.date)} to week to ${d(geo.last.date)}: `
    + `low ${fig(geo.low.v)} (week to ${d(geo.low.date)}), high ${fig(geo.high.v)} (week to ${d(geo.high.date)}), `
    + `latest ${fig(geo.last.v)}. ${gapWords}`
  return { ...geo, words, gapWords, fromText: d(geo.first.date), toText: d(geo.last.date), rangeText: `${fig(geo.min)} to ${fig(geo.max)}` }
}

// ── the whole panel ──────────────────────────────────────────────────────────────────────────────

/**
 * The reads -> the panel: `{ state, head, groups, line, credits, newestT, historyFailed }`.
 *   latest        the latest read's body
 *   histories     `{ symbol: points | null }` (null = not read yet, or not that series' answer)
 *   historyState  `{ symbol: 'ok' | 'loading' | 'not_held' | 'failed' }` (historyStateOf)
 *   line          `{ state: 'ok' | 'loading' | 'failed' | 'not_held' | 'too_few', picture }`
 * `state` 'bad_shape' for a latest answer that is not the route's shape (drawn as a failed read).
 */
export function oilRead({ latest, histories = {}, historyState = {}, today = null } = {}) {
  const by = latestBySymbol(latest)
  if (!by) return { state: 'bad_shape', head: null, groups: [], line: null, credits: [], newestT: null, historyFailed: false }
  const merged = (s) => mergePoints(histories[s] || null, by[s]?.points || [])
  const groups = OIL_GROUPS.map((g) => ({
    key: g.key,
    title: g.title,
    rows: g.rows.map((spec) => oilRow(spec, by[spec.symbol], merged(spec.symbol), { today, history: historyState[spec.symbol] || 'ok' })),
  }))
  const rows = groups.flatMap((g) => g.rows)
  const crude = by[LINE_SYMBOL]
  let line
  if (!crude || crude.state !== 'ok') line = { state: 'not_held' }
  else {
    const hs = historyState[LINE_SYMBOL] || 'ok'
    if (hs !== 'ok') line = { state: hs }
    else {
      const picture = stocksPicture(stocksLine(merged(LINE_SYMBOL)), crude.meta, today)
      line = picture ? { state: 'ok', picture } : { state: 'too_few' }
    }
  }
  const shown = rows.filter((r) => r.state === 'ok')
  const ts = shown.map((r) => r.latest.t).filter(Number.isFinite)
  return {
    state: 'ok',
    head: reportHead(by, merged(SYM.change), today),
    groups,
    line,
    credits: creditLines(shown.map((r) => ({ ...r, alt: null })), latest.attributions, { today }),
    newestT: ts.length ? Math.max(...ts) : null,
    historyFailed: OIL_SYMBOLS.some((s) => historyState[s] === 'failed'),
  }
}

/** A failed latest read in words: the ECON board's (the same data and gate), with OIL's own hint when the feature is off. */
export function oilFailure(err) {
  const f = econFailure(err)
  if (f.state !== 'off') return f
  return {
    ...f,
    hint: "The EIA's weekly oil figures this panel shows (stocks, production, refining, pump prices) are not served here right now. Nothing is wrong with your account.",
  }
}

/** A failed or missing line in words (the latest read answered, so the feature is on). */
export function lineWords(state) {
  if (state === 'not_held') return 'The history of crude oil stocks is not held here, so there is no line to draw.'
  if (state === 'too_few') return 'Fewer than two weeks of crude oil stocks are held, so there is no line to draw.'
  return 'The history of crude oil stocks could not be read just now.'
}
