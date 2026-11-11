// app/src/components/chart/engine/ast/strategyBroker.js
//
// ─── ⭐⭐ S1 — THE FRONT END'S HALF OF THE STRATEGY BROKER ──────────────────────
//
// What the runtime lane needs to READ before `runtime/broker.js` can run: the
// `strategy(...)` declaration (which broker properties apply, by Pine version),
// and each order command's arguments (named or positional, by Pine version)
// placed onto the broker's parameter list (`BROKER_OPS`).
//
// ⛔ ONLY WHAT `docs/pine/strategy-broker-spec.md` SETTLES IS ACCEPTED. A
// declaration property or an order argument whose effect on the broker is not
// settled (or not served) refuses BY NAME at build, `runtime:strategy-option`,
// naming the property. Properties that cannot change any broker value (a title,
// a precision, a comment, an alert message) are read past.

import { BROKER_OPS, ORDER_COMMENT_PARAMS } from '../runtime/broker.js'

export const STRATEGY_OPTION_GUARD = 'runtime:strategy-option'

/** A build refusal: `{ guard, detail }`, thrown and turned into the lane's
 *  `RuntimeRefusal` by the caller (which owns that class and the location). */
export class StrategyOptionError extends Error {
  constructor(detail, tok) {
    super(detail)
    this.name = 'StrategyOptionError'
    this.guard = STRATEGY_OPTION_GUARD
    this.detail = detail
    this.tok = tok || null
  }
}

/** [B-DEFAULTS] the documented defaults, per Pine version, from that version's
 *  Language Reference (`strategy()` arguments).
 *
 *  ⭐⭐ W9-T4 — v4's `default_qty_value`: the v4 reference states NO value ("fixed quantity by
 *  default"). The broker takes 1 (one contract/share/lot) as a HYPOTHESIS, not a reading. It is
 *  served only once B-QTY (Q-S1a, `w9-q-s1a-size-v4.pine`) AND B-DEFAULTS (Q-S1b,
 *  `w9-q-s1b-defaults-v4.pine`) are pinned by MATCHing captures, so a wrong guess can only ever
 *  surface as a capture MISMATCH, never as a served value (ruling D1: pin before serve).
 *  v6's percent_of_equity 100 is the v6 reference's own text (`default_qty_type`: "The default is
 *  strategy.percent_of_equity"; `default_qty_value`: "The default is 100"); how a percent or cash
 *  default is turned into a size is `broker.js` `defaultSize` [B-QTY]. */
export const DECLARATION_DEFAULTS = Object.freeze({
  4: Object.freeze({ qtyType: 'fixed', qtyValue: 1, initialCapital: 100000, margin: 100 }),
  5: Object.freeze({ qtyType: 'fixed', qtyValue: 1, initialCapital: 1000000, margin: 0 }),
  6: Object.freeze({ qtyType: 'percent_of_equity', qtyValue: 100, initialCapital: 100000, margin: 100 }),
})

/** The `strategy()` parameters that cannot change a broker value, read past. */
const PRESENTATION = new Set(['title', 'shorttitle', 'overlay', 'format', 'precision', 'scale', 'max_bars_back',
  'max_lines_count', 'max_labels_count', 'max_boxes_count', 'max_polylines_count', 'explicit_plot_zorder',
  'dynamic_requests', 'behind_chart', 'risk_free_rate', 'linktoseries',
  // only changes fills on a Heikin Ashi chart; the member chart is standard OHLC
  'fill_orders_on_standard_ohlc'])
/** v6's positional order (the reference `syntax` line); v4/v5 differ past `overlay`,
 *  so only the first three positions are read and a later positional refuses. */
const POSITIONAL = ['title', 'shorttitle', 'overlay']

const numOf = (node) => {
  if (!node) return NaN
  if (node.type === 'number') return Number(node.value)
  if (node.type === 'unary' && node.op === '-' && node.arg && node.arg.type === 'number') return -Number(node.arg.value)
  return NaN
}
const literalText = (node) => (node && node.type === 'string' ? String(node.value) : null)
const nameOf = (node) => (node && node.type === 'name' ? node.name : null)

/**
 * Read a `strategy(...)` declaration (its parse node) into the broker's config.
 * @param {object} call  the parse node of `strategy(...)`
 * @param {number} version the script's `//@version`
 * @returns {{pyramiding:number, defaultQty:(number|null), qtyType:(string|null), qtyValue:(number|null),
 *   initialCapital:(number|null),
 *   marginLong:(number|null), marginShort:(number|null), calcOnEveryTick:boolean, version:number,
 *   processOrdersOnClose:boolean, calcOnOrderFills:boolean,
 *   commission:{type:(string|null), value:number, typeDefaulted:boolean}, slippage:number}}  (W9-T5 costs)
 */
export function readStrategyDeclaration(call, version) {
  const v = Number(version)
  const d = DECLARATION_DEFAULTS[v] || null
  const named = new Map()
  ;(call.args || []).forEach((a, i) => {
    const key = a.name || POSITIONAL[i]
    if (!key) throw new StrategyOptionError(`the strategy() declaration's argument ${i + 1}, by position`, a.value && a.value.tok)
    named.set(key, a.value)
  })
  const cfg = {
    pyramiding: 0, defaultQty: null, initialCapital: d ? d.initialCapital : null,
    marginLong: d ? d.margin : null, marginShort: d ? d.margin : null, calcOnEveryTick: false, version: v,
    // W9-T6: fill timing at its documented defaults (R6 `strategy()`: false, false)
    processOrdersOnClose: false, calcOnOrderFills: false,
    // ⭐⭐ W9-T5: costs at their documented defaults. R6 `strategy()` `commission_type`: "The default is
    // strategy.commission.percent"; `commission_value`: "The default is 0"; `slippage`: "The default is 0".
    commission: { type: 'percent', value: 0 }, slippage: 0,
  }
  let qtyType = d ? d.qtyType : null
  let qtyValue = d ? d.qtyValue : null
  const need = (key, ok, why) => {
    if (!ok) throw new StrategyOptionError(`\`${key}\` ${why}`, named.get(key) && named.get(key).tok)
  }
  for (const [key, node] of named) {
    if (PRESENTATION.has(key)) continue
    const n = numOf(node)
    switch (key) {
      case 'pyramiding': need(key, Number.isInteger(n) && n >= 0, 'is not a whole-number literal'); cfg.pyramiding = n; break
      case 'default_qty_type': {
        const nm = nameOf(node)
        need(key, nm === 'strategy.fixed' || nm === 'strategy.cash' || nm === 'strategy.percent_of_equity',
          'is not one of strategy.fixed / strategy.cash / strategy.percent_of_equity')
        qtyType = nm.slice('strategy.'.length)
        break
      }
      case 'default_qty_value': need(key, Number.isFinite(n) && n > 0, 'is not a positive literal'); qtyValue = n; break
      case 'initial_capital': need(key, Number.isFinite(n) && n > 0, 'is not a positive literal'); cfg.initialCapital = n; break
      case 'margin_long': need(key, Number.isFinite(n) && n >= 0, 'is not a non-negative literal'); cfg.marginLong = n; break
      case 'margin_short': need(key, Number.isFinite(n) && n >= 0, 'is not a non-negative literal'); cfg.marginShort = n; break
      case 'calc_on_every_tick': need(key, n === 0 || n === 1, 'is not a true / false literal'); cfg.calcOnEveryTick = n === 1; break
      // ⭐⭐ W9-T6 — fill timing is READ, and the broker asks its rule (B-POC*, B-FILLS)
      // when a run reaches it: unpinned, the run stops `runtime:strategy-unpinned` by name.
      case 'calc_on_order_fills': need(key, n === 0 || n === 1, 'is not a true / false literal'); cfg.calcOnOrderFills = n === 1; break
      case 'process_orders_on_close': need(key, n === 0 || n === 1, 'is not a true / false literal'); cfg.processOrdersOnClose = n === 1; break
      // ── served only at their documented defaults ──
      // [T6] the July-2026 "On history bar tick" menu: deferred (W9 design 4, Deferred)
      case 'calc_on_every_history_tick': need(key, n === 0, '= true (an execution on every historical tick) is not served'); break
      case 'use_bar_magnifier': need(key, n === 0, '= true (lower-timeframe fills) is not served'); break
      // [W9-T6 r1 ruling] R6 states neither the fill price nor the boundary of "exceeds the limit by N ticks",
      // and no capture is queued for it, so it is not built as a rule: refused by name, with the reason
      case 'backtest_fill_limits_assumption': need(key, n === 0, 'other than 0 is not served (a limit that fills only '
        + 'once the price passes its level by that many ticks: no TradingView capture is queued for it)'); break
      // ⭐⭐ W9-T5 — costs are READ, and the broker asks each one's rule when a run REACHES a fill that pays
      // it (B-COMM-PCT / -CONTRACT / -ORDER, B-SLIPPAGE, B-POC-COST): unpinned, the run stops by name.
      // R6 `slippage`: "Slippage expressed in ticks" (a `const int`); R6 `commission_value`: a `const int/float`.
      case 'slippage': need(key, Number.isInteger(n) && n >= 0, 'is not a non-negative whole-number literal (ticks)'); cfg.slippage = n; break
      case 'commission_value': need(key, Number.isFinite(n) && n >= 0, 'is not a non-negative literal'); cfg.commission.value = n; break
      case 'commission_type': {
        // read past, as before W9-T5, unless a non-zero `commission_value` makes the type matter (checked below)
        const nm = nameOf(node)
        cfg.commission.type = nm === 'strategy.commission.percent' || nm === 'strategy.commission.cash_per_contract'
          || nm === 'strategy.commission.cash_per_order' ? nm.slice('strategy.commission.'.length) : null
        break
      }
      case 'calc_bars_count': need(key, n === 0, 'other than 0 is not served'); break
      case 'close_entries_rule': need(key, literalText(node) === 'FIFO', 'other than "FIFO" is not served'); break
      // W9-T4: an identity currency needs a broker rule the ledger can pin (capture row W9-D2), and
      // `brokerRules.js` names none yet, so any account currency but NONE still refuses here.
      case 'currency': need(key, nameOf(node) === 'currency.NONE', '(an account currency other than the symbol\'s; '
        + 'capture row W9-D2) is not served'); break
      default: throw new StrategyOptionError(`the strategy() property \`${key}\` is not one this broker reads`, node && node.tok)
    }
  }
  // [B-QTY] the default size as declared or defaulted. `defaultQty` stays the FIXED size (null
  // otherwise). ⭐ W9-T4: a cash or percent-of-equity default is sized by the broker at the order's
  // signal bar (`broker.js` `defaultSize`), behind the B-QTY pin (Q-S1a).
  cfg.qtyType = qtyType
  cfg.qtyValue = Number.isFinite(qtyValue) ? qtyValue : null
  cfg.defaultQty = qtyType === 'fixed' && Number.isFinite(qtyValue) ? qtyValue : null
  // ⭐⭐ W9-T1 — which values are the VERSION'S DEFAULTS, not the script's own: the broker asks the
  // ledger for B-DEFAULTS (Q-S1b) only when it leans on one.
  cfg.defaulted = {
    pyramiding: !named.has('pyramiding'),
    initialCapital: !named.has('initial_capital'),
    margin: !named.has('margin_long') || !named.has('margin_short'),
    qty: !named.has('default_qty_type') || !named.has('default_qty_value'),
  }
  // W9-T5: a commission whose TYPE is the default rests on B-DEFAULTS too (`brokerRules.js` commissionRulesOf)
  cfg.commission.typeDefaulted = !named.has('commission_type')
  if (cfg.commission.value > 0 && cfg.commission.type === null) {
    throw new StrategyOptionError('`commission_type` is not one of strategy.commission.percent / cash_per_contract / '
      + 'cash_per_order', named.get('commission_type') && named.get('commission_type').tok)
  }
  return cfg
}

// ─── ⭐⭐ W9-T8: strategy.risk.* ─────────────────────────────────────────────
//
// A risk command is read like the declaration, not run like an order. The User Manual ("Risk management",
// the live page https://www.tradingview.com/pine-script-docs/concepts/strategies/#risk-management, read
// 2026-11-08): "All risk management commands execute on every tick and order execution event, regardless of any
// changes to the strategy's calculation behavior. There is no way to deactivate any of these commands on specific
// script executions. Irrespective of a risk management command's location, the command always applies to the
// strategy unless the programmer removes the call from the code." Its arguments are `simple` (R6 `allowedTypeIDs`),
// so the value is fixed for the run. ⛔ This reader serves only what a capture row's probe witnesses: a v6 call,
// at the top level of the script (the probes' shape), with literal arguments, once per command.
//
// Each command's rule is asked by `runtime/broker.js` when a run REACHES it (B-RISK-ALLOW, B-RISK-DDOWN,
// B-RISK-INTRADAY-ORDERS; `runtime/brokerRules.js`). The three commands below have no probe that calls them, so
// they refuse here, at build, by name (`runtime:strategy-option`): a pure hypothesis is not a rule.
/** R6 `syntax` lines, v6: the parameters of the risk commands this reader serves. */
const RISK_SIGNATURES = Object.freeze({
  'strategy.risk.allow_entry_in': ['value'],
  'strategy.risk.max_drawdown': ['value', 'type', 'alert_message'],
  'strategy.risk.max_intraday_filled_orders': ['count', 'alert_message'],
})
/** The risk commands no queued capture witnesses, and why (W9 design 5.2 names no probe that calls them). */
const RISK_UNWITNESSED = Object.freeze({
  'strategy.risk.max_intraday_loss': 'is not served: capture row W9-R1i\'s probe (`w9-r1-risk-intraday.pine`) calls '
    + 'only `strategy.risk.max_intraday_filled_orders`, so no queued TradingView capture witnesses an intraday loss limit',
  'strategy.risk.max_cons_loss_days': 'is not served: no TradingView capture row is queued for it (W9 design 5.2 '
    + 'names W9-R1 for allow_entry_in and max_drawdown only)',
  'strategy.risk.max_position_size': 'is not served: no TradingView capture row is queued for it (W9 design 5.2 '
    + 'names W9-R1 for allow_entry_in and max_drawdown only)',
})
/** R6 `strategy.direction.*` constants, as the broker reads them. */
const RISK_DIRECTIONS = Object.freeze({ 'strategy.direction.all': 'all', 'strategy.direction.long': 'long', 'strategy.direction.short': 'short' })

/**
 * ⭐⭐ W9-T8 — read one `strategy.risk.*(...)` call (its parse node) into the declaration's `risk` record:
 * `cfg.risk = { allow?: 'all'|'long'|'short', maxDrawdown?: { value, type: 'percent_of_equity'|'cash' },
 * intradayOrders?: count }`. Throws `StrategyOptionError` (refused at build, by name) for anything else.
 * @param {string} fn the command
 * @param {object} call its parse node
 * @param {number} version the script's `//@version`
 * @param {object|null} cfg the declaration `readStrategyDeclaration` returned (null: none read yet)
 */
export function readRiskCall(fn, call, version, cfg) {
  const tok = call && call.tok
  if (Object.prototype.hasOwnProperty.call(RISK_UNWITNESSED, fn)) throw new StrategyOptionError(`\`${fn}()\` ${RISK_UNWITNESSED[fn]}`, tok)
  const sig = RISK_SIGNATURES[fn]
  if (!sig) throw new StrategyOptionError(`\`${fn}()\` is not a risk command this broker reads`, tok)
  // only the v6 reference was read, and every W9-R1 / W9-R1i probe is v6
  if (Number(version) !== 6) throw new StrategyOptionError(`\`${fn}()\` in Pine version ${version} (only the v6 reference was read)`, tok)
  if (!cfg) throw new StrategyOptionError(`\`${fn}()\` before the strategy() declaration`, tok)
  const got = new Map()
  ;(call.args || []).forEach((a, i) => {
    const key = a.name || sig[i]
    if (!key || !sig.includes(key)) {
      throw new StrategyOptionError(`\`${fn}\` has no parameter ${a.name ? `\`${a.name}\`` : `at position ${i + 1}`}`, a.value && a.value.tok)
    }
    got.set(key, a.value)
  })
  // `alert_message` labels an alert and changes no broker value; a literal only (an expression could carry an effect)
  if (got.has('alert_message') && got.get('alert_message').type !== 'string') {
    throw new StrategyOptionError(`\`${fn}\`'s \`alert_message\` is not a text literal`, got.get('alert_message').tok)
  }
  const need = (ok, why, node) => { if (!ok) throw new StrategyOptionError(`\`${fn}\` ${why}`, (node && node.tok) || tok) }
  const risk = cfg.risk || (cfg.risk = {})
  const once = (key) => need(risk[key] === undefined, 'is called more than once (which call wins is not stated)')
  if (fn === 'strategy.risk.allow_entry_in') {
    once('allow')
    const v = got.get('value')
    const dir = RISK_DIRECTIONS[nameOf(v)]
    need(!!dir, '`value` is not strategy.direction.all / long / short', v)
    risk.allow = dir
  } else if (fn === 'strategy.risk.max_drawdown') {
    once('maxDrawdown')
    const v = got.get('value')
    const t = got.get('type')
    const n = numOf(v)
    const type = nameOf(t) === 'strategy.percent_of_equity' ? 'percent_of_equity' : (nameOf(t) === 'strategy.cash' ? 'cash' : null)
    need(!!t && type !== null, '`type` is not strategy.percent_of_equity / strategy.cash (it is a required parameter)', t)
    // R6 `value`: "For % of equity the range of allowed values is from 0 to 100."
    need(Number.isFinite(n) && n > 0 && (type === 'cash' || n <= 100), type === 'cash' ? '`value` is not a positive literal'
      : '`value` is not a literal above 0 and at most 100', v)
    risk.maxDrawdown = { value: n, type }
  } else {
    once('intradayOrders')
    const v = got.get('count')
    const n = numOf(v)
    need(Number.isInteger(n) && n > 0, '`count` is not a positive whole-number literal', v)
    risk.intradayOrders = n
  }
  return risk
}

/** [B-SIG] each order command's parameter list, per Pine version (the reference
 *  `syntax` lines). v5 and v6 share one list per command. */
const SIGNATURES = Object.freeze({
  4: Object.freeze({
    'strategy.entry': ['id', 'long', 'qty', 'limit', 'stop', 'oca_name', 'oca_type', 'comment', 'when', 'alert_message'],
    'strategy.exit': ['id', 'from_entry', 'qty', 'qty_percent', 'profit', 'limit', 'loss', 'stop', 'trail_price',
      'trail_points', 'trail_offset', 'oca_name', 'comment', 'when', 'alert_message'],
    'strategy.close': ['id', 'when', 'comment', 'qty', 'qty_percent', 'alert_message'],
    'strategy.close_all': ['when', 'comment', 'alert_message'],
    'strategy.cancel': ['id', 'when'],
    'strategy.cancel_all': ['when'],
    // W9-T7: R4 `strategy.order` syntax
    'strategy.order': ['id', 'long', 'qty', 'limit', 'stop', 'oca_name', 'oca_type', 'comment', 'when', 'alert_message'],
  }),
  5: Object.freeze({
    'strategy.entry': ['id', 'direction', 'qty', 'limit', 'stop', 'oca_name', 'oca_type', 'comment', 'alert_message',
      'disable_alert'],
    'strategy.exit': ['id', 'from_entry', 'qty', 'qty_percent', 'profit', 'limit', 'loss', 'stop', 'trail_price',
      'trail_points', 'trail_offset', 'oca_name', 'comment', 'comment_profit', 'comment_loss', 'comment_trailing',
      'alert_message', 'alert_profit', 'alert_loss', 'alert_trailing', 'disable_alert'],
    'strategy.close': ['id', 'comment', 'qty', 'qty_percent', 'alert_message', 'immediately', 'disable_alert'],
    'strategy.close_all': ['comment', 'alert_message', 'immediately', 'disable_alert'],
    'strategy.cancel': ['id'],
    'strategy.cancel_all': [],
    // W9-T7: R6 `strategy.order` syntax (v5 the same)
    'strategy.order': ['id', 'direction', 'qty', 'limit', 'stop', 'oca_name', 'oca_type', 'comment', 'alert_message',
      'disable_alert'],
  }),
})
const signatureOf = (version, fn) => {
  const v = Number(version)
  const table = v === 4 ? SIGNATURES[4] : (v === 5 || v === 6 ? SIGNATURES[5] : null)
  return table ? table[fn] || null : null
}
/** Arguments that label an order and change no broker value. */
const LABELS = new Set(['comment', 'comment_profit', 'comment_loss', 'comment_trailing', 'alert_message',
  'alert_profit', 'alert_loss', 'alert_trailing', 'disable_alert'])
/** Arguments served only at their documented default, and that default.
 *  ⭐ W9-T7 — `qty`, `qty_percent`, `immediately`, `trail_*` and the entry / order `oca_*` are broker
 *  parameters now (`BROKER_OPS`), each behind its rule. What is left is `strategy.exit`'s `oca_name`:
 *  R6 "All orders from this command are of the strategy.oca.reduce OCA type" - a group spanning several
 *  exit commands - which no broker rule serves yet (capture row W9-X3). */
const AT_DEFAULT = Object.freeze({
  oca_name: (n) => n.type === 'string' && n.value === '',
})

/**
 * Place an order command's arguments onto the broker op's parameter list.
 * @returns {Array<object|null>} parse nodes in `BROKER_OPS[fn].params` order, null = not passed
 */
export function orderArgsOf(fn, call, version) {
  const spec = BROKER_OPS[fn]
  if (!spec || spec.returns !== 'void' || fn === '#symbol') {
    throw new StrategyOptionError(`\`${fn}\` is not an order command this broker serves`, call && call.tok)
  }
  const sig = signatureOf(version, fn)
  if (!sig) throw new StrategyOptionError(`\`${fn}\` in Pine version ${version}`, call && call.tok)
  const got = new Map()
  ;(call.args || []).forEach((a, i) => {
    const key = a.name || sig[i]
    if (!key) throw new StrategyOptionError(`\`${fn}\` argument ${i + 1}: more arguments than its parameters`, a.value && a.value.tok)
    // [B-WHEN] v5 still compiles the v4 `when`; v6 removed it
    if (a.name && !sig.includes(key) && !(key === 'when' && Number(version) === 5)) {
      throw new StrategyOptionError(`\`${fn}\` has no parameter \`${key}\` in Pine version ${version}`, a.value && a.value.tok)
    }
    got.set(key, a.value)
  })
  for (const [key, node] of got) {
    if (spec.params.includes(key === 'long' ? 'direction' : key) || LABELS.has(key)) continue
    const ok = AT_DEFAULT[key]
    if (!(ok && node && ok(node))) {
      throw new StrategyOptionError(`\`${fn}\`'s \`${key}\` is not served (only its default is)`
        + (key === 'oca_name' ? '; capture row W9-X3' : ''), node && node.tok)
    }
  }
  return spec.params.map((p) => {
    const node = got.get(p === 'direction' && got.has('long') ? 'long' : p)
    if (node === undefined) return null
    // ⭐⭐ W9-T7-F1 — a `comment*` label rides to the broker for its ORDER LOG only, and only as a LITERAL text:
    // a computed comment is NOT lowered (lowering it could refuse, or charge the run, for a value no fill reads,
    // and with the broker on these labels were never evaluated), so it arrives as `na` and the log marks it
    // unrecorded (`broker.js::labelOf`), never a guessed text. (`na` is the front end's own literal, `naValue`.)
    if (ORDER_COMMENT_PARAMS.includes(p) && node.type !== 'string') return { type: 'name', name: 'na', tok: node.tok }
    return node
  })
}
