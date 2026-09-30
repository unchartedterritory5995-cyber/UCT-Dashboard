// ─── ⭐⭐ C26 — ANOTHER SYMBOL'S BARS ON THIS CHART: exact, or withheld ─────────
//
// `sym` aligns the supplied series on the bar's own `t`, exact match, never
// forward-filled. These rails pin the two things C26 adds on top of that rule:
//
//   1. A chart bar whose counterpart is MISSING after the other symbol's history
//      began (TradingView's default `gaps_off` carries the previous bar there) is
//      UNKNOWN, and so is every root bar within the tree's reach of it — so `nz`,
//      `na()` or a `[k]` read of it can never answer with a confident wrong value.
//      A bar BEFORE the other history began is TradingView's `na` too: served.
//   2. `historyFromListing` describes the CHART's series only; a `sym` child runs
//      on the supplied series with the bounded warm-up.
//
// And the boundary: a caller that supplies no `symbols` gets the column it always
// got.

import { describe, it, expect } from 'vitest'
import { interpret, symAlignmentMask } from './interpret'
import { translatePine } from './pine'

const day = (d, c) => ({ t: d, o: c, h: c, l: c, c, v: 1 })
const CHART = [day('2026-01-02', 10), day('2026-01-05', 11), day('2026-01-06', 12), day('2026-01-07', 13), day('2026-01-08', 14)]
// SPY starts on 01-05 (so 01-02 is before its history) and has NO bar on 01-07.
const SPY = [day('2026-01-05', 500), day('2026-01-06', 501), day('2026-01-08', 503)]
const close = { type: 'series', name: 'close' }
const sym = (child) => ({ type: 'sym', value: 'SPY', args: [child] })
const run = (ast, opts) => Array.from(interpret(ast, CHART, {}, undefined, undefined, opts))

describe('exact alignment, and what it cannot tell apart', () => {
  it('the aligned column: SPY where a bar matches, NaN where none does', () => {
    const got = run(sym(close), { symbols: { SPY } })
    expect(got.map((v) => (Number.isNaN(v) ? null : v))).toEqual([null, 500, 501, null, 503])
  })

  it('⭐ nz() of a MISSING bar is withheld, not 0 — and before the history began nz() is served', () => {
    const ast = { type: 'call', name: 'nz', args: [sym(close), { type: 'num', value: 0 }] }
    const got = run(ast, { symbols: { SPY } })
    // 01-02: SPY has no history yet -> TradingView's na too -> nz = 0 is its answer
    expect(got[0]).toBe(0)
    expect(got[1]).toBe(500)
    // 01-07: SPY's bar is missing after its history began -> unknown, never 0
    expect(Number.isNaN(got[3])).toBe(true)
    expect(got[4]).toBe(503)
  })

  it('⭐ a lookback carries the unknown bar forward exactly as far as it reaches', () => {
    const ast = { type: 'offset', value: 1, args: [sym(close)] }
    const mask = symAlignmentMask(ast, CHART, { symbols: { SPY } })
    // reach 1 above the sym node: bar 3 (missing) and bar 4 (reads bar 3) withheld
    expect(Array.from(mask)).toEqual([0, 0, 0, 1, 1])
  })

  it('an unsupplied ticker is unknown on every bar', () => {
    const mask = symAlignmentMask(sym(close), CHART, { symbols: {} })
    expect(Array.from(mask)).toEqual([1, 1, 1, 1, 1])
  })

  it('a fully aligned series withholds nothing', () => {
    const full = CHART.map((b) => day(b.t, b.c * 50))
    expect(symAlignmentMask(sym(close), CHART, { symbols: { SPY: full } })).toBe(null)
  })

  it('⛔ BOUNDARY: no `symbols` supplied -> the column this caller always got', () => {
    const ast = { type: 'call', name: 'nz', args: [sym(close), { type: 'num', value: 0 }] }
    expect(run(ast, undefined)).toEqual([0, 0, 0, 0, 0])
  })
})

describe('historyFromListing is the chart\'s fact, never the other symbol\'s', () => {
  it('a Pine `var` read through `sym` keeps the bounded warm-up although the chart starts at its listing', () => {
    const N = 300
    const bars = Array.from({ length: N }, (_, i) => ({ t: 1700000000 + i * 86400, o: 1, h: 2, l: 0, c: 100 + (i % 5), v: 1 }))
    const t = translatePine(['//@version=5', 'indicator("x")', 'var float b = 7.0', 'b := close > 103 ? close : b', 'plot(b)'].join('\n'))
    const tree = t.outputs.find((o) => o && o.ast).ast
    // control: on the chart's own series the listing fact fills the warm-up prefix
    const own = Array.from(interpret(tree, bars, {}, undefined, undefined, { historyFromListing: true }))
    expect(own.slice(0, 250).some(Number.isNaN)).toBe(false)
    // through `sym` the same statement must not reach the other series
    const other = Array.from(interpret({ type: 'sym', value: 'SPY', args: [tree] }, bars, {}, undefined, undefined,
      { historyFromListing: true, symbols: { SPY: bars } }))
    expect(other.slice(0, 250).every(Number.isNaN)).toBe(true)
    expect(other.slice(260).some(Number.isNaN)).toBe(false)
  })
})
