// ─── ⭐⭐ LANE B0 (2026-11-09) — FIRST-BAR AND `na`-SEED RULES, FROM THE LISTING ─────
//
// Two engine rules, each witnessed by a FROM-LISTING NYSE:RDDT capture (no history
// excuse: the vendor's bar 0 is ours):
//
//   1. AN UNMARKED `na` SEED IS A HISTORY SEED (`interpret.js::historySeedReading`).
//      `x = init` + `x := … x[1] …` (and a `var` folded to `na` by `varSeedOf`) runs
//      its update on bar 0 with `x[1]` = `na`. The listing pass also kept "bar 0 IS the
//      `na` seed" as a candidate and withheld bar 0 wherever the two differed.
//      Witnesses: `vw-ratchet-stops-rddt-1d-2026-10-02` R03 (1 on bar 0),
//      `optimized-keltner-channels-sltp-strategy-for-btc-rddt-1d-2026-10-02` (0 on bar 0),
//      `twin-range-filter-rddt-1d-2026-10-02` (11 signal bars), the vendor rails in
//      `vendorHarness.capRound4.test.js` / `vendorHarness.coverageAudit.test.js`.
//      The one spelling whose bar 0 IS its `na` seed, `x = na(x[k]) ? na : U`, is
//      `na` on every bar in Pine and is translated as that constant
//      (`pine.js::naSeededSelfReference`).
//   2. `ta.wma`'S WARM-UP COUNTS FINITE OBSERVATIONS (`interpret.js::rolling`,
//      `runtime/vm.js` policy `ffill`). Witness: `trend-targets-algoalpha-rddt-1d`,
//      whose `ta.ema(ta.wma(src, 40), 14)` over a source finite on bar 0, `na` on
//      1..88, finite from 89 first answers on bar 140 (wma on 127) — TradingView's to
//      6e-16. Both lanes answer it, and agree.
//
// Pine reference (v6, `ta.wma` / `ta.ema` / `na` entries): `ta.ema`'s Pine spelling
// seeds from `na(sum[1])`; the `na` entry's `nz(close[1], close)` example is the
// history read that is `na` before the first bar.

import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'
import { interpret, historySeedReading, listingSeedIsUnpinned } from './interpret.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'

const N = 200
// bars 1..88 close above 1000 (a `na` hole once the script masks them); bar 0 and 89+ below
const CLOSE = Array.from({ length: N }, (_, i) => (i >= 1 && i <= 88 ? 2000 + i : 100 + 5 * Math.sin(i / 5) + i / 10))
const BARS = CLOSE.map((c, i) => ({ t: 1700000000 + i * 86400, o: c, h: c + 1, l: c - 1, c, v: 1000 + i }))

const treeOf = (src) => {
  const t = translatePine(src)
  const out = (t.outputs || []).find((o) => o && o.ast)
  if (!out) throw new Error(`no output tree: ${JSON.stringify(t.refusals || t.reason || t).slice(0, 300)}`)
  return out.ast
}
const listing = { historyFromListing: true, naConditionFalse: true }
const host = (src, opts) => Array.from(interpret(treeOf(src), BARS, {}, undefined, undefined, opts))
const pine = (v, lines) => [`//@version=${v}`, v >= 5 ? 'indicator("b0")' : 'study("b0")', ...lines].join('\n')
/** The opts the member door passes for a document of version `v` (`nativeRegistry.listingOptsFor`). */
const listingFor = (v) => ({ historyFromListing: true, naConditionFalse: v >= 4,
  ...(listingSeedIsUnpinned(v) ? { listingSeedUnpinned: true } : {}) })

function runtime(src) {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir, { historyFromListing: true })
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
  const r = execute(program, { bars: N, series, columns: program.columns, confirmed: true })
  return Array.from(r.outputs[0])
}

describe('⭐⭐ rule 1 — an unmarked `na` seed runs its update on bar 0 (from the listing)', () => {
  it('the R03 shape: `t = 1`, `t := nz(t[1], t)`, then a `?:` on it — 1 on bar 0 (TradingView 1)', () => {
    const src = pine(5, ['t = 1', 't := nz(t[1], t)', 't := t == 1 and close < 0 ? -1 : t', 'plot(t)'])
    const got = host(src, listing)
    expect(got[0]).toBe(1)
    expect(got.every((v) => v === 1)).toBe(true)
  })

  it('the Keltner shape: `b = 0.0`, `b := c ? close : nz(b[1])` — 0 on bar 0 (TradingView 0)', () => {
    const src = pine(4, ['b = 0.0', 'b := close > 3000 ? close : nz(b[1])', 'plot(b)'])
    expect(host(src, listing)[0]).toBe(0)
  })

  it('control: off the listing nothing moves — bar 0 is still the curtain', () => {
    const src = pine(5, ['t = 1', 't := nz(t[1], t)', 't := t == 1 and close < 0 ? -1 : t', 'plot(t)'])
    expect(Number.isNaN(host(src, undefined)[0])).toBe(true)
  })

  it('the tree shape the rule reads: only the bare `na` literal, never a marked or a computed seed', () => {
    const zz = { type: 'op', name: '/', args: [{ type: 'num', value: 0 }, { type: 'num', value: 0 }] }
    expect(historySeedReading(zz)).toBe(true)
    expect(historySeedReading({ type: 'op', name: 'u-', args: [zz] })).toBe(false) // ambiguousVarSeed
    expect(historySeedReading({ type: 'num', value: 3 })).toBe(false)
    expect(historySeedReading({ type: 'offset', value: 1, args: [{ type: 'series', name: 'close' }] })).toBe(false)
  })

  it('`x = na(x[1]) ? na : U` is `na` on EVERY bar, as in Pine (translated as the constant)', () => {
    // (the update reads `x[1]`, so this IS the self-reference recurrence, and it FORGETS:
    // run as `accum(na, U)` it would draw `close` on every bar Pine leaves `na`)
    const src = pine(5, ['x = na(x[1]) ? na : close < 3000 ? close : x[1]', 'plot(x)'])
    const got = host(src, listing)
    expect(got.every(Number.isNaN)).toBe(true)
    // control: a stated seed keeps the recurrence (bar 0 IS the seed, then the update)
    const seeded = host(pine(5, ['y = na(y[1]) ? 7.0 : close > 3000 ? close : y[1]', 'plot(y)']), listing)
    expect(seeded.slice(0, 3)).toEqual([7, 7, 7])
  })
})

describe('⭐⭐ r1 — pinned versions only, and only a BARE `na(x[k])` test', () => {
  const NA_SELF = ['x = na(x[1]) ? na : close < 3000 ? close : x[1]', 'plot(x)']
  const PLAIN = ['b = 0.0', 'b := close > 3000 ? close : nz(b[1])', 'plot(b)']
  it.each([3, 4, 5, 6])('v%i (bar-0 history pinned): `na(x[1]) ? na : U` is the constant na; the plain form serves bar 0', (v) => {
    expect(host(pine(v, NA_SELF), listingFor(v)).every(Number.isNaN)).toBe(true)
    expect(host(pine(v, PLAIN), listingFor(v))[0]).toBe(0)
  })
  it.each([2])('v%i (bar-0 history UNPINNED, W34-I4b): neither rule applies; bar 0 stays withheld as at base', (v) => {
    const ns = host(pine(v, NA_SELF), listingFor(v))
    expect(Number.isNaN(ns[0])).toBe(true)
    // not rewritten to the constant: the recurrence still answers on later bars
    expect(ns.some((x) => !Number.isNaN(x))).toBe(true)
    expect(Number.isNaN(host(pine(v, PLAIN), listingFor(v))[0])).toBe(true)
  })
  it('a test that is NOT a bare `x[k]` read (`na(nz(x[1]))`, never true) is not the constant: bar 0 runs U', () => {
    const got = host(pine(5, ['x = na(nz(x[1])) ? na : close < 3000 ? close : x[1]', 'plot(x)']), listing)
    expect(got[0]).toBe(CLOSE[0])
    expect(got.some((x) => !Number.isNaN(x))).toBe(true)
  })
})

describe('⭐⭐ rule 2 — `ta.wma` answers once it holds n FINITE observations (both lanes)', () => {
  const lines = ['float x = na', 'x := close > 1000 ? na : close', 'plot(ta.wma(x, 40))']
  const src = pine(6, lines)

  it('host lane: a finite bar 0, a gap of 88, then finite — first answer on bar 127, not 89', () => {
    const got = host(src, listing)
    expect(got.findIndex((v) => !Number.isNaN(v))).toBe(127)
    // the window at 127 is [bar 0, 89..127] in order (the gap filled with bar 0's value)
    const w = [CLOSE[0], ...CLOSE.slice(89, 128)]
    const norm = 40 * 41 / 2
    const ref = w.reduce((s, v, k) => s + v * (k + 1), 0) / norm
    expect(Math.abs(got[127] - ref)).toBeLessThan(1e-9 * ref)
  })

  it('runtime lane: the same bars, the same numbers (it read `ffill` as `propagate`: first on 128)', () => {
    const rt = runtime(src)
    const h = host(src, listing)
    expect(rt.findIndex((v) => !Number.isNaN(v))).toBe(127)
    rt.forEach((v, i) => {
      if (Number.isNaN(h[i])) expect(Number.isNaN(v), `bar ${i}`).toBe(true)
      else expect(Math.abs(v - h[i]), `bar ${i}`).toBeLessThan(1e-9 * Math.abs(h[i]))
    })
  })

  it('control: a source with no gap answers from bar n-1 in both lanes, unchanged', () => {
    const clean = pine(6, ['float x = na', 'x := close', 'plot(ta.wma(x, 40))'])
    expect(host(clean, listing).findIndex((v) => !Number.isNaN(v))).toBe(39)
    expect(runtime(clean).findIndex((v) => !Number.isNaN(v))).toBe(39)
  })
})
