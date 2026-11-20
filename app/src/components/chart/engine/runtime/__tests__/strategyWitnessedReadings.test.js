// app/src/components/chart/engine/runtime/__tests__/strategyWitnessedReadings.test.js
//
// ─── THREE BROKER READINGS COMMITTED REPORT CAPTURES ALREADY WITNESS (2026-11-19, the strategy unit) ─────────
//
// Each rule below is served on hand-built bars whose every number follows from the rule's own sentence, and is
// WITNESSED by a committed TradingView report capture that grades MATCH on every trade, fill and value
// (`strategyGrading.test.js`); no text states any of them:
//
//   [B-ROUND-LEVEL]     a SHORT's `strategy.exit` level off the tick grid that the bar's path reaches fills at the first
//                       tick at or past it in the direction of travel (its stop: the tick above; its limit: the tick
//                       below). macd-shortlong-strategy-is-rddt-1d-2026-11-18 (community, corpus/committed, MPL-2.0)
//   [B-QTY-REVERSE-M0]  a reversal at the percent-of-equity default 100 at MARGINS 0: open size + floor(equity at the
//                       signal close / that close), never rejected for funds. macd-shortlong-strategy-is (9 reversals)
//   [B-MARGIN-ZERO]     at a margin of 0 an equity below zero is carried: no margin call, no refusal.
//                       w9-q-s1b-v4-shape-b-rddt-1d-2026-11-17 (equity to -201,004.80, 0 margin calls, 40 trades)
//
// Every served case has its UNPINNED twin (the same run with only that rule unpinned stops by name, ruling D1), and
// every case the captures do not witness stays as it was, BY NAME (a sell level, an entry's level, margins 100, a
// percent-of-equity STOP entry).
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { BROKER_RULES } from '../brokerRules.js'

const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE' } // mintick 0.01, pointvalue 1
const T0 = 1700000000
const DAY = 86400
const ALL = () => true
const except = (...ids) => (id) => !ids.includes(id)
const barsOf = (rows) => rows.map(([o, h, l, c], i) => ({ t: T0 + i * DAY, o, h, l, c, v: 1000 }))
// bars 0-1 flat at 100; an order placed on bar 1 fills on bar 2 (path 100 -> 99.5 -> 101.5 -> 101), one on bar 3 on bar 4
const base = (b2, b4, b3) => barsOf([
  [100, 101, 99, 100], [100, 101, 99, 100],
  b2 || [100, 101.5, 99.5, 101],
  b3 || [101, 104, 100.5, 103.5],
  b4 || [103.5, 105, 102.5, 104],
  ...Array.from({ length: 5 }, () => [104, 105, 103.5, 104.5]),
])

const attempt = (src, { bars = base(), pins = ALL } = {}) => {
  const built = buildRuntimeIr(src, { bars, inputs: {}, symbol: SYMBOL, strategyBroker: true })
  if (!built.ok) return { refused: built.refusal }
  const program = lowerIrProgram(built.ir, { historyFromListing: true })
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const barTimes = bars.map((b) => b.t)
  // `minContract` 1: the run context's `syminfo.mincontract` for NYSE (its witnessed row), as `w9T4Sizing.test.js` hands it
  const ctx = { bars: bars.length, series, columns: program.columns, confirmed: true, barTimes, historyWindowBars: 5000,
    minContract: 1 }
  try {
    const res = execute(program, ctx, undefined, { brokerPinned: pins })
    return { res, cols: res.outputs.map((o) => Array.from(o)), trades: res.broker.record.trades, used: res.broker.record.rulesUsed }
  } catch (e) { return { err: e } }
}
const served = (src, o) => {
  const r = attempt(src, o)
  expect(r.refused, JSON.stringify(r.refused)).toBeUndefined()
  expect(r.err, r.err && r.err.message).toBeUndefined()
  return r
}
const unpinnedAt = (src, rule, o = {}) => {
  const r = attempt(src, { ...o, pins: except(rule) })
  expect(r.err, `the run did not stop with ${rule} unpinned`).toBeDefined()
  expect(r.err.guard).toBe('runtime:strategy-unpinned')
  expect(r.err.rule).toBe(rule)
  return r.err
}
const unsettled = (src, row, o) => {
  const r = attempt(src, o)
  expect(r.err, 'the run did not stop').toBeDefined()
  expect(r.err.guard).toBe('runtime:strategy-unsettled')
  expect(r.err.message).toContain(row)
  return r.err
}

const FIXED = '//@version=6\nstrategy("t", initial_capital = 100000, default_qty_type = strategy.fixed, default_qty_value = 2, '
  + 'margin_long = 0, margin_short = 0)\n'
const AT1 = (call) => `if bar_index == 1\n    ${call}\n`
const PLOTS = 'plot(strategy.position_size)\nplot(strategy.position_avg_price)\n'
const SHORT_EXIT = (lvl) => `${FIXED}${AT1('strategy.entry("S", strategy.short)')}strategy.exit("x", "S", ${lvl})\n${PLOTS}`

describe('the three readings are named rules, each with its capture row', () => {
  it('B-ROUND-LEVEL (Q-S1l), B-QTY-REVERSE-M0 (Q-S1a), B-MARGIN-ZERO (Q-S1b)', () => {
    expect(BROKER_RULES['B-ROUND-LEVEL'].capture).toBe('Q-S1l')
    expect(BROKER_RULES['B-QTY-REVERSE-M0'].capture).toBe('Q-S1a')
    expect(BROKER_RULES['B-MARGIN-ZERO'].capture).toBe('Q-S1b')
    // ⛔ the stop-entry sizing w9-q-s1a-size-stop-v6 suggests is NOT a rule: that capture does not MATCH
    expect(BROKER_RULES['B-QTY-STOP']).toBeUndefined()
  })
})

describe('[B-ROUND-LEVEL] a short\'s exit level off the tick grid fills at the first tick past it in the direction of travel', () => {
  it('its stop-loss at 101.2345, reached on the rise, fills at 101.24 (the tick above; the nearest is 101.23)', () => {
    const src = SHORT_EXIT('stop = 101.2345')
    const r = served(src)
    expect(r.trades[0].exit.price).toBe(101.24)
    expect(r.trades[0].exact).toBe(true)
    expect(r.used).toContain('B-ROUND-LEVEL')
    unpinnedAt(src, 'B-ROUND-LEVEL')
  })

  it('its take-profit at 99.6789, reached on the fall, fills at 99.67 (the tick below; the nearest is 99.68)', () => {
    const r = served(SHORT_EXIT('limit = 99.6789'))
    expect(r.trades[0].exit.price).toBe(99.67)
    expect(r.trades[0].exact).toBe(true)
    expect(r.used).toContain('B-ROUND-LEVEL')
  })

  it('CONTROL: an ON-grid level fills at itself and never asks the rule', () => {
    const r = served(SHORT_EXIT('stop = 101.23'))
    expect(r.trades[0].exit.price).toBe(101.23)
    expect(r.used).not.toContain('B-ROUND-LEVEL')
  })

  it('⛔ a LONG\'s exit (a sell level) is not witnessed: it keeps its raw, off-grid fill, never rounded, never the rule', () => {
    const r = served(`${FIXED}${AT1('strategy.entry("L", strategy.long)')}strategy.exit("x", "L", stop = 99.6789)\n${PLOTS}`)
    expect(r.trades[0].exit.price).toBe(99.6789)
    expect(r.trades[0].exact).toBe(false)
    expect(r.used).not.toContain('B-ROUND-LEVEL')
  })

  it('⛔ an ENTRY\'s level is not witnessed either: a long stop entry at 101.2345 keeps its raw fill, and a read of it '
    + 'refuses by name (Q-S1l), as before', () => {
    const entry = AT1('strategy.entry("L", strategy.long, stop = 101.2345)')
    const r = served(`${FIXED}${entry}plot(strategy.position_size)\n`)
    expect(r.trades[0].entry.price).toBe(101.2345)
    expect(r.trades[0].exact).toBe(false)
    expect(r.used).not.toContain('B-ROUND-LEVEL')
    unsettled(`${FIXED}${entry}${PLOTS}`, 'Q-S1l')
  })

  it('⛔ a tick past the bar\'s own extreme is not witnessed: refused by name (Q-S1l)', () => {
    unsettled(SHORT_EXIT('stop = 101.2341'), 'Q-S1l', { bars: base([100, 101.2345, 99.5, 101]) })
  })
})

describe('[B-QTY-REVERSE-M0] a reversal at margins 0 adds floor(equity at the signal close / that close), never rejected for funds', () => {
  // v5, the default margins 0; capital 1,000 and 100% of equity, as the community capture declares
  const V5 = (m = '') => `//@version=5\nstrategy("t", initial_capital = 1000, default_qty_type = strategy.percent_of_equity, `
    + `default_qty_value = 100${m})\n`
  const SRC = (m) => `${V5(m)}${AT1('strategy.entry("L", strategy.long)')}if bar_index == 3\n    strategy.entry("S", strategy.short)\n${PLOTS}`

  it('long 10 at 100; at bar 3 (close 103.5) equity 1,035: the order sells 10 + floor(1,035 / 103.5) = 20', () => {
    const r = served(SRC())
    expect(r.trades[0].qty).toBe(10)
    expect(r.trades[1].qty).toBe(10)
    expect(r.trades[1].dir).toBe(-1)
    expect(r.cols[0][4]).toBe(-10)
    expect(r.used).toContain('B-QTY-REVERSE-M0')
    expect(r.used).not.toContain('B-QTY-REVERSE')
    unpinnedAt(SRC(), 'B-QTY-REVERSE-M0')
  })

  it('the new 10 x a higher open 105 = 1,050 is past the 1,035 it was sized from, and it FILLS at margin 0', () => {
    const r = served(SRC(), { bars: base(null, [105, 106, 104, 105]) })
    expect(r.cols[0][4]).toBe(-10)
    expect(r.trades[1].entry.price).toBe(105)
  })

  it('CONTROL: the same at margins 100 is [B-QTY-REVERSE], whose [B-FUNDS-REVERSE] rejects that reversal whole', () => {
    const r = served(SRC(', margin_long = 100, margin_short = 100'), { bars: base(null, [105, 106, 104, 105]) })
    expect(r.used).toContain('B-QTY-REVERSE')
    expect(r.used).not.toContain('B-QTY-REVERSE-M0')
    expect(r.cols[0][4]).toBe(10)
  })
})

describe('[B-MARGIN-ZERO] at margins 0 an equity below zero is carried: no margin call, no refusal', () => {
  const SRC = '//@version=5\nstrategy("t", initial_capital = 1000, default_qty_type = strategy.fixed, default_qty_value = 50)\n'
    + `${AT1('strategy.entry("L", strategy.long)')}plot(strategy.equity)\n`
  // long 50 at 100 on bar 2; bar 3 trades down to 70: 1,000 + 50 x (70 - 100) = -500 at its low, -450 at its close
  const BARS = base(null, [72, 73, 70, 71], [99, 100, 70, 71])

  it('a 1,000 account long 50 runs through an equity of -500, and reads -450 at the close', () => {
    const r = served(SRC, { bars: BARS })
    expect(r.used).toContain('B-MARGIN-ZERO')
    expect(r.trades[0].qty).toBe(50)
    expect(r.cols[0][3]).toBeCloseTo(1000 + 50 * (71 - 100), 9)
    unpinnedAt(SRC, 'B-MARGIN-ZERO', { bars: BARS })
  })

  it('CONTROL: an equity that stays above zero never asks the rule', () => {
    expect(served(SRC).used).not.toContain('B-MARGIN-ZERO')
  })

  it('CONTROL: the same at a margin of 100 is the check it always was (the long the equity cannot carry stops, Q-S1i)', () => {
    unsettled(SRC.replace('default_qty_value = 50)', 'default_qty_value = 50, margin_long = 100, margin_short = 100)'), 'Q-S1i',
      { bars: BARS })
  })
})

describe('⛔ a percent-of-equity STOP entry stays refused by name (w9-q-s1a-size-stop-v6 does not MATCH)', () => {
  it('the v6 default size on a long stop entry: runtime:strategy-unsettled, Q-S1a, as before', () => {
    unsettled(`//@version=6\nstrategy("t")\n${AT1('strategy.entry("L", strategy.long, stop = 101.2345)')}${PLOTS}`, 'Q-S1a')
  })
})
