// UCT Agent — terminal data wave 6: five LOCAL-ONLY answers (the Agent half of the SEAS, SEASB, TIDEH, OIC and RATES
// terminal panels).
//
//   stock.seasonality        one stock by calendar month and by weekday, close to close: the years counted, the median and the
//                            average month, how often the month rose, and a flag on a month with too few years
//   stock.seasonalityBoard   the index funds and the sector funds by calendar month, for this month and the next
//   stock.tideHistory        Market Tide by finished session: net call premium, net put premium and their net, newest first
//   stock.oiChange           one stock's open interest by contract between the two newest files of UCT's options log
//   stock.treasuryYields     US Treasury daily par yields by maturity, their changes, and the two curve spreads
//
// DATA: ONE gateway read each (`seasonality.stock`, `seasonality.board`, `options.tideHistory`, `options.oiChange`,
// `rates.treasury`; api/services/uct_agent/marketdata/, MD-1 §4.15). No read of this wave starts a build, a fetch, a capture
// or a vendor request: each is answered only from what the server already holds, so each can say "not held".
// Rows are shaped by the matching panel's own pure helpers (pages/terminal/panels/: seasonalityBoardModel
// `seasonalityBoardRead` / `boardFacts` / `pctText` / `upCount`, tideHistoryModel `tideHistoryRead` / `sumOver`, oiChangeModel
// `oiChangeRead` / `limitNotes`, ratesModel `ratesRead` / `spreadSentence`), so the panel and the Agent read one shape. A
// measure, a scope and a side are read by the panel's own word maps (SEAS_MEASURE_ARG_WORDS, TIDE_SCOPE_ARG_WORDS,
// OI_SIDE_ARG_WORDS): there is one map each, the panel's, and none here.
// HONESTY: the date an answer states is the DATA'S OWN (the newest bar in the record, the newest stored session, the newer
// log file's date, the curve's date), with the time UCT read or stored it beside it: never today, and never live or now
// (MD-1 §3). A failed read is never "nothing to show": a record that is not held, a board that is not built, a pair of files
// that is not prepared and a read that failed are never "no pattern", "no flow", "no change" or "no figure". A number that
// does not exist is never 0: a month nobody counted, a session with no stored row, a new contract's change, a maturity with
// no figure and a change with no reference day are each said as missing. A list that is cut says so and from which end.
// GROUNDING: the text is templated from `facts` (returned beside it): every number in it is a fact's.
// ⛔ LOCAL ONLY (turn.LOCAL_ONLY_ACTIONS; all five kinds are model-isolated, ADR-005): the model plans the lookup and never
// sees what came back. Every capability in THIS module is local-only: the isolation rail (qa/modelIsolation.test.jsx) holds
// the whole module to that.
//
// Dark by construction: each is registered only while the server serves its own kind (UCT_AGENT_DATA_KINDS, fail closed; an
// isolated kind also needs its own UCT_AGENT_ISOLATED_KINDS entry or every read is refused).
// ROUTING: the five share ONE words-only group, `marketRecords` (routing.js lists them by action: the stock `data` group their
// domain names has no room under the routing budget, and waves 3 to 5 hold their own groups at their sizes). It is the 48th
// group, the last of the 48 the server kept then (turn.MAX_GROUPS; wave 7 raised it). Each one's own words (WAVE6_ROUTE_WORDS) are added to that group only
// while it is registered, so on a dark server the group has no words and no registered action, and routing is
// byte-identical to the base.
import { registerCapability } from '../capabilities'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { GROUPS } from '../routing'
import { stampET } from './marketDataFacts'
import {
  SEAS_MEASURES, parseSeasMeasure, seasonalityBoardRead, boardFacts, pctText, upCount, monthLong, SEASB_SOURCE,
} from '../../pages/terminal/panels/seasonalityBoardModel'
import {
  TIDE_SCOPES, TIDE_ROWS_SHOWN, TIDE_SESSIONS_ASKED, TIDE_SUM_WINDOWS, TIDE_MISSING_NAMED, TIDE_HISTORY_SOURCE, parseTideScope,
  tideHistoryRead, sumOver, premiumText, printsLine, leftOutText, dayWords as tideDayWords,
} from '../../pages/terminal/panels/tideHistoryModel'
import {
  OI_SIDES, OI_ROWS_SHOWN, OI_CHANGE_SOURCE, parseOiSide, oiChangeRead, limitNotes, changeLines, contractText, expiryText,
  countText, sideTotalText, tradingDayWords, dayWords as oiDayWords,
} from '../../pages/terminal/panels/oiChangeModel'
import {
  HORIZONS, SOURCE as RATES_SOURCE, ratesRead, yieldText, bpText, pointsText, spreadSentence, spreadTrendSentence,
} from '../../pages/terminal/panels/ratesModel'
import { kindServed, usable, noRead, whole, plural, andList, dayText, NO_TURN } from './terminalDataFormat'

export const KINDS = Object.freeze({
  seasonality: 'seasonality.stock', board: 'seasonality.board', tide: 'options.tideHistory', oi: 'options.oiChange', treasury: 'rates.treasury',
})
export const CAPABILITIES = Object.freeze({
  seasonality: 'stock.seasonality', board: 'stock.seasonalityBoard', tide: 'stock.tideHistory', oi: 'stock.oiChange', treasury: 'stock.treasuryYields',
})
const NONE_STATED = 'No figure is stated.'
const TEXT_ROWS = 5
const PRESENT_ROWS = 12
const DESCRIPTIVE = 'Descriptive only: nothing here is a prediction.'
const TICKER = /^[A-Z]{1,5}(?:[.-][A-Z]{1,2})?$/
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const upper = (s) => String(s || '').trim().toUpperCase().replace(/^\$/, '')
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const clamp = (v, max, fallback) => (Number.isInteger(v) ? Math.min(Math.max(v, 1), max) : fallback)
const isoDay = (v) => (typeof v === 'string' && ISO_DAY.test(v) ? v : null)
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)
/** "Fri, Nov 13, 2026" → "Nov 13, 2026" */
const shortDay = (ymd) => (dayText(ymd) || '').replace(/^\w+, /, '') || null
const years = (n) => `${n} ${n === 1 ? 'year' : 'years'}`
/** A member's or the planner's word → a key of `keys`, by the panel's OWN word map; `fallback` for no word; null for none. */
function wordOf(raw, keys, parse, fallback) {
  if (raw == null || raw === '') return fallback
  if (typeof raw !== 'string') return null
  const key = raw.trim().toLowerCase()
  return own(keys, key) ? key : parse(raw)
}
const readAtLine = (read, by) => (read ? `${by} at ${read} (UCT's own time).` : 'The answer carries no read time, so I cannot say how old it is.')

// ── stock.seasonality ──────────────────────────────────────────────────────────────────────────────────────────────────
export const SEASONALITY_RECORD = 'A record of the past, not a forecast.'
const SEASONALITY_SOURCE = `Source: ${SEASB_SOURCE}, close to close. ${SEASONALITY_RECORD}`
const COMPLETED_ONLY = 'Completed sessions only: a session still trading is not in the record, and the month still running is not counted as a month.'
/** A weekday's average day, two decimals with its sign: "+0.11%", "-0.04%", "0.00%", or null. */
const dayPct = (v) => (num(v) == null ? null : Number(v.toFixed(2)) === 0 ? '0.00%' : `${v > 0 ? '+' : '-'}${Math.abs(v).toFixed(2)}%`)
/** "up 7 of 10 years", or "up 70% of 10 years" when the count cannot be recovered exactly; null when nothing was counted. */
function upYears(pctUp, n) {
  if (!n || num(pctUp) == null) return null
  const k = upCount(pctUp, n)
  return k != null ? `up ${k} of ${years(n)}` : `up ${Math.round(pctUp)}% of ${years(n)}`
}
/** One calendar month of one record, as the answer states it (a month nobody counted has no figure, never 0). */
function monthFact(m, minYears) {
  const n = Number.isInteger(m?.n) && m.n > 0 ? m.n : 0
  const median = n ? num(m.median_pct) : null
  const average = n ? num(m.avg_pct) : null
  const up = n ? num(m.pct_up) : null
  return {
    month: m.month, name: monthLong(m.month), years: n, median_pct: median, median_text: median == null ? null : pctText(median),
    average_pct: average, average_text: average == null ? null : pctText(average), pct_up: up, up_years: n ? upCount(up, n) : null,
    up_text: upYears(up, n), thin: n > 0 && (m.thin === true || n < minYears),
  }
}
function monthLine(f, minYears) {
  if (!f.years) return `• ${f.name}: no full month on record`
  if (f.median_text == null) return `• ${f.name}: ${years(f.years)} counted, no figure`
  const figures = `median ${f.median_text}${f.average_text ? `, average ${f.average_text}` : ''}`
  if (f.thin) return `• ${f.name}: ${figures} over ${years(f.years)} (fewer than ${minYears} years: too few to read as a pattern)`
  return `• ${f.name}: ${figures}${f.up_text ? `, ${f.up_text}` : ''}`
}

/** Pure: a `seasonality.stock` envelope → the answer. */
export function answerFromSeasonality(envl, symbol) {
  const none = `${NONE_STATED} That is not the same as no pattern.`
  if (!usable(envl)) {
    return { text: noRead(`${symbol}'s seasonality`, envl, `the daily bars it needs are not held in full on the server at the moment (this answer never starts a read of a stock's history), or the read failed. Open ${symbol}'s seasonality (SEAS) in UCT, then ask again`, none) }
  }
  const d = envl.data
  const last = isoDay(d.last_bar)
  const first = isoDay(d.first_bar)
  const minYears = Number.isInteger(d.min_years) && d.min_years > 0 ? d.min_years : null
  const raw = Array.isArray(d.months) ? d.months.filter(m => m && Number.isInteger(m.month) && m.month >= 1 && m.month <= 12) : []
  if (!last || !first || !minYears || raw.length !== 12 || new Set(raw.map(m => m.month)).size !== 12) {
    return { text: `I couldn't read ${symbol}'s seasonality: UCT's data did not answer cleanly. ${none}` }
  }
  const months = [...raw].sort((a, b) => a.month - b.month).map(m => monthFact(m, minYears))
  const weekdays = (Array.isArray(d.weekdays) ? d.weekdays : []).filter(w => w && typeof w.label === 'string').map(w => {
    const n = Number.isInteger(w.n) && w.n > 0 ? w.n : 0
    const average = n ? num(w.avg_pct) : null
    return { label: w.label, days: n, average_pct: average, average_text: dayPct(average), pct_up: n ? num(w.pct_up) : null }
  })
  const counted = months.filter(f => f.years >= minYears && !f.thin && f.median_pct != null)
  let best = null
  let worst = null
  for (const f of counted) {
    if (!best || f.median_pct > best.median_pct) best = f
    if (!worst || f.median_pct < worst.median_pct) worst = f
  }
  const ranked = counted.length >= 2 && best.median_pct !== worst.median_pct
  const thin = months.filter(f => f.thin).length
  const empty = months.filter(f => !f.years).length
  const expected = isoDay(d.latest_completed_session)
  const read = stampET(d.read_at, envl.fetched_at)
  const facts = {
    symbol, first_bar: first, last_bar: last, last_day: dayText(last), sessions: Number.isInteger(d.sessions) ? d.sessions : null,
    full_months: Number.isInteger(d.full_months) ? d.full_months : null, min_years: minYears, covered_from: isoDay(d.covered_from), covered_to: isoDay(d.covered_to),
    latest_completed_session: expected, pre_vendor_floor: d.pre_vendor_floor === true, read, stale: !!envl.stale, months, weekdays,
    thin_months: thin, empty_months: empty, highest_median: ranked ? best.name : null, lowest_median: ranked ? worst.name : null,
  }
  const lines = [`${symbol} by calendar month, close to close, from the daily bars UCT holds, ${shortDay(first)} to ${shortDay(last)}${facts.full_months != null ? ` (${plural(facts.full_months, 'full month')})` : ''}:`]
  for (const f of months) lines.push(monthLine(f, minYears))
  if (ranked) lines.push(`Of the months with ${minYears} or more years counted, the highest median is ${best.name} (${best.median_text}) and the lowest is ${worst.name} (${worst.median_text}).`)
  if (thin) lines.push(`${thin} of the twelve months ${thin === 1 ? 'has' : 'have'} fewer than ${minYears} years counted: too few years to read as a pattern.`)
  const days = weekdays.filter(w => w.average_text)
  if (days.length) lines.push(`By weekday, the average close-to-close day: ${days.map(w => `${w.label} ${w.average_text}`).join(', ')}.`)
  if (facts.pre_vendor_floor) lines.push('The record starts before Sep 10, 2003: the bars before that date come from a second history source (yfinance), the later ones from UCT\'s market-data vendor.')
  if (envl.stale) lines.push(`Stale: the newest daily bar held is ${shortDay(last)}${expected ? `, and the newest completed session is ${shortDay(expected)}` : ''}. This answer never fetches the missing sessions.`)
  lines.push(`The record ends at the close of ${dayText(last)}. ${COMPLETED_ONLY}`)
  lines.push(readAtLine(read, 'Computed by UCT from bars already held,'))
  lines.push(SEASONALITY_SOURCE)
  return {
    text: lines.join('\n'),
    table: {
      columns: [{ key: 'month', label: 'Month' }, { key: 'years', label: 'Years counted' }, { key: 'median', label: 'Median month' }, { key: 'average', label: 'Average month' }, { key: 'up', label: 'Years it rose' }],
      rows: months.map(f => ({ month: f.name, years: String(f.years), median: f.median_text || 'not given', average: f.average_text || 'not given',
        up: f.up_years != null ? `${f.up_years} of ${f.years}` : f.pct_up != null ? `${Math.round(f.pct_up)}%` : 'not given' })),
    },
    present: {
      kind: 'metrics', title: `${symbol} seasonality, through ${shortDay(last)}`, short: `${symbol} seasonality`,
      items: months.filter(f => f.median_text).slice(0, PRESENT_ROWS).map(f => ({ label: f.name, value: f.median_text, note: f.thin ? `${years(f.years)}, too few` : `median, ${years(f.years)}`, aka: [f.name.toLowerCase()] })),
    },
    facts,
  }
}

export async function answerSeasonality(args = {}) {
  const symbol = upper(args.symbol).replace('.', '-')
  if (!TICKER.test(symbol)) return { text: `Which stock's seasonality should I read? Give me one ticker. ${NONE_STATED}` }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${symbol}'s seasonality: ${NO_TURN}.` }
  const envl = await readData('seasonality.stock', { symbol }, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromSeasonality(envl, symbol)
}

// ── stock.seasonalityBoard ─────────────────────────────────────────────────────────────────────────────────────────────
export const BOARD_MEASURE_KEYS = Object.keys(SEAS_MEASURES)           // median | average: the SEASB panel's own
export const DEFAULT_BOARD_MEASURE = 'median'
/** Why a fund has no numbers, by the board's own status (the kind's adapter holds the same words: a rail pins the two). */
export const BOARD_WITHOUT_WORDS = Object.freeze({
  pending: 'its history is still being read', not_held: 'the bar store does not carry it', unavailable: 'its read failed or holds too little',
})
/** A member's or the planner's word for a measure → the panel's key, by the panel's OWN word map. Pure. */
export const measureOf = (raw) => wordOf(raw, SEAS_MEASURES, parseSeasMeasure, DEFAULT_BOARD_MEASURE)

function boardCell(cell) {
  return { years: cell.n, value_pct: cell.value, text: cell.value == null ? null : cell.text, thin: cell.thin, up_text: cell.tone === 'thin' || cell.value == null ? null : cell.sub }
}
function boardLine(row, cell, monthName, minYears) {
  const who = row.name ? `${row.symbol} (${row.name})` : row.symbol
  if (cell.value_pct == null) return `• ${who}: ${cell.years ? `${years(cell.years)} counted, no figure` : `no full ${monthName} on record`}`
  if (cell.thin) return `• ${who}: ${cell.text} over ${years(cell.years)} (fewer than ${minYears} years: too few to read as a pattern)`
  return `• ${who}: ${cell.text}${cell.up_text ? `, ${cell.up_text}` : ''}`
}

/** Pure: a `seasonality.board` envelope → the answer. `measure` is a key of the panel's SEAS_MEASURES. */
export function answerFromBoard(envl, measure = DEFAULT_BOARD_MEASURE) {
  const none = `${NONE_STATED} That is not the same as no pattern.`
  if (!usable(envl)) {
    return { text: noRead('the seasonality board', envl, 'none is held on the server at the moment (it is built when the seasonality board is opened, and this answer never builds it), or the read failed. Open the seasonality board (SEASB) in UCT, then ask again', none) }
  }
  const d = envl.data
  const view = seasonalityBoardRead(d, measure)                       // the kind's data keeps the route's own names
  const through = isoDay(d.data_through)
  if ((view.state !== 'ready' && view.state !== 'partial') || !through || !own(SEAS_MEASURES, measure)) {
    return { text: `I couldn't read the seasonality board: UCT's data did not answer cleanly. ${none}` }
  }
  const word = SEAS_MEASURES[measure].word
  const now = monthLong(view.thisMonth)
  const next = monthLong(view.nextMonth)
  const rows = view.rows.map(r => ({ symbol: r.symbol, name: r.name, kind: r.kind, since: r.since, this_month: boardCell(r.cells[0]), next_month: boardCell(r.cells[1]) }))
  const without = view.without.map(w => ({ symbol: w.symbol, status: own(BOARD_WITHOUT_WORDS, w.status) ? w.status : 'unavailable', reason: w.reason }))
  const best = boardFacts(d)                                          // always the median, by the panel's own rules
  const read = stampET(d.read_at, envl.fetched_at)
  const facts = {
    month: view.thisMonth, month_name: now, next_month: view.nextMonth, next_month_name: next, measure, measure_word: word, min_years: view.minYears,
    funds: view.funds, with_numbers: rows.length, data_through: through, data_through_day: dayText(through), read, stale: !!envl.stale, settled: view.settled,
    rows, without, best: best.best, weakest: best.worst, left_out: best.leftOut, no_best: best.why,
  }
  const lines = [`Seasonality board, ${rows.length === view.funds ? `all ${view.funds}` : `${rows.length} of the ${view.funds}`} index and sector funds by calendar month, close to close, from the daily bars UCT holds through ${shortDay(through)}.`,
    `${now} by fund, the ${word} ${now} with how many of the years counted it rose:`]
  for (const r of rows) lines.push(boardLine(r, r.this_month, now, view.minYears))
  for (const line of [best.best, best.worst, best.leftOut, best.why]) if (line) lines.push(line)
  if (without.length) {
    lines.push(`${plural(without.length, 'fund')} of the ${view.funds} ${without.length === 1 ? 'has' : 'have'} no numbers and ${without.length === 1 ? 'is' : 'are'} left out, never shown as zeros: ${without.map(w => `${w.symbol} (${BOARD_WITHOUT_WORDS[w.status]})`).join(', ')}.`)
  }
  if (!view.settled) lines.push('The board is unfinished: a fund\'s history was still being read, or its read failed, when it was built. The seasonality board in UCT reads it again; this answer never does.')
  lines.push(`The board covers daily bars through ${dayText(through)}; the month still running is not counted as a month.`)
  lines.push(readAtLine(read, 'Built by UCT'))
  lines.push(SEASONALITY_SOURCE)
  return {
    text: lines.join('\n'),
    table: {
      columns: [{ key: 'fund', label: 'Fund' }, { key: 'name', label: 'Name' }, { key: 'now', label: `${now} (${word})` }, { key: 'now_up', label: `${now}: years it rose` },
        { key: 'next', label: `${next} (${word})` }, { key: 'next_up', label: `${next}: years it rose` }, { key: 'since', label: 'Record since' }],
      rows: rows.map(r => ({ fund: r.symbol, name: r.name || 'not given', now: r.this_month.text || 'not given', now_up: r.this_month.up_text || (r.this_month.years ? years(r.this_month.years) : 'not given'),
        next: r.next_month.text || 'not given', next_up: r.next_month.up_text || (r.next_month.years ? years(r.next_month.years) : 'not given'), since: r.since || 'not given' })),
    },
    present: {
      kind: 'metrics', title: `Seasonality board, ${now} (${word})`, short: 'Seasonality board',
      items: rows.filter(r => r.this_month.text).slice(0, PRESENT_ROWS).map(r => ({ label: r.symbol, value: r.this_month.text, note: r.this_month.thin ? `${years(r.this_month.years)}, too few` : (r.this_month.up_text || now), aka: [r.symbol.toLowerCase()] })),
    },
    facts,
  }
}

export async function answerBoard(args = {}) {
  const measure = measureOf(args.measure)
  if (!measure) return { text: `Which figure should I read the seasonality board by? ${BOARD_MEASURE_KEYS.map(k => SEAS_MEASURES[k].label).join(', ')}. ${NONE_STATED}` }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the seasonality board: ${NO_TURN}.` }
  const envl = await readData('seasonality.board', {}, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromBoard(envl, measure)
}

// ── stock.tideHistory ──────────────────────────────────────────────────────────────────────────────────────────────────
export const TIDE_SCOPE_KEYS = Object.keys(TIDE_SCOPES)                // all | stocks | etfs: the TIDEH panel's own
export const DEFAULT_TIDE_SCOPE = 'all'
export const TIDE_DEFAULT_ROWS = TIDE_ROWS_SHOWN                       // the TIDEH panel's own first draw
export const TIDE_MAX_ROWS = TIDE_SESSIONS_ASKED                       // the route's own ceiling
/** A member's or the planner's word for a scope → the panel's key, by the panel's OWN word map. Pure. */
export const scopeOf = (raw) => wordOf(raw, TIDE_SCOPES, parseTideScope, DEFAULT_TIDE_SCOPE)

/** Pure: an `options.tideHistory` envelope → the answer. */
export function answerFromTide(envl) {
  const none = `${NONE_STATED} That is not the same as no flow.`
  if (!usable(envl)) {
    return { text: noRead('the Market Tide history', envl, 'no finished session is stored on the server yet (one is stored after each close, and this answer never captures one), or the read failed', none) }
  }
  const d = envl.data
  const view = tideHistoryRead(d)                                     // the kind's data keeps the route's own names
  if (view.state !== 'ok' || !view.latest || !view.began) return { text: `I couldn't read the Market Tide history: UCT's data did not answer cleanly. ${none}` }
  const sessions = view.rows.map(r => ({
    session: r.session, net: r.net, net_text: r.net == null ? null : premiumText(r.net), net_call: r.netCall, net_call_text: r.netCall == null ? null : premiumText(r.netCall),
    net_put: r.netPut, net_put_text: r.netPut == null ? null : premiumText(r.netPut), prints: r.prints, unsigned: r.unsigned, unreadable: r.unreadable,
  }))
  // a sum is offered only where the rows read can carry it: never "too few stored" when the member asked for fewer rows
  const sums = (view.rows.length < 2 ? [] : TIDE_SUM_WINDOWS.filter(n => view.rows.length >= n || view.stored <= view.rows.length).map(n => sumOver(view, n)))
    .map(s => ({ sessions: s.n, ok: s.ok, sum: s.ok ? s.sum : null, sum_text: s.ok ? s.figure : null, from: s.ok ? s.from : null, to: s.ok ? s.to : null, label: s.label, text: s.text }))
  const missingTotal = Math.max(Number.isInteger(d.missing_total) ? d.missing_total : 0, view.missing.length)
  const shown = Math.min(TEXT_ROWS, view.rows.length)
  const read = stampET(d.read_at, envl.fetched_at)
  const facts = {
    scope: view.scope, scope_words: TIDE_SCOPES[view.scope].words, stored: view.stored, read_rows: view.rows.length, shown, left_out: Math.max(view.stored - view.rows.length, 0),
    began: view.began, latest: view.latest, latest_day: dayText(view.latest), read, stale: !!envl.stale, backfill: view.backfill, missing: view.missing, missing_total: missingTotal,
    sessions, sums,
  }
  const lines = [`Market Tide by finished session, ${TIDE_SCOPES[view.scope].words}: ${view.stored === 1 ? `1 session is stored, ${shortDay(view.began)}` : `${whole(view.stored)} sessions are stored, ${shortDay(view.began)} to ${shortDay(view.latest)}`}.`,
    shown >= view.stored ? `${view.stored === 1 ? 'The one stored session' : `All ${whole(view.stored)} stored sessions`}, newest first:` : `The newest ${shown} of the ${whole(view.stored)} stored sessions, newest first (the older ones are left out):`]
  for (const r of view.rows.slice(0, shown)) {
    const left = leftOutText(r)
    lines.push(`• ${dayText(r.session)}: ${r.net == null ? 'net not given' : `net ${premiumText(r.net)}`} (net call premium ${premiumText(r.netCall)}, net put premium ${premiumText(r.netPut)}), ${r.prints == null ? 'prints not given' : printsLine(r)}${left ? `, ${left}` : ''}`)
  }
  for (const s of sums) lines.push(`${s.label}: ${s.text}${s.ok ? '.' : ''}`)
  if (missingTotal) {
    const named = view.missing.slice(-TIDE_MISSING_NAMED).map(tideDayWords)
    lines.push(missingTotal <= TIDE_MISSING_NAMED && missingTotal === view.missing.length
      ? `No tide was stored for ${andList(named)}: ${missingTotal === 1 ? 'that session is' : 'those sessions are'} missing, never a zero.`
      : `No tide was stored for ${whole(missingTotal)} trading sessions between the first and the last stored day (the newest: ${named.join(', ')}): they are missing, never zeros.`)
  }
  if (view.rows.slice(0, shown).some(r => r.unreadable > 0)) lines.push('Prints the tape could not read are left out of that session\'s figures.')
  if (!view.backfill) lines.push(`There is no backfill: the history starts on ${shortDay(view.began)}, the first session UCT stored.`)
  if (envl.stale) lines.push(`Stale: the newest stored session is ${shortDay(view.latest)} and a later session has finished. This answer never captures one.`)
  lines.push(`Each row is a finished session; the newest is ${dayText(view.latest)}. This is not the tide of a session still trading.`)
  lines.push(readAtLine(read, 'The newest row was stored by UCT'))
  lines.push(`Source: ${TIDE_HISTORY_SOURCE}. ${DESCRIPTIVE}`)
  return {
    text: lines.join('\n'),
    table: {
      columns: [{ key: 'session', label: 'Session' }, { key: 'net', label: 'Net premium' }, { key: 'call', label: 'Net call premium' }, { key: 'put', label: 'Net put premium' }, { key: 'prints', label: 'Prints' }],
      rows: sessions.map(s => ({ session: shortDay(s.session), net: s.net_text || 'not given', call: s.net_call_text || 'not given', put: s.net_put_text || 'not given', prints: whole(s.prints) || 'not given' })),
    },
    present: {
      kind: 'metrics', title: `Market Tide by session, through ${shortDay(view.latest)}`, short: 'Market Tide history',
      items: sessions.filter(s => s.net_text).slice(0, PRESENT_ROWS).map(s => ({ label: tideDayWords(s.session), value: s.net_text, note: 'net premium', aka: [s.session] })),
    },
    facts,
  }
}

export async function answerTide(args = {}) {
  const scope = scopeOf(args.scope)
  if (!scope) return { text: `Which part of the options tape should I read the Market Tide history for? ${TIDE_SCOPE_KEYS.map(k => TIDE_SCOPES[k].label).join(', ')}. ${NONE_STATED}` }
  const params = { scope, rows: clamp(args.rows, TIDE_MAX_ROWS, TIDE_DEFAULT_ROWS) }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the Market Tide history: ${NO_TURN}.` }
  const envl = await readData('options.tideHistory', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromTide(envl)
}

// ── stock.oiChange ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const OI_SIDE_KEYS = Object.keys(OI_SIDES)                      // any | call | put: the OIC panel's own
export const DEFAULT_OI_SIDE = 'any'
export const OI_DEFAULT_ROWS = OI_ROWS_SHOWN                           // the OIC panel's own first draw
export const OI_MAX_ROWS = 50                                          // the service's own ceiling (a rail pins it to the kind's)
/** A side in words (the kind's adapter holds the same words: a rail pins the two). */
export const OI_SIDE_WORDS = Object.freeze({ any: 'calls and puts', call: 'calls only', put: 'puts only' })
/** A member's or the planner's word for a side → the panel's key, by the panel's OWN word map. Pure. */
export const sideOf = (raw) => wordOf(raw, OI_SIDES, parseOiSide, DEFAULT_OI_SIDE)

/** Pure: an `options.oiChange` envelope → the answer. */
export function answerFromOi(envl, symbol) {
  const none = `${NONE_STATED} That is not the same as no change.`
  if (!usable(envl)) {
    return { text: noRead(`${symbol}'s open interest change`, envl, `the two newest files of UCT's options log are not prepared on the server at the moment (the open interest change panel prepares them, and this answer never does), or the log holds fewer than two days, or the read failed. Open ${symbol}'s open interest change (OIC) in UCT, then ask again`, none) }
  }
  const d = envl.data
  const view = oiChangeRead({ ...d, status: 'ok' })                   // the kind's data keeps the route's own names
  const read = stampET(d.read_at, envl.fetched_at)
  const source = `Source: ${OI_CHANGE_SOURCE}. ${DESCRIPTIVE}`
  if (view.state === 'unknown') {
    return {
      text: [`${symbol} has no contract in either of the two newest files of UCT's options log (${shortDay(view.session)} and ${shortDay(view.priorSession)}): no contract of it had an ask, open interest or volume in either. That is a statement about those two files, not a failed read, and it is not zero open interest.`,
        readAtLine(read, 'Put together by UCT'), source].join('\n'),
      facts: { symbol, known: false, session: view.session, prior_session: view.priorSession, side: view.side, read, stale: !!envl.stale, rows: [] },
    }
  }
  if (view.state !== 'ok') return { text: `I couldn't read ${symbol}'s open interest change: UCT's data did not answer cleanly. ${none}` }
  const noun = OI_SIDES[view.side].noun
  const rows = view.rows.map(r => ({
    contract: r.contract, expiration: r.expiration, strike: r.strike, type: r.type, kind: r.kind, open_interest: r.oi,
    // a new contract has no earlier figure: no change and no percent, never 0
    prior_open_interest: r.priorOi, change: r.change, change_text: r.kind === 'new' ? null : changeLines(r)[0], change_pct: r.changePct, volume: view.volumePresent ? r.volume : null,
    label: `${expiryText(r.expiration, view.session)} ${contractText(r)}`,
  }))
  const sides = view.side === 'any' ? ['call', 'put'] : [view.side]
  const total = (t) => (t.contracts && t.change != null ? { contracts: t.contracts, open_interest: t.oi, prior_open_interest: t.priorOi, change: t.change } : { contracts: 0, open_interest: null, prior_open_interest: null, change: null })
  const shown = Math.min(TEXT_ROWS, rows.length)
  const facts = {
    symbol, known: true, side: view.side, side_words: OI_SIDE_WORDS[view.side], session: view.session, session_day: dayText(view.session), prior_session: view.priorSession,
    skipped_sessions: view.skipped, read, stale: !!envl.stale, matched: view.matched, read_rows: rows.length, shown, left_out: Math.max(view.matched - rows.length, 0),
    calls: total(view.call), puts: total(view.put), compared: view.compared, unchanged: view.unchanged,
    new_contracts: view.fresh.contracts, new_open_interest: view.fresh.contracts ? view.fresh.oi : null,
    gone_contracts: view.gone.contracts, gone_prior_open_interest: view.gone.contracts ? view.gone.priorOi : null, gone_expired: view.gone.expired, not_reported: view.notReported,
    volume_present: view.volumePresent, volume_session: view.volumePresent ? view.volumeSession : null, rows,
  }
  const lines = [`${symbol} open interest change, ${OI_SIDE_WORDS[view.side]}: UCT's options log of ${dayText(view.session)} against ${shortDay(view.priorSession)}.`]
  const trading = tradingDayWords(view)
  if (trading) lines.push(trading)
  for (const s of sides) lines.push(`${s === 'call' ? 'Calls' : 'Puts'}: ${sideTotalText(s === 'call' ? view.call : view.put, s)}.`)
  if (view.compared) lines.push(`${countText(view.unchanged)} of the ${countText(view.compared)} contracts in both records did not change.`)
  if (!rows.length) {
    lines.push(`No ${noun} changed and none is new between the two records.`)
  } else {
    lines.push(shown >= view.matched ? `${view.matched === 1 ? `The one changed or new ${noun}` : `All ${countText(view.matched)} changed or new ${noun}s`}, biggest first by number of contracts:`
      : `The ${shown} biggest of the ${countText(view.matched)} changed or new ${noun}s, by number of contracts (the smaller ones are left out):`)
    for (const r of view.rows.slice(0, shown)) {
      const head = `${expiryText(r.expiration, view.session)} ${contractText(r)}`
      if (r.kind === 'new') { lines.push(`• ${head}: new, ${countText(r.oi)} open interest, not in the earlier record`); continue }
      const [chg, pc] = changeLines(r)
      const vol = view.volumePresent && r.volume != null ? `, ${countText(r.volume)} traded on ${oiDayWords(view.volumeSession)}` : ''
      lines.push(`• ${head}: ${chg} (${pc}), ${countText(r.oi)} open interest, was ${countText(r.priorOi, 'not given')}${vol}`)
    }
  }
  const prior = oiDayWords(view.priorSession)
  for (const n of limitNotes(view, symbol)) {
    // the panel's own sentences, but its "new" one says "now": said here against the newer record instead (MD-1 §3)
    if (n.key !== 'new') { lines.push(n.text); continue }
    lines.push(`${countText(view.fresh.contracts)} ${view.fresh.contracts === 1 ? 'contract is' : 'contracts are'} new: not in the ${prior} record, holding ${countText(view.fresh.oi)} open interest in the newer one. A new contract has no earlier figure, so it is stated as new, never as a change from 0, and is left out of the totals.`)
  }
  if (rows.length && !view.volumePresent) lines.push('Volume is not stated: the earlier record carries none.')
  if (envl.stale) lines.push(`Stale: the newest file of the options log is ${shortDay(view.session)} and a later session has finished. This answer never fetches a newer file.`)
  lines.push(`This compares two stored end-of-day files, the newer one dated ${dayText(view.session)}; it is not a reading of a session still trading.`)
  lines.push(readAtLine(read, 'Put together by UCT'))
  lines.push(source)
  return {
    text: lines.join('\n'),
    ...(rows.length ? { table: {
      columns: [{ key: 'contract', label: 'Contract' }, { key: 'change', label: 'Change' }, { key: 'pct', label: 'Percent' }, { key: 'oi', label: 'Open interest' }, { key: 'prior', label: 'Was' }, { key: 'volume', label: 'Volume' }],
      rows: view.rows.map((r, i) => ({ contract: rows[i].label, change: r.kind === 'new' ? 'new' : changeLines(r)[0], pct: r.kind === 'new' ? 'not given' : changeLines(r)[1], oi: countText(r.oi),
        prior: r.kind === 'new' ? 'no earlier figure' : countText(r.priorOi, 'not given'), volume: view.volumePresent && r.volume != null ? countText(r.volume) : 'not given' })),
    }, present: {
      kind: 'metrics', title: `${symbol} open interest change, ${shortDay(view.session)}`, short: `${symbol} open interest change`,
      items: view.rows.slice(0, PRESENT_ROWS).map((r, i) => ({ label: rows[i].label, value: r.kind === 'new' ? 'new' : changeLines(r)[0], note: `${countText(r.oi)} open interest`, aka: [String(r.contract).toLowerCase()] })),
    } } : {}),
    facts,
  }
}

export async function answerOi(args = {}) {
  const symbol = upper(args.symbol).replace('.', '-')
  if (!TICKER.test(symbol)) return { text: `Which stock's open interest change should I read? Give me one ticker. ${NONE_STATED}` }
  const side = sideOf(args.side)
  if (!side) return { text: `Which side should I read ${symbol}'s open interest change for? ${OI_SIDE_KEYS.map(k => OI_SIDES[k].label).join(', ')}. ${NONE_STATED}` }
  const params = { symbol, side, rows: clamp(args.rows, OI_MAX_ROWS, OI_DEFAULT_ROWS) }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${symbol}'s open interest change: ${NO_TURN}.` }
  const envl = await readData('options.oiChange', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromOi(envl, symbol)
}

// ── stock.treasuryYields ───────────────────────────────────────────────────────────────────────────────────────────────
export const TREASURY_HORIZON_KEYS = Object.keys(HORIZONS)             // d1 | w1 | m1 | m3 | y1: the RATES panel's own
export const END_OF_DAY = 'These are end-of-day figures published by the US Treasury, not quotes from a session still trading.'
const HORIZON_COLUMN = Object.freeze({ d1: '1 day', w1: '1 week', m1: '1 month', m3: '3 months', y1: '1 year' })

/** Pure: a `rates.treasury` envelope → the answer. */
export function answerFromTreasury(envl) {
  const none = `${NONE_STATED} That is not the same as no figure.`
  if (!usable(envl)) {
    return { text: noRead('Treasury yields', envl, 'none are held on the server at the moment (this answer never requests them from the Treasury\'s website), or the read failed. Open the Treasury yields panel (RATES) in UCT, then ask again', none) }
  }
  const d = envl.data
  const view = ratesRead({ ...d, status: 'ok' })                      // the kind's data keeps the route's own names
  if (view.state !== 'ok') return { text: `I couldn't read Treasury yields: UCT's data did not answer cleanly. ${none}` }
  const maturities = view.maturities.map(m => ({ key: m.key, label: m.label, yield_pct: m.yield, yield_text: m.yield == null ? null : yieldText(m.yield), was: m.was, change_bp: m.changeBp }))
  const spreads = view.spreads.map(s => ({ key: s.key, label: s.label, value: s.value, value_text: s.value == null ? null : pointsText(s.value), state: s.state, days_in_state: s.days, since: s.since, at_least: s.atLeast, change_bp: s.changeBp }))
  const noReference = TREASURY_HORIZON_KEYS.filter(h => !view.refDates[h])
  const missing = maturities.filter(m => m.yield_pct == null).map(m => m.label)
  const read = stampET(view.readAt, envl.fetched_at)
  const points = Number.isInteger(d.history?.points) ? d.history.points : null
  const facts = {
    as_of: view.asOf, day: dayText(view.asOf), read, stale: !!envl.stale, check_failed: !!view.check, ref_dates: view.refDates, no_reference: noReference, missing,
    maturities, spreads, history: { from: isoDay(d.history?.from), to: isoDay(d.history?.to), points, columns_left_out: true },
  }
  const lines = [`US Treasury yields by maturity, end-of-day figures for ${dayText(view.asOf)}:`]
  for (const m of view.maturities) {
    if (m.yield == null) { lines.push(`• ${m.label}: no figure for that day`); continue }
    const d1 = m.changeBp.d1 != null ? `, ${bpText(m.changeBp.d1)} bp from ${HORIZONS.d1}` : `, no figure ${HORIZONS.d1} to compare with`
    const m1 = m.changeBp.m1 != null ? `, ${bpText(m.changeBp.m1)} bp from ${HORIZONS.m1}` : ''
    lines.push(`• ${m.label}: ${yieldText(m.yield)}${d1}${m1}`)
  }
  for (const s of view.spreads) lines.push([spreadSentence(s, view.asOf), spreadTrendSentence(s)].filter(Boolean).join(' '))
  if (noReference.length) lines.push(`No figure was found near enough to ${andList(noReference.map(h => HORIZONS[h]))}, so ${noReference.length === 1 ? 'that change is' : 'those changes are'} not stated: that is not a change of 0.`)
  if (points) lines.push('The daily history behind the spreads is not in this answer: the Treasury yields panel (RATES) in UCT draws it.')
  if (view.check) lines.push('Stale: UCT\'s last look for a newer figure did not go well, so these are the last figures it read and a newer day may exist.')
  else if (envl.stale) lines.push(`Stale: the newest figure UCT holds is ${shortDay(view.asOf)}, and a later day's figures may be out. This answer never looks for one.`)
  lines.push(END_OF_DAY)
  lines.push(readAtLine(read, 'Read by UCT from the Treasury\'s website'))
  lines.push(`Source: ${RATES_SOURCE}. ${DESCRIPTIVE}`)
  return {
    text: lines.join('\n'),
    table: {
      columns: [{ key: 'maturity', label: 'Maturity' }, { key: 'yield', label: 'Yield' }, ...TREASURY_HORIZON_KEYS.map(h => ({ key: h, label: `${HORIZON_COLUMN[h]} (bp)` }))],
      rows: maturities.map(m => ({ maturity: m.label, yield: m.yield_text || 'not given', ...Object.fromEntries(TREASURY_HORIZON_KEYS.map(h => [h, m.yield_pct == null || m.change_bp[h] == null ? 'not given' : bpText(m.change_bp[h])])) })),
    },
    present: {
      kind: 'metrics', title: `Treasury yields, ${shortDay(view.asOf)}`, short: 'Treasury yields',
      items: maturities.filter(m => m.yield_text).slice(0, PRESENT_ROWS + 4).map(m => ({ label: m.label, value: m.yield_text, note: m.change_bp.d1 != null ? `${bpText(m.change_bp.d1)} bp on the day` : 'no change given', aka: [m.key] })),
    },
    facts,
  }
}

export async function answerTreasury() {
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read Treasury yields: ${NO_TURN}.` }
  const envl = await readData('rates.treasury', {}, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromTreasury(envl)
}

// ── routing words (armed only while registered; routing.js's `marketRecords` group lists none) ────────────────────────
// Routing v2 reaches the five by their summaries. v1 (the kill-switch fallback, and the router the capability-regression
// corpus runs) selects a group by its words, and `marketRecords` is words-only: these words are the only way v1 sends it.
// Routing only ADDS a group (the other groups a message names still ride along), and each pattern is kept off another
// capability's own language:
//   seasonality  the word itself (seasonality, seasonal), a "best month" ask with no year in it (a named year is the price
//                history's monthly returns), or how a stock "usually" does in a named month. ONE stock: none of the board's
//                fund words;
//   board        the same, beside a sector, index or fund word;
//   tide         "market tide" beside a history word (by day, daily, last week, sessions), or "tide history". A bare "market
//                tide" is the tide of the session still trading, which is not this answer;
//   oi           "open interest" beside a change word, for a stock. Never beside a futures market, a COT word (specs,
//                commercials, positioning) or "futures": that is the COT capability's open interest;
//   treasury     Treasury yields, the yield curve, a named maturity's yield, bond yields. Never a dividend yield, never
//                futures positioning in Treasuries (COT), and never a bare "rates" (win rates, interest-rate news);
//   not ours     a screen or its condition, an alert, a watchlist, the member's own lists, a page or a widget, or what a
//                term MEANS (the guide).
// ⛔ no lookbehind (iOS 16 floor, src/noRegexLookbehind.test.js).
const NOT_A_SCREEN = '^(?!.*\\b(?:scans?|screens?|screener|filters?|find|alerts?|notify|widgets?|page|tab|panel|watchlists?|my)\\b)(?!.*(?:\\b(?:over|above|under|below|at least|more than|less than|greater than)\\b|[<>])\\s*\\$?\\d)'
const NOT_A_MEANING = '(?!.*\\b(?:explain|define|definition|meaning|means?|difference between|how (?:is|are) .* (?:calculated|worked out|computed))\\b)(?!what(?:\'s|’s| is| are) (?:an? |the )?(?:seasonality|market tide|open interest|yield curve|par yields?)\\W*$)'
const OURS = `${NOT_A_SCREEN}${NOT_A_MEANING}`
const SEASONAL = '\\bseasonal(?:ity|ly|s)?\\b'
const FUND_WORDS = '\\b(?:sectors?|index(?:es)?|indices|funds?|etfs?|board|market|groups?)\\b'
const MONTH_NAME = '(?:january|february|march|april|may|june|july|august|september|october|november|december)'
const USUALLY = `\\b(?:usually|typically|historically|normally|tends? to)\\b.*\\b(?:in|during) ${MONTH_NAME}\\b`
const NO_YEAR = '(?!.*\\b(?:19|20)\\d{2}\\b)'
const ONE_STOCK = `${OURS}(?!.*${FUND_WORDS})`
const TIDE_PAST = '\\b(?:history|historical|by day|by session|daily|each day|per day|day by day|past|last|previous|prior|yesterday|this week|sessions?|days|weeks?|trend)\\b'
const NOT_FUTURES = '(?!.*\\b(?:futures?|cot|cftc|commitments?|specs?|speculators?|commercials?|positioning|positioned|net (?:long|short)|gold|silver|copper|platinum|palladium|crude|oil|wti|brent|gas|gasoline|wheat|corn|soy\\w*|cotton|coffee|sugar|cocoa|cattle|hogs|lumber|treasur\\w+|bonds?|notes?|euro|yen|pound|franc|peso|dollar|bitcoin|btc|vix)\\b)'
const OI_MOVED = '\\b(?:change[ds]?|changing|rose|rise|rising|fell|fall|falling|added|adding|increase[ds]?|decrease[ds]?|dropped|build|building|buildup|built|new|grew|growing|shrank|jumped)\\b'
const NOT_COT = '(?!.*\\b(?:futures?|cot|cftc|commitments?|specs?|speculators?|commercials?|positioning|positioned|net (?:long|short)|open interest|dividends?|payout)\\b)'
const MATURITY = '\\b(?:1|2|3|5|7|10|20|30)[\\s-]?(?:year|yr|y)\\b'
export const WAVE6_ROUTE_WORDS = Object.freeze({
  seasonality: [
    new RegExp(`${ONE_STOCK}.*${SEASONAL}`),
    new RegExp(`${ONE_STOCK}${NO_YEAR}.*\\b(?:best|worst|strongest|weakest) (?:calendar )?months?\\b`),
    new RegExp(`${ONE_STOCK}${NO_YEAR}.*${USUALLY}`),
  ],
  board: [
    new RegExp(`${OURS}(?=.*${FUND_WORDS}).*${SEASONAL}`),
    new RegExp(`${OURS}${NO_YEAR}(?=.*\\b(?:sectors?|index(?:es)?|indices)\\b).*${USUALLY}`),
  ],
  tide: [
    new RegExp(`${OURS}(?=.*${TIDE_PAST}).*\\bmarket tide\\b`),
    new RegExp(`${OURS}.*\\btide (?:history|by (?:day|session))\\b`),
  ],
  oi: [
    new RegExp(`${OURS}${NOT_FUTURES}(?=.*${OI_MOVED}).*\\bopen interest\\b`),
    new RegExp(`${OURS}${NOT_FUTURES}.*\\boi change\\b`),
  ],
  treasury: [
    new RegExp(`${OURS}${NOT_COT}.*\\btreasur(?:y|ies)\\b.*\\b(?:yields?|rates?|curve|spreads?)\\b`),
    new RegExp(`${OURS}${NOT_COT}.*\\b(?:yield curve|bond yields?|2s10s|10s2s)\\b`),
    new RegExp(`${OURS}${NOT_COT}(?=.*${MATURITY}).*\\byields?\\b`),
    new RegExp(`${OURS}${NOT_COT}(?=.*\\bcurve\\b).*\\binver(?:ted|sion)\\b`),
  ],
})
export const ROUTE_GROUP = 'marketRecords'
const ownGroup = () => GROUPS.find(g => g.id === ROUTE_GROUP)
/** Adds (or takes back) ONE capability's words on the wave's own group. */
function armRoutes(key, on) {
  const g = ownGroup()
  if (!g) return
  for (const re of WAVE6_ROUTE_WORDS[key]) {
    const at = g.words.indexOf(re)
    if (on && at < 0) g.words.push(re)
    if (!on && at >= 0) g.words.splice(at, 1)
  }
}

// ── registration: each capability only while the server serves ITS kind ───────────────────────────────────────────────
// ⚠️ THE WORDS OF A SUMMARY AND OF ITS HINTS JOIN THE TYPO LEXICON (nl/lexicon.js: every lowercase word of three letters or
// more; a word in CAPITALS does not). A new known word changes what a nearby word in ANY member message may be "corrected"
// to, so the text below is worded to leave every existing capability-regression phrasing's corrections exactly as they
// were (pinned in agentTerminalDataWave6.test.js, "the typo lexicon").
const TARGET_HINT = 'target = the ref of the stockData entry.'
const NO_FIGURES = 'reply: one short line, no figures.'
const HELD_ONLY = 'Answered only from what the SERVER already HOLDS, so it may say none is held.'
const unregister = {}

/** Idempotent; registers each of the five ONLY while the server serves its kind. Returns the names registered by this call. */
export function registerTerminalWave6Capabilities() {
  const added = []
  if (!unregister.seasonality && kindServed(KINDS.seasonality)) {
    unregister.seasonality = registerCapability({
      name: 'stock.seasonality',        // a LITERAL: the server's local-only mirror rail reads it (tests/test_uct_agent_breadth.py)
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ computed from the vendor's daily history, cleared for display to members: shown to the member, never to a model
      summary: 'One stock\'s SEASONALITY: for each CALENDAR MONTH the YEARS COUNTED, the MEDIAN and the AVERAGE MONTH, how OFTEN it ROSE, and the same by WEEKDAY, CLOSE to CLOSE. '
        + 'For "NVDA SEASONALITY", "BEST MONTHS for TSLA", "how does AAPL USUALLY do in DECEMBER".',
      hints: `${TARGET_HINT} symbol = the one ticker named (or the open chart's symbol). The date is the newest DAILY BAR in the RECORD: never today. A RECORD of the PAST, not a FORECAST. ${HELD_ONLY} `
        + `The SECTOR and INDEX FUNDS side by side are the SEASONALITY BOARD, not this answer; one NAMED year's MONTHLY RETURNS are the price history. ${NO_FIGURES}`,
      args: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'], additionalProperties: false },
      answer: (_snap, args) => answerSeasonality(args || {}),
    })
    armRoutes('seasonality', true)
    added.push(CAPABILITIES.seasonality)
  }
  if (!unregister.board && kindServed(KINDS.board)) {
    unregister.board = registerCapability({
      name: 'stock.seasonalityBoard',   // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ computed from the vendor's daily history, cleared for display to members: shown to the member, never to a model
      summary: 'The SEASONALITY BOARD: the INDEX FUNDS and the SECTOR FUNDS by CALENDAR MONTH (the MEDIAN or the AVERAGE MONTH and how OFTEN it ROSE), for this MONTH and the next, with the BEST and the WEAKEST SECTOR FUND of the MONTH. '
        + 'For "SECTOR SEASONALITY", "SEASONALITY BOARD", "which SECTORS USUALLY do BEST in NOVEMBER".',
      hints: `${TARGET_HINT} MEASURE: ${BOARD_MEASURE_KEYS.join('|')} (null = ${DEFAULT_BOARD_MEASURE}). The date is the newest DAILY BAR the BOARD COVERS: never today. A RECORD of the PAST, not a FORECAST. `
        + `Answered only from a BOARD the SERVER already HOLDS, so it may say none is held. One stock's own SEASONALITY is not this BOARD; SECTOR returns over a recent period are SECTOR performance. ${NO_FIGURES}`,
      args: { type: 'object', properties: { measure: { type: ['string', 'null'], enum: [...BOARD_MEASURE_KEYS, null] } }, required: ['measure'], additionalProperties: false },
      answer: (_snap, args) => answerBoard(args || {}),
    })
    armRoutes('board', true)
    added.push(CAPABILITIES.board)
  }
  if (!unregister.tide && kindServed(KINDS.tide)) {
    unregister.tide = registerCapability({
      name: 'stock.tideHistory',        // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ totals derived from the recorded options tape, kept member-gated: shown to the member, never to a model
      summary: 'MARKET TIDE by FINISHED SESSION: NET CALL PREMIUM, NET PUT PREMIUM and their NET for each STORED SESSION, newest first, with SUMS over the last SESSIONS and the SESSIONS with no STORED row. '
        + 'For "MARKET TIDE HISTORY", "MARKET TIDE by day", "MARKET TIDE over the last week".',
      hints: `${TARGET_HINT} SCOPE: ${TIDE_SCOPE_KEYS.join('|')} (all = stocks and ETFS together; null = ${DEFAULT_TIDE_SCOPE}). ROWS 1-${TIDE_MAX_ROWS} (null = ${TIDE_DEFAULT_ROWS}). `
        + `The date is the newest STORED SESSION: never today, and never the TIDE of a SESSION still trading. Answered only from the SESSIONS the SERVER already STORED, so it may say none is STORED. ${NO_FIGURES}`,
      args: {
        type: 'object',
        properties: { scope: { type: ['string', 'null'], enum: [...TIDE_SCOPE_KEYS, null] }, rows: { type: ['integer', 'null'] } },
        required: ['scope', 'rows'], additionalProperties: false,
      },
      answer: (_snap, args) => answerTide(args || {}),
    })
    armRoutes('tide', true)
    added.push(CAPABILITIES.tide)
  }
  if (!unregister.oi && kindServed(KINDS.oi)) {
    unregister.oi = registerCapability({
      name: 'stock.oiChange',           // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ the vendor's options data from UCT's options log, cleared for display to members: shown to the member, never to a model
      summary: 'One stock\'s OPEN INTEREST CHANGE by CONTRACT between the two newest days of UCT\'s options LOG: the CONTRACTS whose OPEN INTEREST CHANGED and the NEWLY LISTED ones, biggest first, with TOTALS for CALLS and PUTS. '
        + 'For "OPEN INTEREST CHANGE on NVDA", "where did TSLA OPEN INTEREST RISE", "new OPEN INTEREST in AAPL CALLS".',
      hints: `${TARGET_HINT} symbol = the one ticker named (or the open chart's symbol). SIDE: ${OI_SIDE_KEYS.join('|')} (null = ${DEFAULT_OI_SIDE}). ROWS 1-${OI_MAX_ROWS} (null = ${OI_DEFAULT_ROWS}). `
        + `The date is the NEWER LOG FILE's: never today. ${HELD_ONLY} OPEN INTEREST in FUTURES (COT POSITIONING) is not this answer. ${NO_FIGURES}`,
      args: {
        type: 'object',
        properties: { symbol: { type: 'string' }, side: { type: ['string', 'null'], enum: [...OI_SIDE_KEYS, null] }, rows: { type: ['integer', 'null'] } },
        required: ['symbol', 'side', 'rows'], additionalProperties: false,
      },
      answer: (_snap, args) => answerOi(args || {}),
    })
    armRoutes('oi', true)
    added.push(CAPABILITIES.oi)
  }
  if (!unregister.treasury && kindServed(KINDS.treasury)) {
    unregister.treasury = registerCapability({
      name: 'stock.treasuryYields',     // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ the register clears these yields for the member's panel and names no AI lane: shown to the member, never to a model
      summary: 'US TREASURY YIELDS by MATURITY (END-OF-DAY PAR YIELDS): each YIELD, its change in BASIS POINTS from the day before, a week, a MONTH, three MONTHS and a year AGO, and the 10-YEAR minus 2-YEAR and 10-YEAR minus 3-MONTH CURVE SPREADS. '
        + 'For "TREASURY YIELDS", "the 10-YEAR YIELD", "is the YIELD CURVE INVERTED".',
      hints: `${TARGET_HINT} No ARGUMENTS. The date is the CURVE's own date: never today, and never a QUOTE from a SESSION still trading. ${HELD_ONLY} `
        + `A stock's DIVIDEND YIELD is not this answer; POSITIONING in TREASURY FUTURES is COT. ${NO_FIGURES}`,
      args: { type: 'object', properties: {}, required: [], additionalProperties: false },
      answer: () => answerTreasury(),
    })
    armRoutes('treasury', true)
    added.push(CAPABILITIES.treasury)
  }
  return added
}
export const _resetTerminalWave6ForTest = () => {
  for (const k of Object.keys(unregister)) { unregister[k]?.(); delete unregister[k] }
  for (const k of Object.keys(WAVE6_ROUTE_WORDS)) armRoutes(k, false)
}
