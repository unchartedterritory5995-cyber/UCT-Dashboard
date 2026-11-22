// tools/vendor_harness/strategy_reference.mjs
//
// ─── U14: A STRATEGY CAPTURE'S TESTER REPORT, AS THE GRADE'S REFERENCE ──────────
//
// The capture's report tree (`provenance.report.tree`, TradingView's `_reportData`, read by
// `tv_capture.js` v3) is TradingView's own answer. `gradeStrategy` (compare.mjs) reads a
// reference in the record's vocabulary (design 3.2): trades keyed by BAR TIME in epoch
// SECONDS, a direction, prices, a quantity, a money profit. This module is the ONE adapter
// between the two, and it is PURE: no engine import, no file read, nothing defaulted.
//
// THE TREE, AS MEASURED (runs s25-2026-11-15 and s26-2026-11-15, 28 committed probes on NYSE:RDDT 1D):
//   trades[i]       e / x = { b bar index, c the fill's TEXT (its comment, else its id), p price,
//                   tm epoch MILLISECONDS, tp le|se|lx|sx }, q qty, v entry value, tp { v profit,
//                   p fraction }, cp cumulative profit, rn run-up, dd drawdown { v, p }, cm commission.
//                   ⭐ An OPEN trade is listed too, LAST, marked out at the last bar with `x.c` ""
//                   (`performance.all.totalOpenTrades` of them; w9-q-s1b-defaults-v5: 40 listed, 1 open).
//   filledOrders[i] { id the order id, c its text, b is-buy, e true for an entry command, false for an
//                   exit / close, null for strategy.order and a margin call, p price, q qty,
//                   tp MARKET|LIMIT|STOP|STOP_LIMIT, tm an ORDINAL }.
//                   ⛔ `tm` is NOT a time. It ascends with the fills' bars, one value per bar on s25
//                   (89 fills over 82 ordinals and 82 distinct trade-event bars), but it SKIPS values
//                   under process_orders_on_close (w9-p1-on-close: 44 fills over 0..45, no 5, no 43).
//                   So a fill's bar is found by walking the ordinals in order against the trade events.
//                   ⛔ `e` is the COMMAND, not the effect: an allow_entry_in entry that only closes a
//                   position is `e: true` (w9-r1-risk-allow), and a reversal is ONE fill of both sizes.
//   performance     .{all,long,short}.* and the account-wide figures (maxStrategyDrawDown, …).
//   ⛔ UNITS: every percentage is a FRACTION; avgLosTrade, largestLosTrade and grossLoss are
//   POSITIVE magnitudes (`REPORT_UNITS` below; `strategy_report_slots.json` maps the slots).
//
// ⛔ A ROW THIS CANNOT READ REFUSES THE WHOLE REFERENCE, by name. A reference with one trade
// silently dropped would grade our broker against a list TradingView never showed.

import { sameEnum } from './strategy_capture.mjs'

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x)
const fin = (x) => typeof x === 'number' && Number.isFinite(x)

/** TradingView's trade-side codes: the entry's `tp` names the direction, the exit's must agree. */
export const ENTRY_CODES = Object.freeze({ le: 'long', se: 'short' })
export const EXIT_CODES = Object.freeze({ lx: 'long', sx: 'short' })
export const FILL_TYPES = Object.freeze(['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT'])
/** A fill's ROLE, from `e`: the order command that filled (our side: the order log's `kind`). */
export const FILL_ROLES = Object.freeze({ entry: 'entry', exit: 'exit', order: 'order' })
export function fillRoleOfE(e) { return e === true ? 'entry' : e === false ? 'exit' : 'order' }

/** How each report slot's TradingView value is expressed (MEASURED on s25; see the header). */
export const REPORT_UNITS = Object.freeze({
  percentProfitable: 'fraction',
  grossLoss: 'positive-magnitude',
  avgLosingTrade: 'positive-magnitude',
  largestLosingTrade: 'positive-magnitude',
})

/** epoch ms → epoch s, only when it is a whole second (a bar time is; nothing is rounded). */
function secondsOf(ms) {
  if (!Number.isInteger(ms) || ms % 1000 !== 0) return null
  return ms / 1000
}

function tradeOf(t, i, open) {
  const at = `trades[${i}]`
  if (!isObj(t) || !isObj(t.e)) return { error: `${at}: no entry side` }
  const direction = ENTRY_CODES[t.e.tp]
  if (!direction) return { error: `${at}.e.tp ${JSON.stringify(t.e.tp)} is not le | se` }
  if (!fin(t.e.p)) return { error: `${at}.e.p is not a price` }
  const entryTime = secondsOf(t.e.tm)
  if (entryTime === null) return { error: `${at}.e.tm ${JSON.stringify(t.e.tm)} is not a whole-second epoch ms` }
  if (!fin(t.q) || t.q <= 0) return { error: `${at}.q is not a positive quantity` }
  if (!isObj(t.x)) return { error: `${at}: no exit side` }
  if (EXIT_CODES[t.x.tp] !== direction) return { error: `${at}.x.tp ${JSON.stringify(t.x.tp)} does not close a ${direction} trade` }
  if (open) {
    // the report marks an open trade out at the last bar under an EMPTY text: anything else is not one
    if (t.x.c !== '') return { error: `${at} is one of the last ${open} (the open trades) and its exit text is ${JSON.stringify(t.x.c)}, not ""` }
    return { trade: { n: i + 1, open: true, direction, entryLabel: typeof t.e.c === 'string' ? t.e.c : null, entryTime,
      entryPrice: t.e.p, entryBar: Number.isInteger(t.e.b) ? t.e.b : null, qty: t.q,
      exitTime: null, exitPrice: null, exitLabel: null, exitBar: null, profit: null, commission: fin(t.cm) ? t.cm : null } }
  }
  if (!fin(t.x.p)) return { error: `${at}.x.p is not a price` }
  const exitTime = secondsOf(t.x.tm)
  if (exitTime === null) return { error: `${at}.x.tm ${JSON.stringify(t.x.tm)} is not a whole-second epoch ms` }
  if (exitTime < entryTime) return { error: `${at}: exits before it enters` }
  if (!isObj(t.tp) || !fin(t.tp.v)) return { error: `${at}.tp.v is not a profit` }
  return {
    trade: {
      n: i + 1,
      open: false,
      direction,
      // the TEXT the Strategy Tester shows (a comment, else the id): never compared against our id
      entryLabel: typeof t.e.c === 'string' ? t.e.c : null,
      exitLabel: typeof t.x.c === 'string' ? t.x.c : null,
      entryTime,
      exitTime,
      entryPrice: t.e.p,
      exitPrice: t.x.p,
      entryBar: Number.isInteger(t.e.b) ? t.e.b : null,
      exitBar: Number.isInteger(t.x.b) ? t.x.b : null,
      qty: t.q,
      profit: t.tp.v,
      commission: fin(t.cm) ? t.cm : null,
    },
  }
}

function fillOf(f, i) {
  const at = `filledOrders[${i}]`
  if (!isObj(f)) return { error: `${at} is not an object` }
  if (typeof f.b !== 'boolean') return { error: `${at}.b must be a boolean` }
  if (!(f.e === true || f.e === false || f.e === null)) return { error: `${at}.e must be true, false or null` }
  if (!fin(f.p) || !fin(f.q) || f.q <= 0) return { error: `${at}: no price or quantity` }
  if (!Number.isInteger(f.tm) || f.tm < 0) return { error: `${at}.tm is not an ordinal` }
  if (!FILL_TYPES.includes(f.tp)) return { error: `${at}.tp ${JSON.stringify(f.tp)} is not ${FILL_TYPES.join(' | ')}` }
  return {
    fill: {
      ordinal: f.tm,
      id: typeof f.id === 'string' ? f.id : null,
      comment: typeof f.c === 'string' ? f.c : null,
      side: f.b ? 'buy' : 'sell',
      role: fillRoleOfE(f.e),
      price: f.p,
      qty: f.q,
      type: f.tp,
      time: null,
    },
  }
}

/** The fills' bar times. The trade events are every trade's entry (open trades included) and every
 *  closed trade's exit; their distinct bar times, ascending, are the bars TradingView filled on. The
 *  fills, walked in ORDINAL order, must step through those bars in order: each ordinal's fills are all
 *  trade events (by price) at the next bar, or at the bar the previous ordinal took (one bar's fills may
 *  span two ordinals). Every bar must be reached. Anything else leaves EVERY fill untimed, named. */
function timeFills(fills, trades) {
  const events = new Map()
  const add = (time, price) => { if (!events.has(time)) events.set(time, []); events.get(time).push(price) }
  for (const t of trades) {
    add(t.entryTime, t.entryPrice)
    if (!t.open) add(t.exitTime, t.exitPrice)
  }
  const times = [...events.keys()].sort((x, y) => x - y)
  const byOrdinal = new Map()
  for (const f of fills) {
    if (!byOrdinal.has(f.ordinal)) byOrdinal.set(f.ordinal, [])
    byOrdinal.get(f.ordinal).push(f)
  }
  const explainedAt = (group, time) => time !== undefined && group.every((f) => events.get(time).includes(f.price))
  let j = 0 // the next bar to reach
  for (const o of [...byOrdinal.keys()].sort((x, y) => x - y)) {
    const group = byOrdinal.get(o)
    let time
    if (explainedAt(group, times[j])) { time = times[j]; j += 1 } else if (j > 0 && explainedAt(group, times[j - 1])) time = times[j - 1]
    else {
      const f = group.find((x) => !(events.get(times[j]) || []).includes(x.price))
      return `fill ordinal ${o} (${f.side} ${f.qty} @ ${f.price}) is no trade event at bar time ${times[j]} (the next bar to fill)`
    }
    for (const f of group) f.time = time
  }
  if (j !== times.length) return `the fills reach ${j} of the trades' ${times.length} event bar(s)`
  return null
}

/**
 * The grade's reference from a capture's report tree.
 * @returns {{ok:true, trades:object[], fills:object[], fillsTimed:boolean, fillsReason:string|null,
 *            openTrades:number} | {ok:false, reason:string}}
 */
export function referenceOfReport(tree) {
  if (!isObj(tree)) return { ok: false, reason: 'strategy-reference: no report tree' }
  if (!Array.isArray(tree.trades)) return { ok: false, reason: 'strategy-reference: the report tree has no trades list' }
  if (!Array.isArray(tree.filledOrders)) return { ok: false, reason: 'strategy-reference: the report tree has no filledOrders list' }
  const all = isObj(tree.performance) && isObj(tree.performance.all) ? tree.performance.all : {}
  const openTrades = all.totalOpenTrades
  if (!Number.isInteger(openTrades) || openTrades < 0 || openTrades > tree.trades.length) {
    return { ok: false, reason: `strategy-reference: performance.all.totalOpenTrades ${JSON.stringify(openTrades)} is not a count of the listed trades` }
  }
  const trades = []
  for (const [i, t] of tree.trades.entries()) {
    const r = tradeOf(t, i, i >= tree.trades.length - openTrades ? openTrades : 0)
    if (r.error) return { ok: false, reason: `strategy-reference: ${r.error}` }
    trades.push(r.trade)
  }
  const fills = []
  for (const [i, f] of tree.filledOrders.entries()) {
    const r = fillOf(f, i)
    if (r.error) return { ok: false, reason: `strategy-reference: ${r.error}` }
    fills.push(r.fill)
  }
  const fillsReason = timeFills(fills, trades)
  if (fillsReason) for (const f of fills) f.time = null
  return { ok: true, trades, fills, fillsTimed: fillsReason === null, fillsReason, openTrades }
}

/** The reference of a capture (`provenance.report` must be `ok` with a tree). */
export function referenceOfCapture(capture) {
  const r = capture && capture.provenance && capture.provenance.report
  if (!isObj(r)) return { ok: false, reason: 'strategy-reference: the capture carries no provenance.report' }
  if (r.status !== 'ok') return { ok: false, reason: `strategy-reference: the report is ${r.status}` }
  return referenceOfReport(r.tree)
}

/** The symbol's tick from the capture (`minmov / pricescale`), or null. */
export function tickOfCapture(capture) {
  const s = (capture && capture.symbol) || {}
  return fin(s.pricescale) && s.pricescale > 0 && fin(s.minmov) && s.minmov > 0 ? s.minmov / s.pricescale : null
}

// ─── what each Properties input is depended on by ────────────────────────────────
//
// "A capture whose properties disagree, or has unread properties a rule depends on, is
// INCONCLUSIVE." Every broker rule fills, sizes or values trades, so every one depends on the
// inputs that move a fill, a size or a value: those are `'*'`. `risk_free_rate` moves only the
// Sharpe and Sortino slots; `currency` is identity only (W9-D2) and the record serves none.
// Keyed by `strategy_capture.mjs::PROPERTY_TABLE`'s keys (a rail pins that every key is here).
export const PROPERTY_DEPENDENTS = Object.freeze({
  initial_capital: '*',
  pyramiding: '*',
  calc_on_order_fills: '*',
  calc_on_every_tick: '*',
  backtest_fill_limits_assumption: '*',
  default_qty_type: '*',
  default_qty_value: '*',
  currency: Object.freeze([]),
  slippage: '*',
  commission_type: '*',
  commission_value: '*',
  process_orders_on_close: '*',
  close_entries_rule: '*',
  margin_long: '*',
  margin_short: '*',
  risk_free_rate: Object.freeze(['report:sharpeRatio', 'report:sortinoRatio']),
  use_bar_magnifier: '*',
  fill_orders_on_standard_ohlc: '*',
  calc_on_every_history_tick: '*',
  // the OPTIONAL inputs (U14 G3): never unread-required, but every one moves what a run is
  run_mode: '*',
  alert_message_template: '*',
  alert_type: '*',
  exclude_from_report: '*',
  trim_orders: '*',
  calc_range: '*',
})

/** The unread `property:<key>` entries (settingsAgreement's `unread`) that the run depends on:
 *  a `'*'` key always; a listed key when the run or the grade reads one of its dependents. */
export function unreadDependedOn(unread, readers = []) {
  const want = new Set(readers)
  return (unread || []).filter((u) => {
    const m = /^property:(\w+)$/.exec(u)
    if (!m) return false
    const dep = PROPERTY_DEPENDENTS[m[1]]
    if (dep === undefined) return true // a key this table does not know: fail closed
    return dep === '*' || dep.some((d) => want.has(d))
  })
}

/** Our run's EFFECTIVE settings against TradingView's read-back. `settingsAgreement` compares only
 *  what the source declares as a literal; a default TradingView applied that our version table
 *  does not (or the other way round) shows only here. `found` is `propertiesByKey(...).found`,
 *  `settings` the record's (`strategyRecord.js`). Only what the record states is compared. */
export function effectiveSettingsDisagreements(found, settings) {
  const s = settings || {}
  const out = []
  const read = (k) => (found && found[k] ? found[k].value : undefined)
  const cmp = (key, ours, same) => {
    const v = read(key)
    if (v === undefined || ours === null || ours === undefined) return
    if (!same(v, ours)) out.push({ key, ours, readBack: v })
  }
  const num = (v, o) => Number(v) === o
  const bool = (v, o) => (v === true || v === 'true') === o && (typeof v === 'boolean' || v === 'true' || v === 'false')
  const enumOf = (key) => (v, o) => sameEnum(key, o, v)
  cmp('initial_capital', s.initial_capital, num)
  // R6 `pyramiding`: 0 and 1 both allow ONE entry per direction, and TradingView reads its v2-v4 default back as 1
  // (w9-q-s1a-size-v4, w9-q-s1b-defaults-v4) where our declaration table holds 0: the same setting, not a disagreement
  cmp('pyramiding', s.pyramiding, (v, o) => Math.max(1, Number(v)) === Math.max(1, o))
  cmp('margin_long', s.margin_long, num)
  cmp('margin_short', s.margin_short, num)
  cmp('process_orders_on_close', s.process_orders_on_close, bool)
  cmp('calc_on_order_fills', s.calc_on_order_fills, bool)
  cmp('calc_on_every_tick', s.calc_on_every_tick, bool)
  cmp('slippage', s.slippage, num)
  if (s.commission) {
    cmp('commission_type', s.commission.type, enumOf('commission_type'))
    cmp('commission_value', s.commission.value, num)
  }
  if (s.default_qty) {
    cmp('default_qty_type', s.default_qty.type, enumOf('default_qty_type'))
    cmp('default_qty_value', s.default_qty.value, num)
  }
  return out
}
