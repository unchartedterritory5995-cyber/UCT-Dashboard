// Terminal data wave 14 (gap audit A1-A3) — seven LOCAL-ONLY capabilities over seven model-isolated data kinds (MD-1 §4.23):
//   stock.straddleHistory  options.straddleHistory  one stock's straddle by logged session and implied against actual daily moves (OHIS)
//   stock.optionsPositioning          options.positioning      one stock's max pain per expiration and its positioning levels (POS)
//   stock.edgarFeed       filings.feed             new SEC filings, across the market or for one company (FEED)
//   stock.congressTrades   congress.trades          congressional trade disclosures, the newest or for one stock (CONG)
//   stock.dealsMarket      market.deals             the market's latest mergers and acquisitions and index changes (MNA, IDXC)
//   stock.setupStudy       market.setupStudy        how chart setups acted across the market in each phase (SETH)
//   stock.periodChange     market.periodChange      every stock's change between two dates, gainers or losers (PCHG)
//
// Each answer is built in the browser from ONE read of its own kind and shown to the MEMBER ONLY: every capability is
// `localOnly` (its name is in turn.LOCAL_ONLY_ACTIONS on the server), every kind is model-isolated, and nothing the read
// returns reaches a model provider. All seven were isolated as the builder's default; nobody decided otherwise.
//
// What every answer keeps to: the date is the DATA'S OWN (a logged session, a filing day, a disclosure day, the build time
// of a worked-out answer), never the time of the ask; a number that does not exist is never 0; a cut list says so and from
// which end; nothing held and a failed read are never "none"; a record, never a forecast; no envelope note is echoed and no
// vendor is named.
//
// Dark by construction: each is registered only while the server serves its own kind (UCT_AGENT_DATA_KINDS, fail closed; an
// isolated kind also needs its own UCT_AGENT_ISOLATED_KINDS entry). Nothing here arms anything.
// ROUTING: no new group (all 56 of turn.MAX_GROUPS are in use). Each capability joins an EXISTING words-only group by
// action (routing.js): the two options answers join wave 3's `marketBoards` (beside the gamma walls), the filings and the
// congressional disclosures join wave 12's `stockResearch`, the three market lists join wave 4's `marketViews`. Each
// capability's own words (WAVE14_ROUTE_WORDS) are added to its group only while it is registered, so on a dark server
// those groups' words are unchanged and routing is byte-identical to the base.
import { registerCapability } from '../capabilities'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { GROUPS } from '../routing'
import { stampET } from './marketDataFacts'
import { kindServed, usable, noRead, plural, dayText, money, NO_TURN } from './terminalDataFormat'
import { formatNumber } from '../../lib/presentation/presentationPrimitives'

export const KINDS = Object.freeze({
  straddle: 'options.straddleHistory', maxPain: 'options.positioning', filings: 'filings.feed', congress: 'congress.trades',
  deals: 'market.deals', study: 'market.setupStudy', period: 'market.periodChange',
})
export const CAPABILITIES = Object.freeze({
  straddle: 'stock.straddleHistory', maxPain: 'stock.optionsPositioning', filings: 'stock.edgarFeed', congress: 'stock.congressTrades',
  deals: 'stock.dealsMarket', study: 'stock.setupStudy', period: 'stock.periodChange',
})
export const PANELS = Object.freeze({ straddle: 'OHIS', maxPain: 'POS', filings: 'FEED', congress: 'CONG', deals: 'MNA and IDXC', study: 'SETH', period: 'PCHG' })
/** the existing words-only group each capability joins (routing.js lists it there by action) */
export const ROUTE_GROUPS = Object.freeze({
  straddle: 'marketBoards', maxPain: 'marketBoards', filings: 'stockResearch', congress: 'stockResearch',
  deals: 'marketViews', study: 'marketViews', period: 'marketViews',
})
export const NOT_ADVICE = 'not a forecast and not advice'
export const STRADDLE_DEFAULT_ROWS = 20
export const STRADDLE_MAX_ROWS = 60
export const FILINGS_DEFAULT_ROWS = 15
export const FILINGS_MAX_ROWS = 60
export const CONGRESS_DEFAULT_ROWS = 15
export const CONGRESS_MAX_ROWS = 50
export const DEALS_DEFAULT_ROWS = 10
export const DEALS_MAX_ROWS = 50
export const PERIOD_DEFAULT_ROWS = 15
export const PERIOD_MAX_ROWS = 50
const TEXT_ROWS = 6
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v) => (Number.isInteger(v) ? v : null)
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)
const list = (v) => (Array.isArray(v) ? v.filter(r => r && typeof r === 'object') : [])
const clamp = (v, max, fallback) => (Number.isInteger(v) ? Math.min(Math.max(v, 1), max) : fallback)
const count = (n) => formatNumber(n, { decimals: 0 })
const pctText = (v, d = 1) => (num(v) === null ? null : `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(v).toFixed(d)}%`)
const shortDay = (ymd) => (dayText(ymd) || '').replace(/^\w+, /, '') || null
const unclean = (what, none) => ({ text: `I couldn't read ${what}: UCT's data did not answer cleanly. ${none}` })
const more = (n) => `${n} more ${n === 1 ? 'is' : 'are'} in the table.`
const TICKER = /^[A-Z0-9]{1,10}(?:-[A-Z0-9]{1,4}){0,2}$/
const tickerOf = (s) => { const t = String(s || '').trim().toUpperCase().replace(/^\$/, '').replace(/\./g, '-'); return TICKER.test(t) ? t : null }
const askStock = (what, none) => ({ text: `Which stock's ${what} should I read? Give me one ticker. ${none}` })
const at = (iso, fetched) => (str(iso) ? stampET(iso, fetched) : null)

// ── stock.straddleHistory ← options.straddleHistory ──────────────────────────────────────────────────────────────────
export const STRADDLE_RECORD = `UCT's own options log, recorded once a day after the close: a record, ${NOT_ADVICE}.`
const STRADDLE_NONE = 'No straddle and no daily move is stated. That is not the same as no options history.'

/** Pure: an `options.straddleHistory` envelope → the answer. */
export function answerFromStraddle(envl) {
  const sym = str(envl?.data?.symbol) || 'the stock'
  const what = `${sym}'s options history`
  if (!usable(envl)) return { text: noRead(what, envl, 'its logged sessions are not held on this server (this answer never downloads them), or the read failed. Open OHIS in UCT, then ask again', STRADDLE_NONE) }
  const d = envl.data
  const st = obj(d.straddle)
  const dm = obj(d.daily_move)
  if (!st || !dm) return unclean(what, STRADDLE_NONE)
  const lines = [`${sym}'s options history from UCT's options log, newest logged session ${shortDay(d.as_of) || 'a day it does not give'}${str(d.logging_began) ? ` (the log began ${shortDay(d.logging_began)})` : ''}:`]
  const rows = []
  if (st.state === 'off') lines.push('The straddle history is switched off on this server.')
  else if (st.state !== 'held') lines.push(`No logged session holds a straddle for ${sym}. That is not the same as none.`)
  else {
    lines.push('The front at-the-money straddle (call plus put, the first expiry after the session), newest first:')
    for (const r of list(st.rows).slice(0, TEXT_ROWS)) {
      lines.push(`• ${shortDay(r.date)}: ${money(r.straddle) || 'no straddle'}${num(r.straddle_pct) !== null ? `, ${r.straddle_pct.toFixed(2)}% of the stock` : ''}${int(r.front_dte) !== null ? `, ${plural(r.front_dte, 'day')} to its expiry` : ''}`)
    }
    if (list(st.rows).length > TEXT_ROWS) lines.push(more(list(st.rows).length - TEXT_ROWS))
    if (st.cut) lines.push(`${count(st.total)} sessions are held and the newest ${count(st.count)} are in this answer: the history is cut from the old end.`)
    for (const r of list(st.rows)) rows.push({ day: shortDay(r.date) || 'n/a', what: 'Straddle', value: money(r.straddle) || 'n/a', detail: num(r.straddle_pct) !== null ? `${r.straddle_pct.toFixed(2)}% of the stock` : 'n/a' })
  }
  if (dm.state === 'off') lines.push('The implied against actual daily moves are switched off on this server.')
  else if (dm.state !== 'held') lines.push(`No logged session holds a daily move pair for ${sym}. That is not the same as none.`)
  else {
    const s = obj(dm.summary)
    lines.push(s ? `Implied against actual one-day moves: the move stayed inside the implied move ${num(s.inside_share) !== null ? `${s.inside_share}%` : 'n/a'} of the time over ${plural(int(s.pairs) ?? 0, 'pair')}${num(s.mean_ratio) !== null ? `, on average ${s.mean_ratio} times the implied move` : ''}.`
      : `Implied against actual one-day moves: ${str(dm.summary_note) || 'too few pairs for a summary yet.'}`)
    for (const r of list(dm.rows).slice(0, TEXT_ROWS)) {
      lines.push(`• ${shortDay(r.date)} to ${shortDay(r.next) || 'the next session'}: implied ${pctText(r.implied_move_pct, 2) || 'n/a'}, actual ${pctText(r.actual_move_pct, 2) || 'n/a'}${r.inside === true ? ' (inside)' : r.inside === false ? ' (outside)' : ''}`)
    }
    if (int(dm.broken)) lines.push(`${plural(dm.broken, 'pair is', 'pairs are')} broken by a session the log did not record; a missed day is never bridged.`)
    for (const r of list(dm.rows)) rows.push({ day: shortDay(r.date) || 'n/a', what: 'Implied vs actual', value: pctText(r.actual_move_pct, 2) || 'n/a', detail: `implied ${pctText(r.implied_move_pct, 2) || 'n/a'}` })
  }
  if (envl.stale) lines.push('A newer session may be logged and not yet on this server: this answer never downloads one.')
  lines.push(STRADDLE_RECORD)
  const facts = { symbol: sym, as_of: d.as_of || null, straddles: st.state === 'held' ? list(st.rows).length : null, pairs: dm.state === 'held' ? list(dm.rows).length : null }
  if (!rows.length) return { text: lines.join('\n'), facts }
  return { text: lines.join('\n'), facts,
    table: { columns: [{ key: 'day', label: 'Session' }, { key: 'what', label: 'What' }, { key: 'value', label: 'Value' }, { key: 'detail', label: 'Detail' }], rows } }
}

export async function answerStraddle(args = {}) {
  const sym = tickerOf(args.symbol)
  if (!sym) return askStock('options history', STRADDLE_NONE)
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${sym}'s options history: ${NO_TURN}.` }
  const envl = await readData('options.straddleHistory', { symbol: sym, rows: clamp(args.rows, STRADDLE_MAX_ROWS, STRADDLE_DEFAULT_ROWS) }, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromStraddle(envl)
}

// ── stock.optionsPositioning ← options.positioning ──────────────────────────────────────────────────────────────────────────────
export const POSITIONING_RECORD = `UCT's own arithmetic on an option chain's open interest, gamma and delta: ${NOT_ADVICE}.`
const POSITIONING_NONE = 'No max pain and no level is stated. That is not the same as none.'
export const WINDOW_WORDS = Object.freeze({ '0dte': '0dte', today: '0dte', '1dte': '1dte', tomorrow: '1dte', week: 'week', weekly: 'week', month: 'month', monthly: 'month', all: 'all' })

/** Pure: an `options.positioning` envelope → the answer. */
export function answerFromPositioning(envl) {
  const sym = str(envl?.data?.symbol) || 'the stock'
  const what = `${sym}'s max pain and positioning levels`
  if (!usable(envl)) return { text: noRead(what, envl, 'they are not held on the server (they are kept a minute after the POS panel works them out, and this answer never reads an option chain), or the read failed. Open POS in UCT, then ask again', POSITIONING_NONE) }
  const d = envl.data
  const mp = obj(d.max_pain)
  const lv = obj(d.levels)
  if (!mp || !lv) return unclean(what, POSITIONING_NONE)
  const lines = [`${sym}'s options positioning for the ${str(d.window) || 'month'} window, worked out by UCT ${d.computed_at ? `at ${at(d.computed_at, envl.fetched_at)} (UCT's own time)` : 'at a time it does not give'} from the option chain it read then:`]
  const rows = []
  if (mp.state === 'held') {
    const exps = list(mp.expirations)
    lines.push(exps.length ? 'Max pain (the strike where the open options are worth least at expiry), nearest expiry first:' : 'No expiry in the chain carried open interest, so no max pain is stated.')
    for (const e of exps.slice(0, TEXT_ROWS)) lines.push(`• ${shortDay(e.expiration)}: ${money(e.max_pain) || 'n/a'}${num(e.distance_pct) !== null ? ` (${pctText(e.distance_pct, 2)} from the stock price then)` : ''}`)
    if (exps.length > TEXT_ROWS) lines.push(more(exps.length - TEXT_ROWS))
    if (mp.cut) lines.push(`${count(mp.total)} expiries are held and the nearest ${count(mp.count)} are in this answer: the far ones are cut.`)
    if (int(mp.contracts_missing_oi)) lines.push(`${plural(mp.contracts_missing_oi, 'contract carries', 'contracts carry')} no open interest and ${mp.contracts_missing_oi === 1 ? 'is' : 'are'} left out, never counted as 0.`)
    if (num(mp.strike_band_pct) !== null) lines.push(`Only strikes within ${mp.strike_band_pct}% of the stock price were read, so max pain is over that band.`)
    for (const e of exps) rows.push({ what: `Max pain, ${shortDay(e.expiration) || 'n/a'}`, value: money(e.max_pain) || 'n/a' })
  } else lines.push(mp.state === 'off' ? 'Max pain is switched off on this server.' : 'Max pain is not held on the server for this window.')
  if (lv.state === 'held') {
    const levels = list(lv.levels)
    lines.push('The positioning levels:')
    for (const l of levels) {
      const v = num(l.value) === null ? 'not stated' : l.unit === 'strike' ? money(l.value) : `${money(l.value)} move`
      lines.push(`• ${str(l.label) || l.id}: ${v}${str(l.role) ? ` (${l.role})` : ''}`)
      rows.push({ what: str(l.label) || l.id, value: v })
    }
  } else lines.push(lv.state === 'off' ? 'The positioning levels are switched off on this server.' : 'The positioning levels are not held on the server for this window.')
  if (num(mp.spot ?? lv.spot) !== null) lines.push(`The stock price behind them is ${money(mp.spot ?? lv.spot)}, the one the chain carried then, never a quote.`)
  lines.push(POSITIONING_RECORD)
  const facts = { symbol: sym, window: d.window || null, computed_at: d.computed_at || null, expiries: mp.state === 'held' ? list(mp.expirations).length : null }
  if (!rows.length) return { text: lines.join('\n'), facts }
  return { text: lines.join('\n'), facts, table: { columns: [{ key: 'what', label: 'What' }, { key: 'value', label: 'Value' }], rows } }
}

export async function answerPositioning(args = {}) {
  const sym = tickerOf(args.symbol)
  if (!sym) return askStock('max pain', POSITIONING_NONE)
  const raw = str(args.window)
  const window = raw ? WINDOW_WORDS[raw.toLowerCase()] || null : 'month'
  if (!window) return { text: 'Which window should I read: 0dte, 1dte, week, month or all? No max pain is stated.' }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${sym}'s max pain: ${NO_TURN}.` }
  const envl = await readData('options.positioning', { symbol: sym, window }, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromPositioning(envl)
}

// ── stock.edgarFeed ← filings.feed ──────────────────────────────────────────────────────────────────────────────────
export const FILINGS_RECORD = 'A record of what was filed with the SEC, not advice.'
const FILINGS_NONE = 'No filing is stated. That is not the same as no filings.'
export const FORM_WORDS = Object.freeze({ '8-k': '8-K', '8k': '8-K', '10-q': '10-Q', '10q': '10-Q', '10-k': '10-K', '10k': '10-K', '4': '4', 'form 4': '4',
  's-1': 'S-1', s1: 'S-1', '13d': 'SCHEDULE 13D', '13g': 'SCHEDULE 13G', 'schedule 13d': 'SCHEDULE 13D', 'schedule 13g': 'SCHEDULE 13G' })

/** Pure: a `filings.feed` envelope → the answer. */
export function answerFromFilings(envl) {
  const sym = str(envl?.data?.symbol)
  const what = sym ? `${sym}'s SEC filings` : 'the newest SEC filings'
  if (!usable(envl)) return { text: noRead(what, envl, `they are not held on the server yet (this answer never asks the SEC), the company is not in the SEC's ticker list, or the read failed. Open FEED${sym ? ` for ${sym}` : ''} in UCT, then ask again`, FILINGS_NONE) }
  const d = envl.data
  if (!Array.isArray(d.rows)) return unclean(what, FILINGS_NONE)
  const rows = list(d.rows)
  const scope = sym ? `${sym}${str(d.company) ? ` (${d.company})` : ''}'s recent SEC filings` : 'The newest SEC filings across the market'
  const lines = [`${scope}${str(d.form) ? `, form ${d.form}` : ''}, as UCT read them from EDGAR${d.read_at ? ` at ${at(d.read_at, envl.fetched_at)}` : ''}, newest first:`]
  if (!rows.length) lines.push(`No ${str(d.form) || 'such'} filing is in what UCT holds. That is not the same as no filings.`)
  for (const r of rows.slice(0, TEXT_ROWS)) {
    const items = list(r.items).map(i => str(i.label)).filter(Boolean)
    lines.push(`• ${shortDay(r.filed) || 'a day it does not give'}: ${r.form}${!sym && str(r.company) ? ` by ${r.company}${str(r.ticker) ? ` (${r.ticker})` : ''}` : ''}${items.length ? `: ${items.slice(0, 3).join('; ')}` : ''}`)
  }
  if (rows.length > TEXT_ROWS) lines.push(more(rows.length - TEXT_ROWS))
  if (d.cut) lines.push(`${count(d.total)} filings are held and the newest ${count(d.count)} are in this answer: the list is cut from the old end.`)
  if (envl.stale) lines.push('The feed has not been read from EDGAR lately, so newer filings may exist.')
  if (envl.status === 'partial') lines.push('Some forms could not be read on the last read of the feed.')
  lines.push(FILINGS_RECORD)
  const facts = { symbol: sym || null, filings: rows.length, newest_filed: rows[0]?.filed || null }
  if (!rows.length) return { text: lines.join('\n'), facts }
  return { text: lines.join('\n'), facts,
    table: { columns: [{ key: 'day', label: 'Filed' }, { key: 'form', label: 'Form' }, { key: 'company', label: 'Company' }, { key: 'link', label: 'SEC page' }],
      rows: rows.map(r => ({ day: shortDay(r.filed) || 'n/a', form: r.form, company: str(r.company) || 'n/a', link: str(r.url) || 'n/a' })) } }
}

export async function answerFilings(args = {}) {
  const sym = args.symbol === null || args.symbol === undefined || args.symbol === '' ? null : tickerOf(args.symbol)
  if (args.symbol && !sym) return askStock('SEC filings', FILINGS_NONE)
  const rawForm = str(args.form)
  const form = rawForm ? FORM_WORDS[rawForm.toLowerCase()] || null : null
  if (rawForm && !form) return { text: `Which form should I read: an 8-K, a 10-Q, a 10-K, a Form 4, a 13D or 13G, or an S-1? ${FILINGS_NONE}` }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the SEC filings: ${NO_TURN}.` }
  const envl = await readData('filings.feed', { symbol: sym, form, rows: clamp(args.rows, FILINGS_MAX_ROWS, FILINGS_DEFAULT_ROWS) }, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromFilings(envl)
}

// ── stock.congressTrades ← congress.trades ───────────────────────────────────────────────────────────────────────────
export const CONGRESS_RECORD = 'Disclosures as the members filed them, which can come up to 45 days after the trade: a record, not advice.'
const CONGRESS_NONE = 'No disclosure is stated. That is not the same as no trades.'
const SIDE_WORDS = { buy: 'bought', sell: 'sold', exchange: 'exchanged', other: 'reported' }

/** Pure: a `congress.trades` envelope → the answer. */
export function answerFromCongress(envl) {
  const sym = str(envl?.data?.symbol)
  const what = sym ? `the congressional trades in ${sym}` : 'the newest congressional trades'
  if (!usable(envl)) return { text: noRead(what, envl, `they are not held on the server yet (this answer never asks for them), or the read failed. Open CONG${sym ? ` for ${sym}` : ''} in UCT, then ask again`, CONGRESS_NONE) }
  const d = envl.data
  if (!Array.isArray(d.rows)) return unclean(what, CONGRESS_NONE)
  const rows = list(d.rows)
  const lines = [sym ? `Congressional trade disclosures naming ${sym}, newest disclosure first:` : 'The newest congressional trade disclosures, newest first:']
  if (!rows.length) lines.push(`No congressional disclosure in what UCT holds names ${sym || 'a stock'}. That is not the same as no trades.`)
  for (const r of rows.slice(0, TEXT_ROWS)) {
    lines.push(`• ${str(r.member) || 'a member it does not name'} (${r.chamber === 'senate' ? 'Senate' : 'House'}) ${SIDE_WORDS[r.side] || 'reported'} ${str(r.symbol) || 'a holding'}, ${str(r.amount) || 'an amount not stated'}, traded ${shortDay(r.transaction_date) || 'on a day not stated'}, disclosed ${shortDay(r.disclosure_date) || 'on a day not stated'}`)
  }
  if (rows.length > TEXT_ROWS) lines.push(more(rows.length - TEXT_ROWS))
  if (d.cut) lines.push(`${count(d.total)} disclosures are held and the newest ${count(d.count)} are in this answer: the list is cut from the old end.`)
  for (const [c, st] of Object.entries(obj(d.chambers) || {})) if (st === 'unavailable') lines.push(`The ${c === 'senate' ? 'Senate' : 'House'} records could not be read, so only the other chamber is stated.`)
  if (d.read_at) lines.push(`UCT read these at ${at(d.read_at, envl.fetched_at)}.`)
  lines.push(CONGRESS_RECORD)
  const facts = { symbol: sym || null, disclosures: rows.length, newest_disclosure: d.newest_disclosure || null }
  if (!rows.length) return { text: lines.join('\n'), facts }
  return { text: lines.join('\n'), facts,
    table: { columns: [{ key: 'day', label: 'Disclosed' }, { key: 'member', label: 'Member' }, { key: 'trade', label: 'Trade' }, { key: 'amount', label: 'Amount' }],
      rows: rows.map(r => ({ day: shortDay(r.disclosure_date) || 'n/a', member: str(r.member) || 'n/a', trade: `${SIDE_WORDS[r.side] || 'reported'} ${str(r.symbol) || 'n/a'}`, amount: str(r.amount) || 'n/a' })) } }
}

export async function answerCongress(args = {}) {
  const sym = args.symbol === null || args.symbol === undefined || args.symbol === '' ? null : tickerOf(args.symbol)
  if (args.symbol && !sym) return askStock('congressional trades', CONGRESS_NONE)
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the congressional trades: ${NO_TURN}.` }
  const envl = await readData('congress.trades', { symbol: sym, rows: clamp(args.rows, CONGRESS_MAX_ROWS, CONGRESS_DEFAULT_ROWS) }, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromCongress(envl)
}

// ── stock.dealsMarket ← market.deals ─────────────────────────────────────────────────────────────────────────────────
export const DEALS_RECORD = 'A record of announcements, not advice.'
const DEALS_NONE = 'No deal and no index change is stated. That is not the same as none.'
export const PART_WORDS = Object.freeze({ mergers: 'mergers', deals: 'mergers', 'm&a': 'mergers', acquisitions: 'mergers', index: 'index_changes', index_changes: 'index_changes', 'index changes': 'index_changes' })
export const DEAL_INDEX_WORDS = Object.freeze({ 's&p 500': 'sp500', 's&p': 'sp500', sp500: 'sp500', 'nasdaq 100': 'nasdaq100', nasdaq100: 'nasdaq100', nasdaq: 'nasdaq100', dow: 'dow', 'dow 30': 'dow', 'dow jones': 'dow' })
const party = (p) => (p ? `${str(p.name) || 'a company it does not name'}${str(p.sym) ? ` (${p.sym})` : ''}` : 'no company named')

/** Pure: a `market.deals` envelope → the answer. */
export function answerFromDeals(envl) {
  const what = 'the market\'s latest deals and index changes'
  if (!usable(envl)) return { text: noRead(what, envl, 'they are not held on the server yet (this answer never builds them), or the read failed. Open MNA or IDXC in UCT, then ask again', DEALS_NONE) }
  const d = envl.data
  const mg = d.mergers === null ? null : obj(d.mergers)
  const ic = d.index_changes === null ? null : obj(d.index_changes)
  if ((d.mergers !== null && !mg) || (d.index_changes !== null && !ic)) return unclean(what, DEALS_NONE)
  const lines = []
  const rows = []
  if (mg) {
    if (mg.state !== 'held') lines.push('The latest deals are not held on the server yet (this answer never builds them): open MNA in UCT, then ask again.')
    else {
      lines.push(`The latest announced mergers and acquisitions, newest first${mg.read_at ? ` (UCT read them at ${at(mg.read_at, envl.fetched_at)})` : ''}:`)
      for (const r of list(mg.rows).slice(0, TEXT_ROWS)) lines.push(`• ${shortDay(r.date)}: ${party(r.acquirer)} and ${party(r.target)}`)
      if (list(mg.rows).length > TEXT_ROWS) lines.push(more(list(mg.rows).length - TEXT_ROWS))
      if (mg.cut) lines.push(`${count(mg.total)} deals are held and the newest ${count(mg.count)} are in this answer.`)
      if (mg.feed_cut) lines.push('Older announced deals exist than UCT holds.')
      for (const r of list(mg.rows)) rows.push({ kind: 'Deal', day: shortDay(r.date) || 'n/a', what: `${party(r.acquirer)} and ${party(r.target)}` })
    }
  }
  if (ic) {
    if (ic.state !== 'held') lines.push('The index changes are not held on the server yet (this answer never builds them): open IDXC in UCT, then ask again.')
    else {
      lines.push(`Index additions and removals, newest first${ic.read_at ? ` (UCT read them at ${at(ic.read_at, envl.fetched_at)})` : ''}:`)
      for (const r of list(ic.rows).slice(0, TEXT_ROWS)) lines.push(`• ${shortDay(r.date)}, ${r.index_name}: ${r.added ? `${party(r.added)} added` : 'no addition named'}${r.removed ? `, ${party(r.removed)} removed` : ''}`)
      if (list(ic.rows).length > TEXT_ROWS) lines.push(more(list(ic.rows).length - TEXT_ROWS))
      if (ic.cut) lines.push(`${count(ic.total)} index changes are held and the newest ${count(ic.count)} are in this answer: the list is cut from the old end.`)
      for (const r of list(ic.rows)) rows.push({ kind: 'Index change', day: shortDay(r.date) || 'n/a', what: `${r.index_name}: ${r.added ? `${party(r.added)} added` : ''}${r.added && r.removed ? ', ' : ''}${r.removed ? `${party(r.removed)} removed` : ''}` })
    }
  }
  lines.push(DEALS_RECORD)
  const facts = { deals: mg?.state === 'held' ? list(mg.rows).length : null, index_changes: ic?.state === 'held' ? list(ic.rows).length : null }
  if (!rows.length) return { text: lines.join('\n'), facts }
  return { text: lines.join('\n'), facts, table: { columns: [{ key: 'kind', label: 'Kind' }, { key: 'day', label: 'Day' }, { key: 'what', label: 'What' }], rows } }
}

export async function answerDeals(args = {}) {
  const rawPart = str(args.part)
  const part = rawPart ? PART_WORDS[rawPart.toLowerCase()] || null : null
  const rawIndex = str(args.index)
  const index = rawIndex ? DEAL_INDEX_WORDS[rawIndex.toLowerCase()] || null : null
  if (rawIndex && !index) return { text: `Which index should I read: the S&P 500, the Nasdaq 100 or the Dow 30? ${DEALS_NONE}` }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the market's deals: ${NO_TURN}.` }
  const envl = await readData('market.deals', { part, index, rows: clamp(args.rows, DEALS_MAX_ROWS, DEALS_DEFAULT_ROWS) }, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromDeals(envl)
}

// ── stock.setupStudy ← market.setupStudy ─────────────────────────────────────────────────────────────────────────────
export const STUDY_RECORD = `A record of what followed each setup across UCT's stock universe, ${NOT_ADVICE}.`
const STUDY_NONE = 'No setup result is stated. That is not the same as no record.'
export const STUDY_PHASE_WORDS = Object.freeze({ correction: 'correction', corrections: 'correction', 'after the low': 'after_low', after_low: 'after_low', uptrend: 'uptrend', rally: 'uptrend', all: 'all' })
const PHASE_TEXT = { correction: 'in corrections', after_low: 'in the months after a low', uptrend: 'later in an uptrend', all: 'in all phases' }

/** Pure: a `market.setupStudy` envelope → the answer. */
export function answerFromStudy(envl) {
  const what = 'how setups acted across the market'
  if (!usable(envl)) return { text: noRead(what, envl, 'the study is not held on the server yet (it is built once a week, and this answer never builds it), or the read failed. Open SETH in UCT, then ask again', STUDY_NONE) }
  const d = envl.data
  if (!Array.isArray(d.setups)) return unclean(what, STUDY_NONE)
  const lines = [`How each setup acted across UCT's stock universe, from prices through ${shortDay(d.data_through) || 'a day it does not give'}, the 20-day result first:`]
  const rows = []
  for (const s of list(d.setups)) {
    if (s.state === 'capped') { lines.push(`• ${s.name}: no figures (it fired too often for the study to store).`); continue }
    const parts = list(s.groups).map(g => {
      const h = obj(obj(g.horizons)?.['20']) || {}
      if (h.below_floor) return `${PHASE_TEXT[g.phase]} too few signals (${count(int(h.n) ?? 0)})`
      return `${PHASE_TEXT[g.phase]} ${num(h.win_rate) !== null ? `${h.win_rate}% up` : 'n/a'}, average ${pctText(h.avg_pct) || 'n/a'} (the baseline ${pctText(h.baseline_avg_pct) || 'n/a'})`
    })
    lines.push(`• ${s.name}: ${parts.join('; ') || 'no phase held'}`)
    for (const g of list(s.groups)) for (const [hz, h] of Object.entries(obj(g.horizons) || {})) {
      rows.push({ setup: s.name, phase: PHASE_TEXT[g.phase] || g.phase, days: hz, result: h.below_floor ? `too few signals (${int(h.n) ?? 0})` : `${num(h.win_rate) ?? 'n/a'}% up, average ${pctText(h.avg_pct) || 'n/a'}` })
    }
  }
  lines.push('The market phase is assigned with hindsight: a correction is known to be one only after the fact.')
  lines.push(STUDY_RECORD)
  const facts = { setups: list(d.setups).length, data_through: d.data_through || null, built_at: d.built_at || null }
  if (!rows.length) return { text: lines.join('\n'), facts }
  return { text: lines.join('\n'), facts, table: { columns: [{ key: 'setup', label: 'Setup' }, { key: 'phase', label: 'Phase' }, { key: 'days', label: 'Days' }, { key: 'result', label: 'Result' }], rows } }
}

export async function answerStudy(args = {}) {
  const raw = str(args.phase)
  const phase = raw ? STUDY_PHASE_WORDS[raw.toLowerCase()] || null : null
  if (raw && !phase) return { text: `Which phase should I read: corrections, the months after a low, an uptrend, or all? ${STUDY_NONE}` }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read how setups acted: ${NO_TURN}.` }
  const envl = await readData('market.setupStudy', { phase }, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromStudy(envl)
}

// ── stock.periodChange ← market.periodChange ─────────────────────────────────────────────────────────────────────────
export const PERIOD_RECORD = `A record of what the closes did, ${NOT_ADVICE}.`
const PERIOD_NONE = 'No change is stated. That is not the same as no change.'
const ISO = /^\d{4}-\d{2}-\d{2}$/
const realDay = (v) => { const s = str(v); if (!s || !ISO.test(s)) return null; const t = new Date(`${s}T12:00:00Z`); return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== s ? null : s }

/** Pure: a `market.periodChange` envelope → the answer. */
export function answerFromPeriod(envl) {
  const what = 'the change between those dates'
  if (!usable(envl)) return { text: noRead(what, envl, 'no ranking for those dates is held on the server (this answer never builds one; it may be being worked out), or the read failed. Open PCHG with those dates in UCT, then ask again', PERIOD_NONE) }
  const d = envl.data
  if (!Array.isArray(d.rows)) return unclean(what, PERIOD_NONE)
  const rows = list(d.rows)
  const lines = [`The biggest ${d.side === 'losers' ? 'losers' : 'gainers'} from the close of ${shortDay(d.start_day || d.start)} to the close of ${shortDay(d.end_day || d.end)}, as UCT ranked every US common stock${d.built_at ? ` (built ${at(d.built_at, envl.fetched_at)}, UCT's own time)` : ''}:`]
  for (const r of rows.slice(0, TEXT_ROWS)) lines.push(`• ${r.sym}: ${pctText(r.period_change, 2) || 'n/a'}${num(r.start_close) !== null && num(r.end_close) !== null ? ` (${money(r.start_close)} to ${money(r.end_close)})` : ''}${str(r.sector) ? `, ${r.sector}` : ''}`)
  if (rows.length > TEXT_ROWS) lines.push(more(rows.length - TEXT_ROWS))
  if (d.cut) lines.push(`${count(d.total)} stocks are ranked and the ${count(d.count)} biggest ${d.side === 'losers' ? 'losers' : 'gainers'} are in this answer.`)
  if (envl.stale) lines.push('This is the last good ranking UCT built for these dates, so its prices may be behind.')
  if (d.partial) lines.push('One of the dates is older than the whole-market history, so stocks that no longer trade may be missing.')
  lines.push(PERIOD_RECORD)
  const facts = { start: d.start_day || d.start || null, end: d.end_day || d.end || null, side: d.side || null, ranked: int(d.total) }
  return { text: lines.join('\n'), facts,
    table: { columns: [{ key: 'symbol', label: 'Symbol' }, { key: 'change', label: 'Change' }, { key: 'closes', label: 'Closes' }, { key: 'sector', label: 'Sector' }],
      rows: rows.map(r => ({ symbol: r.sym, change: pctText(r.period_change, 2) || 'n/a', closes: num(r.start_close) !== null ? `${money(r.start_close)} to ${money(r.end_close) || 'n/a'}` : 'n/a', sector: str(r.sector) || 'n/a' })) } }
}

export async function answerPeriod(args = {}) {
  const start = realDay(args.start)
  const end = realDay(args.end)
  if (!start || !end || start >= end) return { text: `Which two dates should I compare? Give me a start and an end day, the start first. ${PERIOD_NONE}` }
  const side = str(args.side) && /^(?:losers|worst|decliners|laggards)$/i.test(args.side.trim()) ? 'losers' : 'gainers'
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the change between those dates: ${NO_TURN}.` }
  const envl = await readData('market.periodChange', { start, end, side, rows: clamp(args.rows, PERIOD_MAX_ROWS, PERIOD_DEFAULT_ROWS) }, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromPeriod(envl)
}

// ── routing words: each capability's own, armed on its existing group only while it is registered ────────────────────
// Each pattern is kept off another capability's own language:
//   straddle  a straddle's history or price by session, implied against actual moves, options history. Never the earnings
//             expected move (wave 2), never IV history or IV rank (wave 7);
//   maxPain   max pain, the options positioning levels. Never the gamma walls (wave 3's), never dealer positioning (COT);
//   filings   SEC or EDGAR filings, the filings feed, the latest 8-Ks / 10-Qs / 10-Ks. Never dilution or share issuance (wave
//             7), never the funds that hold a stock (wave 10), never insider buying (wave 13);
//   congress  congressional, Senate or House members' trades and disclosures;
//   deals     the market's latest mergers, acquisitions and takeovers, index additions and removals. Never one stock's
//             (wave 12's `company.deals`, a ticker at the end);
//   study     how setups or breakouts acted across the market or in corrections, setup statistics. Never one stock's setup
//             history (wave 10);
//   period    the biggest gainers or losers between two named dates. Never a fixed lookback (wave 1's long-run leaders);
//   not ours  a screen or its condition, an alert, a watchlist, a page or a panel, or what a term MEANS (the guide).
// ⛔ no lookbehind (iOS 16 floor, src/noRegexLookbehind.test.js).
const NOT_A_SCREEN = '^(?!.*\\b(?:scans?|screens?|screener|filters?|find|alerts?|notify|widgets?|page|tab|panel|watchlists?|my|portfolio|positions?)\\b)'
const NOT_A_MEANING = '(?!.*\\b(?:explain|define|definition|meaning|means?|difference between|calculated|how (?:is|are|do|does) .* (?:work|works))\\b)'
  + '(?!what(?:\'s|’s| is| are) (?:an? |the )?(?:max pain|a straddle|straddles?|an? 8-?k|10-?q|10-?k|sec filings?|congressional trades|index changes|m&a)\\W*$)'
const OURS = `${NOT_A_SCREEN}${NOT_A_MEANING}`
const NOT_ONE_STOCK = '(?!.*\\b(?:for|of|on|in|at|by|involving|with) \\$?[a-z]{1,5}(?:\'s|’s)?\\s*$)'
const NOT_SEARCH = '(?!.*\\b(?:search|searches|searching|mentions?|text)\\b)'   // FSRC's full-text search is not this answer
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?'
const DATE = `(?:\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?|${MONTH} \\d{1,2}(?:st|nd|rd|th)?(?:,? \\d{4})?)`
export const WAVE14_ROUTE_WORDS = Object.freeze({
  straddle: [
    new RegExp(`${OURS}.*\\bstraddles? (?:history|by (?:day|session))\\b|^${OURS.slice(1)}.*\\bhistor(?:y|ical) (?:of )?(?:the )?straddles?\\b`),
    new RegExp(`${OURS}.*\\bimplied (?:move )?(?:vs\\.?|versus|against|compared to) (?:the )?(?:actual|realized) (?:daily )?moves?\\b`),
    new RegExp(`${OURS}.*\\boptions history\\b`),
  ],
  maxPain: [
    new RegExp(`${OURS}.*\\bmax(?:imum)? pain\\b`),
    new RegExp(`${OURS}.*\\boptions positioning(?: levels)?\\b`),
  ],
  filings: [
    new RegExp(`${OURS}${NOT_SEARCH}.*\\b(?:sec|edgar) filings?\\b`),
    new RegExp(`${OURS}${NOT_SEARCH}.*\\bfilings feed\\b|^${OURS.slice(1)}${NOT_SEARCH}.*\\b(?:latest|recent|new|newest) (?:8-?ks?|10-?qs?|10-?ks?|s-1s?)\\b`),
  ],
  congress: [
    new RegExp(`${OURS}.*\\bcongress(?:ional)? (?:trades?|trading|stock trades?|disclosures?|buys|buying|purchases)\\b`),
    new RegExp(`${OURS}.*\\b(?:senators?|senate|house members?|politicians?|members of congress|congressmen|congresswomen)(?:'s|’s)? (?:trades?|trading|stock trades?|buys|buying|selling|purchases)\\b`),
    new RegExp(`${OURS}.*\\bstock act (?:disclosures?|filings?|trades?|reports?)\\b`),
  ],
  deals: [
    new RegExp(`${OURS}${NOT_ONE_STOCK}.*\\b(?:latest|recent|new|newest|this week's|today's) (?:mergers?|acquisitions?|m&a|deals|takeovers?|buyouts?)\\b`),
    new RegExp(`${OURS}${NOT_ONE_STOCK}.*\\bm&a (?:deals|activity|news|announcements)\\b`),
    new RegExp(`${OURS}${NOT_ONE_STOCK}.*\\bindex (?:additions|removals|rebalances?|reconstitutions?|adds and deletes)\\b|^${OURS.slice(1)}${NOT_ONE_STOCK}.*\\b(?:latest|recent|newest) index changes\\b`),
  ],
  study: [
    new RegExp(`${OURS}${NOT_ONE_STOCK}.*\\bhow (?:do|did|does|have) (?:setups|breakouts|pullbacks|gap ups|pocket pivots|tight weeks) (?:act|acted|done|do|perform|performed|work|worked)\\b`),
    new RegExp(`${OURS}${NOT_ONE_STOCK}.*\\bsetup (?:study|statistics|stats|win rates?|results)\\b`),
    new RegExp(`${OURS}${NOT_ONE_STOCK}.*\\b(?:setups|breakouts|pullbacks) (?:in|during) (?:a |the )?(?:corrections?|bear markets?|uptrends?|rallies)\\b`),
  ],
  period: [
    new RegExp(`${OURS}.*\\b(?:gainers|losers|best|worst|top|biggest|leaders|laggards|performers|movers)\\b.*\\b(?:between|from) ${DATE} (?:and|to|through|until|-) ${DATE}\\b`),
    new RegExp(`${OURS}.*\\b(?:between|from) ${DATE} (?:and|to|through|until|-) ${DATE}\\b.*\\b(?:gainers|losers|best|worst|top|biggest|leaders|laggards|performers|movers)\\b`),
  ],
})
/** Adds (or takes back) ONE capability's words on its own existing group. */
function armRoutes(key, on) {
  const g = GROUPS.find(x => x.id === ROUTE_GROUPS[key])
  if (!g) return
  for (const re of WAVE14_ROUTE_WORDS[key]) {
    const i = g.words.indexOf(re)
    if (on && i < 0) g.words.push(re)
    if (!on && i >= 0) g.words.splice(i, 1)
  }
}

// ── registration: each capability only while the server serves ITS kind ───────────────────────────────────────────────
// ⚠️ THE WORDS OF A NAME, A SUMMARY AND ITS HINTS JOIN THE TYPO LEXICON (nl/lexicon.js: every lowercase word of three letters
// or more; a word in CAPITALS does not), so the text below is written in CAPITALS except the pinned name words
// (agentTerminalDataWave14.test.js, "the typo lexicon"). No argument carries an enum.
const TARGET_HINT = 'target = the ref of the stockData entry.'
const NO_FIGURES = 'reply: one short line, no figures.'
const HELD_ONLY = 'Answered only from what the SERVER already HOLDS, so it may say none is held.'
const nullStr = { type: ['string', 'null'] }
const nullInt = { type: ['integer', 'null'] }
const COMMON = Object.freeze({ surfaces: ['*'], target: 'market', query: true })
const SPECS = {
  straddle: () => registerCapability({ ...COMMON,
    name: 'stock.straddleHistory',        // a LITERAL: the server's local-only mirror rail reads it (tests/test_uct_agent_breadth.py)
    localOnly: true,                    // ⛔ a model-isolated kind: the member sees the card, a model never sees a value
    summary: 'ONE STOCK\'s OPTIONS HISTORY as UCT\'s OPTIONS LOG HOLDS it: the FRONT AT-THE-MONEY STRADDLE at EACH LOGGED SESSION (DOLLARS and PERCENT of the STOCK) and EACH SESSION\'s IMPLIED ONE-DAY MOVE AGAINST the MOVE that FOLLOWED. '
      + 'For "STRADDLE HISTORY", "IMPLIED VS ACTUAL MOVES".',
    hints: `${TARGET_HINT} SYMBOL = ONE TICKER. ROWS 1-${STRADDLE_MAX_ROWS} SESSIONS (null = ${STRADDLE_DEFAULT_ROWS}). The date is the LOGGED SESSION: never today. A RECORD, not ADVICE. ${HELD_ONLY} `
      + `The EARNINGS EXPECTED MOVE and IV HISTORY are not this answer. ${NO_FIGURES}`,
    args: { type: 'object', properties: { symbol: { type: 'string' }, rows: nullInt }, required: ['symbol', 'rows'], additionalProperties: false },
    answer: (_snap, args) => answerStraddle(args || {}),
  }),
  maxPain: () => registerCapability({ ...COMMON,
    name: 'stock.optionsPositioning',                // a LITERAL: the server's local-only mirror rail reads it
    localOnly: true,                    // ⛔ a model-isolated kind: the member sees the card, a model never sees a value
    summary: 'ONE STOCK\'s MAX PAIN PER EXPIRATION and its OPTIONS POSITIONING LEVELS (CALL WALL, PUT WALL, ZERO GAMMA, the ABSOLUTE GAMMA and KEY DELTA STRIKES, IMPLIED MOVES) as UCT WORKED them OUT from an OPTION CHAIN. '
      + 'For "MAX PAIN", "OPTIONS POSITIONING".',
    hints: `${TARGET_HINT} SYMBOL = ONE TICKER. WINDOW = 0dte, 1dte, WEEK, MONTH or ALL (null = MONTH). The date is when UCT WORKED it OUT: never today. Not ADVICE. ${HELD_ONLY} `
      + `The GAMMA WALLS ALONE are not this answer. ${NO_FIGURES}`,
    args: { type: 'object', properties: { symbol: { type: 'string' }, window: nullStr }, required: ['symbol', 'window'], additionalProperties: false },
    answer: (_snap, args) => answerPositioning(args || {}),
  }),
  filings: () => registerCapability({ ...COMMON,
    name: 'stock.edgarFeed',             // a LITERAL: the server's local-only mirror rail reads it
    localOnly: true,                    // ⛔ a model-isolated kind: the member sees the card, a model never sees a value
    summary: 'NEW SEC FILINGS as UCT HOLDS them from EDGAR: the NEWEST ACROSS the MARKET (no SYMBOL) or ONE COMPANY\'s RECENT 8-K (with ITEM CODES), 10-Q, 10-K, FORM 4, 13D/G and S-1 FILINGS, EACH with its FILING DAY and SEC PAGE. '
      + 'For "SEC FILINGS", "the LATEST 8-K".',
    hints: `${TARGET_HINT} SYMBOL = ONE TICKER or null for the MARKET. FORM = 8-K, 10-Q, 10-K, 4, 13D, 13G, S-1 or null. ROWS 1-${FILINGS_MAX_ROWS} (null = ${FILINGS_DEFAULT_ROWS}). EACH FILING HAS its OWN DAY: never today. ${HELD_ONLY} `
      + `DILUTION FILINGS and the FUNDS HOLDING a STOCK are not this answer. ${NO_FIGURES}`,
    args: { type: 'object', properties: { symbol: nullStr, form: nullStr, rows: nullInt }, required: ['symbol', 'form', 'rows'], additionalProperties: false },
    answer: (_snap, args) => answerFilings(args || {}),
  }),
  congress: () => registerCapability({ ...COMMON,
    name: 'stock.congressTrades',         // a LITERAL: the server's local-only mirror rail reads it
    localOnly: true,                    // ⛔ a model-isolated kind: the member sees the card, a model never sees a value
    summary: 'CONGRESSIONAL TRADE DISCLOSURES as UCT HOLDS them: the NEWEST ACROSS EVERY SYMBOL (no SYMBOL) or BOTH CHAMBERS\' DISCLOSURES for ONE STOCK, EACH with the MEMBER, the SIDE, the DISCLOSED AMOUNT RANGE, the TRADE DAY and the DISCLOSURE DAY. '
      + 'For "CONGRESSIONAL TRADES", "what are SENATORS BUYING".',
    hints: `${TARGET_HINT} SYMBOL = ONE TICKER or null. ROWS 1-${CONGRESS_MAX_ROWS} (null = ${CONGRESS_DEFAULT_ROWS}). EACH ROW HAS its OWN DAYS: never today. A RECORD, not ADVICE. ${HELD_ONLY} `
      + `INSIDER BUYING is not this answer. ${NO_FIGURES}`,
    args: { type: 'object', properties: { symbol: nullStr, rows: nullInt }, required: ['symbol', 'rows'], additionalProperties: false },
    answer: (_snap, args) => answerCongress(args || {}),
  }),
  deals: () => registerCapability({ ...COMMON,
    name: 'stock.dealsMarket',            // a LITERAL: the server's local-only mirror rail reads it
    localOnly: true,                    // ⛔ a model-isolated kind: the member sees the card, a model never sees a value
    summary: 'The MARKET\'s LATEST DEALS and INDEX CHANGES as UCT HOLDS them: the LATEST ANNOUNCED MERGERS and ACQUISITIONS ACROSS the MARKET with their SEC FILINGS, and the ADDITIONS to and REMOVALS from the S&P 500, the NASDAQ 100 and the DOW 30. '
      + 'For "the LATEST MERGERS", "INDEX ADDITIONS".',
    hints: `${TARGET_HINT} No SYMBOL. PART = MERGERS, INDEX CHANGES or null for BOTH. INDEX = S&P 500, NASDAQ 100, DOW or null. ROWS 1-${DEALS_MAX_ROWS} (null = ${DEALS_DEFAULT_ROWS}). EACH ROW HAS its OWN DAY: never today. ${HELD_ONLY} `
      + `ONE STOCK\'s DEALS are not this answer. ${NO_FIGURES}`,
    args: { type: 'object', properties: { part: nullStr, index: nullStr, rows: nullInt }, required: ['part', 'index', 'rows'], additionalProperties: false },
    answer: (_snap, args) => answerDeals(args || {}),
  }),
  study: () => registerCapability({ ...COMMON,
    name: 'stock.setupStudy',             // a LITERAL: the server's local-only mirror rail reads it
    localOnly: true,                    // ⛔ a model-isolated kind: the member sees the card, a model never sees a value
    summary: 'HOW CHART SETUPS ACTED ACROSS UCT\'s STOCK UNIVERSE (the SETH STUDY): for EACH SETUP (BREAKOUTS, PULLBACKS, GAPS, POCKET PIVOTS...) in EACH PHASE of the S&P 500, the SIGNALS, WIN RATE and AVERAGE MOVE at 5, 20 and 60 DAYS BESIDE the BASELINE. '
      + 'For "HOW do BREAKOUTS do in CORRECTIONS", "SETUP STATISTICS".',
    hints: `${TARGET_HINT} No SYMBOL. PHASE = CORRECTION, AFTER the LOW, UPTREND, ALL or null. The date is the STUDY's LAST SESSION: never today. A RECORD, not a FORECAST. ${HELD_ONLY} `
      + `ONE STOCK\'s SETUP HISTORY is not this answer. ${NO_FIGURES}`,
    args: { type: 'object', properties: { phase: nullStr }, required: ['phase'], additionalProperties: false },
    answer: (_snap, args) => answerStudy(args || {}),
  }),
  period: () => registerCapability({ ...COMMON,
    name: 'stock.periodChange',           // a LITERAL: the server's local-only mirror rail reads it
    localOnly: true,                    // ⛔ a model-isolated kind: the member sees the card, a model never sees a value
    summary: 'EVERY US STOCK\'s CHANGE BETWEEN TWO DATES as UCT RANKED it (the PCHG RANKING): the BIGGEST GAINERS or LOSERS with their CLOSES, SECTOR and INDUSTRY. '
      + 'For "the TOP GAINERS BETWEEN TWO DATES".',
    hints: `${TARGET_HINT} START and END = YYYY-MM-DD, START FIRST. SIDE = GAINERS or LOSERS (null = GAINERS). ROWS 1-${PERIOD_MAX_ROWS} (null = ${PERIOD_DEFAULT_ROWS}). The dates are the TWO CLOSES: never today. A RECORD, not a FORECAST. ${HELD_ONLY} `
      + `A FIXED LOOKBACK is not this answer. ${NO_FIGURES}`,
    args: { type: 'object', properties: { start: { type: 'string' }, end: { type: 'string' }, side: nullStr, rows: nullInt }, required: ['start', 'end', 'side', 'rows'], additionalProperties: false },
    answer: (_snap, args) => answerPeriod(args || {}),
  }),
}
const unregister = {}

/** Idempotent; registers each of the seven ONLY while the server serves its kind. Returns the names registered by this call. */
export function registerTerminalWave14Capabilities() {
  const added = []
  for (const key of Object.keys(KINDS)) {
    if (unregister[key] || !kindServed(KINDS[key])) continue
    unregister[key] = SPECS[key]()
    armRoutes(key, true)
    added.push(CAPABILITIES[key])
  }
  return added
}
export const _resetTerminalWave14ForTest = () => {
  for (const k of Object.keys(unregister)) { unregister[k]?.(); delete unregister[k] }
  for (const k of Object.keys(WAVE14_ROUTE_WORDS)) armRoutes(k, false)
}
