// app/src/components/chart/engine/runtime/broker.js
//
// ─── ⭐⭐ S1 — TRADINGVIEW'S BROKER EMULATOR, THE PART THE REFERENCE SETTLES ─────
//
// A `strategy()` script places orders; TradingView's "broker emulator" fills them
// against the chart's own bars and exposes the result as `strategy.*` values
// (`strategy.position_size`, `strategy.position_avg_price`, ...). Every rule in
// this file is one of the rules `docs/pine/strategy-broker-spec.md` derives from
// TradingView's own text — the Pine v4/v5/v6 Language Reference (extracted with
// `docs/pine/pine-reference-extraction.md`) and the User Manual's "Strategies"
// page. Each rule below carries its spec id (`[B-..]`).
//
// ⛔⛔ WHAT THE TEXT DOES NOT SETTLE STOPS THE RUN BY NAME (`BrokerRefusal`,
// guard `runtime:strategy-unsettled`), naming the probe that would settle it
// (`docs/pine/capture-queue-2026-10-05-s1.md`). A broker that guesses produces a
// position size TradingView does not have, on a chart a member trades from; a
// stopped run produces a sentence. So every branch that would need a guess is a
// throw, and the throw fires only when the run actually REACHES that case — a
// script that never meets it is served in full.
//
// ⭐ DETERMINISTIC AND PURE: no clock, no module state. The same orders over the
// same bars give the same fills forever (the VM's own purity contract).
//
// ⭐ HISTORICAL ONLY, BY CONSTRUCTION. TradingView's default strategy executes once
// per CLOSED bar ([B-EXEC]); the VM does not run a broker program on a forming
// bar at all (`vm.js`), so no realtime tick ever reaches this file.

import { pinned } from './brokerPins.js'
import { ruleCapture, UNPINNED_GUARD, COMMISSION_RULE, COMMISSION_NET_VALUES, BROKER_UNSETTLED_GUARD } from './brokerRules.js'

// declared in brokerRules.js (one authority); re-exported here under its old name for every importer
export { BROKER_UNSETTLED_GUARD }
export const BROKER_START_GUARD = 'runtime:strategy-start'
export { UNPINNED_GUARD }

/** A stop of the run at a rule the spec does not settle. `probe` names the queue
 *  item that would settle it. */
export class BrokerRefusal extends Error {
  constructor(message, probe) {
    // ⭐ W9-T7: a W9 capture row is queued in the W9 design (5.2), not in S1's queue
    const where = /^W9-[A-Z]{1,2}\d/.test(String(probe || '')) ? 'docs/pine/W9-STRATEGY-DESIGN.md 5.2' : 'docs/pine/capture-queue-2026-10-05-s1.md'
    super(`${message}${probe ? ` (unsettled: ${probe}, ${where})` : ''}`)
    this.name = 'BrokerRefusal'
    this.guard = BROKER_UNSETTLED_GUARD
    this.probe = probe || null
  }
}

/** ⭐⭐ W9-T1 — a run REACHED an emulator rule that no MATCHing capture pins. Names the rule and
 *  the capture row that would pin it (`brokerRules.js`). Never a silent value. */
export class BrokerUnpinned extends Error {
  constructor(rule) {
    const cap = ruleCapture(rule)
    super(`the broker rule ${rule} is not pinned by a matching TradingView capture`
      + `${cap ? ` (capture row ${cap}, docs/pine/W9-STRATEGY-DESIGN.md 5.2)` : ' (no capture row is queued for it yet)'}`)
    this.name = 'BrokerUnpinned'
    this.guard = UNPINNED_GUARD
    this.rule = rule
    this.capture = cap
  }
}

/** ⭐⭐ W9-T1 — the run's bars are not the window a backtest may start from (3.4). */
export class BrokerStart extends Error {
  constructor(message) {
    super(message)
    this.name = 'BrokerStart'
    this.guard = BROKER_START_GUARD
  }
}

/** The broker's operations: name -> its parameters (positional, the frontend
 *  places named arguments) and what it leaves on the stack. ⭐ ONE TABLE: the
 *  program validator (`program.js`) and the front end both read it. */
export const BROKER_OPS = Object.freeze({
  // the symbol's tick and point value, through the columnar lane's own authority
  // (`syminfo.mintick` / `syminfo.pointvalue`, settled per symbol at bind)
  '#symbol': { params: ['mintick', 'pointvalue'], returns: 'void' },
  // ⭐⭐ W9-T7 — `oca_*`, `strategy.order`, the exit's `qty` / `qty_percent` / `trail_*`, and the
  // close's `qty` / `qty_percent` / `immediately` are parameters now (each behind its own rule,
  // `brokerRules.js`); `when` stays LAST so `vm.js`'s positional spread needs no special case.
  'strategy.entry': { params: ['id', 'direction', 'qty', 'limit', 'stop', 'oca_name', 'oca_type', 'when'], returns: 'void' },
  'strategy.order': { params: ['id', 'direction', 'qty', 'limit', 'stop', 'oca_name', 'oca_type', 'when'], returns: 'void' },
  'strategy.close': { params: ['id', 'qty', 'qty_percent', 'immediately', 'when'], returns: 'void' },
  'strategy.close_all': { params: ['immediately', 'when'], returns: 'void' },
  'strategy.exit': { params: ['id', 'from_entry', 'qty', 'qty_percent', 'profit', 'limit', 'loss', 'stop',
    'trail_price', 'trail_points', 'trail_offset', 'when'], returns: 'void' },
  'strategy.cancel': { params: ['id', 'when'], returns: 'void' },
  'strategy.cancel_all': { params: ['when'], returns: 'void' },
  // ── values ──
  'strategy.position_size': { params: [], returns: 'number' },
  'strategy.position_avg_price': { params: [], returns: 'number' },
  'strategy.opentrades': { params: [], returns: 'number' },
  'strategy.closedtrades': { params: [], returns: 'number' },
  'strategy.wintrades': { params: [], returns: 'number' },
  'strategy.losstrades': { params: [], returns: 'number' },
  'strategy.eventrades': { params: [], returns: 'number' },
  'strategy.netprofit': { params: [], returns: 'number' },
  'strategy.netprofit_percent': { params: [], returns: 'number' },
  'strategy.grossprofit': { params: [], returns: 'number' },
  'strategy.grossloss': { params: [], returns: 'number' },
  'strategy.openprofit': { params: [], returns: 'number' },
  'strategy.equity': { params: [], returns: 'number' },
  'strategy.initial_capital': { params: [], returns: 'number' },
  'strategy.opentrades.entry_price': { params: ['trade_num'], returns: 'number' },
  'strategy.opentrades.entry_bar_index': { params: ['trade_num'], returns: 'number' },
  'strategy.opentrades.size': { params: ['trade_num'], returns: 'number' },
  'strategy.closedtrades.entry_price': { params: ['trade_num'], returns: 'number' },
  'strategy.closedtrades.exit_price': { params: ['trade_num'], returns: 'number' },
  'strategy.closedtrades.entry_bar_index': { params: ['trade_num'], returns: 'number' },
  'strategy.closedtrades.exit_bar_index': { params: ['trade_num'], returns: 'number' },
  'strategy.closedtrades.size': { params: ['trade_num'], returns: 'number' },
  'strategy.closedtrades.profit': { params: ['trade_num'], returns: 'number' },
})

/** The values the broker serves (no arguments) — the front end's vocabulary. */
export const BROKER_VALUE_NAMES = Object.freeze(Object.keys(BROKER_OPS)
  .filter((k) => k.startsWith('strategy.') && BROKER_OPS[k].returns !== 'void' && BROKER_OPS[k].params.length === 0))
/** The per-trade functions it serves (one `trade_num` argument). */
export const BROKER_TRADE_FNS = Object.freeze(Object.keys(BROKER_OPS)
  .filter((k) => BROKER_OPS[k].params.length === 1 && BROKER_OPS[k].params[0] === 'trade_num'))
/** The order commands it serves. */
export const BROKER_ORDER_OPS = Object.freeze(Object.keys(BROKER_OPS)
  .filter((k) => k.startsWith('strategy.') && BROKER_OPS[k].returns === 'void'))

// ⭐ A Pine `bool` / series condition in this VM is 1 / 0, and `na` is NaN. An
// ABSENT `when` (`undefined`) is the documented default `true` ([B-WHEN]).
const truthy = (v) => v === undefined || v === true || (typeof v === 'number' && Number.isFinite(v) && v !== 0)
const finite = (v) => typeof v === 'number' && Number.isFinite(v)
const idText = (v, what) => {
  if (typeof v === 'string') return v
  throw new BrokerRefusal(`${what} takes a text id, got ${v === undefined ? 'nothing' : typeof v}`)
}

/**
 * Make one run's broker.
 *
 * @param {object} cfg   `program.broker` — the declaration as the front end read it:
 *   `{ pyramiding, defaultQty, qtyType, qtyValue, initialCapital, marginLong, marginShort }`.
 *   `defaultQty` is the FIXED default size (`null` for a cash / percent default or none);
 *   `qtyType` / `qtyValue` are the declared-or-defaulted `default_qty_*`, which `defaultSize`
 *   turns into units for an order whose `qty` is na ([B-QTY], W9-T4).
 * @param {object} data  `{ series }` — the VM's price series (open, high, low, close).
 */
export function makeBroker(cfg, data) {
  const [O, H, L, C] = data.series
  const times = data.barTimes || null
  // ⭐⭐ W9-T1 — `pinned(rule)`, asked when the run REACHES a rule. One-argument calls only: the
  // test-only pin set arrives as `data.isPinned` (a predicate), never as `pinned`'s second argument.
  const isPinned = typeof data.isPinned === 'function' ? data.isPinned : (id) => pinned(id)
  // ⭐ W9-T4 r1 — the symbol's minimum contract (`syminfo.mincontract`), as the run context states it;
  // undefined when the caller does not know it (today: every product caller)
  const minContract = data.minContract
  const okRules = new Set()
  const rule = (id) => {
    if (okRules.has(id)) return
    if (!isPinned(id)) throw new BrokerUnpinned(id)
    okRules.add(id)
  }
  const defaulted = cfg.defaulted || {}
  const maxEntries = Math.max(1, Math.floor(Number(cfg.pyramiding) || 0)) // [B-PYR]
  // ⭐⭐ W9-T6 — FILL TIMING, read from the declaration (`ast/strategyBroker.js`). Each setting off its
  // default asks its own rule when a run REACHES it, so a run that never does is unchanged.
  const poc = cfg.processOrdersOnClose === true // [B-POC] process_orders_on_close
  const coof = cfg.calcOnOrderFills === true // [B-FILLS] calc_on_order_fills
  // [B-TICK-HIST] R6 `calc_on_every_tick`: "a new execution ... on every available tick in each REALTIME
  // bar" - on history a bar executes once on its close. Asked once, before the first bar: it is the
  // whole run's execution model. (The forming bar is refused separately, Q-S1o, in `vm.js`.)
  if (cfg.calcOnEveryTick === true) rule('B-TICK-HIST')
  /** the price of the tick an extra execution runs on ([B-FILLS]); `null` while the script runs on the close */
  let tickPx = null
  let mintick = NaN
  let pointvalue = NaN
  let seq = 0

  /** open trades, oldest first: `{ entryId, dir, qty, price, bar, exact }` */
  const open = []
  /** closed trades, in close order: `+ { exitPrice, exitBar, profit }` (profit in price units × qty) */
  const closed = []
  /** unfilled entry orders: `{ id, kind ('entry' | 'order'), dir, qty, type, level, limit, placedBar,
   *  immediate, oca }`. A stop-limit waits as `type: 'stoplimit'` (its `level` the stop) and becomes a
   *  `limit` at `limit` once the stop is reached ([B-STOP-LIMIT], W9-T7). */
  let entries = []
  /** unfilled market exits from `strategy.close` / `close_all`: `{ kind, id, spec }` (`spec` the
   *  partial size, [B-CLOSE-QTY]) */
  let closes = []
  /** exit commands: `{ id, fromEntry, tp, sl, trail, qtySpec, all, trades:Set, orders:Set, maybe:Set,
   *  res:Map(trade -> reserved units), trailState:Map(trade -> { best }), done:Set }` */
  let exits = []
  /** ⭐ W9-T7 [B-EXIT-QTY] the trades each exit id has already exited from, kept past the command's
   *  own life: R4 `strategy.exit` "If the function strategy.exit is called once, it exits a position
   *  only once", so an exit re-called every bar does not exit the same trade a second time. */
  const exitDone = new Map()
  /** ⭐ W9-T7 [B-IMMEDIATELY] the bar an `immediately = true` close filled on, if any */
  let immediateBar = -1

  const needSymbol = () => {
    if (!finite(mintick) || !finite(pointvalue)) {
      throw new BrokerRefusal("the symbol's tick size or point value is unknown to this run")
    }
  }
  const onTick = (p) => {
    needSymbol()
    const k = p / mintick
    return Math.abs(k - Math.round(k)) < 1e-6
  }

  // ─── fills ────────────────────────────────────────────────────────────────
  const closeTrade = (t, price, bar, exact) => {
    const i = open.indexOf(t)
    if (i < 0) return
    open.splice(i, 1)
    closed.push({ ...t, exitPrice: price, exitBar: bar, exitRule: fillRule, exact: t.exact && exact, profit: (price - t.price) * t.dir * t.qty })
    for (const x of exits) { x.trades.delete(t); x.maybe.delete(t); x.res.delete(t) }
  }
  /** ⭐ W9-T7 — close `units` of trade `t`: the whole trade, or a split (a closed trade of `units`,
   *  the open one keeps the rest, its entry price, bar and id). [B-EXIT-QTY] [B-CLOSE-QTY] [B-ORDER] */
  const closePart = (t, units, price, bar, exact) => {
    if (units >= t.qty) { closeTrade(t, price, bar, exact); return }
    closed.push({ ...t, qty: units, exitPrice: price, exitBar: bar, exitRule: fillRule, exact: t.exact && exact,
      profit: (price - t.price) * t.dir * units })
    t.qty -= units
  }
  /** ⭐ W9-T7 — close `units` of the position, OLDEST trade first ([B-FIFO]; R6 `strategy.close`
   *  remarks: "exits from the position starting with the first open trade"). `allowed`, when given, are
   *  the trades the command names: touching any other is the FIFO split this broker does not model. */
  const reduceFifo = (units, price, bar, exact, allowed) => {
    rule('B-FIFO')
    let left = units
    for (const t of open.slice()) {
      if (!(left > 0)) break
      if (allowed && !allowed.includes(t)) {
        throw new BrokerRefusal('an exit targets an open trade that is not the oldest, and TradingView closes the '
          + 'oldest trades first (FIFO) with a split this broker does not model', 'Q-S1h')
      }
      const take = Math.min(left, t.qty)
      closePart(t, take, price, bar, exact)
      left -= take
    }
  }
  /** [B-FIFO] an exit fills against the OLDEST open trades first; this broker
   *  serves only fills whose targets ARE the oldest open trades. */
  const requireOldest = (targets) => {
    rule('B-FIFO')
    for (let i = 0; i < targets.length; i += 1) {
      if (!targets.includes(open[i])) {
        throw new BrokerRefusal('an exit targets an open trade that is not the oldest, and TradingView closes the '
          + 'oldest trades first (FIFO) with a split this broker does not model', 'Q-S1h')
      }
    }
  }
  const afterPositionChange = () => {
    if (exits.length) rule('B-EXIT-LIFE')
    // [B-EXIT-LIFE] an exit with no `from_entry` lives until the position closes; one
    // with a `from_entry` lives while it still has a trade or an unfilled entry to exit.
    if (open.length === 0) exits = exits.filter((x) => !x.all && (x.trades.size > 0 || x.orders.size > 0))
    else exits = exits.filter((x) => x.all || x.trades.size > 0 || x.orders.size > 0)
  }
  const marginCheck = (price) => {
    if (open.length === 0) return
    rule('B-MARGIN')
    if (defaulted.margin) rule('B-DEFAULTS')
    // ⭐ W9-T13a N7 — the check below reads EQUITY, which is net of every closed trade's commission, so
    // it rests on the commission being 0 (COMMISSION_RULE) whether or not the margin was defaulted
    rule(COMMISSION_RULE)
    const dir = open[0].dir
    const pct = dir > 0 ? cfg.marginLong : cfg.marginShort
    const ratio = finite(pct) ? pct / 100 : NaN
    if (!finite(ratio) || !finite(cfg.initialCapital)) {
      throw new BrokerRefusal('the margin or initial capital this strategy runs with is not settled')
    }
    needSymbol()
    let net = 0
    for (const t of closed) net += t.profit
    let openPl = 0
    let size = 0
    for (const t of open) { openPl += (price - t.price) * t.dir * t.qty; size += t.qty }
    const equity = cfg.initialCapital + (net + openPl) * pointvalue
    const mvs = size * price * pointvalue
    // [B-MARGIN] Available Funds = Equity - MVS * Margin Ratio; below zero the emulator
    // liquidates (a margin call) or refuses funds - neither is modelled here.
    if (equity - mvs * ratio < 0) {
      throw new BrokerRefusal('the position would need more funds than the strategy holds (a margin call or a '
        + 'rejected order in TradingView)', 'Q-S1i')
    }
  }
  /** the rule the fill being made rests on - stamped on the trade (the record's `rule`) */
  let fillRule = 'B-FILL'
  /** ⭐ W9-T7 [B-OCA] after `o` filled `q` units: the other unfilled orders of its group are cancelled
   *  (`strategy.oca.cancel`) or reduced by `q`, cancelled at 0 (`strategy.oca.reduce`). R6
   *  `strategy.oca.reduce`: "reduces the unfilled order by that order's size. If the unfilled order's
   *  size reaches 0 after reduction, it is the same as canceling the order entirely." */
  const ocaAfterFill = (o, q) => {
    if (!o.oca) return
    for (const e of entries.slice()) {
      if (e === o || !e.oca || e.oca.name !== o.oca.name || e.oca.type !== o.oca.type) continue
      if (o.oca.type === 'cancel') dropEntry(e)
      else { e.qty -= q; if (!(e.qty > 0)) dropEntry(e) }
    }
  }
  const dropEntry = (e) => {
    entries = entries.filter((x) => x !== e)
    for (const x of exits) x.orders.delete(e)
  }
  /** ⭐ W9-T7 — a new open trade from order `o`, bound to the exits waiting for it. */
  const openTrade = (o, price, bar, exact, reversed) => {
    const t = { entryId: o.id, dir: o.dir, qty: o.qty, price, bar, exact, seq: (seq += 1), entryRule: fillRule }
    open.push(t)
    for (const x of exits) {
      if (x.orders.has(o)) { x.orders.delete(o); bindExit(x, t) } else if (x.all) {
        // [B-EXIT-LIFE] "until the position closes": whether a reversal (close + open
        // on one fill) ends that life is not stated - such an exit MAY cover the new trade.
        if (reversed) x.maybe.add(t)
        else bindExit(x, t)
      }
    }
    return t
  }
  /** ⭐⭐ W9-T7 [B-ORDER] a `strategy.order` fill. R6 `strategy.order`: "not affected by the
   *  `pyramiding` parameter ... Strategies can open any number of trades in the same direction";
   *  "does not automatically reverse open positions ... if there is an open long position of five
   *  shares, an order from this command with a `qty` of 5 and a `direction` of strategy.short triggers
   *  the sale of five shares, which closes the position." Against the position it closes its size,
   *  oldest first ([B-FIFO]). ⛔ An order LARGER than the position it meets is not stated (does the rest
   *  open the other side?): refused, W9-X4. */
  const fillOrder = (o, price, bar, exact) => {
    entries = entries.filter((e) => e !== o)
    // B-ORDER was asked when this order was PLACED (`placeOrder`); every fill here is of a placed order,
    // so it is not asked twice (integration review N1: one ask, mutation-provable)
    if (!open.length || open[0].dir === o.dir) {
      const t = openTrade(o, price, bar, exact, false)
      ocaAfterFill(o, o.qty)
      marginCheck(price)
      return t
    }
    const total = sum(open, (t) => t.qty)
    if (o.qty > total) {
      throw new BrokerRefusal(`\`strategy.order\` \`${o.id}\` trades ${o.qty} against a position of ${total}, and whether `
        + 'the rest opens a position the other way is not stated', 'W9-X4')
    }
    // it opened no trade, so an exit waiting for this id has nothing to bind
    for (const x of exits) x.orders.delete(o)
    reduceFifo(o.qty, price, bar, exact, null)
    afterPositionChange()
    ocaAfterFill(o, o.qty)
    return null
  }
  const fillEntry = (o, price, bar, exact) => {
    if (o.kind === 'order') return fillOrder(o, price, bar, exact)
    entries = entries.filter((e) => e !== o)
    let reversed = false
    if (open.length && open[0].dir !== o.dir) {
      // [B-REVERSE] an entry against the position closes it and opens the new size
      rule('B-REVERSE')
      for (const t of open.slice()) closeTrade(t, price, bar, exact)
      reversed = true
    } else if (open.length >= maxEntries) {
      // [B-PYR] at the pyramiding limit a market entry does not execute
      rule('B-PYR')
      if (defaulted.pyramiding) rule('B-DEFAULTS')
      if (o.type === 'market') return null
      throw new BrokerRefusal(`a price entry \`${o.id}\` triggered at the pyramiding limit, and whether it is `
        + 'cancelled or kept waiting is not stated', 'Q-S1g')
    }
    if (open.length && maxEntries > 1) { rule('B-PYR'); if (defaulted.pyramiding) rule('B-DEFAULTS') }
    const t = openTrade(o, price, bar, exact, reversed)
    if (reversed) afterPositionChange()
    ocaAfterFill(o, o.qty)
    marginCheck(price)
    return t
  }

  // ─── W9-T7: exit binding, reservation and the trailing stop ──────────────────
  /** The activation level of exit `x`'s trailing stop for trade `t` (NaN = none). */
  const activationOf = (x, t) => {
    if (!x.trail) return NaN
    if (finite(x.trail.price)) return x.trail.price
    needSymbol()
    return t.price + t.dir * x.trail.points * mintick
  }
  /** ⭐⭐ W9-T7 bind exit `x` to trade `t`: check its trailing stop, then reserve its share. */
  const bindExit = (x, t) => {
    if (x.done.has(t)) return
    x.trades.add(t)
    x.maybe.delete(t)
    if (x.trail) {
      // R6 `trail_price`: "If the value is more favorable than the entry price, the command creates a
      // trailing stop when the market price reaches that value. If less favorable than the entry price,
      // the command creates the trailing stop immediately ..." - the second case's starting point (the
      // activation level, or the entry fill?) is not stated, so only the first is served.
      const act = activationOf(x, t)
      if (!(t.dir > 0 ? act > t.price : act < t.price)) {
        throw new BrokerRefusal(`\`strategy.exit\` \`${x.id}\`'s trailing stop activates at ${act}, not beyond the entry `
          + `price ${t.price}, and where such a stop starts is not stated`, 'W9-X1')
      }
    }
    reserve(x, t)
  }
  /**
   * ⭐⭐ W9-T7 [B-EXIT-QTY] — how much of trade `t` exit `x` may close. R6 `strategy.exit`: "Each call to
   * this command reserves a portion of the position to close until the strategy fills or cancels its
   * orders. For example, if there is an open position of 50 contracts and a strategy.exit() call
   * specifies a `qty` of 20, that call's orders reserve 20 contracts out of the position. A second call
   * can close a maximum of 30 contracts, even if its `qty` is 50 and one of its orders executes first."
   * `qty_percent`: "The percentage calculation depends on the total size of the applicable open trades
   * without considering the reserved amount from other strategy.exit() calls."
   *
   * HYPOTHESIS (unpinned until W9-X2 MATCHes): a call with no `qty` reserves the whole trade; each call
   * reserves `min(wanted, trade size - what the OTHER exits on that trade reserve)`, recomputed on every
   * call of that id; a reservation of 0 places no order. ⭐ ONE full exit alone on a trade is S1's served
   * case and asks nothing new; a SECOND command on the same trade, or any partial size, asks B-EXIT-QTY.
   * ⛔ Refused by name (W9-X2): a percent that is not a whole number of units, a partial size spread
   * over more than one trade (per trade or in total is not stated).
   */
  const reserve = (x, t) => {
    const others = exits.filter((y) => y !== x && (y.trades.has(t) || y.maybe.has(t)))
    if (!x.qtySpec && !others.length) { x.res.delete(t); return }
    // ⭐⭐ Several FULL exit commands on one trade: S1 (master) lets each one fill if its level is reached
    // first. The reservation reading changes that (a second full exit gets nothing), so it is taken ONLY
    // when B-EXIT-QTY is pinned; unpinned, the run keeps S1's behaviour exactly and asks nothing new
    // (coordinator ruling 2026-11-08; rail: w9T7Exits "S1's behaviour while B-EXIT-QTY is unpinned").
    // A PARTIAL size has no S1 behaviour to keep: `exit` asks B-EXIT-QTY at the partial command's own call,
    // so with the rule unpinned no partial size ever reaches this line (one guard, not two).
    if (!isPinned('B-EXIT-QTY')) {
      x.res.delete(t)
      for (const y of others) y.res.delete(t)
      return
    }
    rule('B-EXIT-QTY')
    if (x.qtySpec && x.trades.size + x.maybe.size > 1) {
      throw new BrokerRefusal(`\`strategy.exit\` \`${x.id}\` closes part of more than one open trade, and whether its `
        + 'size applies to each trade or to them together is not stated', 'W9-X2')
    }
    let want = t.qty
    if (x.qtySpec && x.qtySpec.qty !== undefined) want = x.qtySpec.qty
    else if (x.qtySpec) {
      want = t.qty * x.qtySpec.pct / 100
      if (Math.abs(want - Math.round(want)) > 1e-9) {
        throw new BrokerRefusal(`\`strategy.exit\` \`${x.id}\` closes ${x.qtySpec.pct}% of ${t.qty}, which is not a whole `
          + 'number of units, and how TradingView rounds it is not stated', 'W9-X2')
      }
      want = Math.round(want)
    }
    const taken = sum(others, (y) => (y.res.has(t) ? y.res.get(t) : t.qty))
    x.res.set(t, Math.max(0, Math.min(want, t.qty - taken)))
  }
  /** ⭐⭐ W9-T7 [B-TRAIL] the trailing stops' best price moves with the market: called with each
   *  price the intrabar path REACHES (the open, then each segment's end). Between those points the
   *  path is monotonic, so a segment's end is its extreme, and a trailing stop can only fill on the
   *  segment against it, where its best does not move. */
  const ratchetTrails = (px) => {
    for (const x of exits) {
      if (!x.trail) continue
      for (const [t, st] of x.trailState) {
        if (!x.trades.has(t)) continue
        if (t.dir > 0 ? px > st.best : px < st.best) st.best = px
      }
    }
  }
  /** The trailing stop's level for a trade whose stop is active: `trail_offset` ticks behind the best. */
  const trailLevel = (x, t, st) => {
    needSymbol()
    // the best is a price the path reached; on the tick grid the level is counted in whole ticks, and
    // divided (not multiplied) back so 10500 ticks of 0.01 read 105, not 105.00000000000001
    const inv = Math.round(1 / mintick)
    if (onTick(st.best) && Math.abs(inv * mintick - 1) < 1e-12) {
      return (Math.round(st.best / mintick) - t.dir * x.trail.offset) / inv
    }
    return st.best - t.dir * x.trail.offset * mintick
  }

  /** An exit command's two levels for one trade: `{ tp, sl }` (NaN = none). */
  const levelsFor = (x, t) => {
    const lv = (spec, sign) => {
      if (!spec) return NaN
      const rel = () => { needSymbol(); return t.price + sign * t.dir * spec.ticks * mintick }
      if (spec.both) {
        // ⭐⭐ W9-T7 [B-EXIT-LEVELS] both a price and a tick distance for one leg. HYPOTHESIS by
        // version (Q-S1k, `w9-q-s1k-exit-levels.pine` and `-v6`): R5 `strategy.exit` `profit`: "The
        // command ignores this parameter if the limit value is not na" - v5 keeps the PRICE; R6
        // `profit`: "If this parameter and `limit` are not na, the command places a take-profit order
        // only at the price level expected to trigger an exit first" - v6 keeps the level NEARER the
        // entry on that leg's side (a take-profit's lower level for a long, a stop's higher one).
        if (cfg.version === 5) return spec.abs
        const r = rel()
        // the level reached first: for a long's take-profit (sign +1) the lower; its stop (sign -1) the higher
        return sign * t.dir > 0 ? Math.min(spec.abs, r) : Math.max(spec.abs, r)
      }
      if (finite(spec.abs)) return spec.abs
      return rel()
    }
    return { tp: lv(x.tp, 1), sl: lv(x.sl, -1) }
  }
  /** Every live price order right now, each `{ kind, level, up, x?, t?, o? }`:
   *  `up` true when it triggers on a RISE to `level`. */
  const liveOrders = () => {
    const out = []
    for (const o of entries) {
      if (o.type === 'market' || o.immediate) continue
      // [B-STOP-LIMIT] a stop-limit waits on its STOP, which triggers as a stop does
      if (o.type === 'stoplimit') { out.push({ kind: 'trigger', level: o.level, up: o.dir > 0, o }); continue }
      // long limit / short stop trigger on a fall; long stop / short limit on a rise
      const up = (o.type === 'stop') === (o.dir > 0)
      out.push({ kind: 'entry', level: o.level, up, o })
    }
    for (const x of exits) {
      for (const [set, maybe] of [[x.trades, false], [x.maybe, true]]) {
        for (const t of set) {
          // [B-EXIT-QTY] a command left nothing to close of this trade places no order
          if (x.res.get(t) === 0) continue
          const { tp, sl } = levelsFor(x, t)
          // a long's take-profit triggers on a rise, its stop-loss on a fall
          if (finite(tp)) out.push({ kind: 'exit', level: tp, up: t.dir > 0, x, t, maybe, leg: 'tp' })
          if (finite(sl)) out.push({ kind: 'exit', level: sl, up: t.dir < 0, x, t, maybe, leg: 'sl' })
          if (x.trail) {
            // [B-TRAIL] before activation the stop does not exist; its activation level is reached
            // like a take-profit's. After it, a stop `trail_offset` ticks behind the best price.
            const st = x.trailState.get(t)
            if (!st) out.push({ kind: 'activate', level: activationOf(x, t), up: t.dir > 0, x, t, maybe })
            else out.push({ kind: 'exit', level: trailLevel(x, t, st), up: t.dir < 0, x, t, maybe, leg: 'trail' })
          }
        }
      }
    }
    return out
  }
  /** Is this order's level already reached with the market at `p`? */
  const reachedAt = (lo, p) => (lo.up ? p >= lo.level : p <= lo.level)
  const fire = (lo, price, bar, exact) => {
    if (lo.maybe) {
      throw new BrokerRefusal(`exit \`${lo.x.id}\` (no \`from_entry\`) would fill on the trade a reversal opened, and `
        + 'whether a reversal ends that exit is not stated', 'Q-S1f')
    }
    if (lo.kind === 'entry') return fillEntry(lo.o, price, bar, exact)
    if (lo.kind === 'trigger') {
      // ⭐⭐ W9-T7 [B-STOP-LIMIT] R6 `strategy.entry`: a stop-limit "generates a limit order at the
      // `limit` price only after the market price reaches the `stop` value or a worse price". No fill.
      rule('B-STOP-LIMIT')
      lo.o.type = 'limit'
      lo.o.level = lo.o.limit
      return null
    }
    if (lo.kind === 'activate') {
      // ⭐⭐ W9-T7 [B-TRAIL] R6 `trail_offset`: "When the market price reaches the activation level ...
      // the command creates a trailing stop with an initial value `trail_offset` ticks away from that
      // level". The best starts at the price the activation was reached at (the level on the path,
      // the open on a gap). No fill.
      rule('B-TRAIL')
      lo.x.trailState.set(lo.t, { best: price })
      return null
    }
    rule('B-EXIT-BIND')
    const keep = fillRule
    if (lo.leg === 'trail') fillRule = 'B-TRAIL'
    requireOldest([lo.t])
    const units = lo.x.res.has(lo.t) ? lo.x.res.get(lo.t) : lo.t.qty
    if (units > lo.t.qty) {
      throw new BrokerRefusal(`exit \`${lo.x.id}\` reserved ${units} of a trade that now holds ${lo.t.qty}, and what `
        + 'TradingView fills then is not stated', 'W9-X2')
    }
    if (units < lo.t.qty) {
      // [B-EXIT-QTY] a partial exit closes its reserved part; that command is done with the trade
      fillRule = lo.leg === 'trail' ? 'B-TRAIL' : 'B-EXIT-QTY'
      closePart(lo.t, units, price, bar, exact)
      lo.x.trades.delete(lo.t); lo.x.res.delete(lo.t); lo.x.done.add(lo.t)
    } else {
      lo.x.done.add(lo.t)
      closeTrade(lo.t, price, bar, exact)
    }
    fillRule = keep
    afterPositionChange()
    return null
  }
  /** After a fill at `p`, exits that just became live must not already be reached. */
  const checkActivation = (p, fresh) => {
    if (!fresh) return
    for (const lo of liveOrders()) {
      if (lo.kind === 'exit' && lo.t === fresh && reachedAt(lo, p)) {
        throw new BrokerRefusal(`exit \`${lo.x.id}\` became active at a price already past its level, and where `
          + 'TradingView fills it then is not stated', 'Q-S1e')
      }
    }
  }

  /** ⭐⭐ W9-T6 — ONE TICK'S FILLS, for the three ticks a market order can fill on:
   *  - `open`: the next bar's open ([B-FILL] / [B-MARKET], [B-GAP], [B-IMMEDIATE]);
   *  - `poc`: the bar's own close, for the orders its close execution placed ([B-POC], [B-POC-PRICE]);
   *  - `vertex`: the next path vertex, for a market order an extra execution placed ([B-FILLS]).
   *  More than one order on one tick (other than one exit command's legs) is refused (Q-S1d).
   *  Returns `{ filled, fresh }`: whether any order filled, and the trade an entry opened. */
  const tickFill = (px, bar, mode) => {
    const atClose = mode === 'poc'
    // [B-POC-PRICE] HYPOTHESIS, the R6 reading (W9-P1 / W9-P1b grade it): "an additional attempt to
    // execute orders after a bar closes" names no subset, so EVERY live order gets the close attempt,
    // whichever execution placed it. An order placed before the close execution (an older one, or one an
    // extra execution placed) that the close meets has already met its level on the path, which ends at
    // the close, so only the close execution's orders can fill here (railed: w9T6FillTiming, X4).
    const markets = entries.filter((e) => e.type === 'market' || e.immediate)
    const cls = closes.slice()
    const gaps = mode === 'vertex' ? [] : liveOrders().filter((lo) => reachedAt(lo, px))
    const n = markets.length + cls.length + gaps.length
    if (n === 0) return { filled: false, fresh: null }
    const oneCommand = gaps.length > 0 && markets.length + cls.length === 0
      && gaps.every((g) => g.kind === 'exit' && g.x === gaps[0].x)
      && new Set(gaps.map((g) => g.t)).size === gaps.length
    if (n > 1 && !oneCommand) {
      const where = atClose ? 'closing tick' : mode === 'vertex' ? 'tick' : 'opening tick'
      throw new BrokerRefusal(`${n} orders fill on the same ${where}, and the order TradingView fills them in is not stated`, 'Q-S1d')
    }
    let fresh = null
    if (cls.length) {
      const cl = cls[0]
      closes = closes.filter((c) => !cls.includes(c))
      // a vertex fill is LABELLED B-FILLS and asks nothing more: `beginBar` asked B-FILLS before the
      // extra execution that placed the order (and asks it again before the one this fill starts)
      if (atClose) { fillRule = 'B-POC'; rule('B-CLOSE'); rule('B-POC') } else if (mode === 'vertex') {
        fillRule = 'B-FILLS'
      } else { fillRule = 'B-CLOSE'; rule('B-CLOSE'); rule('B-MARKET') }
      executeClose(cl, px, bar, true)
    } else if (markets.length) {
      const m = markets[0]
      if (atClose) fillRule = m.immediate ? 'B-POC-PRICE' : 'B-POC'
      else if (mode === 'vertex') { fillRule = 'B-FILLS'; if (m.immediate) rule('B-IMMEDIATE') } else fillRule = m.immediate ? 'B-IMMEDIATE' : 'B-MARKET'
      if (mode !== 'vertex') rule(fillRule)
      if (m.immediate && !atClose) {
        // [B-IMMEDIATE] placed at a worse price than the market: fills on the next tick - served only
        // while that tick still satisfies the order. (At the close, POC, it is the tick it was placed on.)
        const ok = m.type === 'limit' ? (m.dir > 0 ? px <= m.level : px >= m.level)
          : (m.dir > 0 ? px >= m.level : px <= m.level)
        if (!ok) {
          throw new BrokerRefusal(`order \`${m.id}\` was placed beyond the market and the next ${mode === 'vertex' ? 'tick' : 'open'} `
            + 'moved back past its price', 'Q-S1e')
        }
      }
      // [B-POC-PYR] a close fill that adds to the open position
      if (atClose && open.length && open[0].dir === m.dir) rule('B-POC-PYR')
      const before = open.length + closed.length
      fresh = fillEntry(m, px, bar, true)
      if (!fresh && open.length + closed.length === before) return { filled: false, fresh: null }
    } else {
      fillRule = atClose ? 'B-POC-PRICE' : 'B-GAP'
      rule(fillRule)
      for (const g of gaps) fresh = fire(g, px, bar, true) || fresh
    }
    return { filled: true, fresh }
  }

  /** ⭐ [B-FILL] fill everything bar `bar` fills, BEFORE the script runs on it.
   *  ⭐⭐ W9-T6 — a GENERATOR, so a run under calc_on_order_fills can stop at a fill tick, run the script
   *  there (`vm.js`), and resume the walk from that tick. Without it the walk never yields. */
  function* barTicks(bar) {
    if (bar <= 0) return
    if (entries.length || closes.length || exits.length) rule('B-FILL')
    const o = O[bar]; const h = H[bar]; const l = L[bar]; const c = C[bar]
    if (![o, h, l, c].every(finite)) {
      if (entries.length || closes.length || exits.length) {
        throw new BrokerRefusal('a bar without prices arrived while orders were waiting')
      }
      return
    }
    // ── the open tick ([B-MARKET], [B-GAP], [B-IMMEDIATE]) ──
    const opened = tickFill(o, bar, 'open')
    marginCheckBar(bar)
    checkActivation(o, opened.fresh)
    ratchetTrails(o)
    if (coof && opened.filled) { tickPx = o; yield o; afterExtra(o) }
    // ── the path through the bar ([B-PATH]) ──
    if (!(h > l)) {
      if (coof && waiting()) {
        throw new BrokerRefusal('an extra execution placed an order on a bar with no range left to fill it on', 'W9-P2')
      }
      return
    }
    fillRule = 'B-PATH'
    if (liveOrders().some((lo) => lo.level >= l && lo.level <= h)) rule('B-PATH')
    const dh = h - o; const dl = o - l
    let path
    if (dh < dl) path = [h, l, c]
    else if (dl < dh) path = [l, h, c]
    else {
      if (liveOrders().some((lo) => lo.level >= l && lo.level <= h) || (coof && waiting())) {
        throw new BrokerRefusal('the bar opened exactly half-way between its high and low, so the order in which '
          + 'TradingView assumes it reached them is not stated', 'Q-S1c')
      }
      return
    }
    // [B-FILLS] a fill on the CLOSING tick under calc_on_order_fills: whether that is one execution or two is
    // not stated, so it stops the run by name.
    const closingTick = () => {
      throw new BrokerRefusal('an order filled on the closing tick of a bar under `calc_on_order_fills`, and whether '
        + 'the bar then executes once or twice is not stated', 'W9-P2')
    }
    let p = o
    for (let si = 0; si < path.length; si += 1) {
      const target = path[si]
      const last = si === path.length - 1
      for (let guard = 0; guard < 10000; guard += 1) {
        const up = target > p
        const lows = liveOrders().filter((lo) => lo.up === up && (up
          ? lo.level > p && lo.level <= target
          : lo.level < p && lo.level >= target))
        if (!lows.length) break
        const best = up ? Math.min(...lows.map((x) => x.level)) : Math.max(...lows.map((x) => x.level))
        const hit = lows.filter((x) => x.level === best)
        if (hit.length > 1 && !(hit.every((x) => x.kind === 'exit' && x.x === hit[0].x)
          && new Set(hit.map((x) => x.t)).size === hit.length)) {
          throw new BrokerRefusal(`${hit.length} orders sit at the same price ${best}, and the order TradingView `
            + 'fills them in is not stated', 'Q-S1d')
        }
        if (coof && best === target && waiting()) {
          throw new BrokerRefusal(`a price order at ${best} and a market order from an extra execution meet on one tick, `
            + 'and the order TradingView fills them in is not stated', 'Q-S1d')
        }
        p = best
        let made = null
        for (const x of hit) made = fire(x, best, bar, onTick(best)) || made
        checkActivation(best, made)
        if (coof) {
          if (last && best === target) closingTick()
          tickPx = best; yield best; afterExtra(best)
        }
      }
      p = target
      ratchetTrails(target)
      // [B-FILLS] a market order an extra execution placed fills on the next tick: this vertex
      if (coof && waiting()) {
        const r = tickFill(target, bar, 'vertex')
        checkActivation(target, r.fresh)
        if (r.filled) {
          if (last) closingTick()
          tickPx = target; yield target; afterExtra(target)
        }
      }
    }
  }
  /** [B-FILLS] after an extra execution at `px`: a price order it placed already past its level there would
   *  fill on the next tick at a price that is not stated - the run stops by name. */
  const afterExtra = (px) => {
    for (const lo of liveOrders()) {
      if (reachedAt(lo, px)) {
        throw new BrokerRefusal(`an order an extra execution placed is already past its level ${lo.level} at that tick, `
          + 'and where TradingView fills it then is not stated', 'Q-S1e')
      }
    }
  }
  /** a market order (or close) is waiting for a tick: only an extra execution leaves one mid-bar */
  const waiting = () => closes.length > 0 || entries.some((e) => e.type === 'market' || e.immediate)
  let ticking = null
  let tickingBar = -1
  /** Walk bar `bar`'s fills up to the next tick that re-runs the script. `true`: the walk stopped at a fill
   *  under calc_on_order_fills and the script runs there (an extra execution); call again to resume.
   *  `false`: the bar's fills are done and the script runs on the close. */
  const beginBar = (bar) => {
    if (tickingBar !== bar) { tickingBar = bar; ticking = barTicks(bar) }
    tickPx = null
    if (!ticking) return false
    const step = ticking.next()
    if (step.done) { ticking = null; tickPx = null; return false }
    // [B-FILLS] ONE ask, for every extra execution, before the script runs there
    rule('B-FILLS')
    return true
  }
  /** ⭐⭐ W9-T6 [B-POC] — after the script ran on bar `bar`'s close: under process_orders_on_close the orders
   *  that close execution placed get their attempt AT the close. `true`: an order filled there and
   *  calc_on_order_fills re-runs the script on this bar ([B-POC-FILLS]). */
  const endBar = (bar) => {
    if (!poc) return false
    const c = C[bar]
    if (!finite(c)) return false
    const r = tickFill(c, bar, 'poc')
    if (!r.filled) return false
    checkActivation(c, r.fresh)
    if (coof) { rule('B-POC-FILLS'); return true }
    return false
  }
  /** [B-CLOSE] a market close's fill: the trades of its id (or all), whole, or ([B-CLOSE-QTY], W9-T7)
   *  its size of them, oldest first. */
  const executeClose = (cl, price, bar, exact) => {
    const targets = cl.kind === 'all' ? open.slice() : open.filter((t) => t.entryId === cl.id)
    if (!cl.spec) {
      requireOldest(targets)
      for (const t of targets) closeTrade(t, price, bar, exact)
    } else {
      // R6 `strategy.close` `qty_percent`: "The percentage calculation depends on the total size of the
      // open trades with the `id` entry identifier"; remarks: "the maximum exit order size still
      // depends on the trades opened by orders with the `id` identifier" - a larger `qty` closes them all.
      const total = sum(targets, (t) => t.qty)
      let units = cl.spec.qty !== undefined ? Math.min(cl.spec.qty, total) : total * cl.spec.pct / 100
      if (Math.abs(units - Math.round(units)) > 1e-9) {
        throw new BrokerRefusal(`\`strategy.close\` \`${cl.id}\` closes ${cl.spec.pct}% of ${total}, which is not a whole `
          + 'number of units, and how TradingView rounds it is not stated', 'W9-X2')
      }
      units = Math.round(units)
      if (units > 0) reduceFifo(units, price, bar, exact, targets)
    }
    afterPositionChange()
  }
  /** [B-MARGIN] the bar's worst price for the position, after its fills. */
  const marginCheckBar = (bar) => {
    if (!open.length) return
    marginCheck(open[0].dir > 0 ? L[bar] : H[bar])
  }

  // ─── the order commands (called while the script runs on `bar`) ───────────
  /** ⭐⭐ W9-T7 x W9-T6 — the T7 order kinds were built and railed on the DEFAULT timing only. Under
   *  `process_orders_on_close` (an attempt at the close, W9-P1) or `calc_on_order_fills` (extra executions
   *  on fill ticks, W9-P2) no capture combines them with a trailing stop, a partial size, an OCA group,
   *  strategy.order, a stop-limit or an immediate close, so the run stops by name. */
  const t7DefaultTimingOnly = (what) => {
    if (poc || coof) {
      throw new BrokerRefusal(`${what} under ${poc ? 'process_orders_on_close' : 'calc_on_order_fills'} is not served `
        + '(no capture combines the two)', poc ? 'W9-P1' : 'W9-P2')
    }
  }
  /** ⭐ W9-T7 [B-OCA] an order's One-Cancels-All group: `null`, or `{ name, type }`. R6 `oca_name`:
   *  "The default is an empty string, which means the order does not belong to an OCA group";
   *  `strategy.oca.none`: "the order executes independently of all other orders, including those with
   *  the same `oca_name`". The front end reads `strategy.oca.*` as the texts 'none' / 'cancel' / 'reduce'. */
  const ocaOf = (nameV, typeV, fn) => {
    const name = nameV === undefined ? '' : idText(nameV, `${fn} oca_name`)
    const type = typeV === undefined ? 'none' : typeV
    if (type !== 'none' && type !== 'cancel' && type !== 'reduce') {
      throw new BrokerRefusal(`${fn} oca_type ${String(typeV)} is not strategy.oca.none / cancel / reduce`)
    }
    if (name === '') return null
    rule('B-OCA')
    t7DefaultTimingOnly(`${fn} with an OCA group`)
    return type === 'none' ? null : { name, type }
  }
  /** `strategy.entry` (kind 'entry') and ⭐ W9-T7 `strategy.order` (kind 'order', [B-ORDER]). */
  const placeOrder = (a, bar, kind) => {
    const [id0, dirV, qtyV, limV, stpV, ocaN, ocaT, when] = a
    const fn = kind === 'order' ? '`strategy.order`' : '`strategy.entry`'
    rule('B-SIG')
    if (when !== undefined) rule('B-WHEN')
    if (!truthy(when)) return
    if (kind === 'order') { rule('B-ORDER'); t7DefaultTimingOnly('`strategy.order`') }
    const id = idText(id0, fn)
    rule('B-DIR')
    let dir
    if (dirV === 1 || dirV === true) dir = 1
    else if (dirV === 0 || dirV === -1 || dirV === false) dir = -1
    else throw new BrokerRefusal(`${fn} direction ${String(dirV)} is neither long nor short`)
    const lim = finite(limV); const stp = finite(stpV)
    const type = lim && stp ? 'stoplimit' : (lim ? 'limit' : (stp ? 'stop' : 'market'))
    const level = stp ? stpV : (lim ? limV : NaN)
    // ⭐⭐ W9-T6 — an extra execution ([B-FILLS]) runs at its fill tick's price, not the close
    const cl = tickPx === null ? C[bar] : tickPx
    if (type === 'stoplimit') {
      // ⭐⭐ W9-T7 [B-STOP-LIMIT] served only where the reference's sentence is the whole story: the
      // stop not yet reached at the signal close, and the limit strictly BETTER than the stop (a long's
      // below it), so the limit cannot fill on the stop's own tick. Otherwise refused by name (Q-S1j):
      // whether a limit at or beyond the stop fills at the stop's tick, and at which price, is not stated.
      rule('B-STOP-LIMIT')
      t7DefaultTimingOnly(`the stop-limit ${fn}`)
      if (dir > 0 ? stpV <= cl : stpV >= cl) {
        throw new BrokerRefusal(`the stop-limit ${fn} \`${id}\` was placed with its stop already reached, and when its `
          + 'limit becomes live then is not stated', 'Q-S1j')
      }
      if (dir > 0 ? !(limV < stpV) : !(limV > stpV)) {
        throw new BrokerRefusal(`the stop-limit ${fn} \`${id}\` has its limit at or beyond its stop, and whether it fills on `
          + 'the stop\'s own tick is not stated', 'Q-S1j')
      }
    }
    let qty = qtyV
    // [B-QTY] na -> the declaration's default order size (W9-T4: fixed, cash or percent of equity)
    if (!finite(qty)) qty = defaultSize(type === 'stoplimit' ? 'stop-limit' : type, id, bar)
    if (!(qty > 0)) throw new BrokerRefusal(`${fn} with a quantity of ${qty}`, 'Q-S1a')
    // [B-IMMEDIATE] a limit at a worse price than the market (or a stop at a better
    // one) fills on the next tick rather than waiting
    const immediate = type === 'limit' ? (dir > 0 ? level >= cl : level <= cl)
      : type === 'stop' ? (dir > 0 ? level <= cl : level >= cl) : false
    const oca = ocaOf(ocaN, ocaT, fn)
    const o = { id, kind, dir, qty, type, level, limit: type === 'stoplimit' ? limV : NaN, placedBar: bar, immediate, oca }
    // [B-MODIFY] an unfilled order with the same id is modified, not duplicated
    const prev = entries.find((e) => e.id === id)
    if (prev) {
      if (prev.kind !== kind) {
        throw new BrokerRefusal(`the id \`${id}\` names an unfilled order of both strategy.entry and strategy.order, and `
          + 'whether one modifies the other is not stated', 'W9-X4')
      }
      rule('B-MODIFY')
      Object.assign(prev, o)
      return
    }
    entries.push(o)
  }
  /** `strategy.close` / `close_all` size: `null` (all of it), or ⭐ W9-T7 [B-CLOSE-QTY] `{ qty }` /
   *  `{ pct }`. R6 `qty`: "If specified, the command uses this value instead of `qty_percent`". */
  const closeSpec = (qtyV, pctV, fn) => {
    if (finite(qtyV)) {
      if (!(qtyV > 0)) throw new BrokerRefusal(`${fn} with a quantity of ${qtyV}`, 'W9-X2')
      return { qty: qtyV }
    }
    if (finite(pctV) && pctV !== 100) {
      if (!(pctV > 0 && pctV < 100)) throw new BrokerRefusal(`${fn} with qty_percent ${pctV}`, 'W9-X2')
      return { pct: pctV }
    }
    return null
  }
  /** ⭐⭐ W9-T7 [B-IMMEDIATELY] R6 `strategy.close` `immediately`: "If true, the closing order executes on
   *  the same tick when the strategy places it, ignoring the strategy properties that restrict execution
   *  to the opening tick of the following bar." On a historical bar the script runs on the close, so the
   *  fill is at the bar's close and is stamped on that bar. ⛔ Whether a `strategy.*` value read later
   *  in the SAME execution sees it is not stated: such a read refuses (W9-X4, `value`). */
  const closeNow = (cl, bar) => {
    rule('B-IMMEDIATELY')
    t7DefaultTimingOnly('a close with `immediately = true`')
    const keep = fillRule
    fillRule = 'B-IMMEDIATELY'
    executeClose(cl, C[bar], bar, onTick(C[bar]))
    fillRule = keep
    immediateBar = bar
  }
  const close = (a, bar) => {
    const [id0, qtyV, pctV, now, when] = a
    rule('B-SIG'); rule('B-CLOSE')
    if (when !== undefined) rule('B-WHEN')
    if (!truthy(when)) return
    const id = idText(id0, '`strategy.close`')
    const spec = closeSpec(qtyV, pctV, '`strategy.close`')
    if (spec) { rule('B-CLOSE-QTY'); t7DefaultTimingOnly('a partial `strategy.close`') }
    // [B-CLOSE] no open trade with this id when the command is called: no effect
    if (!open.some((t) => t.entryId === id)) return
    if (now !== undefined && truthy(now)) { closeNow({ kind: 'id', id, spec }, bar); return }
    const prev = closes.find((c) => c.kind === 'id' && c.id === id)
    if (prev && (spec || prev.spec)) {
      throw new BrokerRefusal(`\`strategy.close\` \`${id}\` was called twice on one bar with a partial size, and whether `
        + 'that is one order or two is not stated', 'W9-X2')
    }
    if (!prev) closes.push({ kind: 'id', id, spec })
  }
  const closeAll = (a, bar) => {
    const [now, when] = a
    rule('B-SIG'); rule('B-CLOSE')
    if (when !== undefined) rule('B-WHEN')
    if (!truthy(when)) return
    if (!open.length) return
    if (now !== undefined && truthy(now)) { closeNow({ kind: 'all', spec: null }, bar); return }
    if (!closes.some((c) => c.kind === 'all')) closes.push({ kind: 'all', spec: null })
  }
  const exit = (a) => {
    const [id0, from0, qtyV, pctV, profit, limit, loss, stop, trP, trPts, trOff, when] = a
    rule('B-SIG')
    if (when !== undefined) rule('B-WHEN')
    if (!truthy(when)) return
    rule('B-EXIT-BIND')
    const id = idText(id0, '`strategy.exit`')
    const from = from0 === undefined || from0 === '' ? '' : idText(from0, '`strategy.exit` from_entry')
    // ⭐⭐ W9-T7 [B-EXIT-LEVELS] both a price and a distance for one leg: the version's rule (`levelsFor`).
    // v4 refuses: no v4 text for the pair was read.
    const both = (abs, ticks, word) => {
      rule('B-EXIT-LEVELS')
      if (cfg.version !== 5 && cfg.version !== 6) {
        throw new BrokerRefusal(`\`strategy.exit\` with both ${word} in Pine version ${cfg.version}`, 'Q-S1k')
      }
      return { both: true, abs, ticks }
    }
    const tp = finite(profit) && finite(limit) ? both(limit, profit, '`profit` and `limit`')
      : (finite(limit) ? { abs: limit } : (finite(profit) ? { ticks: profit } : null))
    const sl = finite(loss) && finite(stop) ? both(stop, loss, '`loss` and `stop`')
      : (finite(stop) ? { abs: stop } : (finite(loss) ? { ticks: loss } : null))
    for (const s of [tp, sl]) {
      if (s && s.ticks !== undefined && !Number.isInteger(s.ticks)) {
        throw new BrokerRefusal(`\`strategy.exit\` with a distance of ${s.ticks} ticks, not a whole number of ticks`, 'Q-S1k')
      }
    }
    // ⭐⭐ W9-T7 [B-TRAIL] R6 `strategy.exit`: "This command can create trailing stop orders when its call
    // specifies a `trail_price` or `trail_points` argument and a `trail_offset` argument."
    let trail = null
    if (finite(trP) || finite(trPts) || finite(trOff)) {
      rule('B-TRAIL')
      t7DefaultTimingOnly('a trailing stop')
      if (!(finite(trP) || finite(trPts)) || !finite(trOff)) {
        throw new BrokerRefusal('`strategy.exit` with only half of a trailing stop (an activation level and an offset '
          + 'are both needed), and what it places then is not stated', 'W9-X1')
      }
      if (finite(trP) && finite(trPts)) {
        throw new BrokerRefusal('`strategy.exit` with both `trail_price` and `trail_points`: "the value expected to '
          + 'activate the stop first" is not served', 'W9-X1')
      }
      if (sl) {
        // R6 remarks: "If a strategy.exit() call includes arguments for creating stop-loss and trailing
        // stop orders, the command places only the order that is supposed to fill first"
        throw new BrokerRefusal('`strategy.exit` with a stop-loss and a trailing stop: "only the order that is supposed '
          + 'to fill first" is not served', 'W9-X1')
      }
      if (!(Number.isInteger(trOff) && trOff > 0)) {
        throw new BrokerRefusal(`\`strategy.exit\` with a trail_offset of ${trOff} ticks, not a positive whole number`, 'W9-X1')
      }
      if (finite(trPts) && !(Number.isInteger(trPts) && trPts > 0)) {
        throw new BrokerRefusal(`\`strategy.exit\` with trail_points ${trPts}, not a positive whole number of ticks `
          + '(a stop activated at once is not served)', 'W9-X1')
      }
      trail = { price: finite(trP) ? trP : NaN, points: finite(trPts) ? trPts : NaN, offset: trOff }
    }
    // [B-EXIT-QTY] the size: `qty` wins over `qty_percent` (R6: "The command ignores this parameter if
    // the `qty` value is not na"); `qty_percent` 100 is the whole trade
    let qtySpec = null
    if (finite(qtyV)) {
      if (!(qtyV > 0)) throw new BrokerRefusal(`\`strategy.exit\` with a quantity of ${qtyV}`, 'W9-X2')
      qtySpec = { qty: qtyV }
    } else if (finite(pctV) && pctV !== 100) {
      if (!(pctV > 0 && pctV < 100)) throw new BrokerRefusal(`\`strategy.exit\` with qty_percent ${pctV}`, 'W9-X2')
      qtySpec = { pct: pctV }
    }
    if (qtySpec) { rule('B-EXIT-QTY'); t7DefaultTimingOnly('a partial `strategy.exit`') }
    let x = exits.find((e) => e.id === id)
    if (!tp && !sl && !trail) {
      rule('B-EXIT-NA')
      // [B-EXIT-NA] every level na and no such exit waiting: nothing is placed
      if (x) {
        throw new BrokerRefusal(`\`strategy.exit\` \`${id}\` was called again with every level na while its `
          + 'orders were waiting', 'Q-S1k')
      }
      return
    }
    if (x && x.fromEntry !== from) {
      throw new BrokerRefusal(`\`strategy.exit\` \`${id}\` was called again for a different entry`, 'Q-S1k')
    }
    if (!x) {
      if (!exitDone.has(id)) exitDone.set(id, new Set())
      x = { id, fromEntry: from, tp, sl, trail, qtySpec, all: from === '', trades: new Set(), orders: new Set(),
        maybe: new Set(), res: new Map(), trailState: new Map(), done: exitDone.get(id) }
      exits.push(x)
    }
    x.tp = tp
    x.sl = sl
    x.trail = trail
    x.qtySpec = qtySpec
    // [B-EXIT-BIND] the open trades (and unfilled entries) with that id, or every
    // open trade when no `from_entry` is given; a call again confirms a maybe.
    // ⭐ W9-T7: each binding (re)takes this command's reservation ([B-EXIT-QTY]); a trade this exit
    // id has already exited from is not bound again.
    for (const t of open) {
      if (from === '' || t.entryId === from) bindExit(x, t)
    }
    if (from !== '') for (const o of entries) if (o.id === from) x.orders.add(o)
  }
  const cancel = (a) => {
    const [id0, when] = a
    rule('B-SIG'); rule('B-CANCEL')
    if (when !== undefined) rule('B-WHEN')
    if (!truthy(when)) return
    const id = idText(id0, '`strategy.cancel`')
    for (const e of entries.filter((o) => o.id === id)) dropEntry(e)
    exits = exits.filter((x) => x.id !== id)
  }
  const cancelAll = (a) => {
    rule('B-SIG'); rule('B-CANCEL')
    if (a[0] !== undefined) rule('B-WHEN')
    if (!truthy(a[0])) return
    entries = []
    exits = []
  }

  // ─── the values ───────────────────────────────────────────────────────────
  const exactOpen = (what) => {
    if (open.some((t) => !t.exact)) {
      throw new BrokerRefusal(`${what} reads a trade entered at a price off the tick grid, and whether TradingView `
        + 'rounds that fill is not stated', 'Q-S1l')
    }
  }
  const exactClosed = (what) => {
    if (closed.some((t) => !t.exact)) {
      throw new BrokerRefusal(`${what} reads a trade filled at a price off the tick grid, and whether TradingView `
        + 'rounds that fill is not stated', 'Q-S1l')
    }
  }
  const sum = (arr, f) => arr.reduce((s, t) => s + f(t), 0)
  const netPts = () => sum(closed, (t) => t.profit)
  const capital = () => {
    if (!finite(cfg.initialCapital)) throw new BrokerRefusal('the initial capital is not settled', 'Q-S1b')
    if (defaulted.initialCapital) rule('B-DEFAULTS')
    return cfg.initialCapital
  }
  /** [B-VAL] `strategy.equity` at bar `bar`'s close: initial capital + net profit + open profit. */
  const equityAt = (bar, what) => {
    // ⭐ W9-T13a N7 — equity is net of commission: every reader of it (a percent-of-equity size included,
    // not only the `strategy.equity` value) rests on COMMISSION_RULE
    rule(COMMISSION_RULE)
    exactOpen(what); exactClosed(what); needSymbol()
    return capital() + (netPts() + sum(open, (t) => (C[bar] - t.price) * t.dir * t.qty)) * pointvalue
  }

  /**
   * ⭐⭐ W9-T4 [B-QTY] — the size of an entry whose `qty` is na, from the declaration's
   * `default_qty_type` / `default_qty_value` (v6 reference, `strategy()`: "strategy.fixed for
   * contracts/shares/lots, strategy.cash for currency amounts, or strategy.percent_of_equity for a
   * percentage of available equity"; `strategy.entry` `qty`: "The default is na, which means that the
   * command uses the default_qty_type and default_qty_value parameters ... to determine the quantity").
   *
   * ⛔⛔ THE REFERENCE AND THE MANUAL STATE NO FORMULA for cash and percent: neither says which price
   * turns money into units, nor how a fractional result is rounded (`strategy-broker-spec.md`, Q-S1a).
   * What follows is the HYPOTHESIS the Q-S1a probes are built to grade (they plot the open size at the
   * fill and `equity` / `close` at the signal), and nothing here is served until B-QTY is pinned:
   *   - the size is taken when the order is PLACED, on the signal bar, from that bar's close;
   *   - cash:    units = value / (close × pointvalue);
   *   - percent: units = equity × value / 100 / (close × pointvalue), `equity` = `strategy.equity` at
   *     that close (the v6 constant's text: "a percentage (0-100) of equity");
   *   - rounded DOWN to whole units, served ONLY for a symbol whose minimum contract the run context
   *     states is 1 (`syminfo.mincontract`: "The smallest amount of the current symbol that can be traded
   *     ... For cryptocurrencies, it is often less than 1 token. For most other types of asset, it is
   *     often 1."). A fractional symbol, or one whose minimum contract the run was not told, refuses.
   *     No product caller states it yet, so on the member door this refuses even once B-QTY is pinned.
   * Every case the hypothesis does not reach refuses by name (Q-S1a): a price (limit / stop) order,
   * whose sizing price could be its level or the signal close; a percent order placed while trades are
   * open ("available" equity may exclude what they hold); a percent value above 100; a size below one
   * whole unit.
   */
  const defaultSize = (type, id, bar) => {
    const qtyType = cfg.qtyType === undefined ? (finite(cfg.defaultQty) ? 'fixed' : null) : cfg.qtyType
    if (qtyType === 'fixed') {
      if (!finite(cfg.defaultQty)) {
        throw new BrokerRefusal('this order takes the default order size, and this strategy\'s Pine version '
          + 'documents no default value', 'Q-S1a')
      }
      rule('B-QTY'); if (defaulted.qty) rule('B-DEFAULTS')
      return cfg.defaultQty
    }
    const v = cfg.qtyValue
    if ((qtyType !== 'cash' && qtyType !== 'percent_of_equity') || !(finite(v) && v > 0)) {
      throw new BrokerRefusal('this order takes the default order size, and the default this strategy declares '
        + '(or its Pine version documents) is a size rule this broker does not serve', 'Q-S1a')
    }
    rule('B-QTY'); if (defaulted.qty) rule('B-DEFAULTS')
    const unit = qtyType === 'cash' ? 'cash' : 'percent-of-equity'
    // ⭐⭐ W9-T4 x W9-T6 (review merge note) — an extra execution ([B-FILLS]) runs at its fill tick's price
    // (`tickPx`), and this size is taken at the bar's close: one order would read two prices. Which one
    // TradingView sizes it at is not stated, so it stops by name. (A FIXED default reads no price.)
    if (tickPx !== null) {
      throw new BrokerRefusal(`the entry \`${id}\` takes a ${unit} default size in an extra execution at ${tickPx} `
        + "(`calc_on_order_fills`), and whether that tick or the bar's close sizes it is not stated", 'Q-S1a')
    }
    if (type !== 'market') {
      throw new BrokerRefusal(`the ${type} entry \`${id}\` takes a ${unit} default size, and whether its level or `
        + 'the signal bar\'s close sizes it is not stated', 'Q-S1a')
    }
    if (minContract !== 1) {
      throw new BrokerRefusal(`the entry \`${id}\` takes a ${unit} default size, which this broker rounds down to `
        + `whole units, and this symbol's minimum contract is ${finite(minContract)
          ? `${minContract} (a fractional symbol, such as a cryptocurrency, trades in parts of a unit)`
          : 'not known to this run (a fractional symbol, such as a cryptocurrency, trades in parts of a unit)'}`,
      'Q-S1a')
    }
    needSymbol()
    const px = C[bar]
    if (!(finite(px) && px > 0)) {
      throw new BrokerRefusal(`the entry \`${id}\` takes a ${unit} default size on a bar without a close`, 'Q-S1a')
    }
    let money
    if (qtyType === 'cash') money = v
    else {
      if (v > 100) {
        throw new BrokerRefusal(`a percent-of-equity default size of ${v} (more than 100) is not served`, 'Q-S1a')
      }
      if (open.length) {
        throw new BrokerRefusal(`the entry \`${id}\` takes a percent-of-equity default size while trades are open, `
          + 'and whether "available equity" excludes what they hold is not stated', 'Q-S1a')
      }
      money = equityAt(bar, '`strategy.entry` sized as a percent of equity') * v / 100
    }
    // a hair of tolerance so 10000 / 100 does not floor to 99 through binary rounding
    const units = Math.floor(money / (px * pointvalue) + 1e-9)
    if (!(units >= 1)) {
      throw new BrokerRefusal(`the entry \`${id}\` takes a ${unit} default size of less than one whole unit `
        + `(${money} at a close of ${px})`, 'Q-S1a')
    }
    return units
  }
  const tradeAt = (list, k, fn) => {
    if (!(finite(k) && Number.isInteger(k) && k >= 0 && k < list.length)) {
      throw new BrokerRefusal(`\`${fn}(${k})\` outside the ${list.length} trades`, 'Q-S1m')
    }
    return list[k]
  }
  // win / loss / even: the SIGN of a trade's profit, served off the tick grid only
  // when the trade's profit is further than one tick-quantity from zero
  const signOf = (t, what) => {
    if (!t.exact) {
      needSymbol()
      if (Math.abs(t.profit) <= t.qty * mintick) {
        throw new BrokerRefusal(`${what} reads a trade whose sign depends on an off-grid fill`, 'Q-S1l')
      }
    }
    return Math.sign(t.profit)
  }
  const value = (fn, a, bar) => {
    rule('B-VAL')
    if (immediateBar === bar) {
      throw new BrokerRefusal(`\`${fn}\` is read on the bar an \`immediately = true\` close filled, after that close, `
        + 'and whether the value already reflects the fill is not stated', 'W9-X4')
    }
    // [B-DEFAULTS] every figure net of commission rests on the commission being 0 (`brokerRules.js`)
    if (COMMISSION_NET_VALUES.includes(fn)) rule(COMMISSION_RULE)
    switch (fn) {
      case 'strategy.position_size': return sum(open, (t) => t.dir * t.qty)
      case 'strategy.position_avg_price': {
        if (!open.length) return NaN // [B-VAL] flat -> NaN
        exactOpen('`strategy.position_avg_price`')
        return sum(open, (t) => t.price * t.qty) / sum(open, (t) => t.qty)
      }
      case 'strategy.opentrades': return open.length
      case 'strategy.closedtrades': return closed.length
      case 'strategy.wintrades': return closed.filter((t) => signOf(t, '`strategy.wintrades`') > 0).length
      case 'strategy.losstrades': return closed.filter((t) => signOf(t, '`strategy.losstrades`') < 0).length
      case 'strategy.eventrades': return closed.filter((t) => signOf(t, '`strategy.eventrades`') === 0).length
      case 'strategy.netprofit': exactClosed('`strategy.netprofit`'); needSymbol(); return netPts() * pointvalue
      case 'strategy.netprofit_percent':
        exactClosed('`strategy.netprofit_percent`'); needSymbol(); return (netPts() * pointvalue) / capital() * 100
      case 'strategy.grossprofit':
        exactClosed('`strategy.grossprofit`'); needSymbol()
        return sum(closed, (t) => (t.profit > 0 ? t.profit : 0)) * pointvalue
      case 'strategy.grossloss':
        exactClosed('`strategy.grossloss`'); needSymbol()
        return sum(closed, (t) => (t.profit < 0 ? -t.profit : 0)) * pointvalue
      case 'strategy.openprofit':
        exactOpen('`strategy.openprofit`'); needSymbol()
        return sum(open, (t) => (C[bar] - t.price) * t.dir * t.qty) * pointvalue
      case 'strategy.equity': return equityAt(bar, '`strategy.equity`')
      case 'strategy.initial_capital': return capital()
      case 'strategy.opentrades.entry_price': {
        const t = tradeAt(open, a[0], fn)
        if (!t.exact) exactOpen(`\`${fn}\``)
        return t.price
      }
      case 'strategy.opentrades.entry_bar_index': return tradeAt(open, a[0], fn).bar
      case 'strategy.opentrades.size': { const t = tradeAt(open, a[0], fn); return t.dir * t.qty }
      case 'strategy.closedtrades.entry_price': {
        const t = tradeAt(closed, a[0], fn)
        if (!t.exact) exactClosed(`\`${fn}\``)
        return t.price
      }
      case 'strategy.closedtrades.exit_price': {
        const t = tradeAt(closed, a[0], fn)
        if (!t.exact) exactClosed(`\`${fn}\``)
        return t.exitPrice
      }
      case 'strategy.closedtrades.entry_bar_index': return tradeAt(closed, a[0], fn).bar
      case 'strategy.closedtrades.exit_bar_index': return tradeAt(closed, a[0], fn).exitBar
      case 'strategy.closedtrades.size': { const t = tradeAt(closed, a[0], fn); return t.dir * t.qty }
      case 'strategy.closedtrades.profit': {
        const t = tradeAt(closed, a[0], fn)
        if (!t.exact) exactClosed(`\`${fn}\``)
        needSymbol()
        return t.profit * pointvalue
      }
      default: throw new BrokerRefusal(`\`${fn}\` is not a value this broker serves`)
    }
  }

  /** One broker op on bar `bar`: `args` positional, `undefined` where not passed. */
  const call = (fn, args, bar) => {
    switch (fn) {
      case '#symbol':
        if (finite(args[0]) && args[0] > 0) mintick = args[0]
        if (finite(args[1]) && args[1] > 0) pointvalue = args[1]
        return undefined
      case 'strategy.entry': placeOrder(args, bar, 'entry'); return undefined
      case 'strategy.order': placeOrder(args, bar, 'order'); return undefined
      case 'strategy.close': close(args, bar); return undefined
      case 'strategy.close_all': closeAll(args, bar); return undefined
      case 'strategy.exit': exit(args); return undefined
      case 'strategy.cancel': cancel(args); return undefined
      case 'strategy.cancel_all': cancelAll(args); return undefined
      default: return value(fn, args, bar)
    }
  }

  /** What the run did — for rails and diagnostics. */
  const timeOf = (bar) => (times && Number.isInteger(bar) && bar >= 0 && bar < times.length ? times[bar] : null)
  // `exact`: every fill of the trade is on the tick grid (an off-grid fill is the open Q-S1l, and
  // the report refuses what depends on one exactly as `value` does). W9-T13a reads it.
  const tradeRecord = (t) => ({
    id: t.entryId, dir: t.dir, qty: t.qty, exact: t.exact === true,
    entry: { time: timeOf(t.bar), price: t.price, rule: t.entryRule },
    ...(t.exitBar === undefined ? {} : { exit: { time: timeOf(t.exitBar), price: t.exitPrice, rule: t.exitRule } }),
  })
  const summary = () => ({
    open: open.map((t) => ({ ...t })),
    closed: closed.map((t) => ({ ...t })),
    // ⭐⭐ W9-T1 — the record skeleton, KEYED BY BAR TIME (never bar index: a method-(b) run's
    // indexes differ by a constant). Every fill carries the `rule` it rested on, which is what a
    // grader names for the first unmatched fill. `rulesUsed` is what this run asked the ledger.
    record: {
      schema: 'uct.strategy-record/v0',
      trades: [...closed.map(tradeRecord), ...open.map(tradeRecord)],
      // W9-T13a: the symbol's tick and point value as THIS run settled them (`#symbol`), null
      // when the run never learned one. The report's currency values are price x size x pointvalue.
      symbol: { mintick: finite(mintick) ? mintick : null, pointvalue: finite(pointvalue) ? pointvalue : null },
      rulesUsed: Array.from(okRules).sort(),
    },
  })

  return { beginBar, endBar, call, summary }
}
