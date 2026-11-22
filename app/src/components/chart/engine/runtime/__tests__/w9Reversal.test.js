// Q-S1a [B-QTY-REVERSE] / [B-FUNDS-REVERSE] / Q-S1d [B-ENTRY-ORDER] rails: the reversal at the v6 default size,
// on the shape w9-q-s1b-defaults-v6 witnesses.
//
// The capture itself is graded MATCH by `__tests__/vendorHarness/strategyGrading.test.js` (its verdict file): 30
// closed trades (12 reversals, 18 margin calls), 32 fills, 38 value series, 30 label texts. These rails hold the
// rules on hand-built bars, every number worked by hand beside it:
//   - a reversal's new size = floor(strategy.equity at the signal close, the open trade's profit included, / close);
//     the order fills the open size plus it;
//   - it is rejected whole when the new size x fill price exceeds THAT equity (not the equity re-marked at the fill);
//   - several market entries on one opening tick are taken in the order they were placed.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE' } // mintick 0.01, pointvalue 1
const barsOf = (rows) => rows.map(([o, h, l, c], i) => ({ t: 1700000000 + i * 86400, o, h, l, c, v: 1000 }))
const ALL = () => true
const FLAT = [100, 101, 99, 100]
/** bar 3 closes 100: 1000 long, filled at bar 4's open 99. The price rises to bar 7's close of 110 (the short signal):
 *  equity 100,000 + 1000 x (110 - 99) = 111,000, new short floor(111,000 / 110) = 1009. `open8` is bar 8's open. */
const BARS = (open8) => barsOf([FLAT, FLAT, FLAT, FLAT, [99, 100, 98.5, 99.5], [100, 105, 99.5, 104], [104, 109, 103, 108],
  [108, 111, 107, 110], [open8, open8, 105, 106], ...Array.from({ length: 6 }, () => [105, 106, 104, 105])])
const run = (src, bars, { pins = ALL } = {}) => {
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
const SCRIPT = (decl = '', bar7 = '    strategy.entry("S", strategy.short)\n') => `//@version=6\nstrategy("t"${decl})\n`
  + 'if bar_index == 3\n    strategy.entry("L", strategy.long)\n'
  + `if bar_index == 7\n${bar7}plot(strategy.position_size)\n`

describe('[B-QTY-REVERSE] the reversal at the v6 default', () => {
  it('fills the open 1000 plus floor(111,000 / 110) = 1009 at bar 8\'s open (109 x 1009 = 109,981 within 111,000)', () => {
    const { err, rec, cols } = run(SCRIPT(), BARS(109))
    expect(err, err && err.message).toBeUndefined()
    expect(cols[0][7]).toBe(1000)
    expect(cols[0][8]).toBe(-1009)
    const s = rec.orders.find((o) => o.id === 'S')
    expect([s.status, s.fillPrice, s.fillQty, s.closed.length]).toEqual(['filled', 109, 1009, 1])
    expect(rec.trades.map((t) => [t.id, t.qty, t.entry.price, t.exit && t.exit.price])).toEqual([['L', 1000, 99, 109], ['S', 1009, 109, undefined]])
    expect(rec.rulesUsed).toEqual(expect.arrayContaining(['B-QTY-REVERSE', 'B-REVERSE']))
    expect(rec.rulesUsed).not.toContain('B-FUNDS-REVERSE')
  })
  it('with B-QTY-REVERSE unpinned the run stops at the sizing, by name', () => {
    const { err } = run(SCRIPT(), BARS(109), { pins: (id) => id !== 'B-QTY-REVERSE' })
    expect(err && err.rule).toBe('B-QTY-REVERSE')
  })
  it('a percent other than 100 still stops by name (Q-S1a): witnessed at the v6 default only', () => {
    const { err } = run(SCRIPT(', default_qty_value = 50'), BARS(109))
    expect(err && err.probe).toBe('Q-S1a')
    expect(err.message).toMatch(/while trades are open/)
  })
})

describe('[B-FUNDS-REVERSE] past the equity it was sized from: rejected whole', () => {
  it('bar 8 opens 111: 1009 x 111 = 111,999 > 111,000 -> no close, no short, the long stays (and would FIT the equity re-marked at the open, 112,000)', () => {
    const { err, rec, cols } = run(SCRIPT(), BARS(111))
    expect(err, err && err.message).toBeUndefined()
    expect(cols[0][8]).toBe(1000)
    expect(cols[0][14]).toBe(1000)
    const s = rec.orders.find((o) => o.id === 'S')
    expect([s.status, s.why, s.fillQty]).toEqual(['rejected', 'funds', null])
    expect(rec.trades.map((t) => [t.id, t.qty, Boolean(t.exit)])).toEqual([['L', 1000, false]])
    expect(rec.rulesUsed).toEqual(expect.arrayContaining(['B-FUNDS-REVERSE', 'B-QTY-REVERSE']))
    expect(rec.rulesUsed).not.toContain('B-REVERSE')
  })
  it('with B-FUNDS-REVERSE unpinned the rejection stops by name', () => {
    const { err } = run(SCRIPT(), BARS(111), { pins: (id) => id !== 'B-FUNDS-REVERSE' })
    expect(err && err.rule).toBe('B-FUNDS-REVERSE')
  })
})

describe('the same side while a trade is open: sized only if it fills', () => {
  it('at the pyramiding limit the order is rejected without a size (no stop)', () => {
    const { err, rec, cols } = run(SCRIPT('', '    strategy.entry("L2", strategy.long)\n'), BARS(109))
    expect(err, err && err.message).toBeUndefined()
    expect(cols[0][8]).toBe(1000)
    const l2 = rec.orders.find((o) => o.id === 'L2')
    expect([l2.status, l2.why, l2.qty]).toEqual(['rejected', 'pyramiding', null])
  })
  it('with room to pyramid it would fill, and which equity sizes it is not stated: stops by name (Q-S1a)', () => {
    const { err } = run(SCRIPT(', pyramiding = 2', '    strategy.entry("L2", strategy.long)\n'), BARS(109))
    expect(err && err.probe).toBe('Q-S1a')
    expect(err.message).toMatch(/`L2` takes a percent-of-equity default size while trades are open/)
  })
})

describe('[B-ENTRY-ORDER] several market entries on one opening tick, in the order they were placed', () => {
  it('`L2` placed first is rejected at the pyramiding limit, then `S` reverses the long', () => {
    const { err, rec, cols } = run(SCRIPT('', '    strategy.entry("L2", strategy.long)\n    strategy.entry("S", strategy.short)\n'), BARS(109))
    expect(err, err && err.message).toBeUndefined()
    expect(cols[0][8]).toBe(-1009)
    expect(rec.orders.filter((o) => o.id !== 'L').map((o) => [o.id, o.status])).toEqual([['L2', 'rejected'], ['S', 'filled']])
    expect(rec.rulesUsed).toEqual(expect.arrayContaining(['B-ENTRY-ORDER', 'B-PYR']))
  })
  it('`S` placed first fills with `L2` still waiting on the tick: not witnessed, stops by name (Q-S1d)', () => {
    const { err } = run(SCRIPT('', '    strategy.entry("S", strategy.short)\n    strategy.entry("L2", strategy.long)\n'), BARS(109))
    expect(err && err.probe).toBe('Q-S1d')
  })
  it('with B-ENTRY-ORDER unpinned the tick stops by name', () => {
    const { err } = run(SCRIPT('', '    strategy.entry("L2", strategy.long)\n    strategy.entry("S", strategy.short)\n'), BARS(109),
      { pins: (id) => id !== 'B-ENTRY-ORDER' })
    expect(err && err.rule).toBe('B-ENTRY-ORDER')
  })
})
