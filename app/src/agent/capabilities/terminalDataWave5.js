// UCT Agent — terminal data wave 5: two LOCAL-ONLY answers (the Agent half of the SHINT and SHRTS terminal panels).
//
//   stock.shortInterest   one stock's FINRA short interest: the newest report (settlement date, shares short, days to cover,
//                         the change from the report before), percent of float, its recent reports and its daily short volume
//   stock.shortList       the newest FINRA short interest report across the stocks UCT follows, ranked by days to cover, by the
//                         biggest increase or decrease in short interest, or by percent of float
//
// DATA: ONE gateway read each (`short.interest`, `short.list`; api/services/uct_agent/marketdata/, MD-1 §4.14). No read of
// this wave starts a build, a look for a newer report or a vendor request: each is answered only from what the server
// already holds, so each can say "not held".
// Rows are shaped by the matching panel's own pure helpers (pages/terminal/panels/: shortInterestModel `shortDataRead` /
// `ratioSummary`, shortListModel `shortListRead`), so the panel and the Agent read one shape. A rank is read by the SHRTS
// panel's own word map (`parseShortRank`, SHORT_RANK_ARG_WORDS): there is one map, the panel's, and none here.
// HONESTY: the date an answer states is the report's SETTLEMENT DATE, with the time UCT read it beside it: never today, and
// never live or now (MD-1 §3). FINRA's own cautions are said wherever they apply: a report is about two weeks old when it is
// published; daily short volume is not short interest and covers off-exchange trades only; percent of float sets a
// settlement date's short interest against today's float. A failed read is never "nothing to show": an answer that is not
// held, a data plan that refuses it and a read that failed are never "no short interest". A number that does not exist is
// never 0: no days to cover, no change, no float, no percent of float and no short volume ratio are each said as missing.
// GROUNDING: the text is templated from `facts` (returned beside it): every number in it is a fact's.
// ⛔ LOCAL ONLY (turn.LOCAL_ONLY_ACTIONS; both kinds are model-isolated, ADR-005): the model plans the lookup and never sees
// what came back. Every capability in THIS module is local-only: the isolation rail (qa/modelIsolation.test.jsx) holds the
// whole module to that.
//
// Dark by construction: each is registered only while the server serves its own kind (UCT_AGENT_DATA_KINDS, fail closed; an
// isolated kind also needs its own UCT_AGENT_ISOLATED_KINDS entry or every read is refused).
// ROUTING: the two have their OWN words-only group, `shortInterest` (routing.js lists them by action: the stock `data` group
// their domain names has no room under the routing budget, and waves 3 and 4 hold their own groups at their sizes). Each one's
// own words (WAVE5_ROUTE_WORDS) are added to that group only while it is registered, so on a dark server the group has no
// words and no registered action, and routing is byte-identical to the base.
import { registerCapability } from '../capabilities'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { GROUPS } from '../routing'
import { stampET } from './marketDataFacts'
import { shortDataRead, ratioSummary, REPORTS_SHOWN, REPORTS_MORE, VOLUME_DAYS_SHOWN } from '../../pages/terminal/panels/shortInterestModel'
import { SHORT_RANKS, DEFAULT_SHORT_RANK, parseShortRank, shortListRead } from '../../pages/terminal/panels/shortListModel'
import { kindServed, usable, noRead, pct, whole, plural, dayText, NO_TURN } from './terminalDataFormat'

export const KINDS = Object.freeze({ interest: 'short.interest', list: 'short.list' })
export const CAPABILITIES = Object.freeze({ interest: 'stock.shortInterest', list: 'stock.shortList' })
const NONE_STATED = 'No figure is stated.'
const TEXT_ROWS = 5
const DESCRIPTIVE = 'Descriptive only: nothing here is a prediction.'
const TICKER = /^[A-Z]{1,5}(?:[.-][A-Z]{1,2})?$/                       // the service's own symbol rule (short_data.py _SYMBOL)
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const upper = (s) => String(s || '').trim().toUpperCase().replace(/^\$/, '')
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v) => (Number.isInteger(v) ? v : null)
const clamp = (v, max, fallback) => (Number.isInteger(v) ? Math.min(Math.max(v, 1), max) : fallback)
const isoDay = (v) => (typeof v === 'string' && ISO_DAY.test(v) ? v : null)
/** "Fri, Nov 13, 2026" → "Nov 13, 2026" */
const shortDay = (ymd) => (dayText(ymd) || '').replace(/^\w+, /, '') || null
/** "3,000,000 shares", or null. */
const shares = (v) => (num(v) == null ? null : `${whole(v)} ${Math.round(v) === 1 ? 'share' : 'shares'}`)
/** A signed count of shares: "+1,000,000 shares" / "−400,000 shares" / "0 shares", or null. */
const sharesChange = (v) => (num(v) == null ? null : `${v > 0 ? '+' : v < 0 ? '−' : ''}${whole(Math.abs(v))} ${Math.abs(Math.round(v)) === 1 ? 'share' : 'shares'}`)
/** Days to cover to two decimals, as the vendor gives it: "6.00", or null. */
const dtcText = (v) => (num(v) == null ? null : v.toFixed(2))
/** A percent with no sign: "30.00%", or null. */
const size2 = (v) => (num(v) == null ? null : `${Math.abs(v).toFixed(2)}%`)
/** A short volume ratio to ONE decimal: "40.0%", or null. */
const ratio1 = (v) => (num(v) == null ? null : `${v.toFixed(1)}%`)

// ── what every answer of this wave says (FINRA's own cautions, in plain words) ─────────────────────────────────────────
export const REPORT_LAG = 'FINRA collects short interest twice a month and publishes it about two weeks later, so a report is already about two weeks old when it comes out.'
export const VOLUME_CAUTION = 'Daily short volume is not short interest: it counts shares sold short in one day\'s off-exchange trades only, most of them bought back the same day, and says nothing about how many shares are still held short.'
export const FLOAT_CAUTION = 'Percent of float divides the settlement date\'s short interest by today\'s float from the nightly screener export, so the two figures are from different days.'
export const DTC_MEANING = 'Days to cover is the data vendor\'s own figure: shares short against the average daily volume.'
const SOURCE_LINE = `Source: FINRA short interest, read through UCT's market-data vendor. ${DESCRIPTIVE}`
const publishedLine = (estimate) => (estimate ? ` By FINRA's schedule this one was published on ${shortDay(estimate)} (an estimate: the publication day is not in the data).` : '')
const readLine = (read) => (read ? `Read by UCT from the data vendor at ${read} (UCT's own time).` : 'The answer carries no read time, so I cannot say how old it is.')

// ── stock.shortInterest ────────────────────────────────────────────────────────────────────────────────────────────────
export const INTEREST_DEFAULT_REPORTS = REPORTS_SHOWN                 // the SHINT panel's own first draw
export const INTEREST_MAX_REPORTS = REPORTS_MORE                      // and its "Show more" step
export const INTEREST_DEFAULT_DAYS = VOLUME_DAYS_SHOWN
export const INTEREST_MAX_DAYS = 60                                   // the service's own short volume window (SV_DAYS)
const SECTION_NAMES = { interest: 'Short interest', volume: 'Daily short volume' }
/** Why one dataset is not stated (pure). Null when it is stated, or when the vendor simply holds none. */
function sectionWhy(name, section) {
  if (section.state === 'unavailable') {
    return section.reason === 'not_configured'
      ? `${SECTION_NAMES[name]} is not stated: this server has no key for the data vendor. That is not the same as none.`
      : `${SECTION_NAMES[name]} is not stated: the data vendor refused it for this site's data plan when the server last asked. That is not the same as none.`
  }
  return section.state === 'failed' ? `${SECTION_NAMES[name]} is not stated: the server's last read of it failed. That is not the same as none.` : null
}

/** The `short.interest` envelope → the member's answer + its facts (pure). Rows: shortInterestModel `shortDataRead`. */
export function answerFromInterest(envl, symbol) {
  if (!usable(envl)) {
    return { text: noRead(`${symbol}'s short interest`, envl, `none is held on the server at the moment (it is kept for a few hours after the Short interest panel reads that stock, and this answer never starts a read from the data vendor), or the data plan does not include it, or the server's last read of it failed. Open ${symbol}'s Short interest panel, then ask again`, `${NONE_STATED} That is not the same as no short interest.`) }
  }
  const d = envl.data
  const view = shortDataRead({ ...d, status: 'ok' })                 // the kind's data keeps the route's own names
  if (view.state !== 'ok') return { text: `I couldn't read ${symbol}'s short interest: UCT's data did not answer cleanly. ${NONE_STATED} That is not the same as no short interest.` }
  const reports = view.interest.rows.map(r => ({
    settlement_date: r.date, shares_short: r.short, shares_text: shares(r.short), average_daily_volume: r.adv, days_to_cover: r.dtc, days_to_cover_text: dtcText(r.dtc),
    // no report before (or a report before of zero shares): no change, never 0
    change_shares: r.changeShares, change_shares_text: sharesChange(r.changeShares), change_pct: r.changePct, change_pct_text: pct(r.changePct),
  }))
  const days = view.volume.rows.map(r => ({ date: r.date, short_volume: r.short, total_volume: r.total, ratio_pct: r.ratio, ratio_text: ratio1(r.ratio) }))
  const latest = reports[0] || null
  const settled = latest ? latest.settlement_date : null
  const before = reports[1] ? reports[1].settlement_date : null
  const held = { reports: int(d.interest?.count) ?? reports.length, days: int(d.volume?.count) ?? days.length }
  const ratio = ratioSummary(view.volume.rows)
  const read = stampET(view.readAt, envl.fetched_at)
  const facts = {
    symbol, settlement_date: settled, settlement_day: dayText(settled), publication_estimate: view.publicationEstimate, read, held: d.held || null, stale: !!envl.stale,
    interest_state: view.interest.state, volume_state: view.volume.state, latest,
    float: { shares: view.float.shares, pct: view.float.withheld ? null : view.float.pct, pct_text: view.float.withheld ? null : size2(view.float.pct), withheld: view.float.withheld, state: view.float.state },
    reports_held: held.reports, reports_shown: reports.length, history_cut: view.interest.cut, first_report_date: isoDay(d.interest?.first_date),
    days_held: held.days, days_shown: days.length, volume_ratio: ratio, reports, volume_days: days,
  }
  const lines = []
  if (latest) {
    lines.push(`${symbol} short interest, FINRA's report for settlement date ${facts.settlement_day}: ${latest.shares_text} short${latest.days_to_cover_text ? `, ${latest.days_to_cover_text} days to cover` : ', days to cover not given'}${latest.average_daily_volume != null ? ` (average daily volume ${shares(latest.average_daily_volume)})` : ''}.`)
    lines.push(latest.change_shares_text
      ? `Change from the report before${before ? ` (${shortDay(before)})` : ''}: ${latest.change_shares_text}${latest.change_pct_text ? ` (${latest.change_pct_text})` : ', with no percent (the report before was zero shares)'}.`
      : 'There is no earlier report here to compare with, so no change is stated.')
    if (facts.float.withheld) lines.push('Percent of float is withheld: short interest is more than one and a half times the float on file, so the two figures do not describe the same share count (a split or an offering since the settlement date).')
    else if (facts.float.pct_text) lines.push(`Percent of float: ${facts.float.pct_text}${facts.float.shares != null ? `, against a float of ${shares(facts.float.shares)}` : ''}${facts.float.state === 'stale' ? ' (the float on file is older than usual)' : ''}.`)
    else lines.push('Percent of float is not stated: no float is on file for this stock. That is not 0%.')
    if (reports.length > 1) {
      lines.push(`${reports.length < held.reports ? `The newest ${reports.length} of the ${held.reports} reports the server holds (the older ones are left out)` : `All ${reports.length} reports the server holds`}, newest first:`)
      for (const r of reports.slice(0, TEXT_ROWS)) {
        lines.push(`• ${shortDay(r.settlement_date)}: ${r.shares_text}${r.change_pct_text ? `, ${r.change_pct_text} from the report before` : r.change_shares_text ? `, ${r.change_shares_text} from the report before` : ', nothing earlier to compare with'}${r.days_to_cover_text ? `, ${r.days_to_cover_text} days to cover` : ''}`)
      }
      if (reports.length > TEXT_ROWS) lines.push(`(${reports.length - TEXT_ROWS} more in the table.)`)
    }
    if (facts.history_cut) lines.push(`The server read only the newest reports: the history here stops at ${shortDay(facts.first_report_date) || 'a date not given'}, and older reports exist.`)
    lines.push(DTC_MEANING)
  } else if (view.interest.state === 'none') {
    lines.push(`The data vendor holds no FINRA short interest report for ${symbol}. That is a normal answer, not a failed read, and it is not zero shares short.`)
  }
  const interestWhy = sectionWhy('interest', view.interest)
  if (interestWhy) lines.push(interestWhy)
  if (days.length) {
    const newest = days[0]
    lines.push(`Daily short volume, the newest ${plural(days.length, 'day')}${days.length < held.days ? ` of the ${held.days} the server holds` : ''}: ${ratio
      ? `on average ${ratio1(ratio.avg)} of the reported volume was sold short (low ${ratio1(ratio.low)}, high ${ratio1(ratio.high)}, over ${plural(ratio.n, 'day')} with a ratio)`
      : 'no day carries a short share of volume'}; the newest day is ${dayText(newest.date)}, ${shares(newest.short_volume)} sold short${newest.ratio_text ? ` (${newest.ratio_text} of the volume reported)` : ', its share of volume not given'}.`)
    lines.push(VOLUME_CAUTION)
  } else if (view.volume.state === 'none') {
    lines.push(`The data vendor holds no daily short volume for ${symbol}. That is a normal answer, not a failed read.`)
  }
  const volumeWhy = sectionWhy('volume', view.volume)
  if (volumeWhy) lines.push(volumeWhy)
  if (latest) {
    lines.push(`${REPORT_LAG}${publishedLine(facts.publication_estimate)}`)
    if (facts.float.pct_text) lines.push(FLOAT_CAUTION)
  }
  lines.push(readLine(read))
  if (d.held === 'last_good') lines.push('Stale: this is the last good answer for that stock, so a report or a day of short volume published since is missing.')
  lines.push(SOURCE_LINE)
  return {
    text: lines.join('\n'),
    ...(reports.length ? { table: {
      columns: [{ key: 'date', label: 'Settlement date' }, { key: 'shares', label: 'Shares short' }, { key: 'change', label: 'Change' }, { key: 'change_pct', label: 'Change %' },
        { key: 'dtc', label: 'Days to cover' }, { key: 'adv', label: 'Average daily volume' }],
      rows: reports.map(r => ({ date: shortDay(r.settlement_date), shares: whole(r.shares_short), change: r.change_shares_text || 'not given', change_pct: r.change_pct_text || 'not given',
        dtc: r.days_to_cover_text || 'not given', adv: whole(r.average_daily_volume) || 'not given' })),
    }, present: {
      kind: 'metrics', title: `${symbol} short interest, ${shortDay(settled)}`, short: symbol,
      items: [
        { label: 'Shares short', value: whole(latest.shares_short), note: `settlement date ${shortDay(settled)}`, aka: ['short interest'] },
        latest.days_to_cover_text ? { label: 'Days to cover', value: latest.days_to_cover_text, note: '', aka: ['days to cover'] } : null,
        facts.float.pct_text ? { label: 'Percent of float', value: facts.float.pct_text, note: '', aka: ['percent of float'] } : null,
        latest.change_pct_text ? { label: 'Change', value: latest.change_pct_text, note: 'from the report before', aka: ['change'] } : null,
      ].filter(Boolean),
    } } : {}),
    facts,
  }
}

export async function answerInterest(args = {}) {
  const symbol = upper(args.symbol).replace('.', '-')
  if (!TICKER.test(symbol)) return { text: `Which stock's short interest should I read? Give me one ticker. ${NONE_STATED}` }
  const params = { symbol, reports: clamp(args.reports, INTEREST_MAX_REPORTS, INTEREST_DEFAULT_REPORTS), days: clamp(args.days, INTEREST_MAX_DAYS, INTEREST_DEFAULT_DAYS) }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${symbol}'s short interest: ${NO_TURN}.` }
  const envl = await readData('short.interest', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromInterest(envl, symbol)
}

// ── stock.shortList ────────────────────────────────────────────────────────────────────────────────────────────────────
export const LIST_RANK_KEYS = Object.keys(SHORT_RANKS)                // dtc | up | down | float: the SHRTS panel's own
export const LIST_MAX_ROWS = 50
const LIST_DEFAULT_ROWS = 25
/** What each rank needs of a stock, said of the count the rank covers. */
const RANKED_WORDS = { dtc: 'have days to cover', up: 'rose from a previous report big enough to rank', down: 'fell from a previous report big enough to rank', float: 'have a percent of float' }
const CHECK_WORDS = 'Stale: the server\'s last look for a newer report did not go well, so this is the last report it read and a newer one may exist.'

/** A member's or the planner's word for a rank → the panel's key, by the panel's OWN word map; null when it names none.
 *  No word at all is the panel's default. Pure. */
export function rankOf(raw) {
  if (raw == null || raw === '') return DEFAULT_SHORT_RANK
  if (typeof raw !== 'string') return null
  const key = raw.trim().toLowerCase()
  return Object.prototype.hasOwnProperty.call(SHORT_RANKS, key) ? key : parseShortRank(raw)
}

function listRow(r) {
  return {
    symbol: r.sym, shares_short: r.short, shares_text: shares(r.short), average_daily_volume: r.adv, days_to_cover: r.dtc, days_to_cover_text: dtcText(r.dtc),
    // no previous report: no change; no float on file (or a withheld mismatch): no percent of float. Null, never 0
    previous_shares_short: r.prevShort, change_shares: r.changeShares, change_pct: r.changePct, change_pct_text: pct(r.changePct),
    float_shares: r.floatShares, pct_float: r.pctFloat, pct_float_text: size2(r.pctFloat),
  }
}
/** One row's sentence, the ranked number first (pure). */
function rowLine(r, rank) {
  const dtc = r.days_to_cover_text ? `${r.days_to_cover_text} days to cover` : 'days to cover not given'
  const change = r.change_pct_text ? `${r.change_pct_text} from the report before` : 'no previous report to compare with'
  const float = r.pct_float_text ? `${r.pct_float_text} of float` : 'percent of float not given'
  const parts = rank === 'float' ? [float, `${r.shares_text} short`, change, dtc] : rank === 'dtc' ? [dtc, `${r.shares_text} short`, change, float] : [change, `${r.shares_text} short`, dtc, float]
  return `• ${r.symbol}: ${parts.join('; ')}`
}

/** The `short.list` envelope → the member's answer + its facts (pure). Rows: shortListModel `shortListRead`. */
export function answerFromList(envl) {
  if (!usable(envl)) {
    return { text: noRead('the short interest list', envl, 'none is held on the server at the moment (it is read when the Short interest list panel is first opened, and this answer never starts a read from the data vendor), or the data plan does not include it, or the server\'s last read of it failed. Open the Short interest list panel, then ask again', `${NONE_STATED} That is not the same as no stock being short.`) }
  }
  const d = envl.data
  const view = shortListRead({ ...d, status: 'ok' })                 // the kind's data keeps the route's own names
  if (view.state !== 'ok') return { text: `I couldn't read the short interest list: UCT's data did not answer cleanly. ${NONE_STATED} That is not the same as no stock being short.` }
  const rank = view.rank
  const order = SHORT_RANKS[rank].words                               // the panel's own words for the order
  const rows = view.rows.map(listRow)
  const ranked = Math.max(view.ranked ?? 0, rows.length)
  const read = stampET(view.readAt, envl.fetched_at)
  const due = isoDay(d.newer_report_due)
  const facts = {
    rank, order, settlement_date: view.settlementDate, settlement_day: dayText(view.settlementDate), previous_settlement_date: view.previousDate,
    publication_estimate: view.publicationEstimate, newer_report_landing: view.landing, newer_report_due: due, read, stale: !!envl.stale,
    in_report: view.count, followed: view.universe, ranked, shown: rows.length, cut: rows.length < ranked, floor_shares: view.floorShares,
    float_state: view.float.state, float_withheld: view.float.withheld, check_failed: !!view.check, rows,
  }
  const lines = []
  const counted = view.count != null && view.universe != null ? `${whole(view.count)} of the ${whole(view.universe)} stocks UCT follows are in the report` : 'the count of stocks in the report is not given'
  lines.push(`Short interest list, FINRA's report for settlement date ${facts.settlement_day}${view.previousDate ? ` (the report before it: ${shortDay(view.previousDate)})` : ''}: ${counted}; ${whole(ranked)} ${RANKED_WORDS[rank]}.`)
  if (!rows.length) {
    lines.push(`No stock in the report has the number this order needs (${order}). That is a statement about the report the server holds, not a failed read.`)
  } else {
    lines.push(`${rows.length < ranked ? `The first ${rows.length} of the ${whole(ranked)}, ${order} (the lowest ranked are left out)` : rows.length === 1 ? `The 1 stock, ${order}` : `All ${rows.length}, ${order}`}:`)
    for (const r of rows.slice(0, TEXT_ROWS)) lines.push(rowLine(r, rank))
    if (rows.length > TEXT_ROWS) lines.push(`(${rows.length - TEXT_ROWS} more in the table.)`)
  }
  if (rank === 'dtc') lines.push(`${DTC_MEANING} A stock with none is not ranked, never ranked as 0.`)
  else if (rank === 'float') {
    lines.push(view.float.state === 'missing' ? 'The screener export the float comes from could not be read when the list was put together, so no percent of float is stated. That is not the same as no stock being short.'
      : `${FLOAT_CAUTION} A stock with no float on file is not ranked${view.float.withheld ? `, and ${plural(view.float.withheld, 'stock')} whose short interest is more than one and a half times its float ${view.float.withheld === 1 ? 'is' : 'are'} withheld as a mismatch` : ''}.`)
  } else {
    lines.push(`A percent change is ranked only for stocks whose previous report was at least ${view.floorShares != null ? shares(view.floorShares) : 'a set number of shares'}, so a tiny base cannot top the list.${view.previousDate ? '' : ' The server holds no previous report, so no change is stated: that is not a change of 0.'}`)
  }
  if (view.landing) lines.push(`A newer report, for settlement date ${shortDay(view.landing)}, is still arriving at the data vendor, so this list is the report before it.`)
  if (view.check) lines.push(CHECK_WORDS)
  if (due) lines.push(`Stale: by FINRA's schedule the report for settlement date ${shortDay(due)} has been published and the server has not read it, so this list may be one report behind.`)
  lines.push(`${REPORT_LAG}${publishedLine(view.publicationEstimate)}`)
  lines.push(readLine(read))
  lines.push(SOURCE_LINE)
  return {
    text: lines.join('\n'),
    ...(rows.length ? { table: {
      columns: [{ key: 'symbol', label: 'Symbol' }, { key: 'shares', label: 'Shares short' }, { key: 'dtc', label: 'Days to cover' }, { key: 'change', label: 'Change from the report before' },
        { key: 'float', label: 'Percent of float' }, { key: 'adv', label: 'Average daily volume' }],
      rows: rows.map(r => ({ symbol: r.symbol, shares: whole(r.shares_short), dtc: r.days_to_cover_text || 'not given', change: r.change_pct_text || 'not given', float: r.pct_float_text || 'not given',
        adv: whole(r.average_daily_volume) || 'not given' })),
    }, present: {
      kind: 'metrics', title: `Short interest list, ${shortDay(view.settlementDate)}`, short: 'Short interest list',
      items: rows.slice(0, TEXT_ROWS * 2).map(r => ({ label: r.symbol, value: rank === 'float' ? r.pct_float_text : rank === 'dtc' ? r.days_to_cover_text : r.change_pct_text,
        note: rank === 'float' ? 'of float' : rank === 'dtc' ? 'days to cover' : 'from the report before', aka: [r.symbol.toLowerCase()] })).filter(i => i.value),
    } } : {}),
    facts,
  }
}

export async function answerList(args = {}) {
  const rank = rankOf(args.rank)
  if (!rank) return { text: `Which order should I rank the short interest list by? ${LIST_RANK_KEYS.map(k => SHORT_RANKS[k].chip).join(', ')}. ${NONE_STATED}` }
  const params = { rank, limit: clamp(args.limit, LIST_MAX_ROWS, LIST_DEFAULT_ROWS) }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the short interest list: ${NO_TURN}.` }
  const envl = await readData('short.list', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromList(envl)
}

// ── routing words (armed only while registered; routing.js's `shortInterest` group lists none) ────────────────────────
// Routing v2 reaches the two by their summaries. v1 (the kill-switch fallback, and the router the capability-regression
// corpus runs) selects a group by its words, and `shortInterest` is words-only: these words are the only way v1 sends it.
// Routing only ADDS a group (the other groups a message names still ride along: "short interest" still names the Screener,
// where a screen with a condition belongs), and each pattern is kept off another capability's own language:
//   every word   FINRA's own terms only: short interest, short volume, days to cover, shorted, sold short. Never a bare
//                "short" (a bearish side: the confluence board's SHORT, a short setup, going short, net short futures),
//                never "short float" (the Screener's field), never "short squeeze" (a screen), never open interest;
//   not ours     a screen or its condition ("find", "scan", a threshold such as "above 20%"), an alert, a watchlist, the
//                member's own lists, a page or a widget, or what a term MEANS (the guide);
//   interest     ONE stock: none of the list's ranking or universe words;
//   list         the market-wide ranking: a superlative, a rank or a universe word beside FINRA's term.
// ⛔ no lookbehind (iOS 16 floor, src/noRegexLookbehind.test.js).
const NOT_A_SCREEN = '^(?!.*\\b(?:scans?|screens?|screener|filters?|find|alerts?|notify|widgets?|page|tab|panel|watchlists?|my|squeezes?)\\b)(?!.*(?:\\b(?:over|above|under|below|at least|more than|less than|greater than)\\b|[<>])\\s*\\$?\\d)'
const NOT_A_MEANING = '(?!.*\\b(?:explain|define|definition|meaning|means?|difference between|how (?:is|are) .* (?:calculated|worked out|computed))\\b)(?!what(?:\'s|’s| is| are) (?:an? |the )?(?:short interest|short volume|days to cover)\\W*$)'
const LIST_WORDS = '\\b(?:most|highest|biggest|largest|lowest|smallest|top|ranked|ranking|rank|list|leaders|leaderboard|stocks|names|tickers|market[\\s-]wide|across the market|whole market)\\b'
const ONE_STOCK = `${NOT_A_SCREEN}${NOT_A_MEANING}(?!.*${LIST_WORDS})`
const THE_MARKET = `${NOT_A_SCREEN}${NOT_A_MEANING}`
export const WAVE5_ROUTE_WORDS = Object.freeze({
  interest: [
    new RegExp(`${ONE_STOCK}.*\\bshort interest\\b`),
    new RegExp(`${ONE_STOCK}.*\\bshort (?:sale )?volume\\b`),
    new RegExp(`${ONE_STOCK}.*\\bdays to cover\\b`),
    new RegExp(`${ONE_STOCK}.*(?:\\bhow (?:heavily |much |highly )?shorted\\b|\\bhow (?:much|many)\\b.*\\bsold short\\b|\\b(?:heavily|highly) shorted\\b)`),
  ],
  list: [
    new RegExp(`${THE_MARKET}(?=.*${LIST_WORDS}).*\\bshort interest\\b`),
    new RegExp(`${THE_MARKET}(?=.*${LIST_WORDS}).*\\bdays to cover\\b`),
    new RegExp(`${THE_MARKET}.*\\b(?:most|heaviest)[\\s-](?:heavily[\\s-])?shorted\\b`),
  ],
})
export const ROUTE_GROUP = 'shortInterest'
const ownGroup = () => GROUPS.find(g => g.id === ROUTE_GROUP)
/** Adds (or takes back) ONE capability's words on the wave's own group. */
function armRoutes(key, on) {
  const g = ownGroup()
  if (!g) return
  for (const re of WAVE5_ROUTE_WORDS[key]) {
    const at = g.words.indexOf(re)
    if (on && at < 0) g.words.push(re)
    if (!on && at >= 0) g.words.splice(at, 1)
  }
}

// ── registration: each capability only while the server serves ITS kind ───────────────────────────────────────────────
// ⚠️ THE WORDS OF A SUMMARY AND OF ITS HINTS JOIN THE TYPO LEXICON (nl/lexicon.js: every lowercase word of three letters or
// more; a word in CAPITALS does not). A new known word changes what a nearby word in ANY member message may be "corrected"
// to, so the text below is worded to leave every existing capability-regression phrasing's corrections exactly as they
// were (pinned in agentTerminalDataWave5.test.js, "the typo lexicon").
const TARGET_HINT = 'target = the ref of the stockData entry.'
const NO_FIGURES = 'reply: one short line, no figures.'
const unregister = {}

/** Idempotent; registers each of the two ONLY while the server serves its kind. Returns the names registered by this call. */
export function registerTerminalWave5Capabilities() {
  const added = []
  if (!unregister.interest && kindServed(KINDS.interest)) {
    unregister.interest = registerCapability({
      name: 'stock.shortInterest',      // a LITERAL: the server's local-only mirror rail reads it (tests/test_uct_agent_breadth.py)
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ FINRA's data, licensed through the market-data vendor for display to members: shown to the member, never to a model
      summary: 'One stock\'s SHORT INTEREST from FINRA: the newest REPORT (its SETTLEMENT DATE, SHARES SHORT, DAYS TO COVER, the change from the REPORT before), SHORT INTEREST as a PERCENT OF FLOAT, its recent REPORTS and its DAILY SHORT VOLUME. '
        + 'For "short interest on NVDA", "how SHORTED is TSLA", "GME DAYS TO COVER".',
      hints: `${TARGET_HINT} symbol = the one ticker named (or the open chart's symbol). REPORTS 1-${INTEREST_MAX_REPORTS} (null = ${INTEREST_DEFAULT_REPORTS}); days = days of SHORT VOLUME, 1-${INTEREST_MAX_DAYS} (null = ${INTEREST_DEFAULT_DAYS}). `
        + `The date is the REPORT's SETTLEMENT DATE, weeks old: never today. Answered only from what the server already holds, so it may say none is held. `
        + `The market's ranking (the most SHORTED stocks) is not this answer; a screen with a condition on SHORT FLOAT is the Screener. ${NO_FIGURES}`,
      args: {
        type: 'object',
        properties: { symbol: { type: 'string' }, reports: { type: ['integer', 'null'] }, days: { type: ['integer', 'null'] } },
        required: ['symbol', 'reports', 'days'], additionalProperties: false,
      },
      answer: (_snap, args) => answerInterest(args || {}),
    })
    armRoutes('interest', true)
    added.push(CAPABILITIES.interest)
  }
  if (!unregister.list && kindServed(KINDS.list)) {
    unregister.list = registerCapability({
      name: 'stock.shortList',          // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ FINRA's data, licensed through the market-data vendor for display to members: shown to the member, never to a model
      summary: 'The SHORT INTEREST LIST: FINRA\'s newest REPORT across the stocks UCT follows, RANKED by DAYS TO COVER, by the biggest INCREASE or DECREASE in SHORT INTEREST, or by PERCENT OF FLOAT. '
        + 'For "most SHORTED stocks", "highest short interest", "biggest INCREASE in short interest".',
      hints: `${TARGET_HINT} rank: ${LIST_RANK_KEYS.join('|')} (dtc = most DAYS TO COVER; up = biggest percent INCREASE in SHORT INTEREST; down = biggest DECREASE; float = highest PERCENT OF FLOAT; null = ${DEFAULT_SHORT_RANK}). `
        + `limit 1-${LIST_MAX_ROWS} (null = ${LIST_DEFAULT_ROWS}). The date is the REPORT's SETTLEMENT DATE, weeks old: never today. Answered only from a list the server already holds, so it may say none is held. `
        + `One stock's own SHORT INTEREST is not this list; a screen with conditions (a threshold, a price, a sector) is the Screener. ${NO_FIGURES}`,
      args: {
        type: 'object',
        properties: { rank: { type: ['string', 'null'], enum: [...LIST_RANK_KEYS, null] }, limit: { type: ['integer', 'null'] } },
        required: ['rank', 'limit'], additionalProperties: false,
      },
      answer: (_snap, args) => answerList(args || {}),
    })
    armRoutes('list', true)
    added.push(CAPABILITIES.list)
  }
  return added
}
export const _resetTerminalWave5ForTest = () => {
  for (const k of Object.keys(unregister)) { unregister[k]?.(); delete unregister[k] }
  for (const k of Object.keys(WAVE5_ROUTE_WORDS)) armRoutes(k, false)
}
