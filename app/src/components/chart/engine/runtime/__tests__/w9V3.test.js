// [B-V3] rails: Pine v2 / v3 strategies, on what the two committed v2 / v3 report captures witness.
//
// The captures themselves are graded MATCH by `__tests__/vendorHarness/strategyGrading.test.js` (their verdict files:
// w9-q-s1a-size-v2 20 trades, 9 value series; w9-g1-v3-properties 20 trades, 2 value series). No v2 / v3 reference
// was read: what is served is exactly the calls those captures make (`strategy.entry(id, direction)` and
// `strategy.close(id)` by position, a named `when`) and the Properties TradingView read back for them (fixed size 1,
// capital 100,000, pyramiding 1, no cost, no margin input). Everything else refuses by name.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE' } // mintick 0.01, pointvalue 1
const barsOf = (rows) => rows.map(([o, h, l, c], i) => ({ t: 1700000000 + i * 86400, o, h, l, c, v: 1000 }))
const ALL = () => true
/** open 100 + i, high 101.5 + i, low 99 + i, close 100.5 + i */
const BARS = barsOf(Array.from({ length: 30 }, (_, i) => [100 + i, 101.5 + i, 99 + i, 100.5 + i]))
const run = (src, { pins = ALL, bars = BARS } = {}) => {
  const built = buildRuntimeIr(src, { bars, inputs: {}, symbol: SYMBOL, strategyBroker: true })
  if (!built.ok) return { refused: built.refusal }
  const program = lowerIrProgram(built.ir, { historyFromListing: true })
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const ctx = { bars: bars.length, series, columns: program.columns, confirmed: true, barTimes: bars.map((b) => b.t),
    historyWindowBars: 5000, minContract: 1 }
  try {
    const res = execute(program, ctx, undefined, { brokerPinned: pins })
    return { res, cols: res.outputs.map((o) => Array.from(o)), rec: res.broker.record }
  } catch (err) { return { err } }
}
// v2 has no `if` and no `bar_index`: the condition rides `when` (the committed v2 probe's own shape). BARS close at
// 100.5 + i, so AT3 holds on bar 3 alone and AT8 on bar 8 alone.
const AT3 = 'close > 103 and close < 104'
const AT8 = 'close > 108 and close < 109'
const ENTRY = `strategy.entry("L", strategy.long, when = ${AT3})`
const CLOSE = `strategy.close("L", when = ${AT8})`
const V2 = (decl = '', entry = ENTRY, close = CLOSE) =>
  `//@version=2\nstrategy(title="t", overlay=false${decl})\n${entry}\n${close}\nplot(strategy.position_size, title="p")\n`
const V3 = `//@version=3\nstrategy("t", overlay=false)\nif (${AT3})\n    strategy.entry("L", strategy.long)\n`
  + `if (${AT8})\n    strategy.close("L")\nplot(strategy.position_size, title="p")\n`
const built = (r) => (r.refused ? `refused at build: ${r.refused.guard} ${r.refused.message}` : (r.err ? r.err.message : undefined))

describe('[B-V3] the witnessed v2 / v3 calls run, at the read-back defaults', () => {
  it('v2: `strategy.entry(id, direction, when = ...)` and `strategy.close(id, when = ...)`: one unit (the read-back fixed 1)', () => {
    const r = run(V2())
    expect(built(r)).toBeUndefined()
    expect(r.cols[0][3]).toBe(0)
    expect(r.cols[0][4]).toBe(1)
    expect(r.cols[0][9]).toBe(0)
    expect(r.rec.trades.map((t) => [t.id, t.qty, t.entry.price, t.exit && t.exit.price])).toEqual([['L', 1, 104, 109]])
    expect(r.rec.rulesUsed).toEqual(expect.arrayContaining(['B-V3', 'B-SIG', 'B-WHEN', 'B-MARGIN']))
  })
  it('v3: the same calls inside `if`, by position', () => {
    const r = run(V3)
    expect(built(r)).toBeUndefined()
    expect(r.cols[0][4]).toBe(1)
    expect(r.cols[0][9]).toBe(0)
  })
  it('with B-V3 unpinned a v2 / v3 run stops before its first bar, by name', () => {
    const { err } = run(V2(), { pins: (id) => id !== 'B-V3' })
    expect(err && err.rule).toBe('B-V3')
    expect(err.guard).toBe('runtime:strategy-unpinned')
  })
})

describe('[B-V3] what the captures do not witness still refuses by name', () => {
  const refusedAtBuild = (src, what) => {
    const r = run(src)
    expect(r.refused && r.refused.guard, src).toBe('runtime:strategy-option')
    if (what) expect(r.refused.message).toMatch(what)
  }
  it('another argument by position, or another named argument than `when`', () => {
    refusedAtBuild(V2('', `strategy.entry("L", strategy.long, 5, when = ${AT3})`), /by position in Pine version 2/)
    refusedAtBuild(V2('', `strategy.entry("L", strategy.long, comment = "x", when = ${AT3})`), /has no parameter `comment` in Pine version 2/)
  })
  it('another order command in v2 / v3 (strategy.close_all)', () => {
    refusedAtBuild(V2('', ENTRY, `strategy.close_all(when = ${AT8})`), /`strategy.close_all` in Pine version 2/)
  })
  it('a margin declared on a version whose Properties read back none', () => {
    refusedAtBuild(V2(', margin_long=50'), /margin_long/)
  })
  it('a position worth more than the equity (no margin setting is read back, so what TradingView does is not witnessed)', () => {
    const { err } = run(V2(', default_qty_value=2000'))
    expect(err && err.probe).toBe('W9-G1')
    expect(err.message).toMatch(/no margin setting/)
  })
})
