// W9 open question 9.7 (2026-11-07): what the runtime lane does with an `if` whose arms hold only
// strategy order calls, with the broker DARK (the default build). Evidence:
// docs/pine/evidence/2026-11-07-w9-open-questions/EVIDENCE.md.
//
// The `if` is NOT skipped: its test is lowered and evaluated every bar, and a `strategy.*` value in
// the test refuses `pine:strategy-call` by name. Only the order inside it is dropped. What WAS
// silently dropped was the order's ARGUMENTS: Pine evaluates them, so an argument with an effect
// (a user function that pushes to an array the script plots) changed a served value. They are now
// evaluated in place, the `alert()` rule; a pure argument is still dropped.
import { describe, it, expect } from 'vitest'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE' }
const BARS = Array.from({ length: 12 }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 1000,
}))
const build = (src) => buildRuntimeIr(src, { bars: BARS, inputs: {}, symbol: SYMBOL })
const run = (src) => {
  const built = build(src)
  if (!built.ok) return { refused: built.refusal.guard }
  const program = lowerIrProgram(built.ir, { historyFromListing: true })
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
  const res = execute(program, {
    bars: BARS.length, series, columns: program.columns, confirmed: true, barTimes: BARS.map((b) => b.t),
  })
  return { out: res.outputs.map((o) => Array.from(o)) }
}
const V5 = '//@version=5\nstrategy("t")\n'
const PUSHER = 'var a = array.new_float(0)\ng() =>\n    array.push(a, close)\n    1\n'

describe('W9 9.7 an order-only `if` with the broker dark', () => {
  it('the `if` is lowered, not skipped: its test runs every bar', () => {
    const src = `${V5}var a = array.new_float(0)\nf() =>\n    array.push(a, close)\n    true\n`
      + 'if f()\n    strategy.entry("L", strategy.long)\nplot(array.size(a))\n'
    expect(run(src).out[0]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('a strategy value in the test refuses by name', () => {
    const src = `${V5}if strategy.position_size == 0\n    strategy.entry("L", strategy.long)\nplot(close)\n`
    expect(run(src).refused).toBe('pine:strategy-call')
  })

  it('an order argument with an effect is evaluated, and only on the bars its arm runs', () => {
    const src = `${V5}${PUSHER}if bar_index % 2 == 0\n    strategy.entry("L", strategy.long, qty = g())\nplot(array.size(a))\n`
    // TradingView: the arm runs on bars 0, 2, 4, ... so the array grows on those bars only.
    expect(run(src).out[0]).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6])
  })

  it('an order argument made of value builtins adds nothing to the program', () => {
    const bare = build(`${V5}if close > 105\n    strategy.entry("L", strategy.long)\nplot(close)\n`)
    const pure = build(`${V5}if close > 105\n    strategy.entry("L", strategy.long, qty = math.max(1, ta.sma(close, 3)))\nplot(close)\n`)
    expect(bare.ok && pure.ok).toBe(true)
    expect(JSON.stringify(pure.ir)).toBe(JSON.stringify(bare.ir))
  })

  it('a namespaced effect in an argument is evaluated too (a method push, not only a user function)', () => {
    const src = `${V5}var a = array.new_float(0)\n`
      + 'strategy.entry("L", strategy.long, comment = str.tostring(array.push(a, close)))\nplot(array.size(a))\n'
    const r = run(src)
    // Evaluated, or refused by name; never the old silent 0 on every bar.
    if (r.refused) expect(r.refused).toMatch(/^runtime:/)
    else expect(r.out[0]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('every effectful argument of one order is evaluated, not only the first', () => {
    const src = `${V5}${PUSHER}strategy.exit("x", "L", stop = g(), limit = g())\nplot(array.size(a))\n`
    expect(run(src).out[0]).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24])
  })

  it('a v4 bare builtin under an operator in an order argument stays a value', () => {
    const src = '//@version=4\nstrategy("t")\nif close > 0\n'
      + '    strategy.close("L", when = crossover(close, sma(close, 3)) and close > 0)\nplot(close)\n'
    const r = run(src)
    expect(r.refused).toBeUndefined()
    expect(r.out[0]).toEqual(BARS.map((b) => b.c))
  })

  it('a v4 bare builtin in an order argument stays a value: the script is still served', () => {
    // `highlow-channel-swing` (committed corpus) closes on `when = crossover(...)`; evaluating that
    // inside the arm would refuse `runtime:conditional-history` for a value nothing reads.
    const src = '//@version=4\nstrategy("t")\nif close > 0\n'
      + '    strategy.close("L", when = crossover(close, sma(close, 3)))\nplot(close)\n'
    const r = run(src)
    expect(r.refused).toBeUndefined()
    expect(r.out[0]).toEqual(BARS.map((b) => b.c))
  })
})

// W9-OQ-N1 (review N1 on #935): a `strategy.*` READ call inside a dark order's argument is a value at
// that site. The order is dropped, so the read reaches nothing served and the rest of the script is
// served. Where its value CAN reach served output (a plot, an alert message, an effect that a plot
// reads) it still refuses `pine:strategy-call` by name.
describe('W9-OQ-N1 strategy.* reads in a dark order argument', () => {
  const BARE_EXIT = `${V5}if close > 0\n    strategy.exit("x", "L")\nplot(close)\n`

  it('a read in an exit stop does not reach output: the script is served, the program unchanged', () => {
    const src = `${V5}if close > 0\n    strategy.exit("x", "L", stop = strategy.opentrades.entry_price(0) * 0.9)\nplot(close)\n`
    const r = run(src)
    expect(r.refused).toBeUndefined()
    expect(r.out[0]).toEqual(BARS.map((b) => b.c))
    expect(JSON.stringify(build(src).ir)).toBe(JSON.stringify(build(BARE_EXIT).ir))
  })

  it('a closed-trade read in an order comment does not reach output: the script is served', () => {
    const src = `${V5}strategy.entry("L", strategy.long, comment = str.tostring(strategy.closedtrades.profit(0)))\nplot(close)\n`
    const r = run(src)
    expect(r.refused).toBeUndefined()
    expect(r.out[0]).toEqual(BARS.map((b) => b.c))
  })

  it('the same read reaching a plot refuses by name', () => {
    const built = build(`${V5}if close > 0\n    strategy.exit("x", "L")\nplot(strategy.opentrades.entry_price(0))\n`)
    expect(built.ok).toBe(false)
    expect(built.refusal.guard).toBe('pine:strategy-call')
    expect(built.refusal.token).toBe('strategy.opentrades.entry_price')
  })

  it('a read feeding an effect in the order argument reaches a plot through it: refuses by name', () => {
    const src = `${V5}var a = array.new_float(0)\nh(x) =>\n    array.push(a, x)\n    1\n`
      + 'strategy.entry("L", strategy.long, qty = h(strategy.opentrades.entry_price(0)))\n'
      + 'plot(array.size(a) > 0 ? array.get(a, array.size(a) - 1) : na)\n'
    const built = build(src)
    expect(built.ok).toBe(false)
    expect(built.refusal.guard).toBe('pine:strategy-call')
    expect(built.refusal.token).toBe('strategy.opentrades.entry_price')
  })

  it('a read in an alert message reaches served output: alert() still refuses by name', () => {
    const built = build(`${V5}alert(str.tostring(strategy.closedtrades.profit(0)))\nplot(close)\n`)
    expect(built.ok).toBe(false)
    expect(built.refusal.guard).toBe('pine:strategy-call')
    expect(built.refusal.token).toBe('strategy.closedtrades.profit')
  })
})
