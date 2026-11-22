// Q-S1i [B-MARGIN-CALL] rails: TradingView's margin call on the shape w9-q-s1i-short-v6 witnesses.
//
// The capture itself is graded MATCH by `__tests__/vendorHarness/strategyGrading.test.js` (its verdict file,
// `docs/pine/vendor-harness/strategy-verdicts/w9-q-s1i-short-v6-rddt-1d-2026-11-16.json`): 22 closed trades, 13 of
// them margin calls, 32 fills, 39 value series and 22 label texts. These rails hold the rule on hand-built bars,
// every number worked by hand in the comment beside it from the User Manual's algorithm ("Margin and leverage"):
//   MVS = qty x price; Open Profit = -(MVS - qty x entry) for a short; Equity = 100,000 + net + Open Profit;
//   Available Funds = Equity - MVS x 1 (margin_short 100); Cover = TRUNCATE(Available / 1 / price); size = |Cover| x 4.
// and the timing the capture witnesses: each tick of the path (the open after its fills, then the extremes and the
// close), the fill at that tick rounded to the nearest tick.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE' } // mintick 0.01, pointvalue 1
const barsOf = (rows) => rows.map(([o, h, l, c], i) => ({ t: 1700000000 + i * 86400, o, h, l, c, v: 1000 }))
const ALL = () => true
const FLAT = [100, 101, 99, 100]
/** bars 0-3 flat (bar 3 closes 100: 100,000 / 100 = 1000 units short); bar 4 opens 99 (1000 x 99 = 99,000 within
 *  the funds) and rises to `high`; then flat at 100 / 101 / 99 / 100 */
const SPIKE = (high, more = []) => barsOf([FLAT, FLAT, FLAT, FLAT, [99, high, 98.5, 100], ...more,
  ...Array.from({ length: 10 }, () => FLAT)])
const run = (src, bars, { pins = ALL, minContract = 1 } = {}) => {
  const built = buildRuntimeIr(src, { bars, inputs: {}, symbol: SYMBOL, strategyBroker: true })
  if (!built.ok) return { refused: built.refusal }
  const program = lowerIrProgram(built.ir, { historyFromListing: true })
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const ctx = { bars: bars.length, series, columns: program.columns, confirmed: true, barTimes: bars.map((b) => b.t),
    historyWindowBars: 5000, ...(minContract === null ? {} : { minContract }) }
  try {
    const res = execute(program, ctx, undefined, { brokerPinned: pins })
    return { res, cols: res.outputs.map((o) => Array.from(o)), rec: res.broker.record }
  } catch (err) { return { err } }
}
const SHORT = (decl = '') => `//@version=6\nstrategy("t"${decl})\nif bar_index == 3\n    strategy.entry("S", strategy.short)\n`
  + 'if bar_index == 12\n    strategy.close("S")\nplot(strategy.position_size)\n'
  + 'plot(strategy.closedtrades > 0 ? (strategy.closedtrades.exit_id(0) == "Close position order" ? 1 : 0) : -1)\n'
  + 'plot(strategy.closedtrades > 0 ? (strategy.closedtrades.exit_comment(0) == "Margin call" ? 1 : 0) : -1)\n'

describe('[B-MARGIN-CALL] the witnessed shape: one short trade at margin_short 100', () => {
  it('Available Funds below zero at the high: 4 x the cover is bought back THERE, the trade splits, the texts read back', () => {
    // bar 4 high 103: MVS 103,000; Open Profit -(103,000 - 99,000) = -4,000; Equity 96,000; Available -7,000;
    // Cover TRUNCATE(-7,000 / 103) = -67; size 268. Path: the open (99) is nearer the low, so open -> low -> high -> close
    const { cols, err, rec } = run(SHORT(), SPIKE(103))
    expect(err, err && err.message).toBeUndefined()
    expect(cols[0][3]).toBe(0)
    expect(cols[0][4]).toBe(-732) // 1000 - 268
    expect(cols[1][3]).toBe(-1)
    expect(cols[1][4]).toBe(1) // exit_id "Close position order"
    expect(cols[2][4]).toBe(1) // exit_comment "Margin call"
    const mc = rec.orders.filter((o) => o.kind === 'margin_call')
    expect(mc.map((o) => [o.side, o.fillPrice, o.fillQty, o.comment, o.rule, o.id])).toEqual([['buy', 103, 268, 'Margin call', 'B-MARGIN-CALL', null]])
    expect(rec.trades.map((t) => [t.qty, t.entry.price, t.exit && t.exit.price, t.exit && t.exit.rule]))
      .toEqual([[268, 99, 103, 'B-MARGIN-CALL'], [732, 99, 100, 'B-CLOSE']])
    expect(rec.rulesUsed).toEqual(expect.arrayContaining(['B-MARGIN', 'B-MARGIN-CALL']))
  })
  it('the fill is the tick\'s price ROUNDED to the nearest tick (103.001 -> 103.00), the size the same at both', () => {
    // at 103.001: Available -7,002, Cover TRUNCATE(-67.98) = -67; at 103.00: -67 too -> 268 at 103
    const { err, rec } = run(SHORT(), SPIKE(103.001))
    expect(err, err && err.message).toBeUndefined()
    expect(rec.orders.filter((o) => o.kind === 'margin_call').map((o) => [o.fillPrice, o.fillQty])).toEqual([[103, 268]])
  })
  it('a call due at the OPEN (after its fills) is taken at the open; the high after it takes none', () => {
    // after bar 4 (268 called at 103): 732 at 99, net -1,072. Bar 5 opens 125: MVS 91,500; Open Profit -19,032;
    // Equity 79,896; Available -11,604; Cover TRUNCATE(-92.83) = -92; size 368 at 125. At its high 126: 364 left,
    // net -1,072 - 26 x 368 = -10,640; MVS 45,864; Open Profit -9,828; Available 33,668: no call
    const { err, rec } = run(SHORT(), SPIKE(103, [[125, 126, 124.5, 125]]))
    expect(err, err && err.message).toBeUndefined()
    expect(rec.orders.filter((o) => o.kind === 'margin_call').map((o) => [o.fillTime - 1700000000, o.fillPrice, o.fillQty]))
      .toEqual([[4 * 86400, 103, 268], [5 * 86400, 125, 368]])
  })
  it('control: a short that never runs short of funds is untouched (no call, the rule never asked)', () => {
    // 1000 short at 99: Available = 199,000 - 2,000 x price, below zero only above 99.5; these bars never reach it
    const LOW = barsOf([FLAT, FLAT, FLAT, FLAT, [99, 99.4, 98, 98.5], ...Array.from({ length: 10 }, () => [98, 99, 97, 98])])
    const { err, rec, cols } = run(SHORT(), LOW)
    expect(err, err && err.message).toBeUndefined()
    expect(cols[0][4]).toBe(-1000)
    expect(rec.orders.some((o) => o.kind === 'margin_call')).toBe(false)
    expect(rec.rulesUsed).not.toContain('B-MARGIN-CALL')
    expect(rec.rulesUsed).toContain('B-MARGIN')
  })
  it('with B-MARGIN-CALL unpinned the run stops at the call by name, under the rule that will pin it', () => {
    const { err } = run(SHORT(), SPIKE(103), { pins: (id) => id !== 'B-MARGIN-CALL' })
    expect(err && err.rule).toBe('B-MARGIN-CALL')
    expect(err.guard).toBe('runtime:strategy-unpinned')
  })
})

describe('[B-MARGIN-CALL] what the capture does not witness still stops by name (Q-S1i)', () => {
  const stops = (src, bars, what, opts) => {
    const { err } = run(src, bars, opts)
    expect(err && err.guard, src).toBe('runtime:strategy-unsettled')
    expect(err.probe).toBe('Q-S1i')
    if (what) expect(err.message).toMatch(what)
  }
  it('a margin_short other than 100 (here 50, a fixed 2,000 units: Available at 103 is 92,000 - 103,000 = -11,000)', () => {
    stops(SHORT(', margin_short = 50, margin_long = 50, default_qty_type = strategy.fixed, default_qty_value = 2000'),
      SPIKE(103), /margin_short of 50/)
  })
  it('an exit bound to the trade, an unknown minimum contract', () => {
    const withExit = SHORT().replace('strategy.entry("S", strategy.short)\n',
      'strategy.entry("S", strategy.short)\n    strategy.exit("x", "S", stop = 200)\n')
    stops(withExit, SPIKE(103), /an exit bound to the trade/)
    // (a fixed size, so the sizing itself never asks for the minimum contract)
    stops(SHORT(', default_qty_type = strategy.fixed, default_qty_value = 1000'), SPIKE(103), /minimum contract/, { minContract: null })
  })
  it('a size that differs between the tick\'s price and its rounded fill (103.004: 272 at the price, 268 at 103.00)', () => {
    stops(SHORT(), SPIKE(103.004), /which of the two TradingView computes with/)
  })
  it('a call due at an open where an order fills too (bar 12\'s close fills at bar 13\'s open of 125)', () => {
    // position 732 at 99 after bar 4; at 125: Available -11,604 (the third rail), due before the close's fill
    const bars = barsOf([FLAT, FLAT, FLAT, FLAT, [99, 103, 98.5, 100], ...Array.from({ length: 8 }, () => FLAT),
      [125, 126, 124.5, 125], FLAT, FLAT])
    stops(SHORT(), bars, /same tick as an order's fill/)
  })
})

describe('[B-MARGIN-CALL-ALL] a size above the trade closes the whole trade (w9-q-s1b-defaults-v6, bar 154)', () => {
  // ⚰️ this stopped by name (Q-S1i) until w9-q-s1b-defaults-v6 was read (2026-11-17): its bar 154 sizes 1,540 of a
  // short of 1,306 at the open 104.90 and TradingView closes the 1,306
  it('an open of 140: Cover TRUNCATE(-33,564 / 140) = -239, size 956 of a trade of 732: all 732 bought back at 140', () => {
    const { err, rec, cols } = run(SHORT(), SPIKE(103, [[140, 141, 139.5, 140]]))
    expect(err, err && err.message).toBeUndefined()
    expect(cols[0][5]).toBe(0)
    expect(rec.orders.filter((o) => o.kind === 'margin_call').map((o) => [o.fillPrice, o.fillQty])).toEqual([[103, 268], [140, 732]])
    expect(rec.rulesUsed).toEqual(expect.arrayContaining(['B-MARGIN-CALL', 'B-MARGIN-CALL-ALL']))
  })
  it('a call within the trade never asks it; unpinned, the capped call stops by name', () => {
    expect(run(SHORT(), SPIKE(103)).rec.rulesUsed).not.toContain('B-MARGIN-CALL-ALL')
    const { err } = run(SHORT(), SPIKE(103, [[140, 141, 139.5, 140]]), { pins: (id) => id !== 'B-MARGIN-CALL-ALL' })
    expect(err && err.rule).toBe('B-MARGIN-CALL-ALL')
  })
})
