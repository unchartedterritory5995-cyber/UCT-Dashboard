// W9-T6 rails: fill timing (process_orders_on_close, calc_on_order_fills, calc_on_every_tick on history,
// backtest_fill_limits_assumption, the July-2026 defaults) and the VM step order that carries them.
//
// Every expected number below is HAND-COMPUTED from the bars written here (the trace is in each case's
// comment), and every case also runs its default-timing CONTROL, so a rail cannot pass by the setting
// being ignored.
//
// ⛔ PINS. Every T6 rule is UNPINNED in the committed ledger (no W9-P1 / P1b / P2 / P3 / J1 capture has
// landed). The served cases pass a test pin set through `execute`'s `brokerPinned` (the T1 test-only
// path) or, at the member door, through the mocked ledger reader below. No product code takes a pin set.
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../brokerPins.js', async () => {
  const real = await vi.importActual('../brokerPins.js')
  return { pinned: (id) => (typeof globalThis.__w9t6Pins === 'function' ? globalThis.__w9t6Pins(id) : real.pinned(id)) }
})
vi.setConfig({ testTimeout: 120000 })

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { BROKER_RULES } from '../brokerRules.js'
import RESOLVED from '../brokerPins.resolved.json'
import { computeRuntimeColumns } from '../runtimeColumns.js'
import { registerStrategyBrokerGate } from '../../strategyBrokerGateRegistry.js'
import { STRATEGY_WINDOW_HISTORY, runtimeStrategyOf, strategyRecordShapeErrors, STRATEGY_RECORD_UNSERVED } from '../strategyRecord.js'

const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE' } // mintick 0.01, pointvalue 1
const T0 = 1700000000
// bar i: open 100+i, high 101.5+i, low 99+i, close 100.5+i. The open is nearer the LOW, so the
// path is open -> low -> high -> close ([B-PATH]).
const barsOf = (n) => Array.from({ length: n }, (_, i) => ({ t: T0 + i * 86400, o: 100 + i, h: 101.5 + i, l: 99 + i, c: 100.5 + i, v: 1000 }))
const BARS = barsOf(12)
const ALL = () => true
const T6_RULES = ['B-J1', 'B-POC', 'B-POC-PRICE', 'B-POC-PYR', 'B-POC-FILLS', 'B-FILLS', 'B-TICK-HIST', 'B-FILL-LIMITS']
const NL = '\n'

const attempt = (src, { bars = BARS, pins = ALL } = {}) => {
  const built = buildRuntimeIr(src, { bars, inputs: {}, symbol: SYMBOL, strategyBroker: true })
  if (!built.ok) return { refused: built.refusal }
  const program = lowerIrProgram(built.ir, { historyFromListing: true })
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const ctx = { bars: bars.length, series, columns: program.columns, confirmed: true, barTimes: bars.map((b) => b.t), historyWindowBars: 5000 }
  try { return { res: execute(program, ctx, undefined, { brokerPinned: pins }), program } } catch (err) { return { err } }
}
const served = (src, o) => {
  const r = attempt(src, o)
  expect(r.refused, JSON.stringify(r.refused)).toBeUndefined()
  expect(r.err, r.err && r.err.message).toBeUndefined()
  return r.res
}
const trades = (res) => res.broker.record.trades.map((t) => [t.id, t.entry.time === null ? null : (t.entry.time - T0) / 86400,
  t.entry.price, t.entry.rule, t.exit ? (t.exit.time - T0) / 86400 : null, t.exit ? t.exit.price : null, t.exit ? t.exit.rule : null])
const col = (res, k) => Array.from(res.outputs[k])
/** each rule the run used, taken out of the pin set one at a time, stops the run naming THAT rule */
const eachRuleStops = (src, o = {}) => {
  const used = served(src, o).broker.record.rulesUsed
  for (const rule of used) {
    const { err } = attempt(src, { ...o, pins: (id) => id !== rule })
    expect(err && err.guard, rule).toBe('runtime:strategy-unpinned')
    expect(err.rule).toBe(rule)
  }
  return used
}

afterEach(() => { globalThis.__w9t6Pins = undefined; registerStrategyBrokerGate(() => false) })

describe('W9-T6 the rules are named, captured by their rows, and unpinned in the committed ledger', () => {
  it('each T6 rule names the capture row that would pin it (B-FILL-LIMITS has none queued)', () => {
    expect(Object.fromEntries(T6_RULES.map((r) => [r, BROKER_RULES[r].capture]))).toEqual({
      'B-J1': 'W9-J1', 'B-POC': 'W9-P1', 'B-POC-PRICE': 'W9-P1', 'B-POC-PYR': 'W9-P1', 'B-POC-FILLS': 'W9-P1b',
      'B-FILLS': 'W9-P2', 'B-TICK-HIST': 'W9-P3', 'B-FILL-LIMITS': null,
    })
  })
  it('the committed ledger pins none of them', () => {
    for (const r of T6_RULES) expect(Object.prototype.hasOwnProperty.call(RESOLVED.rules, r), r).toBe(false)
  })
  it('the declaration reads the timing settings instead of refusing them; history-tick stays refused', () => {
    for (const decl of ['process_orders_on_close = true', 'calc_on_order_fills = true', 'backtest_fill_limits_assumption = 3',
      'process_orders_on_close = false', 'calc_on_every_history_tick = false']) {
      const { refused } = attempt(`//@version=5${NL}strategy("t", ${decl})${NL}plot(strategy.position_size)${NL}`)
      expect(refused, decl).toBeUndefined()
    }
    const { refused } = attempt(`//@version=5${NL}strategy("t", calc_on_every_history_tick = true)${NL}plot(strategy.position_size)${NL}`)
    expect(refused.guard).toBe('runtime:strategy-option')
    expect(refused.message).toContain('calc_on_every_history_tick')
    const neg = attempt(`//@version=5${NL}strategy("t", backtest_fill_limits_assumption = -1)${NL}plot(strategy.position_size)${NL}`).refused
    expect(neg.guard).toBe('runtime:strategy-option')
  })
})

describe('W9-T6 [B-J1] a default next-bar fill rests on the July-2026 defaults', () => {
  const SRC = ['//@version=5', 'strategy("t")', 'if bar_index == 3', '    strategy.entry("L", strategy.long)', 'if bar_index == 6',
    '    strategy.close("L")', 'plot(strategy.position_size)', ''].join(NL)
  it('next-open fills, unchanged: entry at O[4] = 104, exit at O[7] = 107', () => {
    const res = served(SRC)
    expect(trades(res)).toEqual([['L', 4, 104, 'B-MARKET', 7, 107, 'B-CLOSE']])
    expect(col(res, 0).slice(2, 9)).toEqual([0, 0, 1, 1, 1, 0, 0])
  })
  it('B-J1 is asked with every next-bar fill, and stops the run by name with W9-J1 when unpinned', () => {
    expect(eachRuleStops(SRC)).toContain('B-J1')
    const { err } = attempt(SRC, { pins: (id) => id !== 'B-J1' })
    expect(err.message).toMatch(/B-J1.*W9-J1/)
  })
})

describe('W9-T6 [B-POC] process_orders_on_close', () => {
  const SRC = (decl) => ['//@version=5', `strategy("t"${decl})`, 'if bar_index == 3', '    strategy.entry("L", strategy.long)',
    'if bar_index == 6', '    strategy.close("L")', 'plot(strategy.position_size)', ''].join(NL)
  it('a market entry / close placed on bar t fills at t\'s close; the script reads it from t+1', () => {
    // entry placed on bar 3 fills at C[3] = 103.5 on bar 3; the close placed on bar 6 fills at C[6] = 106.5.
    // position_size on bar 3 is still 0 (the script ran before the close fill); 1 on bars 4..6; 0 from 7.
    const res = served(SRC(', process_orders_on_close = true'))
    expect(trades(res)).toEqual([['L', 3, 103.5, 'B-POC', 6, 106.5, 'B-POC']])
    expect(col(res, 0).slice(2, 9)).toEqual([0, 0, 1, 1, 1, 0, 0])
    expect(res.broker.record.rulesUsed).toContain('B-POC')
    expect(res.broker.record.rulesUsed).not.toContain('B-MARKET')
    // CONTROL: the same script without the setting fills at the next opens (B-J1 above)
    expect(trades(served(SRC('')))).toEqual([['L', 4, 104, 'B-MARKET', 7, 107, 'B-CLOSE']])
  })
  it('unpinned, the first close fill stops the run naming B-POC and W9-P1', () => {
    const { err } = attempt(SRC(', process_orders_on_close = true'), { pins: (id) => id !== 'B-POC' })
    expect(err.guard).toBe('runtime:strategy-unpinned')
    expect(err.rule).toBe('B-POC')
    expect(err.message).toMatch(/W9-P1/)
    eachRuleStops(SRC(', process_orders_on_close = true'))
  })
  it('[B-POC-PYR] a close fill that adds to the position (pyramiding 2): sizes 1 then 2', () => {
    const src = ['//@version=5', 'strategy("t", process_orders_on_close = true, pyramiding = 2)', 'if bar_index == 3 or bar_index == 5',
      '    strategy.entry("L", strategy.long)', 'plot(strategy.position_size)', ''].join(NL)
    const res = served(src)
    expect(trades(res)).toEqual([['L', 3, 103.5, 'B-POC', null, null, null], ['L', 5, 105.5, 'B-POC', null, null, null]])
    expect(col(res, 0).slice(3, 8)).toEqual([0, 1, 1, 2, 2])
    expect(eachRuleStops(src)).toContain('B-POC-PYR')
  })
  it('[B-POC-PRICE] a price order placed on the bar gets one attempt at its close, else lives from the next open', () => {
    // L fills at C[2] = 102.5. On bar 4 an exit limit 104.4 is placed: C[4] = 104.5 >= 104.4, so it fills AT
    // THE CLOSE, 104.5. With limit 106.2 instead it does not (104.5 < 106.2) and is live from bar 5's open:
    // bar 5 runs 105 -> 104 -> 106.5, rising through 106.2, so it fills there on the path.
    const src = (lvl) => ['//@version=5', 'strategy("t", process_orders_on_close = true)', 'if bar_index == 2',
      '    strategy.entry("L", strategy.long)', 'if bar_index == 4', `    strategy.exit("x", "L", limit = ${lvl})`,
      'plot(strategy.position_size)', ''].join(NL)
    expect(trades(served(src(104.4)))).toEqual([['L', 2, 102.5, 'B-POC', 4, 104.5, 'B-POC-PRICE']])
    expect(trades(served(src(106.2)))).toEqual([['L', 2, 102.5, 'B-POC', 5, 106.2, 'B-PATH']])
    expect(eachRuleStops(src(104.4))).toContain('B-POC-PRICE')
    expect(attempt(src(104.4), { pins: (id) => id !== 'B-POC-PRICE' }).err.message).toMatch(/B-POC-PRICE.*W9-P1/)
  })
  it('two market orders on one closing tick are refused by name (Q-S1d), never ordered by a guess', () => {
    const src = ['//@version=5', 'strategy("t", process_orders_on_close = true, pyramiding = 2)', 'if bar_index == 2',
      '    strategy.entry("A", strategy.long)', '    strategy.entry("B", strategy.long)', 'plot(strategy.position_size)', ''].join(NL)
    const { err } = attempt(src)
    expect(err.guard).toBe('runtime:strategy-unsettled')
    expect(err.message).toMatch(/closing tick.*Q-S1d/)
  })
})

describe('W9-T6 [B-FILLS] calc_on_order_fills on history: extra executions, rolled back', () => {
  // bar 3: open 103, low 102, high 104.5, close 103.5; path 103 -> 102 -> 104.5 -> 103.5.
  const SRC = (decl, lvl = '104.0') => ['//@version=5', `strategy("t"${decl})`, 'var int n = 0', 'n += 1',
    'if bar_index == 2', '    strategy.entry("L", strategy.long)',
    'if strategy.position_size > 0 and strategy.closedtrades == 0', '    strategy.exit("x", "L", limit = 104.5)',
    'if strategy.closedtrades == 1 and strategy.position_size == 0 and strategy.opentrades == 0',
    `    strategy.entry("L2", strategy.long, limit = ${lvl})`,
    'plot(strategy.position_size)', 'plot(n)', ''].join(NL)
  it('three extra executions on bar 3, each placing an order that fills later on the same bar', () => {
    // L fills at the open 103 -> extra #1 places exit x (limit 104.5) -> the path rises to 104.5, x fills ->
    // extra #2 places L2 (limit 104.0, below the market) -> the path falls 104.5 -> 103.5 through 104.0, L2 fills.
    const res = served(SRC(', calc_on_order_fills = true'))
    expect(trades(res)).toEqual([['L', 3, 103, 'B-MARKET', 3, 104.5, 'B-PATH'], ['L2', 3, 104, 'B-PATH', null, null, null]])
    expect(col(res, 0).slice(1, 6)).toEqual([0, 0, 1, 1, 1])
    // ROLLBACK: the `var` counts executions; every extra execution is rolled back, so it reads bar_index + 1
    expect(col(res, 1)).toEqual(BARS.map((_, i) => i + 1))
    expect(res.broker.record.rulesUsed).toContain('B-FILLS')
    // CONTROL, default timing: x is placed on bar 3's close and fills on bar 4 (103 -> 105.5 through 104.5);
    // L2 is placed on bar 4's close and fills on bar 5's fall to 104.
    expect(trades(served(SRC('')))).toEqual([['L', 3, 103, 'B-MARKET', 4, 104.5, 'B-PATH'], ['L2', 5, 104, 'B-PATH', null, null, null]])
  })
  it('a market order an extra execution places fills on the next tick: the next path vertex', () => {
    // L fills at the open 103; extra #1 calls strategy.close("L"); the next tick is the low, 102.
    const src = ['//@version=5', 'strategy("t", calc_on_order_fills = true)', 'if bar_index == 2', '    strategy.entry("L", strategy.long)',
      'if strategy.position_size > 0', '    strategy.close("L")', 'plot(strategy.position_size)', ''].join(NL)
    expect(trades(served(src))).toEqual([['L', 3, 103, 'B-MARKET', 3, 102, 'B-FILLS']])
    // CONTROL: the close is placed on bar 3's close and fills at O[4] = 104
    expect(trades(served(src.replace(', calc_on_order_fills = true', '')))).toEqual([['L', 3, 103, 'B-MARKET', 4, 104, 'B-CLOSE']])
  })
  it('a price order an extra execution places already past its level at that tick is refused by name (Q-S1e)', () => {
    // L fills at the open 103; extra #1 places a stop-loss at 103.2, which a long's fall has already passed at 103
    const src = ['//@version=5', 'strategy("t", calc_on_order_fills = true)', 'if bar_index == 2', '    strategy.entry("L", strategy.long)',
      'if strategy.position_size > 0', '    strategy.exit("x", "L", stop = 103.2)', 'plot(strategy.position_size)', ''].join(NL)
    const { err } = attempt(src)
    expect(err.guard).toBe('runtime:strategy-unsettled')
    expect(err.message).toMatch(/already past its level 103\.2.*Q-S1e/)
    // CONTROL: default timing places it on bar 3's close (103.5); bar 4 falls 104 -> 103 through it
    expect(trades(served(src.replace(', calc_on_order_fills = true', '')))).toEqual([['L', 3, 103, 'B-MARKET', 4, 103.2, 'B-PATH']])
  })
  it('a lone fill at the open still asks B-FILLS before its extra execution runs', () => {
    const src = ['//@version=5', 'strategy("t", calc_on_order_fills = true)', 'if bar_index == 2', '    strategy.entry("L", strategy.long)',
      'plot(strategy.position_size)', ''].join(NL)
    expect(trades(served(src))).toEqual([['L', 3, 103, 'B-MARKET', null, null, null]])
    const { err } = attempt(src, { pins: (id) => id !== 'B-FILLS' })
    expect(err && err.rule).toBe('B-FILLS')
  })
  it('unpinned, the first fill stops the run naming B-FILLS and W9-P2', () => {
    const { err } = attempt(SRC(', calc_on_order_fills = true'), { pins: (id) => id !== 'B-FILLS' })
    expect(err.rule).toBe('B-FILLS')
    expect(err.message).toMatch(/W9-P2/)
    eachRuleStops(SRC(', calc_on_order_fills = true'))
  })
  it('a fill on the CLOSING tick (one execution or two is not stated) stops the run by name', () => {
    // L2 at 103.5 = C[3] is reached exactly at the last tick
    const { err } = attempt(SRC(', calc_on_order_fills = true', '103.5'))
    expect(err.guard).toBe('runtime:strategy-unsettled')
    expect(err.message).toMatch(/closing tick.*W9-P2/)
  })
  it('[B-POC-FILLS] with process_orders_on_close, a close fill re-runs the bar from its start state', () => {
    // Entry on bar 3 fills at C[3] = 103.5; the re-run of bar 3 reads position 1 and plots it; the `var` is
    // rolled back (n = 4 on bar 3). The re-run places L again, and the pyramiding limit (1) rejects it: no third run.
    const src = ['//@version=5', 'strategy("t", process_orders_on_close = true, calc_on_order_fills = true)', 'var int n = 0', 'n += 1',
      'if bar_index == 3', '    strategy.entry("L", strategy.long)', 'plot(strategy.position_size)', 'plot(n)', ''].join(NL)
    const res = served(src)
    expect(trades(res)).toEqual([['L', 3, 103.5, 'B-POC', null, null, null]])
    expect(col(res, 0).slice(2, 6)).toEqual([0, 1, 1, 1])
    expect(col(res, 1)).toEqual(BARS.map((_, i) => i + 1))
    expect(eachRuleStops(src)).toContain('B-POC-FILLS')
    expect(attempt(src, { pins: (id) => id !== 'B-POC-FILLS' }).err.message).toMatch(/W9-P1b/)
    // CONTROL, POC alone: no re-run, so bar 3 still reads 0
    expect(col(served(src.replace(', calc_on_order_fills = true', '')), 0).slice(2, 6)).toEqual([0, 0, 1, 1])
  })
})

describe('W9-T6 [B-TICK-HIST] calc_on_every_tick on history executes once per closed bar', () => {
  const SRC = (decl) => ['//@version=5', `strategy("t"${decl})`, 'if bar_index == 3', '    strategy.entry("L", strategy.long)',
    'if bar_index == 6', '    strategy.close("L")', 'plot(strategy.position_size)', ''].join(NL)
  it('the same fills and values as the default, and the rule is asked', () => {
    const on = served(SRC(', calc_on_every_tick = true'))
    const off = served(SRC(''))
    expect(trades(on)).toEqual(trades(off))
    expect(col(on, 0)).toEqual(col(off, 0))
    expect(on.broker.record.rulesUsed).toContain('B-TICK-HIST')
    expect(off.broker.record.rulesUsed).not.toContain('B-TICK-HIST')
    const { err } = attempt(SRC(', calc_on_every_tick = true'), { pins: (id) => id !== 'B-TICK-HIST' })
    expect(err.rule).toBe('B-TICK-HIST')
    expect(err.message).toMatch(/W9-P3/)
  })
})

describe('W9-T6 [B-FILL-LIMITS] backtest_fill_limits_assumption', () => {
  // L (limit, placed on bar 2's close 102.5) on bar 3, whose low is 102.
  const SRC = (n, lvl) => ['//@version=5', `strategy("t", backtest_fill_limits_assumption = ${n})`, 'if bar_index == 2',
    `    strategy.entry("L", strategy.long, limit = ${lvl})`, 'plot(strategy.position_size)', ''].join(NL)
  it('fills only once the price passes the level by N ticks, and then at the level', () => {
    // 102.2 with N = 2: the trigger 102.18 is above the low 102 -> fills at 102.2 on bar 3
    expect(trades(served(SRC(2, 102.2)))).toEqual([['L', 3, 102.2, 'B-PATH', null, null, null]])
    // 102.05 with N = 10: the trigger 101.95 is below bar 3's low 102 -> not on bar 3; bar 4's low is 103 -> never
    expect(trades(served(SRC(10, 102.05)))).toEqual([])
    // CONTROL, N = 0: 102.05 fills on bar 3
    expect(trades(served(SRC(0, 102.05)))).toEqual([['L', 3, 102.05, 'B-PATH', null, null, null]])
    expect(served(SRC(0, 102.05)).broker.record.rulesUsed).not.toContain('B-FILL-LIMITS')
  })
  it('unpinned, it stops by name saying no capture row is queued', () => {
    const { err } = attempt(SRC(2, 102.2), { pins: (id) => id !== 'B-FILL-LIMITS' })
    expect(err.rule).toBe('B-FILL-LIMITS')
    expect(err.message).toMatch(/no capture row is queued/)
  })
})

describe('W9-T6 the member door', () => {
  const POC = ['//@version=5', 'strategy("t", process_orders_on_close = true)', 'if bar_index == 3', '    strategy.entry("L", strategy.long)',
    'if bar_index == 6', '    strategy.close("L")', 'plot(strategy.position_size)', ''].join(NL)
  let seq = 0
  const doc = (source) => ({ id: `w9t6-${seq += 1}`, meta: { runtimeHistory: STRATEGY_WINDOW_HISTORY },
    compute: { kind: 'runtime', fn: `runtime:w9t6-${seq}`, outputs: { p: 0 }, source } })
  const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: SYMBOL, historyWindowBars: 12 }
  const run = (source) => { try { return { cols: computeRuntimeColumns(doc(source), BARS, CTX) } } catch (err) { return { err } } }
  it('with the committed ledger a fill-timing strategy is refused runtime:strategy-unpinned by name, never served', () => {
    registerStrategyBrokerGate(() => true)
    const { err, cols } = run(POC)
    expect(cols).toBeUndefined()
    expect(err.guard).toBe('runtime:strategy-unpinned')
    expect(err.rule).toBeTruthy()
  })
  it('with every rule but the T6 ones pinned, the door names the T6 rule the run reached', () => {
    registerStrategyBrokerGate(() => true)
    globalThis.__w9t6Pins = (id) => !T6_RULES.includes(id)
    const { err } = run(POC)
    expect(err.guard).toBe('runtime:strategy-unpinned')
    expect(err.rule).toBe('B-POC')
    expect(err.message).toMatch(/W9-P1/)
  })
  it('all pinned (test ledger), the record states the timing settings and names B-POC on its fills', () => {
    registerStrategyBrokerGate(() => true)
    globalThis.__w9t6Pins = () => true
    const { err, cols } = run(POC)
    expect(err).toBeUndefined()
    const rec = runtimeStrategyOf(cols)
    expect(strategyRecordShapeErrors(rec)).toEqual([])
    expect(rec.settings.process_orders_on_close).toBe(true)
    expect(rec.settings.calc_on_order_fills).toBe(false)
    expect(rec.settings.backtest_fill_limits_assumption).toBe(0)
    expect(STRATEGY_RECORD_UNSERVED['settings.process_orders_on_close']).toBeUndefined()
    expect(rec.trades.map((t) => [t.entryRule, t.exitRule, t.entryPrice, t.exitPrice])).toEqual([['B-POC', 'B-POC', 103.5, 106.5]])
    expect(Array.from(cols.p).slice(2, 9)).toEqual([0, 0, 1, 1, 1, 0, 0])
  })
  it('gate off: the same source is the indicator-lane refusal it always was (no broker)', () => {
    registerStrategyBrokerGate(() => false)
    const { err } = run(POC)
    expect(err && err.guard).not.toBe('runtime:strategy-unpinned')
  })
})
