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
// (`record.rulesUsed`), on B-VAL (its definition) and, for a currency value, on B-DEFAULTS (the
// commission is 0: the broker refuses any other `commission_value` at build, and an undeclared
// one is the manual's default, which the record cannot tell apart; a trade's SIGN rests on it too,
// since a commission can turn a break-even or small win into a loss). Each is asked of the
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
import { ruleCapture, UNPINNED_GUARD, COMMISSION_RULE } from './brokerRules.js'
import { BROKER_UNSETTLED_GUARD } from './broker.js'
import { STRATEGY_RECORD_UNSERVED, strategyRecordShapeErrors, startDateOf, startSentenceOf } from './strategyRecord.js'

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
})

const unstated = (label, row) => Object.freeze({
  guard: REPORT_UNSTATED_GUARD, row,
  sentence: `${label} is not shown: no source we hold states exactly how TradingView's Strategy Tester `
    + `computes it, and no capture has witnessed it yet (capture row ${row}).`,
})
const unrecorded = (label, why, owner) => Object.freeze({
  guard: REPORT_UNRECORDED_GUARD, row: null, owner,
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
  commissionPaid: unrecorded('Commission paid', 'it needs the commission the run was charged',
    STRATEGY_RECORD_UNSERVED['settings.commission']),
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
    sentence: `${label} is not shown: it rests on the broker rule ${rule}, which no matching TradingView `
      + `capture pins yet (${cap ? `capture row ${cap}` : 'no capture row is queued for it yet'}).`,
  })
}
const offGrid = (label) => refusal({
  guard: BROKER_UNSETTLED_GUARD, row: 'Q-S1l',
  sentence: `${label} is not shown: a trade filled at a price off the symbol's tick grid, and whether `
    + 'TradingView rounds that fill is not stated (capture row Q-S1l).',
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
      refusals: [{ guard: REPORT_RECORD_GUARD, sentence: `the backtest record is not one this report reads (${shape.join(', ')}), so there is no report.` }] }
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
  // script does not declare it, so every value that reads a profit (its SIGN included) rests on it
  const rulesFor = (kind) => [...fillRules, 'B-VAL', ...(kind === 'count' ? [] : [COMMISSION_RULE])]

  // the sign of a closed trade's profit, off the tick grid only when it is further than one
  // tick-quantity from zero (the broker's `signOf`); null + refusal when it cannot be told
  const signs = (label) => {
    const out = []
    for (const t of closed) {
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
    const g = money(m.label)
    if (g.refused) return g.refused
    const net = sum(closed, pts) * pointvalue
    const gross = sum(closed, (t) => { const p = pts(t); return p > 0 ? p : 0 }) * pointvalue
    const loss = sum(closed, (t) => { const p = pts(t); return p < 0 ? -p : 0 }) * pointvalue
    switch (key) {
      case 'netProfit': return served(net)
      case 'grossProfit': return served(gross)
      case 'grossLoss': return served(loss)
      case 'netProfitPercent':
        if (!(Number.isFinite(capital) && capital > 0)) {
          return refusal({ guard: REPORT_UNRECORDED_GUARD, row: null,
            sentence: `${m.label} is not shown: it needs the strategy's initial capital, and the backtest record does not carry it.` })
        }
        return served((sum(closed, pts) * pointvalue) / capital * 100)
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
    const rows = rec.trades.map((t) => {
      let profit
      if (t.open) {
        profit = refusal({ ...REFUSED_METRICS.openProfit, sentence: `This open trade's profit is not shown: it is its profit at the last bar's close, and the backtest record does not carry that yet.` })
      } else if (profitMissing.length) profit = unpinnedRefusal(`Trade ${t.n}'s profit`, profitMissing)
      else if (!t.exact) profit = offGrid(`Trade ${t.n}'s profit`)
      else if (pointvalue === null) profit = noSymbol(`Trade ${t.n}'s profit`, 'point value')
      else profit = { status: 'served', value: pts(t) * pointvalue, pine: 'strategy.closedtrades.profit', source: B_VAL_SOURCE }
      return { n: t.n, entryId: t.entryId, dir: t.dir, qty: t.qty, entryTime: t.entryTime, entryPrice: t.entryPrice,
        exitTime: t.exitTime, exitPrice: t.exitPrice, open: t.open, profit }
    })
    trades = { status: 'served', rows }
  }

  return { schema: STRATEGY_REPORT_SCHEMA, status: 'ok', window, metrics, trades, refusals: [] }
}
