// app/src/components/chart/engine/runtime/brokerReport.js
//
// ─── ⭐⭐ W9-T13a — THE STRATEGY REPORT'S METRICS, FROM THE RUN'S RECORD ───────────
//
// The one place the report's metrics are computed (W9 design rule 3). Pure: the run's
// `strategy` record (`strategyRecord.js`, design 3.2) in, a report out. No clock, no I/O,
// no fill: every price and size here is the broker's (`broker.js`), read off the record.
//
// ⛔⛔ HONESTY RULE. A metric is SERVED only when its definition is stated exactly by a source
// the repo holds: the B-VAL row of `docs/pine/strategy-broker-spec.md` (the Pine Language
// Reference's `strategy.*` variable texts, and the User Manual's profit factor). Each served
// metric is the B-VAL value it names (`pine`), computed with the broker's own arithmetic, so the
// report and the script's `strategy.netprofit` can never disagree (rail: `w9T13aBrokerReport`).
// Every other figure TradingView's Strategy Tester shows REFUSES BY NAME with a member sentence
// (ruling D8): its exact formula is not in any source we hold and no capture has witnessed it
// (rows W9-S1, W9-S2), or the record does not carry what it needs.
//
// ⛔⛔ PIN BEFORE SERVE (ruling D1). A metric rests on the rules the run's fills used
// (`record.rulesUsed`), on B-VAL (its definition) and, for a currency value, on the commission's
// rules (`brokerRules.js` commissionRulesOf over the record's `settings.commission`: a zero commission
// rests on B-DEFAULTS, the manual's default, which the record cannot tell from a declared 0; ⭐ W9-T5 a
// non-zero one on its type's rule, W9-K1..K3). A trade's SIGN rests on it too, since a commission can
// turn a break-even or small win into a loss. Each is asked of the
// committed ledger HERE, at report time (`pinned(rule)`); an unpinned one refuses the metric
// `runtime:strategy-unpinned`, naming the rule and its capture row. Tests pass `isPinned` (a
// predicate, like `broker.js`'s `data.isPinned`), never a second argument to `pinned`.
//
// ⛔ D10 IS NOT APPLIED HERE. The grading floor (5 closed trades) is a property of TradingView's
// capture, never of our broker's counts (design section 9 item 11): a run with fewer closed
// trades is reported in full, and no metric is graded or withheld by its trade count.
//
// ⛔ A TRADE LIST IS NEVER SHOWN WITH A TRADE MISSING (design rule 1): every trade of the record
// is a row, and a row whose profit cannot be served carries that profit's refusal.

import { pinned } from './brokerPins.js'
// ⛔ NOT from './broker.js': importing the broker here split it into its own shared chunk (engine-40 bytes)
import { ruleCapture, UNPINNED_GUARD, commissionRulesOf, BROKER_UNSETTLED_GUARD } from './brokerRules.js'
import { STRATEGY_RECORD_UNSERVED, strategyRecordShapeErrors, startDateOf, startSentenceOf, orderLabelOf, exitLabelUnstated, EXIT_LABEL_ROW } from './strategyRecord.js'

export const STRATEGY_REPORT_SCHEMA = 'uct.strategy-report/v1'
/** No source we hold states the metric's formula exactly, and no capture has witnessed it. */
export const REPORT_UNSTATED_GUARD = 'runtime:strategy-report-unstated'
/** The metric is defined, but the record does not carry an input it needs. */
export const REPORT_UNRECORDED_GUARD = 'runtime:strategy-report-unrecorded'
/** The metric is defined, but its definition does not cover this run (a zero denominator). */
export const REPORT_UNDEFINED_GUARD = 'runtime:strategy-report-undefined'
/** The input is not a v1 strategy record (`strategyRecordShapeErrors`). */
export const REPORT_RECORD_GUARD = 'runtime:strategy-report-record'

/** ruling D2: the sentence, from the ONE function the record uses (`strategyRecord.js`). */
export { startSentenceOf }

const B_VAL_SOURCE = 'docs/pine/strategy-broker-spec.md B-VAL (Pine Language Reference strategy.* variable texts)'
const COMMISSION_SOURCE = 'Pine Language Reference v6 `strategy.closedtrades.commission`: "the sum of entry and exit fees paid in the closed trade" (W9-T5)'
const PF_SOURCE = 'docs/pine/strategy-broker-spec.md B-VAL (Pine User Manual "Using strategy information in scripts": grossprofit / grossloss)'

/** ⭐ THE SERVED METRICS: key -> the B-VAL value it is, and what it needs.
 *  `kind`: `count` (trade counts), `sign` (counts by the sign of a closed trade's profit),
 *  `money` (a currency value: price x size x pointvalue), `percent` (of the initial capital),
 *  `ratio` (profit factor). */
export const SERVED_METRICS = Object.freeze({
  totalClosedTrades: Object.freeze({ label: 'Total closed trades', pine: 'strategy.closedtrades', kind: 'count', source: B_VAL_SOURCE }),
  totalOpenTrades: Object.freeze({ label: 'Total open trades', pine: 'strategy.opentrades', kind: 'count', source: B_VAL_SOURCE }),
  numberWinningTrades: Object.freeze({ label: 'Winning trades', pine: 'strategy.wintrades', kind: 'sign', source: B_VAL_SOURCE }),
  numberLosingTrades: Object.freeze({ label: 'Losing trades', pine: 'strategy.losstrades', kind: 'sign', source: B_VAL_SOURCE }),
  numberEvenTrades: Object.freeze({ label: 'Break-even trades', pine: 'strategy.eventrades', kind: 'sign', source: B_VAL_SOURCE }),
  netProfit: Object.freeze({ label: 'Net profit', pine: 'strategy.netprofit', kind: 'money', source: B_VAL_SOURCE }),
  netProfitPercent: Object.freeze({ label: 'Net profit %', pine: 'strategy.netprofit_percent', kind: 'percent', source: B_VAL_SOURCE }),
  grossProfit: Object.freeze({ label: 'Gross profit', pine: 'strategy.grossprofit', kind: 'money', source: B_VAL_SOURCE }),
  grossLoss: Object.freeze({ label: 'Gross loss', pine: 'strategy.grossloss', kind: 'money', source: B_VAL_SOURCE }),
  profitFactor: Object.freeze({ label: 'Profit factor', pine: null, kind: 'ratio', source: PF_SOURCE }),
  // ⭐ W9-T5: the fees the closed trades paid (the sum of `strategy.closedtrades.commission`). HYPOTHESIS (the
  // Tester's own figure is read only after W9-C0, row W9-S1): served only when no OPEN trade has paid a fee,
  // since whether the Tester counts an open trade's entry fee is not stated
  commissionPaid: Object.freeze({ label: 'Commission paid', pine: null, kind: 'commission', source: COMMISSION_SOURCE }),
})

// W9-T13b: `label` is the metric's name as the panel prints it, the SAME string its sentence opens
// with (one authority for both: the panel never types a metric name of its own).
const unstated = (label, row) => Object.freeze({
  guard: REPORT_UNSTATED_GUARD, row, label,
  sentence: `${label} is not shown: we do not yet know exactly how TradingView's Strategy Tester computes it, `
    + 'and it has not yet been checked against TradingView.',
})
const unrecorded = (label, why, owner) => Object.freeze({
  guard: REPORT_UNRECORDED_GUARD, row: null, owner, label,
  sentence: `${label} is not shown: ${why}, and the backtest record does not carry that yet.`,
})

/** ⭐ THE REFUSED METRICS (ruling D8): every other Strategy Tester figure, by name, with its
 *  guard and member sentence. A metric moves to SERVED_METRICS only with a stated definition
 *  or a capture that witnesses it. */
export const REFUSED_METRICS = Object.freeze({
  maxDrawdown: unstated('Max drawdown', 'W9-S1'),
  maxRunup: unstated('Max run-up', 'W9-S1'),
  buyAndHoldReturn: unstated('Buy and hold return', 'W9-S1'),
  percentProfitable: unstated('Percent profitable', 'W9-S1'),
  avgTrade: unstated('Average trade', 'W9-S1'),
  avgWinningTrade: unstated('Average winning trade', 'W9-S1'),
  avgLosingTrade: unstated('Average losing trade', 'W9-S1'),
  ratioAvgWinAvgLoss: unstated('Ratio of average win to average loss', 'W9-S1'),
  largestWinningTrade: unstated('Largest winning trade', 'W9-S1'),
  largestLosingTrade: unstated('Largest losing trade', 'W9-S1'),
  avgBarsInTrades: unstated('Average bars in trades', 'W9-S1'),
  sharpeRatio: unstated('Sharpe ratio', 'W9-S2'),
  sortinoRatio: unstated('Sortino ratio', 'W9-S2'),
  openProfit: unrecorded('Open profit', "it is the open trades' profit at the last bar's close",
    STRATEGY_RECORD_UNSERVED.equity),
  equity: unrecorded('Equity', "it includes the open trades' profit at the last bar's close",
    STRATEGY_RECORD_UNSERVED.equity),
})

const refusal = (r) => ({ status: 'refused', ...r })

/** the unpinned rules of `rules`, sorted (so the named one never depends on set order) */
const unpinnedOf = (rules, isPinned) => [...new Set(rules)].sort().filter((id) => !isPinned(id))
const unpinnedRefusal = (label, missing) => {
  const rule = missing[0]
  let cap = null
  try { cap = ruleCapture(rule) } catch { cap = null }
  return refusal({
    guard: UNPINNED_GUARD, rule, rules: missing, row: cap,
    // W9-T13b r2 PLAIN WORDS: the rule id and capture row ride `rule` / `row`, never the member text
    sentence: `${label} is not shown: it depends on a rule of how TradingView runs a backtest that has not `
      + 'yet been checked against TradingView.',
  })
}
const offGrid = (label) => refusal({
  guard: BROKER_UNSETTLED_GUARD, row: 'Q-S1l',
  sentence: `${label} is not shown: a trade filled at a price between the symbol's price steps, and how `
    + 'TradingView treats such a fill has not yet been checked.',
})
const noSymbol = (label, what) => refusal({
  guard: REPORT_UNRECORDED_GUARD, row: null,
  sentence: `${label} is not shown: it needs the symbol's ${what}, and the backtest record does not carry it.`,
})

/** D2: the start date and sentence are READ from the record (one authority), never recomputed. */
function windowOf(w) {
  return { startTime: w.startTime, startDate: w.startDate, fromListing: w.fromListing === true, bars: w.bars,
    historyWindowBars: w.historyWindowBars, asOfBar: w.asOfBar, asOfDate: startDateOf(w.asOfBar), sentence: w.startSentence }
}

/**
 * The strategy report of one run.
 *
 * @param {object} rec  the run's `strategy` record (`strategyRecord.js`, v1)
 * @param {object} [opts]
 * @param {(ruleId: string) => boolean} [opts.isPinned]  TESTS ONLY: the pin predicate. The
 *   product default is the committed ledger (`pinned(rule)`).
 */
export function strategyReportOf(rec, opts = {}) {
  const isPinned = typeof opts.isPinned === 'function' ? opts.isPinned : (id) => pinned(id)
  const shape = strategyRecordShapeErrors(rec)
  if (shape.length) {
    return { schema: STRATEGY_REPORT_SCHEMA, status: 'refused', window: null, metrics: null, trades: null,
      // W9-T13b r2 PLAIN WORDS: the failing field paths ride `fields`, never the member text
      refusals: [{ guard: REPORT_RECORD_GUARD, fields: shape,
        sentence: 'the backtest record is incomplete or in a form this report cannot read, so there is no report.' }] }
  }
  const window = windowOf(rec.window)
  // a run-wide refusal: the report holds only the refusal (design 3.3)
  if (rec.refusals.length) {
    return { schema: STRATEGY_REPORT_SCHEMA, status: 'refused', window, metrics: null, trades: null,
      refusals: rec.refusals.map((r) => ({ ...r })) }
  }

  const fillRules = rec.rulesUsed.slice()
  const closed = rec.trades.filter((t) => !t.open)
  const open = rec.trades.filter((t) => t.open)
  const { mintick, pointvalue } = rec.symbol
  const capital = rec.settings.initial_capital
  // a closed trade's profit in price units x size: the broker's own arithmetic (`closeTrade`)
  const pts = (t) => (t.exitPrice - t.entryPrice) * (t.dir === 'long' ? 1 : -1) * t.qty
  const sum = (arr, f) => arr.reduce((s, t) => s + f(t), 0)
  // B-DEFAULTS: a closed trade's profit is net of commission, which is 0 only by the default when the
  // script does not declare it, so every value that reads a profit (its SIGN included) rests on it.
  // ⭐ W9-T5: a non-zero commission rests on its type's rule instead (ONE authority: `commissionRulesOf`)
  const commission = rec.settings.commission
  const rulesFor = (kind) => [...fillRules, 'B-VAL', ...(kind === 'count' ? [] : commissionRulesOf(commission))]
  // W9-T5: with a commission every money figure is net of the trade's fees (the broker's `netOf`); with none,
  // the pre-W9-T5 expressions exactly
  const costOn = commission.value > 0
  const netMoney = (t) => pts(t) * pointvalue - t.commission

  // the sign of a closed trade's profit, off the tick grid only when it is further than one
  // tick-quantity from zero (the broker's `signOf`); null + refusal when it cannot be told
  const signs = (label) => {
    const out = []
    for (const t of closed) {
      if (costOn) {
        if (pointvalue === null || mintick === null) return { refused: noSymbol(label, 'tick size and point value') }
        const n = netMoney(t)
        if (!t.exact && Math.abs(n) <= t.qty * mintick * pointvalue) return { refused: offGrid(label) }
        out.push(Math.sign(n))
        continue
      }
      const p = pts(t)
      if (!t.exact) {
        if (mintick === null) return { refused: noSymbol(label, 'tick size') }
        if (Math.abs(p) <= t.qty * mintick) return { refused: offGrid(label) }
      }
      out.push(Math.sign(p))
    }
    return { signs: out }
  }
  const money = (label) => {
    if (closed.some((t) => !t.exact)) return { refused: offGrid(label) }
    if (pointvalue === null) return { refused: noSymbol(label, 'point value') }
    return { ok: true }
  }

  const metric = (key) => {
    const m = SERVED_METRICS[key]
    const missing = unpinnedOf(rulesFor(m.kind), isPinned)
    if (missing.length) return unpinnedRefusal(m.label, missing)
    const served = (value) => ({ status: 'served', value, pine: m.pine, source: m.source })
    if (m.kind === 'count') return served(key === 'totalOpenTrades' ? open.length : closed.length)
    if (m.kind === 'sign') {
      const s = signs(m.label)
      if (s.refused) return s.refused
      const want = key === 'numberWinningTrades' ? 1 : key === 'numberLosingTrades' ? -1 : 0
      return served(s.signs.filter((x) => x === want).length)
    }
    if (m.kind === 'commission') {
      if (open.some((t) => t.commission > 0)) {
        return refusal({ guard: REPORT_UNSTATED_GUARD, row: 'W9-S1',
          sentence: `${m.label} is not shown: an open trade has paid its entry fee, and whether TradingView's Strategy Tester `
            + 'counts it before the trade closes is not stated (capture row W9-S1).' })
      }
      if (costOn && commission.type === 'percent' && closed.some((t) => !t.exact)) return offGrid(m.label)
      return served(sum(closed, (t) => t.commission))
    }
    const g = money(m.label)
    if (g.refused) return g.refused
    const net = costOn ? sum(closed, netMoney) : sum(closed, pts) * pointvalue
    const gross = costOn ? sum(closed, (t) => { const n = netMoney(t); return n > 0 ? n : 0 })
      : sum(closed, (t) => { const p = pts(t); return p > 0 ? p : 0 }) * pointvalue
    const loss = costOn ? sum(closed, (t) => { const n = netMoney(t); return n < 0 ? -n : 0 })
      : sum(closed, (t) => { const p = pts(t); return p < 0 ? -p : 0 }) * pointvalue
    switch (key) {
      case 'netProfit': return served(net)
      case 'grossProfit': return served(gross)
      case 'grossLoss': return served(loss)
      case 'netProfitPercent':
        if (!(Number.isFinite(capital) && capital > 0)) {
          return refusal({ guard: REPORT_UNRECORDED_GUARD, row: null,
            sentence: `${m.label} is not shown: it needs the strategy's initial capital, and the backtest record does not carry it.` })
        }
        return served(net / capital * 100)
      case 'profitFactor':
        if (loss === 0) {
          return refusal({ guard: REPORT_UNDEFINED_GUARD, row: null,
            sentence: 'Profit factor is not shown: it is gross profit divided by gross loss, and this backtest has no gross loss to divide by.' })
        }
        return served(gross / loss)
      default: throw new Error(`brokerReport: no computation for ${key}`)
    }
  }

  const metrics = {}
  for (const key of Object.keys(SERVED_METRICS)) metrics[key] = metric(key)
  for (const [key, r] of Object.entries(REFUSED_METRICS)) metrics[key] = refusal({ ...r })

  // the trade list: every trade, or none (its fills rest on the run's rules)
  let trades
  const listMissing = unpinnedOf(fillRules, isPinned)
  if (listMissing.length) trades = unpinnedRefusal('The list of trades', listMissing)
  else {
    const profitMissing = unpinnedOf(rulesFor('money'), isPinned)
    // ⭐ W9-T7-F1 — each fill's signal (the text the Strategy Tester shows for its order), from the order log by
    // the log's own link, through the ONE label rule (`orderLabelOf`) the markers read too
    const log = Array.isArray(rec.orders) ? rec.orders : null
    const opener = new Map()
    const closer = new Map()
    for (const o of log || []) {
      for (const n of o.opened) opener.set(n, o)
      for (const n of o.closed) closer.set(n, o)
    }
    const signalOf = (t, role) => {
      const what = `Trade ${t.n}'s ${role} signal`
      if (!log) {
        return refusal({ guard: REPORT_UNRECORDED_GUARD, row: null,
          sentence: `${what} is not shown: the backtest record does not keep a log of its orders.` })
      }
      const o = role === 'entry' ? opener.get(t.n) : closer.get(t.n)
      const label = orderLabelOf(o, role)
      if (label !== null) return { status: 'served', value: label }
      if (o && o.commentRecorded !== true) {
        return refusal({ guard: REPORT_UNRECORDED_GUARD, row: null,
          sentence: `${what} is not shown: the script computes this order's comment, and the backtest record keeps only a `
            + 'comment written as text.' })
      }
      if (exitLabelUnstated(o, role)) {
        return refusal({ guard: REPORT_UNSTATED_GUARD, row: EXIT_LABEL_ROW,
          sentence: `${what} is not shown: this trade was closed by the order that reversed the position, and what `
            + 'TradingView shows for that exit has not yet been checked against TradingView.' })
      }
      return refusal({ guard: REPORT_UNSTATED_GUARD, row: EXIT_LABEL_ROW,
        sentence: `${what} is not shown: TradingView names this kind of exit itself, and that name has not yet been `
          + 'checked against TradingView.' })
    }
    const rows = rec.trades.map((t) => {
      let profit
      if (t.open) {
        profit = refusal({ ...REFUSED_METRICS.openProfit, sentence: `This open trade's profit is not shown: it is its profit at the last bar's close, and the backtest record does not carry that yet.` })
      } else if (profitMissing.length) profit = unpinnedRefusal(`Trade ${t.n}'s profit`, profitMissing)
      else if (!t.exact) profit = offGrid(`Trade ${t.n}'s profit`)
      else if (pointvalue === null) profit = noSymbol(`Trade ${t.n}'s profit`, 'point value')
      else profit = { status: 'served', value: costOn ? netMoney(t) : pts(t) * pointvalue, pine: 'strategy.closedtrades.profit', source: B_VAL_SOURCE }
      return { n: t.n, entryId: t.entryId, dir: t.dir, qty: t.qty, entryTime: t.entryTime, entryPrice: t.entryPrice,
        exitTime: t.exitTime, exitPrice: t.exitPrice, open: t.open, profit,
        entrySignal: signalOf(t, 'entry'), exitSignal: t.open ? null : signalOf(t, 'exit') }
    })
    trades = { status: 'served', rows }
  }

  return { schema: STRATEGY_REPORT_SCHEMA, status: 'ok', window, metrics, trades, refusals: [] }
}
