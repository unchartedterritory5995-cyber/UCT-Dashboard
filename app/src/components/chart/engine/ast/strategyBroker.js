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

import { BROKER_OPS } from '../runtime/broker.js'

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
 *  Language Reference (`strategy()` arguments). `null` = the reference states no
 *  value (v4's `default_qty_value`) or a sizing rule the broker does not serve. */
export const DECLARATION_DEFAULTS = Object.freeze({
  4: Object.freeze({ qtyType: 'fixed', qtyValue: null, initialCapital: 100000, margin: 100 }),
  5: Object.freeze({ qtyType: 'fixed', qtyValue: 1, initialCapital: 1000000, margin: 0 }),
  6: Object.freeze({ qtyType: 'percent_of_equity', qtyValue: 100, initialCapital: 100000, margin: 100 }),
})

/** The `strategy()` parameters that cannot change a broker value, read past. */
const PRESENTATION = new Set(['title', 'shorttitle', 'overlay', 'format', 'precision', 'scale', 'max_bars_back',
  'max_lines_count', 'max_labels_count', 'max_boxes_count', 'max_polylines_count', 'explicit_plot_zorder',
  'dynamic_requests', 'behind_chart', 'risk_free_rate', 'linktoseries',
  // [B-COMMISSION] the TYPE only matters with a non-zero `commission_value`, refused below
  'commission_type',
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
 * @returns {{pyramiding:number, defaultQty:(number|null), initialCapital:(number|null),
 *   marginLong:(number|null), marginShort:(number|null), calcOnEveryTick:boolean, version:number}}
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
      // ── served only at their documented defaults ──
      case 'calc_on_order_fills': need(key, n === 0, '= true (an extra execution after every fill) is not served'); break
      case 'process_orders_on_close': need(key, n === 0, '= true (fills on the bar close) is not served'); break
      case 'use_bar_magnifier': need(key, n === 0, '= true (lower-timeframe fills) is not served'); break
      case 'backtest_fill_limits_assumption': need(key, n === 0, 'other than 0 is not served'); break
      case 'slippage': need(key, n === 0, 'other than 0 is not served'); break
      case 'commission_value': need(key, n === 0, 'other than 0 is not served'); break
      case 'calc_bars_count': need(key, n === 0, 'other than 0 is not served'); break
      case 'close_entries_rule': need(key, literalText(node) === 'FIFO', 'other than "FIFO" is not served'); break
      case 'currency': need(key, nameOf(node) === 'currency.NONE', '(an account currency other than the symbol\'s) is not served'); break
      default: throw new StrategyOptionError(`the strategy() property \`${key}\` is not one this broker reads`, node && node.tok)
    }
  }
  // [B-QTY] only a FIXED default size is served (the cash / percent-of-equity sizing
  // rules - which price, what rounding - are not stated); an unstated value is unsettled
  cfg.defaultQty = qtyType === 'fixed' && Number.isFinite(qtyValue) ? qtyValue : null
  return cfg
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
/** Arguments served only at their documented default, and that default. */
const AT_DEFAULT = Object.freeze({
  qty: (n) => n.type === 'name' && n.name === 'na',
  oca_name: (n) => n.type === 'string' && n.value === '',
  oca_type: (n) => n.type === 'name' && n.name === 'strategy.oca.none',
  qty_percent: (n) => numOf(n) === 100,
  immediately: (n) => numOf(n) === 0,
  trail_price: (n) => n.type === 'name' && n.name === 'na',
  trail_points: (n) => n.type === 'name' && n.name === 'na',
  trail_offset: (n) => n.type === 'name' && n.name === 'na',
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
      throw new StrategyOptionError(`\`${fn}\`'s \`${key}\` is not served (only its default is)`, node && node.tok)
    }
  }
  return spec.params.map((p) => {
    const node = got.get(p === 'direction' && got.has('long') ? 'long' : p)
    return node === undefined ? null : node
  })
}
