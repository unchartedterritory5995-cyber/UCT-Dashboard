// W9-T5 rails: costs. The three commission types, slippage, and both at the close under
// process_orders_on_close (W9 design section 4 T5; capture rows W9-K1..K4 and W9-P1).
//
// ⛔ EVERY RULE HERE IS UNPINNED (ruling D1). The committed ledger pins none of B-COMM-PCT, B-COMM-CONTRACT,
// B-COMM-ORDER, B-SLIPPAGE or B-POC-COST, so on the member door every costed script below refuses
// `runtime:strategy-unpinned` by name. The behaviour rails run through the TEST-ONLY pin predicate
// (`execute(..., { brokerPinned })`, the path the W9-T1, T4, T6 and T7 rails use) on hand-built bars. Every
// expected number is worked by hand in the comment beside it from the rule the broker states (`broker.js`,
// `docs/pine/strategy-broker-spec.md` "W9-T5"); where that rule is a HYPOTHESIS the comment says so, and a
// W9-K1..K4 / W9-P1 capture that disagrees moves the hypothesis, never these numbers silently.
//
// Bars: mintick 0.01, pointvalue 1 (NYSE:RDDT). B-PATH: open -> the NEARER extreme -> the other -> close.
//   0: 100 / 101 / 99 / 100     1: 100 / 101 / 99 / 100
//   2: 100 / 101.5 / 99.5 / 101  low nearer: 100 -> 99.5 -> 101.5 -> 101
//   3: 101 / 104 / 100.5 / 103.5 low nearer: 101 -> 100.5 -> 104 -> 103.5
//   4: 103.5 / 105 / 102.5 / 104 low nearer: 103.5 -> 102.5 -> 105 -> 104
//   5..9: 104 / 105 / 103.5 / 104.5
import { describe, it, expect, afterEach } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { makeBroker } from '../broker.js'
import { BROKER_RULE_IDS, BROKER_RULES, COMMISSION_RULE, COMMISSION_TYPE_RULES, commissionRulesOf } from '../brokerRules.js'
import RESOLVED from '../brokerPins.resolved.json'
import { strategyScorecardWording } from '../../ast/strategyScorecard.js'
import { computeRuntimeColumns } from '../runtimeColumns.js'
import { registerStrategyBrokerGate } from '../../strategyBrokerGateRegistry.js'
import { strategyRecordOf, strategyRecordShapeErrors } from '../strategyRecord.js'
import { strategyReportOf, REPORT_UNSTATED_GUARD } from '../brokerReport.js'

const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE' }
const T0 = 1700000000
const DAY = 86400
const barsOf = (rows) => rows.map(([o, h, l, c], i) => ({ t: T0 + i * DAY, o, h, l, c, v: 1000 }))
const ALL = () => true
const except = (...ids) => (id) => !ids.includes(id)
const T5_RULES = ['B-COMM-PCT', 'B-COMM-CONTRACT', 'B-COMM-ORDER', 'B-SLIPPAGE', 'B-POC-COST']
const HEAD = [[100, 101, 99, 100], [100, 101, 99, 100], [100, 101.5, 99.5, 101], [101, 104, 100.5, 103.5]]
const FILL = (n, row) => Array.from({ length: n }, () => row)
const A = barsOf([...HEAD, [103.5, 105, 102.5, 104], ...FILL(5, [104, 105, 103.5, 104.5])])
const at = (i) => T0 + i * DAY

const attempt = (src, { bars = A, pins = ALL } = {}) => {
  const built = buildRuntimeIr(src, { bars, inputs: {}, symbol: SYMBOL, strategyBroker: true })
  if (!built.ok) return { refused: built.refusal }
  const program = lowerIrProgram(built.ir, { historyFromListing: true })
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const ctx = { bars: bars.length, series, columns: program.columns, confirmed: true, barTimes: bars.map((b) => b.t),
    historyWindowBars: 5000 }
  try {
    const res = execute(program, ctx, undefined, pins === 'ledger' ? undefined : { brokerPinned: pins })
    return { res, program, bars, cols: res.outputs.map((o) => Array.from(o)), trades: res.broker.record.trades, used: res.broker.record.rulesUsed }
  } catch (e) { return { err: e } }
}
const served = (src, o) => {
  const r = attempt(src, o)
  expect(r.refused, JSON.stringify(r.refused)).toBeUndefined()
  expect(r.err, r.err && r.err.message).toBeUndefined()
  return r
}
const unsettled = (src, row, o) => {
  const r = attempt(src, o)
  expect(r.err, 'the run did not stop').toBeDefined()
  expect(r.err.guard).toBe('runtime:strategy-unsettled')
  expect(r.err.message).toContain(row)
  return r.err
}
const close12 = (a, b) => expect(a).toBeCloseTo(b, 9)
// an order call no bar reaches: the program holds a broker, and no fill is ever made
const NEVER = 'if bar_index == 100\n    strategy.entry("N", strategy.long)\n'

// every declaration value but the cost is the script's own, so B-DEFAULTS is asked only for a defaulted cost type
const DECL = (cost) => `//@version=5\nstrategy("t", initial_capital = 100000, default_qty_type = strategy.fixed, `
  + `default_qty_value = 2, pyramiding = 1, margin_long = 0, margin_short = 0${cost ? `, ${cost}` : ''})\n`
const ENTER = 'if bar_index == 1\n    strategy.entry("L", strategy.long)\n'
const CLOSE3 = 'if bar_index == 3\n    strategy.close("L")\n'
// p0 netprofit · p1 openprofit · p2 equity · p3 wintrades · p4 losstrades · p5 grossprofit · p6 grossloss
// p7 closedtrades.commission(0) · p8 closedtrades.profit(0) · p9 opentrades.commission(0)
const READS = 'var float cc = na\nvar float cp = na\nfloat oc = na\n'
  + 'if strategy.closedtrades > 0\n    cc := strategy.closedtrades.commission(0)\n    cp := strategy.closedtrades.profit(0)\n'
  + 'if strategy.opentrades > 0\n    oc := strategy.opentrades.commission(0)\n'
  + 'plot(strategy.netprofit)\nplot(strategy.openprofit)\nplot(strategy.equity)\nplot(strategy.wintrades)\n'
  + 'plot(strategy.losstrades)\nplot(strategy.grossprofit)\nplot(strategy.grossloss)\nplot(cc)\nplot(cp)\nplot(oc)\n'
const LONG_ROUND_TRIP = (cost) => `${DECL(cost)}${ENTER}${CLOSE3}${READS}`

describe('W9-T5 the commission types (W9-K1..K3): a fee at each fill; a trade\'s profit net of both', () => {
  it('[B-COMM-PCT] percent 0.1: entry 2 @ 100 pays 0.2, exit 2 @ 103.5 pays 0.207; profit 7 - 0.407 = 6.593', () => {
    // R6 `commission_type`: "a percentage of the cash volume of the order": 2 x 100 x 1 x 0.1 / 100 = 0.2;
    // 2 x 103.5 x 0.001 = 0.207. HYPOTHESIS (W9-K1): no rounding; the open trade's PAID entry fee comes off
    // its open profit and equity: bar 2 (close 101) openprofit 2 x 1 - 0.2 = 1.8, equity 100001.8;
    // bar 3 (close 103.5) openprofit 7 - 0.2 = 6.8.
    const { cols, trades, used } = served(LONG_ROUND_TRIP('commission_type = strategy.commission.percent, commission_value = 0.1'))
    expect(trades[0].entry).toEqual({ time: at(2), price: 100, rule: 'B-MARKET' })
    expect(trades[0].exit).toEqual({ time: at(4), price: 103.5, rule: 'B-CLOSE' })
    close12(trades[0].commission, 0.407)
    close12(cols[1][2], 1.8); close12(cols[2][2], 100001.8); close12(cols[9][2], 0.2)
    close12(cols[1][3], 6.8)
    close12(cols[0][4], 6.593); close12(cols[2][4], 100006.593); close12(cols[7][4], 0.407); close12(cols[8][4], 6.593)
    expect(cols[3][4]).toBe(1); expect(cols[4][4]).toBe(0)
    close12(cols[5][4], 6.593); expect(cols[6][4]).toBe(0)
    expect(used).toContain('B-COMM-PCT')
    expect(used).not.toContain('B-DEFAULTS') // the type is declared
  })
  it('[B-COMM-CONTRACT] 1.5 per contract: 3 at entry, 3 at exit; profit 7 - 6 = 1', () => {
    // 2 contracts x 1.5 = 3 per fill. bar 2: openprofit 2 - 3 = -1, equity 99999
    const { cols, trades, used } = served(LONG_ROUND_TRIP('commission_type = strategy.commission.cash_per_contract, commission_value = 1.5'))
    expect(trades[0].commission).toBe(6)
    expect(cols[1][2]).toBe(-1); expect(cols[2][2]).toBe(99999); expect(cols[9][2]).toBe(3)
    expect(cols[0][4]).toBe(1); expect(cols[8][4]).toBe(1); expect(cols[7][4]).toBe(6)
    expect(cols[3][4]).toBe(1)
    expect(used).toContain('B-COMM-CONTRACT')
  })
  it('[B-COMM-ORDER] 5 per order turns a 7-point win into a 3 loss: the SIGN is the net profit\'s', () => {
    // 5 at entry + 5 at exit = 10; 7 - 10 = -3. R6 `closedtrades.profit` is "reduced by the trade's
    // commissions", so the trade is a LOSS: wintrades 0, losstrades 1. HYPOTHESIS (W9-K3): the gross figures
    // sum net profits, so grossprofit 0 and grossloss 3.
    const { cols, trades } = served(LONG_ROUND_TRIP('commission_type = strategy.commission.cash_per_order, commission_value = 5'))
    expect(trades[0].commission).toBe(10)
    expect(cols[0][4]).toBe(-3); expect(cols[8][4]).toBe(-3)
    expect(cols[3][4]).toBe(0); expect(cols[4][4]).toBe(1)
    expect(cols[5][4]).toBe(0); expect(cols[6][4]).toBe(3)
    expect(cols[1][2]).toBe(-3) // 2 x (101 - 100) - 5
  })
  it('a percent commission on a reversal: one fill, each trade pays its share at the one price', () => {
    // long 2 @ 100 (fee 0.2); a short entry placed on bar 3 fills at bar 4's open 103.5: it closes the long
    // (exit fee 2 x 103.5 x 0.001 = 0.207) and opens short 2 (entry fee 0.207)
    const src = `${DECL('commission_type = strategy.commission.percent, commission_value = 0.1')}${ENTER}`
      + 'if bar_index == 3\n    strategy.entry("S", strategy.short)\n' + READS
    const { cols, trades } = served(src)
    expect(trades[0].exit.price).toBe(103.5)
    close12(trades[0].commission, 0.407)
    close12(trades[1].commission, 0.207)
    expect(trades[1].exit).toBeUndefined()
    close12(cols[9][4], 0.207)
    // bar 4 close 104: the short is 2 x (103.5 - 104) = -1 open, less its 0.207 entry fee
    close12(cols[1][4], -1.207)
  })
  it('a per-order commission on ONE order that fills two trades refuses by name (W9-K3): a reversal, a close of two', () => {
    const rev = `${DECL('commission_type = strategy.commission.cash_per_order, commission_value = 5')}${ENTER}`
      + 'if bar_index == 3\n    strategy.entry("S", strategy.short)\nplot(strategy.position_size)\n'
    expect(unsettled(rev, 'W9-K3').message).toMatch(/divides the fee/)
    const two = DECL('commission_type = strategy.commission.cash_per_order, commission_value = 5').replace('pyramiding = 1', 'pyramiding = 2')
      + 'if bar_index == 1 or bar_index == 2\n    strategy.entry("L", strategy.long)\n' + CLOSE3 + 'plot(strategy.position_size)\n'
    unsettled(two, 'W9-K3')
    // a percent or per-contract fee is linear in size, so the same two cases are served
    served(two.replace('cash_per_order, commission_value = 5', 'cash_per_contract, commission_value = 1'))
  })
  it('[B-COMM-PCT] the cash volume includes the point value: pointvalue 50 (a future) makes the fee 50 times larger', () => {
    // r1 (review U2): every other fixture has pointvalue 1, where dropping it changes nothing.
    // Entry 2 @ 100: 2 x 100 x 50 x 0.1 / 100 = 10; exit 2 @ 103.5: 2 x 103.5 x 50 x 0.001 = 10.35; total 20.35.
    // Gross 2 x 3.5 x 50 = 350, so the net profit is 350 - 20.35 = 329.65.
    const O = [100, 100, 103.5]; const H = [101, 101, 104]; const L = [99, 99, 103]; const C = [100, 100, 103.5]
    const cfg = { version: 5, pyramiding: 1, defaultQty: 2, qtyType: 'fixed', qtyValue: 2, initialCapital: 100000,
      marginLong: 0, marginShort: 0, defaulted: {}, commission: { type: 'percent', value: 0.1, typeDefaulted: false } }
    const b = makeBroker(cfg, { series: [O, H, L, C], barTimes: [at(0), at(1), at(2)], isPinned: ALL })
    b.call('#symbol', [0.01, 50], 0)
    b.call('strategy.entry', ['L', 1, 2], 0)
    while (b.beginBar(1)) { /* no extra executions */ }
    b.call('strategy.close', ['L'], 1)
    while (b.beginBar(2)) { /* no extra executions */ }
    close12(b.call('strategy.closedtrades.commission', [0], 2), 20.35)
    close12(b.call('strategy.netprofit', [], 2), 329.65)
    close12(b.call('strategy.closedtrades.profit', [0], 2), 329.65)
  })
  it('the commission is asked when a fill pays it: a run that never fills asks no cost rule', () => {
    const src = `${DECL('commission_type = strategy.commission.percent, commission_value = 0.1')}${NEVER}plot(strategy.position_size)\n`
    const { used } = served(src)
    for (const r of T5_RULES) expect(used).not.toContain(r)
  })
})

describe('W9-T5 slippage (W9-K4): market fills only', () => {
  const SLIP = (extra = '') => DECL(`slippage = 3${extra}`)
  it('[B-SLIPPAGE] 3 ticks: a long enters at 100.03 and its close sells at 103.47', () => {
    // R6 `slippage`: "a long market order will enter at 5 * 0.01 = 0.05 points above the actual price";
    // 3 x 0.01: entry 100 + 0.03, exit (a sell) 103.5 - 0.03. Profit 2 x 3.44 = 6.88
    const { cols, trades, used } = served(`${SLIP()}${ENTER}${CLOSE3}plot(strategy.position_avg_price)\nplot(strategy.netprofit)\n`)
    expect(trades[0].entry).toEqual({ time: at(2), price: 100.03, rule: 'B-MARKET' })
    expect(trades[0].exit).toEqual({ time: at(4), price: 103.47, rule: 'B-CLOSE' })
    expect(cols[0][2]).toBe(100.03)
    close12(cols[1][4], 6.88)
    expect(trades[0].commission).toBe(0)
    expect(used).toContain('B-SLIPPAGE')
  })
  it('a short enters lower and buys back higher', () => {
    const { trades } = served(`${SLIP()}if bar_index == 1\n    strategy.entry("S", strategy.short)\n`
      + 'if bar_index == 3\n    strategy.close("S")\nplot(strategy.position_size)\n')
    expect(trades[0].entry.price).toBe(99.97)
    expect(trades[0].exit.price).toBe(103.53)
  })
  it('HYPOTHESIS (W9-K4): a reversal closes and opens at the one slipped price', () => {
    const { trades } = served(`${SLIP()}${ENTER}if bar_index == 3\n    strategy.entry("S", strategy.short)\nplot(strategy.position_size)\n`)
    expect(trades[0].exit.price).toBe(103.47)
    expect(trades[1].entry.price).toBe(103.47)
  })
  // ⛔ r1 (review W9-T5 B1): R6 slips "market/stop orders", the User Manual "_all_ order fills". Where the two
  // disagree the rule is unsettled (spec line 7), so a LIMIT fill under a slippage refuses by name, W9-K4,
  // quoting both, under EVERY pin set: it must never be served unslipped once S1's core is pinned.
  const LIMITS = `${SLIP()}if bar_index == 1\n    strategy.entry("L", strategy.long, limit = 99.8)\n`
    + '    strategy.exit("x", "L", limit = 101.2)\nplot(strategy.position_size)\n'
  const S1_ONLY = new Set(BROKER_RULE_IDS.slice(0, 22))
  it('a limit entry under a slippage refuses by name (W9-K4), quoting the reference and the manual', () => {
    // bar 2: 100 -> 99.5 crosses the limit 99.8: the entry's fill is where it stops
    const e = unsettled(LIMITS, 'W9-K4')
    expect(e.message).toMatch(/the limit entry `L` \(a limit order\)/)
    expect(e.message).toContain('"market/stop orders"')
    expect(e.message).toContain('"the strategy applies constant slippage to _all_ order fills"')
  })
  it('a take-profit under a slippage refuses by name (W9-K4)', () => {
    // a market entry (100.03 on bar 2), then its limit exit at 101.2 is reached on bar 2's rise to 101.5
    const e = unsettled(`${SLIP()}${ENTER}    strategy.exit("x", "L", limit = 101.2)\nplot(strategy.position_size)\n`, 'W9-K4')
    expect(e.message).toMatch(/the take-profit of exit `x` \(a limit order\)/)
  })
  it('S1\'s 22 pins only (the core pinned, nothing of T5): the limit fills still refuse, never served unslipped', () => {
    expect(S1_ONLY.has('B-SLIPPAGE')).toBe(false)
    expect(S1_ONLY.has('B-PATH')).toBe(true)
    const r = attempt(LIMITS, { pins: (id) => S1_ONLY.has(id) })
    expect(r.err && r.err.guard).toBe('runtime:strategy-unsettled')
    expect(r.err.message).toContain('W9-K4')
    // the same script without the slippage serves under those pins (the refusal is the slippage's alone)
    const plain = attempt(LIMITS.replace('slippage = 3', 'slippage = 0'), { pins: (id) => S1_ONLY.has(id) })
    expect(plain.err, plain.err && plain.err.message).toBeUndefined()
    expect(plain.trades[0].entry.price).toBe(99.8)
  })
  it('a market fill at a price OFF the tick grid under a slippage refuses by name (W9-K4), not slipped', () => {
    // bar 2 opens at 100.005 (off the 0.01 grid): whether TradingView slips before or after rounding is not stated
    const bars = barsOf([...HEAD.slice(0, 2), [100.005, 101.5, 99.5, 101], HEAD[3], [103.5, 105, 102.5, 104], ...FILL(5, [104, 105, 103.5, 104.5])])
    const e = unsettled(`${SLIP()}${ENTER}${CLOSE3}plot(strategy.position_size)\n`, 'W9-K4', { bars })
    expect(e.message).toMatch(/off the tick grid/)
  })
  it('a stop entry and a stop-loss under slippage refuse by name (W9-K4 fills market orders only)', () => {
    unsettled(`${SLIP()}if bar_index == 1\n    strategy.entry("L", strategy.long, stop = 101)\nplot(strategy.position_size)\n`, 'W9-K4')
    const e = unsettled(`${SLIP()}${ENTER}    strategy.exit("x", "L", stop = 99.6)\nplot(strategy.position_size)\n`, 'W9-K4')
    expect(e.message).toMatch(/stop-loss/)
  })
  it('a market entry dropped at the pyramiding limit asks no slippage', () => {
    // pyramiding 1: the second entry (bar 2) meets an open trade and does not execute
    const { used, trades } = served(`${SLIP()}if bar_index == 1 or bar_index == 2\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n`)
    expect(trades).toHaveLength(1)
    expect(used).toContain('B-SLIPPAGE') // the first one filled
    const none = served(`${SLIP()}${NEVER}plot(strategy.position_size)\n`)
    expect(none.used).not.toContain('B-SLIPPAGE')
  })
})

describe('W9-T5 r2: the tick grid under slippage, for ticks that do not divide 1 and for very small ones', () => {
  // A market entry placed on bar 0 fills at bar 1's open `px`, slipped 2 ticks against the strategy (a buy up,
  // a sell down). r1 assumed 1 / mintick was a whole number and refused tick 5 at 4200 and tick 0.3 at 99.9 as
  // "off the grid". The grid is now k = round(px / tick) within a relative tolerance.
  const fillAt = (tick, px, dir) => {
    const O = [px, px]; const H = [px + 10 * tick, px + 10 * tick]; const L = [px - 10 * tick, px - 10 * tick]; const C = [px, px]
    const cfg = { version: 5, pyramiding: 1, defaultQty: 1, qtyType: 'fixed', qtyValue: 1, initialCapital: 1e9,
      marginLong: 0, marginShort: 0, defaulted: {}, slippage: 2 }
    const b = makeBroker(cfg, { series: [O, H, L, C], barTimes: [at(0), at(1)], isPinned: ALL })
    b.call('#symbol', [tick, 1], 0)
    b.call('strategy.entry', ['L', dir, 1], 0)
    while (b.beginBar(1)) { /* no extra executions */ }
    return b.call('strategy.opentrades.entry_price', [0], 1)
  }
  for (const [tick, px, up, down] of [
    [5, 4200, 4210, 4190], [10, 4210, 4230, 4190], [0.3, 99.9, 100.5, 99.3], [0.25, 100.25, 100.75, 99.75],
    [1 / 64, 100 + 3 / 64, 100 + 5 / 64, 100 + 1 / 64], [0.00001, 1.23457, 1.23459, 1.23455],
    // 7 x 0.1 and 3 x 0.1 are not 0.7 and 0.3 in binary: the price is written at the tick's decimals
    [0.1, 0.5, 0.7, 0.3],
    // a satoshi tick: String(1e-8) is "1e-8", so the decimals come from the exponent
    [1e-8, 0.00012345, 0.00012347, 0.00012343],
  ]) {
    it(`tick ${tick}: ${px} is on the grid; a long fills at ${up}, a short at ${down}; ${px} + tick / 3 refuses (W9-K4)`, () => {
      expect(fillAt(tick, px, 1)).toBe(up)
      expect(fillAt(tick, px, -1)).toBe(down)
      let err
      try { fillAt(tick, px + tick / 3, 1) } catch (e) { err = e }
      expect(err && err.guard).toBe('runtime:strategy-unsettled')
      expect(err.message).toMatch(/off the tick grid/)
      expect(err.message).toContain('W9-K4')
    })
  }
})

describe('W9-T5 costs at the close under process_orders_on_close (W9-P1, B-POC-COST)', () => {
  const POC = (cost) => DECL(`process_orders_on_close = true, ${cost}`)
  it('HYPOTHESIS (W9-P1): a POC market fill takes its slippage from the close and pays its fee there', () => {
    // entry placed on bar 1 fills at bar 1's close 100 + 0.03; the close placed on bar 3 at 103.5 - 0.03
    const { trades, used } = served(`${POC('slippage = 3')}${ENTER}${CLOSE3}plot(strategy.position_size)\n`)
    expect(trades[0].entry).toEqual({ time: at(1), price: 100.03, rule: 'B-POC' })
    expect(trades[0].exit).toEqual({ time: at(3), price: 103.47, rule: 'B-POC' })
    expect(used).toEqual(expect.arrayContaining(['B-POC', 'B-POC-COST', 'B-SLIPPAGE']))
    const c = served(`${POC('commission_type = strategy.commission.cash_per_contract, commission_value = 1')}${ENTER}${CLOSE3}plot(strategy.position_size)\n`)
    expect(c.trades[0].commission).toBe(4)
    expect(c.used).toContain('B-POC-COST')
    const e = attempt(`${POC('slippage = 3')}${ENTER}${CLOSE3}plot(strategy.position_size)\n`, { pins: except('B-POC-COST') }).err
    expect(e && e.rule).toBe('B-POC-COST')
    expect(e.message).toContain('W9-P1')
  })
  it('without a cost a POC run never asks B-POC-COST', () => {
    const { used } = served(`${DECL('process_orders_on_close = true')}${ENTER}${CLOSE3}plot(strategy.position_size)\n`)
    expect(used).not.toContain('B-POC-COST')
  })
})

describe('W9-T5 named refusals beside the hypotheses', () => {
  it('a T7 order kind with a cost refuses at its call (no capture combines them)', () => {
    unsettled(`${DECL('commission_type = strategy.commission.percent, commission_value = 0.1')}if bar_index == 1\n`
      + '    strategy.order("L", strategy.long, qty = 1)\nplot(strategy.position_size)\n', 'W9-K1')
    unsettled(`${DECL('slippage = 1')}${ENTER}    strategy.exit("x", "L", trail_points = 200, trail_offset = 100)\n`
      + 'plot(strategy.position_size)\n', 'W9-K4')
    unsettled(`${DECL('commission_type = strategy.commission.cash_per_order, commission_value = 1')}${ENTER}`
      + 'if bar_index == 3\n    strategy.close("L", qty = 1)\nplot(strategy.position_size)\n', 'W9-K3')
  })
  it('a cash / percent default size with a cost refuses by name (whether the size allows for it is not stated)', () => {
    const src = '//@version=5\nstrategy("t", initial_capital = 100000, default_qty_type = strategy.cash, '
      + 'default_qty_value = 1000, pyramiding = 1, margin_long = 0, margin_short = 0, commission_type = '
      + 'strategy.commission.cash_per_contract, commission_value = 1)\n' + ENTER + 'plot(strategy.position_size)\n'
    expect(unsettled(src, 'W9-K2').message).toMatch(/allows for it/)
    unsettled(src.replace('commission_type = strategy.commission.cash_per_contract, commission_value = 1', 'slippage = 2'), 'W9-K4')
  })
  it('a cost on an extra execution\'s fill (calc_on_order_fills) refuses by name (W9-P2)', () => {
    // the entry fills at bar 2's open; that fill runs the script there (B-FILLS), which places a close that
    // fills at the next path vertex, 99.5: a fill on an extra execution's tick
    const src = `${DECL('calc_on_order_fills = true, commission_type = strategy.commission.cash_per_contract, commission_value = 1')}`
      + `${ENTER}if strategy.position_size > 0 and bar_index == 2\n    strategy.close("L")\nplot(strategy.position_size)\n`
    const e = unsettled(src, 'W9-P2')
    expect(e.message).toMatch(/calc_on_order_fills/)
  })
  it('build: a negative commission, a fractional slippage, an unreadable type with a non-zero value refuse at build', () => {
    for (const [cost, what] of [['commission_value = -1', 'commission_value'], ['slippage = 1.5', 'slippage'],
      ['commission_value = 1, commission_type = "x"', 'commission_type']]) {
      const r = attempt(`${DECL(cost)}${NEVER}plot(strategy.position_size)\n`)
      expect(r.refused && r.refused.guard, cost).toBe('runtime:strategy-option')
      expect(r.refused.message).toContain(what)
    }
    // an unreadable type with a ZERO value is read past, exactly as before W9-T5
    served(`${DECL('commission_value = 0, commission_type = "x"')}${NEVER}plot(strategy.position_size)\n`)
  })
})

describe('W9-T5 the default (no-cost) path is the pre-T5 path', () => {
  const S = `${DECL('')}${ENTER}${CLOSE3}${READS}`
  it('declaring commission 0 and slippage 0 changes nothing, and asks no T5 rule', () => {
    const base = served(S)
    const zero = served(S.replace('margin_short = 0)', 'margin_short = 0, commission_type = strategy.commission.cash_per_order, commission_value = 0, slippage = 0)'))
    expect(zero.cols).toEqual(base.cols)
    expect(zero.trades).toEqual(base.trades)
    expect(zero.used).toEqual(base.used)
    for (const r of T5_RULES) expect(base.used).not.toContain(r)
    expect(base.trades[0].commission).toBe(0)
    // the net figures still rest on COMMISSION_RULE (B-DEFAULTS), as before W9-T5
    expect(base.used).toContain(COMMISSION_RULE)
  })
  it('the zero-cost figures are the gross ones, bit for bit: net 7, profit 7, commission 0', () => {
    const { cols } = served(S)
    expect(cols[0][4]).toBe(7); expect(cols[8][4]).toBe(7); expect(cols[7][4]).toBe(0); expect(cols[2][4]).toBe(100007)
  })
})

describe('W9-T5 ONE commission authority (`commissionRulesOf`)', () => {
  it('a zero commission rests on COMMISSION_RULE alone; a non-zero one on its type, plus B-DEFAULTS when the type is defaulted', () => {
    expect(commissionRulesOf(undefined)).toEqual(['B-DEFAULTS'])
    expect(commissionRulesOf({ type: 'cash_per_order', value: 0, typeDefaulted: false })).toEqual(['B-DEFAULTS'])
    expect(commissionRulesOf({ type: 'percent', value: 0.1, typeDefaulted: false })).toEqual(['B-COMM-PCT'])
    expect(commissionRulesOf({ type: 'percent', value: 0.1, typeDefaulted: true })).toEqual(['B-COMM-PCT', 'B-DEFAULTS'])
    expect(commissionRulesOf({ type: 'cash_per_contract', value: 1, typeDefaulted: false })).toEqual(['B-COMM-CONTRACT'])
    expect(commissionRulesOf({ type: 'cash_per_order', value: 1, typeDefaulted: false })).toEqual(['B-COMM-ORDER'])
    expect(Object.values(COMMISSION_TYPE_RULES).sort()).toEqual(['B-COMM-CONTRACT', 'B-COMM-ORDER', 'B-COMM-PCT'])
  })
  it('a commission whose TYPE is defaulted (R6: "The default is strategy.commission.percent") asks B-DEFAULTS', () => {
    const src = LONG_ROUND_TRIP('commission_value = 0.1')
    const full = served(src)
    expect(full.used).toEqual(expect.arrayContaining(['B-COMM-PCT', 'B-DEFAULTS']))
    const e = attempt(src, { pins: except('B-DEFAULTS') }).err
    expect(e && e.rule).toBe('B-DEFAULTS')
  })
})

describe('W9-T5 the record and the report', () => {
  const recOf = (r) => strategyRecordOf({ summary: r.res.broker, decl: r.program.broker, barTimes: r.bars.map((b) => b.t),
    historyWindowBars: 5000, confirmed: true })
  it('the record carries the costs and each trade\'s fees; the report nets them and serves commission paid', () => {
    const r = served(LONG_ROUND_TRIP('commission_type = strategy.commission.cash_per_contract, commission_value = 1.5'))
    const rec = recOf(r)
    expect(strategyRecordShapeErrors(rec)).toEqual([])
    expect(rec.settings.commission).toEqual({ type: 'cash_per_contract', value: 1.5, typeDefaulted: false })
    expect(rec.settings.slippage).toBe(0)
    expect(rec.trades[0].commission).toBe(6)
    const rep = strategyReportOf(rec, { isPinned: ALL })
    // the report and the broker's own plotted strategy.netprofit agree (one arithmetic)
    expect(rep.metrics.netProfit.value).toBe(r.cols[0][9])
    expect(rep.metrics.netProfit.value).toBe(1)
    expect(rep.metrics.commissionPaid, JSON.stringify(rep.metrics.commissionPaid)).toMatchObject({ status: 'served', value: 6 })
    expect(rep.trades.rows[0].profit.value).toBe(1)
    // unpinned: every metric that reads a commission names the type's rule and its row
    const un = strategyReportOf(rec, { isPinned: except('B-COMM-CONTRACT') })
    expect(un.metrics.netProfit).toMatchObject({ rule: 'B-COMM-CONTRACT', row: 'W9-K2' })
    expect(un.metrics.commissionPaid).toMatchObject({ rule: 'B-COMM-CONTRACT' })
    // the run's fills asked it (`rulesUsed`), so the counts and the trade list rest on it too (T13a: a report
    // rests on every rule the run used, never a partial list)
    expect(un.metrics.totalClosedTrades).toMatchObject({ rule: 'B-COMM-CONTRACT' })
    expect(un.trades).toMatchObject({ status: 'refused', rule: 'B-COMM-CONTRACT' })
    // a record whose run used no commission rule (no fill paid one) still rests its money figures on the type's
    // rule: the report asks `commissionRulesOf(settings.commission)` itself, not only `rulesUsed`
    const bare = { ...rec, rulesUsed: rec.rulesUsed.filter((r) => r !== 'B-COMM-CONTRACT') }
    const b = strategyReportOf(bare, { isPinned: except('B-COMM-CONTRACT') })
    expect(b.metrics.totalClosedTrades.status).toBe('served')
    expect(b.metrics.netProfit).toMatchObject({ rule: 'B-COMM-CONTRACT', row: 'W9-K2' })
  })
  it('the per-order sign flip reaches the report: the 7-point trade is a loss there too', () => {
    const r = served(LONG_ROUND_TRIP('commission_type = strategy.commission.cash_per_order, commission_value = 5'))
    const rep = strategyReportOf(recOf(r), { isPinned: ALL })
    expect(rep.metrics.numberLosingTrades.value).toBe(1)
    expect(rep.metrics.numberWinningTrades.value).toBe(0)
    expect(rep.metrics.grossLoss.value).toBe(3)
  })
  it('commission paid refuses by name while an open trade has paid an entry fee (W9-S1)', () => {
    const r = served(`${DECL('commission_type = strategy.commission.cash_per_contract, commission_value = 1')}${ENTER}plot(strategy.position_size)\n`)
    const rep = strategyReportOf(recOf(r), { isPinned: ALL })
    expect(rep.metrics.commissionPaid).toMatchObject({ status: 'refused', guard: REPORT_UNSTATED_GUARD, row: 'W9-S1' })
  })
})

describe('W9-T5 pin before serve (D1): nothing T5 adds serves without its own pin', () => {
  afterEach(() => registerStrategyBrokerGate(() => false))
  const SAMPLES = {
    'B-COMM-PCT': LONG_ROUND_TRIP('commission_type = strategy.commission.percent, commission_value = 0.1'),
    'B-COMM-CONTRACT': LONG_ROUND_TRIP('commission_type = strategy.commission.cash_per_contract, commission_value = 1.5'),
    'B-COMM-ORDER': LONG_ROUND_TRIP('commission_type = strategy.commission.cash_per_order, commission_value = 5'),
    'B-SLIPPAGE': `${DECL('slippage = 3')}${ENTER}${CLOSE3}plot(strategy.position_size)\n`,
    'B-POC-COST': `${DECL('process_orders_on_close = true, slippage = 3')}${ENTER}${CLOSE3}plot(strategy.position_size)\n`,
  }
  it('each T5 rule is named, with the capture row the design gives it, and the ledger pins none', () => {
    expect(T5_RULES.map((r) => BROKER_RULES[r].capture)).toEqual(['W9-K1', 'W9-K2', 'W9-K3', 'W9-K4', 'W9-P1'])
    for (const r of T5_RULES) expect(Object.keys(RESOLVED.rules)).not.toContain(r)
  })
  for (const rule of T5_RULES) {
    const src = SAMPLES[rule]
    it(`${rule}: served with every rule pinned, and stops naming ${rule} (and its row) when only it is unpinned`, () => {
      const full = attempt(src)
      expect(full.err, full.err && full.err.message).toBeUndefined()
      expect(full.used).toContain(rule)
      const { err } = attempt(src, { pins: except(rule) })
      expect(err && err.guard).toBe('runtime:strategy-unpinned')
      expect(err.rule).toBe(rule)
      expect(err.message).toContain(BROKER_RULES[rule].capture)
    })
    it(`${rule}: on the committed ledger the run refuses runtime:strategy-unpinned`, () => {
      const { err } = attempt(src, { pins: 'ledger' })
      expect(err && err.guard).toBe('runtime:strategy-unpinned')
      expect(BROKER_RULE_IDS).toContain(err.rule)
    })
    it(`${rule}: the member door (gate on, committed ledger) refuses by name`, () => {
      registerStrategyBrokerGate(() => true)
      const doc = { id: `w9t5-${rule}`, meta: { runtimeHistory: 'strategy-window' },
        compute: { kind: 'runtime', fn: `runtime:w9t5-${rule}`, outputs: { p: 0 }, source: src } }
      let err
      try { computeRuntimeColumns(doc, A, { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: SYMBOL, historyWindowBars: 30 }) } catch (e) { err = e }
      expect(err && err.guard).toBe('runtime:strategy-unpinned')
      expect(err.message).toMatch(/is not pinned by a matching TradingView capture/)
    })
  }
  it('the D7 scorecard stays derived: 0 of every named rule (the size is pinned once, strategiesAreRuled.test.js)', () => {
    for (const r of T5_RULES) expect(BROKER_RULE_IDS).toContain(r)
    expect(strategyScorecardWording()).toMatch(new RegExp(`^0 of ${BROKER_RULE_IDS.length} broker rules are pinned`))
  })
})
