// Terminal data wave 7 — six LOCAL-ONLY capabilities over six model-isolated data kinds (MD-1 §4.16):
//   stock.marketRegime    market.regime          UCT's market regime read as the server last computed it (REGM)
//   stock.setups          stock.setups           the setups UCT's chart judge confirmed on one stock's daily chart (TECH)
//   stock.eventsTimeline  stock.eventsTimeline   the dated events UCT's stores hold for one stock (EVTS)
//   stock.uct20List       uct20.list             the UCT 20 leadership list as the morning wire last pushed it (UCT 20 page)
//   stock.ivHistory       options.ivHistory      one stock's at-the-money implied volatility by logged session (IVH)
//   stock.dilutionWatch   dilution.watch         one company's share-issuance filings from the SEC's filing index (DILU)
//
// Each answer is built in the browser from ONE read of its own kind and shown to the MEMBER ONLY: every capability is
// `localOnly` (its name is in turn.LOCAL_ONLY_ACTIONS on the server), every kind is model-isolated, and nothing the read
// returns reaches a model provider. All six were isolated as the builder's default, from the licensing register's rows
// (quoted in each adapter and in MD-1 §4.16); nobody decided otherwise and nobody was asked.
//
// What every answer keeps to:
//   • the date is the DATA'S OWN (the time the server computed the regime read, the daily bar a setup was judged on, the
//     newest event that is not in the future, the wire run's date, the newest logged session, the newest filing's day),
//     with the time UCT computed or read it beside it where the data carries one. Never the time of the ask;
//   • a number that does not exist is never 0: a breadth figure the classifier did not have, a setup with no key level,
//     a session with no implied volatility, a filing count the index was not read back far enough for;
//   • a list that is cut says so, and from which end;
//   • nothing held, a switch that is off, a store that is not there and a read that failed are never said as "no regime",
//     "no setup", "no event", "an empty list", "no implied volatility" or "no filings";
//   • an envelope's notes are never echoed;
//   • what the kind leaves out (the Exposure Rating and VIX, the judge's written reasons, the catalyst thesis and filing
//     links, the UCT 20 entry / stop / targets and model portfolio) is said, with the panel that shows it.
//
// Dark by construction: each is registered only while the server serves its own kind (UCT_AGENT_DATA_KINDS, fail closed; an
// isolated kind also needs its own UCT_AGENT_ISOLATED_KINDS entry or every read is refused). Nothing here arms anything.
// ROUTING: the six share ONE words-only group of their own, `marketReads` (routing.js lists them by action). It is the
// 49th group; the server's cap (turn.MAX_GROUPS) was raised from 48 to 56 by the integrator's wave 7 build on 2026-11-20,
// when the catalog reached 49. Each capability's own words (WAVE7_ROUTE_WORDS) are added to that group only while it is
// registered, so on a dark server the group has no words and no registered action, and routing is byte-identical to the
// base.
import { registerCapability } from '../capabilities'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { GROUPS } from '../routing'
import { stampET } from './marketDataFacts'
import { SOURCE as DILU_SOURCE } from '../../pages/terminal/panels/dilutionModel'
import { kindServed, usable, noRead, money, whole, plural, andList, dayText, NO_TURN } from './terminalDataFormat'

export const KINDS = Object.freeze({
  regime: 'market.regime', setups: 'stock.setups', events: 'stock.eventsTimeline', uct20: 'uct20.list', iv: 'options.ivHistory', dilution: 'dilution.watch',
})
export const CAPABILITIES = Object.freeze({
  regime: 'stock.marketRegime', setups: 'stock.setups', events: 'stock.eventsTimeline', uct20: 'stock.uct20List', iv: 'stock.ivHistory', dilution: 'stock.dilutionWatch',
})
const NOTHING = 'Nothing is stated.'
const TEXT_ROWS = 5
const PRESENT_ROWS = 12
export const NOT_ADVICE = 'not a forecast and not advice'
const TICKER = /^[A-Z]{1,5}(?:[.-][A-Z]{1,2})?$/
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const upper = (s) => String(s || '').trim().toUpperCase().replace(/^\$/, '')
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v) => (Number.isInteger(v) ? v : null)
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const clamp = (v, max, fallback) => (Number.isInteger(v) ? Math.min(Math.max(v, 1), max) : fallback)
const isoDay = (v) => (typeof v === 'string' && ISO_DAY.test(v) ? v : null)
const list = (v) => (Array.isArray(v) ? v.filter(r => r && typeof r === 'object') : [])
/** "Fri, Nov 13, 2026" → "Nov 13, 2026" */
const shortDay = (ymd) => (dayText(ymd) || '').replace(/^\w+, /, '') || null
const unclean = (what, none) => ({ text: `I couldn't read ${what}: UCT's data did not answer cleanly. ${none}` })

// ── stock.marketRegime ─────────────────────────────────────────────────────────────────────────────────────────────────
/** The breadth figures the kind carries, by the classifier's own signal names (a rail pins them to the adapter's SIGNALS). */
export const REGIME_SIGNALS = Object.freeze({
  pct_above_50ma: Object.freeze({ label: 'Stocks above the 50-day average', unit: '%' }),
  pct_above_200ma: Object.freeze({ label: 'Stocks above the 200-day average', unit: '%' }),
  new_highs: Object.freeze({ label: 'New highs', unit: '' }),
  new_lows: Object.freeze({ label: 'New lows', unit: '' }),
  distribution_days: Object.freeze({ label: 'Distribution days', unit: '' }),
})
export const REGIME_SIGNAL_KEYS = Object.keys(REGIME_SIGNALS)
export const REGIME_RULES = `It is what UCT's rules read, ${NOT_ADVICE}.`
const REGIME_NONE = 'No regime is stated. That is not the same as no regime.'
const signalText = (key, v) => (v == null ? null : REGIME_SIGNALS[key].unit === '%' ? `${Math.round(v)}%` : whole(v))

/** Pure: a `market.regime` envelope → the answer. */
export function answerFromRegime(envl) {
  if (!usable(envl)) {
    return { text: noRead('UCT\'s market regime read', envl, 'none is held on the server at the moment (this answer never computes one), or the read failed. Open the Market regime panel (REGM) in UCT, then ask again', REGIME_NONE) }
  }
  const d = envl.data
  const label = str(d.label)
  const confidence = num(d.confidence)
  if (!str(d.regime) || !label || confidence == null || !d.signals || typeof d.signals !== 'object') return unclean('UCT\'s market regime read', REGIME_NONE)
  const band = str(d.band)
  const signals = Object.fromEntries(REGIME_SIGNAL_KEYS.map(k => [k, num(d.signals[k])]))     // not available to the classifier: null, never 0
  const phase = str(d.signals.market_phase)
  const missing = REGIME_SIGNAL_KEYS.filter(k => signals[k] == null)
  const reasons = (Array.isArray(d.reasons) ? d.reasons : []).map(str).filter(Boolean).map(r => r.replace(/[.\s]+$/, ''))
  const dropped = int(d.reasons_left_out) || 0
  const computed = stampET(d.computed_at || envl.as_of, envl.fetched_at)
  const pctConfidence = Math.round(confidence * 100)
  const facts = {
    regime: d.regime, label, band, confidence, confidence_pct: pctConfidence, signals, market_phase: phase, missing, reasons, reasons_left_out: dropped,
    left_out: Array.isArray(d.left_out) ? d.left_out : [], computed_at: str(d.computed_at) || str(envl.as_of), computed, stale: !!envl.stale,
  }
  const lines = [`UCT's market regime read: ${label}${band ? `, sizing band ${band}` : ', no sizing band given'}, confidence ${pctConfidence}%.`]
  for (const k of REGIME_SIGNAL_KEYS) lines.push(`• ${REGIME_SIGNALS[k].label}: ${signalText(k, signals[k]) ?? 'not available to the classifier'}`)
  if (phase) lines.push(`• Market phase: ${phase}`)
  if (reasons.length) lines.push(`Why, in the classifier's own words: ${reasons.join('; ')}.`)
  if (missing.length) lines.push(`${plural(missing.length, 'breadth figure')} ${missing.length === 1 ? 'was' : 'were'} not available to the classifier and ${missing.length === 1 ? 'is' : 'are'} not stated: that is not a figure of 0.`)
  lines.push(`The UCT Exposure Rating and the VIX level are not in this answer${dropped ? `, with the ${plural(dropped, 'reason line')} that ${dropped === 1 ? 'states' : 'state'} them` : ''}: the Market regime panel (REGM) in UCT shows them.`)
  lines.push(computed
    ? `Computed by UCT's server at ${computed} (UCT's own time). The server recomputes at most every 15 minutes, and this answer never recomputes. The breadth figures behind it carry no date of their own.`
    : 'The answer carries no computed time, so I cannot say how old it is.')
  lines.push(`Source: UCT's regime classifier, rules over market breadth and VIX. ${REGIME_RULES}`)
  const items = [
    { label: 'Regime', value: label, note: band ? `sizing band ${band}` : 'no sizing band given', aka: [d.regime] },
    { label: 'Confidence', value: `${pctConfidence}%`, note: 'the classifier\'s own', aka: ['confidence'] },
    ...REGIME_SIGNAL_KEYS.map(k => ({ label: REGIME_SIGNALS[k].label, value: signalText(k, signals[k]) ?? 'not given', note: signals[k] == null ? 'not available to the classifier' : 'breadth', aka: [k] })),
  ]
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'figure', label: 'Figure' }, { key: 'value', label: 'Value' }], rows: items.map(i => ({ figure: i.label, value: i.value })) },
    present: { kind: 'metrics', title: 'UCT market regime read', short: 'Market regime', items },
    facts,
  }
}

export async function answerRegime() {
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read UCT's market regime read: ${NO_TURN}.` }
  const envl = await readData('market.regime', {}, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromRegime(envl)
}

// ── stock.setups ───────────────────────────────────────────────────────────────────────────────────────────────────────
export const SETUPS_DEFAULT_ROWS = 10
export const SETUPS_MAX_ROWS = 25
export const SETUPS_RECORD = `A record of what the judge confirmed, ${NOT_ADVICE}.`
const SETUPS_NONE = 'No setup is stated. That is not the same as no setup.'
const confidenceText = (v) => (v == null ? 'no confidence stored' : `confidence ${Math.round(v)}%`)

/** Pure: a `stock.setups` envelope → the answer. */
export function answerFromSetups(envl, symbol) {
  const what = `${symbol}'s confirmed setups`
  if (!usable(envl)) {
    return { text: noRead(what, envl, 'no verdict is stored for it on the server (nothing was judged on it lately, or the verdict store is not there), or the read failed. This answer never runs a detection and never reads a chart', SETUPS_NONE) }
  }
  const d = envl.data
  const evaluated = int(d.evaluated)
  const window = int(d.window_days)
  if (!Array.isArray(d.rows) || evaluated == null || evaluated < 1 || window == null) return unclean(what, SETUPS_NONE)
  const rows = list(d.rows).filter(r => str(r.setup) && isoDay(r.asof_date)).map(r => ({
    setup: r.setup, name: str(r.name) || r.setup, asof_date: r.asof_date, confidence: num(r.confidence), key_level: num(r.key_level),   // no level stored: null, never 0
    checks_passed: int(r.checks_passed), checks_made: int(r.checks_made),
  }))
  const total = Math.max(int(d.confirmed_total) ?? 0, rows.length)
  const asOf = isoDay(d.as_of)
  const expected = isoDay(d.expected_session)
  const judged = stampET(d.judged_at, envl.fetched_at)
  const judgedLine = judged ? `The judge last ran on ${symbol} at ${judged} (UCT's own time).` : 'The answer carries no time for the judge\'s last run, so I cannot say how old it is.'
  const windowLine = `Only verdicts on a daily bar from the last ${window} days are read, and a setup rejected on a newer bar is not listed from an older one.`
  const source = `Source: UCT's chart judge, stored verdicts on the daily chart. ${SETUPS_RECORD}`
  const facts = {
    symbol, rows, count: rows.length, confirmed_total: total, cut: total > rows.length, evaluated, window_days: window, as_of: asOf, day: dayText(asOf),
    judged_at: str(d.judged_at), judged, expected_session: expected, stale: !!envl.stale, left_out: ['rationale', 'checks'],
  }
  if (!rows.length) {
    return {
      text: [`UCT's chart judge judged ${plural(evaluated, 'setup')} on ${symbol}'s daily chart in the last ${window} days and confirmed none.`, windowLine, judgedLine, source].join('\n'),
      facts,
    }
  }
  const line = (r) => `• ${r.name}: judged on the daily bar of ${shortDay(r.asof_date)}, ${confidenceText(r.confidence)}, ${r.key_level == null ? 'no key level stored' : `key level ${money(r.key_level)}`}`
    + (r.checks_made ? `, ${r.checks_passed ?? 0} of ${plural(r.checks_made, 'check')} passed` : '')
  const lines = [`Setups UCT's chart judge confirmed on ${symbol}'s daily chart, newest bar first (${plural(evaluated, 'setup')} judged in the last ${window} days):`]
  for (const r of rows.slice(0, TEXT_ROWS)) lines.push(line(r))
  if (rows.length > TEXT_ROWS) lines.push(`${rows.length - TEXT_ROWS} more ${rows.length - TEXT_ROWS === 1 ? 'is' : 'are'} in the table.`)
  if (total > rows.length) lines.push(`${total} setups are confirmed and the newest ${rows.length} are in this answer: the list is cut from the old end.`)
  lines.push(windowLine)
  if (envl.stale && asOf) lines.push(`Stale: the newest bar judged is ${shortDay(asOf)}${expected ? `, older than the newest completed session (${shortDay(expected)})` : ''}. This answer never runs the judge: it runs on UCT's own schedule.`)
  lines.push('The judge\'s written reasons and its list of checks are not in this answer: the Technical read panel (TECH) in UCT shows them.')
  lines.push(judgedLine)
  lines.push(source)
  return {
    text: lines.join('\n'),
    table: {
      columns: [{ key: 'setup', label: 'Setup' }, { key: 'bar', label: 'Daily bar judged' }, { key: 'confidence', label: 'Confidence' }, { key: 'level', label: 'Key level' }, { key: 'checks', label: 'Checks passed' }],
      rows: rows.map(r => ({ setup: r.name, bar: shortDay(r.asof_date), confidence: r.confidence == null ? 'not given' : `${Math.round(r.confidence)}%`, level: r.key_level == null ? 'not given' : money(r.key_level),
        checks: r.checks_made ? `${r.checks_passed ?? 0} of ${r.checks_made}` : 'not given' })),
    },
    present: {
      kind: 'metrics', title: `${symbol} confirmed setups`, short: `${symbol} setups`,
      items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.name, value: r.confidence == null ? 'confirmed' : `${Math.round(r.confidence)}%`, note: `bar of ${shortDay(r.asof_date)}`, aka: [r.setup] })),
    },
    facts,
  }
}

export async function answerSetups(args = {}) {
  const symbol = upper(args.symbol).replace('.', '-')    // a class share the way UCT writes it (BRK.B -> BRK-B), as wave 6
  if (!TICKER.test(symbol)) return { text: `Which stock's confirmed setups should I read? Give me one ticker. ${NOTHING}` }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${symbol}'s confirmed setups: ${NO_TURN}.` }
  const params = { symbol, rows: clamp(args.rows, SETUPS_MAX_ROWS, SETUPS_DEFAULT_ROWS) }
  const envl = await readData('stock.setups', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromSetups(envl, symbol)
}

// ── stock.eventsTimeline ───────────────────────────────────────────────────────────────────────────────────────────────
export const EVENTS_DEFAULT_ROWS = 20
export const EVENTS_MAX_ROWS = 40
/** The four sources by the service's own names, in the member's words (a rail pins both to the adapter's SOURCE_WORDS). */
export const EVENT_SOURCE_WORDS = Object.freeze({
  earnings: 'the earnings history', uct_catalyst: 'the UCT catalyst engine\'s flags', filing: 'the SEC filing index', room_spike: 'the room\'s mention counts',
})
export const EVENT_SOURCE_KEYS = Object.keys(EVENT_SOURCE_WORDS)
export const EVENTS_RECORD = `A record of stored events, ${NOT_ADVICE}.`
const EVENTS_NONE = 'No event is stated. That is not the same as no event.'
const SILENT_STATES = Object.freeze({ not_held: 'not held on the server', error: 'the read failed' })

/** Pure: a `stock.eventsTimeline` envelope → the answer. */
export function answerFromEvents(envl, symbol) {
  const what = `${symbol}'s events timeline`
  if (!usable(envl)) {
    return { text: noRead(what, envl, 'the events timeline is switched off on the server, none of its four sources answered, or the read failed. This answer reads stored events only and fetches nothing', EVENTS_NONE) }
  }
  const d = envl.data
  if (!Array.isArray(d.rows) || !d.sources || typeof d.sources !== 'object') return unclean(what, EVENTS_NONE)
  const rows = list(d.rows).filter(r => isoDay(r.date) && str(r.kind)).map(r => ({
    date: r.date, kind: r.kind, title: str(r.title), detail: str(r.detail), source: str(r.source), print_date: isoDay(r.print_date), print_label: str(r.print_label),
    offset: int(r.offset), stage: str(r.stage),                        // not placed against a report: null, never 0
  }))
  const total = Math.max(int(d.total) ?? 0, rows.length)
  const silent = EVENT_SOURCE_KEYS.filter(k => Object.prototype.hasOwnProperty.call(SILENT_STATES, d.sources[k]))
  const asOf = isoDay(d.as_of)
  const staged = d.staged === true
  const prints = list(d.prints).filter(p => isoDay(p.date)).map(p => ({ date: p.date, label: str(p.label), state: str(p.state) }))
  const facts = {
    symbol, rows, count: rows.length, total, cut: total > rows.length, as_of: asOf, day: dayText(asOf), staged, reason: str(d.reason), offset_unit: str(d.offset_unit), prints,
    sources: Object.fromEntries(EVENT_SOURCE_KEYS.map(k => [k, str(d.sources[k])])), silent, partial: envl.status === 'partial', left_out: ['thesis', 'url'],
  }
  const silentLine = silent.length
    ? `${silent.length} of the 4 sources did not answer, so events from there are missing here, which is not the same as no event there: ${andList(silent.map(k => `${EVENT_SOURCE_WORDS[k]} (${SILENT_STATES[d.sources[k]]})`))}.`
    : null
  const source = `Source: UCT's own stores (earnings history, catalyst flags, SEC filing index, room mentions). ${EVENTS_RECORD}`
  if (!rows.length) {
    return { text: [`No event is stored for ${symbol} in the sources that answered.`, silentLine, 'Stored events only: nothing is fetched for this answer.', source].filter(Boolean).join('\n'), facts }
  }
  // an earnings row IS a report, so it carries no offset of its own
  const against = (r) => (r.kind === 'earnings' || !r.stage || !r.print_date ? ''
    : r.offset === 0 ? `, the day of the ${shortDay(r.print_date)} report` : `, ${r.stage} against the ${shortDay(r.print_date)} report`)
  const line = (r) => `• ${shortDay(r.date)}: ${r.title || r.kind}${r.detail ? ` (${r.detail})` : ''}${against(r)}`
  const lines = [`Dated events UCT's stores hold for ${symbol}, newest first${asOf ? `; the newest that is not in the future is ${dayText(asOf)}` : ''}:`]
  for (const r of rows.slice(0, TEXT_ROWS)) lines.push(line(r))
  if (rows.length > TEXT_ROWS) lines.push(`${rows.length - TEXT_ROWS} more ${rows.length - TEXT_ROWS === 1 ? 'is' : 'are'} in the table.`)
  if (total > rows.length) lines.push(`${total} events are stored and the newest ${rows.length} are in this answer: the list is cut from the old end.`)
  if (!asOf) lines.push('No event here is dated on or before the day of the read, so the timeline has no as-of date.')
  if (staged && facts.offset_unit) lines.push(`T-minus and T-plus count ${facts.offset_unit} from the nearest earnings report.`)
  if (!staged) lines.push(`The events are not placed against an earnings report${facts.reason ? `: ${facts.reason.replace(/[.\s]+$/, '')}` : ''}. That is not an offset of 0.`)
  if (silentLine) lines.push(silentLine)
  lines.push('The catalyst engine\'s written thesis and each filing\'s link are not in this answer: the Events timeline panel (EVTS) in UCT shows them.')
  lines.push('Stored events only: nothing is fetched for this answer, and a scheduled report is listed and is never the as-of date.')
  lines.push(source)
  return {
    text: lines.join('\n'),
    table: {
      columns: [{ key: 'date', label: 'Date' }, { key: 'event', label: 'Event' }, { key: 'detail', label: 'Detail' }, { key: 'stage', label: 'Against the nearest report' }],
      rows: rows.map(r => ({ date: shortDay(r.date), event: r.title || r.kind, detail: r.detail || 'not given', stage: r.stage || 'not placed' })),
    },
    present: {
      kind: 'metrics', title: `${symbol} events timeline`, short: `${symbol} events`,
      items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: shortDay(r.date), value: r.title || r.kind, note: r.stage || 'not placed against a report', aka: [r.kind] })),
    },
    facts,
  }
}

export async function answerEvents(args = {}) {
  const symbol = upper(args.symbol).replace('.', '-')    // a class share the way UCT writes it (BRK.B -> BRK-B), as wave 6
  if (!TICKER.test(symbol)) return { text: `Which stock's events timeline should I read? Give me one ticker. ${NOTHING}` }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${symbol}'s events timeline: ${NO_TURN}.` }
  const params = { symbol, rows: clamp(args.rows, EVENTS_MAX_ROWS, EVENTS_DEFAULT_ROWS) }
  const envl = await readData('stock.eventsTimeline', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromEvents(envl, symbol)
}

// ── stock.uct20List ────────────────────────────────────────────────────────────────────────────────────────────────────
export const UCT20_DEFAULT_ROWS = 20
export const UCT20_MAX_ROWS = 20
/** Why a list is stale, by the wire's own status (a rail pins the words to the adapter's STALE_WORDS). */
export const UCT20_STALE_WORDS = Object.freeze({
  stale: 'a trading-day wire run was missed, so this is the list of an earlier run',
  held: 'the wire\'s publish check held this run, so this is the last list that passed it',
  degraded: 'the wire\'s publish check marked this run degraded',
})
export const UCT20_SELECTION = `UCT's own selection, ${NOT_ADVICE}.`
const UCT20_NONE = 'No list is stated. That is not the same as an empty list.'
const signedPct = (v) => (v == null ? null : `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(v).toFixed(1)}%`)

/** Pure: a `uct20.list` envelope → the answer. */
export function answerFromUct20(envl) {
  if (!usable(envl)) {
    return { text: noRead('the UCT 20 list', envl, 'none is held on the server at the moment (this answer never builds one), or the read failed. Open the UCT 20 page in UCT, then ask again', UCT20_NONE) }
  }
  const d = envl.data
  const rows = list(d.rows).filter(r => int(r.rank) != null && str(r.symbol)).map(r => ({
    rank: r.rank, symbol: r.symbol, rs: num(r.rs), score: num(r.score), ret_1m: num(r.ret_1m), ret_3m: num(r.ret_3m), earnings_date: isoDay(r.earnings_date),   // not carried: null, never 0
  }))
  if (!rows.length) return unclean('the UCT 20 list', UCT20_NONE)
  const total = Math.max(int(d.total) ?? 0, rows.length)
  const asOf = isoDay(d.as_of)
  const status = str(d.status)
  const removed = int(d.pending_removed) || 0
  const gaps = rows.filter(r => r.rs == null || r.score == null || r.ret_1m == null || r.ret_3m == null).length
  const facts = {
    rows, count: rows.length, total, cut: total > rows.length, as_of: asOf, day: dayText(asOf), status, held_since: isoDay(d.held_since), pending_removed: removed, gaps,
    stale: !!envl.stale, left_out: Array.isArray(d.left_out) ? d.left_out : [],
  }
  const line = (r) => `• ${r.rank}. ${r.symbol}: RS ${r.rs == null ? 'not given' : whole(r.rs)}, rating ${r.score == null ? 'not given' : r.score.toFixed(1)}, `
    + `1 month ${signedPct(r.ret_1m) ?? 'not given'}, 3 months ${signedPct(r.ret_3m) ?? 'not given'}${r.earnings_date ? `, next earnings ${shortDay(r.earnings_date)}` : ''}`
  const lines = [asOf ? `The UCT 20 leadership list from the morning wire run of ${dayText(asOf)}, in the list's own order:` : 'The UCT 20 leadership list as the morning wire last pushed it, in the list\'s own order:']
  for (const r of rows.slice(0, TEXT_ROWS)) lines.push(line(r))
  if (rows.length > TEXT_ROWS) lines.push(`${rows.length - TEXT_ROWS} more ${rows.length - TEXT_ROWS === 1 ? 'is' : 'are'} in the table.`)
  if (total > rows.length) lines.push(`The list holds ${total} names and the top ${rows.length} are in this answer: it is cut from the bottom of the ranking.`)
  if (removed) lines.push(`${plural(removed, 'name')} with a pending acquisition ${removed === 1 ? 'is' : 'are'} left off the list, as on the UCT 20 page.`)
  if (gaps) lines.push(`${plural(gaps, 'name')} ${gaps === 1 ? 'has' : 'have'} at least one figure the wire did not carry: it is not stated, and that is not a figure of 0.`)
  if (!asOf) lines.push('The pushed list carries no run date, so I cannot say how old it is.')
  if (Object.prototype.hasOwnProperty.call(UCT20_STALE_WORDS, status)) lines.push(`Stale: ${UCT20_STALE_WORDS[status]}. This answer never rebuilds the list.`)
  else if (envl.stale && asOf) lines.push('Stale: the list is older than the wire\'s own schedule allows. This answer never rebuilds the list.')
  lines.push('The UCT 20 model portfolio and each name\'s entry, stop and targets are not in this answer, with the wire\'s price and written thesis: the UCT 20 page in UCT shows them.')
  if (asOf) lines.push('The date above is the wire run\'s own, never the time of this answer.')
  lines.push(`Source: UCT's morning wire. ${UCT20_SELECTION}`)
  return {
    text: lines.join('\n'),
    table: {
      columns: [{ key: 'rank', label: '#' }, { key: 'symbol', label: 'Symbol' }, { key: 'rs', label: 'RS' }, { key: 'score', label: 'Rating' }, { key: 'm1', label: '1 month' }, { key: 'm3', label: '3 months' }, { key: 'earnings', label: 'Next earnings' }],
      rows: rows.map(r => ({ rank: String(r.rank), symbol: r.symbol, rs: r.rs == null ? 'not given' : whole(r.rs), score: r.score == null ? 'not given' : r.score.toFixed(1), m1: signedPct(r.ret_1m) ?? 'not given',
        m3: signedPct(r.ret_3m) ?? 'not given', earnings: r.earnings_date ? shortDay(r.earnings_date) : 'not given' })),
    },
    present: {
      kind: 'metrics', title: asOf ? `UCT 20, wire of ${shortDay(asOf)}` : 'UCT 20', short: 'UCT 20',
      items: rows.slice(0, PRESENT_ROWS + 8).map(r => ({ label: `${r.rank}. ${r.symbol}`, value: r.rs == null ? 'RS not given' : `RS ${whole(r.rs)}`, note: r.score == null ? 'rating not given' : `rating ${r.score.toFixed(1)}`, aka: [r.symbol] })),
    },
    facts,
  }
}

export async function answerUct20(args = {}) {
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the UCT 20 list: ${NO_TURN}.` }
  const params = { rows: clamp(args.rows, UCT20_MAX_ROWS, UCT20_DEFAULT_ROWS) }
  const envl = await readData('uct20.list', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromUct20(envl)
}

// ── stock.ivHistory ────────────────────────────────────────────────────────────────────────────────────────────────────
export const IV_DEFAULT_ROWS = 20
export const IV_MAX_ROWS = 60
export const IV_RECORD = `A record of logged sessions, ${NOT_ADVICE}.`
const IV_NONE = 'No implied volatility is stated. That is not the same as no implied volatility.'
/** The log stores implied volatility as a fraction (0.42 = 42%), as the IV history panel reads it. */
const ivText = (v) => (v == null ? null : `${(v * 100).toFixed(1)}%`)
const rankText = (v) => (v == null ? null : String(Math.round(v)))

/** Pure: an `options.ivHistory` envelope → the answer. */
export function answerFromIv(envl, symbol) {
  const what = `${symbol}'s implied volatility history`
  if (!usable(envl)) {
    return { text: noRead(what, envl, 'the IV history is switched off on the server, no session of UCT\'s options log is on its disk, the log holds no at-the-money implied volatility for this stock, or the read failed. This answer never reads the options chain and never downloads a session. Open the IV history panel (IVH) in UCT, then ask again', IV_NONE) }
  }
  const d = envl.data
  const rows = list(d.rows).filter(r => isoDay(r.date)).map(r => ({ date: r.date, atm_iv: num(r.atm_iv), atm_dte: int(r.atm_dte), rule: str(r.rule), complete: r.complete === true }))   // no ATM IV: null, never 0
  const asOf = isoDay(d.as_of)
  const logged = int(d.sessions_logged)
  if (!rows.length || !asOf || logged == null) return unclean(what, IV_NONE)
  const total = Math.max(int(d.total) ?? 0, rows.length)
  const began = isoDay(d.logging_began)
  const expected = isoDay(d.expected_session)
  const r = d.rank && typeof d.rank === 'object' && num(d.rank.current) != null ? d.rank : null
  const rank = r ? { current: num(r.current), iv_rank: num(r.iv_rank), iv_percentile: num(r.iv_percentile), low: num(r.low), high: num(r.high), window_sessions: int(r.window_sessions) } : null
  const rankNote = str(d.rank_note)
  const missing = int(d.missing_sessions) || 0
  const noIv = rows.filter(x => x.atm_iv == null).length
  const reasons = (Array.isArray(d.partial_reasons) ? d.partial_reasons : []).map(str).filter(Boolean)
  const facts = {
    symbol, rows, count: rows.length, total, cut: total > rows.length, as_of: asOf, day: dayText(asOf), logging_began: began, sessions_logged: logged, sessions_with_iv: int(d.sessions_with_iv),
    missing_sessions: missing, rank, rank_note: rankNote, rank_min_sessions: int(d.rank_min_sessions), partial: d.partial === true, partial_reasons: reasons, expected_session: expected, stale: !!envl.stale,
  }
  const line = (x) => (x.atm_iv == null
    ? `• ${shortDay(x.date)}: no at-the-money implied volatility logged`
    : `• ${shortDay(x.date)}: ${ivText(x.atm_iv)}${x.atm_dte != null ? ` at ${plural(x.atm_dte, 'day')} to expiry` : ''}`)
  const lines = [`${symbol} at-the-money implied volatility by logged session, newest first, from UCT's options log (${plural(logged, 'session')} logged${began ? ` since ${shortDay(began)}` : ''}):`]
  for (const x of rows.slice(0, TEXT_ROWS)) lines.push(line(x))
  if (rows.length > TEXT_ROWS) lines.push(`${rows.length - TEXT_ROWS} more ${rows.length - TEXT_ROWS === 1 ? 'is' : 'are'} in the table.`)
  if (rank) {
    lines.push(`IV rank ${rankText(rank.iv_rank) ?? 'is not defined (the highest and the lowest logged session are equal)'} and IV percentile ${rankText(rank.iv_percentile) ?? 'not given'}`
      + `${rank.window_sessions != null ? ` over ${plural(rank.window_sessions, 'logged session')}` : ''}${rank.low != null && rank.high != null ? `, between a low of ${ivText(rank.low)} and a high of ${ivText(rank.high)}` : ''}: a rank over the log, not over a full year unless the log is that long.`)
  } else {
    lines.push(`No IV rank is stated${rankNote ? `: ${rankNote.replace(/[.\s]+$/, '')}` : ''}. That is not a rank of 0.`)
  }
  if (total > rows.length) lines.push(`${plural(total, 'session')} ${total === 1 ? 'is' : 'are'} logged for ${symbol} and the newest ${rows.length} are in this answer: the list is cut from the old end.`)
  if (noIv) lines.push(`${plural(noIv, 'session')} here ${noIv === 1 ? 'has' : 'have'} no at-the-money implied volatility for ${symbol}: it is not stated, and that is not 0%.`)
  if (missing) lines.push(`${plural(missing, 'trading session')} since the log began ${missing === 1 ? 'is' : 'are'} not in the log.`)
  if (reasons.length) lines.push(`The log's own remarks: ${reasons.join(' ')}`)
  if (envl.stale) lines.push(`Stale: the newest session held for ${symbol} is ${shortDay(asOf)}${expected ? `, older than the newest completed session (${shortDay(expected)})` : ''}. A newer session may be logged and not on this server: this answer never downloads one.`)
  lines.push(`The newest session in this answer is ${dayText(asOf)}: the log's own date, never the time of this answer and never a quote from a session still trading.`)
  lines.push(`Source: UCT's options log (the at-the-money implied volatility recorded once per session). ${IV_RECORD}`)
  return {
    text: lines.join('\n'),
    table: {
      columns: [{ key: 'session', label: 'Session' }, { key: 'iv', label: 'ATM IV' }, { key: 'dte', label: 'Days to expiry' }],
      rows: rows.map(x => ({ session: shortDay(x.date), iv: ivText(x.atm_iv) ?? 'not given', dte: x.atm_dte == null ? 'not given' : String(x.atm_dte) })),
    },
    present: {
      kind: 'metrics', title: `${symbol} implied volatility by session`, short: `${symbol} IV history`,
      items: rows.slice(0, PRESENT_ROWS).map(x => ({ label: shortDay(x.date), value: ivText(x.atm_iv) ?? 'not given', note: x.atm_dte != null ? `${plural(x.atm_dte, 'day')} to expiry` : 'no expiry given', aka: [x.date] })),
    },
    facts,
  }
}

export async function answerIv(args = {}) {
  const symbol = upper(args.symbol).replace('.', '-')    // a class share the way UCT writes it (BRK.B -> BRK-B), as wave 6
  if (!TICKER.test(symbol)) return { text: `Which stock's implied volatility history should I read? Give me one ticker. ${NOTHING}` }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${symbol}'s implied volatility history: ${NO_TURN}.` }
  const params = { symbol, rows: clamp(args.rows, IV_MAX_ROWS, IV_DEFAULT_ROWS) }
  const envl = await readData('options.ivHistory', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromIv(envl, symbol)
}

// ── stock.dilutionWatch ────────────────────────────────────────────────────────────────────────────────────────────────
export const DILUTION_DEFAULT_ROWS = 15
export const DILUTION_MAX_ROWS = 40
/** The three counts, by the service's own keys (a rail pins them to the adapter's HORIZONS). */
export const DILUTION_HORIZONS = Object.freeze({ offerings: 'Offerings', unregistered: 'Unregistered sales', registrations: 'Registrations' })
export const DILUTION_HORIZON_KEYS = Object.keys(DILUTION_HORIZONS)
/** Why nothing is stated for a symbol, by the service's own reason (a rail pins the words to the adapter's NONE_WORDS). */
export const DILUTION_NONE_WORDS = Object.freeze({ no_cik: 'the SEC lists no filer for this symbol', no_filings: 'the SEC has no filing index for this company' })
export const DILUTION_SHELF_STATES = Object.freeze({ live: 'in effect by UCT\'s estimate', expired: 'expired by UCT\'s estimate', not_effective: 'not yet effective', withdrawal_requested: 'withdrawal requested' })
export const DILUTION_RECORD = `A record of filings, ${NOT_ADVICE}.`
export const DILUTION_CLASSIFIED = 'Classified from the form type and item numbers alone: no filing document was read.'
const DILUTION_NONE = 'No filing is stated. That is not the same as no filings.'
const countText = (v, span) => (v == null ? `not counted for ${span}` : `${whole(v)} in ${span}`)

/** Pure: a `dilution.watch` envelope → the answer. */
export function answerFromDilution(envl, symbol) {
  const what = `${symbol}'s share-issuance filings`
  if (!usable(envl)) {
    return { text: noRead(what, envl, 'no filing answer is held for it on the server (this answer never requests one from the SEC), UCT\'s last read of the SEC\'s filing index did not go well, or the read failed. Open the Dilution watch panel (DILU) in UCT, then ask again', DILUTION_NONE) }
  }
  const d = envl.data
  const source = `Source: ${DILU_SOURCE}. ${DILUTION_RECORD}`
  if (d.state === 'none') {
    const why = DILUTION_NONE_WORDS[d.none_reason]
    if (!why) return unclean(what, DILUTION_NONE)
    return { text: [`No share-issuance filing is stated for ${symbol}: ${why}.`, 'The answer carries no date.', source].join('\n'), facts: { symbol, state: 'none', none_reason: d.none_reason, rows: [], as_of: null } }
  }
  if (d.state !== 'ok' || !Array.isArray(d.rows) || !d.summary || typeof d.summary !== 'object') return unclean(what, DILUTION_NONE)
  const rows = list(d.rows).filter(r => isoDay(r.date) && str(r.form)).map(r => ({
    date: r.date, form: r.form, kind: str(r.kind), what: str(r.what),
    under: r.under && typeof r.under === 'object' && str(r.under.form) ? { form: r.under.form, filed: isoDay(r.under.filed), shelf: r.under.shelf === true } : null,
  }))
  const total = Math.max(int(d.total) ?? 0, rows.length)
  const asOf = isoDay(d.as_of)
  const years = int(d.window?.years)
  const span = years ? `the last ${plural(years, 'year')}` : 'the window'
  const horizons = Object.fromEntries(DILUTION_HORIZON_KEYS.map(k => {
    const h = d.summary[k] && typeof d.summary[k] === 'object' ? d.summary[k] : {}
    return [k, { m12: int(h.m12), y3: int(h.y3), latest: isoDay(h.latest) }]            // not read back far enough: null, never 0
  }))
  const shelves = list(d.shelves).filter(s => isoDay(s.filed)).map(s => ({
    form: str(s.form), filed: s.filed, effective: isoDay(s.effective), expires_estimate: isoDay(s.expires_estimate), state: Object.prototype.hasOwnProperty.call(DILUTION_SHELF_STATES, s.state) ? s.state : null,
    offerings: int(s.offerings), latest_offering: isoDay(s.latest_offering),
  }))
  const complete = d.coverage?.complete === true
  const coveredFrom = isoDay(d.coverage?.from)
  const read = stampET(d.read_at, envl.fetched_at)
  const live = int(d.summary.live_shelves)
  const pending = int(d.summary.pending_shelves)
  const facts = {
    symbol, state: 'ok', company: str(d.company), fund_like: d.fund_like === true, rows, count: rows.length, total, cut: total > rows.length, as_of: asOf, day: dayText(asOf), window_years: years,
    window_to: isoDay(d.window?.to), coverage_complete: complete, coverage_from: coveredFrom, summary: { live_shelves: live, pending_shelves: pending, ...horizons }, shelves, read_at: str(d.read_at), read, stale: !!envl.stale,
  }
  const lines = [`${symbol}${facts.company ? ` (${facts.company})` : ''}: share-issuance filings in the SEC's filing index over ${span}, as UCT classified them:`]
  for (const k of DILUTION_HORIZON_KEYS) {
    const h = horizons[k]
    lines.push(`• ${DILUTION_HORIZONS[k]}: ${countText(h.m12, 'the last 12 months')}, ${countText(h.y3, 'the last 3 years')}${h.latest ? `, the latest on ${shortDay(h.latest)}` : ''}`)
  }
  if (live != null || pending != null) lines.push(`• Shelf registrations: ${live == null ? 'the count in effect is not given' : `${whole(live)} in effect by UCT's estimate`}, ${pending == null ? 'the count not yet effective is not given' : `${whole(pending)} not yet effective`}`)
  for (const s of shelves) {
    lines.push(`• Shelf${s.form ? ` ${s.form}` : ''} filed ${shortDay(s.filed)}: ${s.state ? DILUTION_SHELF_STATES[s.state] : 'state not given'}${s.effective ? `, effective ${shortDay(s.effective)}` : ''}`
      + `${s.expires_estimate ? `, estimated to expire ${shortDay(s.expires_estimate)}` : ''}${s.offerings != null ? `, ${plural(s.offerings, 'offering')} under it` : ''}${s.latest_offering ? `, the latest on ${shortDay(s.latest_offering)}` : ''}`)
  }
  if (rows.length) lines.push('The newest filings in the window:')
  else lines.push('No share-issuance filing is in the window.')
  for (const r of rows.slice(0, TEXT_ROWS)) lines.push(`• ${shortDay(r.date)}: ${r.form}${r.what ? `, ${r.what}` : ''}${r.under ? `, under the ${r.under.shelf ? 'shelf' : 'registration'}${r.under.filed ? ` filed ${shortDay(r.under.filed)}` : ''}` : ''}`)
  if (rows.length > TEXT_ROWS) lines.push(`${rows.length - TEXT_ROWS} more ${rows.length - TEXT_ROWS === 1 ? 'is' : 'are'} in the table.`)
  if (total > rows.length) lines.push(`${plural(total, 'filing')} ${total === 1 ? 'is' : 'are'} in the window and the newest ${rows.length} are in this answer: the list is cut from the old end. The counts above cover ${complete ? 'the whole window' : 'everything that was read'}.`)
  if (!complete) lines.push(`The SEC's index was read back ${coveredFrom ? `to ${shortDay(coveredFrom)}` : 'part of the way'} only, not the whole window: a count that needs older filings is not stated, and that is not a count of 0.`)
  if (facts.fund_like) lines.push(`The SEC classes ${symbol} as a fund or its filings are a fund's: share issuance by a fund is routine, and these rows do not mean what they mean for a company.`)
  if (envl.stale) lines.push(`Stale: this is the last good answer UCT holds for ${symbol} and its refresh is overdue. This answer never refreshes it: open the Dilution watch panel (DILU) in UCT, then ask again.`)
  lines.push(asOf ? `The newest filing of any form in the SEC's index for ${symbol} is dated ${dayText(asOf)}: the filings' own date, never the time of this answer.` : `The held answer names no newest filing day for ${symbol}, so I cannot give the filings' own date.`)
  lines.push(read ? `Read by UCT from the SEC's filing index at ${read} (UCT's own time).` : 'The answer carries no read time, so I cannot say how old it is.')
  lines.push(DILUTION_CLASSIFIED)
  lines.push(source)
  return {
    text: lines.join('\n'),
    table: {
      columns: [{ key: 'date', label: 'Filed' }, { key: 'form', label: 'Form' }, { key: 'what', label: 'What it is' }, { key: 'under', label: 'Filed under' }],
      rows: rows.map(r => ({ date: shortDay(r.date), form: r.form, what: r.what || 'not given', under: r.under ? `${r.under.form}${r.under.filed ? `, ${shortDay(r.under.filed)}` : ''}` : 'not given' })),
    },
    present: {
      kind: 'metrics', title: `${symbol} share-issuance filings`, short: `${symbol} dilution watch`,
      items: DILUTION_HORIZON_KEYS.map(k => ({ label: DILUTION_HORIZONS[k], value: horizons[k].m12 == null ? 'not counted' : whole(horizons[k].m12), note: 'last 12 months', aka: [k] })),
    },
    facts,
  }
}

export async function answerDilution(args = {}) {
  const symbol = upper(args.symbol).replace('.', '-')    // a class share the way UCT writes it (BRK.B -> BRK-B), as wave 6
  if (!TICKER.test(symbol)) return { text: `Which company's share-issuance filings should I read? Give me one ticker. ${NOTHING}` }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${symbol}'s share-issuance filings: ${NO_TURN}.` }
  const params = { symbol, rows: clamp(args.rows, DILUTION_MAX_ROWS, DILUTION_DEFAULT_ROWS) }
  const envl = await readData('dilution.watch', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromDilution(envl, symbol)
}

// ── routing words (armed only while registered; routing.js's `marketReads` group lists none) ──────────────────────────
// Routing v2 reaches the six by their summaries. v1 (the kill-switch fallback, and the router the capability-regression
// corpus runs) selects a group by its words, and `marketReads` is words-only: these words are the only way v1 sends it.
// Routing only ADDS a group (the other groups a message names still ride along), and each pattern is kept off another
// capability's own language:
//   regime    the word "regime" itself. Never what a regime IS (the guide), never a stock's gamma regime (wave 3's gamma
//             levels) or a volatility regime;
//   setups    "setup" beside a word for the judge's verdict (confirmed, judged, the chart judge, verdict), or "any / which
//             setups ... on / for" a stock. Never "describe / summarise / walk me through the setup" or "what's the setup
//             here" (chart.describeSetup), never a layer, an indicator template or a switch (UCT Intelligence layers), and
//             never the word "pattern" (the chart's pattern layers and the pattern engine keep it);
//   events    "events timeline", a timeline of events, or dated / stored / key / past / recent events on or for a stock.
//             Never an event STUDY ("how has X behaved after ..."), never a bare "events" (the calendar);
//   uct20     "UCT 20" by name. Never opening the page (navigation), and never a bare "leaders" (a screen). A SCREEN-shaped
//             ask that names it ("which stocks are in the UCT 20", "list the stocks in the UCT 20") never reaches this
//             capability: the Screener's own fixed refusal (screener.js fast path, hidden field `in_uct20`) claims it
//             before any model call. That rail is older than this wave and is not changed here;
//   iv        "IV" or "implied volatility" beside a history or rank word (history, rank, percentile, over time, by day,
//             by session, trend, logged), or "IV rank" / "IV percentile". Never a bare "IV" (the options chain), never a
//             threshold (a screen);
//   dilution  "dilution" and its forms, a shelf registration or shelf offering, share issuance, or a share / stock /
//             secondary offering beside a filing word. Never a bare "offering" (news and catalysts keep it);
//   not ours  a screen or its condition, an alert, a watchlist, the member's own lists, a page or a widget, or what a
//             term MEANS (the guide).
// ⛔ no lookbehind (iOS 16 floor, src/noRegexLookbehind.test.js).
const NOT_A_SCREEN = '^(?!.*\\b(?:scans?|screens?|screener|filters?|find|alerts?|notify|widgets?|page|tab|panel|watchlists?|my)\\b)(?!.*(?:\\b(?:over|above|under|below|at least|more than|less than|greater than)\\b|[<>])\\s*\\$?\\d)'
const NOT_A_MEANING = '(?!.*\\b(?:explain|define|definition|meaning|means?|difference between|how (?:is|are) .* (?:calculated|worked out|computed|decided))\\b)'
  + '(?!what(?:\'s|’s| is| are) (?:an? )?(?:market regime|regime|setup|events timeline|iv rank|iv percentile|implied volatility|iv|dilution|shelf registration|shelf offering)s?\\W*$)'
const OURS = `${NOT_A_SCREEN}${NOT_A_MEANING}`
const NOT_A_SWITCH = '(?!.*\\b(?:layers?|templates?|turn|switch|enable|disable|hide|toggle|describe|summari[sz]e|walk me|pattern\\w*)\\b)'
const NOT_A_STUDY = '(?!.*\\b(?:after|following|since|behav\\w+|happens?|happened|perform\\w*|study)\\b)'
const NOT_A_VISIT = '(?!.*\\b(?:open|go to|take me|navigate|bring up|switch to|portfolio)\\b)'
const NOT_A_GAMMA_REGIME = '(?!.*\\b(?:gamma|dealers?|options?|vol|volatility)\\b)'
const SETUP = '\\bset-?ups?\\b'
const IV = '\\b(?:iv|implied vol(?:atility)?)\\b'
const IV_PAST = '\\b(?:history|historical|rank|ranks|percentile|over time|by day|by session|trend|trended|logged|log|past|last)\\b'
const FILING = '\\b(?:fil(?:e|ed|es|ing|ings)|registered|registrations?|sec|edgar|s-3|s-1)\\b'
export const WAVE7_ROUTE_WORDS = Object.freeze({
  regime: [
    new RegExp(`${OURS}${NOT_A_GAMMA_REGIME}.*\\bregime\\b`),
  ],
  setups: [
    new RegExp(`${OURS}${NOT_A_SWITCH}(?=.*${SETUP}).*\\b(?:confirm(?:ed|s)?|judged?|chart judge|verdicts?)\\b`),
    new RegExp(`${OURS}${NOT_A_SWITCH}.*\\b(?:any|which) (?:\\w+ )?set-?ups? (?:\\w+ ){0,4}(?:on|for)\\b`),
  ],
  events: [
    new RegExp(`${OURS}${NOT_A_STUDY}.*\\bevents? timeline\\b`),
    new RegExp(`${OURS}${NOT_A_STUDY}.*\\btimeline of\\b.*\\bevents?\\b`),
    new RegExp(`${OURS}${NOT_A_STUDY}.*\\b(?:dated|stored|key|past|recent) events\\b.*\\b(?:on|for|around)\\b`),
  ],
  uct20: [
    new RegExp(`${OURS}${NOT_A_VISIT}.*\\buct[ -]?(?:20|twenty)\\b`),
  ],
  iv: [
    new RegExp(`${OURS}(?=.*${IV_PAST}).*${IV}`),
    new RegExp(`${OURS}.*\\b(?:iv rank|iv percentile|ivr)\\b`),
  ],
  dilution: [
    new RegExp(`${OURS}.*\\bdilut(?:ion|ive|ed|ing|es?)\\b`),
    new RegExp(`${OURS}.*\\bshel(?:f|ves)\\b.*\\b(?:registrations?|offerings?|filings?)\\b`),
    new RegExp(`${OURS}.*\\bshare[- ]issuance\\b`),
    new RegExp(`${OURS}(?=.*${FILING}).*\\b(?:share|stock|secondary|follow-on|equity) offerings?\\b`),
  ],
})
export const ROUTE_GROUP = 'marketReads'
const ownGroup = () => GROUPS.find(g => g.id === ROUTE_GROUP)
/** Adds (or takes back) ONE capability's words on the wave's own group. */
function armRoutes(key, on) {
  const g = ownGroup()
  if (!g) return
  for (const re of WAVE7_ROUTE_WORDS[key]) {
    const at = g.words.indexOf(re)
    if (on && at < 0) g.words.push(re)
    if (!on && at >= 0) g.words.splice(at, 1)
  }
}

// ── registration: each capability only while the server serves ITS kind ───────────────────────────────────────────────
// ⚠️ THE WORDS OF A SUMMARY AND OF ITS HINTS JOIN THE TYPO LEXICON (nl/lexicon.js: every lowercase word of three letters or
// more; a word in CAPITALS does not). A new known word changes what a nearby word in ANY member message may be "corrected"
// to, so the text below is worded to leave every existing capability-regression phrasing's corrections exactly as they
// were (pinned in agentTerminalDataWave7.test.js, "the typo lexicon").
const TARGET_HINT = 'target = the ref of the stockData entry.'
const NO_FIGURES = 'reply: one short line, no figures.'
const HELD_ONLY = 'Answered only from what the SERVER already HOLDS, so it may say none is held.'
const SYMBOL_HINT = 'symbol = the one ticker named (or the open chart\'s symbol).'
const symbolRows = { type: 'object', properties: { symbol: { type: 'string' }, rows: { type: ['integer', 'null'] } }, required: ['symbol', 'rows'], additionalProperties: false }
const unregister = {}

/** Idempotent; registers each of the six ONLY while the server serves its kind. Returns the names registered by this call. */
export function registerTerminalWave7Capabilities() {
  const added = []
  if (!unregister.regime && kindServed(KINDS.regime)) {
    unregister.regime = registerCapability({
      name: 'stock.marketRegime',       // a LITERAL: the server's local-only mirror rail reads it (tests/test_uct_agent_breadth.py)
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ built on breadth and composite figures the licensing register restricts: shown to the member, never to a model
      summary: 'UCT\'s MARKET REGIME read as the SERVER last COMPUTED it: the REGIME, its SIZING BAND, the CLASSIFIER\'s CONFIDENCE and the BREADTH figures BEHIND it. '
        + 'For "what is the MARKET REGIME", "which REGIME are we in", "UCT REGIME read".',
      hints: `${TARGET_HINT} No ARGUMENTS. The date is the time the SERVER COMPUTED the read: never today's ask, and it never RECOMPUTES. What UCT's RULES read, not ADVICE and not a FORECAST. ${HELD_ONLY} `
        + `The EXPOSURE RATING and VIX are not in this answer. ${NO_FIGURES}`,
      args: { type: 'object', properties: {}, required: [], additionalProperties: false },
      answer: () => answerRegime(),
    })
    armRoutes('regime', true)
    added.push(CAPABILITIES.regime)
  }
  if (!unregister.setups && kindServed(KINDS.setups)) {
    unregister.setups = registerCapability({
      name: 'stock.setups',             // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ UCT's derived chart analytics, which the licensing register restricts: shown to the member, never to a model
      summary: 'The SETUPS UCT\'s chart JUDGE CONFIRMED on one stock\'s DAILY chart, as STORED: each SETUP, the DAILY BAR it was JUDGED on, the JUDGE\'s CONFIDENCE and its KEY LEVEL, newest first. '
        + 'For "CONFIRMED SETUPS on NVDA", "which SETUPS did the JUDGE CONFIRM for TSLA", "any SETUPS on AAPL".',
      hints: `${TARGET_HINT} ${SYMBOL_HINT} ROWS 1-${SETUPS_MAX_ROWS} (null = ${SETUPS_DEFAULT_ROWS}). The date is the DAILY BAR a SETUP was JUDGED on: never today. A RECORD, not a FORECAST and not ADVICE. `
        + `Answered only from STORED VERDICTS, so it may say none is STORED; it never runs a DETECTION. DESCRIBING the chart in view is not this answer. ${NO_FIGURES}`,
      args: symbolRows,
      answer: (_snap, args) => answerSetups(args || {}),
    })
    armRoutes('setups', true)
    added.push(CAPABILITIES.setups)
  }
  if (!unregister.events && kindServed(KINDS.events)) {
    unregister.events = registerCapability({
      name: 'stock.eventsTimeline',     // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ carries the vendor's earnings figures, which the licensing register does not clear for a model: shown to the member, never to a model
      summary: 'One stock\'s EVENTS TIMELINE from UCT\'s own STORES: EARNINGS reports and the next SCHEDULED one, days the CATALYST ENGINE FLAGGED it, SEC FILINGS and days the ROOM\'s MENTIONS SPIKED, each placed against the NEAREST report. '
        + 'For "NVDA EVENTS TIMELINE", "TIMELINE of EVENTS for TSLA", "DATED EVENTS on AAPL".',
      hints: `${TARGET_HINT} ${SYMBOL_HINT} ROWS 1-${EVENTS_MAX_ROWS} (null = ${EVENTS_DEFAULT_ROWS}). The date is the newest EVENT that is not in the FUTURE: never today. A RECORD, not a FORECAST and not ADVICE. `
        + `Answered only from STORED EVENTS, so it may say a source did not answer. How a stock BEHAVED after an EVENT is the price history, not this answer. ${NO_FIGURES}`,
      args: symbolRows,
      answer: (_snap, args) => answerEvents(args || {}),
    })
    armRoutes('events', true)
    added.push(CAPABILITIES.events)
  }
  if (!unregister.uct20 && kindServed(KINDS.uct20)) {
    unregister.uct20 = registerCapability({
      name: 'stock.uct20List',          // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ a UCT composite built on restricted analytics (the licensing register): shown to the member, never to a model
      summary: 'The UCT 20 LEADERSHIP list as the MORNING WIRE last PUSHED it: each name\'s RANK in the list, its RS, its RATING, its one-MONTH and three-MONTH returns and its next EARNINGS date. '
        + 'For "the UCT 20", "what is on the UCT 20 list", "top five of the UCT 20".',
      hints: `${TARGET_HINT} ROWS 1-${UCT20_MAX_ROWS} (null = ${UCT20_DEFAULT_ROWS}; the top of the list). The date is the WIRE run's own date: never today. UCT's own SELECTION, not ADVICE and not a FORECAST. ${HELD_ONLY} `
        + `The MODEL PORTFOLIO and each name's ENTRY, STOP and TARGETS are not in this answer. ${NO_FIGURES}`,
      args: { type: 'object', properties: { rows: { type: ['integer', 'null'] } }, required: ['rows'], additionalProperties: false },
      answer: (_snap, args) => answerUct20(args || {}),
    })
    armRoutes('uct20', true)
    added.push(CAPABILITIES.uct20)
  }
  if (!unregister.iv && kindServed(KINDS.iv)) {
    unregister.iv = registerCapability({
      name: 'stock.ivHistory',          // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ the vendor's options data from UCT's options log, cleared for display to members only: shown to the member, never to a model
      summary: 'One stock\'s AT-THE-MONEY IMPLIED VOLATILITY by LOGGED SESSION from UCT\'s options LOG, newest first, with its IV RANK and IV PERCENTILE over the LOGGED SESSIONS. '
        + 'For "NVDA IV HISTORY", "IV RANK for TSLA", "how has AAPL IMPLIED VOLATILITY TRENDED".',
      hints: `${TARGET_HINT} ${SYMBOL_HINT} ROWS 1-${IV_MAX_ROWS} (null = ${IV_DEFAULT_ROWS}). The date is the newest LOGGED SESSION: never today, and never a QUOTE from a SESSION still trading. ${HELD_ONLY} `
        + `It never READS the options CHAIN; a RANK over a short LOG is said as that. ${NO_FIGURES}`,
      args: symbolRows,
      answer: (_snap, args) => answerIv(args || {}),
    })
    armRoutes('iv', true)
    added.push(CAPABILITIES.iv)
  }
  if (!unregister.dilution && kindServed(KINDS.dilution)) {
    unregister.dilution = registerCapability({
      name: 'stock.dilutionWatch',      // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ the licensing register clears these filings for the member's panel and names no AI lane: shown to the member, never to a model
      summary: 'One company\'s SHARE-ISSUANCE FILINGS from the SEC\'s FILING INDEX (DILUTION watch): its SHELF REGISTRATIONS and their state, counts of OFFERINGS, UNREGISTERED SALES and REGISTRATIONS, and the newest FILINGS. '
        + 'For "NVDA DILUTION", "does TSLA have a SHELF REGISTRATION", "SHARE OFFERINGS AAPL FILED".',
      hints: `${TARGET_HINT} ${SYMBOL_HINT} ROWS 1-${DILUTION_MAX_ROWS} (null = ${DILUTION_DEFAULT_ROWS}). The date is the newest FILING's own day: never today. A RECORD of FILINGS, not a FORECAST and not ADVICE. ${HELD_ONLY} `
        + `CLASSIFIED from the FORM type alone: no FILING DOCUMENT is read. News about an OFFERING is not this answer. ${NO_FIGURES}`,
      args: symbolRows,
      answer: (_snap, args) => answerDilution(args || {}),
    })
    armRoutes('dilution', true)
    added.push(CAPABILITIES.dilution)
  }
  return added
}
export const _resetTerminalWave7ForTest = () => {
  for (const k of Object.keys(unregister)) { unregister[k]?.(); delete unregister[k] }
  for (const k of Object.keys(WAVE7_ROUTE_WORDS)) armRoutes(k, false)
}
