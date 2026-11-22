// app/src/components/chart/engine/runtime/__tests__/w9ServeCapitalRule.test.js
//
// SERVE AUDIT (2026-11-17), gap 1: a metric whose value rests on a rule the run never asked is withheld by name.
//
// `Net profit %` divides by the initial capital. When the script does not state `initial_capital` that capital is
// the version's default, which rests on B-DEFAULTS (Q-S1b). The broker asks B-DEFAULTS for the capital only where
// the RUN reads it (`broker.js` capital()); a run sized by a fixed quantity, at a declared margin and a declared
// non-zero commission type, never does, so its `rulesUsed` hold no B-DEFAULTS and the commission's rules
// (`commissionRulesOf`) hold none either. Before this rail the report served `Net profit %` on that default with
// no pinned rule behind it. Now a defaulted capital adds B-DEFAULTS to that one metric.
//
// Mutation proof (by hand, restored from a saved copy): drop `...(kind === 'percent' ? capitalRules : [])` from
// `brokerReport.js` rulesFor -> "refuses Net profit % by name" goes RED (the metric is served).
import { describe, it, expect } from 'vitest'
import { strategyReportOf } from '../brokerReport.js'
import { strategyRecordOf, strategyRecordShapeErrors } from '../strategyRecord.js'
import { orderLogFor } from './orderLogFixture.js'
import { UNPINNED_GUARD } from '../brokerRules.js'

const T0 = 1711027800
const DAY = 86400
const at = (i) => T0 + i * DAY
const BAR_TIMES = Array.from({ length: 20 }, (_, i) => at(i))
const tr = (id, qty, e, x, commission) => ({
  id, dir: 1, qty, exact: true, commission,
  entry: { time: at(e[0]), price: e[1], rule: 'B-MARKET' },
  exit: { time: at(x[0]), price: x[1], rule: 'B-CLOSE' },
})

/** One closed long trade, 2 @ 10 -> 13, a percent commission the script DECLARES (type and value), margins stated. */
const recordWith = (defaulted) => {
  const trades = [tr('L', 2, [1, 10], [3, 13], 0.046)]
  return strategyRecordOf({
    summary: { record: { trades, orders: orderLogFor(trades), rulesUsed: ['B-MARKET', 'B-CLOSE', 'B-COMM-PCT'],
      symbol: { mintick: 0.01, pointvalue: 1 } } },
    decl: { version: 5, initialCapital: 1000000, defaultQty: 2, pyramiding: 1, fromListing: false, defaulted,
      commission: { type: 'percent', value: 0.1, typeDefaulted: false } },
    barTimes: BAR_TIMES, historyWindowBars: 5000, confirmed: true,
  })
}
/** every rule pinned except B-DEFAULTS: the predicate a ledger without that pin answers with */
const exceptDefaults = (id) => id !== 'B-DEFAULTS'

describe('serve audit gap 1: Net profit % rests on the capital it divides by', () => {
  it('the fixture is a v1 record whose rules and commission ask no B-DEFAULTS (the shape the gap needs)', () => {
    const rec = recordWith({ initialCapital: true })
    expect(strategyRecordShapeErrors(rec)).toEqual([])
    expect(rec.rulesUsed).not.toContain('B-DEFAULTS')
    expect(rec.settings.commission).toEqual({ type: 'percent', value: 0.1, typeDefaulted: false })
    expect(rec.settings.defaulted).toEqual(['initialCapital'])
  })

  it('a DEFAULTED capital: Net profit % refuses by name (B-DEFAULTS, Q-S1b) while the money figures are served', () => {
    const rep = strategyReportOf(recordWith({ initialCapital: true }), { isPinned: exceptDefaults })
    expect(rep.status).toBe('ok')
    const pct = rep.metrics.netProfitPercent
    expect(pct.status).toBe('refused')
    expect(pct.guard).toBe(UNPINNED_GUARD)
    expect(pct.rule).toBe('B-DEFAULTS')
    expect(pct.row).toBe('Q-S1b')
    expect(pct.sentence).toMatch(/^Net profit % is not shown: it depends on a rule of how TradingView runs a backtest/)
    // (13 - 10) x 2 = 6, less the fee 0.046: the money figures rest on no default, so they are served
    expect(rep.metrics.netProfit.status).toBe('served')
    expect(rep.metrics.netProfit.value).toBeCloseTo(5.954, 10)
  })

  it('a STATED capital: Net profit % is served (5.954 / 1,000,000 x 100), the control', () => {
    const rep = strategyReportOf(recordWith({ initialCapital: false }), { isPinned: exceptDefaults })
    expect(rep.metrics.netProfitPercent.status).toBe('served')
    expect(rep.metrics.netProfitPercent.value).toBeCloseTo(0.0005954, 12)
  })

  it('with B-DEFAULTS pinned (the committed ledger) a defaulted capital serves it: nothing a member reads changes today', () => {
    const rep = strategyReportOf(recordWith({ initialCapital: true }))
    expect(rep.metrics.netProfitPercent.status).toBe('served')
  })
})
