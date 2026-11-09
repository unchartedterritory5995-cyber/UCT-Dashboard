// W9-T7 rails: the exit family and the other order kinds (trailing stops, partial and multi-level
// exits, partial close, OCA, strategy.order, immediately, stop-limit, the v5/v6 exit-level rule).
//
// ⛔ EVERY RULE HERE IS UNPINNED (ruling D1). The committed ledger pins none of B-TRAIL, B-EXIT-QTY,
// B-CLOSE-QTY, B-OCA, B-ORDER, B-IMMEDIATELY, B-STOP-LIMIT or B-EXIT-LEVELS, so on the member door every
// script below refuses `runtime:strategy-unpinned` by name. The behaviour rails run through the
// TEST-ONLY pin predicate (`execute(..., { brokerPinned })`, the path the W9-T1 and T4 rails use) on
// hand-built bars. Every expected number is worked by hand in the comment beside it from the rule the
// broker states (`broker.js`, `docs/pine/strategy-broker-spec.md`), and where that rule is a HYPOTHESIS
// the comment says so: a W9-X1..X4 / Q-S1j / Q-S1k capture that disagrees moves the hypothesis, never
// these numbers silently.
//
// Bars: mintick 0.01, pointvalue 1 (NYSE:RDDT). The intrabar path is B-PATH: open -> the NEARER extreme
// -> the other -> close; every bar below states which extreme is nearer.
import { describe, it, expect, afterEach } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { BROKER_RULE_IDS, BROKER_RULES } from '../brokerRules.js'
import RESOLVED from '../brokerPins.resolved.json'
import { strategyScorecardWording } from '../../ast/strategyScorecard.js'
import { computeRuntimeColumns } from '../runtimeColumns.js'
import { registerStrategyBrokerGate } from '../../strategyBrokerGateRegistry.js'

const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE' }
const T0 = 1700000000
const DAY = 86400
const barsOf = (rows) => rows.map(([o, h, l, c], i) => ({ t: T0 + i * DAY, o, h, l, c, v: 1000 }))
const ALL = () => true
const T7_RULES = ['B-TRAIL', 'B-EXIT-QTY', 'B-CLOSE-QTY', 'B-OCA', 'B-ORDER', 'B-IMMEDIATELY', 'B-STOP-LIMIT', 'B-EXIT-LEVELS']

// The common head: bars 0-1 flat; bar 2 opens 100 (an order placed on bar 1 fills there).
//   2: 100 / 101.5 / 99.5 / 101   low nearer (0.5 < 1.5): 100 -> 99.5 -> 101.5 -> 101
//   3: 101 / 104 / 100.5 / 103.5  low nearer (0.5 < 3):   101 -> 100.5 -> 104 -> 103.5
//   4: 103.5 / 105 / 102.5 / 104  low nearer (1 < 1.5):   103.5 -> 102.5 -> 105 -> 104
const HEAD = [[100, 101, 99, 100], [100, 101, 99, 100], [100, 101.5, 99.5, 101], [101, 104, 100.5, 103.5]]
const FILL = (n, row) => Array.from({ length: n }, () => row)
const A = barsOf([...HEAD, [103.5, 105, 102.5, 104], ...FILL(5, [104, 105, 103.5, 104.5])])

const attempt = (src, { bars = A, pins = ALL } = {}) => {
  const built = buildRuntimeIr(src, { bars, inputs: {}, symbol: SYMBOL, strategyBroker: true })
  if (!built.ok) return { refused: built.refusal }
  const program = lowerIrProgram(built.ir, { historyFromListing: true })
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const ctx = { bars: bars.length, series, columns: program.columns, confirmed: true, barTimes: bars.map((b) => b.t),
    historyWindowBars: 5000 }
  try {
    const res = execute(program, ctx, undefined, pins === 'ledger' ? undefined : { brokerPinned: pins })
    return { res, cols: res.outputs.map((o) => Array.from(o)), trades: res.broker.record.trades, used: res.broker.record.rulesUsed }
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
const V5 = '//@version=5\nstrategy("t")\n'
const at = (i) => T0 + i * DAY
const ENTER = 'if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1)\n'

describe('W9-T7 [B-TRAIL] trailing stops (W9-X1; hypothesis: the best follows the B-PATH extremes)', () => {
  // entry 100 on bar 2; activation 200 ticks = 102.00; offset 100 ticks = 1.00
  const TRAIL = `${V5}${ENTER}    strategy.exit("x", "L", trail_points = 200, trail_offset = 100)\nplot(strategy.position_size)\n`
  it('activates on the path, ratchets to the bar high, fills on the next fall through best - offset', () => {
    // bar 2: 100 -> 99.5 -> 101.5 -> 101: never reaches 102
    // bar 3: 101 -> 100.5 -> 104 crosses 102: active, best 102 -> 104 at the segment end; -> 103.5 > 103
    // bar 4: opens 103.5 (> 103, no gap fill); -> 102.5 crosses 103: filled at 103
    const { cols, trades, used } = served(TRAIL)
    expect(cols[0].slice(1, 6)).toEqual([0, 1, 1, 0, 0])
    expect(trades).toHaveLength(1)
    expect(trades[0].entry).toEqual({ time: at(2), price: 100, rule: 'B-MARKET' })
    expect(trades[0].exit).toEqual({ time: at(4), price: 103, rule: 'B-TRAIL' })
    expect(used).toContain('B-TRAIL')
  })
  it('a new high inside the bar moves the stop, and the fall to the close fills it on the same bar', () => {
    // bar 4: 104 / 107 / 103.9 / 105, low nearer: 104 -> 103.9 (stop 103 not hit) -> 107 (best 107) -> 105
    // crosses 106: filled at 106 on bar 4
    const bars = barsOf([...HEAD, [104, 107, 103.9, 105], ...FILL(4, [105, 106, 104.5, 105.5])])
    const { trades } = served(TRAIL, { bars })
    expect(trades[0].exit).toEqual({ time: at(4), price: 106, rule: 'B-TRAIL' })
  })
  it('activated by a gap: the best starts at the open; a later gap below the stop fills at that open', () => {
    // bar 3 opens 102.5 > 102: active at the open, best 102.5; 102.5 / 103 / 102.2 / 102.8, low nearer:
    //   -> 102.2 (stop 101.5 not hit) -> 103 (best 103, stop 102) -> 102.8
    // bar 4 opens 101.8 < 102: filled at the open, 101.8 (B-GAP's rule for a level crossed between bars)
    const bars = barsOf([...HEAD.slice(0, 3), [102.5, 103, 102.2, 102.8], [101.8, 102.6, 101.6, 102], ...FILL(3, [102, 103, 101.5, 102.5])])
    const { trades } = served(TRAIL, { bars })
    expect(trades[0].exit).toEqual({ time: at(4), price: 101.8, rule: 'B-TRAIL' })
  })
  it('an active trail\'s best moves to a gap-up open before the bar\'s path is walked', () => {
    // active since bar 3 with best 104 (stop 103). Bar 4 gaps up: 106 / 108 / 104.5 / 105, low nearer
    // (1.5 < 2): the open sets best 106 (stop 105), then 106 -> 104.5 crosses 105: filled at 105.
    // (Had the open not moved the best, the fall would miss 103 and the stop would fill at 107.)
    const bars = barsOf([...HEAD, [106, 108, 104.5, 105], ...FILL(4, [105, 106, 104.5, 105.5])])
    const { trades } = served(TRAIL, { bars })
    expect(trades[0].exit).toEqual({ time: at(4), price: 105, rule: 'B-TRAIL' })
  })
  it('trail_price is an absolute activation level', () => {
    const { trades } = served(`${V5}${ENTER}    strategy.exit("x", "L", trail_price = 102, trail_offset = 100)\nplot(strategy.position_size)\n`)
    expect(trades[0].exit).toEqual({ time: at(4), price: 103, rule: 'B-TRAIL' })
  })
  it('a take-profit beside the trail: the first reached wins (one command, B-EXIT-BIND)', () => {
    // limit 103.8 is reached on bar 3's rise (100.5 -> 104) before any trailing stop could fill
    const { trades } = served(`${V5}${ENTER}    strategy.exit("x", "L", limit = 103.8, trail_points = 200, trail_offset = 100)\nplot(strategy.position_size)\n`)
    expect(trades[0].exit.price).toBe(103.8)
    expect(trades[0].exit.time).toBe(at(3))
  })
  const refusedTrail = [
    ['half a trailing stop (no offset)', 'trail_points = 200'],
    ['both trail_price and trail_points', 'trail_price = 102, trail_points = 200, trail_offset = 100'],
    ['a stop-loss beside the trail', 'stop = 95, trail_points = 200, trail_offset = 100'],
    ['an offset that is not a positive whole number of ticks', 'trail_points = 200, trail_offset = 0'],
    ['an activation not beyond the entry price', 'trail_price = 99, trail_offset = 100'],
    ['a negative trail_points (activated at once)', 'trail_points = -50, trail_offset = 100'],
  ]
  for (const [what, args] of refusedTrail) {
    it(`refuses by name (W9-X1): ${what}`, () => {
      unsettled(`${V5}${ENTER}    strategy.exit("x", "L", ${args})\nplot(strategy.position_size)\n`, 'W9-X1')
    })
  }
})

describe('W9-T7 [B-EXIT-QTY] partial and multi-level exits (W9-X2; hypothesis: call-order reservation)', () => {
  // qty 4 at 100 on bar 2. tp1 50% (2 units) at 101.2, tp2 the rest at 103.
  const LEGS = '    strategy.exit("tp1", "L", qty_percent = 50, limit = 101.2)\n    strategy.exit("tp2", "L", limit = 103)\n'
  const PLOTS = 'plot(strategy.position_size)\nplot(strategy.netprofit)\nplot(strategy.closedtrades)\n'
  const ONCE = `${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 4)\n${LEGS}${PLOTS}`
  const EVERY = `${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 4)\nif bar_index >= 1\n${LEGS}${PLOTS}`
  for (const [name, src] of [['called once, before the entry fills', ONCE], ['called on every bar', EVERY]]) {
    it(`two levels: half at 101.2 on bar 2, the rest at 103 on bar 3 (${name})`, () => {
      // bar 2 rises 99.5 -> 101.5 through 101.2: tp1 closes its 2. bar 3 rises 100.5 -> 104 through 103:
      // tp2 (reserved 4 - 2 = 2) closes the rest. netprofit 2 x 1.2 + 2 x 3 = 8.4.
      // Called every bar, tp1 is not re-applied to the trade it already exited (R4 "exits a position only once").
      const { cols, trades } = served(src)
      const [size, net, closedN] = cols
      expect(size.slice(1, 5)).toEqual([0, 2, 0, 0])
      expect(closedN[4]).toBe(2)
      expect(net[4]).toBeCloseTo(8.4, 9)
      expect(trades.map((t) => [t.qty, t.exit.price, t.exit.time, t.exit.rule]))
        .toEqual([[2, 101.2, at(2), 'B-EXIT-QTY'], [2, 103, at(3), 'B-PATH']])
    })
  }
  it('a second full exit on the same trade reserves nothing: its stop never fills (the reference\'s 50 / 20 / 30)', () => {
    // x1 (limit 103) reserves the whole trade; x2 (stop 99.6) can close 4 - 4 = 0. Bar 2 falls to 99.5
    // through 99.6, and nothing fills; bar 3 reaches 103: x1 closes the trade at 103.
    const src = `${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 4)\n`
      + '    strategy.exit("x1", "L", limit = 103)\n    strategy.exit("x2", "L", stop = 99.6)\nplot(strategy.position_size)\n'
    const { trades, used } = served(src)
    expect(trades.map((t) => [t.qty, t.exit.price])).toEqual([[4, 103]])
    expect(used).toContain('B-EXIT-QTY')
  })
  it('S1\'s behaviour while B-EXIT-QTY is unpinned: both full exits stay live and the stop reached first fills', () => {
    // the same script as above with every rule pinned EXCEPT B-EXIT-QTY: the reservation reading is not
    // taken, so x2's stop at 99.6 (bar 2 falls to 99.5) closes the whole trade first, as S1 (master) does,
    // and the run never asks B-EXIT-QTY
    const src = `${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 4)\n`
      + '    strategy.exit("x1", "L", limit = 103)\n    strategy.exit("x2", "L", stop = 99.6)\nplot(strategy.position_size)\n'
    const { trades, used } = served(src, { pins: (id) => id !== 'B-EXIT-QTY' })
    expect(trades.map((t) => [t.qty, t.exit.price, t.exit.time])).toEqual([[4, 99.6, at(2)]])
    expect(used).not.toContain('B-EXIT-QTY')
    // and the same pin set with S1's own rules only (the T1 vocabulary) gives the same trades
    const S1_ONLY = new Set(['B-FILL', 'B-MARKET', 'B-PATH', 'B-GAP', 'B-SIG', 'B-DIR', 'B-EXIT-BIND', 'B-EXIT-LIFE', 'B-FIFO', 'B-VAL', 'B-MARGIN', 'B-DEFAULTS'])
    const s1 = served(src, { pins: (id) => S1_ONLY.has(id) })
    expect(s1.trades).toEqual(trades)
  })
  it('a partial size still asks B-EXIT-QTY when it is unpinned (it has no S1 behaviour to keep)', () => {
    const { err } = attempt(`${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 4)\n`
      + '    strategy.exit("x1", "L", limit = 103)\n    strategy.exit("x2", "L", qty = 1, stop = 99.6)\nplot(strategy.position_size)\n',
      { pins: (id) => id !== 'B-EXIT-QTY' })
    expect(err && err.rule).toBe('B-EXIT-QTY')
  })
  it('one full exit alone on a trade asks nothing new (S1\'s served case)', () => {
    const { used } = served(`${V5}${ENTER}    strategy.exit("x", "L", limit = 103)\nplot(strategy.position_size)\n`)
    expect(used).not.toContain('B-EXIT-QTY')
  })
  it('one partial exit re-called every bar exits the trade ONCE (R4), though bar 3 crosses its level again', () => {
    // 50% of 4 at 101.2 on bar 2; bar 3 rises 100.5 -> 104 through 101.2 again: nothing more fills
    const { cols, trades } = served(`${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 4)\n`
      + 'if bar_index >= 1\n    strategy.exit("tp1", "L", qty_percent = 50, limit = 101.2)\nplot(strategy.position_size)\n')
    expect(cols[0].slice(1, 6)).toEqual([0, 2, 2, 2, 2])
    expect(trades.map((t) => [t.qty, t.exit ? t.exit.price : null])).toEqual([[2, 101.2], [2, null]])
  })
  it('qty wins over qty_percent', () => {
    const { trades } = served(`${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 4)\n`
      + '    strategy.exit("x", "L", qty = 1, qty_percent = 50, limit = 101.2)\nplot(strategy.position_size)\n')
    expect(trades.map((t) => [t.qty, t.exit ? t.exit.price : null])).toEqual([[1, 101.2], [3, null]])
  })
  it('refuses by name (W9-X2): a percent that is not a whole number of units', () => {
    unsettled(`${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 3)\n`
      + '    strategy.exit("x", "L", qty_percent = 50, limit = 103)\nplot(strategy.position_size)\n', 'W9-X2')
  })
  it('refuses by name (W9-X2): a partial size over more than one trade', () => {
    unsettled('//@version=5\nstrategy("t", pyramiding = 2)\nif bar_index == 1 or bar_index == 2\n'
      + '    strategy.entry("L", strategy.long, qty = 2)\nif bar_index == 3\n'
      + '    strategy.exit("x", "L", qty = 1, limit = 110)\nplot(strategy.position_size)\n', 'W9-X2')
  })
})

describe('W9-T7 [B-CLOSE-QTY] partial strategy.close (W9-X2)', () => {
  it('25% of 4 at bar 3\'s open, then qty 10 (more than is left) closes the other 3 at bar 4\'s open', () => {
    const src = `${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 4)\n`
      + 'if bar_index == 2\n    strategy.close("L", qty_percent = 25)\nif bar_index == 3\n    strategy.close("L", qty = 10)\n'
      + 'plot(strategy.position_size)\nplot(strategy.netprofit)\n'
    // 1 x (101 - 100) + 3 x (103.5 - 100) = 11.5
    const { cols, trades, used } = served(src)
    expect(cols[0].slice(1, 6)).toEqual([0, 4, 3, 0, 0])
    expect(cols[1][4]).toBeCloseTo(11.5, 9)
    expect(trades.map((t) => [t.qty, t.exit.price, t.exit.time])).toEqual([[1, 101, at(3)], [3, 103.5, at(4)]])
    expect(used).toContain('B-CLOSE-QTY')
  })
  it('qty_percent is of the id' + "'" + 's trades, not of the position: 50% of A (2 of a 4-unit position) is 1', () => {
    const { cols, trades } = served('//@version=5\nstrategy("t", pyramiding = 2)\nif bar_index == 1\n    strategy.entry("A", strategy.long, qty = 2)\n'
      + 'if bar_index == 2\n    strategy.entry("B", strategy.long, qty = 2)\n'
      + 'if bar_index == 3\n    strategy.close("A", qty_percent = 50)\nplot(strategy.position_size)\n')
    expect(cols[0].slice(2, 6)).toEqual([2, 4, 3, 3])
    expect(trades.filter((t) => t.exit).map((t) => [t.id, t.qty, t.exit.price])).toEqual([['A', 1, 103.5]])
  })
  it('refuses by name (Q-S1h): a partial close of a newer trade while an older one is open (the FIFO split)', () => {
    unsettled('//@version=5\nstrategy("t", pyramiding = 2)\nif bar_index == 1\n    strategy.entry("A", strategy.long, qty = 2)\n'
      + 'if bar_index == 2\n    strategy.entry("B", strategy.long, qty = 2)\n'
      + 'if bar_index == 3\n    strategy.close("B", qty = 1)\nplot(strategy.position_size)\n', 'Q-S1h')
  })
  it('refuses by name (W9-X2): a percent that is not a whole number of units', () => {
    unsettled(`${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 3)\n`
      + 'if bar_index == 2\n    strategy.close("L", qty_percent = 50)\nplot(strategy.position_size)\n', 'W9-X2')
  })
})

describe('W9-T7 [B-OCA] One-Cancels-All on entries and orders (W9-X3)', () => {
  //   2, 3 as HEAD; 4: 103.5 / 104 / 102.5 / 103 high nearer; 5: 103 / 103.5 / 98 / 98.5 high nearer
  //   (it falls through 99); 6+: 98.5 / 99.2 / 98 / 98.6 low nearer
  const OB = barsOf([...HEAD, [103.5, 104, 102.5, 103], [103, 103.5, 98, 98.5], ...FILL(3, [98.5, 99.2, 98, 98.6])])
  const pair = (oca) => `${V5}if bar_index == 1\n`
    + `    strategy.entry("B", strategy.long, qty = 1, stop = 102${oca})\n`
    + `    strategy.entry("S", strategy.short, qty = 2, stop = 99${oca})\nplot(strategy.position_size)\n`
  it('oca.cancel: the long stop fills at 102 on bar 3 and cancels the short stop (2), which bar 5 would have filled', () => {
    const { cols, used } = served(pair(', oca_name = "g", oca_type = strategy.oca.cancel'), { bars: OB })
    expect(cols[0].slice(2, 8)).toEqual([0, 1, 1, 1, 1, 1])
    expect(used).toContain('B-OCA')
  })
  it('the same pair as oca.reduce: the short is reduced 2 -> 1 and still reverses on bar 5 (cancel and reduce differ)', () => {
    const { cols } = served(pair(', oca_name = "g", oca_type = strategy.oca.reduce'), { bars: OB })
    expect(cols[0].slice(2, 8)).toEqual([0, 1, 1, -1, -1, -1])
  })
  it('control: without the group the short stop reverses the position on bar 5 (the fixture discriminates)', () => {
    const { cols } = served(pair(''), { bars: OB })
    // the short of 2 reverses the long of 1: -2
    expect(cols[0].slice(2, 8)).toEqual([0, 1, 1, -2, -2, -2])
  })
  it('oca.none with a name is no group', () => {
    const { cols } = served(pair(', oca_name = "g", oca_type = strategy.oca.none'), { bars: OB })
    expect(cols[0][5]).toBe(-2)
  })
  it('oca.reduce: the limit fills 3 at 99.6 on bar 2, the stop is reduced from 5 to 2 and fills at 102 on bar 3', () => {
    const src = (oca) => '//@version=5\nstrategy("t", pyramiding = 2)\nif bar_index == 1\n'
      + `    strategy.entry("A", strategy.long, qty = 3, limit = 99.6${oca})\n`
      + `    strategy.entry("B", strategy.long, qty = 5, stop = 102${oca})\nplot(strategy.position_size)\n`
    const red = served(src(', oca_name = "r", oca_type = strategy.oca.reduce'))
    expect(red.cols[0].slice(1, 5)).toEqual([0, 3, 5, 5])
    expect(red.trades.map((t) => [t.id, t.qty, t.entry.price])).toEqual([['A', 3, 99.6], ['B', 2, 102]])
    const plain = served(src(''))
    expect(plain.cols[0][3]).toBe(8)
  })
  it('an exit\'s oca_name (a reduce group across exit commands) still refuses at build, naming W9-X3', () => {
    const r = attempt(`${V5}${ENTER}    strategy.exit("x", "L", stop = 95, oca_name = "g")\nplot(strategy.position_size)\n`)
    expect(r.refused.guard).toBe('runtime:strategy-option')
    expect(r.refused.message).toMatch(/W9-X3/)
  })
})

describe('W9-T7 [B-ORDER] strategy.order (W9-X4)', () => {
  const src = (shortQty) => `${V5}if bar_index == 1\n    strategy.order("L1", strategy.long, qty = 2)\n`
    + 'if bar_index == 2\n    strategy.order("L2", strategy.long, qty = 2)\n'
    + `if bar_index == 3\n    strategy.order("X", strategy.short, qty = ${shortQty})\n`
    + 'plot(strategy.position_size)\nplot(strategy.netprofit)\nplot(strategy.opentrades)\n'
  it('ignores pyramiding (v5 default 0 allows one entry) and sells against the position oldest first, never reversing', () => {
    // L1 2 @ 100 (bar 2), L2 2 @ 101 (bar 3): 4 open with pyramiding 0. X sells 3 at bar 4's open 103.5:
    // all of L1 (2) and 1 of L2. netprofit 2 x 3.5 + 1 x 2.5 = 9.5; 1 left open.
    const { cols, trades, used } = served(src(3))
    const [size, net, openN] = cols
    expect(size.slice(1, 6)).toEqual([0, 2, 4, 1, 1])
    expect(openN[4]).toBe(1)
    expect(net[4]).toBeCloseTo(9.5, 9)
    expect(trades.map((t) => [t.id, t.qty, t.entry.price, t.exit ? t.exit.price : null]))
      .toEqual([['L1', 2, 100, 103.5], ['L2', 1, 101, 103.5], ['L2', 1, 101, null]])
    expect(used).toContain('B-ORDER')
    expect(used).not.toContain('B-REVERSE')
  })
  it('control: strategy.entry at the same places stops at one entry (pyramiding)', () => {
    const { cols } = served(`${V5}if bar_index == 1\n    strategy.entry("L1", strategy.long, qty = 2)\n`
      + 'if bar_index == 2\n    strategy.entry("L2", strategy.long, qty = 2)\nplot(strategy.position_size)\n')
    expect(cols[0].slice(2, 5)).toEqual([2, 2, 2])
  })
  it('refuses by name (W9-X4): selling more than the position holds', () => {
    unsettled(src(5), 'W9-X4')
  })
  it('refuses by name (W9-X4): one id used by both strategy.entry and strategy.order', () => {
    unsettled(`${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1, limit = 90)\n`
      + '    strategy.order("L", strategy.long, qty = 1, limit = 90)\nplot(strategy.position_size)\n', 'W9-X4')
  })
})

describe('W9-T7 [B-IMMEDIATELY] close(immediately = true) (W9-X4)', () => {
  it('fills at the close of the bar it is placed on, stamped with that bar', () => {
    // entry 1 @ 100 on bar 2; on bar 3 the value is read BEFORE the close is placed; the close fills
    // at bar 3's close 103.5
    const { cols, trades, used } = served(`${V5}plot(strategy.position_size)\n${ENTER}`
      + 'if bar_index == 3\n    strategy.close("L", immediately = true)\n')
    expect(cols[0].slice(1, 6)).toEqual([0, 1, 1, 0, 0])
    expect(trades[0].exit).toEqual({ time: at(3), price: 103.5, rule: 'B-IMMEDIATELY' })
    expect(used).toContain('B-IMMEDIATELY')
  })
  it('close_all(immediately = true) the same', () => {
    const { trades } = served(`${V5}plot(strategy.position_size)\n${ENTER}if bar_index == 3\n    strategy.close_all(immediately = true)\n`)
    expect(trades[0].exit).toEqual({ time: at(3), price: 103.5, rule: 'B-IMMEDIATELY' })
  })
  it('refuses by name (W9-X4): a value read after the immediate fill on the same bar', () => {
    unsettled(`${V5}${ENTER}if bar_index == 3\n    strategy.close("L", immediately = true)\nplot(strategy.position_size)\n`, 'W9-X4')
  })
})

describe('W9-T7 [B-STOP-LIMIT] stop-limit entries and orders (Q-S1j)', () => {
  // bar 2: 100 / 102.5 / 99.8 / 101, low nearer: 100 -> 99.8 -> 102.5 (stop 102 reached: a limit at 101.5
  // is placed) -> 101 (falls through 101.5): filled at 101.5 on bar 2
  const SB = barsOf([...HEAD.slice(0, 2), [100, 102.5, 99.8, 101], ...FILL(4, [101, 101.6, 100.6, 101.2])])
  it('the stop places the limit; the limit fills on the fall back to it, at its level', () => {
    const { trades, used } = served(`${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1, stop = 102, limit = 101.5)\nplot(strategy.position_size)\n`, { bars: SB })
    expect(trades[0].entry).toEqual({ time: at(2), price: 101.5, rule: 'B-PATH' })
    expect(used).toContain('B-STOP-LIMIT')
  })
  it('control: the plain stop fills at 102', () => {
    const { trades } = served(`${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1, stop = 102)\nplot(strategy.position_size)\n`, { bars: SB })
    expect(trades[0].entry.price).toBe(102)
  })
  it('strategy.order takes a stop-limit too', () => {
    const { trades } = served(`${V5}if bar_index == 1\n    strategy.order("L", strategy.long, qty = 1, stop = 102, limit = 101.5)\nplot(strategy.position_size)\n`, { bars: SB })
    expect(trades[0].entry.price).toBe(101.5)
  })
  it('refuses by name (Q-S1j): a limit at or beyond the stop', () => {
    unsettled(`${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1, stop = 102, limit = 102.5)\nplot(strategy.position_size)\n`, 'Q-S1j', { bars: SB })
  })
  it('refuses by name (Q-S1j): the stop already reached at the signal close', () => {
    unsettled(`${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1, stop = 99, limit = 98)\nplot(strategy.position_size)\n`, 'Q-S1j', { bars: SB })
  })
})

describe('W9-T7 [B-EXIT-LEVELS] profit and limit together, by version (Q-S1k)', () => {
  // entry 1 @ 100 on bar 2. profit 150 ticks = 101.5; limit 104.
  const SRC = (v) => `//@version=${v}\nstrategy("t")\n${ENTER}    strategy.exit("x", "L", profit = 150, limit = 104)\nplot(strategy.position_size)\n`
  it('v5 keeps the price (R5: profit is ignored when limit is not na): 104 on bar 3', () => {
    const { trades, used } = served(SRC(5))
    expect([trades[0].exit.price, trades[0].exit.time]).toEqual([104, at(3)])
    expect(used).toContain('B-EXIT-LEVELS')
  })
  it('v6 keeps the level expected to fill first (R6): 101.5 on bar 2', () => {
    const { trades } = served(SRC(6))
    expect([trades[0].exit.price, trades[0].exit.time]).toEqual([101.5, at(2)])
  })
  it('v6 loss and stop: the higher stop for a long (99.6 over 99.0), reached on bar 2\'s fall to 99.5', () => {
    const { trades } = served(`//@version=6\nstrategy("t")\n${ENTER}    strategy.exit("x", "L", loss = 100, stop = 99.6)\nplot(strategy.position_size)\n`)
    expect([trades[0].exit.price, trades[0].exit.time]).toEqual([99.6, at(2)])
  })
  it('refuses by name (Q-S1k): the pair in Pine v4 (no v4 text read)', () => {
    unsettled(`//@version=4\nstrategy("t")\nstrategy.entry("L", true, qty = 1, when = bar_index == 1)\nstrategy.exit("x", "L", profit = 150, limit = 104)\nplot(strategy.position_size)\n`, 'Q-S1k')
  })
})

describe('W9-T7 x W9-T6: the T7 kinds are served on the default timing only', () => {
  const kinds = [
    ['a trailing stop', `    strategy.exit("x", "L", trail_points = 200, trail_offset = 100)\n`],
    ['a partial exit', `    strategy.exit("x", "L", qty = 1, limit = 103)\n`],
    ['strategy.order', `    strategy.order("O", strategy.long, qty = 1)\n`],
    ['a stop-limit', `    strategy.entry("S", strategy.long, qty = 1, stop = 102, limit = 101.5)\n`],
    ['an OCA group', `    strategy.entry("S", strategy.long, qty = 1, stop = 102, oca_name = "g", oca_type = strategy.oca.cancel)\n`],
  ]
  for (const [prop, row] of [['process_orders_on_close = true', 'W9-P1'], ['calc_on_order_fills = true', 'W9-P2']]) {
    for (const [what, line] of kinds) {
      it(`${what} under ${prop} stops by name (${row})`, () => {
        unsettled(`//@version=5\nstrategy("t", pyramiding = 2, ${prop})\nif bar_index == 1\n    strategy.entry("L", strategy.long, qty = 2)\n${line}`
          + 'plot(strategy.position_size)\n', row)
      })
    }
  }
})

// ─── pin before serve (D1) ──────────────────────────────────────────────────────
const SAMPLES = {
  'B-TRAIL': [`${V5}${ENTER}    strategy.exit("x", "L", trail_points = 200, trail_offset = 100)\nplot(strategy.position_size)\n`],
  'B-EXIT-QTY': [`${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 4)\n    strategy.exit("x", "L", qty_percent = 50, limit = 101.2)\nplot(strategy.position_size)\n`],
  'B-CLOSE-QTY': [`${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 4)\nif bar_index == 2\n    strategy.close("L", qty = 1)\nplot(strategy.position_size)\n`],
  'B-OCA': [`${V5}if bar_index == 1\n    strategy.entry("B", strategy.long, qty = 1, stop = 102, oca_name = "g", oca_type = strategy.oca.cancel)\nplot(strategy.position_size)\n`],
  'B-ORDER': [`${V5}if bar_index == 1\n    strategy.order("L", strategy.long, qty = 1)\nplot(strategy.position_size)\n`],
  'B-IMMEDIATELY': [`${V5}plot(strategy.position_size)\n${ENTER}if bar_index == 3\n    strategy.close("L", immediately = true)\n`],
  'B-STOP-LIMIT': [`${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1, stop = 102, limit = 101.5)\nplot(strategy.position_size)\n`],
  'B-EXIT-LEVELS': [`//@version=6\nstrategy("t")\n${ENTER}    strategy.exit("x", "L", profit = 150, limit = 104)\nplot(strategy.position_size)\n`],
}

describe('W9-T7 pin before serve (D1): nothing T7 adds serves without its own pin', () => {
  afterEach(() => registerStrategyBrokerGate(() => false))
  it('each T7 rule is named, with the capture row the design gives it, and the ledger pins none', () => {
    expect(T7_RULES.map((r) => BROKER_RULES[r].capture))
      .toEqual(['W9-X1', 'W9-X2', 'W9-X2', 'W9-X3', 'W9-X4', 'W9-X4', 'Q-S1j', 'Q-S1k'])
    for (const r of T7_RULES) expect(Object.keys(RESOLVED.rules)).not.toContain(r)
  })
  for (const rule of T7_RULES) {
    const [src] = SAMPLES[rule]
    it(`${rule}: served with every rule pinned, and stops naming ${rule} (and its row) when only it is unpinned`, () => {
      const full = attempt(src)
      expect(full.err, full.err && full.err.message).toBeUndefined()
      expect(full.used).toContain(rule)
      const { err } = attempt(src, { pins: (id) => id !== rule })
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
      const doc = { id: `w9t7-${rule}`, meta: { runtimeHistory: 'strategy-window' },
        compute: { kind: 'runtime', fn: `runtime:w9t7-${rule}`, outputs: { p: 0 }, source: src } }
      let err
      try { computeRuntimeColumns(doc, A, { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: SYMBOL, historyWindowBars: 30 }) } catch (e) { err = e }
      expect(err && err.guard).toBe('runtime:strategy-unpinned')
      expect(err.message).toMatch(/is not pinned by a matching TradingView capture/)
    })
  }
  it('B-TRAIL and B-ORDER stop the run at the CALL, even when nothing ever activates or fills', () => {
    const never = {
      'B-TRAIL': `${V5}${ENTER}    strategy.exit("x", "L", trail_points = 100000, trail_offset = 100)\nplot(strategy.position_size)\n`,
      'B-ORDER': `${V5}if bar_index == 1\n    strategy.order("L", strategy.long, qty = 1, limit = 1)\nplot(strategy.position_size)\n`,
    }
    for (const [rule, src] of Object.entries(never)) {
      const full = attempt(src)
      expect(full.err, full.err && full.err.message).toBeUndefined()
      expect(full.trades.filter((t) => t.exit)).toEqual([])
      const { err } = attempt(src, { pins: (id) => id !== rule })
      expect(err && err.rule, rule).toBe(rule)
    }
  })
  it('the D7 scorecard stays derived: 0 of every named rule (the size is pinned once, strategiesAreRuled.test.js)', () => {
    for (const r of T7_RULES) expect(BROKER_RULE_IDS).toContain(r)
    expect(strategyScorecardWording()).toMatch(new RegExp(`^0 of ${BROKER_RULE_IDS.length} broker rules are pinned`))
  })
})
