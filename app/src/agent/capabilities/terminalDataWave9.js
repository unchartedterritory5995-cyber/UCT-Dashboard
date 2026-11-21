// Terminal data wave 9 — three LOCAL-ONLY capabilities over three model-isolated data kinds (MD-1 §4.18):
//   stock.auctionCalendar  rates.auctions    US Treasury auctions coming up and the recent results, as UCT holds them (AUCT)
//   stock.realCurve        rates.realYields  US Treasury real yields (TIPS) and the breakevens, as UCT holds them (RATES' real block)
//   stock.fomcWatch        fed.watch         the Fed watch: statement changes, speeches, headlines, next decision, rates,
//                                            projections, the New York Fed survey, as UCT holds them (FED)
//
// Each answer is built in the browser from ONE read of its own kind and shown to the MEMBER ONLY: every capability is
// `localOnly` (its name is in turn.LOCAL_ONLY_ACTIONS on the server), every kind is model-isolated, and nothing the read
// returns reaches a model provider. All three were isolated as the builder's default, from the licensing register's rows
// (quoted in each adapter and in MD-1 §4.18); nobody decided otherwise and nobody was asked.
//
// What every answer keeps to:
//   • the date is the DATA'S OWN (the newest auction record, the real curve's day, each Fed block's own date), never the
//     time of the ask; the time UCT read the data rides beside it;
//   • a number that does not exist is never 0: an amount, a rate, a bid-to-cover or a bidder split the Treasury left
//     empty, a real yield or a breakeven with a side missing, a Fed rate, projection or survey figure not held;
//   • a list that is cut says so, and from which end;
//   • nothing held and a read that failed are never said as "no auctions", "no figure" or "no Fed news", and a Fed block
//     that is not held, refused, unreadable or switched off is named in words, never dropped;
//   • an envelope's notes are never echoed (the Board's citation and the New York Fed's notice and attribution, which
//     their terms ask to be shown, come from the read's data);
//   • the news wire behind the Fed headlines is not named (the FED panel names it);
//   • what the kind leaves out is said, with the panel that shows it.
//
// Dark by construction: each is registered only while the server serves its own kind (UCT_AGENT_DATA_KINDS, fail closed; an
// isolated kind also needs its own UCT_AGENT_ISOLATED_KINDS entry or every read is refused). Nothing here arms anything.
// ROUTING: the three share ONE words-only group of their own, `marketRates` (routing.js lists them by action). It is the
// 51st group of the 56 the server keeps (turn.MAX_GROUPS). Each capability's own words (WAVE9_ROUTE_WORDS) are added to that
// group only while it is registered, so on a dark server the group has no words and no registered action, and routing is
// byte-identical to the base.
import { registerCapability } from '../capabilities'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { GROUPS } from '../routing'
import { stampET } from './marketDataFacts'
import { securityWords, tagWords, amountWords, rateWords, rateKindWords, coverWords, shareWords } from '../../pages/terminal/panels/treasuryAuctionsModel'
import { REAL_SOURCE, yieldText, bpText } from '../../pages/terminal/panels/ratesModel'
import { BOARD_CITE, rateText, projectionText, surveyRate, daysToGoWords } from '../../pages/terminal/panels/fedWatchModel'
import { END_OF_DAY } from './terminalDataWave6'
import { kindServed, usable, noRead, plural, andList, dayText, etDayOf, NO_TURN } from './terminalDataFormat'

export const KINDS = Object.freeze({ auctions: 'rates.auctions', real: 'rates.realYields', fed: 'fed.watch' })
export const CAPABILITIES = Object.freeze({ auctions: 'stock.auctionCalendar', real: 'stock.realCurve', fed: 'stock.fomcWatch' })
export const NOT_ADVICE = 'not a forecast and not advice'
const TEXT_ROWS = 5
const PRESENT_ROWS = 12
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const positive = (v) => (num(v) != null && v > 0 ? v : null)
const int = (v) => (Number.isInteger(v) ? v : null)
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const clamp = (v, max, fallback) => (Number.isInteger(v) ? Math.min(Math.max(v, 1), max) : fallback)
const isoDay = (v) => (typeof v === 'string' && ISO_DAY.test(v) ? v : null)
const list = (v) => (Array.isArray(v) ? v.filter(r => r && typeof r === 'object') : [])
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)
/** "Fri, Nov 13, 2026" → "Nov 13, 2026" */
const shortDay = (ymd) => (dayText(ymd) || '').replace(/^\w+, /, '') || null
const unclean = (what, none) => ({ text: `I couldn't read ${what}: UCT's data did not answer cleanly. ${none}` })
const more = (n) => `${n} more ${n === 1 ? 'is' : 'are'} in the table.`

// ── stock.auctionCalendar ──────────────────────────────────────────────────────────────────────────────────────────────
export const AUCTIONS_DEFAULT_ROWS = 12
export const AUCTIONS_MAX_ROWS = 50
export const AUCTIONS_RECORD = `A record and a schedule, ${NOT_ADVICE}.`
export const AUCTIONS_SOURCE = `Source: US Treasury Fiscal Data, as the Treasury publishes it. ${AUCTIONS_RECORD}`
export const RATE_KINDS = Object.freeze(['high_yield', 'high_rate', 'high_discount_margin'])
export const BIDDER_CLASSES = Object.freeze({ indirect: 'indirect', direct: 'direct', primary_dealers: 'dealers' })
const AUCTIONS_NONE = 'No auction is stated. That is not the same as no auctions.'
const PUBLISHER_CUT = Object.freeze({ upcoming: 'the oldest copies of the list of coming auctions', results: 'the oldest results' })

function bidders(b) {
  const o = obj(b)
  if (!o) return null
  const out = {}
  for (const [key, name] of Object.entries(BIDDER_CLASSES)) {
    const share = num(obj(o[key])?.share)
    if (share == null) return null                                   // a class missing: no split, never a share of 0
    out[name] = share
  }
  return out
}

/** Pure: a `rates.auctions` envelope → the answer. */
export function answerFromAuctions(envl) {
  const what = 'the Treasury auctions'
  if (!usable(envl)) {
    return { text: noRead(what, envl, 'none are held on the server yet (this answer never asks the Treasury), or the read failed. Open the Treasury auctions panel (AUCT) in UCT, then ask again', AUCTIONS_NONE) }
  }
  const d = envl.data
  const U = obj(d.upcoming)
  const R = obj(d.results)
  if (!U || !R || !Array.isArray(U.rows) || !Array.isArray(R.rows)) return unclean(what, AUCTIONS_NONE)
  const base = (r) => ({ type: str(r.security_type), term: str(r.security_term), auction_date: r.auction_date, issue_date: isoDay(r.issue_date),
    offering_amount: positive(r.offering_amount), reopening: r.reopening === true ? true : r.reopening === false ? false : null })   // left empty: null, never 0
  const sale = (r) => isoDay(r.auction_date) && str(r.security_type)
  const upcoming = list(U.rows).filter(sale).map(r => ({ ...base(r), announced_date: isoDay(r.announced_date) }))
  const results = list(R.rows).filter(sale).map(r => {
    const rate = num(r.rate)
    return { ...base(r), rate, rate_kind: rate != null && RATE_KINDS.includes(r.rate_kind) ? r.rate_kind : null, bid_to_cover: positive(r.bid_to_cover),
      tips: r.tips === true, frn: r.floating_rate === true, cmb: r.cash_management === true, bidders: bidders(r.bidders) }
  })
  const upTotal = Math.max(int(U.total) ?? 0, upcoming.length)
  const resTotal = Math.max(int(R.total) ?? 0, results.length)
  const days = int(d.window_days) ?? 45
  const read = stampET(d.read_at, envl.fetched_at)
  const check = obj(d.check)
  const cutBy = obj(d.publisher_cut) || {}
  const gaps = upcoming.filter(r => r.offering_amount == null).length
    + results.filter(r => r.offering_amount == null || r.rate == null || r.bid_to_cover == null || r.bidders == null).length
  const facts = {
    as_of: isoDay(d.as_of), upcoming_as_of: isoDay(d.upcoming_as_of), results_through: isoDay(d.results_through), window_days: days,
    upcoming: { rows: upcoming, count: upcoming.length, total: upTotal, cut: upTotal > upcoming.length },
    results: { rows: results, count: results.length, total: resTotal, cut: resTotal > results.length },
    gaps, read_at: str(d.read_at), read, stale: !!envl.stale, check_failed: !!check,
  }
  const name = (r) => `${securityWords(r)}${tagWords(r) ? ` (${tagWords(r)})` : ''}`
  const offered = (r) => (r.offering_amount == null ? 'amount not given' : `${amountWords(r.offering_amount)} offered`)
  const split = (b) => (b ? `indirect ${shareWords(b.indirect)}, direct ${shareWords(b.direct)}, dealers ${shareWords(b.dealers)}` : 'bidder split not given')
  const outcome = (r) => `${r.rate == null ? 'rate not given' : `${rateKindWords(r.rate_kind) || 'rate'} ${rateWords(r.rate)}`}, `
    + `${r.bid_to_cover == null ? 'bid-to-cover not given' : `bid-to-cover ${coverWords(r.bid_to_cover)}`}, ${split(r.bidders)}`
  const lines = ['US Treasury auctions as UCT holds them, from the Treasury\'s Fiscal Data service:']
  if (upcoming.length) {
    lines.push('Coming up, soonest first:')
    for (const r of upcoming.slice(0, TEXT_ROWS)) lines.push(`• ${shortDay(r.auction_date)}: ${name(r)}, ${offered(r)}${r.issue_date ? `, issued ${shortDay(r.issue_date)}` : ''}`)
    if (upcoming.length > TEXT_ROWS) lines.push(more(upcoming.length - TEXT_ROWS))
  } else {
    lines.push('The Treasury\'s records UCT holds list no auction coming up.')
  }
  if (results.length) {
    lines.push(`Results in the last ${days} days, newest first:`)
    for (const r of results.slice(0, TEXT_ROWS)) lines.push(`• ${shortDay(r.auction_date)}: ${name(r)}: ${outcome(r)}`)
    if (results.length > TEXT_ROWS) lines.push(more(results.length - TEXT_ROWS))
  } else {
    lines.push(`The Treasury's records UCT holds list no auction with a result in the last ${days} days.`)
  }
  if (upTotal > upcoming.length) lines.push(`${upTotal} auctions are listed as coming up and the soonest ${upcoming.length} are in this answer: the list is cut from the far end.`)
  if (resTotal > results.length) lines.push(`${resTotal} auction results are held and the newest ${results.length} are in this answer: the list is cut from the old end.`)
  const byPublisher = Object.keys(PUBLISHER_CUT).filter(k => cutBy[k] === true)
  if (byPublisher.length) lines.push(`The Treasury held more rows than the one page UCT reads, so ${andList(byPublisher.map(k => PUBLISHER_CUT[k]))} are not in what UCT holds.`)
  if (gaps) lines.push(`${plural(gaps, 'auction')} ${gaps === 1 ? 'has' : 'have'} a figure the Treasury left empty: it is not stated, and that is not 0.`)
  const dated = [facts.upcoming_as_of ? `the list of coming auctions is the Treasury's as of ${dayText(facts.upcoming_as_of)}` : null,
    facts.results_through ? `results run through ${dayText(facts.results_through)}` : null].filter(Boolean)
  lines.push(dated.length ? `${dated.join(', and ').replace(/^t/, 'T')}: the records' own dates, never the time of this answer.` : 'The records carry no date of their own.')
  lines.push(read ? `UCT read the records at ${read} (UCT's own time), and this answer never asks the Treasury.` : 'The answer carries no time UCT read the records, so I cannot say how old they are.')
  if (check) lines.push('Stale: UCT\'s last look for newer auction records did not go well, so these are the last records it read.')
  else if (envl.stale) lines.push('Stale: the Treasury\'s evening update has passed since UCT read these records, so newer ones may exist. This answer never looks for them.')
  lines.push(AUCTIONS_SOURCE)
  const rows = [...upcoming.map(r => ({ day: shortDay(r.auction_date), security: name(r), kind: 'Coming up', detail: offered(r) })),
    ...results.map(r => ({ day: shortDay(r.auction_date), security: name(r), kind: 'Result', detail: outcome(r) }))]
  if (!rows.length) return { text: lines.join('\n'), facts }
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'day', label: 'Day' }, { key: 'security', label: 'Security' }, { key: 'kind', label: 'Kind' }, { key: 'detail', label: 'Detail' }], rows },
    present: {
      kind: 'metrics', title: 'Treasury auctions', short: 'Treasury auctions',
      items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.day, value: r.security, note: r.kind === 'Result' ? r.detail.split(',')[0] : r.detail, aka: [r.kind.toLowerCase()] })),
    },
    facts,
  }
}

export async function answerAuctions(args = {}) {
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the Treasury auctions: ${NO_TURN}.` }
  const params = { rows: clamp(args.rows, AUCTIONS_MAX_ROWS, AUCTIONS_DEFAULT_ROWS) }
  const envl = await readData('rates.auctions', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromAuctions(envl)
}

// ── stock.realCurve ────────────────────────────────────────────────────────────────────────────────────────────────────
export const REAL_HORIZONS = Object.freeze({ d1: 'the day before', w1: 'a week ago' })
export const REAL_RECORD = `End-of-day figures, ${NOT_ADVICE}.`
export const REAL_SOURCE_LINE = `Source: ${REAL_SOURCE}; breakevens worked out by UCT's server from the nominal and the real curve. ${REAL_RECORD}`
const REAL_NONE = 'No figure is stated. That is not the same as no figure.'

/** Pure: a `rates.realYields` envelope → the answer. */
export function answerFromReal(envl) {
  const what = 'real yields'
  if (!usable(envl)) {
    return { text: noRead(what, envl, 'none are held on the server yet (this answer never requests them from the Treasury\'s website), or the read failed. Open the Treasury yields panel (RATES) in UCT, then ask again', REAL_NONE) }
  }
  const d = envl.data
  const asOf = isoDay(d.as_of)
  const be = obj(d.breakevens)
  if (!asOf || !Array.isArray(d.maturities) || !be || !Array.isArray(be.rows)) return unclean(what, REAL_NONE)
  const beDay = isoDay(be.as_of)
  const beByKey = Object.fromEntries(list(be.rows).filter(r => str(r.key)).map(r => [r.key, beDay && isoDay(r.date) === beDay ? num(r.value) : null]))
  const maturities = list(d.maturities).filter(m => str(m.key)).map(m => ({
    key: m.key, label: str(m.label) || m.key, yield_pct: num(m.yield),                                  // no figure: null, never 0
    change_bp: Object.fromEntries(Object.keys(REAL_HORIZONS).map(h => [h, num(obj(m.change_bp)?.[h])])), breakeven: beByKey[m.key] ?? null,
  }))
  if (!maturities.some(m => m.yield_pct != null)) return unclean(what, REAL_NONE)
  const refs = obj(d.ref_dates) || {}
  const noReference = Object.keys(REAL_HORIZONS).filter(h => !isoDay(refs[h]))
  const missing = maturities.filter(m => m.yield_pct == null).map(m => m.label)
  const read = stampET(d.read_at, envl.fetched_at)
  const check = obj(d.check)
  const facts = { as_of: asOf, day: dayText(asOf), breakeven_as_of: beDay, maturities, no_reference: noReference, missing, read_at: str(d.read_at), read, stale: !!envl.stale, check_failed: !!check }
  const lines = [`US Treasury real yields (inflation-protected securities) by maturity, end-of-day figures for ${dayText(asOf)}:`]
  for (const m of maturities) {
    if (m.yield_pct == null) { lines.push(`• ${m.label}: no real figure for that day`); continue }
    const d1 = m.change_bp.d1 != null ? `, ${bpText(m.change_bp.d1)} bp from ${REAL_HORIZONS.d1}` : `, no figure ${REAL_HORIZONS.d1} to compare with`
    lines.push(`• ${m.label}: ${yieldText(m.yield_pct)}${d1}, ${m.breakeven == null ? 'breakeven not given' : `breakeven ${yieldText(m.breakeven)}`}`)
  }
  if (!beDay) lines.push('No breakeven is stated: the nominal and the real curve have no day in common in what UCT holds, and that is not a breakeven of 0.')
  else if (beDay !== asOf) lines.push(`The breakevens are for ${dayText(beDay)}, the newest day both curves have a figure: the nominal yield minus the real yield at the same maturity.`)
  else lines.push(`The breakevens are the nominal yield minus the real yield at the same maturity on ${dayText(beDay)}.`)
  const noBe = beDay ? maturities.filter(m => m.breakeven == null).map(m => m.label) : []
  if (noBe.length) lines.push(`${andList(noBe)} ${noBe.length === 1 ? 'has' : 'have'} no breakeven, since a side is missing: it is not stated, and that is not 0.`)
  if (noReference.length) lines.push(`No real figure was found near enough to ${andList(noReference.map(h => REAL_HORIZONS[h]))}, so ${noReference.length === 1 ? 'that change is' : 'those changes are'} not stated: that is not a change of 0.`)
  if (check) lines.push('Stale: UCT\'s last look for newer real yields did not go well, so these are the last figures it read and a newer day may exist.')
  else if (envl.stale) lines.push(`Stale: the newest real figure UCT holds is ${shortDay(asOf)}, and a later day's figures may be out. This answer never looks for one.`)
  lines.push(END_OF_DAY)
  lines.push(read ? `Read by UCT from the Treasury's website at ${read} (UCT's own time).` : 'The answer carries no time UCT read the figures, so I cannot say how old they are.')
  lines.push(REAL_SOURCE_LINE)
  return {
    text: lines.join('\n'),
    table: {
      columns: [{ key: 'maturity', label: 'Maturity' }, { key: 'real', label: 'Real yield' }, { key: 'd1', label: '1 day (bp)' }, { key: 'w1', label: '1 week (bp)' }, { key: 'breakeven', label: 'Breakeven' }],
      rows: maturities.map(m => ({ maturity: m.label, real: m.yield_pct == null ? 'not given' : yieldText(m.yield_pct),
        d1: m.yield_pct == null || m.change_bp.d1 == null ? 'not given' : bpText(m.change_bp.d1), w1: m.yield_pct == null || m.change_bp.w1 == null ? 'not given' : bpText(m.change_bp.w1),
        breakeven: m.breakeven == null ? 'not given' : yieldText(m.breakeven) })),
    },
    present: {
      kind: 'metrics', title: `Real yields, ${shortDay(asOf)}`, short: 'Real yields',
      items: maturities.filter(m => m.yield_pct != null).map(m => ({ label: m.label, value: yieldText(m.yield_pct), note: m.breakeven == null ? 'no breakeven' : `breakeven ${yieldText(m.breakeven)}`, aka: [m.key] })),
    },
    facts,
  }
}

export async function answerReal() {
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read real yields: ${NO_TURN}.` }
  const envl = await readData('rates.realYields', {}, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromReal(envl)
}

// ── stock.fomcWatch ────────────────────────────────────────────────────────────────────────────────────────────────────
export const FED_DEFAULT_ROWS = 10
export const FED_MAX_ROWS = 15
export const FED_BLOCKS = Object.freeze(['statement', 'speeches', 'headlines', 'next_meeting', 'rates', 'projections', 'survey'])
export const FED_BLOCK_NAMES = Object.freeze({ statement: 'FOMC statement', speeches: 'Fed speeches and testimony', headlines: 'Fed headlines',
  next_meeting: 'Next FOMC decision', rates: 'Federal funds rates', projections: 'Rate projections', survey: 'New York Fed survey' })
/** why a block is not stated, in fixed words keyed on its state (never a note) */
export const FED_STATE_WORDS = Object.freeze({
  none: 'the source lists none.', not_held: 'not held on the server yet (this answer never asks for it). That is not the same as none.',
  unavailable: 'the source refused UCT\'s last look, so nothing is stated.', failed: 'UCT\'s last look did not get an answer, so nothing is stated.',
  unreadable: 'the page could not be read, so nothing is stated.', off: 'switched off on this server, so nothing is read.', no_data: 'no figure is held.',
})
export const FED_LEFT_OUT = 'The statement\'s full text, this week\'s Fed speakers and the survey\'s probability ranges are not in this answer: the Fed watch panel (FED) in UCT shows them.'
export const FED_OTHERS = `Other blocks: the Federal Reserve Bank of New York (the rates and the survey), the news wire UCT receives (the headlines) and the economic calendar UCT holds (the next decision). The Board's and the New York Fed's own words and figures, ${NOT_ADVICE}.`
const FED_NONE = 'Nothing of the Fed watch is stated. That is not the same as no Fed news.'
const CHANGE_ROWS = 3

/** Pure: a `fed.watch` envelope → the answer. */
export function answerFromFed(envl) {
  const what = 'the Fed watch'
  if (!usable(envl)) {
    return { text: noRead(what, envl, 'nothing of it is held on the server yet (this answer never asks the Board, the New York Fed or the news wire), or the read failed. Open the Fed watch panel (FED) in UCT, then ask again', FED_NONE) }
  }
  const d = envl.data
  const b = Object.fromEntries(FED_BLOCKS.map(k => [k, obj(d[k])]))
  if (FED_BLOCKS.some(k => !b[k] || typeof b[k].state !== 'string')) return unclean(what, FED_NONE)
  const state = (k) => (b[k].state === 'ok' ? 'ok' : Object.prototype.hasOwnProperty.call(FED_STATE_WORDS, b[k].state) ? b[k].state : 'failed')
  const blockLine = (k) => `${FED_BLOCK_NAMES[k]}: ${FED_STATE_WORDS[state(k)]}`
  const lines = ['The Fed watch as UCT holds it, block by block:']
  const rows = []
  const facts = { states: Object.fromEntries(FED_BLOCKS.map(k => [k, state(k)])), as_of: null, stale: !!envl.stale, partial: envl.status === 'partial' }

  // the statement and what changed
  if (state('statement') === 'ok') {
    const st = b.statement
    const day = isoDay(st.date)
    const red = obj(st.redline) || {}
    const prev = isoDay(obj(red.previous)?.date)
    const prevText = prev ? dayText(prev) : 'the meeting before'
    const ch = obj(red.changes)
    const changes = list(ch?.rows).map(c => ({ text: str(c.text), was: str(c.was), added: int(c.added) ?? 0, removed: int(c.removed) ?? 0 })).filter(c => c.text || c.was)
    facts.statement = { date: day, redline: str(red.state), previous: prev, added: int(red.added), removed: int(red.removed), changes: changes.length, changes_total: int(ch?.total) ?? changes.length }
    const head = `FOMC statement of ${day ? dayText(day) : 'a day it does not give'}.`
    if (red.state === 'ok' && int(red.added) != null && int(red.removed) != null) {
      lines.push(`${head} Against the statement of ${prevText}: ${plural(red.added, 'word')} added and ${plural(red.removed, 'word')} removed. What changed, in the statement's order:`)
      for (const c of changes.slice(0, CHANGE_ROWS)) lines.push(c.text ? `• New: “${c.text}”${c.was ? ` Before: “${c.was}”` : ' (a new passage)'}` : `• Removed: “${c.was}”`)
      if (changes.length > CHANGE_ROWS) lines.push(more(changes.length - CHANGE_ROWS))
      if ((int(ch?.total) ?? 0) > changes.length) lines.push(`${ch.total} passages changed and the first ${changes.length} are in this answer: the list is cut from the end.`)
    } else if (red.state === 'same') {
      lines.push(`${head} Not one word changed from the statement of ${prevText}.`)
    } else if (red.state === 'not_held') {
      lines.push(`${head} The statement before it (${prevText}) is not held yet, so no change is stated: that is not the same as no change.`)
    } else if (red.state === 'unreadable') {
      lines.push(`${head} The statement before it (${prevText}) could not be read, so no change is stated: that is not the same as no change.`)
    } else if (red.state === 'too_long') {
      lines.push(`${head} The two statements are too long to compare here, so no change is stated.`)
    } else {
      lines.push(`${head} No earlier statement is held to compare it with, so no change is stated.`)
    }
    for (const c of changes) rows.push({ block: 'Statement change', date: shortDay(day), detail: c.text ? `New: ${c.text}${c.was ? ` / Before: ${c.was}` : ''}` : `Removed: ${c.was}` })
  } else {
    lines.push(blockLine('statement'))
  }

  // the next decision
  if (state('next_meeting') === 'ok' && isoDay(b.next_meeting.date)) {
    const m = b.next_meeting
    const when = int(m.days_to_go) != null ? daysToGoWords(m.days_to_go) : ''
    const from = String(m.source || '').startsWith('Federal Reserve Bank of New York') ? 'the meeting dates in the New York Fed\'s survey' : 'the economic calendar UCT holds'
    lines.push(`Next FOMC decision: ${dayText(m.date)}${str(m.time) ? `, ${m.time} ET` : ''}${when ? ` (${when})` : ''}, from ${from}.`)
    facts.next_meeting = { date: m.date, time: str(m.time), days_to_go: int(m.days_to_go) }
    rows.push({ block: 'Next FOMC decision', date: shortDay(m.date), detail: str(m.label) || str(m.event) || 'FOMC decision' })
  } else {
    lines.push(blockLine('next_meeting'))
  }

  // the rates, with the New York Fed's notice
  if (state('rates') === 'ok') {
    const r = b.rates
    const p = (k) => ({ value: num(obj(r[k])?.value), date: isoDay(obj(r[k])?.date) })
    const eff = p('effective')
    const hi = p('upper')
    const lo = p('lower')
    const effText = eff.value == null ? 'the effective rate is not held' : `effective ${rateText(eff.value)} (${shortDay(eff.date) || 'undated'})`
    const range = lo.value != null && hi.value != null ? `target range ${rateText(lo.value)} to ${rateText(hi.value)} (${shortDay(hi.date || lo.date) || 'undated'})`
      : hi.value != null ? `target range up to ${rateText(hi.value)} (the lower end is not held)` : lo.value != null ? `target range from ${rateText(lo.value)} (the upper end is not held)` : 'the target range is not held'
    lines.push(`Federal funds rates: ${effText}; ${range}.`)
    if (str(r.notice)) lines.push(r.notice.trim())
    facts.rates = { effective: eff, upper: hi, lower: lo }
    rows.push({ block: 'Federal funds rates', date: shortDay(eff.date || hi.date), detail: `${effText}; ${range}` })
  } else {
    lines.push(blockLine('rates'))
  }

  // the officials' projections
  if (state('projections') === 'ok') {
    const pr = b.projections
    const medians = list(pr.medians).filter(m => str(m.label) && num(m.value) != null)
    lines.push(`The officials' median projection of the federal funds rate (Summary of Economic Projections${str(pr.meeting) ? `, ${pr.meeting} meeting` : ''}${isoDay(pr.date) ? `, released ${shortDay(pr.date)}` : ''}): ${medians.length ? medians.map(m => `${m.label} ${projectionText(m.value)}`).join(', ') : 'no median is held'}.`)
    facts.projections = { date: isoDay(pr.date), medians }
    for (const m of medians) rows.push({ block: 'Rate projection', date: shortDay(pr.date), detail: `${m.label}: ${projectionText(m.value)}` })
  } else {
    lines.push(blockLine('projections'))
  }

  // the New York Fed survey, with its attribution
  if (state('survey') === 'ok') {
    const sv = b.survey
    const path = list(sv.path).filter(h => str(h.label))
    lines.push(`New York Fed Survey of Market Expectations${str(sv.survey) ? `, ${sv.survey}` : ''}${isoDay(sv.responses_due) ? `, responses due ${shortDay(sv.responses_due)}` : ''}: the respondents' median most-likely target rate ${path.length ? path.map(h => `${h.label} ${surveyRate(h.median)}`).join(', ') : 'is not held for a meeting ahead'}. These are the respondents' figures, not market prices and not a UCT forecast.`)
    if (str(sv.credit)) lines.push(sv.credit.trim())
    facts.survey = { survey: str(sv.survey), path }
    for (const h of path) rows.push({ block: 'Survey median', date: shortDay(h.date), detail: `${h.label}: ${surveyRate(h.median)}` })
  } else {
    lines.push(blockLine('survey'))
  }

  // speeches and testimony
  if (state('speeches') === 'ok') {
    const sp = b.speeches
    const items = list(sp.rows).filter(s => str(s.title))
    const total = Math.max(int(sp.total) ?? 0, items.length)
    lines.push(items.length ? 'Fed speeches and testimony, newest first:' : 'Fed speeches and testimony: the Board\'s feeds list none.')
    for (const s of items.slice(0, TEXT_ROWS)) {
      lines.push(`• ${shortDay(etDayOf(s.published)) || 'undated'}: ${str(s.speaker) ? `${s.speaker}, ` : ''}“${s.title}” (${s.kind === 'testimony' ? 'testimony' : 'speech'})${str(s.where) ? `, ${s.where}` : ''}`)
    }
    if (items.length > TEXT_ROWS) lines.push(more(items.length - TEXT_ROWS))
    if (total > items.length) lines.push(`${total} speeches and testimony are listed and the newest ${items.length} are in this answer: the list is cut from the old end.`)
    facts.speeches = { count: items.length, total }
    for (const s of items) rows.push({ block: s.kind === 'testimony' ? 'Testimony' : 'Speech', date: shortDay(etDayOf(s.published)), detail: `${str(s.speaker) ? `${s.speaker}: ` : ''}${s.title}` })
  } else {
    lines.push(blockLine('speeches'))
  }

  // the headlines, each with the time UCT received it
  if (state('headlines') === 'ok') {
    const hd = b.headlines
    const items = list(hd.rows).filter(h => str(h.text) && str(h.received_at))
    const matched = Math.max(int(hd.matched) ?? 0, items.length)
    lines.push(items.length ? 'Fed headlines from the news wire UCT receives, newest first, each with the time UCT received it:' : 'Fed headlines: none is held in the newest headlines on the wire.')
    for (const h of items.slice(0, TEXT_ROWS)) lines.push(`• ${stampET(h.received_at, envl.fetched_at)}: “${h.text}”`)
    if (items.length > TEXT_ROWS) lines.push(more(items.length - TEXT_ROWS))
    if (matched > items.length) lines.push(`${matched} Fed headlines are held${int(hd.scanned) != null ? ` in the newest ${hd.scanned} on the wire` : ''} and the newest ${items.length} are in this answer: the list is cut from the old end.`)
    facts.headlines = { count: items.length, matched }
    for (const h of items) rows.push({ block: 'Headline', date: stampET(h.received_at, envl.fetched_at), detail: h.text })
  } else {
    lines.push(blockLine('headlines'))
  }

  lines.push(FED_LEFT_OUT)
  if (envl.stale) lines.push('Stale: UCT\'s last look at the Board\'s or the New York Fed\'s website did not go well, so some blocks are what UCT read before. This answer never looks again.')
  lines.push(str(d.board_cite) || BOARD_CITE)
  lines.push(FED_OTHERS)
  if (!rows.length) return { text: lines.join('\n'), facts }
  const pick = (k, label, value) => (facts[k] ? [{ label, value, note: FED_BLOCK_NAMES[k], aka: [k.replace('_', ' ')] }] : [])
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'block', label: 'Block' }, { key: 'date', label: 'Date' }, { key: 'detail', label: 'Detail' }], rows },
    present: {
      kind: 'metrics', title: 'Fed watch', short: 'Fed watch',
      items: [...pick('statement', 'FOMC statement', shortDay(facts.statement?.date) || 'undated'),
        ...pick('next_meeting', 'Next decision', shortDay(facts.next_meeting?.date) || 'undated'),
        ...pick('rates', 'Effective rate', facts.rates?.effective?.value == null ? 'not held' : rateText(facts.rates.effective.value)),
        ...pick('projections', 'Projection', facts.projections?.medians?.[0] ? `${facts.projections.medians[0].label} ${projectionText(facts.projections.medians[0].value)}` : 'none held'),
        ...pick('survey', 'Survey median', facts.survey?.path?.[0] ? `${facts.survey.path[0].label} ${surveyRate(facts.survey.path[0].median)}` : 'none held')].slice(0, PRESENT_ROWS),
    },
    facts,
  }
}

export async function answerFed(args = {}) {
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the Fed watch: ${NO_TURN}.` }
  const params = { rows: clamp(args.rows, FED_MAX_ROWS, FED_DEFAULT_ROWS) }
  const envl = await readData('fed.watch', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromFed(envl)
}

// ── routing words (armed only while registered; routing.js's `marketRates` group lists none) ──────────────────────────
// Routing v2 reaches the three by their summaries. v1 (the kill-switch fallback, and the router the capability-regression
// corpus runs) selects a group by its words, and `marketRates` is words-only: these words are the only way v1 sends it.
// Routing only ADDS a group (the other groups a message names still ride along), and each pattern is kept off another
// capability's own language:
//   auctions  Treasury, bond, note, bill or TIPS auctions, a maturity's auction, auction results or schedules, upcoming or
//             recent auctions, bid-to-cover, direct or indirect bidders. Never a stock's opening or closing auction or its
//             imbalances, never an art or a domain auction;
//   real      real yields or real rates, TIPS yields, inflation breakevens or a maturity's breakeven. Never a breakeven trade
//             or anything in the member's journal (win rate, losses, stops). "Treasury real yields", "the 10-year real
//             yield" and "the real yield curve" are named by wave 6's Treasury yields words too: both groups ride along;
//   fed       the Fed watch, the FOMC, the Fed's statement, speakers, speeches, minutes, meetings, decisions, projections,
//             dot plot, headlines, chair or officials, the federal funds rate, the Federal Reserve, the Survey of Market
//             Expectations, what the Fed said or will do. Never a news collection named Fed, a saved story, FedEx;
//   not ours  a screen or its condition, an alert, a watchlist, the member's own lists, a page or a panel, or what a term
//             MEANS (the guide).
// ⛔ no lookbehind (iOS 16 floor, src/noRegexLookbehind.test.js).
const NOT_A_SCREEN = '^(?!.*\\b(?:scans?|screens?|screener|filters?|find|alerts?|notify|widgets?|page|tab|panel|watchlists?|my|portfolio|positions?)\\b)(?!.*(?:\\b(?:over|above|under|below|at least|more than|less than|greater than)\\b|[<>])\\s*\\$?\\d)'
const NOT_A_MEANING = '(?!.*\\b(?:explain|define|definition|meaning|means?|difference between|how (?:is|are|do|does) .* (?:calculated|worked out|computed|work|works|affect\\w*))\\b)'
  + '(?!what(?:\'s|’s| is| are) (?:an? |the )?(?:treasury auctions?|auctions?|bid[- ]to[- ]cover(?: ratio)?|real yields?|real rates?|tips|breakevens?|break[- ]evens?|fomc|fed funds rate|federal funds rate|federal reserve|dot plot|fed watch)\\W*$)'
const OURS = `${NOT_A_SCREEN}${NOT_A_MEANING}`
const NOT_A_STOCK_AUCTION = '(?!.*\\b(?:opening|closing|open|close|imbalances?|moc|moo|loc|cross|art|domains?|ebay)\\b)'
const NOT_THE_JOURNAL = '(?!.*\\b(?:trades?|trading|journal|win rate|wins?|losses|losing|stops?|entries|r multiple)\\b)'
const NOT_A_COLLECTION = '(?!.*\\b(?:collections?|bookmarks?|saved|library|stories|story|rename|named|called)\\b)'
const MATURITY = '\\b(?:1|2|3|5|7|10|20|30)[\\s-]?(?:year|yr|y)\\b'
const WEEKS = '\\b(?:4|6|8|13|17|26|52)[\\s-]?(?:week|wk)\\b'
export const WAVE9_ROUTE_WORDS = Object.freeze({
  auctions: [
    new RegExp(`${OURS}${NOT_A_STOCK_AUCTION}.*\\b(?:treasury|treasuries|government|bond|note|bill|tips|frn) auctions?\\b`),
    new RegExp(`${OURS}${NOT_A_STOCK_AUCTION}.*(?:${MATURITY}|${WEEKS}) (?:(?:note|bond|bill|tips|frn) )?auctions?\\b`),
    new RegExp(`${OURS}${NOT_A_STOCK_AUCTION}.*\\bauctions? (?:results?|calendar|schedule|this week|next week|coming up|tailed|tail)\\b`),
    new RegExp(`${OURS}${NOT_A_STOCK_AUCTION}.*\\b(?:upcoming|recent|latest) auctions?\\b`),
    new RegExp(`${OURS}.*\\bbid[- ]to[- ]cover\\b`),
    new RegExp(`${OURS}.*\\b(?:indirect|direct) bidders?\\b`),
  ],
  real: [
    new RegExp(`${OURS}.*\\breal (?:yields?|yield curve|rates?|interest rates?)\\b`),
    new RegExp(`${OURS}.*\\btips (?:yields?|curve|rates?)\\b`),
    new RegExp(`${OURS}${NOT_THE_JOURNAL}.*\\b(?:inflation break[- ]?evens?|break[- ]?even inflation|break[- ]?even rates?)\\b`),
    new RegExp(`${OURS}${NOT_THE_JOURNAL}(?=.*(?:${MATURITY}|\\b(?:tips|treasur\\w*|bonds?|inflation)\\b)).*\\bbreak[- ]?evens?\\b`),
  ],
  fed: [
    new RegExp(`${OURS}${NOT_A_COLLECTION}.*\\bfomc\\b`),
    new RegExp(`${OURS}${NOT_A_COLLECTION}.*\\bfed(?:'s|’s)? (?:watch|statement|speakers?|speeches|speech|minutes|meetings?|decision|projections|dot plot|dots|headlines|chair(?:man|woman)?|governors?|officials?|funds|policy|rate decision)\\b`),
    new RegExp(`${OURS}${NOT_A_COLLECTION}.*\\bfederal (?:reserve|funds|open market committee)\\b`),
    new RegExp(`${OURS}${NOT_A_COLLECTION}.*\\b(?:dot plot|summary of economic projections|survey of market expectations)\\b`),
    new RegExp(`${OURS}${NOT_A_COLLECTION}.*\\bthe fed (?:say|said|saying|decide|decided|do|did|meet|meets|cut|cuts|hike|hikes|change|changed|next)\\b`),
  ],
})
export const ROUTE_GROUP = 'marketRates'
const ownGroup = () => GROUPS.find(g => g.id === ROUTE_GROUP)
/** Adds (or takes back) ONE capability's words on the wave's own group. */
function armRoutes(key, on) {
  const g = ownGroup()
  if (!g) return
  for (const re of WAVE9_ROUTE_WORDS[key]) {
    const at = g.words.indexOf(re)
    if (on && at < 0) g.words.push(re)
    if (!on && at >= 0) g.words.splice(at, 1)
  }
}

// ── registration: each capability only while the server serves ITS kind ───────────────────────────────────────────────
// ⚠️ THE WORDS OF A NAME, A SUMMARY AND ITS HINTS JOIN THE TYPO LEXICON (nl/lexicon.js: every lowercase word of three letters
// or more; a word in CAPITALS does not). A new known word changes what a nearby word in ANY member message may be
// "corrected" to, so the text below is worded to leave every existing capability-regression phrasing's corrections exactly
// as they were (pinned in agentTerminalDataWave9.test.js, "the typo lexicon"). The names add two words, "auction" and
// "fomc", and that test shows neither changes a correction.
const TARGET_HINT = 'target = the ref of the stockData entry.'
const NO_FIGURES = 'reply: one short line, no figures.'
const HELD_ONLY = 'Answered only from what the SERVER already HOLDS, so it may say none is held.'
const unregister = {}

/** Idempotent; registers each of the three ONLY while the server serves its kind. Returns the names registered by this call. */
export function registerTerminalWave9Capabilities() {
  const added = []
  if (!unregister.auctions && kindServed(KINDS.auctions)) {
    unregister.auctions = registerCapability({
      name: 'stock.auctionCalendar',     // a LITERAL: the server's local-only mirror rail reads it (tests/test_uct_agent_breadth.py)
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ Treasury records no register row clears for a model: shown to the member, never to a model
      summary: 'US TREASURY AUCTIONS as UCT HOLDS them: the AUCTIONS COMING UP (SECURITY, AUCTION DAY, AMOUNT OFFERED) and the RESULTS of the LAST 45 DAYS (HIGH YIELD or RATE, BID-TO-COVER, the AWARD SPLIT BETWEEN DEALERS, DIRECT and INDIRECT BIDDERS). '
        + 'For "TREASURY AUCTIONS", "how did the 10-YEAR AUCTION go", "UPCOMING BOND AUCTIONS".',
      hints: `${TARGET_HINT} No SYMBOL. ROWS 1-${AUCTIONS_MAX_ROWS} PER LIST (null = ${AUCTIONS_DEFAULT_ROWS}). The date is the newest RECORD's own: never today. A RECORD and a SCHEDULE, not a FORECAST and not ADVICE. ${HELD_ONLY} `
        + `A STOCK's OPENING or CLOSING AUCTION is not this answer. ${NO_FIGURES}`,
      args: { type: 'object', properties: { rows: { type: ['integer', 'null'] } }, required: ['rows'], additionalProperties: false },
      answer: (_snap, args) => answerAuctions(args || {}),
    })
    armRoutes('auctions', true)
    added.push(CAPABILITIES.auctions)
  }
  if (!unregister.real && kindServed(KINDS.real)) {
    unregister.real = registerCapability({
      name: 'stock.realCurve',          // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ the register names no AI lane for the Treasury's curves: shown to the member, never to a model
      summary: 'US TREASURY REAL YIELDS (TIPS, 5 to 30 YEARS, END-OF-DAY) as UCT HOLDS them: each REAL YIELD, its CHANGE in BASIS POINTS from the DAY BEFORE and a WEEK AGO, and the BREAKEVEN at each MATURITY (NOMINAL MINUS REAL). '
        + 'For "REAL YIELDS", "TIPS YIELDS", "the 10-YEAR BREAKEVEN".',
      hints: `${TARGET_HINT} No ARGUMENTS. The date is the CURVE's own date: never today, and never a QUOTE from a SESSION STILL TRADING. ${HELD_ONLY} `
        + `NOMINAL TREASURY YIELDS and the YIELD CURVE's SPREADS are TREASURY YIELDS, not this answer. ${NO_FIGURES}`,
      args: { type: 'object', properties: {}, required: [], additionalProperties: false },
      answer: () => answerReal(),
    })
    armRoutes('real', true)
    added.push(CAPABILITIES.real)
  }
  if (!unregister.fed && kindServed(KINDS.fed)) {
    unregister.fed = registerCapability({
      name: 'stock.fomcWatch',          // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ the Board's and the New York Fed's rows name no AI lane, the headlines have no row: shown to the member, never to a model
      summary: 'The FED WATCH as UCT HOLDS it: the newest FOMC STATEMENT and WHAT CHANGED from the one BEFORE, FED SPEECHES, FED HEADLINES, the NEXT FOMC DECISION, the FED FUNDS RATES, the OFFICIALS\' RATE PROJECTIONS and the NEW YORK FED SURVEY. '
        + 'For "FED WATCH", "WHAT CHANGED in the FOMC STATEMENT", "when is the NEXT FOMC MEETING".',
      hints: `${TARGET_HINT} No SYMBOL. ROWS 1-${FED_MAX_ROWS} PER LIST (null = ${FED_DEFAULT_ROWS}). EACH BLOCK HAS its own date: never today. The BOARD's and the NEW YORK FED's own WORDS, not a FORECAST and not ADVICE. ${HELD_ONLY} `
        + `The EARNINGS CALENDAR is not this answer. ${NO_FIGURES}`,
      args: { type: 'object', properties: { rows: { type: ['integer', 'null'] } }, required: ['rows'], additionalProperties: false },
      answer: (_snap, args) => answerFed(args || {}),
    })
    armRoutes('fed', true)
    added.push(CAPABILITIES.fed)
  }
  return added
}
export const _resetTerminalWave9ForTest = () => {
  for (const k of Object.keys(unregister)) { unregister[k]?.(); delete unregister[k] }
  for (const k of Object.keys(WAVE9_ROUTE_WORDS)) armRoutes(k, false)
}
