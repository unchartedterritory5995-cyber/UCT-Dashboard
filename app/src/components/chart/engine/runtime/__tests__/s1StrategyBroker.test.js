// app/src/components/chart/engine/runtime/__tests__/s1StrategyBroker.test.js
//
// ─── ⭐⭐ S1 — TRADINGVIEW'S BROKER, THE RULES THE TEXT SETTLES ─────────────────
//
// Each rail names the spec rule it holds (`docs/pine/strategy-broker-spec.md`,
// `[B-..]`). The bars are hand-built so every fill is computable by hand from the
// rule's own text: the expected numbers below are the rule, not a recording of
// this broker's output.
//
// ⚠️ NO VENDOR CAPTURE PLOTS A BROKER VALUE YET (the spec's CAP row): these rails
// hold the rules as TradingView WRITES them; Q-S1-core
// (`docs/pine/capture-queue-2026-10-05-s1.md`) is the capture that grades them.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { BROKER_UNSETTLED_GUARD } from '../broker.js'

const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE' } // mintick 0.01, pointvalue 1

/** Bars from `[o, h, l, c]` rows. */
const barsOf = (rows) => rows.map(([o, h, l, c], i) => ({ t: 1700000000 + i * 86400, o, h, l, c, v: 1000 }))
/** 30 quiet bars: open 100+i, high +1.5, low -1, close +0.5 (open nearer the low). */
const QUIET = barsOf(Array.from({ length: 30 }, (_, i) => [100 + i, 101.5 + i, 99 + i, 100.5 + i]))

const build = (src, bars, opts = {}) => buildRuntimeIr(src, {
  bars, inputs: {}, symbol: SYMBOL, strategyBroker: true, ...opts,
})
const run = (src, bars = QUIET, { listing = true, confirmed = true, ...opts } = {}) => {
  const built = build(src, bars, opts)
  if (!built.ok) throw Object.assign(new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`), { refusal: built.refusal })
  const program = lowerIrProgram(built.ir, { historyFromListing: listing })
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const res = execute(program, {
    bars: bars.length, series, columns: program.columns, confirmed, barTimes: bars.map((b) => b.t),
  })
  return { cols: res.outputs.map((o) => Array.from(o)), broker: res.broker, ir: built.ir }
}
const stopOf = (src, bars = QUIET, o) => {
  try { run(src, bars, o) } catch (e) { return e }
  throw new Error('the run did not stop')
}

const V5 = '//@version=5\nstrategy("t")\n'

describe('⭐⭐ the gate and the retry', () => {
  it('flag OFF: a broker value refuses by name exactly as before', () => {
    const b = build(`${V5}plot(strategy.position_size)\n`, QUIET, { strategyBroker: false })
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('pine:strategy-call')
  })
  it('flag ON: a strategy that reads no broker value builds the SAME program (orders skipped)', () => {
    const src = `${V5}if close > open\n    strategy.entry("L", strategy.long)\nplot(close)\n`
    const off = build(src, QUIET, { strategyBroker: false })
    const on = build(src, QUIET)
    expect(on.ok).toBe(true)
    expect(JSON.stringify(on.ir)).toBe(JSON.stringify(off.ir))
    expect(on.ir.broker).toBe(null)
  })
})

describe('⭐⭐ market orders [B-FILL] [B-MARKET] [B-VAL]', () => {
  const SRC = `${V5}if bar_index == 3\n    strategy.entry("L", strategy.long)\nif bar_index == 10\n    strategy.close("L")\n`
    + 'plot(strategy.position_size)\nplot(strategy.position_avg_price)\nplot(strategy.netprofit)\n'
    + 'plot(strategy.opentrades)\nplot(strategy.closedtrades)\nplot(strategy.openprofit)\nplot(strategy.equity)\n'
  it('an entry placed on bar 3 fills at bar 4\'s OPEN; a close placed on 10 fills at 11\'s open', () => {
    const { cols } = run(SRC)
    const [size, avg, net, open, closed, openPl, equity] = cols
    expect(size.slice(2, 13)).toEqual([0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0]) // v5 default: fixed 1 [B-DEFAULTS]
    expect(avg[3]).toBeNaN()
    expect(avg[4]).toBe(104) // QUIET open of bar 4
    expect(avg[11]).toBeNaN()
    expect(net[10]).toBe(0)
    expect(net[11]).toBe(111 - 104)
    expect(open[5]).toBe(1)
    expect(closed[11]).toBe(1)
    expect(openPl[6]).toBeCloseTo(106.5 - 104, 10) // marked at the bar's close
    expect(equity[6]).toBeCloseTo(1000000 + 2.5, 10) // v5 initial capital 1000000 [B-DEFAULTS]
  })
  it('strategy.close of an id with no open trade places NO order [B-CLOSE] (so the entry beside it is alone on its tick)', () => {
    const { cols } = run(`${V5}if bar_index == 3\n    strategy.close("L")\n    strategy.entry("L", strategy.long)\n`
      + 'plot(strategy.closedtrades)\nplot(strategy.position_size)\n')
    expect(Math.max(...cols[0])).toBe(0)
    expect(cols[1][4]).toBe(1)
  })
})

describe('⭐⭐ reversal and pyramiding [B-REVERSE] [B-PYR] [B-MODIFY]', () => {
  it('an entry against the position closes it and opens the new size on one fill', () => {
    const { cols } = run(`${V5}if bar_index == 2\n    strategy.entry("L", strategy.long, qty = 2)\n`
      + 'if bar_index == 6\n    strategy.entry("S", strategy.short, qty = 3)\n'
      + 'plot(strategy.position_size)\nplot(strategy.closedtrades)\nplot(strategy.netprofit)\n')
    expect(cols[0][6]).toBe(2)
    expect(cols[0][7]).toBe(-3)
    expect(cols[1][7]).toBe(1)
    expect(cols[2][7]).toBe((107 - 103) * 2)
  })
  it('at the default pyramiding a second same-direction entry does not execute', () => {
    const { cols } = run(`${V5}if bar_index == 2\n    strategy.entry("A", strategy.long)\nif bar_index == 5\n    strategy.entry("B", strategy.long)\n`
      + 'plot(strategy.position_size)\nplot(strategy.opentrades)\n')
    expect(cols[0][10]).toBe(1)
    expect(cols[1][10]).toBe(1)
  })
  it('pyramiding = 2 adds, and the average is size-weighted', () => {
    const { cols } = run(`//@version=5\nstrategy("t", pyramiding = 2)\n`
      + 'if bar_index == 2\n    strategy.entry("A", strategy.long, qty = 1)\n'
      + 'if bar_index == 5\n    strategy.entry("B", strategy.long, qty = 3)\n'
      + 'plot(strategy.position_size)\nplot(strategy.position_avg_price)\n')
    expect(cols[0][6]).toBe(4)
    expect(cols[1][6]).toBeCloseTo((103 * 1 + 106 * 3) / 4, 10)
  })
  it('the same id on one bar is ONE order (modified, not duplicated)', () => {
    const { cols } = run(`//@version=5\nstrategy("t", pyramiding = 5)\n`
      + 'if bar_index == 2\n    strategy.entry("A", strategy.long, qty = 1)\n    strategy.entry("A", strategy.long, qty = 4)\n'
      + 'plot(strategy.position_size)\n')
    expect(cols[0][3]).toBe(4)
  })
})

describe('⭐⭐ price orders on the intrabar path [B-PATH] [B-GAP] [B-EXIT-BIND]', () => {
  // bar 4: open 100, nearer the HIGH -> path 100 -> 104 -> 95 -> 99
  const B = barsOf([
    [100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99, 100],
    [100, 104, 95, 99], [99, 100, 98, 99], [99, 100, 98, 99], [90, 91, 89, 90], [90, 91, 89, 90],
  ])
  it('a bracket: the leg the path reaches FIRST fills, at its level', () => {
    // entry placed on bar 2 fills at bar 3's open (100); bracket TP 103 / SL 96 is live from there.
    // bar 4 goes up to 104 first: the take-profit at 103 fills, the stop is cancelled.
    const { cols, broker } = run(`${V5}if bar_index == 2\n    strategy.entry("L", strategy.long)\n`
      + '    strategy.exit("x", "L", limit = 103, stop = 96)\nplot(strategy.position_size)\nplot(strategy.netprofit)\n', B)
    expect(cols[0][3]).toBe(1)
    expect(cols[0][4]).toBe(0)
    expect(cols[1][4]).toBe(3)
    expect(broker.closed[0].exitPrice).toBe(103)
  })
  it('the same bracket with the stop reached first along the path', () => {
    // TP 105 is never reached on bar 4 (high 104); the path then falls to 95: stop 96 fills.
    const { cols } = run(`${V5}if bar_index == 2\n    strategy.entry("L", strategy.long)\n`
      + '    strategy.exit("x", "L", limit = 105, stop = 96)\nplot(strategy.netprofit)\n', B)
    expect(cols[0][4]).toBe(-4)
  })
  it('a level crossed in the gap between bars fills at the next OPEN', () => {
    // a stop at 95.5 after bar 4 is passed overnight: bar 7 opens at 90
    const { cols, broker } = run(`${V5}if bar_index == 4\n    strategy.entry("L", strategy.long)\n`
      + 'if strategy.position_size > 0\n    strategy.exit("x", "L", stop = 95.5)\nplot(strategy.position_size)\n', B)
    expect(cols[0][5]).toBe(1)
    expect(cols[0][7]).toBe(0)
    expect(broker.closed[0].exitPrice).toBe(90)
  })
  it('profit / loss in TICKS from the entry price (mintick 0.01)', () => {
    // fill at bar 3's open 100; loss = 400 ticks -> stop 96; bar 4 falls to 95
    const { broker } = run(`${V5}if bar_index == 2\n    strategy.entry("L", strategy.long)\n`
      + '    strategy.exit("x", "L", profit = 500, loss = 400)\nplot(strategy.position_size)\n', B)
    expect(broker.closed[0].exitPrice).toBeCloseTo(96, 10)
  })
  it('an exit called with every level na and nothing waiting places nothing [B-EXIT-NA]', () => {
    const { cols } = run(`${V5}if bar_index == 2\n    strategy.entry("L", strategy.long)\n`
      + 'strategy.exit("x", "L", stop = strategy.position_avg_price * 0.5)\nplot(strategy.position_size)\n', B)
    expect(cols[0][8]).toBe(1)
  })
})

describe('⭐⭐ version, declaration and `when` [B-DEFAULTS] [B-SIG] [B-WHEN] [B-DIR]', () => {
  it('v4 `when = false` places nothing; `true` / the v4 positional `long` places', () => {
    const { cols } = run('//@version=4\nstrategy("t", default_qty_value = 2)\n'
      + 'strategy.entry("L", true, when = bar_index == 3)\nstrategy.entry("X", true, when = false)\n'
      + 'plot(strategy.position_size)\n')
    expect(cols[0][3]).toBe(0)
    expect(cols[0][4]).toBe(2)
  })
  it('v6 with no declared size: its default (percent of equity) is not served - the order stops the run', () => {
    const e = stopOf('//@version=6\nstrategy("t")\nif bar_index == 3\n    strategy.entry("L", strategy.long)\n'
      + 'plot(strategy.position_size)\n')
    expect(e.guard).toBe(BROKER_UNSETTLED_GUARD)
    expect(e.message).toMatch(/Q-S1a/)
  })
  it('v6 with an explicit fixed size is served', () => {
    const { cols } = run('//@version=6\nstrategy("t", default_qty_type = strategy.fixed, default_qty_value = 5)\n'
      + 'if bar_index == 3\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n')
    expect(cols[0][4]).toBe(5)
  })
  for (const [decl, what] of [
    ['commission_value = 0.1', 'commission_value'],
    ['process_orders_on_close = true', 'process_orders_on_close'],
    ['slippage = 2', 'slippage'],
    ['close_entries_rule = "ANY"', 'close_entries_rule'],
  ]) {
    it(`declaration \`${decl}\` refuses by name at build`, () => {
      const b = build(`//@version=5\nstrategy("t", ${decl})\nplot(strategy.position_size)\n`, QUIET)
      expect(b.ok).toBe(false)
      expect(b.refusal.guard).toBe('runtime:strategy-option')
      expect(b.refusal.message).toContain(what)
    })
  }
  it('an unserved order command / argument / value refuses by name', () => {
    const cases = [
      ['strategy.order("o", strategy.long)\n', 'runtime:strategy-option'],
      ['strategy.exit("x", trail_points = 10, trail_offset = 5)\n', 'runtime:strategy-option'],
      ['strategy.close("L", qty = 1)\n', 'runtime:strategy-option'],
      ['plot(strategy.max_drawdown)\n', 'runtime:strategy-value'],
    ]
    for (const [line, guard] of cases) {
      const b = build(`${V5}${line}plot(strategy.position_size)\n`, QUIET)
      expect([line, b.ok]).toEqual([line, false])
      expect(b.refusal.guard).toBe(guard)
    }
  })
})

describe('⭐⭐ what the broker will not guess', () => {
  it('[B-EXEC] the forming bar is not executed: every output there is na', () => {
    const { cols } = run(`${V5}plot(close)\nplot(strategy.position_size)\n`, QUIET, { confirmed: false })
    expect(cols[0][28]).toBe(128.5)
    expect(cols[0][29]).toBeNaN()
    expect(cols[1][29]).toBeNaN()
  })
  it('[B-START] a run not known to start at the listing stops by name', () => {
    const e = stopOf(`${V5}plot(strategy.position_size)\n`, QUIET, { listing: false })
    expect(e.guard).toBe(BROKER_UNSETTLED_GUARD)
    expect(e.message).toMatch(/Q-S1n/)
  })
  it('[Q-S1d] two market orders filling on one tick stop the run', () => {
    const e = stopOf(`${V5}if bar_index == 2\n    strategy.entry("L", strategy.long)\n`
      + 'if bar_index == 5\n    strategy.close("L")\n    strategy.entry("S", strategy.short)\nplot(strategy.position_size)\n')
    expect(e.guard).toBe(BROKER_UNSETTLED_GUARD)
    expect(e.message).toMatch(/Q-S1d/)
  })
  it('[Q-S1c] an open exactly half-way between high and low with a price order in range stops', () => {
    const B = barsOf([[100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99, 100], [100, 102, 98, 100], [100, 101, 99, 100]])
    const e = stopOf(`${V5}if bar_index == 1\n    strategy.entry("L", strategy.long)\n    strategy.exit("x", "L", limit = 101.5, stop = 98.5)\n`
      + 'plot(strategy.position_size)\n', B)
    expect(e.message).toMatch(/Q-S1c/)
  })
  it('[Q-S1l] an off-grid fill is not guessed: position_size still serves, netprofit stops', () => {
    const B = barsOf([[100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 95, 96], [96, 97, 95, 96]])
    const src = `${V5}if bar_index == 1\n    strategy.entry("L", strategy.long)\n    strategy.exit("x", "L", stop = 97.123)\n`
    expect(run(`${src}plot(strategy.position_size)\n`, B).cols[0][3]).toBe(0)
    const e = stopOf(`${src}plot(strategy.netprofit)\n`, B)
    expect(e.message).toMatch(/Q-S1l/)
  })
  it('[Q-S1i] a position larger than the funds (v6 margin 100) stops the run', () => {
    const e = stopOf('//@version=6\nstrategy("t", default_qty_type = strategy.fixed, default_qty_value = 5000)\n'
      + 'if bar_index == 3\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n')
    expect(e.message).toMatch(/Q-S1i/)
  })
})
