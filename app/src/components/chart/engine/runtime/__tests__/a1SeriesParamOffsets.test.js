// app/src/components/chart/engine/runtime/__tests__/a1SeriesParamOffsets.test.js
//
// ─── ⭐⭐ A1 — A FUNCTION PARAMETER THAT SIZES A HISTORY OFFSET, PASSED A VALUE READ PER BAR ──────────
//
// `Sma(src, p) => a = cum(src), (a - a[max(p, 0)]) / max(p, 0)` called with `k = n - val` (support-and-resistance),
// and `calcSlope(source, length)` looping `source[i]` up to a `bar_index` difference (dynamic-linear-regression-
// channels): the shared frame cannot size the ring before bar 0, and C35 cannot fix the argument at the call site.
// TradingView reads the REAL history for an offset known only while the bar runs, declared buffer or none (WS-C M2 / M3
// / Q-MBB, captured 2026-11-18: `docs/pine/capture-queue-2026-10-31-wsc-history.md`; M4 for a script's own series), so
// the copy compiled for that call site reads the parameter per bar from a ring of Pine's 5,000. Nothing proves the
// bottom or a whole number there, so the ring is STRICT: a negative or fractional offset STOPS the run by name.
//
// Acceptance: every value equals Pine's semantics computed here by hand from the bars (an independent oracle, not
// the lane's own kernels); every shape this does not serve keeps a refusal by name.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { OP } from '../program.js'

const barsOf = (n) => Array.from({ length: n }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + i * 0.1,
  h: 103 + i * 0.1 + (i % 3),
  l: 97 + i * 0.1 - (i % 4),
  c: 100 + Math.sin(i / 2.3) * 12 + i * 0.07,
  v: 1000 + i,
}))
const N = 60
const BARS = barsOf(N)
const C = BARS.map((b) => b.c)
const head = (v) => (v === 4 ? '//@version=4\nstudy("t")\n' : `//@version=${v}\nindicator("t")\n`)
// a per-bar value the fold cannot know: 1, 2, ..., 6, 0, 1, 2, ... (a reassigned `var`)
const CYCLE = 'var c = 0\nc := c >= 6 ? 0 : c + 1\n'
const cAt = (i) => (i + 1) % 7

const build = (src, v = 5, bars = BARS) => buildRuntimeIr(head(v) + src, { bars, inputs: {} })
function run(src, v = 5, bars = BARS) {
  const built = build(src, v, bars)
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const r = execute(program, { bars: bars.length, series, columns: program.columns, confirmed: true })
  return { outs: r.outputs.map((o) => Array.from(o)), program, built }
}
const refusal = (src, v = 5) => {
  const b = build(src, v)
  expect(b.ok, 'expected a refusal, got a program').toBe(false)
  return b.refusal
}
const same = (got, want, label, digits = 9) => {
  expect(got.length).toBe(want.length)
  for (let i = 0; i < want.length; i += 1) {
    if (Number.isNaN(want[i])) expect(Number.isNaN(got[i]), `${label} bar ${i} should be na (got ${got[i]})`).toBe(true)
    else expect(got[i], `${label} bar ${i}`).toBeCloseTo(want[i], digits)
  }
}
const back = (xs, i, n) => (i - n >= 0 ? xs[i - n] : NaN)
/** The program's STRICT dynamic reads: chart-column / series reads with operand -1, and rings marked `strict`. */
const strictOf = (program) => {
  let columnReads = 0
  for (let pc = 0; pc * 3 < program.code.length; pc += 1) {
    const op = program.code[pc * 3]
    if ((op === OP.READ_HIST_DYN || op === OP.READ_SERIES_HIST_DYN) && program.code[pc * 3 + 2] === -1) columnReads += 1
  }
  return { columnReads, rings: program.history.filter((h) => h.strict).map((h) => h.depth) }
}

describe('⭐⭐ A1 — a per-bar argument sizes the offset of the copy compiled for its call site', () => {
  it('⭐ `src[n]` of a parameter, `n` read per bar: the close `n` bars back, every bar', () => {
    const { outs, built, program } = run(`${CYCLE}f(src, n) => src[n]\nplot(f(close, c))\n`)
    expect(built.diagnostics.seriesSpecialisedCalls).toBe(1)
    // `src` is the parameter's own series (one ring per call site): Pine's 5,000, STRICT (nothing proves a smaller top)
    expect(strictOf(program)).toEqual({ columnReads: 0, rings: [5000] })
    same(outs[0], C.map((_, i) => back(C, i, cAt(i))), 'f(close, c)')
  })

  it('⭐ the v4 support-and-resistance shape: `a = cum(src)`, `a[max(p, 0)]`, through two levels of functions', () => {
    const src = `${CYCLE}Sma(src,p) => a = cum(src), (a - a[max(p,0)])/max(p,0)\n`
      + 'Cov(x,y,p) => Sma(x*y,p) - Sma(x,p)*Sma(y,p)\n'
      + 'plot(Sma(close, c))\nplot(Cov(close, open, c))\n'
    const { outs, program } = run(src, 4)
    // `a` is the function's own series: one STRICT ring of Pine's 5,000 per call site (nothing proves a smaller top)
    const rings = strictOf(program).rings
    expect(rings.length).toBeGreaterThan(0)
    expect(rings.every((d) => d === 5000)).toBe(true)
    const O = BARS.map((b) => b.o)
    const cum = (xs) => { let s = 0; return xs.map((x) => (s += x)) }
    const sma = (xs) => {
      const a = cum(xs)
      return a.map((ai, i) => { const p = cAt(i); return p === 0 ? NaN : (ai - back(a, i, p)) / p })
    }
    same(outs[0], sma(C), 'Sma(close, c)')
    const xy = sma(C.map((x, i) => x * O[i]))
    const sx = sma(C)
    const sy = sma(O)
    same(outs[1], xy.map((v, i) => v - sx[i] * sy[i]), 'Cov(close, open, c)', 6)
  })

  it('⭐ the dynamic-linear-regression-channels shape: a loop bound read per bar, guarded, `max_bars_back` declared', () => {
    const src = `${CYCLE}s(source, length) =>\n    max_bars_back(source, 5000)\n    float out = na\n`
      + '    if length > 1\n        sum = 0.0\n        for i = 0 to length - 1\n            sum += source[i]\n'
      + '        out := sum\n    out\nplot(s(close, c + 1))\n'
    const { outs } = run(src)
    const want = C.map((_, i) => {
      const len = cAt(i) + 1
      if (!(len > 1)) return NaN
      let s = 0
      for (let j = 0; j < len; j += 1) s += back(C, i, j)
      return s
    })
    same(outs[0], want, 's(close, c + 1)')
  })

  it('⭐ a chart series read in the same copy (`high[j]`, the calcDev shape): a STRICT column read, the real history', () => {
    const src = `${CYCLE}h(src, len) =>\n    float s = 0.0\n    for j = 0 to len - 1\n        s += src[j] - high[j]\n    s\nplot(h(close, c + 1))\n`
    const { outs, program } = run(src)
    expect(strictOf(program).columnReads).toBeGreaterThan(0)
    expect(strictOf(program).rings).toEqual([5000])
    const H = BARS.map((b) => b.h)
    same(outs[0], C.map((_, i) => {
      let t = 0
      for (let j = 0; j <= cAt(i); j += 1) t += back(C, i, j) - back(H, i, j)
      return t
    }), 'h(close, c + 1)')
  })

  it('⭐ the argument may be the chart\'s own `bar_index` arithmetic, or a test on the bar', () => {
    const { outs } = run('f(src, n) => src[n]\nplot(f(close, close > open ? 2 : 0))\nplot(f(high, bar_index - (bar_index > 30 ? 30 : 0)))\n')
    const H = BARS.map((b) => b.h)
    same(outs[0], C.map((c, i) => back(C, i, c > BARS[i].o ? 2 : 0)), 'f(close, close > open ? 2 : 0)')
    same(outs[1], H.map((_, i) => back(H, i, i - (i > 30 ? 30 : 0))), 'f(high, bar_index - k)')
  })
})

describe('⭐ A1 (dynamic-linear-regression-channels\' top level): a BLOCK local bound once sizes an offset by its range', () => {
  it('⭐ `j = x > x[1] ? 1 : 0` in a block (a slot: it reads one), `x[j]` read there: a ring of depth 1, the real history', () => {
    const src = 'var float x = 0.0\nx := close\nfloat out = na\nif bar_index > 5\n    j = x > x[1] ? 1 : 0\n'
      + '    out := x[j]\nplot(out)\n'
    const { outs, program } = run(src)
    // proved [0, 1]: an exact ring, no per-bar copy and nothing strict
    expect(strictOf(program)).toEqual({ columnReads: 0, rings: [] })
    expect(program.history.some((h) => h.depth === 1)).toBe(true)
    same(outs[0], C.map((c, i) => (i > 5 ? (c > C[i - 1] ? C[i - 1] : c) : NaN)), 'x[j]')
  })
})

describe('⛔ what A1 does not serve keeps a refusal by name, or stops by name', () => {
  it('⛔ a negative offset read on a bar STOPS the run by name (no `na` guessed for it)', () => {
    expect(() => run(`${CYCLE}f(src, n) => src[n]\nplot(f(close, c - 3))\n`))
      .toThrow(/runtime:history-dynamic-offset.*negative or not a whole number/)
  })

  it('⛔ ...and so does a negative offset into a chart series inside the copy (the strict column read, read first)', () => {
    expect(() => run(`${CYCLE}g(src, n) => high[n] + src[n]\nplot(g(close, c - 3))\n`))
      .toThrow(/runtime:history-dynamic-offset — \[-?\d+\]: a history offset read on this bar is negative or not a whole number/)
  })

  it('⛔ ...and so does a negative offset into the function\'s own series (the strict ring)', () => {
    expect(() => run(`${CYCLE}g(src, n) =>\n    a = ta.cum(src)\n    a[n]\nplot(g(close, c - 3))\n`))
      .toThrow(/runtime:history-dynamic-offset.*negative or not a whole number/)
  })

  it('⛔ a fractional offset read on a bar STOPS the run by name', () => {
    expect(() => run(`${CYCLE}f(src, n) => src[n]\nplot(f(close, c * 0.5))\n`))
      .toThrow(/runtime:history-dynamic-offset.*negative or not a whole number/)
  })

  it('⛔ past Pine\'s 5,000-bar buffer the run stops by name (5,100 bars, `f(close, bar_index)`)', () => {
    const bars = barsOf(5100)
    expect(() => run('f(src, n) => src[n]\nplot(f(close, bar_index))\n', 5, bars))
      .toThrow(/reaches past Pine's history buffer of 5000 bars/)
    // ...and below the buffer every bar is the first close (control: the same run on 5,000 bars stands)
    const { outs } = run('f(src, n) => src[n]\nplot(f(close, bar_index))\n', 5, bars.slice(0, 5000))
    expect(outs[0].every((x) => x === bars[0].c)).toBe(true)
  })

  it('⛔ an argument built with `/` is refused by name at the build (DY1, Q-DYN-1)', () => {
    const r = refusal(`${CYCLE}f(src, n) => src[n]\nplot(f(close, c / 2))\n`)
    expect(r.guard).toBe('runtime:history-dynamic-offset')
    expect(r.message).toMatch(/built with `\/`.*DY1, capture queue Q-DYN-1/)
    // ⭐ CONTROL: a `%` of whole numbers is no division (whole in every version; G04 of the vw-udt-fn-global-history
    // witness, `bar_index % 3`, equals TradingView on every bar): read per bar
    const { outs } = run(`f(src, n) => src[n]\nplot(f(close, bar_index % 5))\n`)
    same(outs[0], C.map((_, i) => back(C, i, i % 5)), 'f(close, bar_index % 5)')
    // through a name bound to a division (the fibonacci-extention `i_depth / 2` shape)
    const r2 = refusal(`len = input.int(11) / 2\n${CYCLE}f(src, n) => src[n]\nplot(f(close, len + c))\n`)
    expect(r2.message).toMatch(/DY1/)
  })

  it('⛔ a parameter declared `simple` keeps Pine\'s own refusal (Pine does not compile a per-bar value there)', () => {
    const r = refusal(`${CYCLE}f(src, simple int n) => src[n]\nplot(f(close, c))\n`)
    expect(r.message).toMatch(/declared `simple`.*Pine does not compile that/)
  })

  it('⭐ CONTROL: a dynamic read OUTSIDE a per-bar copy keeps master\'s answer (not strict: `na` for a negative offset)', () => {
    const { outs, program } = run(`${CYCLE}plot(close[c - 3])\n`)
    expect(strictOf(program)).toEqual({ columnReads: 0, rings: [] })
    expect(Number.isNaN(outs[0][0])).toBe(true)   // bar 0: c = 1, offset -2
  })

  it('⭐ CONTROL: a fixed argument is still C35\'s constant window (no series copy, ring exactly deep enough)', () => {
    const { outs, built, program } = run('f(src, n) => src[n]\nplot(f(close, 3))\n')
    expect(built.diagnostics.seriesSpecialisedCalls).toBeUndefined()
    expect(strictOf(program)).toEqual({ columnReads: 0, rings: [] })
    expect(Math.max(...program.history.map((h) => h.depth))).toBe(3)
    same(outs[0], C.map((_, i) => back(C, i, 3)), 'f(close, 3)')
  })

  it('⭐ CONTROL: a caller\'s own parameter is still fixed by ITS call site (the C35 chain comes first)', () => {
    const { outs, built, program } = run('f(src, n) => src[n]\ng(src, m) => f(src, m)\nplot(g(close, 2))\n')
    expect(built.diagnostics.seriesSpecialisedCalls).toBeUndefined()
    expect(strictOf(program)).toEqual({ columnReads: 0, rings: [] })
    same(outs[0], C.map((_, i) => back(C, i, 2)), 'g(close, 2)')
  })

  it('⭐ ...and the same chain with a per-bar argument reads per bar at both levels', () => {
    const { outs, built } = run(`${CYCLE}f(src, n) => src[n]\ng(src, m) => f(src, m)\nplot(g(close, c))\n`)
    expect(built.diagnostics.seriesSpecialisedCalls).toBe(2)
    same(outs[0], C.map((_, i) => back(C, i, cAt(i))), 'g(close, c)')
  })
})
