// Terminal data wave 8 — three LOCAL-ONLY capabilities over three model-isolated data kinds (MD-1 §4.17):
//   stock.splitsDividends   stock.corporateActions  one stock's splits and cash dividends, as UCT holds them beside its chart (CACT)
//   stock.ipoCalendar       calendar.ipos           the IPO calendar for the IPO panel's window, as UCT holds it (IPO)
//   stock.dividendsCalendar calendar.dividends      dividends and splits declared ahead for the stocks named, as UCT holds them (DVD)
//
// Each answer is built in the browser from ONE read of its own kind and shown to the MEMBER ONLY: every capability is
// `localOnly` (its name is in turn.LOCAL_ONLY_ACTIONS on the server), every kind is model-isolated, and nothing the read
// returns reaches a model provider. All three were isolated as the builder's default, from the licensing register's rows
// (quoted in each adapter and in MD-1 §4.17); nobody decided otherwise and nobody was asked.
//
// What every answer keeps to:
//   • the date is the DATA'S OWN (the newest event in the corporate actions record), or, where the data has none (the two
//     forward calendars), that is said and the time UCT read the data is given beside it. Never the time of the ask;
//   • a number that does not exist is never 0: a split ratio the record cannot state, a deal's price, shares or value the
//     calendars leave empty, a dividend's amount not declared;
//   • a list that is cut says so, and from which end;
//   • nothing held and a read that failed are never said as "no splits", "no IPOs" or "no dividend": a stock with nothing
//     held is named, and an empty block of a held record is "what the record lists", never proof of none;
//   • an envelope's notes are never echoed;
//   • the vendors are not named (the Corporate actions panel and the IPO panel name them; an answer says "its market-data
//     vendor" and "two vendors' calendars");
//   • what the kind leaves out (the name and ticker record) is said, with the panel that reads it.
//
// Dark by construction: each is registered only while the server serves its own kind (UCT_AGENT_DATA_KINDS, fail closed; an
// isolated kind also needs its own UCT_AGENT_ISOLATED_KINDS entry or every read is refused). Nothing here arms anything.
// ROUTING: the three share ONE words-only group of their own, `marketCalendars` (routing.js lists them by action). It is the
// 50th group of the 56 the server keeps (turn.MAX_GROUPS). Each capability's own words (WAVE8_ROUTE_WORDS) are added to that
// group only while it is registered, so on a dark server the group has no words and no registered action, and routing is
// byte-identical to the base.
import { registerCapability } from '../capabilities'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { GROUPS } from '../routing'
import { stampET } from './marketDataFacts'
import { amountWords, splitWords } from '../../pages/terminal/panels/corporateActionsModel'
import { priceWords, statusWords, NOT_GIVEN } from '../../pages/terminal/panels/ipoCalendarModel'
import { kindServed, usable, noRead, whole, plural, andList, dayText, NO_TURN } from './terminalDataFormat'
import { formatCompact } from '../../lib/presentation/presentationPrimitives'

export const KINDS = Object.freeze({ actions: 'stock.corporateActions', ipos: 'calendar.ipos', dividends: 'calendar.dividends' })
export const CAPABILITIES = Object.freeze({ actions: 'stock.splitsDividends', ipos: 'stock.ipoCalendar', dividends: 'stock.dividendsCalendar' })
const NOTHING = 'Nothing is stated.'
const TEXT_ROWS = 5
const PRESENT_ROWS = 12
export const NOT_ADVICE = 'not a forecast and not advice'
const TICKER = /^[A-Z]{1,5}(?:[.-][A-Z]{1,2})?$/
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const upper = (s) => String(s || '').trim().toUpperCase().replace(/^\$/, '')
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
/** a class share the way UCT writes it (BRK.B -> BRK-B), as waves 6 and 7 */
const house = (s) => upper(s).replace('.', '-')

// ── stock.splitsDividends ──────────────────────────────────────────────────────────────────────────────────────────────
export const ACTIONS_DEFAULT_ROWS = 12
export const ACTIONS_MAX_ROWS = 60
export const ACTIONS_RECORD = `A record, ${NOT_ADVICE}.`
export const ACTIONS_SOURCE = `Source: UCT's record beside the stock's chart, from its market-data vendor's reference data. ${ACTIONS_RECORD}`
const ACTIONS_NONE = 'No split or dividend is stated. That is not the same as none.'
export const ACTIONS_NOT_PROOF = 'the record does not say whether every read behind it answered, so that is not proof that none happened'

/** Pure: a `stock.corporateActions` envelope → the answer. */
export function answerFromActions(envl, symbol) {
  const what = `${symbol}'s splits and dividends`
  if (!usable(envl)) {
    return { text: noRead(what, envl, 'none are held for it on the server (they are held once its chart has been opened in UCT, and this answer never asks the vendor), or the read failed. Open the stock\'s chart in UCT, then ask again', ACTIONS_NONE) }
  }
  const d = envl.data
  const sp = obj(d.splits)
  const dv = obj(d.dividends)
  if (!sp || !dv || !Array.isArray(sp.rows) || !Array.isArray(dv.rows)) return unclean(what, ACTIONS_NONE)
  const splits = list(sp.rows).filter(r => isoDay(r.date)).map(r => ({ date: r.date, ratio: str(r.ratio), to_factor: positive(r.to_factor) }))   // no ratio: null, never 0
  const dividends = list(dv.rows).filter(r => isoDay(r.date)).map(r => ({ date: r.date, amount: positive(r.amount) }))
  const block = (b, rows) => ({ rows, count: rows.length, total: Math.max(int(b.total) ?? 0, rows.length), years: int(b.window_years), as_of: isoDay(b.as_of) })
  const S = block(sp, splits)
  const D = block(dv, dividends)
  const asOf = isoDay(d.as_of)
  const read = stampET(d.read_at, envl.fetched_at)
  const noRatio = splits.filter(r => r.ratio == null).length
  const facts = {
    symbol, splits: { ...S, cut: S.total > S.count }, dividends: { ...D, cut: D.total > D.count, basis: str(dv.basis) }, as_of: asOf, day: dayText(asOf),
    read_at: str(d.read_at), read, stale: !!envl.stale, left_out: Array.isArray(d.left_out) ? d.left_out : [],
  }
  const window = (years) => (years ? `the last ${plural(years, 'year')}` : 'its window')
  const lines = []
  if (!splits.length && !dividends.length) {
    lines.push(`The record UCT holds beside ${symbol}'s chart lists no split in ${window(S.years)} and no cash dividend in ${window(D.years)}: ${ACTIONS_NOT_PROOF}.`)
  } else {
    lines.push(`${symbol}'s splits and cash dividends as UCT holds them beside its chart, newest first:`)
    if (splits.length) {
      lines.push(`Splits in ${window(S.years)}, ${S.total} held:`)
      for (const r of splits.slice(0, TEXT_ROWS)) lines.push(`• ${shortDay(r.date)}: ${r.ratio ? splitWords(r.ratio) : 'ratio not stated'}`)
      if (splits.length > TEXT_ROWS) lines.push(more(splits.length - TEXT_ROWS))
    } else {
      lines.push(`No split is listed in ${window(S.years)} of the record: ${ACTIONS_NOT_PROOF}.`)
    }
    if (dividends.length) {
      lines.push(`Cash dividends by ex-date in ${window(D.years)}, ${D.total} held, per share and split-adjusted (what the chart draws), not the amounts as declared:`)
      for (const r of dividends.slice(0, TEXT_ROWS)) lines.push(`• ${shortDay(r.date)}: ${amountWords(r.amount)}`)
      if (dividends.length > TEXT_ROWS) lines.push(more(dividends.length - TEXT_ROWS))
    } else {
      lines.push(`No cash dividend is listed in ${window(D.years)} of the record: ${ACTIONS_NOT_PROOF}.`)
    }
  }
  if (S.total > S.count) lines.push(`${S.total} splits are held and the newest ${S.count} are in this answer: the list is cut from the old end.`)
  if (D.total > D.count) lines.push(`${D.total} cash dividends are held and the newest ${D.count} are in this answer: the list is cut from the old end.`)
  if (noRatio) lines.push(`${plural(noRatio, 'split')} ${noRatio === 1 ? 'has' : 'have'} no ratio the record can state: it is not stated, and that is not a ratio of 0.`)
  lines.push('The company\'s name and ticker record (its former tickers) is not in this answer: the Corporate actions panel (CACT) in UCT reads it separately.')
  if (asOf) lines.push(`The newest event in the record is ${dayText(asOf)}: the record's own date, never the time of this answer.`)
  lines.push(read ? `UCT read the record from its vendor at ${read} (UCT's own time).` : 'The record carries no time UCT read it, so I cannot say how old it is.')
  if (envl.stale && read) lines.push('Stale: the record is older than the chart refreshes it, so a newer split or dividend may not be in it. This answer never refreshes it: opening the stock\'s chart in UCT does.')
  lines.push(ACTIONS_SOURCE)
  const rows = [...splits.map(r => ({ kind: 'Split', date: shortDay(r.date), detail: r.ratio ? splitWords(r.ratio) : 'not given' })),
    ...dividends.map(r => ({ kind: 'Cash dividend', date: shortDay(r.date), detail: r.amount == null ? 'not given' : `${amountWords(r.amount)}, split-adjusted` }))]
  if (!rows.length) return { text: lines.join('\n'), facts }
  return {
    text: lines.join('\n'),
    table: { columns: [{ key: 'kind', label: 'Kind' }, { key: 'date', label: 'Date' }, { key: 'detail', label: 'Detail' }], rows },
    present: {
      kind: 'metrics', title: `${symbol} corporate actions`, short: `${symbol} corporate actions`,
      items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: r.date, value: r.detail, note: r.kind, aka: [r.kind.toLowerCase()] })),
    },
    facts,
  }
}

export async function answerActions(args = {}) {
  const symbol = house(args.symbol)
  if (!TICKER.test(symbol)) return { text: `Which stock's splits and dividends should I read? Give me one ticker. ${NOTHING}` }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read ${symbol}'s splits and dividends: ${NO_TURN}.` }
  const params = { symbol, rows: clamp(args.rows, ACTIONS_MAX_ROWS, ACTIONS_DEFAULT_ROWS) }
  const envl = await readData('stock.corporateActions', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromActions(envl, symbol)
}

// ── stock.ipoCalendar ──────────────────────────────────────────────────────────────────────────────────────────────────
export const IPO_DEFAULT_ROWS = 20
export const IPO_MAX_ROWS = 50
export const IPO_RECORD = `A calendar of deals, ${NOT_ADVICE}.`
export const IPO_SOURCE_LINE = `Source: two vendors' IPO calendars, merged by UCT's server. ${IPO_RECORD}`
export const IPO_VALUE_WORDS = 'Value is the dollar value of the shares offered where a calendar gives it; for some deals a calendar gives the company\'s expected market value in its place, and the answer does not say which.'
const IPO_NONE = 'No IPO is stated. That is not the same as no IPOs.'
const lc = (s) => (s === NOT_GIVEN ? 'not given' : s)
// A share count or dollar value: one decimal in millions or billions through the app's own formatter (a value that
// rounds up to the next tier prints there: 999,950,000 is 1.0B), the whole number below a million.
const IPO_TIERS = Object.freeze([{ at: 1e9, suffix: 'B', decimals: 1 }, { at: 1e6, suffix: 'M', decimals: 1 }])
const compact = (v) => (Math.abs(v) >= 1e6 ? formatCompact(v, { tiers: IPO_TIERS }) : whole(v))

/** Pure: a `calendar.ipos` envelope → the answer. */
export function answerFromIpos(envl) {
  const what = 'the IPO calendar'
  if (!usable(envl)) {
    return { text: noRead(what, envl, 'none is held on the server for the window the IPO calendar panel reads (this answer never asks the vendors), both vendors failed when UCT last read them, or the read failed. Open the IPO calendar panel (IPO) in UCT, then ask again', IPO_NONE) }
  }
  const d = envl.data
  const from = isoDay(d.window?.from)
  const to = isoDay(d.window?.to)
  const A = obj(d.ahead)
  const E = obj(d.earlier)
  if (!from || !to || !A || !E || !Array.isArray(A.rows) || !Array.isArray(E.rows)) return unclean(what, IPO_NONE)
  const deal = (r) => ({ symbol: str(r.symbol), name: str(r.name), date: r.date, exchange: str(r.exchange), price_range: str(r.price_range), shares: positive(r.shares), value: positive(r.value), status: str(r.status) })   // left empty: null, never 0
  const ahead = list(A.rows).filter(r => isoDay(r.date) && (str(r.symbol) || str(r.name))).map(deal)
  const earlier = list(E.rows).filter(r => isoDay(r.date) && (str(r.symbol) || str(r.name))).map(deal)
  const aheadTotal = Math.max(int(A.total) ?? 0, ahead.length)
  const earlierTotal = Math.max(int(E.total) ?? 0, earlier.length)
  const read = stampET(d.read_at, envl.fetched_at)
  const gaps = [...ahead, ...earlier].filter(r => r.price_range == null || r.shares == null || r.value == null).length
  const facts = {
    window: { from, to }, ahead: { rows: ahead, count: ahead.length, total: aheadTotal, cut: aheadTotal > ahead.length },
    earlier: { rows: earlier, count: earlier.length, total: earlierTotal, cut: earlierTotal > earlier.length }, total: int(d.total) ?? ahead.length + earlier.length,
    gaps, as_of: null, read_at: str(d.read_at), read,
  }
  const who = (r) => (r.name ? `${r.name}${r.symbol ? ` (${r.symbol})` : ''}` : r.symbol)
  const line = (r) => `• ${shortDay(r.date)}: ${who(r)}${r.exchange ? `, ${r.exchange}` : ''}: ${r.price_range == null ? 'price not given' : priceWords(r.price_range)}, `
    + `${r.shares == null ? 'shares not given' : `${compact(r.shares)} shares`}, ${r.value == null ? 'value not given' : `value $${compact(r.value)}`}, ${lc(statusWords(r.status)).toLowerCase()}`
  const lines = [`The IPO calendar for ${dayText(from)} to ${dayText(to)} as UCT holds it, merged from two vendors' calendars:`]
  if (!ahead.length && !earlier.length) {
    lines.push('No deal is on the calendar for that window in what UCT holds: the vendor calendars that answered list none.')
  } else {
    if (ahead.length) {
      lines.push('Today and ahead, soonest first:')
      for (const r of ahead.slice(0, TEXT_ROWS)) lines.push(line(r))
      if (ahead.length > TEXT_ROWS) lines.push(more(ahead.length - TEXT_ROWS))
    } else {
      lines.push('No deal is on the calendar for today or the days ahead.')
    }
    if (earlier.length) {
      lines.push('Earlier in the window, newest first:')
      for (const r of earlier.slice(0, TEXT_ROWS)) lines.push(line(r))
      if (earlier.length > TEXT_ROWS) lines.push(more(earlier.length - TEXT_ROWS))
    }
    if (aheadTotal > ahead.length) lines.push(`${aheadTotal} deals are on the calendar for today and ahead and the soonest ${ahead.length} are in this answer: the list is cut from the far end.`)
    if (earlierTotal > earlier.length) lines.push(`${earlierTotal} earlier deals are on the calendar and the newest ${earlier.length} are in this answer: the list is cut from the old end.`)
    if (gaps) lines.push(`${plural(gaps, 'deal')} ${gaps === 1 ? 'has' : 'have'} a field the calendars leave empty: it is not stated, and that is not 0.`)
    lines.push(IPO_VALUE_WORDS)
  }
  lines.push(read ? `The calendars give no as-of time of their own. UCT read them at ${read} (UCT's own time), and this answer never asks the vendors.` : 'The calendars give no as-of time of their own, and the answer carries no time UCT read them, so I cannot say how old it is.')
  lines.push('Stocks first traded in the last year are UCT\'s new listings list, not this calendar.')
  lines.push(IPO_SOURCE_LINE)
  const all = [...ahead, ...earlier]
  if (!all.length) return { text: lines.join('\n'), facts }
  return {
    text: lines.join('\n'),
    table: {
      columns: [{ key: 'day', label: 'Day' }, { key: 'company', label: 'Company' }, { key: 'price', label: 'Price' }, { key: 'shares', label: 'Shares' }, { key: 'value', label: 'Value' }, { key: 'status', label: 'Status' }],
      rows: all.map(r => ({ day: shortDay(r.date), company: who(r), price: lc(priceWords(r.price_range)), shares: r.shares == null ? 'not given' : compact(r.shares), value: r.value == null ? 'not given' : `$${compact(r.value)}`, status: lc(statusWords(r.status)) })),
    },
    present: {
      kind: 'metrics', title: 'IPO calendar', short: 'IPO calendar',
      items: all.slice(0, PRESENT_ROWS).map(r => ({ label: shortDay(r.date), value: who(r), note: lc(statusWords(r.status)), aka: r.symbol ? [r.symbol] : [] })),
    },
    facts,
  }
}

export async function answerIpos(args = {}) {
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the IPO calendar: ${NO_TURN}.` }
  const params = { rows: clamp(args.rows, IPO_MAX_ROWS, IPO_DEFAULT_ROWS) }
  const envl = await readData('calendar.ipos', params, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromIpos(envl)
}

// ── stock.dividendsCalendar ─────────────────────────────────────────────────────────────────────────────────────────────
export const DIVIDENDS_MAX_SYMBOLS = 10
export const DIVIDENDS_RECORD = `A calendar of declared events, ${NOT_ADVICE}.`
export const DIVIDENDS_SOURCE_LINE = `Source: UCT's dividend calendar, from its market-data vendor's reference data. ${DIVIDENDS_RECORD}`
export const DIVIDEND_STATES = Object.freeze({ complete: 'held', incomplete: 'held, and the read did not fully answer', not_held: 'not held' })
const DIVIDENDS_NONE = 'No dividend or split is stated. That is not the same as none ahead.'

/** Pure: a `calendar.dividends` envelope → the answer. `symbols` are the stocks asked for. */
export function answerFromDividends(envl, symbols) {
  const named = andList(symbols)
  const what = `the dividend calendar for ${named}`
  if (!usable(envl)) {
    return { text: noRead(what, envl, 'nothing is held on the server for these stocks alone (this answer never asks the vendor), or the read failed. Open the dividend calendar panel (DVD) for each stock in UCT, then ask again', DIVIDENDS_NONE) }
  }
  const d = envl.data
  if (!Array.isArray(d.rows) || !Array.isArray(d.stocks)) return unclean(what, DIVIDENDS_NONE)
  const stocks = list(d.stocks).filter(s => str(s.symbol) && Object.prototype.hasOwnProperty.call(DIVIDEND_STATES, s.state))
    .map(s => ({ symbol: s.symbol, state: s.state, read_at: str(s.read_at), events: int(s.events) }))
  if (!stocks.length || stocks.every(s => s.state === 'not_held')) return unclean(what, DIVIDENDS_NONE)
  const rows = list(d.rows).filter(r => isoDay(r.date) && str(r.symbol) && (r.type === 'dividend' || r.type === 'split'))
    .map(r => ({ symbol: r.symbol, type: r.type, date: r.date, amount: r.type === 'dividend' ? positive(r.amount) : null, ratio: r.type === 'split' ? str(r.ratio) : null }))   // not declared: null, never 0
  const total = Math.max(int(d.total) ?? 0, rows.length)
  const read = stampET(d.read_at, envl.fetched_at)
  const held = stocks.filter(s => s.state !== 'not_held').map(s => s.symbol)
  const notHeld = stocks.filter(s => s.state === 'not_held').map(s => s.symbol)
  const incomplete = stocks.filter(s => s.state === 'incomplete').map(s => s.symbol)
  const none = stocks.filter(s => s.state === 'complete' && s.events === 0).map(s => s.symbol)
  const noAmount = rows.filter(r => r.type === 'dividend' && r.amount == null).length
  const facts = { symbols, stocks, rows, count: rows.length, total, cut: total > rows.length, held, not_held: notHeld, incomplete, none, as_of: null, read_at: str(d.read_at), read, partial: envl.status === 'partial' }
  const event = (r) => (r.type === 'split'
    ? `${r.symbol} splits ${r.ratio ? splitWords(r.ratio) : '(ratio not given)'}`
    : `${r.symbol} goes ex-dividend, ${r.amount == null ? 'amount not declared' : `${amountWords(r.amount)} a share as declared`}`)
  const lines = [`Dividends and splits declared ahead for ${andList(held)}, soonest first, as UCT read them:`]
  if (rows.length) {
    for (const r of rows.slice(0, TEXT_ROWS)) lines.push(`• ${shortDay(r.date)}: ${event(r)}`)
    if (rows.length > TEXT_ROWS) lines.push(more(rows.length - TEXT_ROWS))
  } else {
    lines.push('No event is in this answer.')
  }
  if (total > rows.length) lines.push(`${total} events are held for these stocks and the soonest ${rows.length} are in this answer: the list is cut from the far end.`)
  if (none.length) lines.push(`Nothing is declared ahead for ${andList(none)} in what UCT read.`)
  if (incomplete.length) lines.push(`UCT's last read of ${andList(incomplete)} did not fully answer, so events may be missing there: that is not the same as none.`)
  if (notHeld.length) lines.push(`Nothing is held on the server for ${andList(notHeld)}, so ${notHeld.length === 1 ? 'it is' : 'they are'} not in this answer, which is not the same as nothing ahead. Open the dividend calendar panel (DVD) for ${notHeld.length === 1 ? 'it' : 'each of them'} in UCT, then ask again.`)
  if (noAmount) lines.push(`${plural(noAmount, 'dividend')} ${noAmount === 1 ? 'has' : 'have'} no declared amount: it is not stated, and that is not $0.`)
  lines.push(read ? `A forward calendar has no as-of time of its own. UCT read ${held.length === 1 ? 'this stock\'s calendar' : 'these calendars'} at ${read} (UCT's own time${held.length === 1 ? '' : ', the oldest of them'}), so an event dated before today may have passed since. This answer never asks the vendor.`
    : 'A forward calendar has no as-of time of its own, and the answer carries no time UCT read it, so I cannot say how old it is.')
  lines.push('Past dividends and splits are the Corporate actions panel\'s (CACT). This answer reads only the stocks named, never your own lists.')
  lines.push(DIVIDENDS_SOURCE_LINE)
  if (!rows.length) return { text: lines.join('\n'), facts }
  return {
    text: lines.join('\n'),
    table: {
      columns: [{ key: 'day', label: 'Day' }, { key: 'symbol', label: 'Symbol' }, { key: 'event', label: 'Event' }, { key: 'detail', label: 'Detail' }],
      rows: rows.map(r => ({ day: shortDay(r.date), symbol: r.symbol, event: r.type === 'split' ? 'Split' : 'Ex-dividend', detail: r.type === 'split' ? (r.ratio ? splitWords(r.ratio) : 'not given') : (r.amount == null ? 'not given' : `${amountWords(r.amount)} a share`) })),
    },
    present: {
      kind: 'metrics', title: 'Dividends and splits ahead', short: 'Dividend calendar',
      items: rows.slice(0, PRESENT_ROWS).map(r => ({ label: `${shortDay(r.date)} ${r.symbol}`, value: r.type === 'split' ? 'Split' : 'Ex-dividend', note: r.type === 'split' ? (r.ratio ? splitWords(r.ratio) : 'ratio not given') : (r.amount == null ? 'amount not declared' : `${amountWords(r.amount)} a share`), aka: [r.symbol] })),
    },
    facts,
  }
}

export async function answerDividends(args = {}) {
  const raw = Array.isArray(args.symbols) ? args.symbols : typeof args.symbols === 'string' ? args.symbols.split(/[\s,]+/) : []
  const symbols = [...new Set(raw.map(house).filter(Boolean))]
  if (!symbols.length || symbols.some(s => !TICKER.test(s))) return { text: `Which stocks' dividends and splits ahead should I read? Name one to ${DIVIDENDS_MAX_SYMBOLS} tickers. ${NOTHING}` }
  if (symbols.length > DIVIDENDS_MAX_SYMBOLS) return { text: `I can read the dividends and splits ahead for at most ${DIVIDENDS_MAX_SYMBOLS} stocks at a time: name ${DIVIDENDS_MAX_SYMBOLS} or fewer. ${NOTHING}` }
  const turnId = currentTurnId()
  if (!turnId) return { text: `I couldn't read the dividend calendar for ${andList(symbols)}: ${NO_TURN}.` }
  const envl = await readData('calendar.dividends', { symbols }, { purpose: 'answer', turnId })   // a LITERAL: qa/modelIsolation reads it
  return answerFromDividends(envl, symbols)
}

// ── routing words (armed only while registered; routing.js's `marketCalendars` group lists none) ──────────────────────
// Routing v2 reaches the three by their summaries. v1 (the kill-switch fallback, and the router the capability-regression
// corpus runs) selects a group by its words, and `marketCalendars` is words-only: these words are the only way v1 sends it.
// Routing only ADDS a group (the other groups a message names still ride along), and each pattern is kept off another
// capability's own language:
//   actions    "corporate actions" by name, a stock / share / reverse split, a split's history or ratio, a split asked
//              about in the past ("has X ever split", "when did X last split"), a dividend's history or a past dividend.
//              Never anything ahead (that is the dividend calendar), never the board ("split the screen", a chart's cell),
//              never a chart's split or dividend markers, never a dividend yield, never news of a split;
//   ipos       the IPO calendar by name, upcoming / expected / scheduled IPOs, IPOs this / next / last week, today or
//              tomorrow, IPOs pricing or priced. Never the stocks first traded in the last year (LEAD's new listings:
//              "recent IPOs", "new listings", "IPOs in the last year"), never "since IPO" (a chart's range), never a chart's
//              IPO markers;
//   dividends  an ex-dividend date, the dividend calendar by name, a next / upcoming / declared dividend, dividends this
//              or next week or month, a next / upcoming / announced split. Never a past dividend or split (corporate
//              actions), never a dividend yield, never the member's own lists ("my watchlist's dividends": the kind reads
//              only the stocks named);
//   not ours   a screen or its condition, an alert, a watchlist, the member's own lists, a page or a widget, or what a
//              term MEANS (the guide).
// ⛔ no lookbehind (iOS 16 floor, src/noRegexLookbehind.test.js).
const NOT_A_SCREEN = '^(?!.*\\b(?:scans?|screens?|screener|filters?|find|alerts?|notify|widgets?|page|tab|panel|watchlists?|my|portfolio|positions?)\\b)(?!.*(?:\\b(?:over|above|under|below|at least|more than|less than|greater than)\\b|[<>])\\s*\\$?\\d)'
const NOT_A_MEANING = '(?!.*\\b(?:explain|define|definition|meaning|means?|difference between|how (?:is|are|do|does) .* (?:calculated|worked out|computed|work|works|adjusted|affect\\w*))\\b)'
  + '(?!what(?:\'s|’s| is| are) (?:an? |the )?(?:corporate actions?|stock splits?|reverse splits?|splits?|dividends?|ex[- ]?dividend(?: dates?)?|ipos?|ipo calendar|dividend calendar)s?\\W*$)'
const OURS = `${NOT_A_SCREEN}${NOT_A_MEANING}`
const NOT_A_BOARD = '(?!.*\\b(?:charts?|cells?|grid|panes?|windows?|layouts?|views?|evenly|equally|tiles?|tiled|side by side)\\b)'
const NOT_A_MARKER = '(?!.*\\b(?:markers?|labels?|show on|turn on|turn off|hide|toggle|ranges?)\\b)'
const NOT_NEWS = '(?!.*\\b(?:news|headlines?|articles?|rumou?rs?|why)\\b)'
const NOT_A_YIELD = '(?!.*\\b(?:yields?|payout ratio|aristocrats?|kings?|growth)\\b)'
const AHEAD = '(?:next|upcoming|coming|scheduled|declared|announced|planned|future|pending)'
const NOT_AHEAD = `(?!.*\\b(?:${AHEAD}|ahead|forward|ex[- ]?div\\w*|calendar|this week|next week|this month|next month|due)\\b)`
const NOT_LEAD = '(?!.*\\b(?:recent|recently|new|newest|latest|newly|last year|past year|12 months|twelve months|listings?|listed|first traded|since)\\b)'
const ACTIONS_OURS = `${OURS}${NOT_A_BOARD}${NOT_A_MARKER}${NOT_NEWS}${NOT_AHEAD}`
const AHEAD_OURS = `${OURS}${NOT_A_BOARD}${NOT_A_MARKER}${NOT_NEWS}${NOT_A_YIELD}`
export const WAVE8_ROUTE_WORDS = Object.freeze({
  actions: [
    new RegExp(`${ACTIONS_OURS}.*\\bcorporate actions?\\b`),
    new RegExp(`${ACTIONS_OURS}.*\\b(?:stock|share|reverse) splits?\\b`),
    new RegExp(`${ACTIONS_OURS}.*(?:\\bsplit (?:history|histories|ratios?|record)\\b|\\bsplits? history\\b)`),
    new RegExp(`${ACTIONS_OURS}.*(?:\\b(?:ever|last|previously|when did|how many times)\\b.*\\bsplit\\b|\\bsplit\\b.*\\b(?:ever|last time|before)\\b)`),
    new RegExp(`${ACTIONS_OURS}${NOT_A_YIELD}.*\\bdividends? (?:history|record|payments?|payouts?|paid)\\b`),
    new RegExp(`${ACTIONS_OURS}${NOT_A_YIELD}.*\\b(?:past|previous|prior|historical|earlier) (?:cash )?dividends?\\b`),
  ],
  ipos: [
    new RegExp(`${OURS}${NOT_A_MARKER}${NOT_NEWS}.*\\b(?:ipo calendar|ipos calendar|calendar of ipos|ipo schedule|ipo pipeline)\\b`),
    new RegExp(`${OURS}${NOT_A_MARKER}${NOT_NEWS}${NOT_LEAD}.*\\b(?:upcoming|expected|scheduled|planned|pending|coming) ipos?\\b`),
    new RegExp(`${OURS}${NOT_A_MARKER}${NOT_NEWS}${NOT_LEAD}.*\\bipos? (?:are |is )?(?:this week|next week|last week|today|tomorrow|pricing|priced|expected|coming|scheduled|due)\\b`),
  ],
  dividends: [
    new RegExp(`${AHEAD_OURS}.*\\bex[- ]?div(?:idend)?s?\\b`),
    new RegExp(`${AHEAD_OURS}.*\\b(?:dividend calendar|dividends calendar|calendar of dividends)\\b`),
    new RegExp(`${AHEAD_OURS}.*\\b${AHEAD} (?:cash )?dividends?\\b`),
    new RegExp(`${AHEAD_OURS}.*\\bdividends? (?:coming up|ahead|upcoming|scheduled|declared|due|this week|next week|this month|next month)\\b`),
    new RegExp(`${AHEAD_OURS}.*\\b${AHEAD} (?:stock |share |reverse )?splits?\\b`),
    new RegExp(`${AHEAD_OURS}.*\\bsplits? (?:coming up|ahead|upcoming|scheduled|announced|declared|planned)\\b`),
  ],
})
export const ROUTE_GROUP = 'marketCalendars'
const ownGroup = () => GROUPS.find(g => g.id === ROUTE_GROUP)
/** Adds (or takes back) ONE capability's words on the wave's own group. */
function armRoutes(key, on) {
  const g = ownGroup()
  if (!g) return
  for (const re of WAVE8_ROUTE_WORDS[key]) {
    const at = g.words.indexOf(re)
    if (on && at < 0) g.words.push(re)
    if (!on && at >= 0) g.words.splice(at, 1)
  }
}

// ── registration: each capability only while the server serves ITS kind ───────────────────────────────────────────────
// ⚠️ THE WORDS OF A SUMMARY AND OF ITS HINTS JOIN THE TYPO LEXICON (nl/lexicon.js: every lowercase word of three letters or
// more; a word in CAPITALS does not). A new known word changes what a nearby word in ANY member message may be "corrected"
// to, so the text below is worded to leave every existing capability-regression phrasing's corrections exactly as they
// were (pinned in agentTerminalDataWave8.test.js, "the typo lexicon").
const TARGET_HINT = 'target = the ref of the stockData entry.'
const NO_FIGURES = 'reply: one short line, no figures.'
const HELD_ONLY = 'Answered only from what the SERVER already HOLDS, so it may say none is held.'
const SYMBOL_HINT = 'symbol = the one ticker named (or the open chart\'s symbol).'
const unregister = {}

/** Idempotent; registers each of the three ONLY while the server serves its kind. Returns the names registered by this call. */
export function registerTerminalWave8Capabilities() {
  const added = []
  if (!unregister.actions && kindServed(KINDS.actions)) {
    unregister.actions = registerCapability({
      name: 'stock.splitsDividends',    // a LITERAL: the server's local-only mirror rail reads it (tests/test_uct_agent_breadth.py)
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ the vendor's reference data, which the licensing register clears for member display: shown to the member, never to a model
      summary: 'One stock\'s CORPORATE ACTIONS as UCT HOLDS them beside its CHART: its past STOCK SPLITS and CASH DIVIDENDS by EX-DATE (SPLIT-ADJUSTED), newest first. '
        + 'For "NVDA CORPORATE ACTIONS", "SPLIT HISTORY for AAPL", "PAST DIVIDENDS of KO".',
      hints: `${TARGET_HINT} ${SYMBOL_HINT} ROWS 1-${ACTIONS_MAX_ROWS} PER BLOCK (null = ${ACTIONS_DEFAULT_ROWS}). The date is the newest EVENT in the RECORD: never today. A RECORD, not a FORECAST and not ADVICE. ${HELD_ONLY} `
        + `DIVIDENDS and SPLITS AHEAD are not this answer. ${NO_FIGURES}`,
      args: { type: 'object', properties: { symbol: { type: 'string' }, rows: { type: ['integer', 'null'] } }, required: ['symbol', 'rows'], additionalProperties: false },
      answer: (_snap, args) => answerActions(args || {}),
    })
    armRoutes('actions', true)
    added.push(CAPABILITIES.actions)
  }
  if (!unregister.ipos && kindServed(KINDS.ipos)) {
    unregister.ipos = registerCapability({
      name: 'stock.ipoCalendar',        // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ two vendors' IPO calendars, one with no AI clause in the licensing register: shown to the member, never to a model
      summary: 'The IPO CALENDAR as UCT HOLDS it, LAST WEEK to NEXT WEEK: each DEAL\'s DAY, COMPANY, SYMBOL, EXCHANGE, PRICE RANGE, SHARES, VALUE and STATUS, UPCOMING DEALS and RECENTLY PRICED ones. '
        + 'For "IPO CALENDAR", "UPCOMING IPOS", "which IPOS PRICE NEXT WEEK".',
      hints: `${TARGET_HINT} No SYMBOL. ROWS 1-${IPO_MAX_ROWS} PER LIST (null = ${IPO_DEFAULT_ROWS}). The CALENDARS CARRY no DATE of their own: the answer GIVES when UCT READ them, never today's ask. ${HELD_ONLY} `
        + `STOCKS FIRST TRADED in the LAST YEAR are UCT's NEW LISTINGS, not this answer. ${NO_FIGURES}`,
      args: { type: 'object', properties: { rows: { type: ['integer', 'null'] } }, required: ['rows'], additionalProperties: false },
      answer: (_snap, args) => answerIpos(args || {}),
    })
    armRoutes('ipos', true)
    added.push(CAPABILITIES.ipos)
  }
  if (!unregister.dividends && kindServed(KINDS.dividends)) {
    unregister.dividends = registerCapability({
      name: 'stock.dividendsCalendar',   // a LITERAL: the server's local-only mirror rail reads it
      surfaces: ['*'],
      target: 'market', query: true,
      localOnly: true,                  // ⛔ the vendor's reference data, which the licensing register clears for member display: shown to the member, never to a model
      summary: 'DIVIDENDS and SPLITS DECLARED AHEAD for the STOCKS NAMED, as UCT HOLDS them: each STOCK\'s NEXT EX-DIVIDEND DATE with its CASH AMOUNT as DECLARED, and every SPLIT AHEAD, SOONEST first. '
        + 'For "NEXT EX-DIVIDEND DATE for KO", "UPCOMING DIVIDENDS for AAPL and MSFT", "any UPCOMING SPLITS for NVDA".',
      hints: `${TARGET_HINT} SYMBOLS = 1-${DIVIDENDS_MAX_SYMBOLS} TICKERS NAMED (never the MEMBER's own LISTS: NAME the STOCKS). A FORWARD CALENDAR CARRIES no DATE of its own: the answer GIVES when UCT READ EACH STOCK, never today's ask. ${HELD_ONLY} `
        + `PAST DIVIDENDS and SPLITS are CORPORATE ACTIONS, not this answer. ${NO_FIGURES}`,
      args: { type: 'object', properties: { symbols: { type: 'array', items: { type: 'string' } } }, required: ['symbols'], additionalProperties: false },
      answer: (_snap, args) => answerDividends(args || {}),
    })
    armRoutes('dividends', true)
    added.push(CAPABILITIES.dividends)
  }
  return added
}
export const _resetTerminalWave8ForTest = () => {
  for (const k of Object.keys(unregister)) { unregister[k]?.(); delete unregister[k] }
  for (const k of Object.keys(WAVE8_ROUTE_WORDS)) armRoutes(k, false)
}
