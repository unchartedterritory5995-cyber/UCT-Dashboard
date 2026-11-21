// LIQ's pure half: the liquidity panel's reads -> what the panel draws. No React.
//
// Two existing econ routes (api/routers/econ.py over api/services/econ/serving.py), the same flag
// (`ECON_ENABLED`: 404 when the economic data is switched off for this server) and the same gate
// (`require_bars_access`: 401 signed out, 403 a plan without chart data) as the ECON board:
//   GET /api/econ/latest?symbols=...      the newest three points of each part, its registry meta
//                                         (units with their format and scale), currentness (the
//                                         next release) and every source's credit line
//   GET /api/econ/series/{symbol}?start=  the history behind the two-year line (the Fed's assets,
//                                         the H.4.1 TGA, reverse repo) and a few weeks of the two
//                                         daily parts (the Treasury's daily TGA, SOFR), so each
//                                         part's 1-week change has the print a week before
// The history reads go out only for a series the latest read says is held, so a 404 from one of
// them means that series, not the feature.
//
// NET LIQUIDITY is a UCT calculation, never the registry's `USNETLIQ` (unverified, not served):
//   on each H.4.1 Wednesday W:  the Fed's total assets (USFEDBAL, Wednesday level)
//                             - the Treasury General Account (USTGAFED, H.4.1 Wednesday level)
//                             - overnight reverse repo take-up (USRRP) on W itself, or, when there
//                               is no print that day, on the nearest earlier day within
//                               RRP_LOOKBACK_DAYS calendar days (the panel says which day was used)
// Each input is converted to dollars with its own `units.scale` (the Fed's figures are in millions,
// reverse repo in dollars). A Wednesday with any input missing has NO value: a gap in the line,
// never 0, and every change that needs it is words.
//
// ⛔ A MISSING VALUE IS NEVER 0. ⛔ NO FORECAST AND NO ADVICE: the one sentence reads the direction
// from the numbers. ⛔ Every amount goes through the shared formatters (the econ unit grammar over
// formatCompact); nothing here formats a number by hand.
import { formatSeriesValue } from '../../../components/chart/engine/fundamentalFormat'
import { frequencyOf } from '../../../components/chart/engine/economicSource'
import { shortDate } from '../../../components/chart/economic/econUi'
import { chartsLinkPath } from '../../../lib/chartDeepLink'
import {
  ECON_POLL_MS, changeOf, creditLines, econFailure, nextReleaseOf, periodText, pointsOf, releaseNote,
  valueText, weekdayOf,
} from './economyModel'
import { spreadGeometry } from './ratesModel'

export const LIQ_CODE = 'LIQ'
export const LIQ_SOURCE = 'Federal Reserve Board (H.4.1, H.6), Federal Reserve Bank of New York and U.S. Treasury (Daily Treasury Statement)'
/** The econ service serves from a two-minute cache, as for ECON. */
export const LIQ_POLL_MS = ECON_POLL_MS
/** How the calculation is labelled wherever it shows. */
export const NET_LABEL = "UCT calculation from the Fed's and Treasury's own figures"
/** The line covers this many weeks back from the newest H.4.1 Wednesday (105 Wednesdays). */
export const LINE_WEEKS = 104
/** The changes shown under the headline, in weeks. */
export const CHANGE_WEEKS = Object.freeze([1, 4, 13, 52])
/** The sentence reads this change. */
export const SENTENCE_WEEKS = 4
/** Reverse repo for a Wednesday without a print: the nearest earlier print within this many days. */
export const RRP_LOOKBACK_DAYS = 3
/** A daily part's "1 week before": the print on or before the day a week earlier, at most this many days before it. */
export const WEEK_LOOKBACK_DAYS = 3

const SYM = Object.freeze({
  assets: 'USFEDBAL', tgaWeekly: 'USTGAFED', tgaDaily: 'USTGA', rrp: 'USRRP',
  reserves: 'USRESBAL', m2: 'USM2', m2yoy: 'USM2YOY', sofr: 'USSOFR',
})
export const LIQ_SYMBOLS = Object.freeze(Object.values(SYM))
export const LIQ_LATEST_URL = `/api/econ/latest?symbols=${LIQ_SYMBOLS.join(',')}`
/** History reads: the three inputs of the line over two years, the two daily parts over a few weeks. */
export const LINE_SYMBOLS = Object.freeze([SYM.assets, SYM.tgaWeekly, SYM.rrp])
export const SHORT_SYMBOLS = Object.freeze([SYM.tgaDaily, SYM.sofr])

/**
 * One row per part, in reading order. `change` is the span the change covers. The TGA's daily
 * figure (the Treasury's own statement) sits on the row after the H.4.1 one, with its own date.
 */
export const PARTS = Object.freeze([
  Object.freeze({ key: 'assets', label: 'Fed total assets', symbol: SYM.assets }),
  Object.freeze({ key: 'tga_weekly', label: 'Treasury General Account (H.4.1, Wednesday)', symbol: SYM.tgaWeekly }),
  Object.freeze({ key: 'tga_daily', label: "Treasury General Account (the Treasury's daily statement)", symbol: SYM.tgaDaily }),
  Object.freeze({ key: 'rrp', label: 'Overnight reverse repo (ON RRP)', symbol: SYM.rrp }),
  Object.freeze({ key: 'reserves', label: 'Reserve balances', symbol: SYM.reserves }),
  Object.freeze({ key: 'm2', label: 'M2 money supply', symbol: SYM.m2, alt: SYM.m2yoy }),
  Object.freeze({ key: 'sofr', label: 'SOFR', symbol: SYM.sofr }),
])

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const dayMs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
const pad2 = (n) => String(n).padStart(2, '0')
const isoOf = (ms) => {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

/** `iso` moved by `n` calendar days. */
export const addDays = (iso, n) => isoOf(dayMs(iso) + n * 86400000)

/** The first day of the month `months` before the month of `today` (a URL that stays the same all month). */
export function monthStartBefore(today, months) {
  if (!isDay(today)) return null
  const y = +today.slice(0, 4)
  const m = +today.slice(5, 7) - 1 - months
  return isoOf(Date.UTC(y, m, 1))
}

/** The two-year line's reads start 25 months back (two years of Wednesdays plus the days before the first). */
export const historyStart = (today) => monthStartBefore(today, 25)
/** The daily parts' reads start two months back (a week before the newest print, with room for holidays). */
export const shortStart = (today) => monthStartBefore(today, 2)

/** `{ symbol: url }` for the five history reads. */
export function historyUrls(today) {
  const long = historyStart(today)
  const short = shortStart(today)
  if (!long || !short) return {}
  const out = {}
  for (const s of LINE_SYMBOLS) out[s] = `/api/econ/series/${s}?start=${long}`
  for (const s of SHORT_SYMBOLS) out[s] = `/api/econ/series/${s}?start=${short}`
  return out
}

/** 'Wed Nov 18' (with the year when it is not this year's). */
export const dayWords = (iso, today) => (isDay(iso) ? `${weekdayOf(iso)} ${shortDate(iso, { nowIso: today })}` : '')

/** A dollar amount (already in dollars) in the econ grammar: '$5.83T', '$412.50B'. */
export const usdText = (usd) => formatSeriesValue(usd, 'usd_compact')

/** A signed dollar change: '+$12.30B', '-$4.00B', 'unchanged'. */
export function signedUsd(usd) {
  if (!Number.isFinite(usd)) return null
  if (usd === 0) return 'unchanged'
  return usd > 0 ? `+${usdText(usd)}` : usdText(usd)
}

/** A series' `units.scale` (to dollars for a dollar series); 1 when it does not say. */
export function scaleOf(meta) {
  const s = isObj(meta) && isObj(meta.units) ? Number(meta.units.scale) : NaN
  return Number.isFinite(s) && s > 0 ? s : 1
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

/** A series read's points (oldest first), or null when the body is not that series. */
export function historyPoints(body, symbol) {
  if (!isObj(body) || !Array.isArray(body.points)) return null
  if (typeof body.symbol === 'string' && body.symbol.toUpperCase() !== symbol) return null
  const columns = Array.isArray(body.columns) && body.columns.length ? body.columns : undefined
  return pointsOf(body.points, columns)
}

/** History and the latest read's newest points as one list, one point per period, oldest first. The
 *  latest read wins a period both hold (it is the fresher of the two reads). */
export function mergePoints(history, latest) {
  const by = new Map()
  for (const p of [...(history || []), ...(latest || [])]) {
    if (!p || !isDay(p.pe)) continue
    by.set(`${p.ps || ''}|${p.pe}`, p)
  }
  return [...by.values()].sort((a, b) => a.pe.localeCompare(b.pe) || String(a.ps).localeCompare(String(b.ps)))
}

/** `{ day (period end): value }` of the points with a real value (an agency's "no figure" is left out). */
function valuesByDay(points) {
  const m = new Map()
  for (const p of points || []) if (Number.isFinite(p.v)) m.set(p.pe, p.v)
  return m
}

/** The value on `day`, else on the nearest earlier day within `back` days: `{ v, day, shifted }` or null. */
export function valueOnOrBefore(byDay, day, back) {
  for (let i = 0; i <= back; i++) {
    const d = addDays(day, -i)
    if (byDay.has(d)) return { v: byDay.get(d), day: d, shifted: i > 0 }
  }
  return null
}

// ── net liquidity ────────────────────────────────────────────────────────────────────────────────

const INPUT_WORDS = { assets: "the Fed's total assets", tga: 'the TGA (H.4.1)', rrp: 'reverse repo' }

/**
 * The net liquidity line: one row per Wednesday from `weeks` weeks before the newest H.4.1 Wednesday
 * (the newest period the Fed's assets hold) to it, oldest first.
 *   rows   [{ date, net (dollars | null), assets, tga, rrp (dollars | null), rrpDay, rrpShifted, missing: [input words] }]
 *   end    the newest H.4.1 Wednesday; gaps: how many rows have no value; shifted: rows whose reverse
 *          repo came from an earlier day
 * null when the Fed's assets hold no Wednesday at all.
 * `inputs` = { assets, tga, rrp }, each { points, meta } (points from `mergePoints`).
 */
export function netLiquidityLine(inputs, { weeks = LINE_WEEKS } = {}) {
  const a = inputs?.assets
  const wed = (a?.points || []).filter((p) => isDay(p.pe) && weekdayOf(p.pe) === 'Wed')
  if (!wed.length) return null
  const end = wed[wed.length - 1].pe
  const sa = scaleOf(a.meta)
  const st = scaleOf(inputs?.tga?.meta)
  const sr = scaleOf(inputs?.rrp?.meta)
  const A = valuesByDay(a.points)
  const T = valuesByDay(inputs?.tga?.points)
  const R = valuesByDay(inputs?.rrp?.points)
  const rows = []
  for (let k = weeks; k >= 0; k--) {
    const date = addDays(end, -7 * k)
    const av = A.has(date) ? A.get(date) * sa : null
    const tv = T.has(date) ? T.get(date) * st : null
    const r = valueOnOrBefore(R, date, RRP_LOOKBACK_DAYS)
    const rv = r ? r.v * sr : null
    const missing = []
    if (av == null) missing.push(INPUT_WORDS.assets)
    if (tv == null) missing.push(INPUT_WORDS.tga)
    if (rv == null) missing.push(INPUT_WORDS.rrp)
    rows.push({
      date, assets: av, tga: tv, rrp: rv, rrpDay: r ? r.day : null, rrpShifted: !!r?.shifted,
      net: missing.length ? null : av - tv - rv, missing,
    })
  }
  return {
    end, rows, weeks,
    gaps: rows.filter((r) => r.net == null).length,
    shifted: rows.filter((r) => r.net != null && r.rrpShifted).length,
  }
}

/** The newest row with a value (the headline), or null. */
export const headlineRow = (line) => (line ? [...line.rows].reverse().find((r) => r.net != null) || null : null)

/**
 * The change over each span, measured from the headline Wednesday back to the Wednesday exactly that
 * many weeks before it: `[{ weeks, from, value (dollars | null), text, why }]`. A span whose earlier
 * Wednesday has no value (or lies before the line) is words, never 0.
 */
export function netChanges(line, { spans = CHANGE_WEEKS, today = null } = {}) {
  const head = headlineRow(line)
  const by = new Map((line?.rows || []).map((r) => [r.date, r]))
  return spans.map((n) => {
    if (!head) return { weeks: n, from: null, value: null, text: 'n/a', why: 'No Wednesday has a value.' }
    const from = addDays(head.date, -7 * n)
    const was = by.get(from)
    if (!was || was.net == null) {
      const when = dayWords(from, today)
      const why = !was ? `${when} is before the line.` : `No value for ${when}: ${was.missing.join(', ')} not held.`
      return { weeks: n, from, value: null, text: 'n/a', why }
    }
    const value = head.net - was.net
    return { weeks: n, from, value, text: signedUsd(value), why: null }
  })
}

const verb = (d, plural = false) => (d > 0 ? `rose ${usdText(d)}` : d < 0 ? `fell ${usdText(-d)}` : plural ? 'were unchanged' : 'was unchanged')

/**
 * The one plain sentence: the direction over SENTENCE_WEEKS weeks, built from the numbers.
 * "Net liquidity rose $X over 4 weeks (Feb 19 to Mar 19): the Fed's assets fell $A, the TGA fell $B and
 * reverse repo fell $C." null when the change cannot be worked out. Never a forecast.
 */
export function directionSentence(line, today, weeks = SENTENCE_WEEKS) {
  const head = headlineRow(line)
  if (!head) return null
  const from = addDays(head.date, -7 * weeks)
  const was = (line.rows || []).find((r) => r.date === from)
  if (!was || was.net == null) return null
  const span = `${shortDate(from, { nowIso: today })} to ${shortDate(head.date, { nowIso: today })}`
  return `Net liquidity ${verb(head.net - was.net)} over ${weeks} weeks (${span}): `
    + `the Fed's assets ${verb(head.assets - was.assets, true)}, the TGA ${verb(head.tga - was.tga)} `
    + `and reverse repo ${verb(head.rrp - was.rrp)}.`
}

/** The line's picture (RATES' spread picture, its own range) and its words. null with fewer than two values. */
export function netPicture(line, today) {
  if (!line) return null
  const geo = spreadGeometry({ dates: line.rows.map((r) => r.date), net: line.rows.map((r) => r.net) }, 'net', { withZero: false })
  if (!geo) return null
  const d = (iso) => shortDate(iso, { nowIso: today })
  const total = line.rows.length
  const gapWords = line.gaps
    ? `${line.gaps} of ${total} Wednesdays have no value, and the line breaks there.`
    : `All ${total} Wednesdays have a value.`
  const words = `Net liquidity, weekly, ${d(geo.first.date)} to ${d(geo.last.date)}: `
    + `low ${usdText(geo.low.v)} on ${d(geo.low.date)}, high ${usdText(geo.high.v)} on ${d(geo.high.date)}, `
    + `now ${usdText(geo.last.v)}. ${gapWords}`
  return { ...geo, words, gapWords, fromText: d(geo.first.date), toText: d(geo.last.date) }
}

// ── the parts ────────────────────────────────────────────────────────────────────────────────────

const NOT_HELD = { not_found: 'Not among the economic series this server publishes.', no_data: 'No reading published here yet.' }

const PREV_MONTH = (ps) => {
  if (!isDay(ps)) return null
  return isoOf(Date.UTC(+ps.slice(0, 4), +ps.slice(5, 7) - 2, 1))
}

/** A part's change in its own units: basis points for a rate (changeOf), dollars for a dollar level. */
export function partChangeText(latest, prior, meta) {
  if (!Number.isFinite(latest) || !Number.isFinite(prior)) return null
  const fmt = isObj(meta) && isObj(meta.units) ? String(meta.units.fmt || '') : ''
  if (/^(pct|pp|bps)/.test(fmt)) return changeOf(latest, prior, meta)?.text ?? null
  const dv = latest - prior
  if (dv === 0) return 'unchanged'
  return dv > 0 ? `+${valueText(dv, meta)}` : valueText(dv, meta)
}

/**
 * The print a span before the newest: a monthly series the month before; any other the print on or
 * before the day a week earlier (WEEK_LOOKBACK_DAYS more days back at most, for a holiday).
 *   { over: '1 week' | '1 month', point } | { over, point: null }
 */
export function priorFor(points, last, frequency) {
  const real = (points || []).filter((p) => Number.isFinite(p.v) && isDay(p.pe))
  if (frequency === 'M') {
    const want = PREV_MONTH(last.ps)
    return { over: '1 month', point: real.find((p) => p.ps === want) || null }
  }
  const target = addDays(last.pe, -7)
  const hit = valueOnOrBefore(new Map(real.map((p) => [p.pe, p])), target, WEEK_LOOKBACK_DAYS)
  return { over: '1 week', point: hit ? hit.v : null }
}

/** The day a part's figure is for, in words: 'Wed Mar 19' for a day or a week, 'Jan 2031' for a month. */
const periodWords = (p, meta, today) => (frequencyOf(meta) === 'M' ? periodText(p, meta) : dayWords(p.pe, today))
/** The same, shorter, for the "since" under a change: 'Mar 12' (no weekday: the column is narrow). */
const sinceWords = (p, meta, today) => (frequencyOf(meta) === 'M' ? periodText(p, meta) : shortDate(p.pe, { nowIso: today }))

/** One part row from its spec, the latest read's row, the merged points and (M2) the year-over-year row. */
export function partRow(spec, series, points, { today = null, alt = null, altPoints = null, historyFailed = false } = {}) {
  const base = { key: spec.key, label: spec.label, symbol: spec.symbol, chartHref: chartsLinkPath({ symbol: `ECON:${spec.symbol}` }) }
  if (!series || series.state === 'not_found') return { ...base, state: 'not_found', words: NOT_HELD.not_found }
  const meta = series.meta || {}
  const common = {
    ...base, meta, retrievedAt: series.retrievedAt, next: nextReleaseOf(series.currentness, today), note: releaseNote(series.currentness),
  }
  const pts = (points || []).filter((p) => isDay(p.pe))
  if (series.state === 'no_data' || !pts.length) return { ...common, state: 'no_data', words: NOT_HELD.no_data }
  const last = pts[pts.length - 1]
  const freq = frequencyOf(meta)
  const prior = priorFor(pts, last, freq)
  const change = Number.isFinite(last.v) && prior.point ? partChangeText(last.v, prior.point.v, meta) : null
  let altView = null
  if (alt && alt.state === 'ok') {
    const a = (altPoints || []).filter((p) => Number.isFinite(p.v)).pop()
    if (a) altView = { text: valueText(a.v, alt.meta), period: periodText(a, alt.meta), meta: alt.meta, label: 'y/y' }
  }
  return {
    ...common,
    state: 'ok',
    latest: { value: Number.isFinite(last.v) ? last.v : null, text: valueText(last.v, meta), when: periodWords(last, meta, today), t: last.t },
    change: change
      ? { text: change, over: prior.over, since: sinceWords(prior.point, meta, today) }
      : {
        text: null,
        over: prior.over,
        why: !Number.isFinite(last.v) ? 'The newest period has no figure.'
          : historyFailed ? 'The history for this change could not be read just now.'
            : `No print ${prior.over} earlier is held here.`,
      },
    alt: altView,
  }
}

// ── the whole panel ──────────────────────────────────────────────────────────────────────────────

/**
 * The reads -> the panel: `{ state, parts, net, credits, newestT }`.
 *   latest     the latest read's body; `histories` `{ symbol: points | null }` (null = not read, or not
 *              that series); `lineState` 'ok' | 'loading' | 'failed' | 'not_held' for the line's reads.
 *   net        { state: 'ok' | 'loading' | 'failed' | 'not_held', missing (input words not held),
 *                line, head, changes, sentence, picture, next, note }
 * `state` 'bad_shape' for a latest answer that is not the route's shape (drawn as a failed read).
 */
export function liquidityRead({ latest, histories = {}, historyFailed = {}, lineState = 'ok', today = null } = {}) {
  const by = latestBySymbol(latest)
  if (!by) return { state: 'bad_shape', parts: [], net: null, credits: [], newestT: null }
  const merged = (s) => mergePoints(histories[s] || null, by[s]?.points || [])
  const parts = PARTS.map((spec) => partRow(spec, by[spec.symbol], merged(spec.symbol), {
    today, alt: spec.alt ? by[spec.alt] : null, altPoints: spec.alt ? merged(spec.alt) : null, historyFailed: !!historyFailed[spec.symbol],
  }))
  const missingInputs = [['assets', SYM.assets], ['tga', SYM.tgaWeekly], ['rrp', SYM.rrp]]
    .filter(([, s]) => by[s]?.state !== 'ok').map(([k]) => INPUT_WORDS[k])
  const assets = by[SYM.assets]
  const net = { state: lineState, missing: missingInputs, next: nextReleaseOf(assets?.currentness, today), note: releaseNote(assets?.currentness) }
  if (missingInputs.length) net.state = 'not_held'
  if (net.state === 'ok') {
    const line = netLiquidityLine({
      assets: { points: merged(SYM.assets), meta: assets?.meta },
      tga: { points: merged(SYM.tgaWeekly), meta: by[SYM.tgaWeekly]?.meta },
      rrp: { points: merged(SYM.rrp), meta: by[SYM.rrp]?.meta },
    })
    const head = headlineRow(line)
    Object.assign(net, {
      line, head,
      changes: netChanges(line, { today }),
      sentence: directionSentence(line, today),
      picture: netPicture(line, today),
      newestGap: line && head && head.date !== line.end ? line.rows[line.rows.length - 1] : null,
    })
    if (!head) net.state = 'no_value'
  }
  const shown = parts.filter((p) => p.state === 'ok')
  const ts = shown.map((p) => p.latest.t).filter(Number.isFinite)
  const creditRows = shown.map((p) => ({ ...p, alt: p.alt ? { meta: p.alt.meta } : null }))
  return {
    state: 'ok',
    parts,
    net,
    credits: creditLines(creditRows, latest.attributions, { today }),
    newestT: ts.length ? Math.max(...ts) : null,
  }
}

/** Whether each history read is wanted: only for a series the latest read says is held. */
export function wantedHistory(latest) {
  const by = latestBySymbol(latest) || {}
  return Object.fromEntries([...LINE_SYMBOLS, ...SHORT_SYMBOLS].map((s) => [s, by[s]?.state === 'ok']))
}

/** The line's reads as one state: 'loading' while any is out, 'not_held' for a 404 (the series, since the
 *  latest read answered), 'failed' for any other failure, else 'ok'. `reads` = [{ wanted, body, error, loading }]. */
export function lineReadState(reads) {
  if (reads.some((r) => r.wanted && r.error && r.error.status === 404 && !r.body)) return 'not_held'
  if (reads.some((r) => r.wanted && r.error && !r.body)) return 'failed'
  if (reads.some((r) => r.wanted && r.loading)) return 'loading'
  return 'ok'
}

/** A failed latest read in words: the ECON board's (the same data and gate), with LIQ's own hint when the feature is off. */
export function liqFailure(err) {
  const f = econFailure(err)
  if (f.state !== 'off') return f
  return {
    ...f,
    hint: "The Fed's balance sheet, the Treasury's cash account and the reverse repo figures this panel works from are not served here right now. Nothing is wrong with your account.",
  }
}

/** A failed history read in words (the latest read answered, so the feature is on). */
export function lineFailureText(state) {
  if (state === 'not_held') return 'Net liquidity cannot be worked out: the history of one of its inputs is not held here.'
  return 'The history behind net liquidity could not be read just now.'
}
