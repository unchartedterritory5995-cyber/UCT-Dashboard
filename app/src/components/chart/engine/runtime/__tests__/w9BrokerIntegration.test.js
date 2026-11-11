// W9 broker integration rails (T6 fill timing + T7 exits + T13a report on one tree).
//
// 1. The T13a report reads records whose fills carry the T6 labels (B-POC) and the T7 labels (B-TRAIL,
//    B-EXIT-QTY, a split partial exit), and serves them: it rests on `rulesUsed`, never on a fixed list
//    of fill labels.
// 2. Reviewer note N7 (dsk/reviews/W9-T13A.md): every reader of EQUITY (the fill-side margin check, a
//    percent-of-equity size) asks COMMISSION_RULE, not only the `strategy.equity` value, because equity
//    is net of commission.
//
// ⛔ Every rule here is unpinned on the committed ledger; these run through the TEST-ONLY pin predicate
// on hand-built bars, and each number is worked by hand beside it.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { strategyRecordOf, strategyRecordShapeErrors } from '../strategyRecord.js'
import { strategyReportOf } from '../brokerReport.js'
import { COMMISSION_RULE } from '../brokerRules.js'

const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE' }
const T0 = 1700000000
const DAY = 86400
const barsOf = (rows) => rows.map(([o, h, l, c], i) => ({ t: T0 + i * DAY, o, h, l, c, v: 1000 }))
const ALL = () => true
// as w9T7Exits.test.js: bar 2 100 -> 99.5 -> 101.5 -> 101; bar 3 101 -> 100.5 -> 104 -> 103.5
const A = barsOf([[100, 101, 99, 100], [100, 101, 99, 100], [100, 101.5, 99.5, 101], [101, 104, 100.5, 103.5],
  [103.5, 105, 102.5, 104], ...Array.from({ length: 5 }, () => [104, 105, 103.5, 104.5])])

const run = (src, { bars = A, pins = ALL } = {}) => {
  const built = buildRuntimeIr(src, { bars, inputs: {}, symbol: SYMBOL, strategyBroker: true })
  expect(built.ok, JSON.stringify(built.refusal)).toBe(true)
  const program = lowerIrProgram(built.ir, { historyFromListing: true })
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const barTimes = bars.map((b) => b.t)
  try {
    const res = execute(program, { bars: bars.length, series, columns: program.columns, confirmed: true, barTimes,
      historyWindowBars: 5000, minContract: 1 }, undefined, { brokerPinned: pins })
    const rec = strategyRecordOf({ summary: res.broker, decl: built.ir.broker, barTimes, historyWindowBars: 5000, confirmed: true })
    return { res, rec }
  } catch (e) { return { err: e } }
}
const report = (rec) => {
  expect(strategyRecordShapeErrors(rec)).toEqual([])
  const rep = strategyReportOf(rec, { isPinned: ALL })
  expect(rep.status).toBe('ok')
  expect(rep.trades.status).toBe('served')
  return rep
}

describe('the T13a report accepts the T6 and T7 fill labels', () => {
  it('T7: a two-level partial exit (B-EXIT-QTY split) - net 2 x 1.2 + 2 x 3 = 8.4, two rows of 2', () => {
    const { rec, err } = run('//@version=5\nstrategy("t")\nif bar_index == 1\n    strategy.entry("L", strategy.long, qty = 4)\n'
      + '    strategy.exit("tp1", "L", qty_percent = 50, limit = 101.2)\n    strategy.exit("tp2", "L", limit = 103)\n'
      + 'plot(strategy.position_size)\n')
    expect(err).toBeUndefined()
    expect(rec.rulesUsed).toEqual(expect.arrayContaining(['B-EXIT-QTY']))
    expect(rec.trades.map((t) => t.exitRule)).toEqual(['B-EXIT-QTY', 'B-PATH'])
    const rep = report(rec)
    expect(rep.metrics.netProfit.value).toBeCloseTo(8.4, 9)
    expect(rep.metrics.totalClosedTrades.value).toBe(2)
    expect(rep.trades.rows.map((r) => [r.qty, r.exitPrice])).toEqual([[2, 101.2], [2, 103]])
  })
  it('T7: a trailing stop (B-TRAIL) - entry 100, exit 103: net 3', () => {
    const { rec, err } = run('//@version=5\nstrategy("t")\nif bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1)\n'
      + '    strategy.exit("x", "L", trail_points = 200, trail_offset = 100)\nplot(strategy.position_size)\n')
    expect(err).toBeUndefined()
    expect(rec.trades[0].exitRule).toBe('B-TRAIL')
    expect(report(rec).metrics.netProfit.value).toBeCloseTo(3, 9)
  })
  it('T6: process_orders_on_close (B-POC) - filled at bar 1\'s close 100 and bar 3\'s close 103.5: net 3.5', () => {
    const { rec, err } = run('//@version=5\nstrategy("t", process_orders_on_close = true)\n'
      + 'if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1)\nif bar_index == 3\n    strategy.close("L")\n'
      + 'plot(strategy.position_size)\n')
    expect(err).toBeUndefined()
    expect(rec.trades.map((t) => [t.entryRule, t.exitRule])).toEqual([['B-POC', 'B-POC']])
    const rep = report(rec)
    expect(rep.metrics.netProfit.value).toBeCloseTo(3.5, 9)
    expect(rep.trades.rows[0].entryPrice).toBe(100)
    expect(rep.trades.rows[0].exitPrice).toBe(103.5)
  })
})

describe('N7: every reader of equity asks COMMISSION_RULE', () => {
  // everything declared: no version default is leaned on, so before N7 nothing asked B-DEFAULTS
  const DECL = 'strategy("t", initial_capital = 100000, margin_long = 100, margin_short = 100, pyramiding = 1, '
    + 'default_qty_type = strategy.fixed, default_qty_value = 1)'
  it('the fill-side margin check, with the margin DECLARED, stops naming COMMISSION_RULE when it is unpinned', () => {
    const src = `//@version=5\n${DECL}\nif bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1)\nplot(strategy.position_size)\n`
    const full = run(src)
    expect(full.err).toBeUndefined()
    expect(full.res.broker.record.rulesUsed).toContain(COMMISSION_RULE)
    const { err } = run(src, { pins: (id) => id !== COMMISSION_RULE })
    expect(err && err.guard).toBe('runtime:strategy-unpinned')
    expect(err.rule).toBe(COMMISSION_RULE)
  })
  it('a percent-of-equity size reads equity too, and asks it', () => {
    const src = '//@version=5\nstrategy("t", initial_capital = 100000, margin_long = 100, margin_short = 100, pyramiding = 1, '
      + 'default_qty_type = strategy.percent_of_equity, default_qty_value = 10)\n'
      + 'if bar_index == 1\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n'
    const full = run(src)
    expect(full.err && full.err.message).toBeUndefined()
    const { err } = run(src, { pins: (id) => id !== COMMISSION_RULE })
    expect(err && err.rule).toBe(COMMISSION_RULE)
  })
  it('... and asks it at the sizing itself: an entry placed on the LAST bar never fills (no margin check follows)', () => {
    // bar 9 is the last of A: the size is taken from equity at bar 9's close, and no bar 10 fills it
    const src = '//@version=5\nstrategy("t", initial_capital = 100000, margin_long = 100, margin_short = 100, pyramiding = 1, '
      + 'default_qty_type = strategy.percent_of_equity, default_qty_value = 10)\n'
      + 'if bar_index == 9\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n'
    const full = run(src)
    expect(full.err && full.err.message).toBeUndefined()
    expect(full.res.broker.record.trades).toEqual([])
    expect(full.res.broker.record.rulesUsed).not.toContain('B-MARGIN')
    expect(full.res.broker.record.rulesUsed).toContain(COMMISSION_RULE)
    const { err } = run(src, { pins: (id) => id !== COMMISSION_RULE })
    expect(err && err.rule).toBe(COMMISSION_RULE)
  })
})
