// Terminal data wave 11 — seven LOCAL-ONLY capabilities over seven model-isolated data kinds (MD-1 §4.20):
//   stock.groupRank         groups.rank                every sector's or industry's weekly rank, the movers (GRPS RANK)
//   stock.groupOwnership    groups.crowding            short interest, insider buying and fund adds by group (GRPS CROWDING)
//   stock.sectorEarnings    earnings.seasonBySector    an earnings season by sector: beat / in line / miss, surprise, reaction (ERNSC)
//   stock.estimatesBreadth  estimates.revisionBreadth  estimate revisions by sector among the stocks UCT tracks (EEHSC)
//   stock.ivRankLeaders     options.ivRankLeaders      the highest and lowest IV rank across UCT's own options log (OSCR RICH / CHEAP)
//   stock.ipoUnlock         ipo.lockups                estimated IPO lockup expiries, the next 30 days and the past 7 (IPO LOCKUP)
//   stock.positionTypes     cot.byTrader               futures positioning by trader type, one market or the board (COT)
//
// Each answer is built in the browser from ONE read of its own kind and shown to the MEMBER ONLY: every capability is
// `localOnly` (its name is in turn.LOCAL_ONLY_ACTIONS on the server), every kind is model-isolated, and nothing the read
// returns reaches a model provider. All seven were isolated as the builder's default, from the licensing register's rows
// (quoted in each adapter and in MD-1 §4.20); nobody decided otherwise and nobody was asked.
//
// What every answer keeps to:
//   • the date is the DATA'S OWN (the newest session's close, the newest held copy or snapshot, the session a list read,
//     the listings scan's time, the report's Tuesday), never the time of the ask; the time UCT worked it out rides beside it;
//   • a number that does not exist is never 0: a group or sector resting on fewer than five stocks, a group with no rank, a
//     change since listing the closes cannot give, a side the CFTC printed none for;
//   • a list that is cut says so, and from which end;
//   • nothing held and a read that failed are never said as "no rank", "not crowded", "no reports", "no revisions", "no
//     rich options", "no lockups" or "no positions";
//   • every lockup date is an estimate, and is said to be one;
//   • an envelope's notes are never echoed, and no vendor is named;
//   • what a kind leaves out is said, with the panel that shows it.
//
// The panels' own models read the data (each kind keeps its route's field names) and give the words, so an answer and its
// panel say the same thing.
//
// Dark by construction: each is registered only while the server serves its own kind (UCT_AGENT_DATA_KINDS, fail closed; an
// isolated kind also needs its own UCT_AGENT_ISOLATED_KINDS entry or every read is refused). Nothing here arms anything.
// ROUTING: the seven share ONE words-only group of their own, `marketTables` (routing.js lists them by action). It is the
// 53rd group of the 56 the server keeps (turn.MAX_GROUPS). Each capability's own words (WAVE11_ROUTE_WORDS) are added to
// that group only while it is registered, so on a dark server the group has no words and no registered action, and
// routing is byte-identical to the base.
import { registerCapability } from '../capabilities'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { GROUPS } from '../routing'
import { stampET } from './marketDataFacts'
import { kindServed, usable, noRead, plural, andList, dayText, NO_TURN } from './terminalDataFormat'
import { formatNumber, formatPercent } from '../../lib/presentation/presentationPrimitives'
import { GROUP_STATS_KINDS, readRank, rankText, placeText, placesText, placesWords, changeText as grpChange } from '../../pages/terminal/panels/groupStatsModel'
import { pctText as posPct, daysText as posDays, dollarsText } from '../../pages/terminal/panels/groupPositioningModel'
import {
  readSectorEarnings, sortSectors, coverageLine as seasonCoverage, seasonLine, countsLine, triWords, medianWords, moveWords, yearAgoLine,
  rateText, pctText as sePct, reportedText,
} from '../../pages/terminal/panels/sectorEarningsModel'
import {
  readRevisionBreadth, trackedLine, windowLine, totalLine, coverageLine as revCoverage, netWords, collectingWords, pctText as revPct,
} from '../../pages/terminal/panels/revisionBreadthModel'
import {
  ivRankRead, rankText as ivRank, ivText, percentileText, rangeText as ivRange, sessionsText, oiText, countsText as ivCounts, cutText as ivCut,
  builtText as ivBuilt, logText as ivLog,
} from '../../pages/terminal/panels/ivRankModel'
import { lockupRead, dateText as lockupDate, daysText as lockupDays, changeText as lockupChange } from '../../pages/terminal/panels/ipoLockupModel'
import { cotFinerRead, cotFinerBoard, signedContracts, contractsText, shareText as cotShare, reportDay, concentrationText, recordsText } from '../../pages/terminal/panels/cotModel'

export const KINDS = Object.freeze({
  rank: 'groups.rank', crowding: 'groups.crowding', season: 'earnings.seasonBySector', revisions: 'estimates.revisionBreadth',
  ivrank: 'options.ivRankLeaders', lockups: 'ipo.lockups', cot: 'cot.byTrader',
})
export const CAPABILITIES = Object.freeze({
  rank: 'stock.groupRank', crowding: 'stock.groupOwnership', season: 'stock.sectorEarnings', revisions: 'stock.estimatesBreadth',
  ivrank: 'stock.ivRankLeaders', lockups: 'stock.ipoUnlock', cot: 'stock.positionTypes',
})
export const PANELS = Object.freeze({ rank: 'GRPS RANK', crowding: 'GRPS CROWDING', season: 'ERNSC', revisions: 'EEHSC', ivrank: 'OSCR RICH', lockups: 'IPO LOCKUP', cot: 'COT' })
export const NOT_ADVICE = 'not a forecast and not advice'
const TEXT_ROWS = 12
const PRESENT_ROWS = 12
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v) => (Number.isInteger(v) ? v : null)
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)
const list = (v) => (Array.isArray(v) ? v.filter(r => r && typeof r === 'object') : [])
const clamp = (v, max, fallback) => (Number.isInteger(v) ? Math.min(Math.max(v, 1), max) : fallback)
const count = (n) => formatNumber(n, { decimals: 0 })
/** "Fri, Nov 13, 2026" → "Nov 13, 2026" */
const shortDay = (ymd) => (dayText(ymd) || '').replace(/^\w+, /, '') || null
const unclean = (what, none) => ({ text: `I couldn't read ${what}: UCT's data did not answer cleanly. ${none}` })
const more = (n) => `${n} more ${n === 1 ? 'is' : 'are'} in the table.`
const workedAt = (read, what) => (read ? `UCT worked ${what} out at ${read} (UCT's own time), and this answer never works ${what} out again.`
  : `The answer carries no time UCT worked ${what} out, so I cannot say how old ${what === 'it' ? 'it is' : 'they are'}.`)
const word = (v) => String(v ?? '').trim().toLowerCase()
/** sector | industry from a member's word, else sector */
const groupKind = (v) => (/^industr/.test(word(v)) ? 'industry' : 'sector')
const groupName = (v) => (str(v) && str(v).length <= 80 ? str(v).replace(/\s+/g, ' ') : null)

// ── stock.groupRank ← groups.rank ────────────────────────────────────────────────────────────────────────────────────
export const RANK_DEFAULT_ROWS = 10
export const RANK_MAX_ROWS = 50
export const RANK_RECORD = `Places from UCT's stored daily closes (split-adjusted, price only): a record of the past, ${NOT_ADVICE}.`
export const RANK_LEFT_OUT = 'Each group\'s weekly line, its fundamentals and its breadth are not in this answer: the GRPS panel in UCT shows them.'
const RANK_NONE = 'No rank is stated. That is not the same as no rank.'
/** the rank part's own states (the GRPS panel's words, without its "now": an answer never says when it is read) */
export const RANK_STATE_WORDS = Object.freeze({
  pending: 'the weekly rank appears after the next evening build: the figures UCT holds were worked out before it was added. That is not the same as no rank.',
  unavailable: 'no stored closes could be read at the last evening build, so there is no weekly rank. That is not the same as no rank.',
})
const BACKS = [['w4', '4 weeks ago'], ['w13', '13 weeks ago'], ['w52', '52 weeks ago']]
const stocks = (n) => `${count(n ?? 0)} ${n === 1 ? 'stock' : 'stocks'}`
function backText(p) {
  if (!p) return 'no such week held'
  if (p.position === null) return `no place (${stocks(p.n)} with a change)`
  return `${placeText(p.position)}${p.change !== null ? ` (${placesWords(p.change)} since)` : ''}`
}
function groupLine(g, min) {
  const m = g.rank?.m6
  const at = m?.now
  if (!at) return `• ${g.name}: no week held in the stored closes.`
  if (at.position === null) return `• ${g.name}: ${stocks(at.n)} with a 6-month change, fewer than ${min}: no rank (never a rank of 0).`
  const backs = BACKS.map(([k, label]) => `${label} ${backText(m[k])}`).join('; ')
  const range = m.best && m.worst ? `; best ${placeText(m.best.position)} (${shortDay(m.best.date) || 'a week it does not give'}), worst ${placeText(m.worst.position)} (${shortDay(m.worst.date) || 'a week it does not give'})` : ''
  return `• ${rankText(at)} ${g.name}: median ${grpChange(at.median) ?? 'n/a'} over 6 months on ${stocks(at.n)}; ${backs}${range}.`
}
const moverText = (x) => `${x.name} (${placesText(x.change)}, ${placeText(x.from?.position)} to ${placeText(x.to?.position)})`

/** Pure: a `groups.rank` envelope → the answer. */
export function answerFromRank(envl, args = {}) {
  const kind = groupKind(args.kind)
  const K = GROUP_STATS_KINDS[kind]
  const what = `the ${K.many}' weekly rank`
  if (!usable(envl)) {
    return { text: noRead(what, envl, `it is not held on the server yet (this answer never works it out), or the read failed. Open ${PANELS.rank} in UCT, then ask again`, RANK_NONE) }
  }
  const d = envl.data
  const rk = obj(d.rank)
  if (!rk || typeof rk.state !== 'string') return unclean(what, RANK_NONE)
  const read = stampET(d.built_at, envl.fetched_at)
  const min = int(rk.min_members) || 5
  const lines = []
  const stale = Array.isArray(d.stale_for) && d.stale_for.includes('earlier_evening')
  const tail = () => {
    if (stale) lines.push('Stale: UCT worked these out for an earlier evening, and a newer evening has begun. This answer never works them out again; the server\'s next evening build adds it.')
    lines.push(RANK_RECORD, RANK_LEFT_OUT, workedAt(read, 'these'))
  }
  if (rk.state !== 'ok') {
    lines.push(`${K.label} by weekly rank: ${RANK_STATE_WORDS[rk.state] || RANK_STATE_WORDS.unavailable}`)
    tail()
    return { text: lines.join('\n'), facts: { kind, as_of: d.session || null, rank: rk.state, read, stale } }
  }
  if (d.found !== undefined) {                                           // one group
    const name = str(d.name) || groupName(args.name) || 'that group'
    if (d.found !== true) {
      lines.push(`No ${K.one} named "${name}" is in UCT's table of ${count(int(d.peers) ?? 0)} ${K.many} (names are matched as GRPS matches them). That is not the same as a ${K.one} with no rank.`)
      tail()
      return { text: lines.join('\n'), facts: { kind, as_of: d.session || null, found: false, read, stale } }
    }
    const r = readRank(d.group_rank)
    lines.push(`${name}'s weekly rank among the ${K.many}, as UCT holds it from the stored closes of its ${stocks(int(d.members))} through ${dayText(d.session) || 'a session it does not give'}:`)
    for (const [mid, label] of [['m6', '6-month'], ['m3', '3-month']]) {
      const m = r?.[mid]
      if (!m?.now) { lines.push(`• By the ${label} change: no week held.`); continue }
      const at = m.now
      const head = at.position === null ? `no place (${stocks(at.n)} with a change, fewer than ${min})` : `${rankText(at)} (median ${grpChange(at.median) ?? 'n/a'} on ${stocks(at.n)})`
      lines.push(`• By the ${label} change: ${head}; ${BACKS.map(([k, l]) => `${l} ${backText(m[k])}`).join('; ')}${m.best && m.worst ? `; best ${rankText(m.best)}, worst ${rankText(m.worst)} over ${count(m.weeksRanked)} ranked weeks` : ''}.`)
    }
    tail()
    const m6 = r?.m6
    return {
      text: lines.join('\n'),
      present: { kind: 'metrics', title: `${name} weekly rank`, short: 'Group rank', items: [
        { label: '6-month rank', value: rankText(m6?.now) || 'n/a', note: 'the newest week', aka: ['rank'] },
        ...BACKS.map(([k, l]) => ({ label: l, value: m6?.[k]?.position ? placeText(m6[k].position) : 'n/a', note: m6?.[k]?.change != null ? placesWords(m6[k].change) : '', aka: [k] })),
      ] },
      facts: { kind, as_of: d.session || null, found: true, name, position: m6?.now?.position ?? null, of: m6?.now?.of ?? null, read, stale },
    }
  }
  const groups = list(d.groups).map(g => ({ name: str(g.name) || 'a group with no name', members: int(g.members), rank: readRank(g.rank) }))
  const total = int(d.groups_total) ?? groups.length
  lines.push(`${K.label} by weekly rank as UCT holds it (each ${K.one}'s place by the median 6-month price change of its stocks), from the stored closes through ${dayText(d.session) || 'a session it does not give'}:`)
  for (const g of groups.slice(0, TEXT_ROWS)) lines.push(groupLine(g, min))
  if (groups.length > TEXT_ROWS) lines.push(more(groups.length - TEXT_ROWS))
  if (total > groups.length && groups.length) lines.push(`${count(total)} ${K.many} are held and the top ${count(groups.length)} by rank are in this answer: the list is cut from the bottom of the ranking.`)
  const mv = obj(d.movers) || {}
  for (const [back, label] of [['w4', '4 weeks'], ['w13', '13 weeks']]) {
    const m = obj(mv[back])
    if (!m) continue
    const up = list(m.up)
    const down = list(m.down)
    lines.push(up.length ? `Climbed the most over ${label}: ${andList(up.map(moverText))}.` : `No ${K.one} climbed over ${label}.`)
    lines.push(down.length ? `Fell the most over ${label}: ${andList(down.map(moverText))}.` : `No ${K.one} fell over ${label}.`)
  }
  tail()
  const rows = groups.map(g => {
    const m = g.rank?.m6
    return { group: g.name, rank: m?.now?.position ? rankText(m.now) : 'no rank', moves: BACKS.map(([k]) => (m?.[k]?.change != null ? placesText(m[k].change) : 'n/a')).join(' / '),
      range: m?.best && m?.worst ? `${placeText(m.best.position)} / ${placeText(m.worst.position)}` : 'n/a' }
  })
  const facts = {
    kind, as_of: d.session || null, read, stale, total, shown: groups.length,
    groups: groups.map(g => ({ name: g.name, position: g.rank?.m6?.now?.position ?? null, of: g.rank?.m6?.now?.of ?? null, n: g.rank?.m6?.now?.n ?? null,
      w4: g.rank?.m6?.w4?.change ?? null, w13: g.rank?.m6?.w13?.change ?? null, w52: g.rank?.m6?.w52?.change ?? null })),
    movers: Object.fromEntries(Object.entries(mv).map(([k, m]) => [k, { up: list(m?.up).map(x => x.name), down: list(m?.down).map(x => x.name) }])),
  }
  if (!rows.length) return { text: lines.join('\n'), facts }
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'group', label: K.head }, { key: 'rank', label: 'Rank' }, { key: 'moves', label: '4 / 13 / 52 weeks' }, { key: 'range', label: 'Best / worst' }], rows },
    present: { kind: 'metrics', title: `${K.label} weekly rank`, short: 'Group rank', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.group, value: r.rank, note: r.moves, aka: [r.group.toLowerCase()] })) },
    facts,
  }
}

export async function answerRank(args = {}) {
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the weekly rank: ${NO_TURN}.` }
  const params = { kind: groupKind(args.kind), name: groupName(args.name), rows: clamp(args.rows, RANK_MAX_ROWS, RANK_DEFAULT_ROWS) }
  const envl = await readData('groups.rank', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromRank(envl, params)
}

// ── stock.groupOwnership ← groups.crowding ──────────────────────────────────────────────────────────────────────────
export const CROWDING_DEFAULT_ROWS = 10
export const CROWDING_MAX_ROWS = 50
export const CROWDING_RECORD = 'Reports and filings rolled up by group, not advice. Insider buying is open-market purchases only: the server keeps no insider sales.'
export const CROWDING_LEFT_OUT = 'Institutions (13F) are not in this answer: the server keeps no store of the whole market\'s 13F holdings. Each group\'s rank, fundamentals and breadth are not in it either: the GRPS panel in UCT shows them.'
export const PART_STATE_WORDS = Object.freeze({
  not_held: 'the server had not read that store yet at the last evening build',
  not_built: 'the server had not built that index yet at the last evening build',
  unavailable: 'the source did not answer for it at the last evening build',
  failed: 'that store could not be read at the last evening build',
  pending: 'it was added after the last evening build; it appears after the next one',
})
const CROWDING_NONE = 'No figure is stated. That is not the same as no crowding.'
const PART_TITLES = Object.freeze({ short: 'Short interest', insider: 'Insider buying', funds: 'Fund holdings' })
const median = (s) => num(obj(s)?.median)
function shortWords(s, min) {
  if (!s) return 'short interest not on hand'
  const p = median(s.pct_float)
  if (p === null) return `${count(int(s.reported) ?? 0)} in the short interest report, fewer than ${min}: no median`
  const top = list(s.top).map(t => `${t.sym} ${posPct(num(t.pct_float))}`).filter(Boolean)
  return `median short interest ${posPct(p)} of float on ${count(int(obj(s.pct_float)?.n) ?? 0)}, days to cover ${posDays(median(s.days_to_cover)) ?? 'n/a'}, change ${sePct(median(s.change)) ?? 'n/a'}${top.length ? `; most shorted ${top.join(', ')}` : ''}`
}
function insiderWords(i) {
  if (!i) return 'insider buying not on hand'
  const b = obj(i.buyers) || {}
  return `${count(int(b.count) ?? 0)} of ${count(int(i.members) ?? 0)} bought on the open market (${count(int(i.purchases) ?? 0)} purchases${num(i.value) !== null ? `, ${dollarsText(i.value)}` : ''})`
}
function fundWords(f, min) {
  if (!f) return 'fund holdings not on hand'
  const a = obj(f.adding) || {}
  if (num(a.share) === null) return `${count(int(f.known) ?? 0)} with a known fund change, fewer than ${min}: no share`
  return `more funds added than cut in ${rateText(num(a.share))} of ${count(int(a.n) ?? 0)}, median net change ${sePct(median(f.net)) ?? 'n/a'}`
}
function partsLines(parts) {
  const out = []
  const p = obj(parts) || {}
  for (const k of ['short', 'insider', 'funds']) {
    const s = obj(p[k]) || { state: 'failed' }
    if (s.state !== 'ok') { out.push(`${PART_TITLES[k]}: not stated: ${PART_STATE_WORDS[s.state] || PART_STATE_WORDS.failed}. That is not the same as none.`); continue }
    if (k === 'short') out.push(`Short interest: FINRA's report for settlement ${shortDay(s.settlement_date) || 'a day it does not give'}${shortDay(s.previous_settlement_date) ? `, against the one for ${shortDay(s.previous_settlement_date)}` : ''}; reported twice a month.`)
    if (k === 'insider') out.push(`Insider buying: open-market purchases (SEC Form 4) filed ${shortDay(s.from) || 'a day it does not give'} to ${shortDay(s.to) || 'a day it does not give'}${s.complete === false ? '; some filings in that span were not read yet, so the counts may be short' : ''}.`)
    if (k === 'funds') out.push(`Fund holdings: the SEC's Form N-PORT data set ${str(s.quarter) || ''}${shortDay(s.period_to) ? `, reports for periods ending up to ${shortDay(s.period_to)}` : ''}; posted once a quarter, so a report can be months old.`)
  }
  return out
}

/** Pure: a `groups.crowding` envelope → the answer. */
export function answerFromCrowding(envl, args = {}) {
  const kind = groupKind(args.kind)
  const K = GROUP_STATS_KINDS[kind]
  const what = `the ${K.many}' positioning`
  if (!usable(envl)) {
    return { text: noRead(what, envl, `it is not held on the server yet (this answer never works it out), or the read failed. Open ${PANELS.crowding} in UCT, then ask again`, CROWDING_NONE) }
  }
  const d = envl.data
  if (!obj(d.parts)) return unclean(what, CROWDING_NONE)
  const min = int(d.min_members) || 5
  const read = stampET(d.built_at, envl.fetched_at)
  const stale = Array.isArray(d.stale_for) && d.stale_for.includes('earlier_evening')
  const lines = []
  const tail = () => {
    lines.push(...partsLines(d.parts))
    if (stale) lines.push('Stale: UCT worked these out at an earlier evening build, and a newer evening has begun. This answer never works them out again.')
    lines.push(CROWDING_RECORD, CROWDING_LEFT_OUT, workedAt(read, 'these'))
  }
  if (d.found !== undefined) {
    const name = str(d.name) || groupName(args.name) || 'that group'
    if (d.found !== true) {
      lines.push(`No ${K.one} named "${name}" is in UCT's table of ${count(int(d.peers) ?? 0)} ${K.many}. That is not the same as a ${K.one} that is not crowded.`)
      tail()
      return { text: lines.join('\n'), facts: { kind, found: false, read, stale } }
    }
    const pos = obj(d.positioning) || {}
    lines.push(`${name}'s positioning (${stocks(int(d.members))}), as UCT holds it:`)
    lines.push(`• ${shortWords(obj(pos.short), min)}.`, `• ${insiderWords(obj(pos.insider))}.`, `• ${fundWords(obj(pos.funds), min)}.`)
    const members = list(d.member_rows)
    if (members.length) {
      lines.push('Its most shorted members:')
      for (const r of members.slice(0, TEXT_ROWS)) {
        lines.push(`  ${r.sym}: ${num(r.pct_float) !== null ? `${posPct(r.pct_float)} of float short` : 'no percent of float'}${num(r.days_to_cover) !== null ? `, ${posDays(r.days_to_cover)} days to cover` : ''}${int(r.buys) ? `, ${plural(r.buys, 'insider purchase')}` : ''}${int(r.funds_added) !== null ? `, ${count(r.funds_added)} funds added and ${count(int(r.funds_cut) ?? 0)} cut` : ''}`)
      }
      if (members.length > TEXT_ROWS) lines.push(more(members.length - TEXT_ROWS))
      const held = int(d.member_total) ?? members.length
      if (held > members.length) lines.push(`${count(held)} members are held and the ${count(members.length)} most shorted are in this answer: the list is cut from the least shorted end.`)
    }
    tail()
    const rows = members.map(r => ({ stock: r.sym, short: num(r.pct_float) !== null ? posPct(r.pct_float) : 'n/a', buys: int(r.buys) ? count(r.buys) : '0 held', funds: int(r.funds_added) !== null ? `+${count(r.funds_added)} / -${count(int(r.funds_cut) ?? 0)}` : 'n/a' }))
    const facts = { kind, found: true, name, members: int(d.members), short_median: median(obj(pos.short)?.pct_float), read, stale }
    if (!rows.length) return { text: lines.join('\n'), facts }
    return { text: lines.join('\n'),
      table: { columns: [{ key: 'stock', label: 'Stock' }, { key: 'short', label: 'Short float' }, { key: 'buys', label: 'Insider buys' }, { key: 'funds', label: 'Funds added / cut' }], rows },
      present: { kind: 'metrics', title: `${name} positioning`, short: 'Group positioning', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.stock, value: r.short, note: r.funds, aka: [r.stock.toLowerCase()] })) },
      facts }
  }
  const groups = list(d.groups).map(g => ({ name: str(g.name) || 'a group with no name', members: int(g.members), pos: obj(g.positioning) || {} }))
  const total = int(d.groups_total) ?? groups.length
  lines.push(`${K.label} by positioning as UCT holds it, the highest median short interest first (UCT's default order):`)
  for (const g of groups.slice(0, TEXT_ROWS)) lines.push(`• ${g.name} (${stocks(g.members)}): ${shortWords(obj(g.pos.short), min)}; ${insiderWords(obj(g.pos.insider))}; ${fundWords(obj(g.pos.funds), min)}.`)
  if (groups.length > TEXT_ROWS) lines.push(more(groups.length - TEXT_ROWS))
  if (total > groups.length && groups.length) lines.push(`${count(total)} ${K.many} are held and the first ${count(groups.length)} are in this answer: the list is cut from the low end.`)
  tail()
  const rows = groups.map(g => ({ group: g.name, short: median(obj(g.pos.short)?.pct_float) !== null ? posPct(median(g.pos.short.pct_float)) : 'n/a',
    insider: obj(g.pos.insider) ? `${count(int(obj(g.pos.insider.buyers)?.count) ?? 0)} of ${count(int(g.pos.insider.members) ?? 0)}` : 'n/a',
    funds: num(obj(obj(g.pos.funds)?.adding)?.share) !== null ? rateText(g.pos.funds.adding.share) : 'n/a' }))
  const facts = { kind, read, stale, total, shown: groups.length, parts: Object.fromEntries(['short', 'insider', 'funds'].map(k => [k, obj(d.parts[k])?.state || 'failed'])),
    groups: groups.map(g => ({ name: g.name, short_median: median(obj(g.pos.short)?.pct_float), adding_share: num(obj(obj(g.pos.funds)?.adding)?.share) })) }
  if (!rows.length) return { text: lines.join('\n'), facts }
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'group', label: K.head }, { key: 'short', label: 'Median short float' }, { key: 'insider', label: 'Insider buyers' }, { key: 'funds', label: 'Funds adding' }], rows },
    present: { kind: 'metrics', title: `${K.label} positioning`, short: 'Group positioning', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.group, value: r.short, note: r.funds, aka: [r.group.toLowerCase()] })) },
    facts,
  }
}

export async function answerCrowding(args = {}) {
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the positioning by group: ${NO_TURN}.` }
  const params = { kind: groupKind(args.kind), name: groupName(args.name), rows: clamp(args.rows, CROWDING_MAX_ROWS, CROWDING_DEFAULT_ROWS) }
  const envl = await readData('groups.crowding', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromCrowding(envl, params)
}

// ── stock.sectorEarnings ← earnings.seasonBySector ──────────────────────────────────────────────────────────────────
export const SEASON_RECORD = `Reported results against the analysts' consensus, and the closes around each report: a record, ${NOT_ADVICE}.`
export const SEASON_LEFT_OUT = 'Each sector\'s reporters, the stocks still to report and the ones whose result has not reached UCT are not in this answer: the ERNSC panel in UCT shows them.'
const SEASON_NONE = 'No figure is stated. That is not the same as no reports.'
/** a member's word → current | previous | year_ago */
export function seasonOf(v) {
  const w = word(v)
  if (/year[ _-]?ago|last year|a year earlier/.test(w)) return 'year_ago'
  if (/previous|prior|last season|last quarter/.test(w)) return 'previous'
  return 'current'
}
const metricOf = (v) => (/^(?:rev|sales)/.test(word(v)) ? 'revenue' : 'eps')

/** Pure: an `earnings.seasonBySector` envelope → the answer. */
export function answerFromSeason(envl, args = {}) {
  const season = seasonOf(args.season)
  const metric = metricOf(args.metric)
  const what = 'the earnings season by sector'
  if (!usable(envl)) {
    return { text: noRead(what, envl, `it is not held on the server yet (this answer never adds it up), or the read failed. Open ${PANELS.season} in UCT, then ask again`, SEASON_NONE) }
  }
  const d = envl.data
  const v = readSectorEarnings({ ...d, status: 'ok' })
  if (!['ok', 'none_yet', 'empty'].includes(v.state)) return unclean(what, SEASON_NONE)
  const read = stampET(d.built_at, envl.fetched_at)
  const stale = Array.isArray(d.stale_for) && d.stale_for.includes('earlier_day')
  const lines = [seasonCoverage(v)]
  const sl = seasonLine(v, season)
  if (sl) lines.push(sl)
  const pick = (f) => (metric === 'revenue' ? f.revenue : f.eps)
  if (v.state === 'empty') lines.push('UCT holds no stock\'s earnings results yet, so nothing is counted.')
  else if (v.state === 'none_yet') lines.push('No stock UCT holds results for has reported in this season yet, and none is due.')
  else {
    lines.push(countsLine(v.total))
    lines.push(`All reporters: ${triWords(pick(v.total), metric, v.minReporters)}; ${medianWords(pick(v.total), metric, v.minReporters)}; ${moveWords(v.total.move, v.minReporters)}.`)
    if (v.total.yearAgo) lines.push(yearAgoLine(v.total.yearAgo, metric, v.seasons?.year_ago?.label, v.minReporters))
    const sectors = sortSectors(v.sectors, metric)
    lines.push(`By sector, the highest ${metric === 'revenue' ? 'revenue' : 'EPS'} beat share first:`)
    for (const s of sectors.slice(0, TEXT_ROWS)) {
      const m = pick(s)
      const beat = m.beatPct === null ? `${count(m.n)} with a consensus, fewer than ${v.minReporters}: no share` : `${rateText(m.beatPct)} beat, ${rateText(m.inLinePct)} in line, ${rateText(m.missPct)} missed`
      const ago = s.yearAgo && pick(s.yearAgo).beatPct !== null ? `; a year earlier ${rateText(pick(s.yearAgo).beatPct)} beat` : ''
      lines.push(`• ${s.name} (${reportedText(s)}): ${beat}; median surprise ${sePct(m.median) ?? 'not stated'}; median move ${sePct(s.move.median) ?? 'not stated'}${ago}.`)
    }
    if (sectors.length > TEXT_ROWS) lines.push(more(sectors.length - TEXT_ROWS))
  }
  const cov = v.coverage
  if (cov.copiesOld) lines.push(`${plural(cov.copiesOld, 'held copy is', 'held copies are')} more than ${cov.oldDays} days old, so a recent report may not be counted yet.`)
  if (stale) lines.push('Stale: UCT added these up on an earlier day, so the counts still to report may have moved, and this answer never adds them up again.')
  lines.push(SEASON_RECORD, SEASON_LEFT_OUT, workedAt(read, 'these'))
  const facts = {
    season, metric, as_of: cov.newestCopy, read, stale, held: cov.held, universe: cov.universe,
    total: { reported: v.total?.reported ?? null, beat_pct: v.total ? pick(v.total).beatPct : null, median: v.total ? pick(v.total).median : null, move: v.total?.move?.median ?? null },
    sectors: (v.sectors || []).map(s => ({ name: s.name, reported: s.reported, beat_pct: pick(s).beatPct, median: pick(s).median, move: s.move.median })),
  }
  if (v.state !== 'ok') return { text: lines.join('\n'), facts }
  const rows = sortSectors(v.sectors, metric).map(s => ({ sector: s.name, beat: pick(s).beatPct === null ? 'n/a' : rateText(pick(s).beatPct), surprise: sePct(pick(s).median) ?? 'n/a', move: sePct(s.move.median) ?? 'n/a' }))
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'sector', label: 'Sector' }, { key: 'beat', label: 'Beat' }, { key: 'surprise', label: 'Median surprise' }, { key: 'move', label: 'Median move' }], rows },
    present: { kind: 'metrics', title: 'Earnings season by sector', short: 'Sector earnings', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.sector, value: r.beat, note: `surprise ${r.surprise}`, aka: [r.sector.toLowerCase()] })) },
    facts,
  }
}

export async function answerSeason(args = {}) {
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the earnings season by sector: ${NO_TURN}.` }
  const params = { season: seasonOf(args.season) }
  const envl = await readData('earnings.seasonBySector', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromSeason(envl, { ...params, metric: metricOf(args.metric) })
}

// ── stock.estimatesBreadth ← estimates.revisionBreadth ──────────────────────────────────────────────────────────────
export const REVISIONS_RECORD = `Analysts' consensus estimates as UCT snapshots them each weekday evening: ${NOT_ADVICE}.`
export const REVISIONS_LEFT_OUT = 'Each sector\'s list of every stock with its change is not in this answer, only its largest raises and cuts: the EEHSC panel in UCT shows them.'
const REVISIONS_NONE = 'No count is stated. That is not the same as no revisions.'
const windowOf = (v) => (Number(v) === 7 || /^(?:7|1w|week)/.test(word(v)) ? 7 : 30)

/** Pure: an `estimates.revisionBreadth` envelope → the answer. */
export function answerFromRevisions(envl, args = {}) {
  const metric = metricOf(args.metric)
  const window = windowOf(args.window)
  const what = 'the estimate revisions by sector'
  if (!usable(envl)) {
    return { text: noRead(what, envl, `they are not held on the server yet (this answer never adds them up), the estimate history is switched off on this server, or the read failed. Open ${PANELS.revisions} in UCT, then ask again`, REVISIONS_NONE) }
  }
  const d = envl.data
  const v = readRevisionBreadth({ ...d, status: 'ok' })
  if (!['ok', 'collecting', 'empty'].includes(v.state)) return unclean(what, REVISIONS_NONE)
  const read = stampET(d.built_at, envl.fetched_at)
  const lines = [trackedLine(v), windowLine(v, metric, window)]
  if (v.state === 'empty') lines.push('UCT tracks no stock\'s estimates yet, so nothing is counted.')
  else if (v.state === 'collecting') lines.push(collectingWords(v, window))
  else {
    lines.push(totalLine(v), `All tracked stocks: ${revCoverage(v.total)}`)
    lines.push('By sector, the highest net breadth first:')
    for (const s of v.sectors.slice(0, TEXT_ROWS)) {
      const ups = s.raises.map(x => `${x.symbol} ${revPct(x.pct)}`)
      const downs = s.cuts.map(x => `${x.symbol} ${revPct(x.pct)}`)
      lines.push(`• ${s.name}: ${netWords(s, v.minCounted)}${ups.length ? `; largest raises ${ups.join(', ')}` : ''}${downs.length ? `; largest cuts ${downs.join(', ')}` : ''}.`)
    }
    if (v.sectors.length > TEXT_ROWS) lines.push(more(v.sectors.length - TEXT_ROWS))
  }
  lines.push(REVISIONS_RECORD, REVISIONS_LEFT_OUT, workedAt(read, 'these'))
  const facts = { metric, window, as_of: v.asof, read, tracked: v.tracked.n, total: { up: v.total.up, down: v.total.down, held: v.total.held, counted: v.total.counted, net: v.total.net },
    sectors: v.sectors.map(s => ({ name: s.name, up: s.up, down: s.down, held: s.held, counted: s.counted, net: s.net })) }
  if (v.state !== 'ok') return { text: lines.join('\n'), facts }
  const rows = v.sectors.map(s => ({ sector: s.name, net: s.net === null ? 'n/a' : formatPercent(s.net, { decimals: 0, signed: s.net !== 0 }), counts: `${count(s.up)} / ${count(s.down)} / ${count(s.held)}`, counted: count(s.counted) }))
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'sector', label: 'Sector' }, { key: 'net', label: 'Net breadth' }, { key: 'counts', label: 'Raised / cut / held' }, { key: 'counted', label: 'Counted' }], rows },
    present: { kind: 'metrics', title: 'Estimate revisions by sector', short: 'Revision breadth', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.sector, value: r.net, note: r.counts, aka: [r.sector.toLowerCase()] })) },
    facts,
  }
}

export async function answerRevisions(args = {}) {
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the estimate revisions by sector: ${NO_TURN}.` }
  const params = { metric: metricOf(args.metric), window: windowOf(args.window) }
  const envl = await readData('estimates.revisionBreadth', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromRevisions(envl, params)
}

// ── stock.ivRankLeaders ← options.ivRankLeaders ─────────────────────────────────────────────────────────────────────
export const IVRANK_DEFAULT_ROWS = 10
export const IVRANK_MAX_ROWS = 100
export const IVRANK_RECORD = `An end-of-day snapshot from UCT's own options log, each symbol against its own logged sessions: a record of the past, ${NOT_ADVICE}.`
const IVRANK_NONE = 'No symbol is stated. That is not the same as no rich or cheap options.'
/** a member's word → high | low | both */
export function sideOf(v) {
  const w = word(v)
  if (/^(?:high|rich|expensive|top)/.test(w)) return 'high'
  if (/^(?:low|cheap|bottom)/.test(w)) return 'low'
  return 'both'
}
const ivRow = (r) => `• ${r.sym}: IV rank ${ivRank(r.ivRank)}${r.word ? ` (${r.word})` : ''}, IV percentile ${percentileText(r.ivPercentile)}, ATM IV ${ivText(r.atmIv)}${ivRange(r) ? ` (its range ${ivRange(r)})` : ''}, over ${sessionsText(r.sessions)} sessions, open interest ${oiText(r.openInterest)}`

/** Pure: an `options.ivRankLeaders` envelope → the answer. */
export function answerFromIvRank(envl, args = {}) {
  const side = sideOf(args.side)
  const what = 'the IV rank list'
  if (!usable(envl)) {
    return { text: noRead(what, envl, `it is not built on the server yet (this answer never builds it), the option screener is switched off on this server, or the read failed. Open ${PANELS.ivrank} in UCT, then ask again`, IVRANK_NONE) }
  }
  const d = envl.data
  const v = ivRankRead({ ...d, status: 'ok' })
  if (v.state !== 'ok') return unclean(what, IVRANK_NONE)
  const lines = []
  for (const s of ['high', 'low']) {
    if (side !== s && side !== 'both') continue
    const rows = s === 'high' ? v.high : v.low
    lines.push(`The ${s === 'high' ? 'highest' : 'lowest'} IV rank across UCT's own options log (options ${s === 'high' ? 'rich' : 'cheap'} against each symbol's own logged year), the ${dayText(v.session) || 'newest'} session:`)
    for (const r of rows.slice(0, TEXT_ROWS)) lines.push(ivRow(r))
    if (rows.length > TEXT_ROWS) lines.push(more(rows.length - TEXT_ROWS))
    const cut = ivCut(v, s)
    if (cut) lines.push(cut.replace('the rest are left off this list.', 'the list is cut from the middle of the ranking.'))
  }
  lines.push(ivCounts(v))
  const log = ivLog(v)
  if (log) lines.push(log)
  const stale = Array.isArray(d.stale_for) ? d.stale_for : []
  if (stale.includes('behind')) lines.push('Stale: the list read an earlier session than the last evening build should have read, and this answer never builds it again.')
  lines.push(ivBuilt(v))
  lines.push(IVRANK_RECORD)
  const facts = { side, as_of: v.session, built_at: v.builtAt, stale: stale.length > 0, counts: v.counts,
    high: v.high.map(r => ({ symbol: r.sym, iv_rank: r.ivRank, iv_percentile: r.ivPercentile })), low: v.low.map(r => ({ symbol: r.sym, iv_rank: r.ivRank, iv_percentile: r.ivPercentile })) }
  const rows = [...v.high.map(r => ({ ...r, end: 'Highest' })), ...v.low.map(r => ({ ...r, end: 'Lowest' }))]
    .map(r => ({ symbol: r.sym, end: r.end, rank: ivRank(r.ivRank), iv: ivText(r.atmIv) }))
  if (!rows.length) return { text: lines.join('\n'), facts }
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'symbol', label: 'Symbol' }, { key: 'end', label: 'List' }, { key: 'rank', label: 'IV rank' }, { key: 'iv', label: 'ATM IV' }], rows },
    present: { kind: 'metrics', title: 'IV rank leaders', short: 'IV rank', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.symbol, value: r.rank, note: `${r.end.toLowerCase()}, ATM IV ${r.iv}`, aka: [r.symbol.toLowerCase()] })) },
    facts,
  }
}

export async function answerIvRank(args = {}) {
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the IV rank list: ${NO_TURN}.` }
  const params = { side: sideOf(args.side), rows: clamp(args.rows, IVRANK_MAX_ROWS, IVRANK_DEFAULT_ROWS) }
  const envl = await readData('options.ivRankLeaders', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromIvRank(envl, params)
}

// ── stock.ipoUnlock ← ipo.lockups ───────────────────────────────────────────────────────────────────────────────────
export const LOCKUPS_DEFAULT_ROWS = 10
export const LOCKUPS_MAX_ROWS = 60
export const LOCKUPS_RECORD = 'Every date here is an ESTIMATE (180 calendar days after listing, rolled to the next trading session): the prospectus sets the actual date. Not advice.'
export const CHANGE_REASON_WORDS = Object.freeze({
  no_first_day: 'the site\'s closes start after its first days, so no change since listing is stated',
  no_later_close: 'only its first close is held, so no change since listing is stated',
  bars_unreadable: 'its closes could not be read when the list was worked out, so no change since listing is stated',
  no_closes: 'the site holds no daily closes for it, so no change since listing is stated',
})
const LOCKUPS_NONE = 'No lockup is stated. That is not the same as no lockups.'

/** Pure: an `ipo.lockups` envelope → the answer. */
export function answerFromLockups(envl) {
  const what = 'the IPO lockups'
  if (!usable(envl)) {
    return { text: noRead(what, envl, `they are not held on the server yet (this answer never works them out), or the read failed. Open ${PANELS.lockups} in UCT, then ask again`, LOCKUPS_NONE) }
  }
  const d = envl.data
  const v = lockupRead({ ...d, status: 'ok' })
  if (v.state !== 'ok') return unclean(what, LOCKUPS_NONE)
  const total = int(obj(d.counts)?.in_window) ?? v.rows.length
  const span = v.from && v.to ? ` from ${lockupDate(v.from)} to ${lockupDate(v.to)}` : ''
  const lines = [total ? `${plural(total, 'estimated IPO lockup expiry falls', 'estimated IPO lockup expiries fall')}${span} (the past ${v.behindDays} days and the next ${v.aheadDays}), as UCT holds them from the stocks listed in the last year:`
    : `No estimated IPO lockup expiry falls${span} (the past ${v.behindDays} days and the next ${v.aheadDays}) among the stocks listed in the last year that UCT holds.`]
  if (v.today) lines.push(`The days to go are counted from ${dayText(v.today)}.`)
  for (const r of v.rows.slice(0, TEXT_ROWS)) {
    const ch = lockupChange(r.change)
    lines.push(`• ${lockupDate(r.expiry)} (${lockupDays(r.days)}), estimated: ${r.sym}${r.company ? ` (${r.company})` : ''}, listed ${lockupDate(r.listing)}; ${ch ? `${ch} since its first close` : CHANGE_REASON_WORDS[r.change.reason] || CHANGE_REASON_WORDS.no_closes}`)
  }
  if (v.rows.length > TEXT_ROWS) lines.push(more(v.rows.length - TEXT_ROWS))
  if (total > v.rows.length && v.rows.length) lines.push(`${count(total)} estimated expiries fall in the window and the ${count(v.rows.length)} soonest are in this answer: the list is cut from the far end.`)
  if (v.counts.withoutDate) lines.push(`${plural(v.counts.withoutDate, 'listed stock has', 'listed stocks have')} no listing date, so no expiry can be estimated for ${v.counts.withoutDate === 1 ? 'it' : 'them'}.`)
  const stale = Array.isArray(d.stale_for) && d.stale_for.includes('earlier_day')
  if (stale) lines.push('Stale: UCT worked this list out on an earlier day, so each row\'s days to go is behind by the days since, and this answer never works it out again.')
  lines.push(LOCKUPS_RECORD, workedAt(stampET(d.built_at, envl.fetched_at), 'it'))
  const facts = { as_of: d.listings_as_of || null, today: v.today, stale, total, shown: v.rows.length,
    rows: v.rows.map(r => ({ symbol: r.sym, estimated_expiry: r.expiry, days_to_go: r.days, basis: 'estimated', change_pct: r.change.pct })) }
  if (!v.rows.length) return { text: lines.join('\n'), facts }
  const rows = v.rows.map(r => ({ expiry: `${lockupDate(r.expiry)} (est.)`, symbol: r.sym, listed: lockupDate(r.listing), change: lockupChange(r.change) || 'n/a' }))
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'expiry', label: 'Estimated expiry' }, { key: 'symbol', label: 'Symbol' }, { key: 'listed', label: 'Listed' }, { key: 'change', label: 'Since listing' }], rows },
    present: { kind: 'metrics', title: 'IPO lockups (estimated)', short: 'IPO lockups', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.symbol, value: r.expiry, note: `listed ${r.listed}`, aka: [r.symbol.toLowerCase()] })) },
    facts,
  }
}

export async function answerLockups(args = {}) {
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the IPO lockups: ${NO_TURN}.` }
  const params = { rows: clamp(args.rows, LOCKUPS_MAX_ROWS, LOCKUPS_DEFAULT_ROWS) }
  const envl = await readData('ipo.lockups', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromLockups(envl)
}

// ── stock.positionTypes ← cot.byTrader ──────────────────────────────────────────────────────────────────────────────
export const COT_DEFAULT_ROWS = 5
export const COT_MAX_ROWS = 20
export const COT_RECORD = `Positions as of each Tuesday, published by the CFTC the following Friday: public data, ${NOT_ADVICE}.`
export const COT_LEFT_OUT = 'Each class\'s place in its 3-year range is not in this answer: the COT panel in UCT shows it.'
const COT_NONE = 'No position is stated. That is not the same as no positions.'
const marketOf = (v) => (str(v) && str(v).length <= 40 ? str(v) : null)

/** Pure: a `cot.byTrader` envelope → the answer. */
export function answerFromCot(envl, args = {}) {
  const market = marketOf(args.market)
  const rowsWanted = clamp(args.rows, COT_MAX_ROWS, COT_DEFAULT_ROWS)
  const what = market ? `${market}'s positioning by trader type` : 'the positioning by trader type'
  if (!usable(envl)) {
    return { text: noRead(what, envl, 'it is not stored on the server yet (this answer never downloads), UCT\'s COT data does not cover that market, or the read failed. Open COT in UCT, then ask again', COT_NONE) }
  }
  const d = envl.data
  const credit = str(d.credit) || ''
  const stale = Array.isArray(d.stale_for) && d.stale_for.includes('behind_schedule')
  if (str(d.market)) {
    const v = cotFinerRead({ ...d, state: 'ok' })
    if (v.state !== 'ok') return unclean(what, COT_NONE)
    const code = str(d.market)
    const lines = [`${str(d.name) || code} (${code}) positioning by trader type, from the CFTC's ${v.reportName} report as UCT stores it (futures only), the week of ${reportDay(v.date)}:`]
    for (const c of v.classes) {
      lines.push(`• ${c.label}${c.watched ? ' (the class traders watch most in this report)' : ''}: net ${signedContracts(c.net)} (${contractsText(c.long)} long, ${contractsText(c.short)} short), ${c.wow !== null ? `${signedContracts(c.wow)} on the week` : 'no week\'s change stated'}, ${c.pctOi !== null ? `${cotShare(c.pctOi)} of open interest` : 'no share of open interest stated'}`)
    }
    if (v.oi?.value !== null && v.oi?.value !== undefined) lines.push(`Open interest: ${contractsText(v.oi.value)} contracts${v.oi.wow !== null ? `, ${signedContracts(v.oi.wow)} on the week` : ''}.`)
    const conc = concentrationText(v.concentration)
    if (conc) lines.push(conc)
    const rec = recordsText(v.records)
    if (rec) lines.push(rec)
    if (stale) lines.push('Stale: the newest stored report is older than the one the CFTC should have published by the time of this answer.')
    lines.push(COT_LEFT_OUT, credit, COT_RECORD)
    const facts = { market: code, report: v.report, watch: v.watch, as_of: v.date, stale,
      classes: v.classes.map(c => ({ key: c.key, net: c.net, wow: c.wow, pct_oi: c.pctOi })) }
    const rows = v.classes.map(c => ({ cls: c.label, net: signedContracts(c.net), week: c.wow !== null ? signedContracts(c.wow) : 'n/a', oi: c.pctOi !== null ? cotShare(c.pctOi) : 'n/a' }))
    return {
      text: lines.filter(Boolean).join('\n'),
      table: { columns: [{ key: 'cls', label: 'Trader class' }, { key: 'net', label: 'Net' }, { key: 'week', label: 'Week' }, { key: 'oi', label: 'Of open interest' }], rows },
      present: { kind: 'metrics', title: `${code} by trader type`, short: 'COT by trader type', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.cls, value: r.net, note: `${r.week} on the week`, aka: [r.cls.toLowerCase()] })) },
      facts,
    }
  }
  const b = cotFinerBoard({ ...d, state: 'ok' })
  if (b.state !== 'ok') return unclean(what, COT_NONE)
  const markets = obj(d.markets) || {}
  const cells = Object.entries(b.cells).map(([code, c]) => {
    const oi = num(markets[code]?.open_interest)
    return { code, name: str(markets[code]?.name) || code, ...c, pct: c.net !== null && oi ? (c.net / oi) * 100 : null }
  })
  const ranked = cells.filter(c => c.pct !== null)
  const longs = [...ranked].sort((a, x) => x.pct - a.pct || a.code.localeCompare(x.code)).filter(c => c.pct > 0).slice(0, rowsWanted)
  const shorts = [...ranked].sort((a, x) => a.pct - x.pct || a.code.localeCompare(x.code)).filter(c => c.pct < 0).slice(0, rowsWanted)
  const cellText = (c) => `${c.name} (${c.code}): ${c.label} net ${signedContracts(c.net)}, ${cotShare(c.pct)} of open interest, ${c.wow !== null ? `${signedContracts(c.wow)} on the week` : 'no week\'s change stated'}`
  const lines = [`The watched class in each futures market UCT stores (leveraged funds in financial futures, managed money in commodities), from the CFTC's finer reports, the week of ${reportDay(d.newest) || 'a week it does not give'}:`]
  lines.push(longs.length ? 'Most net long, as a share of open interest:' : 'No market\'s watched class is net long.')
  for (const c of longs) lines.push(`• ${cellText(c)}`)
  lines.push(shorts.length ? 'Most net short, as a share of open interest:' : 'No market\'s watched class is net short.')
  for (const c of shorts) lines.push(`• ${cellText(c)}`)
  if (ranked.length > longs.length + shorts.length) lines.push(`${count(ranked.length)} markets are stored and the ${count(longs.length + shorts.length)} at the two ends are in this answer: the middle of the list is cut.`)
  const missing = Array.isArray(d.no_record) ? d.no_record.length : 0
  if (missing) lines.push(`${plural(missing, 'listed market has', 'listed markets have')} no record in the finer reports UCT holds.`)
  if (stale) lines.push('Stale: the newest stored report is older than the one the CFTC should have published by the time of this answer.')
  lines.push(COT_LEFT_OUT, credit, COT_RECORD)
  const facts = { market: null, as_of: d.newest || null, stale, markets: cells.map(c => ({ code: c.code, watch: c.watch, net: c.net, wow: c.wow, pct_oi: c.pct })) }
  const rows = [...longs, ...shorts].map(c => ({ market: `${c.name} (${c.code})`, cls: c.label, net: signedContracts(c.net), oi: cotShare(c.pct) }))
  if (!rows.length) return { text: lines.filter(Boolean).join('\n'), facts }
  return {
    text: lines.filter(Boolean).join('\n'),
    table: { columns: [{ key: 'market', label: 'Market' }, { key: 'cls', label: 'Watched class' }, { key: 'net', label: 'Net' }, { key: 'oi', label: 'Of open interest' }], rows },
    present: { kind: 'metrics', title: 'Futures positioning by trader type', short: 'COT by trader type', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.market, value: r.net, note: r.oi, aka: [r.market.toLowerCase()] })) },
    facts,
  }
}

export async function answerCot(args = {}) {
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the positioning by trader type: ${NO_TURN}.` }
  const params = { market: marketOf(args.market) }
  const envl = await readData('cot.byTrader', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromCot(envl, { ...params, rows: args.rows })
}

// ── routing words (armed only while registered; routing.js's `marketTables` group lists none) ────────────────────────
// Routing v2 reaches the seven by their summaries. v1 (the kill-switch fallback, and the router the capability-regression
// corpus runs) selects a group by its words, and `marketTables` is words-only: these words are the only way v1 sends it.
// Routing only ADDS a group (the other groups a message names still ride along), and each pattern is kept off another
// capability's own language:
//   rank       the sectors' or industries' weekly rank or ranking, a group's rank, the top or bottom ranked groups, the
//              groups that climbed or fell in the ranking. Never a stock's RS rank or rating, never the sectors' performance
//              over a period (the data group), never the themes rotating (wave 5);
//   crowding   short interest, insider buying, positioning or crowding BY sector or industry, the most crowded or shorted
//              groups. Never one stock's short interest or the most shorted stocks (wave 5), never insider buying in a stock;
//   season     the earnings season by sector, the sectors' beat rates, which sector is beating. Never who reports tonight or
//              the earnings season of the day (wave 2's ERNS), never one stock's earnings or beat;
//   revisions  estimate revisions by sector, revision breadth, estimate breadth. Never one stock's estimate revisions (EEH),
//              never the analysts' upgrades and downgrades (wave 2);
//   ivrank     the highest or lowest IV rank across the log, the IV rank leaders, the richest or cheapest options. Never one
//              symbol's IV or IV rank (wave 7's IV history), never a screen for options;
//   lockups    IPO lockups and lockup expiries, IPO unlocks. Never the IPO calendar (wave 8) or recent listings (LEAD);
//   cot        COT or futures positioning by trader type, leveraged funds, managed money, swap dealers, asset managers in
//              futures, the finer reports by name. Never the legacy COT's commercials and large speculators (the cot group),
//              never hedge funds holding a stock (13F);
//   not ours   a screen or its condition, an alert, a watchlist, the member's own lists, a page or a panel, or what a term
//              MEANS (the guide).
// ⛔ no lookbehind (iOS 16 floor, src/noRegexLookbehind.test.js).
const NOT_A_SCREEN = '^(?!.*\\b(?:scans?|screens?|screener|filters?|find|alerts?|notify|widgets?|page|tab|panel|watchlists?|my|portfolio|positions?)\\b)(?!.*(?:\\b(?:over|above|under|below|at least|more than|less than|greater than)\\b|[<>])\\s*\\$?\\d)'
const NOT_A_MEANING = '(?!.*\\b(?:explain|define|definition|meaning|means?|difference between|how (?:is|are|do|does) .* (?:calculated|worked out|computed|work|works))\\b)'
  + '(?!what(?:\'s|’s| is| are) (?:an? |the )?(?:iv rank|lockups?|lock-ups?|ipo lockups?|lockup expirations?|revision breadth|estimate revisions?|beat rates?|leveraged funds|managed money|swap dealers|crowding|short interest|sector rotation)\\W*$)'
const OURS = `${NOT_A_SCREEN}${NOT_A_MEANING}`
const GROUPWORD = '(?:sectors?|industr(?:y|ies)|groups?|industry groups?)'
const NOT_RS = '(?!.*\\b(?:rs|relative strength|ratings?|rated|composite)\\b)'
const NOT_ONE_STOCK = '(?!.*\\b(?:for|of|on|in|at) \\$?[a-z]{1,5}(?:\'s)?\\s*$)'
export const WAVE11_ROUTE_WORDS = Object.freeze({
  rank: [
    new RegExp(`${OURS}${NOT_RS}.*\\b(?:industry|group)(?: group)? rank(?:s|ing|ings)?\\b|^${NOT_A_SCREEN.slice(1)}${NOT_A_MEANING}${NOT_RS}.*\\bsector rank(?:s)?\\b`),
    new RegExp(`${OURS}${NOT_RS}.*\\b(?:sectors|industries|groups) by (?:weekly |6-month |3-month )?rank(?:ing)?s?\\b|^${NOT_A_SCREEN.slice(1)}${NOT_A_MEANING}${NOT_RS}.*\\b(?:sectors|industries|groups)(?:'|’)? weekly rank(?:ing)?s?\\b`),
    new RegExp(`${OURS}${NOT_RS}.*\\bweekly rank(?:ing)?s? (?:of|for) (?:the |every |each |all )?${GROUPWORD}\\b`),
    new RegExp(`${OURS}${NOT_RS}.*\\b(?:top|best|worst|lowest|highest|bottom)[- ]ranked ${GROUPWORD}\\b`),
    new RegExp(`${OURS}${NOT_RS}.*\\b${GROUPWORD} (?:that |which )?(?:climbed|fell|rose|dropped|moved up|moved down|jumped)(?: the most)? (?:in|up|down) (?:the )?(?:weekly )?rank(?:ing)?s?\\b`),
    new RegExp(`${OURS}${NOT_RS}.*\\bleading industries\\b`),
  ],
  crowding: [
    new RegExp(`${OURS}.*\\b(?:sector|industry|group)(?: group)? (?:crowding|positioning|short interest|short float|insider buying|insider purchases)\\b`),
    new RegExp(`${OURS}.*\\b(?:crowding|positioning|short interest|short float|insider buying|insider purchases|fund adds) (?:by|across|for each|per) ${GROUPWORD}\\b`),
    new RegExp(`${OURS}.*\\b(?:most|least) (?:crowded|shorted) ${GROUPWORD}\\b`),
    new RegExp(`${OURS}.*\\bcrowded (?:sectors|industries|groups)\\b`),
  ],
  season: [
    new RegExp(`${OURS}.*\\bearnings (?:season |results |beats )?(?:by|across|per) sectors?\\b`),
    new RegExp(`${OURS}.*\\bsectors?(?:'s|’s|'|’)? earnings\\b`),
    new RegExp(`${OURS}.*\\b(?:sector|sectors'?|season'?s?) beat rates?\\b|^${NOT_A_SCREEN.slice(1)}.*\\bbeat rates? (?:by|across|per|for each) sectors?\\b`),
    new RegExp(`${OURS}.*\\bwhich sectors? (?:is|are) (?:beating|missing)\\b`),
    new RegExp(`${OURS}.*\\b(?:season|beats? and misses|earnings surprises?) by sector\\b`),
  ],
  revisions: [
    new RegExp(`${OURS}.*\\b(?:estimate|earnings|eps|revenue|analyst) revisions? (?:breadth|by sector|across sectors|per sector)\\b`),
    new RegExp(`${OURS}.*\\brevisions? (?:breadth|by sector|across sectors)\\b`),
    new RegExp(`${OURS}.*\\bsector (?:estimate |earnings )?revisions?\\b`),
    new RegExp(`${OURS}.*\\bestimates? breadth\\b`),
  ],
  ivrank: [
    new RegExp(`${OURS}${NOT_ONE_STOCK}.*\\b(?:highest|lowest|top|bottom) (?:iv|implied vol(?:atility)?) ranks?\\b`),
    new RegExp(`${OURS}.*\\biv ranks? (?:leaders|list|leaderboard|extremes)\\b`),
    new RegExp(`${OURS}.*\\b(?:richest|cheapest|most expensive) options\\b`),
    new RegExp(`${OURS}.*\\boptions? (?:are |look(?:ing)? )?(?:the )?(?:richest|cheapest|most expensive)\\b`),
  ],
  lockups: [
    new RegExp(`${OURS}.*\\block-?ups?\\b`),
    new RegExp(`${OURS}.*\\block[- ]up (?:expir\\w*|periods?|ending|ends?)\\b`),
    new RegExp(`${OURS}.*\\b(?:ipo|insider|share) unlocks?\\b`),
    new RegExp(`${OURS}.*\\bunlock (?:dates?|expir\\w*)\\b`),
  ],
  cot: [
    new RegExp(`${OURS}.*\\bby trader (?:type|class|category)\\b`),
    new RegExp(`${OURS}.*\\b(?:leveraged funds?|managed money|swap dealers?|producers? (?:and|&) merchants?)\\b`),
    new RegExp(`${OURS}.*\\b(?:asset managers?|dealers?) (?:positioning|net long|net short|in (?:the )?(?:\\w+ )?futures)\\b`),
    new RegExp(`${OURS}.*\\b(?:traders in financial futures|disaggregated (?:cot|report)|tff report|finer cot)\\b`),
  ],
})
export const ROUTE_GROUP = 'marketTables'
const ownGroup = () => GROUPS.find(g => g.id === ROUTE_GROUP)
/** Adds (or takes back) ONE capability's words on the wave's own group. */
function armRoutes(key, on) {
  const g = ownGroup()
  if (!g) return
  for (const re of WAVE11_ROUTE_WORDS[key]) {
    const at = g.words.indexOf(re)
    if (on && at < 0) g.words.push(re)
    if (!on && at >= 0) g.words.splice(at, 1)
  }
}

// ── registration: each capability only while the server serves ITS kind ───────────────────────────────────────────────
// ⚠️ THE WORDS OF A NAME, A SUMMARY AND ITS HINTS JOIN THE TYPO LEXICON (nl/lexicon.js: every lowercase word of three letters
// or more; a word in CAPITALS does not). A new known word changes what a nearby word in ANY member message may be
// "corrected" to, so the text below is worded to add NO word at all (pinned in agentTerminalDataWave11.test.js, "the typo
// lexicon"). The names were chosen for that, every word already known: `stock.groupRank` (group, rank),
// `stock.groupOwnership` (ownership: `stock.groupCrowding` would add "crowding"), `stock.sectorEarnings`,
// `stock.estimatesBreadth` ("revision" is not known), `stock.ivRankLeaders`, `stock.ipoUnlock` ("lockup" is not known,
// "unlock" is), `stock.positionTypes` ("cot", "trader" and "positioning" are not known on a dark server). No argument
// carries an enum, whose values would join it too.
const TARGET_HINT = 'target = the ref of the stockData entry.'
const NO_FIGURES = 'reply: one short line, no figures.'
const HELD_ONLY = 'Answered only from what the SERVER already HOLDS, so it may say none is held.'
const unregister = {}

/** Idempotent; registers each of the seven ONLY while the server serves its kind. Returns the names registered by this call. */
export function registerTerminalWave11Capabilities() {
  const added = []
  if (!unregister.rank && kindServed(KINDS.rank)) {
    unregister.rank = registerCapability({
      name: 'stock.groupRank',            // a LITERAL: the server's local-only mirror rail reads it (tests/test_uct_agent_breadth.py)
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ places worked out from the vendor's daily history, which no register row clears for a model
      summary: 'EVERY SECTOR\'s or INDUSTRY\'s WEEKLY RANK as UCT HOLDS it: its PLACE by the MEDIAN 6-MONTH PRICE CHANGE of its STOCKS, 4, 13 and 52 WEEKS BACK with the PLACES MOVED, its BEST and WORST WEEK, OUT of HOW MANY GROUPS, and the GROUPS that CLIMBED and FELL the MOST; or ONE GROUP\'s RANK. '
        + 'For "SECTOR RANKINGS", "INDUSTRY GROUP RANK", "TOP RANKED INDUSTRIES".',
      hints: `${TARGET_HINT} KIND = SECTOR or INDUSTRY (null = SECTOR); NAME = ONE GROUP or null; ROWS 1-${RANK_MAX_ROWS} (null = ${RANK_DEFAULT_ROWS}). The date is the NEWEST SESSION's CLOSE: never today. A RECORD, not a FORECAST and not ADVICE. ${HELD_ONLY} `
        + `A STOCK's RS RANK is not this answer. ${NO_FIGURES}`,
      args: { type: 'object', properties: { kind: { type: ['string', 'null'] }, name: { type: ['string', 'null'] }, rows: { type: ['integer', 'null'] } }, required: ['kind', 'name', 'rows'], additionalProperties: false },
      answer: (_snap, args) => answerRank(args || {}),
    })
    armRoutes('rank', true)
    added.push(CAPABILITIES.rank)
  }
  if (!unregister.crowding && kindServed(KINDS.crowding)) {
    unregister.crowding = registerCapability({
      name: 'stock.groupOwnership',       // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ FINRA's short interest through the vendor and the SEC's Form 4 and N-PORT rows, which name no AI lane
      summary: 'POSITIONING BY SECTOR or INDUSTRY as UCT HOLDS it: per GROUP the SHORT INTEREST MEDIANS (PERCENT of FLOAT, DAYS to COVER) and the MOST SHORTED, INSIDER BUYING (OPEN-MARKET PURCHASES ONLY) and the SHARE of STOCKS FUNDS ADDED; or ONE GROUP\'s STOCKS. '
        + 'For "SECTOR CROWDING", "SHORT INTEREST BY SECTOR", "MOST CROWDED INDUSTRIES".',
      hints: `${TARGET_HINT} KIND = SECTOR or INDUSTRY (null = SECTOR); NAME = ONE GROUP or null; ROWS 1-${CROWDING_MAX_ROWS} (null = ${CROWDING_DEFAULT_ROWS}). EACH PART HAS its own DATE: never today. FILINGS, not ADVICE. ${HELD_ONLY} `
        + `ONE STOCK's SHORT INTEREST and 13F are not this answer. ${NO_FIGURES}`,
      args: { type: 'object', properties: { kind: { type: ['string', 'null'] }, name: { type: ['string', 'null'] }, rows: { type: ['integer', 'null'] } }, required: ['kind', 'name', 'rows'], additionalProperties: false },
      answer: (_snap, args) => answerCrowding(args || {}),
    })
    armRoutes('crowding', true)
    added.push(CAPABILITIES.crowding)
  }
  if (!unregister.season && kindServed(KINDS.season)) {
    unregister.season = registerCapability({
      name: 'stock.sectorEarnings',       // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ the earnings vendors' actuals and consensus, whose AI rows have no AI clause or are restricted
      summary: 'ONE EARNINGS SEASON BY SECTOR as UCT HOLDS it: COVERAGE FIRST, then PER SECTOR the EPS and REVENUE BEAT, IN LINE and MISS SHARES with COUNTS, the MEDIAN SURPRISE and the MEDIAN REACTION, and the SAME SEASON a YEAR EARLIER. '
        + 'For "EARNINGS BY SECTOR", "WHICH SECTOR is BEATING", "SECTOR BEAT RATES".',
      hints: `${TARGET_HINT} SEASON = CURRENT, PREVIOUS or YEAR_AGO (null = CURRENT); METRIC = EPS or REVENUE (null = EPS). The date is the NEWEST HELD COPY's: never today. RESULTS, not a FORECAST and not ADVICE. ${HELD_ONLY} `
        + `WHO REPORTS TONIGHT and ONE STOCK's EARNINGS are not this answer. ${NO_FIGURES}`,
      args: { type: 'object', properties: { season: { type: ['string', 'null'] }, metric: { type: ['string', 'null'] } }, required: ['season', 'metric'], additionalProperties: false },
      answer: (_snap, args) => answerSeason(args || {}),
    })
    armRoutes('season', true)
    added.push(CAPABILITIES.season)
  }
  if (!unregister.revisions && kindServed(KINDS.revisions)) {
    unregister.revisions = registerCapability({
      name: 'stock.estimatesBreadth',     // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ the estimates vendor's consensus, whose AI row has no AI clause
      summary: 'ESTIMATE REVISIONS BY SECTOR as UCT HOLDS them, AMONG the STOCKS it TRACKS (the S&P 500 LIST and STOCKS MEMBERS LOOKED AT), NEVER the WHOLE MARKET: PER SECTOR HOW MANY NEXT-QUARTER EPS or REVENUE ESTIMATES were RAISED, CUT or HELD over 7 or 30 DAYS, the NET BREADTH and the LARGEST RAISES and CUTS. '
        + 'For "ESTIMATE REVISIONS BY SECTOR", "REVISION BREADTH".',
      hints: `${TARGET_HINT} METRIC = EPS or REVENUE (null = EPS); WINDOW = 7 or 30 (null = 30). The date is the NEWEST SNAPSHOT's: never today. ESTIMATES, not ADVICE. ${HELD_ONLY} `
        + `ONE STOCK's ESTIMATE HISTORY and UPGRADES are not this answer. ${NO_FIGURES}`,
      args: { type: 'object', properties: { metric: { type: ['string', 'null'] }, window: { type: ['integer', 'null'] } }, required: ['metric', 'window'], additionalProperties: false },
      answer: (_snap, args) => answerRevisions(args || {}),
    })
    armRoutes('revisions', true)
    added.push(CAPABILITIES.revisions)
  }
  if (!unregister.ivrank && kindServed(KINDS.ivrank)) {
    unregister.ivrank = registerCapability({
      name: 'stock.ivRankLeaders',        // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ the vendor's options chain, logged by UCT, which no register row clears for a model
      summary: 'The HIGHEST and LOWEST IV RANK ACROSS UCT\'s OWN OPTIONS LOG as UCT HOLDS the LIST: EACH SYMBOL\'s IV RANK and PERCENTILE AGAINST its OWN LOGGED SESSIONS, its ATM IV and RANGE, the SESSIONS BEHIND it, HOW MANY were RANKED and LEFT OUT. '
        + 'For "HIGHEST IV RANK", "LOWEST IV RANK", "IV RANK LEADERS".',
      hints: `${TARGET_HINT} SIDE = HIGH, LOW or BOTH (null = BOTH); ROWS 1-${IVRANK_MAX_ROWS} a SIDE (null = ${IVRANK_DEFAULT_ROWS}). The date is the SESSION's CLOSE: never today. An END-OF-DAY SNAPSHOT, not ADVICE. ${HELD_ONLY} `
        + `ONE SYMBOL's IV HISTORY is not this answer. ${NO_FIGURES}`,
      args: { type: 'object', properties: { side: { type: ['string', 'null'] }, rows: { type: ['integer', 'null'] } }, required: ['side', 'rows'], additionalProperties: false },
      answer: (_snap, args) => answerIvRank(args || {}),
    })
    armRoutes('ivrank', true)
    added.push(CAPABILITIES.ivrank)
  }
  if (!unregister.lockups && kindServed(KINDS.lockups)) {
    unregister.lockups = registerCapability({
      name: 'stock.ipoUnlock',            // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ the vendor's listings and bars, which no register row clears for a model
      summary: 'IPO LOCKUPS as UCT HOLDS them: the COMPANIES LISTED in the LAST YEAR whose ESTIMATED LOCKUP EXPIRY (180 DAYS AFTER LISTING) FALLS in the NEXT 30 DAYS or the PAST 7, SOONEST FIRST, with the LISTING DATE, the DAYS to GO and the CHANGE SINCE LISTING; EVERY DATE an ESTIMATE. '
        + 'For "IPO LOCKUPS", "LOCKUP EXPIRATIONS", "IPO UNLOCKS".',
      hints: `${TARGET_HINT} No SYMBOL. ROWS 1-${LOCKUPS_MAX_ROWS} (null = ${LOCKUPS_DEFAULT_ROWS}). EVERY DATE is an ESTIMATE, never STATED: never today. Not ADVICE. ${HELD_ONLY} `
        + `The IPO CALENDAR is not this answer. ${NO_FIGURES}`,
      args: { type: 'object', properties: { rows: { type: ['integer', 'null'] } }, required: ['rows'], additionalProperties: false },
      answer: (_snap, args) => answerLockups(args || {}),
    })
    armRoutes('lockups', true)
    added.push(CAPABILITIES.lockups)
  }
  if (!unregister.cot && kindServed(KINDS.cot)) {
    unregister.cot = registerCapability({
      name: 'stock.positionTypes',        // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ the CFTC's finer reports, whose register row T-105 names no AI lane
      summary: 'FUTURES POSITIONING BY TRADER TYPE as UCT STORES the CFTC\'s FINER REPORTS (TRADERS in FINANCIAL FUTURES, DISAGGREGATED): for ONE MARKET EACH CLASS\'s NET, its WEEK\'s CHANGE and SHARE of OPEN INTEREST, the CLASS TRADERS WATCH MOST and the LARGEST TRADERS\' SHARE; or the BOARD of EVERY MARKET\'s WATCHED CLASS. '
        + 'For "COT BY TRADER TYPE", "LEVERAGED FUNDS in the S&P", "MANAGED MONEY in GOLD".',
      hints: `${TARGET_HINT} MARKET = a FUTURES MARKET's NAME or CODE, or null for the BOARD; ROWS 1-${COT_MAX_ROWS} a SIDE of the BOARD (null = ${COT_DEFAULT_ROWS}). The date is the REPORT's TUESDAY: never today. PUBLIC DATA, not ADVICE. ${HELD_ONLY} `
        + `COMMERCIALS and LARGE SPECULATORS are not this answer. ${NO_FIGURES}`,
      args: { type: 'object', properties: { market: { type: ['string', 'null'] }, rows: { type: ['integer', 'null'] } }, required: ['market', 'rows'], additionalProperties: false },
      answer: (_snap, args) => answerCot(args || {}),
    })
    armRoutes('cot', true)
    added.push(CAPABILITIES.cot)
  }
  return added
}
export const _resetTerminalWave11ForTest = () => {
  for (const k of Object.keys(unregister)) { unregister[k]?.(); delete unregister[k] }
  for (const k of Object.keys(WAVE11_ROUTE_WORDS)) armRoutes(k, false)
}
