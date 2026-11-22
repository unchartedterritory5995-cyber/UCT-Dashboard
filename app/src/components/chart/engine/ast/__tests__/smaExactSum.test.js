// app/src/components/chart/engine/ast/__tests__/smaExactSum.test.js
//
// ─── ⭐⭐ SMA-EXACT (Engine 65 (#1484)) — `ta.sma` and `math.sum` ARE THE EXACTLY ROUNDED WINDOW SUM ───
//
// TradingView's `ta.sma` / `math.sum` equal the exactly rounded sum of the window's doubles (Python's
// `math.fsum`) on every bar of every capture taken from 2026-11-14 on; the left-to-right sum this
// engine used misses the last bit on about one bar in four, which turns `ta.change(ta.sma(...)) > 0`
// true on a window whose entering and leaving closes are equal (`vw-pt-na-guard-and-spy` E02, bars 488
// and 3009). Evidence: docs/pine/evidence/2026-11-16-sma-exact-sum/EVIDENCE.md.
//
// ⛔ `ta.wma` is NOT changed: its left-to-right weighted sum matches TradingView on 238,222 / 238,222
// captured bars and the exactly rounded one misses 48,723 (the PR's table). The rail below pins that.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { exactSum, FINITE_WINDOW, interpret } from '../interpret.js'
import { parseFormula } from '../parse.js'
import { buildRuntimeIr } from '../pineRuntimeFrontend.js'
import { lowerIrProgram } from '../../runtime/lowerIr.js'
import { execute } from '../../runtime/vm.js'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const load = (id) => JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'))
const barsOf = (cap) => cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v == null ? 0 : v }))
const rowOf = (cap, title) => {
  const plot = cap.study.plots.find((p) => p.title === title)
  const at = cap.plotValues.fields.indexOf(plot.id)
  const byTime = new Map(cap.plotValues.rows.map((r) => [r[0], r[at]]))
  return cap.bars.rows.map((b) => (byTime.has(b[0]) ? byTime.get(b[0]) : undefined))
}
const naiveSum = (xs, lo, hi) => { let s = 0; for (let i = lo; i <= hi; i++) s += xs[i]; return s }
/** Bars where `ours` is not BIT-identical to TradingView (bars TradingView leaves `na` skipped). */
const bitMisses = (ours, tv) => tv.reduce((n, v, i) => n + (v == null ? 0 : (Object.is(ours[i], v) ? 0 : 1)), 0)

describe('exactSum — the exactly rounded sum, whatever the data', () => {
  it('answers what `math.fsum` answers where the left-to-right sum does not', () => {
    expect(exactSum([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1], 0, 9)).toBe(1)
    expect(naiveSum([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1], 0, 9)).not.toBe(1)
    expect(exactSum([1e16, 1, -1e16], 0, 2)).toBe(1)
    expect(exactSum([1e100, 1, -1e100, 1], 0, 3)).toBe(2)
    // where a compensated (Neumaier) sum is NOT exactly rounded: the true sum 1e16 + 1 + 1e-16 lies just
    // above the midpoint 1e16 + 1, so it rounds UP; Neumaier answers 1e16 (the fast path must fall back)
    expect(exactSum([1e16, 1e-16, 1], 0, 2)).toBe(1e16 + 2)
    expect(exactSum([1, -1e16, 1e-16], 0, 2)).toBe(-9999999999999998)
    // a true sum exactly halfway between two doubles rounds to even, as math.fsum does
    expect(exactSum([1, 2 ** -53, 2 ** -106], 0, 2)).toBe(1 + 2 ** -52)
    expect(exactSum([1, 2 ** -53], 0, 1)).toBe(1)
    expect(exactSum([], 0, -1)).toBe(0)
    // an infinity in the window, or an overflowing sum, answers the left-to-right sum, as before
    expect(exactSum([Infinity, 1], 0, 1)).toBe(Infinity)
    expect(exactSum([1e308, 1e308], 0, 1)).toBe(Infinity)
    expect(Number.isNaN(exactSum([Infinity, -Infinity], 0, 1))).toBe(true)
  })

  it('is order-independent: any permutation of a window sums to the same double', () => {
    let seed = 7
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    for (let t = 0; t < 300; t += 1) {
      const xs = Array.from({ length: 2 + Math.floor(rnd() * 60) }, () => Math.round(rnd() * 50000) / 100 * (rnd() < 0.2 ? -1 : 1))
      const ys = [...xs].reverse()
      expect(exactSum(xs, 0, xs.length - 1)).toBe(exactSum(ys, 0, ys.length - 1))
    }
  })
})

describe('the sliding form (a series with no na) answers what exactSum answers, bar for bar', () => {
  it('over price walks, scale jumps, cancellations and exact ties, sma and sum', () => {
    let seed = 11
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    const shapes = [
      (i, p) => Math.round(p * (1 + (rnd() - 0.5) * 0.04) * 100) / 100,              // cents
      (i, p) => (i % 97 === 0 ? p * 1e6 : i % 101 === 0 ? p / 1e6 : p * (1 + (rnd() - 0.5) * 0.1)), // scale jumps
      (i) => (i % 2 ? 1e16 : -1e16) + (i % 3) * 0.5 + rnd() * 1e-3,                  // cancellation
      (i) => [0.1, 0.2, 0.3, 1e-16, 1][i % 5],                                        // ties and tiny parts
      (i) => [1e16, 1e-16, 1][i % 3],         // the window where a compensated sum rounds the wrong way
      (i) => [2 ** 52, 0.5, 2 ** -60, -(2 ** 52)][i % 4] * (i % 7 ? 1 : 2),           // exact halves at powers of two
    ]
    let bars = 0
    for (const step of shapes) {
      for (const n of [1, 2, 5, 30, 200]) {
        let p = 100
        const b = Array.from({ length: 1200 }, (_, i) => { p = step(i, p); return { t: 1600000000 + i * 86400, o: p, h: p, l: p, c: p, v: 1 } })
        const closes = b.map((x) => x.c)
        const sma = interpret(parseFormula(`sma(close, ${n})`).ast, b, {})
        const sum = interpret(parseFormula(`sum(close, ${n})`).ast, b, {})
        for (let i = n - 1; i < b.length; i += 1) {
          const want = exactSum(closes, i - n + 1, i)
          if (!Object.is(sum[i], want)) throw new Error(`sum(${n}) bar ${i}: ${sum[i]} != ${want}`)
          if (!Object.is(sma[i], want / n)) throw new Error(`sma(${n}) bar ${i}: ${sma[i]} != ${want / n}`)
          bars += 1
        }
      }
    }
    expect(bars).toBeGreaterThan(20000)
  })
})

describe('the captures (both lanes): T02 `ta.sma(close, 5)` and T05 `math.sum(close, 5)` bit for bit', () => {
  const CAPS = [
    ['vw-cs2-sma-exact-tie-rddt-1d-2026-11-15', 662],
    ['vw-cs2-sma-exact-tie-spy-1d-2026-11-15', 8503],
  ]
  it.each(CAPS)('%s: the columnar lane', (id, bars) => {
    const cap = load(id)
    const b = barsOf(cap)
    const sma = Array.from(interpret(parseFormula('sma(close, 5)').ast, b, {}))
    const sum = Array.from(interpret(parseFormula('sum(close, 5)').ast, b, {}))
    const t02 = rowOf(cap, 'T02_sma5')
    const t05 = rowOf(cap, 'T05_sum5')
    expect(t02.filter((v) => v != null).length).toBeGreaterThanOrEqual(bars)
    expect(bitMisses(sma, t02)).toBe(0)
    expect(bitMisses(sum, t05)).toBe(0)
    // the fixture can tell: the left-to-right sum misses the last bit on many bars
    const closes = b.map((x) => x.c)
    const naive = closes.map((_, i) => (i < 4 ? NaN : naiveSum(closes, i - 4, i) / 5))
    expect(bitMisses(naive, t02)).toBeGreaterThan(100)
  })

  it.each(CAPS)('%s: the runtime lane (the VM\'s own window over a run-computed source)', (id) => {
    const cap = load(id)
    const b = barsOf(cap)
    // `x` is a mutable value, so the VM's `skip` window (`OP.WINDOW`) computes it, not a column
    const src = '//@version=6\nindicator("t")\nvar float x = 0.0\nx := close\nplot(ta.sma(x, 5))\nplot(math.sum(x, 5))\n'
    const built = buildRuntimeIr(src, { bars: b, inputs: {} })
    expect(built.ok, built.refusal && built.refusal.message).toBe(true)
    const program = lowerIrProgram(built.ir)
    const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(b.map((x) => x[k])))
    const r = execute(program, { bars: b.length, series, columns: program.columns, confirmed: true })
    expect(bitMisses(Array.from(r.outputs[0]), rowOf(cap, 'T02_sma5'))).toBe(0)
    expect(bitMisses(Array.from(r.outputs[1]), rowOf(cap, 'T05_sum5'))).toBe(0)
  })
})

describe('⛔ `ta.wma` keeps its left-to-right weighted sum (238,222 / 238,222 captured bars)', () => {
  it('the reducer is the weighted left-to-right sum, NOT the exactly rounded one', () => {
    // a window where the two weighted sums differ in the last bit (70.96866666666668 vs ...666)
    const xs = [22.45, 12.5, 169.12, 59.28, 54.52]
    let w = 0
    for (let i = 0; i < xs.length; i += 1) w += xs[i] * (i + 1)
    const weighted = xs.map((x, i) => x * (i + 1))
    expect(w / 15).not.toBe(exactSum(weighted, 0, 4) / 15)
    expect(FINITE_WINDOW.wma.reduce(xs, 0, xs.length - 1)).toBe(w / 15)
  })
})

// `vw-pt-na-guard-and-{rddt,spy}-1d-2026-11-16` (capture batch 1, #1468): `x = ta.sma(close, 30)`;
// A02 plots x, E02 `not na(x) and ta.change(x) > 0` (every bar), E03 `not na(x) and ta.sma(x, 3) > close`.
// The left-to-right sum missed A02 on 4,667 of SPY's bars and read E02 = 1 on bars 488 and 3009, where the
// closes entering and leaving the window are equal and TradingView reads 0.
describe('vw-pt-na-guard-and: A02 bit for bit, E02 and E03 on every bar (both symbols)', () => {
  it.each(['rddt', 'spy'])('%s', (sym) => {
    const cap = load(`vw-pt-na-guard-and-${sym}-1d-2026-11-16`)
    const b = barsOf(cap)
    const x = Array.from(interpret(parseFormula('sma(close, 30)').ast, b, {}))
    const x3 = Array.from(interpret(parseFormula('sma(sma(close, 30), 3)').ast, b, {}))
    const a02 = rowOf(cap, 'A02_x')
    const e02 = rowOf(cap, 'E02_and_change_positive_every_bar')
    const e03 = rowOf(cap, 'E03_and_sma3_above_close_every_bar')
    expect(a02.filter((v) => v != null).length).toBeGreaterThan(600)
    expect(bitMisses(x, a02)).toBe(0)
    const fin = Number.isFinite
    const ours02 = x.map((v, i) => (i > 0 && fin(v) && fin(x[i - 1]) && v - x[i - 1] > 0 ? 1 : 0))
    const ours03 = x.map((v, i) => (fin(v) && fin(x3[i]) && x3[i] > b[i].c ? 1 : 0))
    expect(bitMisses(ours02, e02)).toBe(0)
    expect(bitMisses(ours03, e03)).toBe(0)
    if (sym === 'spy') {
      for (const bar of [488, 3009]) {
        expect(e02[bar]).toBe(0)
        expect(x[bar] - x[bar - 1]).toBe(0)
      }
      // the fixture can tell: the left-to-right mean reads a rise on both bars
      const closes = b.map((q) => q.c)
      const naive = (i) => naiveSum(closes, i - 29, i) / 30
      expect(naive(488) - naive(487) > 0 || naive(3009) - naive(3008) > 0).toBe(true)
    }
  })
})
