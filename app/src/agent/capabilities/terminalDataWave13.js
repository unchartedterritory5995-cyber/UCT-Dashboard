// Terminal data wave 13 — six LOCAL-ONLY capabilities over six model-isolated data kinds (MD-1 §4.22):
//   stock.insiderBuying   insider.market    the market's latest open-market insider purchases and the insider clusters (INS, INS CLUSTER)
//   stock.marketHistory   market.history    the S&P 500's or the Nasdaq-100's corrections and bear markets, the rallies and their leaders (MKTH)
//   stock.economyBoard    econ.latest       the economy board: each series' latest reading, the one before, the change, its release (ECON)
//   stock.liquidityBoard  market.liquidity  net liquidity (UCT's calculation) and its parts: the Fed's assets, the TGA, reverse repo… (LIQ)
//   stock.oilReport       market.oil        the EIA's weekly oil report: the crude build or draw, stocks, production, pump prices (OIL)
//   stock.daysLikeToday   market.analogs    the past sessions whose breadth looked most like the newest one, and what followed (ANLG)
//
// Each answer is built in the browser from ONE read of its own kind and shown to the MEMBER ONLY: every capability is
// `localOnly` (its name is in turn.LOCAL_ONLY_ACTIONS on the server), every kind is model-isolated, and nothing the read
// returns reaches a model provider. All six were isolated as the builder's default, from the licensing register's rows
// (quoted in each adapter and in MD-1 §4.22); nobody decided otherwise and nobody was asked.
//
// The economy, liquidity and oil answers are worked out with the panels' OWN pure models (economyModel.js,
// liquidityModel.js, oilModel.js), over the held rows in the econ routes' own shape: the board, the net liquidity
// calculation and the build or draw are never retyped here. The analogues' counts are analoguesModel.js's.
//
// What every answer keeps to:
//   • the date is the DATA'S OWN (each part's filing day, the index's last close, each series' period and release, the
//     reference session), never the time of the ask;
//   • a number that does not exist is never 0: a purchase with no price has no amount, a rally the store has not reached
//     is "not reached yet", a forward return the calendar has not reached is "not yet", a period with no figure says so;
//   • a list that is cut says so, and from which end;
//   • nothing held and a read that failed are never said as "no buying", "no declines", "no figure" or "no similar days";
//   • a record, never a forecast; the next release is the calendar's date, never a figure;
//   • an envelope's notes are never echoed, and no vendor is named.
//
// Dark by construction: each is registered only while the server serves its own kind (UCT_AGENT_DATA_KINDS, fail closed; an
// isolated kind also needs its own UCT_AGENT_ISOLATED_KINDS entry or every read is refused). Nothing here arms anything.
// ROUTING: the six share ONE words-only group of their own, `marketMacro` (routing.js lists them by action). It is the 55th
// group of the 56 the server keeps (turn.MAX_GROUPS). Each capability's own words (WAVE13_ROUTE_WORDS) are added to that
// group only while it is registered, so on a dark server the group has no words and no registered action, and routing is
// byte-identical to the base.
import { registerCapability } from '../capabilities'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { GROUPS } from '../routing'
import { stampET } from './marketDataFacts'
import { kindServed, usable, noRead, plural, dayText, money, NO_TURN } from './terminalDataFormat'
import { formatNumber } from '../../lib/presentation/presentationPrimitives'
import { moneyWords } from '../../pages/terminal/panels/revenueSegmentsModel'
import { ECON_THEMES, economyRead, etToday } from '../../pages/terminal/panels/economyModel'
import { NET_LABEL, historyPoints as liqHistoryPoints, liquidityRead } from '../../pages/terminal/panels/liquidityModel'
import { historyPoints as oilHistoryPoints, nextSentence, oilRead } from '../../pages/terminal/panels/oilModel'
import { ANLG_RECORD_LINE, anlgRead, cellFor, dayWithYear, matchText, summaryFor } from '../../pages/terminal/panels/analoguesModel'

export const KINDS = Object.freeze({
  insider: 'insider.market', history: 'market.history', economy: 'econ.latest', liquidity: 'market.liquidity', oil: 'market.oil',
  analogs: 'market.analogs',
})
export const CAPABILITIES = Object.freeze({
  insider: 'stock.insiderBuying', history: 'stock.marketHistory', economy: 'stock.economyBoard', liquidity: 'stock.liquidityBoard',
  oil: 'stock.oilReport', analogs: 'stock.daysLikeToday',
})
export const PANELS = Object.freeze({ insider: 'INS and INS CLUSTER', history: 'MKTH', economy: 'ECON', liquidity: 'LIQ', oil: 'OIL', analogs: 'ANLG' })
export const NOT_ADVICE = 'not a forecast and not advice'
const TEXT_ROWS = 6
const PRESENT_ROWS = 12
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v) => (Number.isInteger(v) ? v : null)
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)
const list = (v) => (Array.isArray(v) ? v.filter(r => r && typeof r === 'object') : [])
const clamp = (v, max, fallback) => (Number.isInteger(v) ? Math.min(Math.max(v, 1), max) : fallback)
const count = (n) => formatNumber(n, { decimals: 0 })
const pctText = (v) => (num(v) === null ? null : `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(v).toFixed(1)}%`)
/** "Fri, Nov 13, 2026" → "Nov 13, 2026" */
const shortDay = (ymd) => (dayText(ymd) || '').replace(/^\w+, /, '') || null
const unclean = (what, none) => ({ text: `I couldn't read ${what}: UCT's data did not answer cleanly. ${none}` })
const more = (n) => `${n} more ${n === 1 ? 'is' : 'are'} in the table.`
const today = () => etToday(Date.now())
/** a release note the econ models give, without a present-tense word ("Due now; …" → "Due; …") */
const noteText = (n) => (str(n) ? n.replace(/^Due now;/, 'Due;') : null)

// ── stock.insiderBuying ← insider.market ─────────────────────────────────────────────────────────────────────────────
export const INSIDER_DEFAULT_ROWS = 10
export const INSIDER_MAX_ROWS = 50
export const INSIDER_RECORD = `Filings as the insiders reported them: a record, ${NOT_ADVICE}.`
export const INSIDER_LEFT_OUT = 'Each insider\'s name in a cluster is not in this answer: INS CLUSTER in UCT shows them.'
const INSIDER_NONE = 'No purchase and no cluster is stated. That is not the same as no insider buying.'

/** Pure: an `insider.market` envelope → the answer. */
export function answerFromInsider(envl) {
  const what = 'the market\'s insider buying'
  if (!usable(envl)) {
    return { text: noRead(what, envl, 'it is not held on the server yet (this answer never asks for it), or the read failed. Open INS in UCT, then ask again', INSIDER_NONE) }
  }
  const d = envl.data
  const bp = obj(d.purchases)
  const cp = obj(d.clusters)
  if (!bp || !cp) return unclean(what, INSIDER_NONE)
  const lines = []
  const rows = []
  if (bp.state !== 'held') lines.push('The latest purchases are not held on the server yet (this answer never asks for them): open INS in UCT, then ask again.')
  else {
    const buys = list(bp.rows)
    if (!buys.length) lines.push('The held list of purchases is empty: UCT holds an empty list both when no open-market purchase was found and when the source could not be read, and it does not say which. That is not the same as no insider buying.')
    else {
      lines.push(`The latest open-market purchases from Form 4 filings over the last ${count(int(bp.window_days) ?? 7)} days, largest dollar amount first:`)
      for (const b of buys.slice(0, TEXT_ROWS)) {
        const who = `${str(b.name) || 'an insider it does not name'}${str(b.title) ? ` (${b.title})` : ''}`
        const size = int(b.shares) !== null ? `${count(b.shares)} ${b.shares === 1 ? 'share' : 'shares'}` : 'shares it does not count'
        const priced = num(b.price) !== null ? ` at ${money(b.price)}, ${num(b.amount) !== null ? money(b.amount) : 'no amount stated'}` : ', no price stated (so no amount)'
        lines.push(`• ${b.symbol}: ${who} bought ${size}${priced}${shortDay(b.date) ? `, on ${shortDay(b.date)}` : ''}`)
      }
      if (buys.length > TEXT_ROWS) lines.push(more(buys.length - TEXT_ROWS))
      if ((int(bp.total) ?? 0) > buys.length) lines.push(`${count(bp.total)} purchases are held and the first ${count(buys.length)} are in this answer: the smallest are cut.`)
      if (int(bp.unpriced)) lines.push(`${plural(bp.unpriced, 'purchase states', 'purchases state')} no price, so ${bp.unpriced === 1 ? 'it has' : 'they have'} no dollar amount (never $0).`)
    }
    for (const b of buys) rows.push({ symbol: b.symbol, what: `${str(b.name) || 'n/a'} bought ${int(b.shares) !== null ? count(b.shares) : 'n/a'} shares`, value: num(b.amount) !== null ? money(b.amount) : 'no price', day: shortDay(b.date) || 'n/a', kind: 'Purchase' })
  }
  if (cp.state !== 'held') lines.push('The insider clusters are not held on the server yet (this answer never reads the filings): open INS CLUSTER in UCT, then ask again.')
  else {
    const cls = list(cp.rows)
    const rule = `${count(int(cp.min_insiders) ?? 3)} or more different insiders buying on the open market within ${count(int(cp.window_business_days) ?? 10)} business days, from the SEC's own Form 4 filings`
    if (!cls.length) lines.push(`No stock in what UCT holds has an insider cluster (${rule}). That is not the same as no insider buying.`)
    else {
      lines.push(`Insider clusters (${rule}), newest last buy first:`)
      for (const c of cls.slice(0, TEXT_ROWS)) {
        const value = num(c.value) !== null ? `${money(c.value)}${c.value_complete === false && int(c.unpriced_buys) ? ` (the priced buys only; ${plural(c.unpriced_buys, 'buy states', 'buys state')} no price)` : ''}` : 'no dollar value (no buy states a price)'
        lines.push(`• ${str(c.ticker) || 'no ticker given'}${str(c.company) ? ` (${c.company})` : ''}: ${plural(int(c.insiders) ?? 0, 'insider')}, ${shortDay(c.first_buy) || 'a day it does not give'} to ${shortDay(c.last_buy) || 'a day it does not give'}, ${value}`)
      }
      if (cls.length > TEXT_ROWS) lines.push(more(cls.length - TEXT_ROWS))
      if ((int(cp.total) ?? 0) > cls.length) lines.push(`${count(cp.total)} clusters are held and the newest ${count(cls.length)} are in this answer: the list is cut from the old end.`)
    }
    const cov = obj(cp.coverage) || {}
    if (cov.complete === false) lines.push(`The read of the filing days ${shortDay(cov.from) || 'it covers'} to ${shortDay(cov.to) || 'its newest'} is not complete, so a cluster may be missing.`)
    for (const c of cls) rows.push({ symbol: str(c.ticker) || 'n/a', what: `${plural(int(c.insiders) ?? 0, 'insider')} bought`, value: num(c.value) !== null ? money(c.value) : 'no price', day: shortDay(c.last_buy) || 'n/a', kind: 'Cluster' })
  }
  const dates = []
  if (bp.state === 'held') dates.push(str(bp.newest_filing) ? `the purchases' newest filing is from ${shortDay(bp.newest_filing)}` : 'the purchases carry no filing date')
  if (cp.state === 'held') dates.push(`the clusters cover the filing days read through ${shortDay(cp.as_of) || 'a day it does not give'}${cp.read_at ? `, built ${stampET(cp.read_at, envl.fetched_at)} (UCT's own time)` : ''}`)
  if (dates.length) lines.push(`Dates: ${dates.join('; ')}. This answer never asks again.`)
  lines.push(INSIDER_RECORD)
  if (cp.state === 'held') lines.push(INSIDER_LEFT_OUT)
  const facts = { purchases: bp.state === 'held' ? list(bp.rows).length : null, clusters: cp.state === 'held' ? list(cp.rows).length : null,
    newest_filing: bp.newest_filing || null, clusters_as_of: cp.as_of || null }
  if (!rows.length) return { text: lines.join('\n'), facts }
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'kind', label: 'Kind' }, { key: 'symbol', label: 'Symbol' }, { key: 'what', label: 'What' }, { key: 'value', label: 'Value' }, { key: 'day', label: 'Day' }], rows },
    present: { kind: 'metrics', title: 'Insider buying', short: 'Insider buying', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.symbol, value: r.value, note: `${r.kind}: ${r.what}, ${r.day}`, aka: [String(r.symbol).toLowerCase()] })) },
    facts,
  }
}

export async function answerInsider(args = {}) {
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the market's insider buying: ${NO_TURN}.` }
  const envl = await readData('insider.market', { rows: clamp(args.rows, INSIDER_MAX_ROWS, INSIDER_DEFAULT_ROWS) }, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromInsider(envl)
}

// ── stock.marketHistory ← market.history ─────────────────────────────────────────────────────────────────────────────
export const HISTORY_DEFAULT_ROWS = 8
export const HISTORY_MAX_ROWS = 40
export const HISTORY_RECORD = `A record of what the index did, ${NOT_ADVICE}.`
const HISTORY_NONE = 'No decline is stated. That is not the same as no declines.'
/** a member's word for the index → the kind's own (`SPX` or `NDX`), or null for the S&P 500 */
export const INDEX_WORDS = Object.freeze({ spx: 'SPX', 'sp500': 'SPX', 's&p 500': 'SPX', 's&p': 'SPX', spy: 'SPX', ndx: 'NDX', nasdaq: 'NDX', 'nasdaq-100': 'NDX', 'nasdaq 100': 'NDX', nasdaq100: 'NDX', qqq: 'NDX' })
const indexOf = (v) => (str(v) ? INDEX_WORDS[v.trim().toLowerCase()] || null : null)
const KIND_WORDS = { correction: 'Correction', bear: 'Bear market' }
const LEADER_WORDS = { not_yet: (l) => `its leaders are not drawn yet: ${count(int(l.sessions_so_far) ?? 0)} of the ${count(int(l.needed) ?? 63)} sessions after the low have closed`,
  thin: () => 'its leaders are not drawn: too few stocks were priced at both dates', computing: () => 'its leaders are still being worked out on the server',
  failed: () => 'its leaders could not be worked out on the server\'s last build' }

function episodeLine(e) {
  const p = obj(e.peak) || {}
  const t = obj(e.trough) || {}
  const head = `${KIND_WORDS[e.kind] || 'Decline'} from the peak of ${shortDay(p.date)} (${num(p.close) !== null ? formatNumber(p.close, { decimals: 2 }) : 'n/a'}) to the low of ${shortDay(t.date)} (${num(t.close) !== null ? formatNumber(t.close, { decimals: 2 }) : 'n/a'}): ${pctText(e.depth_pct) || 'depth not stated'} in ${plural(int(e.sessions_down) ?? 0, 'session')}`
  const rec = e.ongoing ? `; not recovered yet, the newest close ${pctText(e.below_peak_now_pct) || 'not stated'} below the peak` : `; the peak was regained on ${shortDay(e.recovered)}, ${plural(int(e.sessions_to_recover) ?? 0, 'session')} after the low`
  const rally = list(e.rally).map(r => `${plural(int(r.months) ?? 0, 'month')} ${pctText(r.return_pct) || 'not reached yet'}`)
  return `${head}${rec}.${rally.length ? ` After the low: ${rally.join(', ')}.` : ''}`
}

function leadersLine(l) {
  if (!l || l.state !== 'ok') return `  ${(LEADER_WORDS[l?.state] || LEADER_WORDS.computing)(l || {})}.`
  const top = list(l.top).map(x => `${x.sym} ${pctText(x.return_pct) || 'n/a'}${x.check ? ' (a price jump to check)' : ''}`)
  const secs = list(l.sectors).map(s => `${s.sector} ${pctText(s.median_pct) || 'n/a'} (${plural(int(s.count) ?? 0, 'stock')})`)
  return `  Leaders in the 63 sessions after the low${num(l.index_return_pct) !== null ? ` (the index ${pctText(l.index_return_pct)})` : ''}: ${top.join(', ') || 'none listed'}${int(l.top_total) > top.length ? ` (the first ${count(top.length)} of ${count(l.top_total)})` : ''}${secs.length ? `; sector medians: ${secs.join(', ')}` : ''}.`
}

/** Pure: a `market.history` envelope → the answer. */
export function answerFromHistory(envl) {
  const what = 'the market history'
  if (!usable(envl)) {
    return { text: noRead(what, envl, 'it is not held on the server yet (this answer never builds it), that index is not held, or the read failed. Open MKTH in UCT, then ask again', HISTORY_NONE) }
  }
  const d = envl.data
  if (!Array.isArray(d.episodes)) return unclean(what, HISTORY_NONE)
  const name = str(d.name) || d.index || 'The index'
  const eps = list(d.episodes)
  const s = obj(d.summary) || {}
  const lines = [`${name}'s corrections (a fall of 10% to 20% on closing prices) and bear markets (20% or more) as UCT holds them, from its closes since ${shortDay(s.since || d.first) || 'a day it does not give'}: ${plural(int(s.corrections) ?? 0, 'correction')} and ${plural(int(s.bear_markets) ?? 0, 'bear market')}${int(s.ongoing) ? `, ${count(s.ongoing)} not recovered yet` : ''}${num(s.median_depth_pct) !== null ? `; median depth ${pctText(s.median_depth_pct)}` : ''}${num(s.median_recovery_sessions) !== null ? `, median recovery ${plural(s.median_recovery_sessions, 'session')}` : ''}.`]
  if (!eps.length) lines.push(`No decline of 10% or more is in ${name}'s closes UCT holds. No record matched; that is not the same as a market that never fell.`)
  else lines.push('Newest first:')
  for (const e of eps.slice(0, TEXT_ROWS)) { lines.push(`• ${episodeLine(e)}`); lines.push(leadersLine(obj(e.leaders))) }
  if (eps.length > TEXT_ROWS) lines.push(more(eps.length - TEXT_ROWS))
  if ((int(d.episodes_total) ?? 0) > eps.length) lines.push(`${count(d.episodes_total)} declines are held and the newest ${count(eps.length)} are in this answer: the list is cut from the old end.`)
  if (str(d.survivorship)) lines.push(d.survivorship)
  lines.push(str(d.last) ? `${name}'s closes end with the session of ${dayText(d.last)}${d.built_at ? `; UCT built this ${stampET(d.built_at, envl.fetched_at)} (UCT's own time)` : ''}.` : 'The answer carries no date for its closes, so I cannot say how old it is.')
  if (envl.stale) lines.push('Stale: the held answer was built before the newest session\'s evening, and this answer never builds it again.')
  if (d.leaders_state === 'computing') lines.push('The leaders are still being worked out on the server; this answer never waits for them.')
  lines.push(HISTORY_RECORD)
  const rows = eps.map(e => ({ kind: KIND_WORDS[e.kind] || 'Decline', peak: shortDay(obj(e.peak)?.date) || 'n/a', low: shortDay(obj(e.trough)?.date) || 'n/a', depth: pctText(e.depth_pct) || 'n/a',
    recovered: e.ongoing ? 'not yet' : shortDay(e.recovered) || 'n/a' }))
  const facts = { index: d.index || null, as_of: d.last || null, episodes: eps.length, corrections: int(s.corrections), bear_markets: int(s.bear_markets), stale: !!envl.stale }
  if (!rows.length) return { text: lines.join('\n'), facts }
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'kind', label: 'Decline' }, { key: 'peak', label: 'Peak' }, { key: 'low', label: 'Low' }, { key: 'depth', label: 'Depth' }, { key: 'recovered', label: 'Regained' }], rows },
    present: { kind: 'metrics', title: `${name} corrections and bear markets`, short: 'Market history', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: `${r.kind} ${r.peak}`, value: r.depth, note: `low ${r.low}, regained ${r.recovered}`, aka: [r.peak.toLowerCase()] })) },
    facts,
  }
}

export async function answerHistory(args = {}) {
  const raw = str(args.index)
  const index = raw ? indexOf(raw) : null
  if (raw && !index) return { text: 'Which index should I read: the S&P 500 or the Nasdaq-100? Market history covers only those two. No decline is stated.' }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the market history: ${NO_TURN}.` }
  const params = { index, rows: clamp(args.rows, HISTORY_MAX_ROWS, HISTORY_DEFAULT_ROWS) }
  const envl = await readData('market.history', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromHistory(envl)
}

// ── stock.economyBoard ← econ.latest ─────────────────────────────────────────────────────────────────────────────────
export const ECON_RECORD = 'Official figures as each agency released them; a next release is the release calendar\'s date, never a forecast. Not advice.'
const ECON_NONE = 'No reading is stated. That is not the same as no figure.'
const notHeldSet = (latest) => new Set(Array.isArray(latest?.not_held) ? latest.not_held : [])

function boardWords(r, notHeld) {
  if (notHeld.has(r.symbol)) return `${r.label}: not held in the server's economics cache yet`
  if (r.state !== 'ok') return `${r.label}: ${String(r.words || 'no reading published here yet').replace(/\.$/, '').toLowerCase()}`
  const l = r.latest
  const val = num(l.value) === null ? `no figure for ${l.period || 'its newest period'}` : `${l.text} for ${l.period}`
  const prior = r.prior ? `, prior ${num(r.prior.value) === null ? 'no figure' : r.prior.text}${r.change ? ` (${r.change.text})` : ''}` : ''
  const alt = r.alt ? `, ${r.alt.label ? `${r.alt.label} ` : ''}${r.alt.text}` : ''
  const rel = l.released ? `, released ${l.released}` : ''
  const next = r.next?.state === 'ok' ? `; next ${r.next.text}` : r.next?.state === 'passed' ? `; ${r.next.text.charAt(0).toLowerCase()}${r.next.text.slice(1)}` : ''
  return `${r.label} ${val}${alt}${rel}${prior}${next}${noteText(r.note) ? ` (${noteText(r.note)})` : ''}`
}

/** Pure: an `econ.latest` envelope → the answer. */
export function answerFromEconomy(envl) {
  const what = 'the economy board'
  if (!usable(envl)) {
    return { text: noRead(what, envl, 'it is not held in the server\'s economics cache yet (this answer never loads it), the economic data is switched off on this server, or the read failed. Open ECON in UCT, then ask again', ECON_NONE) }
  }
  const view = economyRead(envl.data, { today: today() })
  if (view.state !== 'ok') return unclean(what, ECON_NONE)
  const notHeld = notHeldSet(envl.data)
  const lines = ['The economy board as UCT holds it (official U.S. releases), theme by theme:']
  const rows = []
  for (const t of view.themes) {
    lines.push(`• ${t.title}: ${t.rows.map(r => boardWords(r, notHeld)).join('; ')}.`)
    for (const r of t.rows) rows.push({ series: r.label, latest: r.state === 'ok' ? (num(r.latest.value) === null ? 'no figure' : r.latest.text) : notHeld.has(r.symbol) ? 'not held' : 'no reading', period: r.state === 'ok' ? r.latest.period : 'n/a', prior: r.state === 'ok' && r.prior ? r.prior.text : 'n/a', change: r.state === 'ok' && r.change ? r.change.text : 'n/a' })
  }
  if (notHeld.size) lines.push(`${plural(notHeld.size, 'series is', 'series are')} not held in the server's economics cache yet; this answer never loads ${notHeld.size === 1 ? 'it' : 'them'}. That is not the same as no figure.`)
  const missing = ECON_THEMES.flatMap(t => t.missing)
  if (missing.length) lines.push(`Not on this board: ${missing.join(', ')}.`)
  lines.push(envl.as_of ? `The newest release in this answer came out ${stampET(envl.as_of, envl.fetched_at)}; this answer never reads the econ store again.` : 'The answer carries no release time, so I cannot say how old it is.')
  lines.push(ECON_RECORD)
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'series', label: 'Series' }, { key: 'latest', label: 'Latest' }, { key: 'period', label: 'Period' }, { key: 'prior', label: 'Prior' }, { key: 'change', label: 'Change' }], rows },
    present: { kind: 'metrics', title: 'Economy board', short: 'Economy', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.series, value: r.latest, note: `${r.period}; prior ${r.prior}`, aka: [r.series.toLowerCase()] })) },
    facts: { as_of: envl.as_of || null, held: view.held, rows: view.rows, not_held: [...notHeld] },
  }
}

export async function answerEconomy() {
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the economy board: ${NO_TURN}.` }
  const envl = await readData('econ.latest', {}, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromEconomy(envl)
}

// ── stock.liquidityBoard ← market.liquidity ──────────────────────────────────────────────────────────────────────────
export const LIQ_RECORD = `Official balance-sheet and money figures; net liquidity is a ${NET_LABEL} (the Fed's total assets minus the Treasury General Account minus overnight reverse repo, each Wednesday). A record, ${NOT_ADVICE}.`
const LIQ_NONE = 'No figure is stated. That is not the same as no figure published.'
const toHistories = (h, read) => Object.fromEntries(Object.entries(obj(h) || {}).map(([s, b]) => [s, b ? read(b, s) : null]))

/** Pure: a `market.liquidity` envelope → the answer. */
export function answerFromLiquidity(envl) {
  const what = 'the liquidity figures'
  if (!usable(envl)) {
    return { text: noRead(what, envl, 'they are not held in the server\'s economics cache yet (this answer never loads them), the economic data is switched off on this server, or the read failed. Open LIQ in UCT, then ask again', LIQ_NONE) }
  }
  const d = envl.data
  if (!obj(d.latest)) return unclean(what, LIQ_NONE)
  const view = liquidityRead({ latest: d.latest, histories: toHistories(d.histories, liqHistoryPoints), today: today() })
  if (view.state !== 'ok') return unclean(what, LIQ_NONE)
  const notHeld = notHeldSet(d.latest)
  const net = view.net || {}
  const lines = []
  if (net.state === 'ok' && net.head) {
    const ch = list(net.changes).map(c => `${plural(c.weeks, 'week')} ${c.value === null ? 'n/a' : c.text}`)
    lines.push(`Net liquidity on ${dayText(net.head.date)}: ${moneyWords(net.head.net, 'USD')}; the change over ${ch.join(', ')}.`)
    if (str(net.sentence)) lines.push(net.sentence)
    if (net.head.rrpShifted && net.head.rrpDay) lines.push(`Reverse repo for that Wednesday is the print of ${shortDay(net.head.rrpDay)}, the nearest earlier day.`)
  } else if (net.state === 'not_held') {
    const missing = Array.isArray(net.missing) ? net.missing.filter(str) : []
    lines.push(`Net liquidity cannot be worked out: ${missing.length ? `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not held` : 'an input is not held'} in the server's economics cache. That is not the same as no figure.`)
  }
  else lines.push('Net liquidity has no Wednesday with every input held, so no value is stated (never 0).')
  lines.push('The parts:')
  const rows = []
  for (const p of view.parts) {
    if (notHeld.has(p.symbol)) { lines.push(`• ${p.label}: not held in the server's economics cache yet`); rows.push({ part: p.label, latest: 'not held', when: 'n/a', change: 'n/a' }); continue }
    if (p.state !== 'ok') { lines.push(`• ${p.label}: ${String(p.words || 'no reading published here yet').replace(/\.$/, '').toLowerCase()}`); rows.push({ part: p.label, latest: 'no reading', when: 'n/a', change: 'n/a' }); continue }
    const chg = p.change?.text ? `, ${p.change.text} over ${p.change.over}` : `, ${String(p.change?.why || 'no change stated').replace(/\.$/, '').toLowerCase()}`
    lines.push(`• ${p.label}: ${num(p.latest.value) === null ? 'no figure' : p.latest.text} (${p.latest.when})${chg}${p.alt ? `; ${p.alt.label} ${p.alt.text}` : ''}`)
    rows.push({ part: p.label, latest: num(p.latest.value) === null ? 'no figure' : p.latest.text, when: p.latest.when, change: p.change?.text || 'n/a' })
  }
  if (net.next?.state === 'ok') lines.push(`The Fed's next weekly balance sheet (H.4.1): ${net.next.text}.`)
  lines.push(envl.as_of ? `The newest release in this answer came out ${stampET(envl.as_of, envl.fetched_at)}; this answer never reads the econ store again.` : 'The answer carries no release time, so I cannot say how old it is.')
  lines.push(LIQ_RECORD)
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'part', label: 'Part' }, { key: 'latest', label: 'Latest' }, { key: 'when', label: 'For' }, { key: 'change', label: 'Change' }], rows },
    present: { kind: 'metrics', title: 'Liquidity', short: 'Liquidity', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.part, value: r.latest, note: `${r.when}; ${r.change}`, aka: [r.part.toLowerCase()] })) },
    facts: { as_of: envl.as_of || null, net: net.state === 'ok' && net.head ? net.head.net : null, net_date: net.head?.date || null, not_held: [...notHeld] },
  }
}

export async function answerLiquidity() {
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the liquidity figures: ${NO_TURN}.` }
  const envl = await readData('market.liquidity', {}, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromLiquidity(envl)
}

// ── stock.oilReport ← market.oil ─────────────────────────────────────────────────────────────────────────────────────
export const OIL_RECORD = `The EIA's own weekly figures; the build or draw is the econ service's weekly change of crude stocks. A record, ${NOT_ADVICE}.`
const OIL_NONE = 'No figure is stated. That is not the same as no figure published.'

/** Pure: a `market.oil` envelope → the answer. */
export function answerFromOil(envl) {
  const what = 'the weekly oil report'
  if (!usable(envl)) {
    return { text: noRead(what, envl, 'it is not held in the server\'s economics cache yet (this answer never loads it), the economic data is switched off on this server, or the read failed. Open OIL in UCT, then ask again', OIL_NONE) }
  }
  const d = envl.data
  if (!obj(d.latest)) return unclean(what, OIL_NONE)
  const view = oilRead({ latest: d.latest, histories: toHistories(d.histories, oilHistoryPoints), today: today() })
  if (view.state !== 'ok') return unclean(what, OIL_NONE)
  const notHeld = notHeldSet(d.latest)
  const h = view.head || {}
  const lines = [h.state === 'ok' ? `${h.headline} in ${h.week}${h.released ? ` (released ${h.released})` : ''}.` : `${String(h.words || 'The weekly crude change is not stated.')}`]
  lines.push(nextSentence('EIA weekly petroleum report', h.next))
  const rows = []
  for (const g of view.groups) {
    const parts = g.rows.map(r => {
      if (notHeld.has(r.symbol)) return `${r.label}: not held in the server's economics cache yet`
      if (r.state !== 'ok') return `${r.label}: ${String(r.words || 'no reading published here yet').replace(/\.$/, '').toLowerCase()}`
      const ya = r.yearAgo?.state === 'ok' ? `; a year earlier ${r.yearAgo.text}${r.yearAgo.change ? ` (${r.yearAgo.change})` : ''}` : ''
      return `${r.label} ${num(r.latest.value) === null ? 'no figure' : r.latest.text} (${r.latest.period})${r.change ? `, ${r.change} on the week before` : ''}${ya}`
    })
    lines.push(`• ${g.title}: ${parts.join('; ')}.`)
    for (const r of g.rows) rows.push({ series: r.label, latest: r.state === 'ok' ? (num(r.latest.value) === null ? 'no figure' : r.latest.text) : notHeld.has(r.symbol) ? 'not held' : 'no reading', period: r.state === 'ok' ? r.latest.period : 'n/a', change: r.state === 'ok' && r.change ? r.change : 'n/a' })
  }
  if (h.pumpNext?.state === 'ok') lines.push(nextSentence('pump price survey', h.pumpNext))
  lines.push(envl.as_of ? `The newest release in this answer came out ${stampET(envl.as_of, envl.fetched_at)}; this answer never reads the econ store again.` : 'The answer carries no release time, so I cannot say how old it is.')
  lines.push(OIL_RECORD)
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'series', label: 'Series' }, { key: 'latest', label: 'Latest' }, { key: 'period', label: 'Week' }, { key: 'change', label: 'Change' }], rows },
    present: { kind: 'metrics', title: 'Weekly oil report', short: 'Oil report', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.series, value: r.latest, note: `${r.period}; ${r.change}`, aka: [r.series.toLowerCase()] })) },
    facts: { as_of: envl.as_of || null, build_draw: h.state === 'ok' ? h.word : null, barrels: h.state === 'ok' ? num(h.barrels) : null, not_held: [...notHeld] },
  }
}

export async function answerOil() {
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the weekly oil report: ${NO_TURN}.` }
  const envl = await readData('market.oil', {}, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromOil(envl)
}

// ── stock.daysLikeToday ← market.analogs ─────────────────────────────────────────────────────────────────────────────
export const ANALOGS_DEFAULT_ROWS = 5
export const ANALOGS_MAX_ROWS = 10
export const ANALOGS_RECORD = ANLG_RECORD_LINE
const ANALOGS_NONE = 'No similar session is stated. That is not the same as no similar days.'

/** Pure: a `market.analogs` envelope → the answer. */
export function answerFromAnalogs(envl, asked = ANALOGS_DEFAULT_ROWS) {
  const what = 'the breadth analogues'
  if (!usable(envl)) {
    return { text: noRead(what, envl, 'they are not held on the server yet (this answer never searches), or the read failed. Open ANLG in UCT, then ask again', ANALOGS_NONE) }
  }
  const d = envl.data
  if (!Array.isArray(d.matches)) return unclean(what, ANALOGS_NONE)
  // the route's own body, so the panel's model reads it: an absent window is "not yet", never 0
  const body = { reference_date: d.reference_date, analogues: list(d.matches).map(m => ({ date: m.date, similarity: m.similarity,
    forward_returns: Object.fromEntries(Object.entries(obj(m.forward_returns) || {}).filter(([, v]) => num(v) !== null)) })) }
  const view = anlgRead(body)
  if (view.state === 'failed') return unclean(what, ANALOGS_NONE)
  const lines = [ANALOGS_RECORD]
  if (view.state !== 'ok') lines.push(`No past session in what UCT holds came back for ${dayWithYear(d.reference_date)}. No record matched; that is not the same as no similar days.`)
  else {
    lines.push(`The ${plural(view.rows.length, 'past session')} whose breadth looked most like ${dayWithYear(view.reference)} in UCT's breadth history, closest first, and what the S&P 500 did 5 / 10 / 20 / 60 trading days later:`)
    for (const r of view.rows.slice(0, TEXT_ROWS)) {
      const cells = ['fwd_5d', 'fwd_10d', 'fwd_20d', 'fwd_60d'].map(k => { const c = cellFor(r, k); return c.kind === 'value' ? c.text : c.kind === 'notyet' ? 'not yet' : 'n/a' })
      lines.push(`• ${dayWithYear(r.date)} (${matchText(r.similarity)}): ${cells.join(' / ')}`)
    }
    if (view.rows.length > TEXT_ROWS) lines.push(more(view.rows.length - TEXT_ROWS))
    lines.push(`Counted from this list: ${summaryFor(view.rows).map(s => `${s.days} days later ${s.text.replace(/\.$/, '')}`).join('; ')}.`)
    if (view.rows.length < asked) lines.push(`Only ${plural(view.rows.length, 'session')} came back of the ${count(asked)} asked for. That is too few to read as a pattern.`)
    else lines.push(`${plural(view.rows.length, 'session')} is a small sample.`)
    if ((int(d.held) ?? 0) > view.rows.length) lines.push(`${count(d.held)} matches are held and the closest ${count(view.rows.length)} are in this answer: the least similar are cut.`)
  }
  lines.push(d.built_at ? `The reference session is ${dayText(d.reference_date)}; UCT worked this out ${stampET(d.built_at, envl.fetched_at)} (UCT's own time), and this answer never searches again.` : `The reference session is ${dayText(d.reference_date)}.`)
  if (envl.stale) lines.push('Stale: the held answer is older than the six hours the server keeps it before working it out again.')
  lines.push(`Not advice.`)
  const rows = view.rows.map(r => ({ day: dayWithYear(r.date), match: matchText(r.similarity), ...Object.fromEntries(['fwd_5d', 'fwd_10d', 'fwd_20d', 'fwd_60d'].map(k => { const c = cellFor(r, k); return [k, c.kind === 'value' ? c.text : c.kind === 'notyet' ? 'not yet' : 'n/a'] })) }))
  const facts = { as_of: d.reference_date || null, matches: view.rows.length, stale: !!envl.stale }
  if (!rows.length) return { text: lines.join('\n'), facts }
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'day', label: 'Session' }, { key: 'match', label: 'Match' }, { key: 'fwd_5d', label: '5 days' }, { key: 'fwd_10d', label: '10 days' }, { key: 'fwd_20d', label: '20 days' }, { key: 'fwd_60d', label: '60 days' }], rows },
    present: { kind: 'metrics', title: 'Days like the newest session', short: 'Breadth analogues', items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.day, value: r.match, note: `20 days later ${r.fwd_20d}`, aka: [r.day.toLowerCase()] })) },
    facts,
  }
}

export async function answerAnalogs(args = {}) {
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the breadth analogues: ${NO_TURN}.` }
  const rows = clamp(args.rows, ANALOGS_MAX_ROWS, ANALOGS_DEFAULT_ROWS)
  const envl = await readData('market.analogs', { rows }, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromAnalogs(envl, rows)
}

// ── routing words (armed only while registered; routing.js's `marketMacro` group lists none) ─────────────────────────
// Routing v2 reaches the six by their summaries. v1 (the kill-switch fallback, and the router the capability-regression
// corpus runs) selects a group by its words, and `marketMacro` is words-only: these words are the only way v1 sends it.
// Routing only ADDS a group (the other groups a message names still ride along), and each pattern is kept off another
// capability's own language:
//   insider    the market's insider buying or purchases, insider clusters, Form 4 or open-market buys. Never one stock's
//              insiders (a ticker at the end), never insider buying by sector or group (wave 11's crowding);
//   history    the market's (or an index's) corrections and bear markets, their history, depth and recovery, the leaders
//              of a rally after a low. Never one stock's corrections or drawdowns (wave 10's statistics);
//   economy    the economy board, economic data and releases, the latest CPI / PPI / PCE / GDP / jobs report / payrolls /
//              jobless claims / housing figures. Never the fed funds rate or the Fed watch (wave 9), never Treasury yields
//              (wave 6), never the earnings calendar;
//   liquidity  net liquidity, market or Fed liquidity, the Fed's balance sheet, the TGA, reverse repo, reserves, M2, SOFR.
//              Never a stock's trading liquidity or its balance sheet (fundamentals);
//   oil        the weekly oil or EIA report, crude, gasoline and distillate inventories, the crude build or draw, refinery
//              utilization, the SPR, pump prices. Never the price of oil (the commodity quote) or crude futures
//              positioning (COT), never oil stocks (companies);
//   analogs    days like this one, the breadth or market analogues, past sessions that looked like it. Never a setup's or a
//              trade's historical analogs (the playbook);
//   not ours   a screen or its condition, an alert, a watchlist, the member's own lists, a page or a panel, or what a term
//              MEANS (the guide).
// ⛔ no lookbehind (iOS 16 floor, src/noRegexLookbehind.test.js).
const NOT_A_SCREEN = '^(?!.*\\b(?:scans?|screens?|screener|filters?|find|alerts?|notify|widgets?|page|tab|panel|watchlists?|my|portfolio|positions?)\\b)(?!.*(?:\\b(?:over|above|under|below|at least|more than|less than|greater than)\\b|[<>])\\s*\\$?\\d)'
const NOT_A_MEANING = '(?!.*\\b(?:explain|define|definition|meaning|means?|difference between|how (?:is|are|do|does) .* (?:calculated|worked out|computed|work|works))\\b)'
  + '(?!what(?:\'s|’s| is| are) (?:an? |the )?(?:insider buying|insider clusters?|cluster buys?|form 4s?|corrections?|bear markets?|cpi|ppi|pce|gdp|nonfarm payrolls|jobless claims|net liquidity|liquidity|the tga|tga|reverse repo|m2|sofr|eia report|crude inventories|the spr|spr|analogues?|analogs?|breadth analogues?)\\W*$)'
const OURS = `${NOT_A_SCREEN}${NOT_A_MEANING}`
const NOT_ONE_STOCK = '(?!.*\\b(?:for|of|on|in|at|by) \\$?[a-z]{1,5}(?:\'s|’s)?\\s*$)'
const NOT_GROUPS = '(?!.*\\b(?:sectors?|industr(?:y|ies)|groups?|themes?)\\b)'
const INDEXWORD = '(?:market|stock market|s&p(?: 500)?|spx|spy|nasdaq(?:[- ]?100)?|ndx|qqq|index|indexes|indices)'
const NOT_SETUP = '(?!.*\\b(?:setups?|patterns?|trades?|bases?|breakouts?|stocks?|tickers?)\\b)'
export const WAVE13_ROUTE_WORDS = Object.freeze({
  insider: [
    new RegExp(`${OURS}${NOT_ONE_STOCK}${NOT_GROUPS}.*\\binsiders? (?:are )?(?:buying|buys|purchases|purchasing)\\b`),
    new RegExp(`${OURS}${NOT_GROUPS}.*\\binsider clusters?\\b|^${NOT_A_SCREEN.slice(1)}${NOT_A_MEANING}${NOT_GROUPS}.*\\bcluster (?:buys|buying|purchases)\\b`),
    new RegExp(`${OURS}${NOT_ONE_STOCK}${NOT_GROUPS}.*\\b(?:form 4|open[- ]market) (?:buys|buying|purchases)\\b`),
  ],
  history: [
    new RegExp(`${OURS}${NOT_ONE_STOCK}.*\\bcorrections? (?:and|or|&) bear markets?\\b`),
    new RegExp(`${OURS}.*\\b${INDEXWORD}(?:'s|’s)? (?:corrections|bear markets|declines|drawdowns|market history)\\b`),
    new RegExp(`${OURS}.*\\b(?:corrections|bear markets) (?:of|in|for) (?:the )?${INDEXWORD}\\b|^${NOT_A_SCREEN.slice(1)}${NOT_A_MEANING}.*\\b(?:history of|every|all the|past|previous|historical) (?:market )?(?:corrections|bear markets)\\b`),
    new RegExp(`${OURS}.*\\bhow (?:long|deep|bad) (?:do|did|does|are|were|was|is) (?:the )?(?:average |typical |a )?(?:corrections?|bear markets?)\\b`),
    new RegExp(`${OURS}.*\\b(?:leaders?|leading stocks|rall(?:y|ies)) (?:of|after|out of|coming out of) (?:the |each |every |past |a )?(?:corrections?|bear markets?|market lows?|market bottoms?)\\b`),
    new RegExp(`${OURS}.*\\bmarket history\\b`),
  ],
  economy: [
    new RegExp(`${OURS}.*\\b(?:economy|economic) (?:board|dashboard|data|numbers|indicators|figures|releases|readings|stats)\\b`),
    new RegExp(`${OURS}.*\\b(?:macro|macroeconomic) (?:data|numbers|indicators|dashboard|figures)\\b`),
    new RegExp(`${OURS}.*\\b(?:latest|last|newest|recent) (?:cpi|core cpi|ppi|pce|core pce|inflation (?:data|report|numbers|print)|jobs report|payrolls|nonfarm payrolls|gdp|unemployment rate|jobless claims|housing starts|retail sales)\\b`),
    new RegExp(`${OURS}.*\\b(?:cpi|ppi|pce|gdp) (?:print|reading|report|number|numbers|data|figure)\\b|^${NOT_A_SCREEN.slice(1)}${NOT_A_MEANING}.*\\binflation (?:data|report|numbers|print|figures)\\b`),
    new RegExp(`${OURS}.*\\b(?:jobs report|employment report|nonfarm payrolls|unemployment rate|jobless claims|initial claims|housing starts|building permits|new home sales|industrial production)\\b`),
  ],
  liquidity: [
    new RegExp(`${OURS}${NOT_ONE_STOCK}.*\\b(?:net|market|fed|system|dollar|global|macro) liquidity\\b`),
    new RegExp(`${OURS}${NOT_ONE_STOCK}.*\\bliquidity (?:conditions|picture|backdrop|data|figures|indicators?|board)\\b`),
    new RegExp(`${OURS}.*\\b(?:the )?(?:fed|federal reserve)(?:'s|’s)? balance sheet\\b`),
    new RegExp(`${OURS}.*\\b(?:treasury general account|the tga|tga balance|reverse repo|on rrp|bank reserves|reserve balances|m2(?: money supply)?|money supply|sofr)\\b`),
  ],
  oil: [
    new RegExp(`${OURS}.*\\b(?:weekly )?(?:oil|petroleum|eia) (?:report|status report|inventory report|data|numbers|inventories)\\b`),
    new RegExp(`${OURS}.*\\b(?:crude(?: oil)?|gasoline|distillate|oil) (?:inventories|inventory|supplies|build|draw)\\b`),
    new RegExp(`${OURS}.*\\b(?:inventory (?:build|draw)|refinery utili[sz]ation|strategic petroleum reserve|pump prices|(?:crude|oil) production)\\b`),
  ],
  analogs: [
    new RegExp(`${OURS}.*\\bdays? like (?:today|this|this one)\\b`),
    new RegExp(`${OURS}${NOT_SETUP}.*\\b(?:breadth|market) analog(?:ue)?s\\b|^${NOT_A_SCREEN.slice(1)}${NOT_A_MEANING}${NOT_SETUP}.*\\banalog(?:ue)? (?:days|sessions|dates)\\b`),
    new RegExp(`${OURS}${NOT_SETUP}.*\\b(?:past|historical|similar|other) (?:days|sessions|markets|periods|dates) (?:like|similar to) (?:today|this|the current (?:market|one))\\b`),
    new RegExp(`${OURS}${NOT_SETUP}.*\\b(?:when|last time) (?:did |has |was )?(?:the )?(?:market|breadth) (?:looked|look|looking|been|last looked) like (?:this|today)\\b`),
  ],
})
export const ROUTE_GROUP = 'marketMacro'
const ownGroup = () => GROUPS.find(g => g.id === ROUTE_GROUP)
/** Adds (or takes back) ONE capability's words on the wave's own group. */
function armRoutes(key, on) {
  const g = ownGroup()
  if (!g) return
  for (const re of WAVE13_ROUTE_WORDS[key]) {
    const at = g.words.indexOf(re)
    if (on && at < 0) g.words.push(re)
    if (!on && at >= 0) g.words.splice(at, 1)
  }
}

// ── registration: each capability only while the server serves ITS kind ───────────────────────────────────────────────
// ⚠️ THE WORDS OF A NAME, A SUMMARY AND ITS HINTS JOIN THE TYPO LEXICON (nl/lexicon.js: every lowercase word of three letters
// or more; a word in CAPITALS does not). A new known word changes what a nearby word in ANY member message may be
// "corrected" to, so the text below is worded to add NO word the production catalog does not know (pinned in
// agentTerminalDataWave13.test.js, "the typo lexicon"), except the name words that test shows change no correction. No
// argument carries an enum.
const TARGET_HINT = 'target = the ref of the stockData entry.'
const NO_FIGURES = 'reply: one short line, no figures.'
const HELD_ONLY = 'Answered only from what the SERVER already HOLDS, so it may say none is held.'
const rowsOnly = { type: 'object', properties: { rows: { type: ['integer', 'null'] } }, required: ['rows'], additionalProperties: false }
const noArgs = { type: 'object', properties: {}, required: [], additionalProperties: false }
const unregister = {}

/** Idempotent; registers each of the six ONLY while the server serves its kind. Returns the names registered by this call. */
export function registerTerminalWave13Capabilities() {
  const added = []
  if (!unregister.insider && kindServed(KINDS.insider)) {
    unregister.insider = registerCapability({
      name: 'stock.insiderBuying',        // a LITERAL: the server's local-only mirror rail reads it (tests/test_uct_agent_breadth.py)
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ the vendor's Form 4 list (no AI clause) and the SEC cluster store (no AI lane)
      summary: 'The MARKET\'s INSIDER BUYING as UCT HOLDS it: the LATEST OPEN-MARKET PURCHASES from FORM 4 FILINGS ACROSS the MARKET (LARGEST DOLLAR AMOUNT FIRST, the INSIDER, SHARES, PRICE) and the INSIDER CLUSTERS (3 or MORE INSIDERS BUYING ONE STOCK WITHIN 10 BUSINESS DAYS, from the SEC\'s OWN FILINGS). '
        + 'For "INSIDER BUYING", "INSIDER CLUSTERS".',
      hints: `${TARGET_HINT} No SYMBOL. ROWS 1-${INSIDER_MAX_ROWS} a PART (null = ${INSIDER_DEFAULT_ROWS}). EACH PART HAS its OWN DATE: never today. A RECORD, not ADVICE. ${HELD_ONLY} `
        + `INSIDER BUYING BY SECTOR is not this answer. ${NO_FIGURES}`,
      args: rowsOnly,
      answer: (_snap, args) => answerInsider(args || {}),
    })
    armRoutes('insider', true)
    added.push(CAPABILITIES.insider)
  }
  if (!unregister.history && kindServed(KINDS.history)) {
    unregister.history = registerCapability({
      name: 'stock.marketHistory',        // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ index and stock closes from vendors whose rows clear no model lane
      summary: 'The S&P 500\'s or the NASDAQ-100\'s CORRECTIONS and BEAR MARKETS as UCT HOLDS them: EVERY DECLINE of 10% or MORE on CLOSING PRICES, NEWEST FIRST, with its DEPTH, SESSIONS DOWN, RECOVERY, the RALLY 1, 3, 6 and 12 MONTHS AFTER the LOW and the STOCKS that LED IT. '
        + 'For "MARKET CORRECTIONS and BEAR MARKETS", "HOW LONG do BEAR MARKETS LAST".',
      hints: `${TARGET_HINT} INDEX = SPX or NDX (null = SPX). ROWS 1-${HISTORY_MAX_ROWS} DECLINES (null = ${HISTORY_DEFAULT_ROWS}). The date is the INDEX's LAST CLOSE: never today. A RECORD, not a FORECAST. ${HELD_ONLY} `
        + `ONE STOCK's CORRECTIONS are not this answer. ${NO_FIGURES}`,
      args: { type: 'object', properties: { index: { type: ['string', 'null'] }, rows: { type: ['integer', 'null'] } }, required: ['index', 'rows'], additionalProperties: false },
      answer: (_snap, args) => answerHistory(args || {}),
    })
    armRoutes('history', true)
    added.push(CAPABILITIES.history)
  }
  if (!unregister.economy && kindServed(KINDS.economy)) {
    unregister.economy = registerCapability({
      name: 'stock.economyBoard',         // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ the agencies' series through UCT's econ store, which no register row clears for a model
      summary: 'The ECONOMY BOARD as UCT HOLDS it: INFLATION (CPI, CORE CPI, PCE, PPI), JOBS (PAYROLLS, UNEMPLOYMENT, CLAIMS, EARNINGS, OPENINGS), GROWTH and SPENDING (GDP, INDUSTRIAL PRODUCTION, INCOME, SPENDING), HOUSING and RATES, EACH with its LATEST READING, the ONE BEFORE, the CHANGE, its RELEASE and the NEXT RELEASE. '
        + 'For "ECONOMIC DATA", "the LATEST CPI".',
      hints: `${TARGET_HINT} No ARGUMENTS. EACH SERIES HAS its OWN PERIOD and RELEASE: never today. OFFICIAL FIGURES, not a FORECAST. ${HELD_ONLY} `
        + `The FED WATCH and TREASURY YIELDS are not this answer. ${NO_FIGURES}`,
      args: noArgs,
      answer: () => answerEconomy(),
    })
    armRoutes('economy', true)
    added.push(CAPABILITIES.economy)
  }
  if (!unregister.liquidity && kindServed(KINDS.liquidity)) {
    unregister.liquidity = registerCapability({
      name: 'stock.liquidityBoard',       // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ the Fed's and the Treasury's series through UCT's econ store, which no register row clears for a model
      summary: 'LIQUIDITY as UCT HOLDS it: NET LIQUIDITY (UCT\'s CALCULATION, the FED\'s TOTAL ASSETS MINUS the TREASURY GENERAL ACCOUNT MINUS OVERNIGHT REVERSE REPO, EACH WEDNESDAY) with its CHANGE over 1, 4, 13 and 52 WEEKS, and its PARTS: the FED\'s ASSETS, the TGA, REVERSE REPO, RESERVES, M2 and SOFR. '
        + 'For "NET LIQUIDITY", "the FED\'s BALANCE SHEET".',
      hints: `${TARGET_HINT} No ARGUMENTS. The date is EACH SERIES' OWN: never today. OFFICIAL FIGURES, not a FORECAST. ${HELD_ONLY} `
        + `A STOCK's LIQUIDITY is not this answer. ${NO_FIGURES}`,
      args: noArgs,
      answer: () => answerLiquidity(),
    })
    armRoutes('liquidity', true)
    added.push(CAPABILITIES.liquidity)
  }
  if (!unregister.oil && kindServed(KINDS.oil)) {
    unregister.oil = registerCapability({
      name: 'stock.oilReport',            // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ the EIA's series through UCT's econ store, which no register row clears for a model
      summary: 'The EIA\'s WEEKLY OIL REPORT as UCT HOLDS it: the WEEK\'s CRUDE BUILD or DRAW, CRUDE, GASOLINE and DISTILLATE STOCKS, the SPR, PRODUCTION, REFINERY UTILIZATION and PUMP PRICES, EACH with the WEEK BEFORE and a YEAR EARLIER, and the NEXT REPORT. '
        + 'For "the WEEKLY OIL REPORT", "CRUDE INVENTORIES".',
      hints: `${TARGET_HINT} No ARGUMENTS. The date is EACH SERIES' OWN WEEK: never today. OFFICIAL FIGURES, not a FORECAST. ${HELD_ONLY} `
        + `The PRICE of OIL and CRUDE FUTURES POSITIONING are not this answer. ${NO_FIGURES}`,
      args: noArgs,
      answer: () => answerOil(),
    })
    armRoutes('oil', true)
    added.push(CAPABILITIES.oil)
  }
  if (!unregister.analogs && kindServed(KINDS.analogs)) {
    unregister.analogs = registerCapability({
      name: 'stock.daysLikeToday',        // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'], target: 'market', query: true,
      localOnly: true,                   // ⛔ the breadth row (an accepted-risk source) and sentiment inputs no register row names
      summary: 'The PAST SESSIONS WHOSE MARKET BREADTH LOOKED MOST LIKE the NEWEST ONE, as UCT HOLDS them (the ANLG PANEL): EACH with HOW CLOSE it IS and WHAT the S&P 500 DID 5, 10, 20 and 60 TRADING DAYS LATER, COUNTED from the LIST; a RECORD, NEVER a FORECAST. '
        + 'For "DAYS LIKE TODAY", "BREADTH ANALOGUES".',
      hints: `${TARGET_HINT} No SYMBOL. ROWS 1-${ANALOGS_MAX_ROWS} SESSIONS (null = ${ANALOGS_DEFAULT_ROWS}). The date is the REFERENCE SESSION: never today. A RECORD, not a FORECAST. ${HELD_ONLY} `
        + `A SETUP's PAST TRADES are not this answer. ${NO_FIGURES}`,
      args: rowsOnly,
      answer: (_snap, args) => answerAnalogs(args || {}),
    })
    armRoutes('analogs', true)
    added.push(CAPABILITIES.analogs)
  }
  return added
}
export const _resetTerminalWave13ForTest = () => {
  for (const k of Object.keys(unregister)) { unregister[k]?.(); delete unregister[k] }
  for (const k of Object.keys(WAVE13_ROUTE_WORDS)) armRoutes(k, false)
}
