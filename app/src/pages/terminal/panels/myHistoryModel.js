// MYH: the member's own Journal record on ONE stock, the pure half (no React, no network; an
// agent capability can reuse it).
//
// ⭐ NO NEW ROUTE. Five reads the Journal already makes (api/routers/journal_two.py). Every one is
// `Depends(get_current_user)` and filters on that session's own user id: 401 signed out, and no
// way to name another member. None takes a member id, and none carries a paid gate of its own.
//
//   GET /api/j2/accounts                 the account list (the SAME read PERF makes: one shared
//                                        request when both panels are open).
//   GET /api/j2/trades?symbol=&account_id=
//                                        { trades: [...], total, limit, offset }: the member's
//                                        closed STOCK trades, newest entry first. The server filters
//                                        on the symbol, so the member's whole history is never
//                                        downloaded. ⛔ That filter is a PREFIX match (the Journal
//                                        search box: `NVDA` also finds `NVDAX`), so rows are kept
//                                        EXACT here, the way CHK already does. No `limit` is sent:
//                                        the numbers below are the whole record on this stock.
//   GET /api/j2/positions?account_id=    { positions: [...] }: the member's open stock positions
//                                        (the Journal's own Open Positions read; it has no symbol
//                                        filter and an open book is a short list).
//   GET /api/j2/options?symbol=&account_id=
//                                        { strategies: [...] }: the member's option strategies on
//                                        the underlying, every status (prefix match again, kept
//                                        exact here).
//   GET /api/j2/notes?ticker=&limit=&excludeSample=1
//                                        { notes: [...], total }: the Notebook notes that carry
//                                        the ticker (the note's own ticker, a chart embed of it or
//                                        a `$TICKER` mention), newest edit first. Only the title,
//                                        the dates and the id are kept: a note's text is never
//                                        drawn here. `excludeSample` (the route's own switch)
//                                        leaves out the sample notebook: its examples name real
//                                        tickers and are not the member's own notes.
//
// ⛔ EVERY NUMBER IS THE JOURNAL'S OWN. Nothing here re-derives a result, an R or a win rate:
//   * the closed-trade list is the union the Journal's Trade Journal tab builds (its stock trades
//     plus its closed option strategies as `optionClosedToRow` rows), and the stats are that tab's
//     own `summaryStats` over it (lib/journal-2-0/calculations.js). myHistoryModel.test.js pins the
//     two together on one fixture;
//   * a trade's R is the row's own `rMultiple`, the number the Journal's R column prints. A stock
//     trade with no stop logged (a broker import stores none) has NO R: it says so, and it is left
//     out of the average, never counted as zero. The average R is the plain mean of the R values
//     the Journal lists, and it always says how many trades it covers;
//   * an open position's stop is `realStop` (the Journal's one rule for "is this a real stop": a
//     broker placeholder equal to the entry, a zero and a blank are all no stop), its date is
//     "estimated" where the Journal draws "est.", and its unrealised result is the Journal's own
//     `positionPnlDollar` at the Journal's own `currentPriceFor` price. With no price, no result.
//   * an open option strategy shows its contracts and entry, and NO result: the Journal marks
//     open options with live option prices this panel does not read.
//
// ⛔ A FAILED READ IS NEVER "NO TRADES" and never "not held".
import {
  currentPriceFor, positionPnlDollar, positionPnlPercent, realStop, summaryStats,
} from '../../../lib/journal-2-0'
import { buildStrategyLabel, classifyDebitCredit, optionClosedToRow } from '../../journal-2-0/lib/optionCalcs'
import { noteHref } from '../../journal-2-0/lib/noteHref'
import { CONFIDENCE_MIN, performanceCommandArgs } from './performanceModel'

/** The terminal code this panel is registered under (the panel reads the live one from its frame). */
export const MY_HISTORY_CODE = 'MYH'

export const TRADES_URL = '/api/j2/trades'
export const POSITIONS_URL = '/api/j2/positions'
export const OPTIONS_URL = '/api/j2/options'
export const NOTES_URL = '/api/j2/notes'

/** Notes asked for (the newest few; the route also sends the true total). */
export const NOTES_LIMIT = 5
/** Closed trades drawn until the member asks for all of them; the rest are counted, never dropped. */
export const TRADES_SHOWN = 20

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v))
const text = (v) => (v === null || v === undefined ? '' : String(v).trim())
const tickerOf = (v) => text(v).toUpperCase()

/** Pure: the arguments an account choice writes into the panel's command (`NVDA MYH 2`,
 *  `NVDA MYH ALL`; the Journal's own pick is the bare command). The same words as PERF. */
export const myHistoryCommandArgs = (choice) => performanceCommandArgs(choice)

/** Pure: the command that opens this panel for a stock (`NVDA MYH`). */
export const myHistoryCommand = (sym, code = MY_HISTORY_CODE) => `${tickerOf(sym)} ${code}`.trim()

function withQuery(base, pairs) {
  const p = new URLSearchParams()
  for (const [k, v] of pairs) if (v !== null && v !== undefined && v !== '') p.set(k, String(v))
  const qs = p.toString()
  return qs ? `${base}?${qs}` : base
}

/** Pure: the closed stock trades of one ticker (`accountId` null is all accounts together). */
export function tradesUrl({ sym, accountId = null } = {}) {
  const s = tickerOf(sym)
  return s ? withQuery(TRADES_URL, [['symbol', s], ['account_id', accountId]]) : null
}

/** Pure: the open stock positions (the route has no symbol filter; rows are kept exact here). */
export function positionsUrl({ accountId = null } = {}) {
  return withQuery(POSITIONS_URL, [['account_id', accountId]])
}

/** Pure: the option strategies on one underlying, every status. */
export function optionsUrl({ sym, accountId = null } = {}) {
  const s = tickerOf(sym)
  return s ? withQuery(OPTIONS_URL, [['symbol', s], ['account_id', accountId]]) : null
}

/** Pure: the newest notes that carry the ticker, the sample notebook's examples left out. Notes
 *  belong to the member, not to an account. */
export function notesUrl({ sym, limit = NOTES_LIMIT } = {}) {
  const s = tickerOf(sym)
  return s ? withQuery(NOTES_URL, [['ticker', s], ['limit', limit], ['excludeSample', 1]]) : null
}

/**
 * Pure: the closed-trades answer, kept to exactly this ticker.
 *   state       'ok' | 'failed' (not a trades answer)
 *   trades      the Journal's own trade rows for the ticker, untouched (its helpers read them)
 *   unreadable  rows for the ticker with no result number: left out, and the panel says how many
 */
export function tradesRead(body, sym) {
  if (!isObj(body) || !Array.isArray(body.trades)) return { state: 'failed', trades: [], unreadable: 0 }
  const s = tickerOf(sym)
  const mine = body.trades.filter((t) => isObj(t) && tickerOf(t.symbol) === s)
  const trades = mine.filter((t) => num(t.pnlDollar) !== null)
  return { state: 'ok', trades, unreadable: mine.length - trades.length }
}

/** Pure: the open-positions answer, kept to exactly this ticker: `{ state, positions }`. */
export function positionsRead(body, sym) {
  if (!isObj(body) || !Array.isArray(body.positions)) return { state: 'failed', positions: [] }
  const s = tickerOf(sym)
  return { state: 'ok', positions: body.positions.filter((p) => isObj(p) && tickerOf(p.symbol) === s && !p.closedAt) }
}

/**
 * Pure: the option-strategies answer, kept to exactly this underlying.
 *   open    the strategies held now
 *   closed  the ones the Journal's Trade Journal tab lists (status `closed`)
 *   other   how many ended another way (`expired`, `assigned`, `rolled`): the Journal's trade list
 *           does not include those, so neither do the numbers here; the panel says how many
 */
export function optionsRead(body, sym) {
  const none = { state: 'failed', open: [], closed: [], other: 0 }
  if (!isObj(body) || !Array.isArray(body.strategies)) return none
  const s = tickerOf(sym)
  const mine = body.strategies.filter((x) => isObj(x) && tickerOf(x.underlying) === s)
  const open = mine.filter((x) => x.status === 'open')
  const closed = mine.filter((x) => x.status === 'closed')
  return { state: 'ok', open, closed, other: mine.length - open.length - closed.length }
}

/**
 * Pure: the notes answer: `{ state, notes: [{ id, key, title, updated, created, href }], total }`.
 * `total` is the route's own count of the notes that carry the ticker (never the page length).
 */
export function notesRead(body) {
  if (!isObj(body) || !Array.isArray(body.notes)) return { state: 'failed', notes: [], total: 0 }
  const notes = []
  for (const n of body.notes) {
    const id = text(n?.id)
    if (!id) continue
    notes.push({
      id,
      key: `note-${notes.length}-${id}`,
      title: text(n.title) || 'Untitled note',
      updated: text(n.updatedAt) || null,
      created: text(n.createdAt) || null,
      href: noteHref(id),
    })
  }
  const total = num(body.total)
  return { state: 'ok', notes, total: total === null ? notes.length : Math.max(Math.round(total), notes.length) }
}

/**
 * Pure: the closed-trade list the Journal's Trade Journal tab shows for this stock: its stock
 * trades, then its closed option strategies as the SAME `optionClosedToRow` rows that tab builds.
 * Nothing is recomputed; these rows are what `summaryStats` and the table below read.
 */
export function journalRows({ trades = [], closedStrategies = [] } = {}) {
  return [...(Array.isArray(trades) ? trades : []), ...(Array.isArray(closedStrategies) ? closedStrategies : []).map(optionClosedToRow)]
}

const stat = (key, label, kind, rest) => ({ key, label, kind, state: 'ok', value: null, n: null, min: null, of: null, why: null, note: null, ...rest })
/** A value with its sample: a small one (under the Journal's confidence line) is marked, never hidden. */
const sampled = (value, n, of) => ({ state: n < CONFIDENCE_MIN ? 'thin' : 'ok', value, n, min: CONFIDENCE_MIN, of })
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/**
 * Pure: the numbers on the member's closed trades in this stock.
 *   summary  the Journal's own `summaryStats` of the rows (untouched)
 *   stats    the row the panel prints. Each `{ key, label, kind, state, value, n, min, of, why, note }`:
 *              kind   'count' | 'pct' | 'signedUsd' | 'r' | 'days'
 *              state  'ok' | 'thin' (a small sample: shown, and marked) | 'none' (`why` says what is missing)
 *              note   words printed under the value instead of the sample line
 *   r        { known, stockNoStop, optionNoRisk, average }: how many trades have an R at all
 *   options  how many of the rows are option trades
 *   excluded how many the Journal leaves out of its Analytics numbers (still listed and counted
 *            here, as on its Trade Journal tab)
 */
export function historyStats(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter(isObj)
  const summary = summaryStats(list)
  const decisive = summary.wins + summary.losses
  const rValues = list.map((t) => num(t.rMultiple)).filter((v) => v !== null)
  const average = rValues.length ? rValues.reduce((a, b) => a + b, 0) / rValues.length : null
  const options = list.filter((t) => t.isOption).length
  const r = {
    known: rValues.length,
    stockNoStop: list.filter((t) => !t.isOption && num(t.rMultiple) === null).length,
    optionNoRisk: list.filter((t) => t.isOption && num(t.rMultiple) === null).length,
    average,
  }
  const n = summary.totalTrades
  const stats = [
    stat('trades', 'Closed trades', 'count', {
      value: n,
      note: `${plural(summary.wins, 'win', 'wins')}, ${plural(summary.losses, 'loss', 'losses')}, ${summary.bes} breakeven`,
    }),
    stat('winRate', 'Win rate', 'pct', summary.winRate === null || decisive === 0
      ? { state: 'none', why: 'No winning or losing trades yet.' }
      : sampled(summary.winRate, decisive, 'wins and losses')),
    stat('total', 'Total result', 'signedUsd', {
      value: summary.totalPnl,
      note: options === 0 ? 'Before fees.' : options === n ? 'After fees.' : 'Stock trades before fees, option trades after.',
    }),
    stat('average', 'Average result per trade', 'signedUsd', summary.avgPnlPerTrade === null
      ? { state: 'none', why: 'No closed trades yet.' }
      : sampled(summary.avgPnlPerTrade, n, 'trades')),
    stat('averageR', 'Average R', 'r', average === null
      ? { state: 'none', why: 'No trade here has a known R.' }
      : sampled(average, rValues.length, 'trades with a known R')),
    stat('best', 'Best trade', 'signedUsd', n > 0 && summary.largestWin > 0
      ? { value: summary.largestWin }
      : { state: 'none', why: 'No winning trade yet.' }),
    stat('worst', 'Worst trade', 'signedUsd', n > 0 && summary.largestLoss < 0
      ? { value: summary.largestLoss }
      : { state: 'none', why: 'No losing trade yet.' }),
    stat('hold', 'Average hold', 'days', summary.avgHold === null
      ? { state: 'none', why: 'No closed trades yet.' }
      : sampled(summary.avgHold, n, 'trades')),
  ]
  return { summary, stats, r, options, excluded: list.filter((t) => t.analyticsExcluded === true).length }
}

/** Pure: how many of the trades have an R, and why the others do not ('' with no trades).
 *  `count` formats a whole number (the panel passes the shared formatter). */
export function rCoverageSentence(r, total, count = String) {
  if (!r || !total) return ''
  const t = (n) => `${count(n)} ${n === 1 ? 'trade' : 'trades'}`
  const parts = [`R is known for ${count(r.known)} of ${t(total)}.`]
  if (r.stockNoStop) {
    parts.push(`${count(r.stockNoStop)} stock ${r.stockNoStop === 1 ? 'trade has' : 'trades have'} no stop logged (a broker import carries none), so ${r.stockNoStop === 1 ? 'it has' : 'they have'} no R and ${r.stockNoStop === 1 ? 'is' : 'are'} left out of the average, never counted as zero.`)
  }
  if (r.optionNoRisk) {
    parts.push(`${count(r.optionNoRisk)} option ${r.optionNoRisk === 1 ? 'trade has' : 'trades have'} no set maximum risk, so no R either.`)
  }
  return parts.join(' ')
}

const SINGLE_LEG = new Set(['long_call', 'long_put', 'short_call', 'short_put'])
const dateKey = (v) => text(v)

/**
 * Pure: the closed trades as table rows, newest close first.
 *   { key, isOption, closed, opened, name (an option's label, else null), side, size, sizeUnit,
 *     fractional, entry, exit (null for a strategy of several legs), result, r, rWhy, setup, excluded }
 * `rWhy` says why a row has no R: 'no-stop' (a stock trade with no stop logged) or 'no-risk' (an
 * option trade with no set maximum risk). `strategies` are the closed strategies the option rows
 * came from: one of several legs is named the way the Journal's Open Positions tab names it.
 */
export function tradeRows(rows, strategies = []) {
  const byId = new Map((Array.isArray(strategies) ? strategies : []).filter(isObj).map((s) => [String(s.id), s]))
  const out = (Array.isArray(rows) ? rows : []).filter(isObj).map((t, i) => {
    const isOption = t.isOption === true
    const strategy = isOption ? byId.get(String(t.id)) || null : null
    const several = !!strategy && !SINGLE_LEG.has(strategy.strategyType)
    const r = num(t.rMultiple)
    const size = num(t.shares)
    return {
      key: `${isOption ? 'opt' : 'trade'}-${t.id ?? i}-${i}`,
      isOption,
      closed: dateKey(t.exitDate) || null,
      opened: dateKey(t.entryDate) || null,
      name: !isOption ? null : several ? buildStrategyLabel(strategy) : text(t.symbol) || null,
      side: several ? (classifyDebitCredit(strategy.netEntry) === 'credit' ? 'Short' : 'Long') : text(t.side) || null,
      size,
      sizeUnit: isOption ? 'contract' : 'share',
      fractional: size !== null && !Number.isInteger(size),
      entry: several ? null : num(t.entryPrice),
      exit: several ? null : num(t.exitPrice),
      several,
      result: num(t.pnlDollar),
      r,
      rWhy: r !== null ? null : isOption ? 'no-risk' : 'no-stop',
      setup: text(t.setup) || null,
      excluded: t.analyticsExcluded === true,
    }
  })
  // Newest close first; a row with no close date sinks last; ties keep the Journal's own order.
  return out.map((row, i) => [row, i]).sort(([a, ai], [b, bi]) => {
    if (a.closed === b.closed) return ai - bi
    if (!a.closed) return 1
    if (!b.closed) return -1
    return a.closed < b.closed ? 1 : -1
  }).map(([row]) => row)
}

/** The words for a row with no R (the table cell and the phone card say the same thing). */
export const NO_R_TEXT = Object.freeze({ 'no-stop': 'No stop logged', 'no-risk': 'No set risk' })

/**
 * Pure: what the member holds in this stock now.
 *   stock rows   { key, kind: 'stock', side, shares, fractional, entry, stop (null: no real stop
 *                  logged), opened (null when the date is the broker's placeholder), dateEstimated,
 *                  price (null: nothing to mark it with), priceFrom ('live' | 'broker' | null),
 *                  result, resultFraction, accountId }
 *   option rows  { key, kind: 'option', name, side, contracts, entry (per-contract premium of a
 *                  single leg, else null), net ({ kind: 'debit' | 'credit' | 'even', amount } for
 *                  several legs), opened, accountId }: no result (see the header)
 * `prices` is the app's live-price map (`{ SYM: { price } }`); `preferBroker` is the Journal's own
 * rule for when the broker's mark leads (lib/journal-2-0 `preferBrokerMarks`).
 */
export function holdingRows({ positions = [], openStrategies = [], prices = null, preferBroker = false } = {}) {
  const out = []
  for (const p of (Array.isArray(positions) ? positions : [])) {
    if (!isObj(p)) continue
    const current = currentPriceFor(p, prices, preferBroker)
    const hasPrice = Number.isFinite(current)
    // Which of the two prices `currentPriceFor` took (its own order, read back, never a second rule).
    const brokerLeads = preferBroker && Number.isFinite(p.brokerPrice)
    const priceFrom = !hasPrice ? null : brokerLeads || !Number.isFinite(prices?.[p.symbol]?.price) ? 'broker' : 'live'
    const shares = num(p.shares)
    out.push({
      key: `pos-${out.length}-${p.id}`,
      kind: 'stock',
      side: text(p.side) || null,
      shares,
      fractional: shares !== null && !Number.isInteger(shares),
      entry: num(p.entryPrice),
      stop: realStop(p),
      opened: p.entryEstimated === true ? null : dateKey(p.entryDate) || null,
      dateEstimated: p.entryEstimated === true,
      price: hasPrice ? current : null,
      priceFrom,
      result: hasPrice ? positionPnlDollar(p, current) : null,
      resultFraction: hasPrice ? positionPnlPercent(p, current) : null,
      accountId: text(p.accountId) || null,
    })
  }
  for (const s of (Array.isArray(openStrategies) ? openStrategies : [])) {
    if (!isObj(s)) continue
    const leg = (Array.isArray(s.legs) && s.legs[0]) || {}
    const single = SINGLE_LEG.has(s.strategyType)
    const asRow = single ? optionClosedToRow(s) : null   // the Journal's own label and side for one leg
    const net = num(s.netEntry)
    out.push({
      key: `opt-${out.length}-${s.id}`,
      kind: 'option',
      name: single ? asRow.symbol : buildStrategyLabel(s),
      side: single ? asRow.side : (classifyDebitCredit(net ?? 0) === 'credit' ? 'Short' : 'Long'),
      contracts: num(leg.qty),
      entry: single ? num(leg.entryPrice) : null,
      net: single || net === null ? null : { kind: classifyDebitCredit(net), amount: Math.abs(net) },
      opened: dateKey(s.entryDate) || null,
      accountId: text(s.accountId) || null,
    })
  }
  return out
}

/**
 * Pure: the one sentence above the sections. Each count is a number, or null for a read that has
 * not answered (it is then left out, never said as zero).
 */
export function historySentence(sym, { held = null, trades = null, notes = null } = {}, count = String) {
  const s = tickerOf(sym)
  const parts = []
  if (held !== null) parts.push(held > 0 ? `You hold ${s} now.` : `You do not hold ${s} now.`)
  if (trades !== null) parts.push(trades > 0 ? `${count(trades)} closed ${trades === 1 ? 'trade' : 'trades'} on it.` : 'No closed trades on it.')
  if (notes !== null) parts.push(notes > 0 ? `${count(notes)} ${notes === 1 ? 'note names' : 'notes name'} it.` : 'No note names it.')
  return parts.join(' ')
}
