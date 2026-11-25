// Terminal data wave 12 — six LOCAL-ONLY capabilities over six model-isolated data kinds (MD-1 §4.21, §4.4):
//   stock.uctRating        ratings                one stock's UCT composite rating, its components and checkup (RTG)
//   stock.estimatesHistory estimates.history      one stock's consensus EPS and revenue per upcoming quarter, moved over 7 / 30 / 90 days (EEH)
//   stock.consensusRating  analyst.ratings        one stock's analysts by rating, the consensus, the price target, the upside, recent actions (ANR)
//   stock.revenueSplit     company.segments       one stock's revenue by product and by region, the newest year and quarter, growth (SEG)
//   stock.failsToDeliver   stock.failsToDeliver   one stock's SEC fails-to-deliver balances, the trend, the window and its lag (FTD)
//   stock.companyDeals     company.deals          one stock's mergers and acquisitions and its index additions and removals (MNA, IDXC)
//
// Each answer is built in the browser from ONE read of its own kind and shown to the MEMBER ONLY: every capability is
// `localOnly` (its name is in turn.LOCAL_ONLY_ACTIONS on the server), every kind is model-isolated, and nothing the read
// returns reaches a model provider. All six were isolated as the builder's default, from the licensing register's rows
// (quoted in each adapter and in MD-1 §4.21); nobody decided otherwise and nobody was asked.
//
// What every answer keeps to:
//   • the date is the DATA'S OWN (the price data's last session, the newest snapshot, the vendor's observation time, the
//     newest fiscal period end, the newest settlement date, each part's read time), never the time of the ask;
//   • a number that does not exist is never 0: an upside with no stored close, a move the history cannot give, a growth
//     with no year-earlier segment, a value with no price;
//   • a list that is cut says so, and from which end;
//   • nothing held and a read that failed are never said as "no rating", "no estimates", "no coverage", "no segments",
//     "no fails" or "no deals"; a part with no row says "no record matched", never that none exist;
//   • an envelope's notes are never echoed, and no vendor is named;
//   • what a kind leaves out is said, with the panel that shows it.
//
// Dark by construction: each is registered only while the server serves its own kind (UCT_AGENT_DATA_KINDS, fail closed; an
// isolated kind also needs its own UCT_AGENT_ISOLATED_KINDS entry or every read is refused). Nothing here arms anything.
// ROUTING: the six share ONE words-only group of their own, `stockResearch` (routing.js lists them by action). It is the
// 54th group of the 56 the server keeps (turn.MAX_GROUPS). Each capability's own words (WAVE12_ROUTE_WORDS) are added to
// that group only while it is registered, so on a dark server the group has no words and no registered action, and
// routing is byte-identical to the base.
import { registerCapability } from '../capabilities'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { GROUPS } from '../routing'
import { stampET } from './marketDataFacts'
import { kindServed, usable, noRead, plural, dayText, money, NO_TURN } from './terminalDataFormat'
import { formatNumber, formatPercent } from '../../lib/presentation/presentationPrimitives'
import { moneyWords, shareWords } from '../../pages/terminal/panels/revenueSegmentsModel'
import { dealDayWords } from '../../pages/terminal/panels/mergersModel'
import { changeDayWords } from '../../pages/terminal/panels/indexChangesModel'

export const KINDS = Object.freeze({
  rating: 'ratings', estimates: 'estimates.history', analysts: 'analyst.ratings', segments: 'company.segments',
  ftd: 'stock.failsToDeliver', deals: 'company.deals',
})
export const CAPABILITIES = Object.freeze({
  rating: 'stock.uctRating', estimates: 'stock.estimatesHistory', analysts: 'stock.consensusRating', segments: 'stock.revenueSplit',
  ftd: 'stock.failsToDeliver', deals: 'stock.companyDeals',
})
export const PANELS = Object.freeze({ rating: 'RTG', estimates: 'EEH', analysts: 'ANR', segments: 'SEG', ftd: 'FTD', deals: 'MNA and IDXC' })
export const NOT_ADVICE = 'not a forecast and not advice'
const TEXT_ROWS = 6
const PRESENT_ROWS = 12
const TICKER = /^[A-Z0-9]{1,10}(?:-[A-Z0-9]{1,4}){0,2}$/
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v) => (Number.isInteger(v) ? v : null)
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)
const list = (v) => (Array.isArray(v) ? v.filter(r => r && typeof r === 'object') : [])
const clamp = (v, max, fallback) => (Number.isInteger(v) ? Math.min(Math.max(v, 1), max) : fallback)
const count = (n) => formatNumber(n, { decimals: 0 })
const signedPct = (v, decimals = 1) => (num(v) === null ? null : formatPercent(v, { decimals, signed: v !== 0 }))
/** "Fri, Nov 13, 2026" → "Nov 13, 2026" */
const shortDay = (ymd) => (dayText(ymd) || '').replace(/^\w+, /, '') || null
/** a ticker the way UCT writes it (BRK.B -> BRK-B), or null */
const tickerOf = (s) => { const t = String(s || '').trim().toUpperCase().replace(/^\$/, '').replace(/\./g, '-'); return TICKER.test(t) ? t : null }
const unclean = (what, none) => ({ text: `I couldn't read ${what}: UCT's data did not answer cleanly. ${none}` })
const more = (n) => `${n} more ${n === 1 ? 'is' : 'are'} in the table.`
const ask = (what, none) => ({ text: `Which stock's ${what} should I read? Give me one ticker. ${none}` })

// ── stock.uctRating ← ratings ────────────────────────────────────────────────────────────────────────────────────────
export const RATING_RECORD = `UCT's own computed score from its fundamentals, ownership and price inputs, never a third-party analyst rating: ${NOT_ADVICE}.`
export const RATING_LEFT_OUT = 'How each component is scored is not in this answer: the RTG panel in UCT explains each one.'
const RATING_NONE = 'No rating is stated. That is not the same as a low rating.'
/** the RTG panel's own component names (RatingsTab.jsx) */
export const COMPONENT_WORDS = Object.freeze([['eps', 'EPS Strength'], ['rs', 'Relative Strength'], ['growth', 'Growth'], ['value', 'Value'],
  ['smr', 'SMR'], ['accdis', 'Acc / Dis'], ['sponsorship', 'Sponsorship']])
const compText = (v) => (typeof v === 'string' && v.trim() ? v.trim() : num(v) !== null ? count(v) : 'not stated')

/** Pure: a `ratings` envelope → the answer. */
export function answerFromRating(envl, sym) {
  const what = `${sym}'s UCT composite rating`
  if (!usable(envl)) {
    return { text: noRead(what, envl, `it is not held on the server yet (this answer never works it out), ${sym} is a fund, or the read failed. Open ${PANELS.rating} for ${sym} in UCT, then ask again`, RATING_NONE) }
  }
  const d = envl.data
  const composite = num(d.composite)
  if (composite === null) return unclean(what, RATING_NONE)
  const comps = obj(d.components) || {}
  const checks = list(d.checkup)
  const passed = checks.filter(c => c.status === 'pass' || c.pass === true).length
  const failed = checks.filter(c => c.status === 'fail' || c.pass === false).length
  const priceDay = str(d.price_as_of)
  const lines = [`${sym}'s UCT composite rating as UCT holds it: ${count(composite)} of 99 (higher is stronger).`,
    `Components: ${COMPONENT_WORDS.map(([k, label]) => `${label} ${compText(comps[k])}`).join(', ')}.`]
  if (checks.length) {
    lines.push(`Stock checkup: ${plural(passed, 'check passes', 'checks pass')}, ${plural(failed, 'fails', 'fail')}${checks.length - passed - failed ? `, ${count(checks.length - passed - failed)} cannot be judged` : ''}.`)
    for (const c of checks.slice(0, TEXT_ROWS)) lines.push(`• ${str(c.label) || str(c.item) || 'a check'}: ${c.status === 'pass' || c.pass === true ? 'passes' : c.status === 'fail' || c.pass === false ? 'fails' : 'cannot be judged'}`)
    if (checks.length > TEXT_ROWS) lines.push(more(checks.length - TEXT_ROWS))
  }
  if (str(d.sector)) lines.push(`Sector: ${str(d.sector)}${num(d.group_rs) !== null ? `; its group's relative strength ${count(d.group_rs)}` : ''}.`)
  lines.push(priceDay ? `The price inputs end with the session of ${dayText(priceDay)}; the fundamental and ownership inputs carry no date.` : 'The answer carries no date for its price inputs, so I cannot say how old it is.')
  if (envl.status === 'partial' || d.complete === false) lines.push('One or more inputs could not be read when UCT worked it out, so the rating rests on what was available.')
  if (envl.stale) lines.push('Stale: the price inputs end before the last completed session, and this answer never works the rating out again.')
  lines.push(RATING_RECORD, RATING_LEFT_OUT)
  const rows = COMPONENT_WORDS.map(([k, label]) => ({ component: label, value: compText(comps[k]) }))
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'component', label: 'Component' }, { key: 'value', label: 'Rating' }], rows: [{ component: 'Composite', value: count(composite) }, ...rows] },
    present: { kind: 'metrics', title: `${sym} UCT composite rating`, short: 'UCT rating', items: [{ label: 'Composite', value: count(composite), note: 'of 99', aka: ['composite'] },
      ...rows.map(r => ({ label: r.component, value: r.value, note: '', aka: [r.component.toLowerCase()] }))] },
    facts: { symbol: sym, as_of: priceDay, composite, components: Object.fromEntries(COMPONENT_WORDS.map(([k]) => [k, comps[k] ?? null])), passed, failed, stale: !!envl.stale },
  }
}

export async function answerRating(args = {}) {
  const sym = tickerOf(args.symbol)
  if (!sym) return ask('UCT composite rating', RATING_NONE)
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${sym}'s UCT composite rating: ${NO_TURN}.` }
  const envl = await readData('ratings', { symbol: sym }, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromRating(envl, sym)
}

// ── stock.estimatesHistory ← estimates.history ───────────────────────────────────────────────────────────────────────
export const ESTIMATES_RECORD = `The analysts' consensus as UCT snapshots it each weekday evening: ${NOT_ADVICE}.`
export const ESTIMATES_LEFT_OUT = 'Every snapshot of each quarter is not in this answer, only the newest and its moves; the fiscal year\'s consensus is not held at all. The EEH panel in UCT shows the snapshots.'
const ESTIMATES_NONE = 'No estimate is stated. That is not the same as no estimates.'
export const MOVE_WORDS = Object.freeze({ up: 'raised', down: 'cut', held: 'held', collecting: 'too new to say', gap: 'a snapshot is missing', not_comparable: 'not comparable' })
export const ORIGIN_WORDS = Object.freeze({ sp500: 'it is on the S&P 500 list UCT\'s daily job seeds', viewed: 'a member opened EEH for it' })
function moveText(m) {
  if (!m) return 'not stated'
  const word = MOVE_WORDS[m.state] || 'not stated'
  return num(m.pct) !== null ? `${word} ${signedPct(m.pct)}` : word
}
const estText = (v, revenue) => (num(v) === null ? 'not stated' : revenue ? (moneyWords(v, null) || 'not stated') : money(v))

/** Pure: an `estimates.history` envelope → the answer. */
export function answerFromEstimates(envl, sym) {
  const what = `${sym}'s estimate history`
  if (!usable(envl)) {
    return { text: noRead(what, envl, `it is not held on the server yet (this answer never adds a snapshot), ${sym} is not among the stocks UCT snapshots, the estimate history is switched off on this server, or the read failed. Open ${PANELS.estimates} for ${sym} in UCT, then ask again`, ESTIMATES_NONE) }
  }
  const d = envl.data
  if (!Array.isArray(d.periods)) return unclean(what, ESTIMATES_NONE)
  const periods = list(d.periods).filter(p => p.upcoming !== false)
  const tr = obj(d.tracked) || {}
  const lines = [`${sym}'s consensus estimates as UCT snapshots them, ${shortDay(d.covers_from) || 'from a day it does not give'} to ${shortDay(d.last_snapshot) || 'a day it does not give'} (${plural(int(d.snapshot_days) ?? 0, 'snapshot day')}):`]
  for (const p of periods.slice(0, TEXT_ROWS)) {
    const n = obj(p.newest) || {}
    const mv = obj(p.moves) || {}
    const eps = obj(mv.eps) || {}
    const rev = obj(mv.revenue) || {}
    lines.push(`• The quarter ending ${shortDay(p.period_end) || 'on a day it does not give'}: EPS ${estText(n.eps_avg)}${num(n.eps_low) !== null && num(n.eps_high) !== null ? ` (${money(n.eps_low)} to ${money(n.eps_high)})` : ''}${int(n.n_eps) !== null ? ` from ${plural(n.n_eps, 'analyst')}` : ''}; over 7 / 30 / 90 days ${moveText(eps['7'])} / ${moveText(eps['30'])} / ${moveText(eps['90'])}. Revenue ${estText(n.rev_avg, true)}; over 7 / 30 / 90 days ${moveText(rev['7'])} / ${moveText(rev['30'])} / ${moveText(rev['90'])}.`)
  }
  if (!periods.length) lines.push(`No upcoming quarter is held for ${sym}, so no estimate is stated. That is not the same as no estimates.`)
  lines.push(`A move compares the newest snapshot with the newest one at least 7, 30 or 90 days earlier: more than ${num(d.tolerance_pct) ?? 0.5}% either way is raised or cut, anything within it held (EEHSC's own rule).`)
  if (str(tr.origin) && ORIGIN_WORDS[tr.origin]) lines.push(`${sym} is in the population UCT snapshots because ${ORIGIN_WORDS[tr.origin]}${int(tr.count) !== null && int(tr.cap) !== null ? ` (${count(tr.count)} of at most ${count(tr.cap)} stocks are tracked)` : ''}.`)
  if (int(d.failed_days)) lines.push(`${plural(d.failed_days, 'snapshot day')} failed to read for ${sym}: gaps, never skipped silently.`)
  if (str(d.store_newest) && str(d.last_snapshot) && d.store_newest > d.last_snapshot) lines.push(`Stale: ${sym}'s newest snapshot (${shortDay(d.last_snapshot)}) is older than the store's newest (${shortDay(d.store_newest)}); the daily read has not answered for it since.`)
  if (str(d.currency) && d.currency !== 'USD') lines.push(`The estimates are in ${d.currency}, the company's reporting currency.`)
  lines.push(ESTIMATES_RECORD, ESTIMATES_LEFT_OUT)
  const rows = periods.map(p => {
    const mv = obj(p.moves) || {}
    return { quarter: shortDay(p.period_end) || p.period_end, eps: estText(obj(p.newest)?.eps_avg), eps30: moveText(obj(mv.eps)?.['30']), revenue: estText(obj(p.newest)?.rev_avg, true), rev30: moveText(obj(mv.revenue)?.['30']) }
  })
  const facts = { symbol: sym, as_of: d.last_snapshot || null, tracked: tr.origin || null,
    periods: periods.map(p => ({ period_end: p.period_end, eps: obj(p.newest)?.eps_avg ?? null, revenue: obj(p.newest)?.rev_avg ?? null,
      eps_moves: Object.fromEntries(['7', '30', '90'].map(w => [w, obj(obj(p.moves)?.eps)?.[w]?.pct ?? null])) })) }
  if (!rows.length) return { text: lines.join('\n'), facts }
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'quarter', label: 'Quarter ending' }, { key: 'eps', label: 'EPS' }, { key: 'eps30', label: 'EPS, 30 days' }, { key: 'revenue', label: 'Revenue' }, { key: 'rev30', label: 'Revenue, 30 days' }], rows },
    present: { kind: 'metrics', title: `${sym} estimate history`, short: 'Estimate history', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.quarter, value: r.eps, note: `30 days: ${r.eps30}`, aka: [String(r.quarter).toLowerCase()] })) },
    facts,
  }
}

export async function answerEstimates(args = {}) {
  const sym = tickerOf(args.symbol)
  if (!sym) return ask('estimate history', ESTIMATES_NONE)
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${sym}'s estimate history: ${NO_TURN}.` }
  const envl = await readData('estimates.history', { symbol: sym }, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromEstimates(envl, sym)
}

// ── stock.consensusRating ← analyst.ratings ──────────────────────────────────────────────────────────────────────────
export const ANALYSTS_DEFAULT_ROWS = 5
export const ANALYSTS_MAX_ROWS = 12
export const ANALYSTS_RECORD = `Analysts' opinions as UCT holds them, not UCT's: ${NOT_ADVICE}.`
export const ANALYSTS_LEFT_OUT = 'The monthly rating trend and the estimate revisions are not in this answer: the ANR panel in UCT shows the revisions.'
const ANALYSTS_NONE = 'No rating is stated. That is not the same as no coverage.'
/** the ANR panel's own bucket names (AnalystRatingsTab.jsx) */
export const BUCKET_WORDS = Object.freeze([['strongBuy', 'Strong Buy'], ['buy', 'Buy'], ['hold', 'Hold'], ['sell', 'Sell'], ['strongSell', 'Strong Sell']])
const target = (v) => (num(v) === null ? 'not stated' : money(v))

/** Pure: an `analyst.ratings` envelope → the answer. */
export function answerFromAnalysts(envl, sym) {
  const what = `${sym}'s analyst ratings`
  if (!usable(envl)) {
    return { text: noRead(what, envl, `they are not held on the server yet (this answer never asks for them), ${sym} is a fund, or the read failed. Open ${PANELS.analysts} for ${sym} in UCT, then ask again`, ANALYSTS_NONE) }
  }
  const d = envl.data
  if (typeof d.covered !== 'boolean') return unclean(what, ANALYSTS_NONE)
  const at = stampET(envl.as_of, envl.fetched_at)
  const lines = []
  if (!d.covered) {
    lines.push(`No analyst coverage is on file for ${sym}: the source answered with no consensus, no price target and no rating action.`)
  } else {
    const c = obj(d.consensus)
    if (c) {
      lines.push(`${sym}'s analyst consensus as UCT holds it: ${str(c.label) || 'no consensus word given'}${int(c.total) !== null ? ` from ${plural(c.total, 'analyst')}` : ''} (${BUCKET_WORDS.map(([k, label]) => `${count(int(c[k]) ?? 0)} ${label}`).join(', ')}).`)
    } else lines.push(`No count of analysts by rating is held for ${sym}.`)
    const p = obj(d.price_target)
    if (p) {
      lines.push(`Price target (USD): consensus ${target(p.consensus)}, median ${target(p.median)}, from ${target(p.low)} to ${target(p.high)}.`)
      const recent = [['last_month', 'last month'], ['last_quarter', 'last quarter'], ['last_year', 'last year']].map(([k, w]) => {
        const b = obj(p[k]) || {}
        return int(b.count) && num(b.avg) !== null ? `${w} ${money(b.avg)} (${plural(b.count, 'target')})` : null
      }).filter(Boolean)
      if (recent.length) lines.push(`Average targets: ${recent.join('; ')}.`)
    } else lines.push(`No price target is held for ${sym}.`)
    const u = obj(d.upside)
    if (u && num(u.pct) !== null) lines.push(`Upside to the ${u.target === 'median' ? 'median' : 'consensus'} target: ${signedPct(u.pct)} from the close of ${dayText(u.close_date) || 'a session it does not give'} (${money(u.close)}), not the last trade.`)
    else if (p) lines.push('No upside is stated: the target or a stored close is missing (that is not an upside of 0).')
    const acts = list(d.recent_actions)
    if (acts.length) {
      lines.push('The most recent rating actions, newest first:')
      for (const a of acts.slice(0, TEXT_ROWS)) lines.push(`• ${shortDay(a.date) || 'a day it does not give'}: ${str(a.company) || 'a firm it does not name'} ${str(a.action) || 'acted'}${str(a.from_grade) || str(a.to_grade) ? ` (${str(a.from_grade) || 'none'} to ${str(a.to_grade) || 'none'})` : ''}`)
      if (acts.length > TEXT_ROWS) lines.push(more(acts.length - TEXT_ROWS))
      const total = int(d.actions_total) ?? acts.length
      if (total > acts.length) lines.push(`${count(total)} recent actions are held and the newest ${count(acts.length)} are in this answer: the list is cut from the old end.`)
    }
    if (d.outage === true) lines.push(`Some of ${sym}'s analyst data could not be read when UCT last asked; what is stated is what answered, and a missing section is not the same as none.`)
  }
  lines.push(at ? `The source observed it at ${at}; this answer never asks again.` : 'The answer carries no time the source observed it, so I cannot say how old it is.')
  lines.push(ANALYSTS_RECORD, ANALYSTS_LEFT_OUT)
  const c = obj(d.consensus) || {}
  const facts = { symbol: sym, as_of: envl.as_of || null, covered: d.covered, consensus: str(c.label), total: int(c.total),
    target: num(obj(d.price_target)?.consensus), upside_pct: num(obj(d.upside)?.pct), actions: list(d.recent_actions).length }
  const rows = list(d.recent_actions).map(a => ({ date: shortDay(a.date) || 'n/a', firm: str(a.company) || 'n/a', action: str(a.action) || 'n/a', change: `${str(a.from_grade) || '-'} to ${str(a.to_grade) || '-'}` }))
  if (!rows.length) return { text: lines.join('\n'), facts }
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'date', label: 'Date' }, { key: 'firm', label: 'Firm' }, { key: 'action', label: 'Action' }, { key: 'change', label: 'Rating' }], rows },
    present: { kind: 'metrics', title: `${sym} analyst ratings`, short: 'Analyst ratings', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.firm, value: r.action, note: `${r.date}: ${r.change}`, aka: [r.firm.toLowerCase()] })) },
    facts,
  }
}

export async function answerAnalysts(args = {}) {
  const sym = tickerOf(args.symbol)
  if (!sym) return ask('analyst ratings', ANALYSTS_NONE)
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${sym}'s analyst ratings: ${NO_TURN}.` }
  const params = { symbol: sym, rows: clamp(args.rows, ANALYSTS_MAX_ROWS, ANALYSTS_DEFAULT_ROWS) }
  const envl = await readData('analyst.ratings', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromAnalysts(envl, sym)
}

// ── stock.revenueSplit ← company.segments ────────────────────────────────────────────────────────────────────────────
export const SEGMENTS_DEFAULT_ROWS = 8
export const SEGMENTS_MAX_ROWS = 25
export const SEGMENTS_RECORD = 'Company-reported segment figures: shares are of the segments listed, which may not add up to total revenue. Not advice.'
export const SEGMENTS_LEFT_OUT = 'The earlier periods side by side are not in this answer: the SEG panel in UCT shows them.'
const SEGMENTS_NONE = 'No segment is stated. That is not the same as no segments.'
export const LEG_WORDS = Object.freeze({ none: 'the source answered with no period it could read', not_in_plan: 'the site\'s plan with the source does not include it',
  not_configured: 'the source is not switched on for this server', rate_limited: 'the source turned the read away for too many requests', failed: 'the source\'s answer could not be read' })
const growthText = (s) => (num(s.growth_pct) !== null ? `${signedPct(s.growth_pct)} on a year earlier` : 'no year-earlier figure')

/** Pure: a `company.segments` envelope → the answer. */
export function answerFromSegments(envl, sym) {
  const what = `${sym}'s revenue by segment`
  if (!usable(envl)) {
    return { text: noRead(what, envl, `it is not held on the server yet (this answer never builds it), or the read failed. Open ${PANELS.segments} for ${sym} in UCT, then ask again`, SEGMENTS_NONE) }
  }
  const d = envl.data
  const splits = obj(d.splits)
  if (!splits) return unclean(what, SEGMENTS_NONE)
  const lines = [`${sym}'s revenue by segment as UCT holds it:`]
  const rows = []
  for (const [period, label] of [['annual', 'year'], ['quarter', 'quarter']]) {
    const sp = obj(splits[period]) || { state: 'not_held' }
    if (sp.state !== 'held') { lines.push(`The newest ${label}'s split is not held on the server yet (this answer never builds it): open SEG ${period === 'quarter' ? 'QUARTERLY' : 'ANNUAL'} for ${sym} in UCT, then ask again.`); continue }
    for (const [leg, legLabel] of [['product', 'by product'], ['region', 'by region']]) {
      const lg = obj(sp[leg]) || {}
      const latest = obj(lg.latest)
      if (!latest) { lines.push(`The ${label}'s split ${legLabel} is not stated: ${LEG_WORDS[lg.state] || LEG_WORDS.failed}. That is not the same as no segments.`); continue }
      const segs = list(latest.segments)
      const prior = obj(lg.prior)
      lines.push(`${label === 'year' ? 'The fiscal year' : 'The quarter'} ${str(latest.label) || latest.date} ${legLabel} (ended ${shortDay(latest.date) || latest.date}${prior ? `, against ${str(prior.label) || prior.date}` : ', no year-earlier period held'}):`)
      for (const s of segs.slice(0, TEXT_ROWS)) lines.push(`• ${s.name}: ${moneyWords(s.revenue, latest.currency)}, ${shareWords(s.share)} of the segments listed, ${growthText(s)}`)
      if (segs.length > TEXT_ROWS) lines.push(more(segs.length - TEXT_ROWS))
      const total = int(latest.segments_total) ?? segs.length
      if (total > segs.length) lines.push(`${count(total)} segments are held and the largest ${count(segs.length)} are in this answer: the smallest are cut.`)
      for (const s of segs) rows.push({ period: `${str(latest.label) || latest.date} ${leg}`, segment: s.name, revenue: moneyWords(s.revenue, latest.currency), share: shareWords(s.share), growth: num(s.growth_pct) !== null ? signedPct(s.growth_pct) : 'n/a' })
    }
  }
  lines.push('Growth is each segment against the same segment a year earlier, worked out from the held periods; a segment without one has no growth stated (never 0).')
  lines.push(SEGMENTS_RECORD, SEGMENTS_LEFT_OUT)
  const facts = { symbol: sym, as_of: envl.as_of ? String(envl.as_of).slice(0, 10) : null,
    splits: Object.fromEntries(['annual', 'quarter'].map(p => [p, obj(splits[p])?.state || 'not_held'])) }
  if (!rows.length) return { text: lines.join('\n'), facts }
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'period', label: 'Period' }, { key: 'segment', label: 'Segment' }, { key: 'revenue', label: 'Revenue' }, { key: 'share', label: 'Share' }, { key: 'growth', label: 'Growth' }], rows },
    present: { kind: 'metrics', title: `${sym} revenue by segment`, short: 'Revenue by segment', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.segment, value: r.revenue, note: `${r.share}, ${r.growth}`, aka: [r.segment.toLowerCase()] })) },
    facts,
  }
}

export async function answerSegments(args = {}) {
  const sym = tickerOf(args.symbol)
  if (!sym) return ask('revenue by segment', SEGMENTS_NONE)
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${sym}'s revenue by segment: ${NO_TURN}.` }
  const params = { symbol: sym, rows: clamp(args.rows, SEGMENTS_MAX_ROWS, SEGMENTS_DEFAULT_ROWS) }
  const envl = await readData('company.segments', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromSegments(envl, sym)
}

// ── stock.failsToDeliver ← stock.failsToDeliver ──────────────────────────────────────────────────────────────────────
export const FTD_DEFAULT_ROWS = 10
export const FTD_MAX_ROWS = 40
export const FTD_RECORD = 'Each figure is the balance of shares that failed to deliver on that settlement date, not the day\'s new fails; balances are never added up across days. Public SEC data, not advice.'
export const FTD_LAG = 'The SEC posts each half-month\'s file in the second half of the following period, so the newest figure is some weeks old.'
const FTD_NONE = 'No balance is stated. That is not the same as no fails.'
const sharesText = (n) => (int(n) === null ? 'not stated' : `${count(n)} shares`)

/** Pure: a `stock.failsToDeliver` envelope → the answer. */
export function answerFromFtd(envl, sym) {
  const what = `${sym}'s fails to deliver`
  if (!usable(envl)) {
    return { text: noRead(what, envl, `no file is held on the server yet (this answer never downloads one), the data set is switched off on this server, or the read failed. Open ${PANELS.ftd} for ${sym} in UCT, then ask again`, FTD_NONE) }
  }
  const d = envl.data
  const w = obj(d.window)
  if (!w) return unclean(what, FTD_NONE)
  const span = `${shortDay(w.from) || 'a day it does not give'} to ${shortDay(w.through) || 'a day it does not give'}`
  const lines = []
  const latest = obj(d.latest)
  if (!latest) {
    lines.push(`No fails-to-deliver row for ${sym} is in the SEC files UCT holds for ${span}. No record matched; that is not the same as no fails ever.`)
  } else {
    const t = obj(d.trend) || {}
    lines.push(`${sym}'s fails to deliver as UCT holds them from the SEC's files for ${span}: ${sharesText(latest.quantity)} on ${shortDay(latest.settle_date)}${num(latest.value) !== null ? ` (${moneyWords(latest.value, 'USD')})` : ', no value (no price in the file)'}.`)
    const prev = obj(t.previous)
    if (prev) lines.push(`The reported day before (${shortDay(prev.settle_date)}): ${sharesText(prev.quantity)}${int(t.change) !== null ? `, a change of ${t.change > 0 ? '+' : ''}${count(t.change)} shares` : ''}.`)
    const peak = obj(t.peak)
    if (peak) lines.push(`The window's peak: ${sharesText(peak.quantity)} on ${shortDay(peak.settle_date)}${num(t.latest_vs_peak_pct) !== null ? `; the newest is ${formatPercent(t.latest_vs_peak_pct, { decimals: 1 })} of it` : ''}.`)
    const rows = list(d.rows)
    lines.push(`${plural(int(d.days_reported) ?? rows.length, 'settlement day')} reported in the window; the newest first:`)
    for (const r of rows.slice(0, TEXT_ROWS)) lines.push(`• ${shortDay(r.settle_date)}: ${sharesText(r.quantity)}${num(r.value) !== null ? `, ${moneyWords(r.value, 'USD')}` : ', no value'}`)
    if (rows.length > TEXT_ROWS) lines.push(more(rows.length - TEXT_ROWS))
    if ((int(d.days_reported) ?? 0) > rows.length) lines.push(`${count(d.days_reported)} days are reported and the newest ${count(rows.length)} are in this answer: the list is cut from the old end.`)
  }
  const mm = Array.isArray(d.mismatched_files) ? d.mismatched_files : []
  if (mm.length) lines.push(`${plural(mm.length, 'file')} did not reconcile with ${mm.length === 1 ? 'its' : 'their'} own row count and ${mm.length === 1 ? 'is' : 'are'} kept, marked.`)
  lines.push(FTD_LAG, FTD_RECORD)
  const rows = list(d.rows).map(r => ({ day: shortDay(r.settle_date) || r.settle_date, shares: int(r.quantity) !== null ? count(r.quantity) : 'n/a', value: num(r.value) !== null ? moneyWords(r.value, 'USD') : 'n/a' }))
  const facts = { symbol: sym, as_of: latest?.settle_date || w.through || null, latest: int(latest?.quantity), change: int(obj(d.trend)?.change), days: int(d.days_reported) }
  if (!rows.length) return { text: lines.join('\n'), facts }
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'day', label: 'Settlement day' }, { key: 'shares', label: 'Shares failed' }, { key: 'value', label: 'Value' }], rows },
    present: { kind: 'metrics', title: `${sym} fails to deliver`, short: 'Fails to deliver', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.day, value: r.shares, note: r.value, aka: [String(r.day).toLowerCase()] })) },
    facts,
  }
}

export async function answerFtd(args = {}) {
  const sym = tickerOf(args.symbol)
  if (!sym) return ask('fails to deliver', FTD_NONE)
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${sym}'s fails to deliver: ${NO_TURN}.` }
  const params = { symbol: sym, rows: clamp(args.rows, FTD_MAX_ROWS, FTD_DEFAULT_ROWS) }
  const envl = await readData('stock.failsToDeliver', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromFtd(envl, sym)
}

// ── stock.companyDeals ← company.deals ───────────────────────────────────────────────────────────────────────────────
export const DEALS_DEFAULT_ROWS = 10
export const DEALS_MAX_ROWS = 50
export const DEALS_RECORD = 'Announcements as filed and as the index lists record them: a record, not advice.'
const DEALS_NONE = 'No deal and no index change is stated. That is not the same as none.'
export const SEARCH_WORDS = Object.freeze({
  ok: 'its name was searched and the latest filings were looked through', none: 'its name was searched and the latest filings were looked through',
  no_name: 'the server holds no company name for it, so only the latest filings were looked through, by symbol',
  not_in_plan: 'the name search is not in the site\'s plan, so only the latest filings were looked through',
  not_configured: 'the source is not switched on for this server, so only the latest filings were looked through',
  rate_limited: 'the name search was turned away for too many requests, so only the latest filings were looked through',
  failed: 'the name search could not be read, so only the latest filings were looked through',
  not_run: 'no name search has been run for it on the server, so only the market\'s latest filings were looked through, by symbol',
})
const partyText = (p) => (p ? (p.sym && p.name ? `${p.name} (${p.sym})` : p.name || p.sym) : 'a party it does not name')

/** Pure: a `company.deals` envelope → the answer. */
export function answerFromDeals(envl, sym) {
  const what = `${sym}'s deals and index changes`
  if (!usable(envl)) {
    return { text: noRead(what, envl, `they are not held on the server yet (this answer never builds them), or the read failed. Open MNA or IDXC for ${sym} in UCT, then ask again`, DEALS_NONE) }
  }
  const d = envl.data
  const dp = obj(d.deals)
  const ip = obj(d.index_changes)
  if (!dp || !ip) return unclean(what, DEALS_NONE)
  const lines = []
  const rows = []
  if (dp.state === 'not_held') lines.push(`${sym}'s deals are not held on the server yet (this answer never builds them): open MNA for ${sym} in UCT, then ask again.`)
  else {
    const deals = list(dp.deals)
    const how = SEARCH_WORDS[dp.search] || SEARCH_WORDS.failed
    if (!deals.length) lines.push(`No deal in what UCT holds matched ${sym} (${how}). No record matched; that is not the same as a company with no deals.`)
    else {
      lines.push(`Mergers and acquisitions naming ${sym}${str(dp.name) ? ` (${dp.name})` : ''}, newest first (${how}):`)
      for (const x of deals.slice(0, TEXT_ROWS)) lines.push(`• ${dealDayWords(x.date)}: ${partyText(x.acquirer)} acquiring ${x.target ? partyText(x.target) : 'a target it does not name'}${x.role === 'target' ? ` (${sym} the target)` : x.role === 'acquirer' ? ` (${sym} the acquirer)` : ''}${x.link ? ', with its SEC filing' : ''}`)
      if (deals.length > TEXT_ROWS) lines.push(more(deals.length - TEXT_ROWS))
      if ((int(dp.total) ?? 0) > deals.length) lines.push(`${count(dp.total)} deals are held and the newest ${count(deals.length)} are in this answer: the list is cut from the old end.`)
    }
    if (int(dp.other_companies)) lines.push(`${plural(dp.other_companies, 'more deal')} matched the name search but name a different company; not in this answer.`)
    for (const x of deals) rows.push({ day: dealDayWords(x.date), what: `${partyText(x.acquirer)} acquiring ${x.target ? partyText(x.target) : 'n/a'}`, kind: 'Deal' })
  }
  if (ip.state === 'not_held') lines.push(`${sym}'s index changes are not held on the server yet (this answer never builds them): open IDXC for ${sym} in UCT, then ask again.`)
  else {
    const changes = list(ip.changes)
    if (!changes.length) lines.push(`No addition to or removal from the S&P 500, the Nasdaq 100 or the Dow 30 in what UCT holds matched ${sym}. No record matched; that is not the same as a stock never in an index.`)
    else {
      lines.push(`${sym}'s index changes, newest first:`)
      for (const c of changes.slice(0, TEXT_ROWS)) {
        const other = c.side === 'added' ? (c.removed ? `, replacing ${partyText(c.removed)}` : '') : (c.added ? `, replaced by ${partyText(c.added)}` : '')
        lines.push(`• ${changeDayWords(c.date)}: ${c.side === 'added' ? 'added to' : 'removed from'} the ${c.index_name}${other}${str(c.reason) ? ` (${c.reason})` : ''}`)
      }
      if (changes.length > TEXT_ROWS) lines.push(more(changes.length - TEXT_ROWS))
      if ((int(ip.total) ?? 0) > changes.length) lines.push(`${count(ip.total)} changes are held and the newest ${count(changes.length)} are in this answer: the list is cut from the old end.`)
    }
    const legs = obj(ip.indexes) || {}
    const out = Object.entries(legs).filter(([, st]) => st && !['ok', 'none'].includes(st)).map(([i]) => ({ sp500: 'S&P 500', nasdaq100: 'Nasdaq 100', dow: 'Dow 30' }[i] || i))
    if (out.length) lines.push(`The ${out.join(' and ')} list${out.length === 1 ? ' was' : 's were'} not read when UCT last asked, so ${out.length === 1 ? 'its' : 'their'} changes are not stated.`)
    for (const c of changes) rows.push({ day: changeDayWords(c.date), what: `${c.side === 'added' ? 'Added to' : 'Removed from'} the ${c.index_name}`, kind: 'Index' })
  }
  const reads = [['deals', dp.read_at], ['index changes', ip.read_at]].filter(([, t]) => t).map(([k, t]) => `${k} at ${stampET(t, envl.fetched_at)}`)
  lines.push(reads.length ? `UCT read them from the source: ${reads.join('; ')} (UCT's own time), and this answer never reads them again.` : 'The answer carries no time UCT read them, so I cannot say how old they are.')
  lines.push(DEALS_RECORD)
  const facts = { symbol: sym, deals: dp.state === 'not_held' ? null : list(dp.deals).length, index_changes: ip.state === 'not_held' ? null : list(ip.changes).length, search: dp.search || null }
  if (!rows.length) return { text: lines.join('\n'), facts }
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'day', label: 'Day' }, { key: 'kind', label: 'Kind' }, { key: 'what', label: 'What' }], rows },
    present: { kind: 'metrics', title: `${sym} deals and index changes`, short: 'Deals and index changes', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.day, value: r.kind, note: r.what, aka: [String(r.day).toLowerCase()] })) },
    facts,
  }
}

export async function answerDeals(args = {}) {
  const sym = tickerOf(args.symbol)
  if (!sym) return ask('deals and index changes', DEALS_NONE)
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${sym}'s deals and index changes: ${NO_TURN}.` }
  const params = { symbol: sym, rows: clamp(args.rows, DEALS_MAX_ROWS, DEALS_DEFAULT_ROWS) }
  const envl = await readData('company.deals', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromDeals(envl, sym)
}

// ── routing words (armed only while registered; routing.js's `stockResearch` group lists none) ───────────────────────
// Routing v2 reaches the six by their summaries. v1 (the kill-switch fallback, and the router the capability-regression
// corpus runs) selects a group by its words, and `stockResearch` is words-only: these words are the only way v1 sends it.
// Routing only ADDS a group (the other groups a message names still ride along), and each pattern is kept off another
// capability's own language:
//   rating     a stock's UCT rating or UCT score, its composite rating or score, its stock checkup. Never the RS rating
//              (rs.compare), never an analyst's rating, never a screen on a rating (the screener's F-16 refusal);
//   estimates  a stock's estimate history, how its estimates changed, its estimate revisions or trend. Never the
//              revisions by sector (wave 11), never this quarter's estimate itself (the earnings kind);
//   analysts   a stock's price target, its consensus or street target, its consensus rating, the buy / hold / sell count,
//              how many analysts cover it, its upside to the target. Never the market's upgrades and downgrades or
//              target changes (wave 1);
//   segments   a stock's revenue by segment, region, product or business, its segment or geographic revenue, its revenue
//              mix or breakdown, where it makes its money. Never its revenue itself (fundamentals);
//   ftd        fails to deliver. Never a follow-through day (breadth), never short interest (wave 5);
//   deals      the mergers, acquisitions or takeovers involving one stock, whether it was acquired, its additions to and
//              removals from an index, its index history. Never the market's latest deals or index changes (the MNA and
//              IDXC panels), never what a fund holds;
//   not ours   a screen or its condition, an alert, a watchlist, the member's own lists, a page or a panel, or what a term
//              MEANS (the guide).
// ⛔ no lookbehind (iOS 16 floor, src/noRegexLookbehind.test.js).
const NOT_A_SCREEN = '^(?!.*\\b(?:scans?|screens?|screener|filters?|find|alerts?|notify|widgets?|page|tab|panel|watchlists?|my|portfolio|positions?)\\b)(?!.*(?:\\b(?:over|above|under|below|at least|more than|less than|greater than)\\b|[<>])\\s*\\$?\\d)'
const NOT_A_MEANING = '(?!.*\\b(?:explain|define|definition|meaning|means?|difference between|how (?:is|are|do|does) .* (?:calculated|worked out|computed|work|works))\\b)'
  + '(?!what(?:\'s|’s| is| are) (?:an? |the )?(?:uct rating|composite rating|composite score|stock checkup|estimate history|estimate revisions?|price targets?|consensus rating|revenue by segment|segment revenue|fails? to deliver|ftds?|mergers?|acquisitions?|index changes?)\\W*$)'
const OURS = `${NOT_A_SCREEN}${NOT_A_MEANING}`
const NOT_MANY = '(?!.*\\b(?:stocks|names|tickers|equities|universe|sectors?|industr(?:y|ies)|themes?|groups?)\\b)'
const NOT_RS = '(?!.*\\b(?:rs|relative strength)\\b)'
const NOT_MARKET_LIST = '(?!.*\\b(?:latest|recent|upcoming|this week|today|the market|across the market|all)\\b)'
/** a rating action or a target change is the market's upgrades list (wave 1), never one stock's standing ratings */
const NOT_ACTIONS = '(?!.*\\b(?:raised|raises|raising|cut|cuts|cutting|lowered|lowers|hiked|hikes|changes?|changed|upgrades?|upgraded|downgrades?|downgraded|initiat\\w*|today)\\b)'
const INDEX = '(?:the )?(?:s&p(?: ?500)?|nasdaq(?:[- ]?100)?|ndx|dow(?: jones| 30)?|index)'
export const WAVE12_ROUTE_WORDS = Object.freeze({
  rating: [
    new RegExp(`${OURS}${NOT_RS}${NOT_MANY}.*\\buct (?:composite )?(?:ratings?|scores?)\\b`),
    new RegExp(`${OURS}${NOT_RS}${NOT_MANY}.*\\bcomposite (?:ratings?|scores?)\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\bstock checkup\\b`),
  ],
  estimates: [
    new RegExp(`${OURS}${NOT_MANY}.*\\b(?:eps |earnings |revenue |sales |consensus )?estimates? history\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\b(?:eps |earnings |revenue |sales )?estimates? (?:revisions?|trend|changes)\\b(?! (?:by|across|per) )`),
    new RegExp(`${OURS}${NOT_MANY}.*\\bhow (?:have|has|did) (?:the |its |\\S+(?:'s|’s) )?(?:eps |earnings |revenue |sales |consensus )?estimates? (?:changed|moved|come down|gone up|been revised)\\b`),
  ],
  analysts: [
    new RegExp(`${OURS}${NOT_MANY}${NOT_ACTIONS}.*\\bprice targets? (?:for|on|of)\\b`),
    new RegExp(`${OURS}${NOT_MANY}${NOT_ACTIONS}.*\\b[a-z]{1,5}(?:'s|’s) price targets?\\b`),
    new RegExp(`${OURS}${NOT_MANY}${NOT_ACTIONS}.*\\b(?:consensus|street|median|average) (?:price )?targets?\\b`),
    new RegExp(`${OURS}${NOT_MANY}${NOT_ACTIONS}.*\\b(?:consensus|street) ratings?\\b|^${NOT_A_SCREEN.slice(1)}${NOT_A_MEANING}${NOT_MANY}${NOT_ACTIONS}.*\\banalysts?(?:'s?|’s?)? ratings? (?:for|on|of)\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\bbuy[\\s,/]+(?:or\\s+)?hold[\\s,/]+(?:or\\s+|and\\s+)?sell\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\bhow many analysts\\b`),
    new RegExp(`${OURS}${NOT_MANY}${NOT_ACTIONS}.*\\bupside to (?:the |its )?(?:price )?target\\b`),
  ],
  segments: [
    new RegExp(`${OURS}${NOT_MANY}.*\\brevenue (?:by|per) (?:segments?|regions?|products?|geography|business(?:es| lines?)?|divisions?)\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\b(?:segment|geographic|regional|product) (?:revenue|sales|breakdown|mix)\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\brevenue (?:split|breakdown|mix)\\b`),
    new RegExp(`${OURS}${NOT_MANY}.*\\bwhere does \\S+ (?:make|earn|get) (?:its|their) (?:money|revenue)\\b`),
  ],
  ftd: [
    new RegExp(`${OURS}.*\\bfails?[- ]to[- ]deliver\\b`),
    new RegExp(`${OURS}.*\\bfail(?:ures?|ed)? to deliver\\b|^${NOT_A_SCREEN.slice(1)}.*\\bdelivery fail(?:s|ures?)\\b`),
  ],
  deals: [
    new RegExp(`${OURS}${NOT_MANY}${NOT_MARKET_LIST}.*\\b(?:mergers?|acquisitions?|m&a|takeovers?|buyouts?|deals?) (?:involving|naming|for|by|of)\\b`),
    new RegExp(`${OURS}${NOT_MANY}${NOT_MARKET_LIST}.*\\b(?:has|did|was|is) \\S+ (?:been |being )?(?:acquired|bought out|taken over|an acquisition target)\\b`),
    new RegExp(`${OURS}${NOT_MANY}${NOT_MARKET_LIST}.*\\b(?:when|was|did|has|is) \\S+ (?:get |getting |been |being )?(?:added to|removed from|dropped from|kicked out of|join(?:ed)?|leave|left) ${INDEX}\\b`),
    new RegExp(`${OURS}${NOT_MANY}${NOT_MARKET_LIST}.*\\bindex (?:history|membership|changes?) (?:for|of|on)\\b|^${NOT_A_SCREEN.slice(1)}${NOT_MANY}.*\\b[a-z]{1,5}(?:'s|’s) index (?:history|membership|changes?)\\b`),
  ],
})
export const ROUTE_GROUP = 'stockResearch'
const ownGroup = () => GROUPS.find(g => g.id === ROUTE_GROUP)
/** Adds (or takes back) ONE capability's words on the wave's own group. */
function armRoutes(key, on) {
  const g = ownGroup()
  if (!g) return
  for (const re of WAVE12_ROUTE_WORDS[key]) {
    const at = g.words.indexOf(re)
    if (on && at < 0) g.words.push(re)
    if (!on && at >= 0) g.words.splice(at, 1)
  }
}

// ── registration: each capability only while the server serves ITS kind ───────────────────────────────────────────────
// ⚠️ THE WORDS OF A NAME, A SUMMARY AND ITS HINTS JOIN THE TYPO LEXICON (nl/lexicon.js: every lowercase word of three letters
// or more; a word in CAPITALS does not). A new known word changes what a nearby word in ANY member message may be
// "corrected" to, so the text below is worded to add NO word the production catalog does not know (pinned in
// agentTerminalDataWave12.test.js, "the typo lexicon"), except the name words that test shows change no correction. The
// names were chosen for that: `stock.uctRating`, `stock.estimatesHistory`, `stock.consensusRating` ("analyst" and
// "ratings" are not known; `stock.analystRatings` would add both) and `stock.revenueSplit` ("segments" is not known) add
// no word; `stock.failsToDeliver` and `stock.companyDeals` add "fails", "deliver" and "deals". No argument carries an enum.
const TARGET_HINT = 'target = the ref of the stockData entry.'
const SYMBOL_HINT = 'symbol = the one ticker named (or the open chart\'s symbol).'
const NO_FIGURES = 'reply: one short line, no figures.'
const HELD_ONLY = 'Answered only from what the SERVER already HOLDS, so it may say none is held.'
const symbolRows = { type: 'object', properties: { symbol: { type: 'string' }, rows: { type: ['integer', 'null'] } }, required: ['symbol', 'rows'], additionalProperties: false }
const symbolOnly = { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'], additionalProperties: false }
const unregister = {}

/** Idempotent; registers each of the six ONLY while the server serves its kind. Returns the names registered by this call. */
export function registerTerminalWave12Capabilities() {
  const added = []
  if (!unregister.rating && kindServed(KINDS.rating)) {
    unregister.rating = registerCapability({
      name: 'stock.uctRating',            // a LITERAL: the server's local-only mirror rail reads it (tests/test_uct_agent_breadth.py)
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ UCT-derived scores (ADR-005), which no ruling clears for a model
      summary: 'ONE STOCK\'s UCT COMPOSITE RATING as UCT HOLDS it: the COMPOSITE (1-99), its COMPONENTS (EPS STRENGTH, RELATIVE STRENGTH, GROWTH, VALUE, SMR, ACC / DIS, SPONSORSHIP) and the STOCK CHECKUP; UCT\'s OWN SCORE, NEVER an ANALYST\'s. '
        + 'For "NVDA UCT RATING", "WHAT is AMD\'s COMPOSITE RATING".',
      hints: `${TARGET_HINT} ${SYMBOL_HINT} The date is the PRICE DATA's LAST SESSION: never today. UCT's OWN SCORE, not ADVICE. ${HELD_ONLY} `
        + `The RS RATING and ANALYST RATINGS are not this answer. ${NO_FIGURES}`,
      args: symbolOnly,
      answer: (_snap, args) => answerRating(args || {}),
    })
    armRoutes('rating', true)
    added.push(CAPABILITIES.rating)
  }
  if (!unregister.estimates && kindServed(KINDS.estimates)) {
    unregister.estimates = registerCapability({
      name: 'stock.estimatesHistory',     // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ the estimates vendor's consensus, whose AI row has no AI clause
      summary: 'ONE STOCK\'s ESTIMATE HISTORY as UCT HOLDS it: for EACH UPCOMING QUARTER in UCT\'s DAILY SNAPSHOTS the NEWEST CONSENSUS EPS and REVENUE ESTIMATE, and HOW EACH MOVED over 7, 30 and 90 DAYS; WHETHER UCT TRACKS the STOCK at ALL. '
        + 'For "NVDA ESTIMATE HISTORY", "HOW HAVE AAPL\'s ESTIMATES CHANGED".',
      hints: `${TARGET_HINT} ${SYMBOL_HINT} The date is the NEWEST SNAPSHOT's: never today. ESTIMATES, not ADVICE. ${HELD_ONLY} `
        + `REVISIONS BY SECTOR and THIS QUARTER's EARNINGS are not this answer. ${NO_FIGURES}`,
      args: symbolOnly,
      answer: (_snap, args) => answerEstimates(args || {}),
    })
    armRoutes('estimates', true)
    added.push(CAPABILITIES.estimates)
  }
  if (!unregister.analysts && kindServed(KINDS.analysts)) {
    unregister.analysts = registerCapability({
      name: 'stock.consensusRating',      // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ the estimates vendor's ratings and targets, whose AI row has no AI clause
      summary: 'ONE STOCK\'s ANALYST RATINGS as UCT HOLDS them: the COUNT of ANALYSTS BY RATING (STRONG BUY to STRONG SELL) with the CONSENSUS, the PRICE TARGET (HIGH, LOW, MEDIAN, CONSENSUS), the UPSIDE from its LAST STORED CLOSE, and the MOST RECENT RATING ACTIONS. '
        + 'For "NVDA PRICE TARGET", "CONSENSUS RATING on AAPL".',
      hints: `${TARGET_HINT} ${SYMBOL_HINT} ROWS 1-${ANALYSTS_MAX_ROWS} ACTIONS (null = ${ANALYSTS_DEFAULT_ROWS}). The date is WHEN the SOURCE OBSERVED it: never today. OPINIONS, not ADVICE. ${HELD_ONLY} `
        + `The MARKET's UPGRADES and DOWNGRADES are not this answer. ${NO_FIGURES}`,
      args: symbolRows,
      answer: (_snap, args) => answerAnalysts(args || {}),
    })
    armRoutes('analysts', true)
    added.push(CAPABILITIES.analysts)
  }
  if (!unregister.segments && kindServed(KINDS.segments)) {
    unregister.segments = registerCapability({
      name: 'stock.revenueSplit',         // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ the vendor's company data, which no register row clears for a model
      summary: 'ONE STOCK\'s REVENUE BY SEGMENT as UCT HOLDS it: for the NEWEST FISCAL YEAR and QUARTER, the SPLIT BY PRODUCT and BY REGION with EACH SEGMENT\'s REVENUE, SHARE and GROWTH on a YEAR EARLIER. '
        + 'For "NVDA REVENUE BY SEGMENT", "AAPL REVENUE BY REGION".',
      hints: `${TARGET_HINT} ${SYMBOL_HINT} ROWS 1-${SEGMENTS_MAX_ROWS} SEGMENTS a SPLIT (null = ${SEGMENTS_DEFAULT_ROWS}). The date is the NEWEST PERIOD END: never today. REPORTED FIGURES, not ADVICE. ${HELD_ONLY} `
        + `TOTAL REVENUE and the STATEMENTS are not this answer. ${NO_FIGURES}`,
      args: symbolRows,
      answer: (_snap, args) => answerSegments(args || {}),
    })
    armRoutes('segments', true)
    added.push(CAPABILITIES.segments)
  }
  if (!unregister.ftd && kindServed(KINDS.ftd)) {
    unregister.ftd = registerCapability({
      name: 'stock.failsToDeliver',       // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ the SEC's NSCC-derived files, which no register row names a model lane for
      summary: 'ONE STOCK\'s FAILS to DELIVER as UCT HOLDS them from the SEC\'s FILES: the NEWEST SETTLEMENT DAYS\' BALANCE of SHARES that FAILED with its VALUE, the CHANGE from the DAY BEFORE, the PEAK, the WINDOW the FILES COVER and their LAG. '
        + 'For "NVDA FAILS to DELIVER".',
      hints: `${TARGET_HINT} ${SYMBOL_HINT} ROWS 1-${FTD_MAX_ROWS} DAYS (null = ${FTD_DEFAULT_ROWS}). The date is the NEWEST SETTLEMENT DATE, WEEKS OLD: never today. PUBLIC DATA, not ADVICE. ${HELD_ONLY} `
        + `SHORT INTEREST is not this answer. ${NO_FIGURES}`,
      args: symbolRows,
      answer: (_snap, args) => answerFtd(args || {}),
    })
    armRoutes('ftd', true)
    added.push(CAPABILITIES.ftd)
  }
  if (!unregister.deals && kindServed(KINDS.deals)) {
    unregister.deals = registerCapability({
      name: 'stock.companyDeals',         // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ the vendor's deal and index lists, which no register row clears for a model
      summary: 'ONE STOCK\'s MERGERS and ACQUISITIONS (as ACQUIRER or TARGET, with EACH SEC FILING) and its ADDITIONS to and REMOVALS from the S&P 500, NASDAQ 100 and DOW 30, as UCT HOLDS them; NO RECORD MATCHED is NEVER NONE. '
        + 'For "MERGERS INVOLVING NVDA", "WHEN was TSLA ADDED to the S&P 500".',
      hints: `${TARGET_HINT} ${SYMBOL_HINT} ROWS 1-${DEALS_MAX_ROWS} a PART (null = ${DEALS_DEFAULT_ROWS}). EACH PART HAS its OWN READ TIME: never today. A RECORD, not ADVICE. ${HELD_ONLY} `
        + `The MARKET's LATEST DEALS are not this answer. ${NO_FIGURES}`,
      args: symbolRows,
      answer: (_snap, args) => answerDeals(args || {}),
    })
    armRoutes('deals', true)
    added.push(CAPABILITIES.deals)
  }
  return added
}
export const _resetTerminalWave12ForTest = () => {
  for (const k of Object.keys(unregister)) { unregister[k]?.(); delete unregister[k] }
  for (const k of Object.keys(WAVE12_ROUTE_WORDS)) armRoutes(k, false)
}
