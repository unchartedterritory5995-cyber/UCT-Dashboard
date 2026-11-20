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
import { ruleCapture, UNPINNED_GUARD, COMMISSION_NET_VALUES, commissionRulesOf, RISK_RULES, BROKER_UNSETTLED_GUARD } from './brokerRules.js'
import { exitIdOf, witnessedExitIdOf, EXIT_LABEL_ROW } from './strategyRecord.js'

// declared in brokerRules.js (one authority); re-exported here under its old name for every importer
export { BROKER_UNSETTLED_GUARD }
export const BROKER_START_GUARD = 'runtime:strategy-start'
export { UNPINNED_GUARD }

/** A stop of the run at a rule the spec does not settle. `probe` names the queue
 *  item that would settle it. */
export class BrokerRefusal extends Error {
  /** `setting` (ruling D12): the refusal is about a SETTING the run would have to assume (its name), not about
   *  a fill or a value. A capture our run refuses this way is an expected refusal: it exercised nothing. */
  constructor(message, probe, setting) {
    // ⭐ W9-T7: a W9 capture row is queued in the W9 design (5.2), not in S1's queue
    const where = /^W9-[A-Z]{1,2}\d/.test(String(probe || '')) ? 'docs/pine/W9-STRATEGY-DESIGN.md 5.2' : 'docs/pine/capture-queue-2026-10-05-s1.md'
    super(`${message}${probe ? ` (unsettled: ${probe}, ${where})` : ''}`)
    this.name = 'BrokerRefusal'
    this.guard = BROKER_UNSETTLED_GUARD
    this.probe = probe || null
    this.setting = typeof setting === 'string' && setting ? setting : null
  }
}
/** Ruling D12 (2026-11-16): the setting a Pine v4 strategy leaves to its default and no source settles. */
export const V4_MARGIN_DEFAULT_SETTING = 'v4-margin-default'

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
  // ⭐⭐ W9-T7-F1 — the `comment*` labels ride too, for the ORDER LOG only (`ORDER_COMMENT_PARAMS`): no fill,
  // size or price reads them. The front end passes a LITERAL comment and nothing else (`ast/strategyBroker.js`).
  'strategy.entry': { params: ['id', 'direction', 'qty', 'limit', 'stop', 'oca_name', 'oca_type', 'comment', 'when'], returns: 'void' },
  'strategy.order': { params: ['id', 'direction', 'qty', 'limit', 'stop', 'oca_name', 'oca_type', 'comment', 'when'], returns: 'void' },
  'strategy.close': { params: ['id', 'qty', 'qty_percent', 'immediately', 'comment', 'when'], returns: 'void' },
  'strategy.close_all': { params: ['immediately', 'comment', 'when'], returns: 'void' },
  'strategy.exit': { params: ['id', 'from_entry', 'qty', 'qty_percent', 'profit', 'limit', 'loss', 'stop',
    'trail_price', 'trail_points', 'trail_offset', 'comment', 'comment_profit', 'comment_loss', 'comment_trailing', 'when'], returns: 'void' },
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
  // ⭐ W9-T5: the fees a trade paid (R6: "the sum of entry and exit fees paid in the ... trade")
  'strategy.closedtrades.commission': { params: ['trade_num'], returns: 'number' },
  'strategy.opentrades.commission': { params: ['trade_num'], returns: 'number' },
  // ⭐ value read-backs: the UNIX time, in milliseconds, of the bar a trade's entry / exit filled on
  // (R6 `strategy.closedtrades.entry_time`: "Returns the UNIX time of the closed trade's entry, expressed in
  // milliseconds"; that it is the fill BAR's `time` is what the std set's S10 / S11 plots witness)
  'strategy.opentrades.entry_time': { params: ['trade_num'], returns: 'number' },
  'strategy.closedtrades.entry_time': { params: ['trade_num'], returns: 'number' },
  'strategy.closedtrades.exit_time': { params: ['trade_num'], returns: 'number' },
  // ⭐⭐ W9-T7-F1 — a trade's order ids and comments, read off the ORDER LOG (the one authority the record's
  // `orders` and `trades.exitId` are built from). TEXT values (`returns: 'string'`, as a drawing op's text).
  'strategy.opentrades.entry_id': { params: ['trade_num'], returns: 'string' },
  'strategy.opentrades.entry_comment': { params: ['trade_num'], returns: 'string' },
  'strategy.closedtrades.entry_id': { params: ['trade_num'], returns: 'string' },
  'strategy.closedtrades.entry_comment': { params: ['trade_num'], returns: 'string' },
  'strategy.closedtrades.exit_id': { params: ['trade_num'], returns: 'string' },
  'strategy.closedtrades.exit_comment': { params: ['trade_num'], returns: 'string' },
})

/** ⭐ W9-T7-F1 — the order commands' label parameters (`BROKER_OPS`): logged, never read by a fill. */
export const ORDER_COMMENT_PARAMS = Object.freeze(['comment', 'comment_profit', 'comment_loss', 'comment_trailing'])

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
  // undefined when no witnessed source states it (W9-T4-F1: `runtimeColumns.js` derives it from
  // `symbolScope.json::min_contract`, which serves no row until a capture lands one)
  const minContract = data.minContract
  /** the bar the broker is working on (a command's bar, or the bar whose fills are being walked); -1 before the first */
  let nowBar = -1
  /** rule -> the bar the run FIRST asked it on (-1: before the first bar). Ruling D11 reads it: a capture that
   *  DIVERGEs at an event names as its culprit set the rules first exercised on that event's bar. */
  const okRules = new Map()
  const rule = (id) => {
    if (okRules.has(id)) return
    if (!isPinned(id)) throw new BrokerUnpinned(id)
    okRules.set(id, nowBar)
  }
  const defaulted = cfg.defaulted || {}
  // ⭐⭐ RULING D12 (coordinator, owner-delegated, 2026-11-16) — THE PINE v4 MARGIN DEFAULT IS NOT SETTLED. The v4
  // reference reads `margin_long` / `margin_short` 100 (`ast/strategyBroker.js` DECLARATION_DEFAULTS), and
  // TradingView read 0 back on both v4 captures of 2026-11-15 (w9-q-s1a-size-v4, w9-q-s1b-defaults-v4: one
  // declaration shape, `strategy(title, overlay)`, so witnessed for that shape only). A run that would have to
  // assume it is not the run TradingView made: it stops here, at bind, by name, before any rule is asked. The
  // default is NOT changed to 0 on that evidence. A v4 script that states both margins is unaffected.
  // ⭐⭐ RULING D12b (2026-11-17) — the capture wins where it witnesses the RUN: for EXACTLY the declaration shape both
  // v4 captures have, `strategy(title, overlay)`, the margins are the 0 TradingView read back (`ast/strategyBroker.js`
  // sets them, `v4MarginReadBack`), served behind B-V4-MARGIN0; both captures grade MATCH at it. Every other v4 shape
  // that states no margin still stops here, as D12 rules.
  // ⭐ (2026-11-19, D12b point 4) two more shapes settled by their own captures (`ast/strategyBroker.js` V4_MARGIN0_SHAPES)
  if (cfg.version === 4 && defaulted.margin === true) {
    if (cfg.v4MarginReadBack !== true) {
      throw new BrokerRefusal('this Pine v4 strategy states no `margin_long` / `margin_short`, and the v4 default is not '
        + 'settled for its declaration: the v4 reference reads 100, and TradingView read 0 back only for the declarations '
        + 'the v4 captures took (a title and `overlay`; the same with a `shorttitle`; and one with a commission, a default '
        + 'size and a capital); state both margins in strategy() to run it', 'Q-S1b',
      V4_MARGIN_DEFAULT_SETTING)
    }
    rule('B-V4-MARGIN0')
  }
  // ⭐⭐ (2026-11-17) [B-V3] a Pine v2 / v3 strategy runs on what the two committed v2 / v3 report captures witness:
  // their order calls (`ast/strategyBroker.js` V3_SIGNATURES) and the Properties TradingView read back for them (fixed 1,
  // capital 100,000, pyramiding 1, no cost, NO margin input). Asked once, before the first bar: it is the whole run's model.
  if (cfg.version === 2 || cfg.version === 3) rule('B-V3')
  const maxEntries = Math.max(1, Math.floor(Number(cfg.pyramiding) || 0)) // [B-PYR]
  // ⭐⭐ W9-T6 — FILL TIMING, read from the declaration (`ast/strategyBroker.js`). Each setting off its
  // default asks its own rule when a run REACHES it, so a run that never does is unchanged.
  const poc = cfg.processOrdersOnClose === true // [B-POC] process_orders_on_close
  const coof = cfg.calcOnOrderFills === true // [B-FILLS] calc_on_order_fills
  // [B-TICK-HIST] R6 `calc_on_every_tick`: "a new execution ... on every available tick in each REALTIME
  // bar" - on history a bar executes once on its close. Asked once, before the first bar: it is the
  // whole run's execution model. (The forming bar is refused separately, Q-S1o, in `vm.js`.)
  if (cfg.calcOnEveryTick === true) rule('B-TICK-HIST')
  // ⭐⭐ W9-T5 — COSTS, read from the declaration (`ast/strategyBroker.js`). A zero commission and a zero
  // slippage change nothing and ask nothing new (`costOn` / `slipTicks` false: every figure below takes
  // its pre-W9-T5 expression exactly). A non-zero one asks its rule (`commissionRulesOf`, B-SLIPPAGE) at
  // the first fill that pays it, so a run that never fills is unchanged.
  const comm = cfg.commission && typeof cfg.commission === 'object' ? cfg.commission : { type: 'percent', value: 0 }
  const costOn = finite(comm.value) && comm.value > 0
  const slipTicks = Number.isInteger(cfg.slippage) && cfg.slippage > 0 ? cfg.slippage : 0
  const commRules = commissionRulesOf(comm)
  /** every figure that reads a commission (a net profit, equity, the fee itself) asks this */
  const askCommission = () => { for (const r of commRules) rule(r) }
  const COMM_ROW = { percent: 'W9-K1', cash_per_contract: 'W9-K2', cash_per_order: 'W9-K3' }
  // ⭐⭐ W9-T8 — strategy.risk.*, read from the declaration (`ast/strategyBroker.js` readRiskCall). With no risk
  // command `riskOn` is false and every risk line below returns at once: the run is exactly the pre-T8 run.
  const risk = cfg.risk && typeof cfg.risk === 'object' ? cfg.risk : {}
  const allow = typeof risk.allow === 'string' ? risk.allow : null
  const maxDd = risk.maxDrawdown && typeof risk.maxDrawdown === 'object' ? risk.maxDrawdown : null
  const dayCap = Number.isInteger(risk.intradayOrders) ? risk.intradayOrders : null
  const riskOn = allow !== null || maxDd !== null || dayCap !== null
  /** the capture row of the risk command(s) this run declares (W9 design 5.2) */
  const riskRow = allow !== null || maxDd !== null ? 'W9-R1' : 'W9-R1i'
  // the trading day of each bar, as the run context states it (`ctx.tradingDays`); undefined when the caller does
  // not know it (today: every product caller), so max_intraday_filled_orders refuses by name (W9-R1i)
  const tradingDays = data.tradingDays
  /** ⛔ every W9-R1 / W9-R1i probe runs at the default fill timing with no cost: a risk command combined with
   *  process_orders_on_close, calc_on_order_fills, a commission or a slippage stops the run by name. */
  const riskDefaultOnly = (what) => {
    if (poc || coof) {
      throw new BrokerRefusal(`${what} under ${poc ? 'process_orders_on_close' : 'calc_on_order_fills'} is not served `
        + '(no capture combines the two)', riskRow)
    }
    if (costOn || slipTicks) {
      throw new BrokerRefusal(`${what} with ${costOn ? `a commission (${comm.type})` : `a slippage of ${slipTicks} ticks`} is not `
        + 'served (no capture combines the two)', riskRow)
    }
  }
  /** which tick the fill being made is on: 'open' | 'path' | 'poc' | 'vertex' (W9-T5) */
  let costTick = 'open'
  /** ⭐ W9-T5 [B-COMM-ORDER] fees charged by the order being filled: a per-order fee is ONE per order */
  let orderFees = 0
  /** the price of the tick an extra execution runs on ([B-FILLS]); `null` while the script runs on the close */
  let tickPx = null
  let mintick = NaN
  let pointvalue = NaN
  let seq = 0

  // ─── ⭐⭐ W9-T7-F1: THE ORDER LOG ───────────────────────────────────────────
  /**
   * One row per order this broker HELD, in the order it placed them: what the script asked, and what
   * became of it (placed, then filled, cancelled or rejected, and why).
   *
   * ⛔⛔ A RECORD OF THIS BROKER'S RUN, NOT A RULE. Every log line writes AFTER the broker decided, asks no
   * rule and cannot throw (no `rule`, no `needSymbol`): no fill, size, price, refusal or number value reads
   * the log, so a run with it is the run without it. The only readers are the record (`summary`) and the
   * TEXT values (`strategy.*trades.entry_id` / `exit_id` / `*_comment`), which read it because it is the one
   * authority over a trade's order ids and comments.
   *
   * Rows (`kind`):
   *  - `entry` / `order`: one per order object `placeOrder` holds; a modification ([B-MODIFY]) is the same row;
   *  - `close` / `close_all`: one per market close queued (a second call on one bar is no new order,
   *    [B-CLOSE]), or filled on its own tick (`immediately`, [B-IMMEDIATELY]). Its `id` is null: TradingView
   *    names such an exit itself (R6 `comment`: "instead of the automatically generated exit identifier") and
   *    no text states the name; `from` is the entry id it closes (null for close_all);
   *  - `exit`: one per exit command AND trade it is bound to ([B-EXIT-BIND]): the bracket (take-profit,
   *    stop-loss, trailing stop) that command places for that trade. An exit waiting on an unfilled entry
   *    has no row yet (R6 `strategy.exit`: "the strategy waits and does not create the exit orders until
   *    after the entry order executes"); nor has one that MAY cover the trade a reversal opened (Q-S1f).
   *
   * ⭐ ONE AUTHORITY PER LINK: which trades a row opened or closed is NOT kept on the row. Each trade carries
   * the row that opened it (`oid`) and each closed trade the row that closed it (`xid`); `summary` derives
   * the rows' `opened` / `closed` lists from them.
   */
  const log = []
  /** the row whose fill is closing trades right now (`closeTrade` / `closePart` stamp it as `xid`) */
  let closingRow = null
  /** A label as the log keeps it: `undefined` (not passed) and '' are no comment; a text is kept; anything
   *  else is a comment the front end did not hand over (an expression: `ast/strategyBroker.js` passes only a
   *  literal), which the log marks unrecorded rather than guess. */
  const labelOf = (v) => (v === undefined || v === '' ? { text: null, recorded: true }
    : typeof v === 'string' ? { text: v, recorded: true } : { text: null, recorded: false })
  const logRow = (fields) => {
    const r = { n: log.length + 1, ...fields, placedTime: timeOf(nowBar), modifiedTime: null, triggerTime: null,
      status: 'placed', why: null, endTime: null, fillTime: null, fillPrice: null, fillQty: null, rule: null, leg: null }
    log.push(r)
    return r
  }
  const rowOf = (n) => (Number.isInteger(n) && n >= 1 && n <= log.length ? log[n - 1] : null)
  /** a row that ended without a fill: `cancelled` or `rejected`, and why */
  const endRow = (r, status, why) => {
    if (!r || r.status !== 'placed') return
    r.status = status
    r.why = why
    r.endTime = timeOf(nowBar)
  }
  const logFill = (r, bar, price, qty, leg) => {
    if (!r) return
    r.status = 'filled'
    r.fillTime = timeOf(bar)
    r.fillPrice = price
    r.fillQty = qty
    r.rule = fillRule
    if (leg) {
      r.leg = leg
      // R6 `strategy.exit` `comment_profit` / `_loss` / `_trailing`: "the Strategy Tester and the chart show this text
      // for the order instead of the specified `id` or `comment`"; `comment`: "The command ignores this value if the
      // call includes an argument for a `comment_*` parameter that applies to the order."
      const own = r.legComments ? r.legComments[leg] : undefined
      if (own) { r.comment = own.text; r.commentRecorded = own.recorded }
    }
  }
  /** close-side bookkeeping around a fill that closes trades: `fn` runs with `closingRow` = row `r` */
  const closingWith = (r, fn) => {
    const keep = closingRow
    closingRow = r ? r.n : null
    try { return fn() } finally { closingRow = keep }
  }

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
  /** ⭐⭐ [B-ROUND] / [B-ROUND-MARK] the nearest tick, a tie UP (Pine's own `math.round_to_mintick`), written at
   *  the tick's own decimals. The tick is the run's `syminfo.mintick` (`#symbol`); a run that was not told it
   *  refuses by name (`needSymbol`, through `onTick`), it is never guessed. `1e-6` of a tick is `onTick`'s own
   *  tolerance, so a price a float puts a hair under a half tick is the tie it was written as. */
  const roundToTick = (p) => Number((Math.floor(p / mintick + 0.5 + 1e-6) * mintick).toFixed(tickDecimals(mintick)))
  /**
   * ⭐⭐ [B-ROUND] THE PRICE A FILL ON A BAR'S OPEN TAKES when that open is off the tick grid.
   *
   * WITNESSED, never read from a text (the reference and the manual say nothing): across the 33 committed strategy
   * captures (`tests/fixtures/vendor/harness/*-2026-11-15.json`), 96 of TradingView's reported fills sit on a bar
   * whose OPEN is off the tick grid, on 18 distinct bars of 23 captures, and every one is that open rounded to the
   * nearest tick, a tie up (ties all up, below a half tick all down, above all up; buys and sells; no
   * counterexample, and no reported fill is off the grid). 93 are MARKET fills (entries, `strategy.order`,
   * `strategy.close`, `strategy.close_all`) and 3 are STOP fills of an exit the open reached. The table, by
   * capture: `docs/pine/evidence/2026-11-15-strategy-readbacks/EVIDENCE.md`; the rail that re-derives it from the
   * captures alone: `strategyReadbackWitness.test.js`.
   *
   * ⛔ ONLY THE WITNESSED KINDS. A LIMIT order (an entry, a take-profit) the open gapped through, a trailing stop,
   * a trailing activation, a stop-limit's trigger, and ANY fill on another tick of the bar (the close under
   * process_orders_on_close, a path vertex under calc_on_order_fills) at an off-grid price stop the run by name
   * (Q-S1l): no capture shows what TradingView does there, and it never reports an off-grid fill.
   */
  const roundedOpenFill = (px, mode, markets, gaps) => {
    if (onTick(px)) return px
    if (mode !== 'open') {
      throw new BrokerRefusal(`an order fills on ${mode === 'poc' ? "the bar's closing tick" : 'a tick inside the bar'} at `
        + `${px}, off the tick grid of ${mintick}, and TradingView's rounding of a fill is witnessed only on a bar's open`, 'Q-S1l')
    }
    const unwitnessed = (what) => {
      throw new BrokerRefusal(`${what} fills on a bar's open of ${px}, off the tick grid of ${mintick}, and TradingView's `
        + 'rounding there is witnessed only for a market order and for a stop order the open reached', 'Q-S1l')
    }
    for (const m of markets) if (m.immediate && m.type !== 'stop') unwitnessed(`the ${m.type} entry \`${m.id}\``)
    for (const g of gaps) {
      if (g.kind === 'entry' && g.o.type === 'stop') continue
      if (g.kind === 'exit' && g.leg === 'sl') continue
      unwitnessed(g.kind === 'entry' ? `the ${g.o.type} entry \`${g.o.id}\``
        : g.kind === 'exit' ? `the ${g.leg === 'tp' ? 'take-profit' : 'trailing stop'} of exit \`${g.x.id}\``
          : g.kind === 'trigger' ? `the stop-limit \`${g.o.id}\`'s trigger` : `the trailing activation of exit \`${g.x.id}\``)
    }
    rule('B-ROUND')
    return roundToTick(px)
  }

  // ─── W9-T5: costs ─────────────────────────────────────────────────────────
  /** The fee of filling `units` at `price`, in the account currency, with no rule asked.
   *  R6 `commission_type`: "strategy.commission.percent for a percentage of the cash volume of the order,
   *  strategy.commission.cash_per_contract for currency per contract, strategy.commission.cash_per_order
   *  for currency per order". Cash volume = units x price x pointvalue (B-VAL's currency rule).
   *  HYPOTHESIS (W9-K1..K3 grade it): the fee is not rounded (no text states a rounding). */
  const rawFee = (units, price) => {
    if (!costOn) return 0
    if (comm.type === 'percent') { needSymbol(); return units * price * pointvalue * comm.value / 100 }
    if (comm.type === 'cash_per_contract') return units * comm.value
    return comm.value
  }
  /** a cost paid on the tick of the fill being made: at the close under process_orders_on_close it is
   *  B-POC-COST's hypothesis (W9-P1); on an extra execution's tick ([B-FILLS]) it is not served. (An
   *  `immediately = true` close never gets here with a cost: it is a T7 kind, refused at its call.) */
  const costAtTick = (what) => {
    if (costTick === 'poc') rule('B-POC-COST')
    else if (costTick === 'vertex') {
      throw new BrokerRefusal(`${what} on a fill under \`calc_on_order_fills\` is not served (no capture combines the two)`, 'W9-P2')
    }
  }
  /** The fee one fill pays, asking its rules. R6 `strategy.closedtrades.commission`: "the sum of entry and
   *  exit fees paid in the closed trade", so a trade pays a fee at its entry fill AND at its exit fill (M
   *  "Commission": "With this change, the broker emulator now applies a commission of 1% of the transaction size
   *  to each filled order by default."). Zero commission: 0, nothing asked. */
  const feeOf = (units, price) => {
    if (!costOn) return 0
    askCommission()
    costAtTick(`a commission of ${comm.value} (${comm.type})`)
    if (comm.type === 'cash_per_order') {
      // ⛔ one order closing or opening more than one trade (a reversal, a close of several trades) pays
      // ONE fee, and how TradingView divides it among the trades is not stated
      orderFees += 1
      if (orderFees > 1) {
        throw new BrokerRefusal('one order filled more than one trade under a per-order commission, and how TradingView '
          + 'divides the fee among them is not stated', 'W9-K3')
      }
    }
    return rawFee(units, price)
  }
  /**
   * ⭐⭐ W9-T5 [B-SLIPPAGE] a MARKET fill's price after slippage. R6 `strategy()` `slippage`: "Slippage
   * expressed in ticks. This value is added to or subtracted from the fill price of market/stop orders to
   * make the fill price less favorable for the strategy. E.g., if syminfo.mintick is 0.01 and `slippage` is
   * set to 5, a long market order will enter at 5 * 0.01 = 0.05 points above the actual price."
   * `side` +1 buys (fills higher), -1 sells (fills lower). Counted in whole ticks, like `trailLevel`.
   * M "Slippage": "Because the strategy applies constant slippage to _all_ order fills, some orders can fill
   * _outside_ the candle range in the simulation."
   * ⛔ Served on MARKET orders only: the W9-K4 probe fills market orders and nothing else. A STOP order's
   * slippage (R6 names it; a stop entry, a stop-loss, on a gap or on the path) and a LIMIT order's (R6 names
   * "market/stop orders" only, the manual "_all_ order fills": the two disagree, so it is unsettled by the
   * spec's own rule) both refuse by name (`noPriceOrderSlippage`, W9-K4). A market fill at a price OFF the
   * tick grid also refuses (whether TradingView slips before or after rounding is not stated, W9-K4).
   * HYPOTHESES (W9-K4 grades them): slippage counts whole ticks from an on-grid price; a reversal's one order
   * closes and opens at the one slipped price; a slipped price may lie outside the bar (the manual above).
   */
  /** the decimals a tick is written with (0.01 -> 2, 0.3 -> 1, 5 -> 0, 1/64 -> 6, 1e-7 -> 7), at most 15 */
  const tickDecimals = (t) => {
    const [mant, exp] = String(t).split('e')
    const frac = (mant.split('.')[1] || '').length
    return Math.min(15, Math.max(0, frac - (exp ? Number(exp) : 0)))
  }
  const slipped = (price, side) => {
    if (!slipTicks) return price
    rule('B-SLIPPAGE')
    costAtTick(`a slippage of ${slipTicks} ticks`)
    needSymbol()
    // r2: the grid test is k = round(price / mintick) within a RELATIVE tolerance, so a tick that does not
    // divide 1 (5, 10, 0.3) is a grid like any other; the result steps k by the slippage, and is written at the
    // tick's own decimals (0.3 x 336 reads 100.8, not 100.80000000000001)
    const k = Math.round(price / mintick)
    if (!(Math.abs(price - k * mintick) <= 1e-9 * Math.max(1, Math.abs(price)))) {
      throw new BrokerRefusal(`a market order fills at ${price}, off the tick grid of ${mintick}, under a slippage of `
        + `${slipTicks} ticks, and whether TradingView slips that price before or after rounding it is not stated`, 'W9-K4')
    }
    return Number(((k + side * slipTicks) * mintick).toFixed(tickDecimals(mintick)))
  }
  /** ⛔ a STOP or LIMIT fill under a slippage: refused by name (see `slipped`) */
  const noPriceOrderSlippage = (what, kind) => {
    if (!slipTicks) return
    if (kind === 'stop') {
      throw new BrokerRefusal(`${what} fills under a slippage of ${slipTicks} ticks, and the W9-K4 capture fills market `
        + 'orders only (a stop order\'s slippage is not witnessed)', 'W9-K4')
    }
    throw new BrokerRefusal(`${what} (a limit order) fills under a slippage of ${slipTicks} ticks, and the texts disagree: `
      + 'the v6 reference adds slippage to "market/stop orders"; the User Manual says "the strategy applies constant '
      + 'slippage to _all_ order fills"', 'W9-K4')
  }

  // ─── fills ────────────────────────────────────────────────────────────────
  const closeTrade = (t, price, bar, exact) => {
    const i = open.indexOf(t)
    if (i < 0) return
    riskFill(bar)
    // ⭐ W9-T5: the exit fill's fee; `commission` is the trade's entry fee plus it (0 with no commission)
    const exitFee = feeOf(t.qty, price)
    open.splice(i, 1)
    closed.push({ ...t, exitPrice: price, exitBar: bar, exitRule: fillRule, exact: t.exact && exact, profit: (price - t.price) * t.dir * t.qty,
      commission: t.fee + exitFee, xid: closingRow })
    for (const x of exits) {
      x.trades.delete(t); x.maybe.delete(t); x.res.delete(t)
      // W9-T7-F1: the bracket an exit placed for this trade goes with it (the row that filled is already `filled`)
      endRow(x.rows.get(t), 'cancelled', 'trade-closed')
    }
  }
  /** ⭐ W9-T7 — close `units` of trade `t`: the whole trade, or a split (a closed trade of `units`,
   *  the open one keeps the rest, its entry price, bar and id). [B-EXIT-QTY] [B-CLOSE-QTY] [B-ORDER] */
  const closePart = (t, units, price, bar, exact) => {
    if (units >= t.qty) { closeTrade(t, price, bar, exact); return }
    // (W9-T8: no fill count here - a partial size is a T7 kind, refused beside a risk command, `t7DefaultTimingOnly`)
    // (W9-T5: a partial size is a T7 kind, and a T7 kind with a cost refuses at its call, `t7DefaultTimingOnly`,
    // so no fee is ever split here)
    closed.push({ ...t, qty: units, exitPrice: price, exitBar: bar, exitRule: fillRule, exact: t.exact && exact,
      profit: (price - t.price) * t.dir * units, commission: 0, xid: closingRow })
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
    // (W9-T7-F1: an exit dropped here has no live bracket left: every trade it was bound to was closed, and
    // `closeTrade` ended that bracket's row, or it filled)
    // (`x.awaits`: an exit still waiting for the id of a cancelled `strategy.order`, [B-CANCEL] W9-X5 (b))
    if (open.length === 0) exits = exits.filter((x) => !x.all && (x.trades.size > 0 || x.orders.size > 0 || x.awaits === true))
    else exits = exits.filter((x) => x.all || x.trades.size > 0 || x.orders.size > 0 || x.awaits === true)
  }
  /** `why` (B-MARGIN-CALL): why this position is not the shape whose margin call is witnessed, named in the stop */
  const marginCheck = (price, why) => {
    if (open.length === 0) return
    // ⭐⭐ [B-V3] Pine v2 / v3 read back NO margin setting, so whether TradingView limits a position by its funds there
    // is not witnessed. Served only where it cannot matter: the position fits the equity (as at a margin of 100,
    // and so at any margin); otherwise the run stops by name (W9-G1).
    if (cfg.marginUnread === true) {
      rule('B-MARGIN')
      askCommission()
      needSymbol()
      let net = 0
      for (const t of closed) net += t.profit
      let openPl = 0
      let size = 0
      for (const t of open) { openPl += (price - t.price) * t.dir * t.qty; size += t.qty }
      const equity = costOn ? cfg.initialCapital + moneyOfClosed() + openPl * pointvalue - openFees()
        : cfg.initialCapital + (net + openPl) * pointvalue
      if (!finite(cfg.initialCapital)) throw new BrokerRefusal('the initial capital this strategy runs with is not settled')
      if (equity - size * price * pointvalue < 0) {
        throw new BrokerRefusal('this Pine v2 / v3 position is worth more than the equity, and these versions read back no '
          + 'margin setting, so whether TradingView margin-calls or refuses it is not witnessed', 'W9-G1')
      }
      return
    }
    rule('B-MARGIN')
    if (defaulted.margin) rule('B-DEFAULTS')
    // ⭐ W9-T13a N7 — the check below reads EQUITY, which is net of every closed trade's commission, so
    // it rests on the commission (COMMISSION_RULE, or W9-T5's type rule) whether or not the margin was defaulted
    askCommission()
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
    // W9-T5: with a commission, equity is net of the fees paid (`moneyOfClosed` / `openFees`)
    const equity = costOn ? cfg.initialCapital + moneyOfClosed() + openPl * pointvalue - openFees()
      : cfg.initialCapital + (net + openPl) * pointvalue
    const mvs = size * price * pointvalue
    // ⭐⭐ [B-MARGIN-ZERO] (2026-11-19, the strategy unit) — AT A MARGIN OF 0 NOTHING IS CALLED: Available Funds is the
    // equity itself, and an equity below zero is carried as it is, no margin call, no refusal. Witnessed by
    // w9-q-s1b-v4-shape-b-rddt-1d-2026-11-17 (v4, margins read back 0, capital 1,000, 20,000 shares a trade): its equity
    // falls to -201,004.80, the report lists 0 margin calls, and all 40 trades run on (MATCH, every fill and value). The
    // manual's own algorithm divides by the margin ratio, which is 0 here, so no text states it: only the capture.
    if (ratio === 0 && equity < 0) {
      rule('B-MARGIN-ZERO')
      return
    }
    // [B-MARGIN] Available Funds = Equity - MVS * Margin Ratio; below zero the emulator liquidates (a margin call)
    // or refuses funds. Served only on the witnessed shapes ([B-MARGIN-CALL] `marginTick`, [B-FUNDS] /
    // [B-FUNDS-SHORT] `fundsShort`); here, every other shape stops by name.
    if (equity - mvs * ratio < 0) {
      throw new BrokerRefusal('the position would need more funds than the strategy holds (a margin call or a '
        + `rejected order in TradingView${why ? `; a margin call is witnessed only on one short trade at margin 100, not ${why}` : ''})`, 'Q-S1i')
    }
  }
  /** ⭐⭐ Q-S1i [B-FUNDS] / [B-FUNDS-SHORT] the shape the two report captures witness: a market `strategy.entry`
   *  sized by the percent-of-equity default at 100, at a margin of 100% for its direction, with no commission and
   *  no slippage (the caller adds: no position before it, and not a reversal). LONG: w9-q-s1a-size-v6 (B-FUNDS).
   *  SHORT: w9-q-s1i-short-v6 (B-FUNDS-SHORT, 2026-11-17): of its 20 crossunder entries TradingView lists exactly
   *  the 9 whose qty x fill open <= equity; the 11 others (sized on the signal close, filled at a higher open) are
   *  absent from its 23 trades and 32 fills, and none of them fills at the open and is margin-called there. */
  const fundsRejectShape = (o) => o.kind === 'entry' && o.type === 'market' && o.byDefault === true
    && defaultQtyType() === 'percent_of_equity' && cfg.qtyValue === 100
    && (o.dir > 0 ? cfg.marginLong === 100 : cfg.marginShort === 100)
    && !costOn && !slipTicks
  /** ⭐⭐ Q-S1i [B-FUNDS] / [B-FUNDS-SHORT] with no position open: does `o` at `price` need more than the equity?
   *  (Margin 100%: the position's whole value; `marginCheck`'s Available Funds with no open trade.) Stamps the
   *  rules only when it rejects; an entry within the funds is checked after its fill by `marginCheck`, as before. */
  const fundsShort = (o, price) => {
    needSymbol()
    let net = 0
    for (const t of closed) net += t.profit
    const equity = cfg.initialCapital + net * pointvalue
    if (!(finite(equity) && equity - o.qty * price * pointvalue < 0)) return false
    rule(o.dir > 0 ? 'B-FUNDS' : 'B-FUNDS-SHORT')
    rule('B-MARGIN')
    if (defaulted.margin) rule('B-DEFAULTS')
    return true
  }

  // ─── ⭐⭐ Q-S1i [B-MARGIN-CALL]: TradingView's margin call, on the shape a capture witnesses ───────────────
  /**
   * The User Manual ("Strategies" page, section "Margin and leverage", fetched 2026-11-17) states the event and
   * its size VERBATIM: "the broker emulator generates margin call events if a strategy's available funds fall below
   * the required margin percentage. Each time that a margin call event occurs, the emulator immediately liquidates
   * four times the number of contracts/shares/lots/units required to cover the loss". The algorithm, its steps:
   *   Money Spent = Quantity * Entry Price;  MVS = Position Size * Current Price;
   *   Open Profit = MVS - Money Spent (x -1 for a short);  Equity = Initial Capital + Net Profit + Open Profit;
   *   Margin Ratio = Margin Percent / 100;  Margin = MVS * Margin Ratio;  Available Funds = Equity - Margin;
   *   Loss = Available Funds / Margin Ratio;  Cover Amount = TRUNCATE(Loss / Current Price), "truncated to the same
   *   decimal precision as the minimum position size";  Margin Call Size = Cover Amount * 4.
   * And: "short trades in a strategy that uses any nonzero margin are subject to forced liquidation from margin call
   * events, even if the margin_short argument is 100".
   *
   * What the manual does NOT state, and the capture w9-q-s1i-short-v6-rddt-1d-2026-11-16 (NYSE:RDDT 1D, report ok,
   * the v6 default of 100% of equity at margin 100, held SHORT) WITNESSES, all 13 of its margin calls bar for bar,
   * share for share and cent for cent (docs/pine/evidence/2026-11-17-strategy-margin-call/EVIDENCE.md):
   *   - "Current Price" is each TICK of the bar's simulated path, in order ([B-PATH]): the open after its fills,
   *     then the near extreme, the far extreme and the close; never a price between ticks (bar 84: liquidated at its
   *     high 71.41, not where Available Funds crossed zero near 67.98). One bar can hold two events (bar 297: 60
   *     units at its open 108.19, then 316 at its high 113.7999);
   *   - the event FILLS at that tick's price rounded to the nearest tick (113.7999 -> 113.80, 104.9111 -> 104.91,
   *     106.7068 -> 106.71, 233.7128 -> 233.71, 144.5499 -> 144.55), as a buy that closes part of the trade
   *     (oldest trade, the trade keeps its entry); TradingView lists it as an order with no entry / exit command
   *     (`e: null`), its trade's exit comment `Margin call` and exit id `Close position order` (the std set's
   *     labels: `S>Close position order:Margin call`).
   * ⛔ ONLY THAT SHAPE IS SERVED (`marginCallUnwitnessed`): one open SHORT trade at margin_short 100, no
   * commission, no slippage, the default fill timing, no risk command, no exit bound to the trade, a whole-unit
   * symbol at point value 1. Anything else past the funds still stops by name at the margin check (Q-S1i), as do:
   * a cover that truncates to 0, a tick that is an exact half-tick, a size that differs between the tick's price and
   * its rounded fill, and an order filling on the same tick as a due margin call. A size ABOVE the trade closes the
   * whole trade ([B-MARGIN-CALL-ALL], w9-q-s1b-defaults-v6, 2026-11-17).
   */
  const MARGIN_CALL_COMMENT = 'Margin call'
  /** why the open position is NOT the shape w9-q-s1i-short-v6 witnesses; null when it is */
  const marginCallUnwitnessed = () => {
    if (!(open.length === 1 && open[0].dir < 0)) return open.length > 1 ? 'more than one open trade' : 'a long position'
    if (cfg.marginShort !== 100) return `a margin_short of ${cfg.marginShort} (witnessed at 100 only)`
    if (costOn || slipTicks) return costOn ? 'a commission' : 'a slippage'
    if (poc || coof) return poc ? 'process_orders_on_close' : 'calc_on_order_fills'
    if (riskOn) return 'a strategy.risk.* command'
    const t = open[0]
    if (exits.some((x) => x.trades.has(t) || x.maybe.has(t))) return 'an exit bound to the trade'
    if (minContract !== 1) return `a minimum contract of ${minContract === undefined ? 'unknown' : minContract} (witnessed at 1)`
    if (pointvalue !== 1) return `a point value of ${pointvalue} (witnessed at 1)`
    return null
  }
  /** The manual's algorithm for the one open short trade at `px`: `{ due, units, whole }`. `due`: Available Funds
   *  below zero; `units`: Cover Amount x 4 (a positive count); `whole`: Loss / Current Price sits on a whole number,
   *  where TRUNCATE depends on the last bit of a double. Pure: asks nothing, throws nothing. */
  const marginCallOf = (px) => {
    const t = open[0]
    let net = 0
    for (const c of closed) net += c.profit
    const mvs = t.qty * px
    const openProfit = -(mvs - t.qty * t.price)
    const equity = cfg.initialCapital + net + openProfit
    const ratio = cfg.marginShort / 100
    const avail = equity - mvs * ratio
    if (!(avail < 0)) return { due: false, units: 0, whole: false }
    const k = (avail / ratio) / px
    return { due: true, units: Math.abs(Math.trunc(k)) * 4, whole: Math.abs(k - Math.round(k)) < 1e-9 }
  }
  /** the open position is the witnessed shape, so its margin check is TradingView's margin call */
  const marginCallServes = () => open.length > 0 && marginCallUnwitnessed() === null
  /** is a margin call due at `px` on the position as it stands (pure: nothing asked, nothing thrown)? */
  const marginCallDueAt = (px) => {
    if (!marginCallServes() || !finite(mintick) || !finite(px)) return false
    const k = px / mintick
    return marginCallOf(px).due || (Math.abs(k - Math.round(k)) >= 1e-6 && marginCallOf(roundToTick(px)).due)
  }
  /** an order filled on this tick and a margin call is due on it: which comes first is not witnessed */
  const marginCallBesideFill = (px) => {
    throw new BrokerRefusal(`a margin call is due at ${px} on the same tick as an order's fill, and which of the two `
      + 'TradingView makes first is not witnessed', 'Q-S1i')
  }
  /** ⭐⭐ [B-MARGIN] / [B-MARGIN-CALL] the margin check on ONE TICK of bar `bar` (its open after the open's fills,
   *  then each path vertex). `besideFill`: an order filled on this very tick. The witnessed shape takes TradingView's
   *  margin call; every other open position takes the check it always had (`marginCheck`: below zero, Q-S1i). */
  const marginTick = (px, bar, besideFill) => {
    if (!open.length) return
    const why = marginCallUnwitnessed()
    if (why !== null) { marginCheck(px, why); return }
    // what `marginCheck` asks, in the order it asks it (the rules a short that is never called rests on)
    rule('B-MARGIN')
    if (defaulted.margin) rule('B-DEFAULTS')
    askCommission()
    needSymbol()
    const fill = onTick(px) ? px : roundToTick(px)
    const atPx = marginCallOf(px)
    const atFill = fill === px ? atPx : marginCallOf(fill)
    if (!atPx.due && !atFill.due) return
    if (atPx.due !== atFill.due || atPx.units !== atFill.units) {
      throw new BrokerRefusal(`a margin call at ${px} liquidates ${atPx.units} units at the bar's price and ${atFill.units} at `
        + `its fill's tick ${fill}, and which of the two TradingView computes with is not witnessed`, 'Q-S1i')
    }
    if (besideFill) marginCallBesideFill(px)
    const t = open[0]
    if (!onTick(px) && Math.abs(Math.abs(px / mintick - Math.trunc(px / mintick)) - 0.5) < 1e-6) {
      throw new BrokerRefusal(`a margin call is due at ${px}, exactly half a tick off the grid of ${mintick}, and which way `
        + 'TradingView rounds a margin call\'s fill there is not witnessed', 'Q-S1i')
    }
    if (atPx.whole || atPx.units === 0) {
      throw new BrokerRefusal(atPx.units === 0 ? `a margin call is due at ${px} and the loss covers less than one unit, so `
        + 'the manual\'s size is 0, and what TradingView does then is not witnessed'
        : `a margin call's Loss / Current Price at ${px} sits on a whole number, where its truncation turns on `
          + 'floating-point rounding', 'Q-S1i')
    }
    rule('B-MARGIN-CALL')
    // ⭐⭐ [B-MARGIN-CALL-ALL] (2026-11-17) a size above the trade closes the WHOLE trade. Witnessed by
    // w9-q-s1b-defaults-v6, bar 154: the manual's size at its open 104.90 is 1,540 of a short of 1,306, and TradingView
    // lists one margin call of 1,306 at 104.90 (the trade's remainder), nothing more.
    let units = atPx.units
    if (units > t.qty) { rule('B-MARGIN-CALL-ALL'); units = t.qty }
    const row = logRow({ kind: 'margin_call', id: null, side: 'buy', qty: units, qtyPercent: null, type: 'market',
      limit: null, stop: null, from: null, oca: null, comment: MARGIN_CALL_COMMENT, commentRecorded: true })
    const keep = fillRule
    fillRule = 'B-MARGIN-CALL'
    orderFees = 0
    logFill(row, bar, fill, units)
    closingWith(row, () => closePart(t, units, fill, bar, true))
    fillRule = keep
    afterPositionChange()
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
      if (o.oca.type === 'cancel') dropEntry(e, 'oca-cancel')
      else {
        e.qty -= q
        if (e.row) e.row.qty = e.qty
        if (!(e.qty > 0)) dropEntry(e, 'oca-reduce')
      }
    }
  }
  const dropEntry = (e, why) => {
    entries = entries.filter((x) => x !== e)
    for (const x of exits) x.orders.delete(e)
    endRow(e.row, 'cancelled', why)
  }
  /** ⭐ W9-T7 — a new open trade from order `o`, bound to the exits waiting for it. */
  const openTrade = (o, price, bar, exact, reversed) => {
    riskFill(bar)
    // W9-T5: `fee` is the entry fill's fee, paid now (0 with no commission)
    const t = { entryId: o.id, dir: o.dir, qty: o.qty, price, bar, exact, seq: (seq += 1), entryRule: fillRule, fee: feeOf(o.qty, price),
      oid: o.row ? o.row.n : null }
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
      logFill(o.row, bar, price, o.qty)
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
    logFill(o.row, bar, price, o.qty)
    closingWith(o.row, () => reduceFifo(o.qty, price, bar, exact, null))
    afterPositionChange()
    ocaAfterFill(o, o.qty)
    return null
  }
  /** ⭐ W9-T5 the price an entry fills at: a market order's slipped price ([B-SLIPPAGE]); under a slippage a stop or a
   *  limit entry refuses by name (W9-K4: no capture fills one; for a limit the texts disagree). */
  const entryFillPx = (o, price) => {
    if (!slipTicks) return price
    if (o.type === 'market') return slipped(price, o.dir)
    noPriceOrderSlippage(`the ${o.type} entry \`${o.id}\``, o.type)
    return price
  }
  const fillEntry = (o, price0, bar, exact) => {
    orderFees = 0
    // a same-side default size taken only at a fill: the pyramiding limit rejects the order without one ([B-PYR]);
    // any other fill needs it, and which equity sizes it is not stated (Q-S1a)
    if (o.lazySize && !(o.kind === 'entry' && allow === null && open.length >= maxEntries && open[0].dir === o.dir)) {
      throw new BrokerRefusal(o.lazySize, 'Q-S1a')
    }
    // [B-QTY-REVERSE-M0] the same rule for a reversal sized at margin 0: the trades it was sized against still open
    if (finite(o.reverseEquity) && !(open.length && open.every((t) => t.dir !== o.dir))) {
      throw new BrokerRefusal(`the entry \`${o.id}\` was sized as a reversal of the open trades, which are not open against it `
        + 'at its fill, and what TradingView fills then is not witnessed', 'Q-S1a')
    }
    // a reversal's size taken against trades that are no longer open the other way at its fill: not witnessed
    if (finite(o.sizeEquity) && !(open.length && open.every((t) => t.dir !== o.dir))) {
      throw new BrokerRefusal(`the entry \`${o.id}\` was sized as a reversal of the open trades, which are not open against it `
        + 'at its fill, and what TradingView fills then is not witnessed', 'Q-S1a')
    }
    if (o.kind === 'order') return fillOrder(o, price0, bar, exact)
    // ⭐⭐ W9-T8 [B-RISK-ALLOW] an entry the declared direction may forbid
    if (allow !== null) {
      const r = riskAllow(o, price0, bar, exact)
      if (r !== undefined) return r
    }
    entries = entries.filter((e) => e !== o)
    let reversed = false
    // W9-T5: one order, one (slipped) price for a reversal's close and its new trade. Taken once the entry
    // is known to fill (not at the pyramiding limit), so a dropped entry asks no cost rule.
    let price = price0
    if (open.length && open[0].dir !== o.dir) {
      // ⭐⭐ Q-S1a [B-FUNDS-REVERSE] (2026-11-17) — a reversal sized as a percent of equity ([B-QTY-REVERSE]) whose NEW
      // size x fill price exceeds the equity it was sized from (the signal close's) is REJECTED whole: nothing closes,
      // nothing opens, not kept waiting. Witnessed by w9-q-s1b-defaults-v6: of its 25 reversals the 12 within that
      // equity are TradingView's, the 13 past it are absent, and 3 of those (bars 52, 65, 632) WOULD fit the equity
      // at the fill open (the open trade marked there): the check is against the sizing equity, not a re-mark.
      if (finite(o.sizeEquity) && !costOn && !slipTicks) {
        needSymbol()
        if (o.qty * price0 * pointvalue > o.sizeEquity) {
          rule('B-FUNDS-REVERSE')
          rule('B-MARGIN')
          if (defaulted.margin) rule('B-DEFAULTS')
          endRow(o.row, 'rejected', 'funds')
          return null
        }
      }
      // [B-REVERSE] an entry against the position closes it and opens the new size
      rule('B-REVERSE')
      price = entryFillPx(o, price0)
      closingWith(o.row, () => { for (const t of open.slice()) closeTrade(t, price, bar, exact) })
      reversed = true
    } else if (open.length >= maxEntries) {
      // [B-PYR] at the pyramiding limit a market entry does not execute
      rule('B-PYR')
      if (defaulted.pyramiding) rule('B-DEFAULTS')
      if (o.type === 'market') { endRow(o.row, 'rejected', 'pyramiding'); return null }
      // ⭐ Q-S1g [B-PYR-PRICE] — a price entry whose level is reached at the pyramiding limit does not execute
      // and is NOT kept waiting. Witnessed by VALUES (vw-s1-q-s1g-blocked-stop-entry, NYSE:RDDT 1D, 2026-11-16,
      // pyramiding 1): `L2`'s stop is reached on bars 53-70 while long and again on every bar from 71 after the
      // position closes, and `strategy.position_size` stays 0 from bar 71 to the last bar. Its own rule, unpinned
      // until a capture with the Strategy Tester report grades it MATCH (which also says whether TradingView lists
      // the order at all): until then the run stops here by name, as before, under the rule that will pin it.
      rule('B-PYR-PRICE')
      endRow(o.row, 'rejected', 'pyramiding')
      return null
    }
    if (!reversed) price = entryFillPx(o, price0)
    // ⭐⭐ Q-S1i [B-FUNDS] (2026-11-16) — an entry the strategy's funds cannot carry is REJECTED: no trade, no smaller
    // size, no margin call, and it is not kept waiting. Witnessed by w9-q-s1a-size-v6 (NYSE:RDDT 1D, report ok, the
    // v6 default of 100% of equity, margin 100%, capital 100,000): of its 20 crossover entries TradingView lists
    // exactly the 7 whose qty x fill open <= equity, bar for bar and share for share; the 13 others (sized on the
    // signal close and filled at a higher open, short of the equity by $6.59 to $6,907.05) are absent, and 10 of them
    // would have filled at a later open had the order been kept. ONLY that shape is served (`fundsRejectShape`): any
    // other entry past the funds still stops at the margin check below, by name (Q-S1i).
    if (!reversed && !open.length && fundsRejectShape(o) && fundsShort(o, price)) {
      endRow(o.row, 'rejected', 'funds')
      return null
    }
    if (open.length && maxEntries > 1) { rule('B-PYR'); if (defaulted.pyramiding) rule('B-DEFAULTS') }
    const t = openTrade(o, price, bar, exact, reversed)
    logFill(o.row, bar, price, o.qty)
    if (reversed) afterPositionChange()
    ocaAfterFill(o, o.qty)
    marginCheck(price)
    return t
  }

  // ─── W9-T7: exit binding, reservation and the trailing stop ──────────────────
  /** The activation level of exit `x`'s trailing stop for trade `t` (NaN = none). `quiet` (the order log
   *  only): an unknown tick is NaN, never a refusal. */
  const activationOf = (x, t, quiet) => {
    if (!x.trail) return NaN
    if (finite(x.trail.price)) return x.trail.price
    if (quiet && !finite(mintick)) return NaN
    needSymbol()
    return t.price + t.dir * x.trail.points * mintick
  }
  /** ⭐ W9-T7-F1 — the bracket row of exit `x` on trade `t`: its levels and size as they stand now. Writes
   *  the log only (quiet levels: nothing here can refuse). */
  const logBracket = (x, t) => {
    const lv = levelsFor(x, t, true)
    const num = (v) => (finite(v) ? v : null)
    const want = {
      qty: x.res.has(t) ? x.res.get(t) : null,
      qtyPercent: x.qtySpec && x.qtySpec.pct !== undefined ? x.qtySpec.pct : null,
      legs: {
        profit: num(lv.tp),
        loss: num(lv.sl),
        trailing: x.trail ? { activation: num(activationOf(x, t, true)), offset: x.trail.offset } : null,
      },
      comment: x.comment.text,
      commentRecorded: x.comment.recorded,
      legComments: x.legComments,
    }
    let r = x.rows.get(t)
    if (!r) {
      r = logRow({ kind: 'exit', id: x.id, side: t.dir > 0 ? 'sell' : 'buy', type: 'bracket', limit: null, stop: null,
        from: x.fromEntry === '' ? null : x.fromEntry, oca: null, ...want })
      x.rows.set(t, r)
      return
    }
    if (r.status !== 'placed') return
    const sig = (o) => JSON.stringify([o.qty, o.qtyPercent, o.legs, o.comment, o.commentRecorded, o.legComments])
    if (sig(r) !== sig(want)) { Object.assign(r, want); r.modifiedTime = timeOf(nowBar) }
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
    logBracket(x, t)
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

  /** An exit command's two levels for one trade: `{ tp, sl }` (NaN = none). `quiet` (the order log only):
   *  a level that needs an unknown tick is NaN, never a refusal. */
  const levelsFor = (x, t, quiet) => {
    const lv = (spec, sign) => {
      if (!spec) return NaN
      const rel = () => {
        if (quiet && !finite(mintick)) return NaN
        needSymbol(); return t.price + sign * t.dir * spec.ticks * mintick
      }
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
  /**
   * ⭐⭐ [B-ROUND-LEVEL] (2026-11-19, the strategy unit) — THE PRICE A SHORT'S EXIT FILLS AT WHEN ITS LEVEL IS OFF THE TICK
   * GRID AND THE BAR'S PATH REACHES IT: the first tick at or past the level in the direction the price travels to it, its
   * stop-loss (a buy stop, reached on a rise) the tick above, its take-profit (a buy limit, reached on a fall) the tick
   * below. WITNESSED, never read from a text, by macd-shortlong-strategy-is-rddt-1d-2026-11-18 (community,
   * corpus/committed, MPL-2.0; MATCH on every trade, fill and value), the short's exits:
   *     stop 115.9543 -> 115.96, 175.7283 -> 175.73, 203.6309 -> 203.64 (the nearest tick would be 115.95, 203.63);
   *     limit 50.376 -> 50.37, 138.672 -> 138.67 (the nearest tick would be 50.38).
   * (w9-q-s1a-size-stop-v6's four off-grid LONG stop entries fill the same way, 116.3872 -> 116.39, 221.7642 -> 221.77,
   * 234.7128 -> 234.72, 183.645 -> 183.65, but that capture does not MATCH (a cent on one trade's profit), so a stop
   * ENTRY is not served by this rule.)
   * ⛔ ONLY THE WITNESSED KINDS: a short's stop-loss and take-profit (`strategy.exit`). A long's exits (sell levels), an
   * entry's level, a trailing stop and a stop-limit's trigger keep the fill they had at the raw level, off the grid, and
   * every read of that trade refuses by name (Q-S1l), as before. A tick the bar's path does not reach (`segEnd`: the
   * vertex the price travels to) is not witnessed either: refused by name.
   * @returns {{px: number, exact: boolean}}
   */
  const levelFill = (lo, level, segEnd) => {
    if (onTick(level)) return { px: level, exact: true }
    const shortExit = lo.kind === 'exit' && lo.t.dir < 0 && (lo.leg === 'sl' || lo.leg === 'tp')
    if (!shortExit) return { px: level, exact: false }
    const dec = tickDecimals(mintick)
    const k = level / mintick
    const px = Number(((lo.up ? Math.ceil(k - 1e-6) : Math.floor(k + 1e-6)) * mintick).toFixed(dec))
    if (lo.up ? px > segEnd : px < segEnd) {
      throw new BrokerRefusal(`the ${lo.leg === 'tp' ? 'take-profit' : 'stop-loss'} of exit \`${lo.x.id}\` has its level `
        + `${level} off the tick grid of ${mintick}, and the tick it would fill at, ${px}, is past the bar's `
        + `${lo.up ? 'high' : 'low'} ${segEnd}: what TradingView fills then is not witnessed`, 'Q-S1l')
    }
    rule('B-ROUND-LEVEL')
    return { px, exact: true }
  }
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
      if (lo.o.row) lo.o.row.triggerTime = timeOf(bar)
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
    orderFees = 0
    // W9-T5: under a slippage a stop-loss (a stop order) and a take-profit (a limit order) refuse by name, W9-K4
    if (lo.leg === 'sl') noPriceOrderSlippage(`the stop-loss of exit \`${lo.x.id}\``, 'stop')
    else if (lo.leg === 'tp') noPriceOrderSlippage(`the take-profit of exit \`${lo.x.id}\``, 'limit')
    const keep = fillRule
    if (lo.leg === 'trail') fillRule = 'B-TRAIL'
    requireOldest([lo.t])
    const units = lo.x.res.has(lo.t) ? lo.x.res.get(lo.t) : lo.t.qty
    if (units > lo.t.qty) {
      throw new BrokerRefusal(`exit \`${lo.x.id}\` reserved ${units} of a trade that now holds ${lo.t.qty}, and what `
        + 'TradingView fills then is not stated', 'W9-X2')
    }
    const xrow = lo.x.rows.get(lo.t)
    const leg = lo.leg === 'tp' ? 'profit' : lo.leg === 'sl' ? 'loss' : 'trailing'
    if (units < lo.t.qty) {
      // [B-EXIT-QTY] a partial exit closes its reserved part; that command is done with the trade
      fillRule = lo.leg === 'trail' ? 'B-TRAIL' : 'B-EXIT-QTY'
      logFill(xrow, bar, price, units, leg)
      closingWith(xrow, () => closePart(lo.t, units, price, bar, exact))
      lo.x.trades.delete(lo.t); lo.x.res.delete(lo.t); lo.x.done.add(lo.t)
    } else {
      lo.x.done.add(lo.t)
      logFill(xrow, bar, price, units, leg)
      closingWith(xrow, () => closeTrade(lo.t, price, bar, exact))
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
    costTick = mode
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
    // ⭐⭐ Q-S1d [B-ENTRY-ORDER] (2026-11-17) several MARKET `strategy.entry` orders and nothing else on one OPENING
    // tick are taken in the order the script placed them, each against the position the one before it left; served
    // only while every one before the last fills nothing. Witnessed by w9-q-s1b-defaults-v6 (`L2`, placed every fourth
    // bar while long, beside `S` on a crossunder bar and `L1` on a crossover bar): bars 229 and 629, `L2` (placed
    // first) rejected at the pyramiding limit, then `S` reverses the long (fills of 1,027 and 776); bars 65 and 585,
    // both rejected; bar 641, `L1` and `L2` both rejected. Had `S` gone first, `L2` would have reversed it back.
    const entryQueue = mode === 'open' && cls.length === 0 && gaps.length === 0 && markets.length > 1
      && markets.every((m) => m.kind === 'entry' && m.type === 'market' && !m.immediate)
    if (n > 1 && !oneCommand && !entryQueue) {
      const where = atClose ? 'closing tick' : mode === 'vertex' ? 'tick' : 'opening tick'
      throw new BrokerRefusal(`${n} orders fill on the same ${where}, and the order TradingView fills them in is not stated`, 'Q-S1d')
    }
    // ⭐⭐ [B-ROUND] `px` stays the bar's own price (what an order's level is reached against); `fpx` is the
    // price the fill takes. On the grid the two are one number and nothing is asked.
    const fpx = roundedOpenFill(px, mode, markets, gaps)
    let fresh = null
    if (cls.length) {
      const cl = cls[0]
      closes = closes.filter((c) => !cls.includes(c))
      // a vertex fill is LABELLED B-FILLS and asks nothing more: `beginBar` asked B-FILLS before the
      // extra execution that placed the order (and asks it again before the one this fill starts)
      if (atClose) { fillRule = 'B-POC'; rule('B-CLOSE'); rule('B-POC') } else if (mode === 'vertex') {
        fillRule = 'B-FILLS'
      } else { fillRule = 'B-CLOSE'; rule('B-CLOSE'); rule('B-MARKET') }
      executeClose(cl, fpx, bar, true)
    } else if (entryQueue) {
      rule('B-ENTRY-ORDER')
      fillRule = 'B-MARKET'
      rule(fillRule)
      let any = false
      for (const [k, m] of markets.entries()) {
        const before = open.length + closed.length
        const made = fillEntry(m, fpx, bar, true)
        if (!made && open.length + closed.length === before) continue
        any = true
        fresh = made || fresh
        if (k < markets.length - 1) {
          throw new BrokerRefusal(`the entry \`${m.id}\` filled on an opening tick where ${markets.length - 1 - k} later entr`
            + `${markets.length - 1 - k === 1 ? 'y waits' : 'ies wait'}, and what TradingView does with them then is not witnessed`, 'Q-S1d')
        }
      }
      return { filled: any, fresh }
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
      fresh = fillEntry(m, fpx, bar, true)
      if (!fresh && open.length + closed.length === before) return { filled: false, fresh: null }
    } else {
      fillRule = atClose ? 'B-POC-PRICE' : 'B-GAP'
      rule(fillRule)
      for (const g of gaps) fresh = fire(g, fpx, bar, true) || fresh
    }
    return { filled: true, fresh }
  }

  /** ⭐ [B-FILL] fill everything bar `bar` fills, BEFORE the script runs on it.
   *  ⭐⭐ W9-T6 — a GENERATOR, so a run under calc_on_order_fills can stop at a fill tick, run the script
   *  there (`vm.js`), and resume the walk from that tick. Without it the walk never yields. */
  function* barTicks(bar) {
    nowBar = bar
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
    // [B-MARGIN-CALL] a margin call due at this open on the position BEFORE the open's fills, beside a fill there:
    // which TradingView makes first is not witnessed (the capture's open fills all meet no due call)
    const dueBeforeFills = marginCallDueAt(o)
    const opened = tickFill(o, bar, 'open')
    if (dueBeforeFills && opened.filled) marginCallBesideFill(o)
    // the witnessed shape takes the margin check on each tick of the path, as TradingView does; every other
    // position keeps the check it always had, at the bar's worst price after the open's fills
    if (marginCallServes()) marginTick(o, bar, false)
    else marginCheckBar(bar)
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
      // [B-MARGIN-CALL] with no order to fill on the path, the order of the two extremes cannot move a short's margin
      // call: it can fall due only at the high (Available Funds falls as the price rises), so either order gives it
      for (const v of [h, l, c]) if (marginCallServes()) marginTick(v, bar, false)
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
      // [B-MARGIN-CALL] an order filled AT this vertex (its level is the vertex's price)
      let filledAtVertex = false
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
        if (best === target) {
          // [B-MARGIN-CALL] a call due at this vertex on the position before the fill: the order is not witnessed
          if (marginCallDueAt(target)) marginCallBesideFill(target)
          filledAtVertex = true
        }
        let made = null
        costTick = 'path'
        // [B-ROUND-LEVEL] a witnessed buy level off the grid fills on the grid (`levelFill`); every other fill as before
        for (const x of hit) {
          const lf = levelFill(x, best, target)
          made = fire(x, lf.px, bar, lf.exact) || made
        }
        riskTick(best) // W9-T8: a fill level on the path (a reversal there is an equity extreme no vertex holds)
        checkActivation(best, made)
        if (coof) {
          if (last && best === target) closingTick()
          tickPx = best; yield best; afterExtra(best)
        }
      }
      p = target
      riskTick(target) // W9-T8: each vertex the path reaches (the bar's last is its close)
      ratchetTrails(target)
      // [B-MARGIN-CALL] the margin check on this tick of the path (the witnessed shape only)
      if (marginCallServes()) marginTick(target, bar, filledAtVertex)
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
    nowBar = bar
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
  const executeClose = (cl, price0, bar, exact) => {
    const targets = cl.kind === 'all' ? open.slice() : open.filter((t) => t.entryId === cl.id)
    orderFees = 0
    // ⭐ W9-T5 [B-SLIPPAGE] a close is a market order that sells a long (fills lower) or buys back a short
    const price = targets.length && slipTicks ? slipped(price0, -targets[0].dir) : price0
    // W9-T7-F1: the log reads what this close closed AFTER it closed it (the size the trades lost)
    const held = sum(open, (t) => t.qty)
    closingWith(cl.row, () => executeCloseOn(cl, targets, price, bar, exact))
    const units = held - sum(open, (t) => t.qty)
    if (units > 0) logFill(cl.row, bar, price, units)
    else endRow(cl.row, 'cancelled', 'nothing-to-close')
    afterPositionChange()
  }
  const executeCloseOn = (cl, targets, price, bar, exact) => {
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
  }
  /** [B-MARGIN] the bar's worst price for the position, after its fills. */
  const marginCheckBar = (bar) => {
    if (!open.length) return
    // a short that is not the witnessed shape names why its margin call is not served ([B-MARGIN-CALL])
    marginCheck(open[0].dir > 0 ? L[bar] : H[bar], open[0].dir < 0 ? marginCallUnwitnessed() : undefined)
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
    // ⭐ W9-T5 — nor with costs: the W9-K rows fill whole market entries and closes only, so a T7 kind under a
    // commission (a partial fill's fee split, a per-order fee) or a slippage stops by name
    if (slipTicks) {
      throw new BrokerRefusal(`${what} with a slippage of ${slipTicks} ticks is not served (no capture combines the two)`, 'W9-K4')
    }
    if (costOn) {
      throw new BrokerRefusal(`${what} with a commission (${comm.type}) is not served (no capture combines the two)`, COMM_ROW[comm.type])
    }
    // ⭐ W9-T8 — nor with a risk command: every W9-R1 / W9-R1i probe places whole market entries and closes only.
    // (This is also what refuses `strategy.order` beside allow_entry_in, which R6 and the manual do not cover:
    // both name strategy.entry only.)
    if (riskOn) throw new BrokerRefusal(`${what} with a strategy.risk.* command is not served (no capture combines the two)`, riskRow)
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
    const [id0, dirV, qtyV, limV, stpV, ocaN, ocaT, cmt, when] = a
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
    const sized = {}
    if (!finite(qty)) qty = defaultSize(type === 'stoplimit' ? 'stop-limit' : type, id, bar, dir, kind, sized)
    if (!sized.lazy && !(qty > 0)) throw new BrokerRefusal(`${fn} with a quantity of ${qty}`, 'Q-S1a')
    // [B-IMMEDIATE] a limit at a worse price than the market (or a stop at a better
    // one) fills on the next tick rather than waiting
    const immediate = type === 'limit' ? (dir > 0 ? level >= cl : level <= cl)
      : type === 'stop' ? (dir > 0 ? level <= cl : level >= cl) : false
    const oca = ocaOf(ocaN, ocaT, fn)
    // a same-side size taken only at a fill (`defaultSize`) is never reduced by an OCA group: stopped now, as before
    if (sized.lazy && oca) throw new BrokerRefusal(sized.lazy, 'Q-S1a')
    // `byDefault`: the size is the declaration's default order size ([B-QTY], `defaultSize`), read by [B-FUNDS]
    // `lazySize`: the stop a same-side default size takes if the order fills; `sizeEquity`: the equity a reversal's
    // size was taken from ([B-QTY-REVERSE], read by [B-FUNDS-REVERSE]), NaN otherwise
    const o = { id, kind, dir, qty, type, level, limit: type === 'stoplimit' ? limV : NaN, placedBar: bar, immediate, oca,
      byDefault: !finite(qtyV), lazySize: sized.lazy || null, sizeEquity: finite(sized.sizeEquity) ? sized.sizeEquity : NaN,
      // [B-QTY-REVERSE-M0] the equity a reversal at margin 0 was sized from (no funds check reads it)
      reverseEquity: finite(sized.reverseEquity) ? sized.reverseEquity : NaN }
    // [B-MODIFY] an unfilled order with the same id is modified, not duplicated
    const prev = entries.find((e) => e.id === id)
    if (prev) {
      if (prev.kind !== kind) {
        throw new BrokerRefusal(`the id \`${id}\` names an unfilled order of both strategy.entry and strategy.order, and `
          + 'whether one modifies the other is not stated', 'W9-X4')
      }
      rule('B-MODIFY')
      Object.assign(prev, o)
      // W9-T7-F1: a modification is the same order (its row), as the script now states it
      if (prev.row) {
        Object.assign(prev.row, entryRowOf(o, limV, stpV, cmt))
        prev.row.modifiedTime = timeOf(bar)
        prev.row.triggerTime = null // a modified stop-limit waits on its stop again (`Object.assign` above)
      }
      return
    }
    o.row = logRow({ kind, id, ...entryRowOf(o, limV, stpV, cmt) })
    entries.push(o)
    // ⭐⭐ [B-CANCEL] W9-X5 (b), WITNESSED (w9-x5-cancel-rddt-1d-2026-11-15): an exit command that was waiting on a
    // `strategy.order` the script cancelled keeps waiting for that id, and binds the `strategy.order` placed again
    // under it, though the exit is not called again. The capture's first trade: `O` cancelled on bar 21, placed
    // again on bar 25 (market), filled on bar 26's open at 46.05, and closed on that same bar at 46.55 by `XO`'s
    // take-profit (label `O>XO:xo`). ⚰️ This broker released the exit at the cancel (a hypothesis the queue row
    // named as its question (b)); the capture shows it is kept. ⛔ Only the witnessed kind: a cancelled
    // `strategy.entry` keeps the old behaviour (its exit is released), which no capture contradicts.
    for (const x of exits) {
      if (kind === 'order' && x.awaits === true && x.fromEntry === id) { x.orders.add(o); x.awaits = false }
    }
  }
  /** W9-T7-F1 — what an entry / order row states of order `o` */
  const entryRowOf = (o, limV, stpV, cmt) => {
    const c = labelOf(cmt)
    return {
      side: o.dir > 0 ? 'buy' : 'sell', qty: o.qty, qtyPercent: null, type: o.type,
      limit: o.type === 'limit' || o.type === 'stoplimit' ? limV : null,
      stop: o.type === 'stop' || o.type === 'stoplimit' ? stpV : null,
      from: null, oca: o.oca ? { name: o.oca.name, type: o.oca.type } : null,
      comment: c.text, commentRecorded: c.recorded,
    }
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
    cl.row = closeRow(cl)
    const keep = fillRule
    fillRule = 'B-IMMEDIATELY'
    executeClose(cl, C[bar], bar, onTick(C[bar]))
    fillRule = keep
    immediateBar = bar
  }
  /** W9-T7-F1 — the row of a market close `cl` (`{ kind, id, spec, comment }`), placed now */
  const closeRow = (cl) => {
    const targets = cl.kind === 'all' ? open : open.filter((t) => t.entryId === cl.id)
    const c = labelOf(cl.comment)
    return logRow({
      kind: cl.kind === 'all' ? 'close_all' : 'close', id: null,
      side: targets.length ? (targets[0].dir > 0 ? 'sell' : 'buy') : null,
      qty: cl.spec && cl.spec.qty !== undefined ? cl.spec.qty : null,
      qtyPercent: cl.spec && cl.spec.pct !== undefined ? cl.spec.pct : null,
      type: 'market', limit: null, stop: null, from: cl.kind === 'all' ? null : cl.id, oca: null,
      comment: c.text, commentRecorded: c.recorded,
    })
  }
  const close = (a, bar) => {
    const [id0, qtyV, pctV, now, cmt, when] = a
    rule('B-SIG'); rule('B-CLOSE')
    if (when !== undefined) rule('B-WHEN')
    if (!truthy(when)) return
    const id = idText(id0, '`strategy.close`')
    const spec = closeSpec(qtyV, pctV, '`strategy.close`')
    if (spec) { rule('B-CLOSE-QTY'); t7DefaultTimingOnly('a partial `strategy.close`') }
    // [B-CLOSE] no open trade with this id when the command is called: no effect
    if (!open.some((t) => t.entryId === id)) return
    if (now !== undefined && truthy(now)) { closeNow({ kind: 'id', id, spec, comment: cmt }, bar); return }
    const prev = closes.find((c) => c.kind === 'id' && c.id === id)
    if (prev && (spec || prev.spec)) {
      throw new BrokerRefusal(`\`strategy.close\` \`${id}\` was called twice on one bar with a partial size, and whether `
        + 'that is one order or two is not stated', 'W9-X2')
    }
    if (!prev) {
      const cl = { kind: 'id', id, spec, comment: cmt }
      cl.row = closeRow(cl)
      closes.push(cl)
    }
  }
  const closeAll = (a, bar) => {
    const [now, cmt, when] = a
    rule('B-SIG'); rule('B-CLOSE')
    if (when !== undefined) rule('B-WHEN')
    if (!truthy(when)) return
    if (!open.length) return
    if (now !== undefined && truthy(now)) { closeNow({ kind: 'all', spec: null, comment: cmt }, bar); return }
    if (!closes.some((c) => c.kind === 'all')) {
      const cl = { kind: 'all', spec: null, comment: cmt }
      cl.row = closeRow(cl)
      closes.push(cl)
    }
  }
  const exit = (a) => {
    const [id0, from0, qtyV, pctV, profit, limit, loss, stop, trP, trPts, trOff, cmt, cmtP, cmtL, cmtT, when] = a
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
        maybe: new Set(), res: new Map(), trailState: new Map(), done: exitDone.get(id), rows: new Map() }
      exits.push(x)
    }
    x.tp = tp
    x.sl = sl
    x.trail = trail
    x.qtySpec = qtySpec
    // W9-T7-F1: the labels, for the log (a `comment_*` passed, even empty, overrides `comment` on its leg)
    x.comment = labelOf(cmt)
    x.legComments = {}
    for (const [leg, v] of [['profit', cmtP], ['loss', cmtL], ['trailing', cmtT]]) {
      if (v !== undefined) x.legComments[leg] = labelOf(v)
    }
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
    for (const e of entries.filter((o) => o.id === id)) {
      // [B-CANCEL] W9-X5 (b): an exit waiting on this `strategy.order` keeps waiting for its id (`placeOrder`)
      if (e.kind === 'order') for (const x of exits) if (x.orders.has(e) && x.fromEntry === id) x.awaits = true
      dropEntry(e, 'strategy.cancel')
    }
    for (const x of exits) if (x.id === id) for (const r of x.rows.values()) endRow(r, 'cancelled', 'strategy.cancel')
    exits = exits.filter((x) => x.id !== id)
  }
  const cancelAll = (a) => {
    rule('B-SIG'); rule('B-CANCEL')
    if (a[0] !== undefined) rule('B-WHEN')
    if (!truthy(a[0])) return
    for (const e of entries) endRow(e.row, 'cancelled', 'strategy.cancel_all')
    for (const x of exits) for (const r of x.rows.values()) endRow(r, 'cancelled', 'strategy.cancel_all')
    entries = []
    exits = []
  }

  // ─── ⭐⭐ W9-T8: strategy.risk.* ──────────────────────────────────────────────
  /**
   * [B-RISK-ALLOW] R6 `strategy.risk.allow_entry_in`: "This function can be used to specify in which market direction
   * the strategy.entry() function is allowed to open positions." Its example: "Instead of opening a short position with
   * 10 contracts, this command will close long entries." User Manual ("Risk management", the live page, 2026-11-08):
   * "This command overrides the market direction allowed for all calls to the strategy.entry() command. If a user
   * specifies the trade direction with the strategy.risk.allow_entry_in() function (e.g., strategy.direction.long),
   * the strategy enters trades only in that direction. If the script calls an entry command in the opposite direction
   * of an open market position, the strategy generates a market order to close the position without entering a new
   * trade in that direction."
   * HYPOTHESES (W9-R1, `w9-r1-risk-allow.pine`, grades them): that close is the forbidden entry's own market order,
   * filled where and when the entry would have filled (the next open), and it closes every open trade (oldest first);
   * a forbidden entry with no position open fills nothing; an allowed entry, and `strategy.direction.all`, change nothing.
   * ⛔ Refused by name (W9-R1): a forbidden PRICE entry (the probe places market entries only). Returns `undefined`
   * when the entry proceeds as usual, else what `fillEntry` returns.
   */
  const riskAllow = (o, price, bar, exact) => {
    rule(RISK_RULES.allow)
    riskDefaultOnly('`strategy.risk.allow_entry_in`')
    const side = o.dir > 0 ? 'long' : 'short'
    if (allow === 'all' || allow === side) return undefined
    if (o.type !== 'market') {
      throw new BrokerRefusal(`the ${o.type} entry \`${o.id}\` is ${side}, which strategy.risk.allow_entry_in(${allow}) forbids, `
        + 'and what TradingView does with a forbidden price entry is not witnessed (the W9-R1 probe places market entries only)', 'W9-R1')
    }
    // (an exit waiting for this id keeps a reference to an order that never fills, which places nothing: `liveOrders`
    // reads only bound trades, and the exit ends with the position, `afterPositionChange`)
    entries = entries.filter((e) => e !== o)
    if (!open.length) { endRow(o.row, 'rejected', 'risk-allow-entry-in'); return null }
    // the open position is the other direction's: the allowed one (nothing else opens a trade beside a risk command,
    // `t7DefaultTimingOnly` refuses `strategy.order`)
    const keep = fillRule
    fillRule = RISK_RULES.allow
    const targets = open.slice()
    requireOldest(targets)
    logFill(o.row, bar, price, sum(targets, (t) => t.qty))
    closingWith(o.row, () => { for (const t of targets) closeTrade(t, price, bar, exact) })
    fillRule = keep
    afterPositionChange()
    return null
  }
  /**
   * [B-RISK-DDOWN] R6 `strategy.risk.max_drawdown`: "The purpose of this rule is to determine maximum drawdown. The rule
   * affects the whole strategy. Once the maximum drawdown value is reached, all pending orders are cancelled, all open
   * positions are closed and no new orders can be placed." `value`: "The maximum drawdown value. It is specified either in
   * money (base currency), or in percentage of maximum equity. For % of equity the range of allowed values is from 0 to
   * 100." `type`: "Note: if equity drops down to zero or to a negative and the 'strategy.percent_of_equity' is specified,
   * all pending orders are cancelled, all open positions are closed and no new orders can be placed for good." User
   * Manual: "This command cancels all pending orders, closes any open market position, and stops all additional trade
   * actions after the strategy's drawdown reaches the amount specified in the function call."
   * SERVED: only a run that stays BELOW the limit, which is the run without the call (the rule's one hypothesis).
   * ⛔ The texts leave open what "drawdown" is measured on and when: equity with or without open profit, at each tick
   * (the manual: "All risk management commands execute on every tick and order execution event") or at the bar close,
   * and whether a percent is of the maximum equity (R6) or, say, of the initial capital. So the check takes the WIDEST
   * reading, and a run that MAY reach the limit under any of them stops by name (W9-R1). The series is equity WITH
   * open profit, from a peak that starts at the initial capital, at every extreme the path can make: each vertex (the
   * bar's extremes and its close) and each fill level on the path. Between those the position is fixed and the price
   * monotonic, so equity is monotonic; at a fill equity is continuous (no cost is served beside a risk command), and
   * only a REVERSAL at a level turns it there. The open needs no sample of its own: it lies between the bar's extremes,
   * and with the position held after its fills it is never beyond the vertex on either side. A finer sampling can only
   * raise the peak and lower the trough, so a run below the limit here is below it at any coarser one (the bar close).
   * Equity of CLOSED trades
   * only needs no series of its own: it moves only at a fill, where both series hold the same realized part, and a
   * trade closing at a loss was already under water in the open series on the path to that fill, on the same prices
   * (one symbol, costs refused beside a risk command). A percent is taken of the smaller of the initial capital and
   * the maximum equity, which is the initial capital (the peak starts there). The halt itself is never served.
   */
  let ddPeak = NaN
  const riskTick = (px) => {
    if (maxDd === null) return
    needSymbol()
    const cap = cfg.initialCapital
    const eq = cap + (netPts() + sum(open, (t) => (px - t.price) * t.dir * t.qty)) * pointvalue
    ddPeak = Math.max(ddPeak, eq)
    const dd = ddPeak - eq
    const limit = maxDd.type === 'cash' ? maxDd.value : cap * maxDd.value / 100
    if (dd >= limit - 1e-9 * Math.max(1, Math.abs(limit))) {
      throw new BrokerRefusal(`strategy.risk.max_drawdown(${maxDd.value}, ${maxDd.type}) may reach its limit at ${px}: a `
        + `drawdown of ${dd} from an equity of ${ddPeak} by the widest reading of the texts (every tick the path reaches; a `
        + 'percent of the initial capital, the smaller base), and what TradingView does at the limit (which tick it closes '
        + 'on, at what price) is not witnessed', 'W9-R1')
    }
  }
  /**
   * [B-RISK-INTRADAY-ORDERS] R6 `strategy.risk.max_intraday_filled_orders`: "The purpose of this rule is to determine
   * maximum number of filled orders per 1 day (per 1 bar, if chart resolution is higher than 1 day). The rule affects
   * the whole strategy. Once the maximum number of filled orders is reached, all pending orders are cancelled, all open
   * positions are closed and no new orders can be placed till the end of the current trading session." User Manual:
   * "This command specifies the maximum number of filled orders per trading day (or per chart bar if the chart's
   * timeframe is higher than "1D"). If the strategy fills more orders than the specified limit, the command cancels all
   * pending orders, closes any open market position, and halts trading activity until the end of the current session."
   * SERVED: only a run below the limit on every trading day, which is the run without the call.
   * ⛔ The texts disagree on the trigger (R6 "is reached", the manual "fills more orders than the specified limit");
   * what a "day" is depends on the symbol's session and exchange time zone, which no run carries; and whether one order
   * that fills several trades (a reversal, a close of several) counts once is not stated. So the run must be TOLD each
   * bar's trading day (`ctx.tradingDays`; no product caller is yet), every trade a fill opens or closes counts once (an
   * upper bound on filled orders), and a day whose count REACHES the limit stops the run by name (W9-R1i). The halt
   * itself is never served.
   */
  const dayFills = new Map()
  const riskFill = (bar) => {
    if (dayCap === null) return
    rule(RISK_RULES.intradayOrders)
    riskDefaultOnly('`strategy.risk.max_intraday_filled_orders`')
    const day = Array.isArray(tradingDays) && Number.isInteger(bar) && bar >= 0 && bar < tradingDays.length ? tradingDays[bar] : undefined
    if (day === undefined || day === null) {
      throw new BrokerRefusal('`strategy.risk.max_intraday_filled_orders` counts filled orders per trading day, and the trading '
        + 'day of each bar (its session and exchange time zone) is not known to this run', 'W9-R1i')
    }
    const n = (dayFills.get(day) || 0) + 1
    dayFills.set(day, n)
    if (n >= dayCap) {
      throw new BrokerRefusal(`strategy.risk.max_intraday_filled_orders(${dayCap}) may reach its limit on trading day ${day} `
        + `(${n} fills, each trade a fill opens or closes counted once): the v6 reference halts "once the maximum number of `
        + 'filled orders is reached", the User Manual when the strategy "fills more orders than the specified limit", and the '
        + 'halt (cancel, close, no new orders until the end of the session) is not witnessed', 'W9-R1i')
    }
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
  // ⭐ W9-T5 — with a commission, money figures are NET of the fees (R6 `strategy.closedtrades.profit`:
  // "reduced by the trade's commissions"). Used ONLY when `costOn`: with no commission every figure keeps its
  // pre-W9-T5 expression, so its arithmetic (and the bits) cannot move.
  const netOf = (t) => t.profit * pointvalue - t.commission
  const moneyOfClosed = () => sum(closed, netOf)
  /**
   * ⭐⭐ value read-backs — WHERE AN OPEN TRADE'S ENTRY FEE GOES, as the W9-K1 / K2 / K3 captures plot it.
   * The fee is PAID when the entry fills (R6 `strategy.opentrades.commission`: "fees paid in the open trade"), and
   * TradingView takes it off `strategy.netprofit` on that bar, NOT off `strategy.openprofit`: on every one of the
   * 372 bars each capture holds a position, the plotted S07_netprofit is the closed trades' net profit minus the
   * open trade's entry fee (-0.04547 on the first entry bar of W9-K1: 0.1% of 45.47; -1.5 on W9-K2; -5 on W9-K3)
   * and S09_openprofit is (close - entry price) x size with no fee in it. `strategy.equity` is the same number
   * either way. ⚰️ W9-T5 took the fee off the open profit (a hypothesis the captures graded, and refuted).
   * The exit fee is not paid until the exit fills and is counted nowhere before.
   */
  const openFees = () => sum(open, (t) => t.fee)
  /** ⛔ `strategy.grossprofit` / `grossloss` while an open trade has paid a fee: the K probes do not plot them, so
   *  which of the two (if either) the paid entry fee is counted in is not witnessed. Refused by name. */
  const noOpenFee = (what) => {
    if (costOn && openFees() > 0) {
      throw new BrokerRefusal(`${what} is read while an open trade has paid its entry fee, and whether TradingView counts `
        + 'that fee in it before the trade closes is not witnessed', COMM_ROW[comm.type])
    }
  }
  const capital = () => {
    if (!finite(cfg.initialCapital)) throw new BrokerRefusal('the initial capital is not settled', 'Q-S1b')
    if (defaulted.initialCapital) rule('B-DEFAULTS')
    return cfg.initialCapital
  }
  /**
   * ⭐⭐ [B-ROUND-MARK] THE PRICE OPEN TRADES ARE MARKED AT (`strategy.openprofit`, and so `strategy.equity`): the
   * bar's close, and when that close is off the tick grid, the close rounded to the nearest tick, a tie up.
   * WITNESSED on `w9-r1-risk-intraday-range-spy-15-2026-11-15` (AMEX:SPY 15m): on all 47 bars where a position is
   * open and the close is off the grid (24 ties, 10 above a half tick, 13 below), TradingView's plotted
   * `strategy.openprofit` is (rounded close - `position_avg_price`) x `position_size`, and on none is it the raw
   * close's (`strategyReadbackWitness.test.js` re-derives it from the capture alone). No RDDT 1D capture holds a
   * bar with a position and an off-grid close, so on those this asks nothing. A flat run asks nothing either.
   */
  const markPx = (bar) => {
    const c = C[bar]
    if (!open.length || !finite(c) || onTick(c)) return c
    rule('B-ROUND-MARK')
    return roundToTick(c)
  }
  /** [B-VAL] `strategy.equity` at bar `bar`'s close: initial capital + net profit + open profit. */
  const equityAt = (bar, what) => {
    // ⭐ W9-T13a N7 — equity is net of commission: every reader of it (a percent-of-equity size included,
    // not only the `strategy.equity` value) rests on the commission's rules (`commissionRulesOf`)
    askCommission()
    exactOpen(what); exactClosed(what); needSymbol()
    const mark = markPx(bar)
    if (costOn) return capital() + moneyOfClosed() + sum(open, (t) => (mark - t.price) * t.dir * t.qty) * pointvalue - openFees()
    return capital() + (netPts() + sum(open, (t) => (mark - t.price) * t.dir * t.qty)) * pointvalue
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
   *     often 1."). Any other minimum contract (a fraction, or a lot of more than one unit), or one the
   *     run was not told, refuses. The member door states it only for an exchange with a witnessed
   *     `symbolScope.json::min_contract` row (W9-T4-F1), so elsewhere this refuses even once B-QTY is pinned.
   * Every case the hypothesis does not reach refuses by name (Q-S1a): a price (limit / stop) order,
   * whose sizing price could be its level or the signal close; a percent order placed while trades are
   * open ("available" equity may exclude what they hold) EXCEPT the reversal at the v6 default ([B-QTY-REVERSE])
   * and a same-side order the pyramiding limit rejects (sized only if it fills); a percent value above 100; a size
   * below one whole unit.
   */
  /** the declared-or-defaulted `default_qty_type` ('fixed' / 'cash' / 'percent_of_equity', or null): ONE reading,
   *  shared by `defaultSize` and [B-FUNDS] */
  const defaultQtyType = () => (cfg.qtyType === undefined ? (finite(cfg.defaultQty) ? 'fixed' : null) : cfg.qtyType)
  /** `dir` / `kind`: the order's (W9-T4 r2026-11-17, the reversal); `out` (optional): receives `sizeEquity` (the
   *  equity a reversal was sized from, [B-FUNDS-REVERSE]) or `lazy` (a same-side size taken only at a fill). */
  const defaultSize = (type, id, bar, dir, kind, out) => {
    const qtyType = defaultQtyType()
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
    // ⭐ W9-T5 — whether a cash / percent size leaves room for the fee, or sizes at the slipped price, is not
    // stated, and the W9-K rows size by a fixed quantity: refused by name
    if (costOn || slipTicks) {
      throw new BrokerRefusal(`the entry \`${id}\` takes a ${unit} default size under ${costOn ? `a commission (${comm.type})`
        : `a slippage of ${slipTicks} ticks`}, and whether the size allows for it is not stated`, costOn ? COMM_ROW[comm.type] : 'W9-K4')
    }
    // ⭐⭐ W9-T4 x W9-T6 (review merge note) — an extra execution ([B-FILLS]) runs at its fill tick's price
    // (`tickPx`), and this size is taken at the bar's close: one order would read two prices. Which one
    // TradingView sizes it at is not stated, so it stops by name. (A FIXED default reads no price.)
    if (tickPx !== null) {
      throw new BrokerRefusal(`the entry \`${id}\` takes a ${unit} default size in an extra execution at ${tickPx} `
        + "(`calc_on_order_fills`), and whether that tick or the bar's close sizes it is not stated", 'Q-S1a')
    }
    // ⛔ (2026-11-19, the strategy unit) a percent-of-equity STOP entry stays refused here although w9-q-s1a-size-stop-v6
    // witnesses its sizing (floor(equity / its level) on all 14 fills; the signal close refuted on all 14; bar 274's gap
    // rejected for funds): sized that way, the run reproduces every fill and size and still DIVERGEs, TradingView listing
    // trade 4 (1,636 x (170.09 - 60.68) = 178,994.76) at 178,994.77, a cent no reading of ours explains. Served only once
    // a capture accounts for that cent (capture-queue-2026-11-19-strategy-unit.md, Q-SU-STOP).
    if (type !== 'market') {
      throw new BrokerRefusal(`the ${type} entry \`${id}\` takes a ${unit} default size, and whether its level or `
        + 'the signal bar\'s close sizes it is not stated', 'Q-S1a')
    }
    if (minContract !== 1) {
      throw new BrokerRefusal(`the entry \`${id}\` takes a ${unit} default size, which this broker rounds down to `
        + `whole units, and this symbol's minimum contract is ${finite(minContract)
          ? `${minContract}, not 1 (${minContract < 1
            ? 'a fractional symbol, such as a cryptocurrency, trades in parts of a unit'
            : `this symbol trades in lots of ${minContract} units, and how this broker sizes lots is not stated`})`
          : 'not known to this run (`syminfo.mincontract` is stated only for a listing whose exchange has a '
            + 'witnessed minimum contract; a fractional symbol, such as a cryptocurrency, trades in parts of a unit)'}`,
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
        const unstated = `the entry \`${id}\` takes a percent-of-equity default size while trades are open, `
          + 'and whether "available equity" excludes what they hold is not stated'
        const sameSide = open.every((t) => t.dir === dir)
        // ⭐⭐ Q-S1a [B-QTY-REVERSE] (2026-11-17) — a REVERSAL: a market `strategy.entry` against every open trade, at
        // the v6 default (percent 100, margins 100), no risk command. Witnessed by w9-q-s1b-defaults-v6 (NYSE:RDDT 1D,
        // report ok): each of its 12 reversals fills the open size PLUS floor(strategy.equity at the signal close,
        // the open trade's profit INCLUDED, / that close) (bar 84: 2,160 closed + floor(148,945.60 / 68.13) = 2,186
        // new = TradingView's fill of 4,346). The equity it was sized from rides on the order ([B-FUNDS-REVERSE]).
        if (!sameSide && open.every((t) => t.dir !== dir) && kind === 'entry' && type === 'market' && v === 100
          && cfg.marginLong === 100 && cfg.marginShort === 100 && allow === null) {
          rule('B-QTY-REVERSE')
          const eq = equityAt(bar, '`strategy.entry` sized as a percent of equity')
          if (out) out.sizeEquity = eq
          money = eq * v / 100
        } else if (!sameSide && open.every((t) => t.dir !== dir) && kind === 'entry' && type === 'market' && v === 100
          && cfg.marginLong === 0 && cfg.marginShort === 0 && allow === null && out) {
          // ⭐⭐ Q-S1a [B-QTY-REVERSE-M0] (2026-11-19, the strategy unit) — the same reversal at MARGINS 0 (the v5 default).
          // Witnessed by macd-shortlong-strategy-is-rddt-1d-2026-11-18 (community, corpus/committed, MPL-2.0; v5, percent
          // of equity 100, capital 1,000, margins read back 0, report ok): each of its 9 reversals fills the open size
          // plus floor(strategy.equity at the signal close, the open trade's profit included, / that close) (bar 88:
          // 19 + floor(1,211.28 / 62.36) = 38), and NONE is rejected for funds: bar 385's new 27 x 212.02 = 5,724.54 is
          // past the 5,497.18 it was sized from, and TradingView fills it. So no [B-FUNDS-REVERSE] check at margin 0.
          rule('B-QTY-REVERSE-M0')
          const eq = equityAt(bar, '`strategy.entry` sized as a percent of equity')
          out.reverseEquity = eq
          money = eq
        } else if (sameSide && kind === 'entry' && type === 'market' && out) {
          // ⭐ (2026-11-17) the SAME side: the size is taken only if the order fills. At the pyramiding limit it does
          // not ([B-PYR]: rejected at its fill without a size), which is what w9-q-s1b-defaults-v6 witnesses for its
          // `L2` (placed every fourth bar while long, never filled). An order of this kind that WOULD fill stops there
          // by name, with this sentence (`fillEntry`): which equity sizes it is still not stated (Q-S1a).
          out.lazy = unstated
          return NaN
        } else throw new BrokerRefusal(unstated, 'Q-S1a')
      } else money = equityAt(bar, '`strategy.entry` sized as a percent of equity') * v / 100
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
    if (costOn) {
      // W9-T5: the sign of the NET profit; off the grid, served only further than one tick-quantity from 0
      needSymbol()
      const net = netOf(t)
      if (!t.exact && Math.abs(net) <= t.qty * mintick * pointvalue) {
        throw new BrokerRefusal(`${what} reads a trade whose sign depends on an off-grid fill`, 'Q-S1l')
      }
      return Math.sign(net)
    }
    if (!t.exact) {
      needSymbol()
      if (Math.abs(t.profit) <= t.qty * mintick) {
        throw new BrokerRefusal(`${what} reads a trade whose sign depends on an off-grid fill`, 'Q-S1l')
      }
    }
    return Math.sign(t.profit)
  }
  /** ⭐ W9-T7-F1 — an order's id as a trade reads it. `asExit`: the id of the order that CLOSED the trade, which R6
   *  states only for an exit command ("corresponds to an exit ID in the strategy's trades") and strategy.order
   *  ("an entry or exit ID"); every other closing order's id TradingView generates (`exitIdOf`). */
  const idOfRow = (r, fn, asExit) => {
    if (!r) throw new BrokerRefusal(`\`${fn}\` reads a trade with no order in this broker's log`)
    const id = asExit ? exitIdOf(r) : r.id
    if (typeof id === 'string') return id
    // ⭐⭐ value read-backs — an exit id no text states, WITNESSED by the std set's labels on the committed
    // captures (`strategyRecord.js::witnessedExitIdOf`): served behind the rule of its own witness, asked here
    const w = asExit ? witnessedExitIdOf(r) : null
    if (!w) {
      if (asExit && r.kind === 'entry') {
        throw new BrokerRefusal(`\`${fn}\` reads a trade closed by a reversing entry that carries a comment, and the exit id `
          + 'TradingView gives it is witnessed only for an entry placed without one', EXIT_LABEL_ROW)
      }
      throw new BrokerRefusal(`\`${fn}\` reads a trade closed by \`strategy.${r.kind}\`, `
        + 'whose exit id TradingView generates itself, and that text is not stated', 'W9-V1')
    }
    rule(w.rule)
    return w.text
  }
  /** ⭐ W9-T7-F1 — an order's comment as a trade reads it. No comment: R6 says the function returns `na` only "if
   *  there is no entry with this `trade_num`", so whether an order without a comment reads `na` or "" is not stated. */
  const commentOfRow = (r, fn) => {
    if (!r) throw new BrokerRefusal(`\`${fn}\` reads a trade with no order in this broker's log`)
    if (!r.commentRecorded) {
      throw new BrokerRefusal(`\`${fn}\` reads a comment the script computes, and this broker keeps only a comment written `
        + 'as a text literal')
    }
    if (r.comment === null) {
      throw new BrokerRefusal(`\`${fn}\` reads an order placed without a comment, and whether that reads na or an empty `
        + 'text is not stated', 'W9-V1')
    }
    return r.comment
  }
  /** The `time` of bar `bar` as Pine reads it (UNIX milliseconds; the run's bar times are each bar's opening
   *  instant in epoch seconds, which the product door derives from the ONE gate `time` reads,
   *  `runtimeColumns.js::brokerBarTimes` over `indicators.js::barOpenInstants`, so a daily chart's ISO date keys
   *  reach the broker as the instants `time` reads, never as dates). A run that was handed no bar times, or a time
   *  that is not a number, refuses by name: a trade's time is never a bar index or a date in disguise. */
  const barTimeMs = (bar, fn) => {
    const t = timeOf(bar)
    if (!finite(t)) throw new BrokerRefusal(`\`${fn}\` reads the time of a bar this run was given no time for`)
    return t * 1000
  }
  const value = (fn, a, bar) => {
    rule('B-VAL')
    if (immediateBar === bar) {
      throw new BrokerRefusal(`\`${fn}\` is read on the bar an \`immediately = true\` close filled, after that close, `
        + 'and whether the value already reflects the fill is not stated', 'W9-X4')
    }
    // [B-DEFAULTS] every figure net of commission rests on the commission's rules (`brokerRules.js`)
    if (COMMISSION_NET_VALUES.includes(fn)) askCommission()
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
      case 'strategy.netprofit':
        exactClosed('`strategy.netprofit`'); needSymbol(); return costOn ? moneyOfClosed() - openFees() : netPts() * pointvalue
      case 'strategy.netprofit_percent':
        exactClosed('`strategy.netprofit_percent`'); needSymbol()
        return (costOn ? moneyOfClosed() - openFees() : netPts() * pointvalue) / capital() * 100
      // W9-T5 HYPOTHESIS (W9-K1..K3): with a commission a trade is winning or losing by its NET profit (the
      // profit R6 defines), and the gross figures sum net profits
      case 'strategy.grossprofit':
        exactClosed('`strategy.grossprofit`'); needSymbol(); noOpenFee('`strategy.grossprofit`')
        if (costOn) return sum(closed, (t) => (netOf(t) > 0 ? netOf(t) : 0))
        return sum(closed, (t) => (t.profit > 0 ? t.profit : 0)) * pointvalue
      case 'strategy.grossloss':
        exactClosed('`strategy.grossloss`'); needSymbol(); noOpenFee('`strategy.grossloss`')
        if (costOn) return sum(closed, (t) => (netOf(t) < 0 ? -netOf(t) : 0))
        return sum(closed, (t) => (t.profit < 0 ? -t.profit : 0)) * pointvalue
      case 'strategy.openprofit': {
        exactOpen('`strategy.openprofit`'); needSymbol()
        // no fee in it: the entry fee an open trade paid is in `strategy.netprofit` (`openFees`, W9-K1..K3)
        const mark = markPx(bar)
        return sum(open, (t) => (mark - t.price) * t.dir * t.qty) * pointvalue
      }
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
      case 'strategy.opentrades.entry_time': return barTimeMs(tradeAt(open, a[0], fn).bar, fn)
      case 'strategy.closedtrades.entry_time': return barTimeMs(tradeAt(closed, a[0], fn).bar, fn)
      case 'strategy.closedtrades.exit_time': return barTimeMs(tradeAt(closed, a[0], fn).exitBar, fn)
      case 'strategy.closedtrades.profit': {
        const t = tradeAt(closed, a[0], fn)
        if (!t.exact) exactClosed(`\`${fn}\``)
        needSymbol()
        return costOn ? netOf(t) : t.profit * pointvalue
      }
      // ⭐ W9-T5 — the fees a trade paid: closed, its entry and exit fees; open, its entry fee (its exit fee is
      // not paid yet). With no commission, 0.
      case 'strategy.closedtrades.commission': {
        const t = tradeAt(closed, a[0], fn)
        if (costOn && comm.type === 'percent' && !t.exact) exactClosed(`\`${fn}\``)
        return t.commission
      }
      case 'strategy.opentrades.commission': {
        const t = tradeAt(open, a[0], fn)
        if (costOn && comm.type === 'percent' && !t.exact) exactOpen(`\`${fn}\``)
        return t.fee
      }
      // ⭐⭐ W9-T7-F1 — a trade's order ids and comments, off the ORDER LOG (the rows the trade carries)
      case 'strategy.opentrades.entry_id': return idOfRow(rowOf(tradeAt(open, a[0], fn).oid), fn)
      case 'strategy.closedtrades.entry_id': return idOfRow(rowOf(tradeAt(closed, a[0], fn).oid), fn)
      case 'strategy.opentrades.entry_comment': return commentOfRow(rowOf(tradeAt(open, a[0], fn).oid), fn)
      case 'strategy.closedtrades.entry_comment': return commentOfRow(rowOf(tradeAt(closed, a[0], fn).oid), fn)
      case 'strategy.closedtrades.exit_id': return idOfRow(rowOf(tradeAt(closed, a[0], fn).xid), fn, true)
      case 'strategy.closedtrades.exit_comment': {
        const r = rowOf(tradeAt(closed, a[0], fn).xid)
        if (!r) throw new BrokerRefusal(`\`${fn}\` reads a trade with no order in this broker's log`)
        // the exit of a trade an ENTRY closed (a reversal, an allow_entry_in close) is that entry's fill. With a
        // comment on the entry, whether that comment is the closed trade's exit comment is not stated (R6
        // `strategy.entry` `comment` speaks of "the filled order") and no capture witnesses it: refused by name.
        if (r.kind === 'entry' && (r.comment !== null || !r.commentRecorded)) {
          throw new BrokerRefusal(`\`${fn}\` reads a trade a reversing entry closed, and whether that entry's comment is the `
            + "closed trade's exit comment is not stated", EXIT_LABEL_ROW)
        }
        if (!r.commentRecorded || r.comment !== null) return commentOfRow(r, fn)
        // ⭐⭐ [B-TXT-NO-COMMENT] a closing order placed WITHOUT a comment: the exit comment reads the trade's exit
        // id, whatever names it. WITNESSED by every std-set label (`entry_id > exit_id : exit_comment`): `L>X:X`
        // (an exit command), `O1>O2:O2` (strategy.order), `L>Close entry(s) order L:Close entry(s) order L`,
        // `L>Close position order:Close position order`, `L1>S:S` (a reversal). The id itself asks its own rule.
        rule('B-TXT-NO-COMMENT')
        return idOfRow(r, fn, true)
      }
      default: throw new BrokerRefusal(`\`${fn}\` is not a value this broker serves`)
    }
  }

  /** One broker op on bar `bar`: `args` positional, `undefined` where not passed. */
  const call = (fn, args, bar) => {
    nowBar = bar
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
    // W9-T5: the fees the trade paid in the account currency (closed: entry + exit; open: entry so far)
    commission: t.exitBar === undefined ? t.fee : t.commission,
    entry: { time: timeOf(t.bar), price: t.price, rule: t.entryRule },
    ...(t.exitBar === undefined ? {} : { exit: { time: timeOf(t.exitBar), price: t.exitPrice, rule: t.exitRule } }),
  })
  const summary = () => ({
    // ruling D11: the bar each rule was first asked on (-1: before the first bar). NOT part of the record.
    ruleFirstBars: Object.fromEntries(okRules),
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
      rulesUsed: Array.from(okRules.keys()).sort(),
      // ⭐⭐ W9-T7-F1 — the order log (`log`), each row's `opened` / `closed` DERIVED from the trades' own `oid` /
      // `xid` as indexes into `trades` above (closed first, then open: that list's order)
      orders: orderRows(),
    },
  })
  const orderRows = () => {
    const trades = [...closed, ...open]
    const opened = new Map()
    const closedBy = new Map()
    const add = (m, k, i) => { if (!m.has(k)) m.set(k, []); m.get(k).push(i) }
    trades.forEach((t, i) => {
      add(opened, t.oid, i)
      if (i < closed.length) add(closedBy, t.xid, i)
    })
    // one key order for every kind (the record is sealed by the bytes of its JSON text, T14); never NaN (JSON has none)
    const num = (v) => (finite(v) ? v : null)
    return log.map((r) => ({
      n: r.n, kind: r.kind, id: r.id, from: r.from, side: r.side, type: r.type,
      qty: num(r.qty), qtyPercent: num(r.qtyPercent), limit: num(r.limit), stop: num(r.stop),
      legs: r.legs ? { ...r.legs, trailing: r.legs.trailing ? { ...r.legs.trailing } : null } : null,
      oca: r.oca ? { ...r.oca } : null,
      comment: r.comment, commentRecorded: r.commentRecorded,
      legComments: r.legComments ? Object.fromEntries(Object.entries(r.legComments).map(([k, v]) => [k, { ...v }])) : null,
      placedTime: r.placedTime, modifiedTime: r.modifiedTime, triggerTime: r.triggerTime,
      status: r.status, why: r.why, endTime: r.endTime,
      fillTime: r.fillTime, fillPrice: num(r.fillPrice), fillQty: num(r.fillQty), rule: r.rule, leg: r.leg,
      opened: opened.get(r.n) || [],
      closed: closedBy.get(r.n) || [],
    }))
  }

  // ⭐⭐ W9-T8 [B-RISK-DDOWN] the whole run rests on staying below the limit: asked once, before the first bar (as
  // B-TICK-HIST is). The peak starts at the initial capital (the equity before any trade).
  if (maxDd !== null) {
    rule(RISK_RULES.maxDrawdown)
    riskDefaultOnly('`strategy.risk.max_drawdown`')
    ddPeak = capital()
  }
  // ⭐⭐ [B-EXEC] a default strategy executes once per CLOSED bar: a run handed a forming newest bar
  // (`data.formingBar`, the vm's) leaves it out. Asked once, before the first bar runs, after every bind
  // check above (the order the vm asked it in), and DATED on that bar: ruling D11 names it the culprit of a
  // difference on the forming bar, never of one before it, where it played no part.
  if (Number.isInteger(data.formingBar) && data.formingBar >= 0) {
    const was = nowBar
    nowBar = data.formingBar
    rule('B-EXEC')
    nowBar = was
  }
  // ⭐⭐ [B-START-DEEP] (2026-11-19, the strategy-only daily window, coordinator ruling D9) a run from the listing over
  // MORE bars than the depth served without it (`data.deepFrom`, the vm's: the chart's shared window): where
  // TradingView's backtest starts on such a chart is a question only a capture answers (rows Q-SU-7 / Q-SU-8, where
  // the chart holds the whole history). Asked once, before the first bar, after every bind check; dated on the first
  // bar past that depth, the first one only a deep start runs (ruling D11).
  if (Number.isInteger(data.deepFrom) && data.deepFrom >= 0) {
    const was = nowBar
    nowBar = data.deepFrom
    rule('B-START-DEEP')
    nowBar = was
  }

  return { beginBar, endBar, call, summary }
}
