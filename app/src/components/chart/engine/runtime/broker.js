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
import { ruleCapture, UNPINNED_GUARD } from './brokerRules.js'

export const BROKER_UNSETTLED_GUARD = 'runtime:strategy-unsettled'
export const BROKER_START_GUARD = 'runtime:strategy-start'
export { UNPINNED_GUARD }

/** A stop of the run at a rule the spec does not settle. `probe` names the queue
 *  item that would settle it. */
export class BrokerRefusal extends Error {
  constructor(message, probe) {
    super(`${message}${probe ? ` (unsettled: ${probe}, docs/pine/capture-queue-2026-10-05-s1.md)` : ''}`)
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
  'strategy.entry': { params: ['id', 'direction', 'qty', 'limit', 'stop', 'when'], returns: 'void' },
  'strategy.close': { params: ['id', 'when'], returns: 'void' },
  'strategy.close_all': { params: ['when'], returns: 'void' },
  'strategy.exit': { params: ['id', 'from_entry', 'profit', 'limit', 'loss', 'stop', 'when'], returns: 'void' },
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
 *   `{ pyramiding, defaultQty, initialCapital, marginLong, marginShort }`. `defaultQty`
 *   is `null` when the declaration leaves the default order size to a rule the spec
 *   does not settle; an order that needs it then stops the run ([B-QTY]).
 * @param {object} data  `{ series }` — the VM's price series (open, high, low, close).
 */
export function makeBroker(cfg, data) {
  const [O, H, L, C] = data.series
  const times = data.barTimes || null
  // ⭐⭐ W9-T1 — `pinned(rule)`, asked when the run REACHES a rule. One-argument calls only: the
  // test-only pin set arrives as `data.isPinned` (a predicate), never as `pinned`'s second argument.
  const isPinned = typeof data.isPinned === 'function' ? data.isPinned : (id) => pinned(id)
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
  /** unfilled entry orders: `{ id, dir, qty, type, level, placedBar, immediate, seq }` */
  let entries = []
  /** unfilled market exits from `strategy.close` / `close_all`: `{ kind, id, placedBar }` */
  let closes = []
  /** exit commands: `{ id, fromEntry, tp, sl, all, trades:Set, orders:Set, maybe:Set, seq }` */
  let exits = []

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
    for (const x of exits) { x.trades.delete(t); x.maybe.delete(t) }
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
  const fillEntry = (o, price, bar, exact) => {
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
    const t = { entryId: o.id, dir: o.dir, qty: o.qty, price, bar, exact, seq: (seq += 1), entryRule: fillRule }
    open.push(t)
    for (const x of exits) {
      if (x.orders.has(o)) { x.orders.delete(o); x.trades.add(t) } else if (x.all) {
        // [B-EXIT-LIFE] "until the position closes": whether a reversal (close + open
        // on one fill) ends that life is not stated - such an exit MAY cover the new trade.
        if (reversed) x.maybe.add(t)
        else x.trades.add(t)
      }
    }
    if (reversed) afterPositionChange()
    marginCheck(price)
    return t
  }

  /** An exit command's two levels for one trade: `{ tp, sl }` (NaN = none). */
  const levelsFor = (x, t) => {
    const lv = (spec, sign) => {
      if (!spec) return NaN
      if (finite(spec.abs)) return spec.abs
      needSymbol()
      return t.price + sign * t.dir * spec.ticks * mintick
    }
    return { tp: lv(x.tp, 1), sl: lv(x.sl, -1) }
  }
  /** Every live price order right now, each `{ kind, level, up, x?, t?, o? }`:
   *  `up` true when it triggers on a RISE to `level`. */
  const liveOrders = () => {
    const out = []
    for (const o of entries) {
      if (o.type === 'market' || o.immediate) continue
      // long limit / short stop trigger on a fall; long stop / short limit on a rise
      const up = (o.type === 'stop') === (o.dir > 0)
      out.push({ kind: 'entry', level: o.level, up, o })
    }
    for (const x of exits) {
      for (const [set, maybe] of [[x.trades, false], [x.maybe, true]]) {
        for (const t of set) {
          const { tp, sl } = levelsFor(x, t)
          // a long's take-profit triggers on a rise, its stop-loss on a fall
          if (finite(tp)) out.push({ kind: 'exit', level: tp, up: t.dir > 0, x, t, maybe, leg: 'tp' })
          if (finite(sl)) out.push({ kind: 'exit', level: sl, up: t.dir < 0, x, t, maybe, leg: 'sl' })
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
    rule('B-EXIT-BIND')
    requireOldest([lo.t])
    closeTrade(lo.t, price, bar, exact)
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
      const targets = cl.kind === 'all' ? open.slice() : open.filter((t) => t.entryId === cl.id)
      requireOldest(targets)
      for (const t of targets) closeTrade(t, px, bar, true)
      afterPositionChange()
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
  /** [B-MARGIN] the bar's worst price for the position, after its fills. */
  const marginCheckBar = (bar) => {
    if (!open.length) return
    marginCheck(open[0].dir > 0 ? L[bar] : H[bar])
  }

  // ─── the order commands (called while the script runs on `bar`) ───────────
  const entry = (a, bar) => {
    const [id0, dirV, qtyV, limV, stpV, when] = a
    rule('B-SIG')
    if (when !== undefined) rule('B-WHEN')
    if (!truthy(when)) return
    const id = idText(id0, '`strategy.entry`')
    rule('B-DIR')
    let dir
    if (dirV === 1 || dirV === true) dir = 1
    else if (dirV === 0 || dirV === -1 || dirV === false) dir = -1
    else throw new BrokerRefusal(`\`strategy.entry\` direction ${String(dirV)} is neither long nor short`)
    let qty = qtyV
    if (!finite(qty)) {
      // [B-QTY] na -> the declaration's default order size
      if (!finite(cfg.defaultQty)) {
        throw new BrokerRefusal('this order takes the default order size, and the default this strategy declares '
          + '(or its Pine version documents) is a size rule this broker does not serve', 'Q-S1a')
      }
      rule('B-QTY'); if (defaulted.qty) rule('B-DEFAULTS')
      qty = cfg.defaultQty
    }
    if (!(qty > 0)) throw new BrokerRefusal(`\`strategy.entry\` with a quantity of ${qty}`, 'Q-S1a')
    const lim = finite(limV); const stp = finite(stpV)
    if (lim && stp) throw new BrokerRefusal('a stop-limit entry is not served', 'Q-S1j')
    const type = lim ? 'limit' : (stp ? 'stop' : 'market')
    const level = lim ? limV : (stp ? stpV : NaN)
    // [B-IMMEDIATE] a limit at a worse price than the market (or a stop at a better
    // one) fills on the next tick rather than waiting
    // ⭐⭐ W9-T6 — an extra execution ([B-FILLS]) runs at its fill tick's price, not the close
    const cl = tickPx === null ? C[bar] : tickPx
    const immediate = type === 'limit' ? (dir > 0 ? level >= cl : level <= cl)
      : type === 'stop' ? (dir > 0 ? level <= cl : level >= cl) : false
    const o = { id, dir, qty, type, level, placedBar: bar, immediate }
    // [B-MODIFY] an unfilled order with the same id is modified, not duplicated
    const prev = entries.find((e) => e.id === id)
    if (prev) {
      rule('B-MODIFY')
      Object.assign(prev, o)
      return
    }
    entries.push(o)
  }
  const close = (a) => {
    const [id0, when] = a
    rule('B-SIG'); rule('B-CLOSE')
    if (when !== undefined) rule('B-WHEN')
    if (!truthy(when)) return
    const id = idText(id0, '`strategy.close`')
    // [B-CLOSE] no open trade with this id when the command is called: no effect
    if (!open.some((t) => t.entryId === id)) return
    if (!closes.some((c) => c.kind === 'id' && c.id === id)) closes.push({ kind: 'id', id })
  }
  const closeAll = (a) => {
    rule('B-SIG'); rule('B-CLOSE')
    if (a[0] !== undefined) rule('B-WHEN')
    if (!truthy(a[0])) return
    if (!open.length) return
    if (!closes.some((c) => c.kind === 'all')) closes.push({ kind: 'all' })
  }
  const exit = (a) => {
    const [id0, from0, profit, limit, loss, stop, when] = a
    rule('B-SIG')
    if (when !== undefined) rule('B-WHEN')
    if (!truthy(when)) return
    rule('B-EXIT-BIND')
    const id = idText(id0, '`strategy.exit`')
    const from = from0 === undefined || from0 === '' ? '' : idText(from0, '`strategy.exit` from_entry')
    if (finite(profit) && finite(limit)) {
      throw new BrokerRefusal('`strategy.exit` with both `profit` and `limit`: the reference says `limit` wins, the '
        + 'manual says the level reached first wins', 'Q-S1k')
    }
    if (finite(loss) && finite(stop)) {
      throw new BrokerRefusal('`strategy.exit` with both `loss` and `stop`: the reference says `stop` wins, the '
        + 'manual says the level reached first wins', 'Q-S1k')
    }
    const tp = finite(limit) ? { abs: limit } : (finite(profit) ? { ticks: profit } : null)
    const sl = finite(stop) ? { abs: stop } : (finite(loss) ? { ticks: loss } : null)
    for (const s of [tp, sl]) {
      if (s && s.ticks !== undefined && !Number.isInteger(s.ticks)) {
        throw new BrokerRefusal(`\`strategy.exit\` with a distance of ${s.ticks} ticks, not a whole number of ticks`, 'Q-S1k')
      }
    }
    let x = exits.find((e) => e.id === id)
    if (!tp && !sl) {
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
      x = { id, fromEntry: from, tp, sl, all: from === '', trades: new Set(), orders: new Set(), maybe: new Set() }
      exits.push(x)
    }
    x.tp = tp
    x.sl = sl
    // [B-EXIT-BIND] the open trades (and unfilled entries) with that id, or every
    // open trade when no `from_entry` is given; a call again confirms a maybe
    for (const t of open) {
      if (from === '' || t.entryId === from) { x.trades.add(t); x.maybe.delete(t) }
    }
    if (from !== '') for (const o of entries) if (o.id === from) x.orders.add(o)
  }
  const cancel = (a) => {
    const [id0, when] = a
    rule('B-SIG'); rule('B-CANCEL')
    if (when !== undefined) rule('B-WHEN')
    if (!truthy(when)) return
    const id = idText(id0, '`strategy.cancel`')
    entries = entries.filter((e) => e.id !== id)
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
      case 'strategy.equity': {
        exactOpen('`strategy.equity`'); exactClosed('`strategy.equity`'); needSymbol()
        return capital() + (netPts() + sum(open, (t) => (C[bar] - t.price) * t.dir * t.qty)) * pointvalue
      }
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
      case 'strategy.entry': entry(args, bar); return undefined
      case 'strategy.close': close(args); return undefined
      case 'strategy.close_all': closeAll(args); return undefined
      case 'strategy.exit': exit(args); return undefined
      case 'strategy.cancel': cancel(args); return undefined
      case 'strategy.cancel_all': cancelAll(args); return undefined
      default: return value(fn, args, bar)
    }
  }

  /** What the run did — for rails and diagnostics. */
  const timeOf = (bar) => (times && Number.isInteger(bar) && bar >= 0 && bar < times.length ? times[bar] : null)
  const tradeRecord = (t) => ({
    id: t.entryId, dir: t.dir, qty: t.qty,
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
      rulesUsed: Array.from(okRules).sort(),
    },
  })

  return { beginBar, endBar, call, summary }
}
