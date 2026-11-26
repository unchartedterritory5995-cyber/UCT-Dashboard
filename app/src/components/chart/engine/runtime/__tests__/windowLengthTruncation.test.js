// app/src/components/chart/engine/runtime/__tests__/windowLengthTruncation.test.js
//
// ─── ⭐⭐ M-A — A WINDOW LENGTH BUILT WITH `/` IS TRUNCATED TOWARD ZERO ──────────────────────────────
//
// TradingView, captured 2026-11-16 (HIST-F1..F4: vw-hist-frac-length{,-v5,-v4,-v3}, AMEX:SPY and NYSE:RDDT
// 1D, runs cb2 / cb2b, licence-held): every fractional window row equals the TRUNCATED integer window on every
// bar, in wma, ema, sma, rma, highest and the HMA helper, under v3, v4, v5 and v6:
//   40 / 3 = 13.33 -> 13   20 / 3 = 6.67 -> 6   9 / 2 = 4.5 -> 4   (25 / 3) - 1 = 7.33 -> 7
//   (26 / 3) - 1 = 7.67 -> 7   26 / 3 = 8.67 -> 8 (rounding would give 7, 8 and 9: ruled out)
// The same captures plot the quotient itself (13.33, 4.5, 7.33, 7.67): `/` keeps the fraction in every version.
//
// ⛔ What stays refused, by name: a fractional history OFFSET (`close[len / 2]`, not captured: Q-DYN-1 H rows),
// a quotient of two literals (`9 / 2`, Q-DYN-1's own question), and a per-bar length built with `/`
// (the VM's per-bar window does not truncate).
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 200
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + i,
  h: 102 + i + (i % 3),
  l: 98 + i - (i % 4),
  c: 100 + Math.sin(i / 2.3) * 12 + i * 0.7,
  v: 1000 + i * 13,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = (v) => (v === 3 ? '//@version=3\nstudy("t")\n'
  : `//@version=${v}\n${v >= 5 ? 'indicator' : 'study'}("t")\n`)

const build = (src, v) => buildRuntimeIr(head(v) + src, { bars: BARS, inputs: {} })
function run(src, v) {
  const built = build(src, v)
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return r.outputs.map((o) => Array.from(o))
}
const refusal = (src, v) => {
  const b = build(src, v)
  expect(b.ok, 'expected a refusal, got a program').toBe(false)
  return b.refusal
}
/** the fractional script draws exactly what the truncated whole-number script draws, on every bar */
const sameAs = (fractional, whole, v) => {
  const got = run(fractional, v)
  const want = run(whole, v)
  expect(got.length).toBe(want.length)
  let finite = 0
  for (let k = 0; k < want.length; k += 1) {
    for (let i = 0; i < N; i += 1) {
      if (Number.isNaN(want[k][i])) expect(Number.isNaN(got[k][i]), `plot ${k} bar ${i} should be na`).toBe(true)
      else { expect(got[k][i], `plot ${k} bar ${i}`).toBeCloseTo(want[k][i], 9); finite += 1 }
    }
  }
  expect(finite, 'the comparison saw real numbers').toBeGreaterThan(N / 2)
}
// a runtime series, so the lane under test is the runtime lane's own window, not a column
const X = 'var x = 0.0\nx := close\n'

describe('⭐⭐ M-A: the captured rows (HIST-F1, v6)', () => {
  const IN = 'len = input.int(40, "len")\nhlen = input.int(9, "hlen")\ntlen = input.int(20, "tlen")\n'
  it('R01 ta.wma(x, len / 3) with len = 40 is ta.wma(x, 13), not 14', () => {
    sameAs(`${IN}${X}plot(ta.wma(x, len / 3))\n`, `${IN}${X}plot(ta.wma(x, 13))\n`, 6)
  })
  it('R02 ta.wma(x, tlen / 3) with tlen = 20 is ta.wma(x, 6), not 7 (rounding ruled out)', () => {
    sameAs(`${IN}${X}plot(ta.wma(x, tlen / 3))\n`, `${IN}${X}plot(ta.wma(x, 6))\n`, 6)
  })
  for (const fn of ['ta.ema', 'ta.sma', 'ta.rma', 'ta.highest']) {
    it(`R03-R06 ${fn}(x, hlen / 2) with hlen = 9 is ${fn}(x, 4)`, () => {
      sameAs(`${IN}${X}plot(${fn}(x, hlen / 2))\n`, `${IN}${X}plot(${fn}(x, 4))\n`, 6)
    })
  }
  it('R07 the triangular HMA helper at len = 40 is the helper truncated to 13 / 20', () => {
    const thma = (a, b) => `${X}plot(ta.wma(ta.wma(x, ${a}) * 3 - ta.wma(x, ${b}) - ta.wma(x, 40), 40))\n`
    sameAs(`len = input.int(40, "len")\n${thma('len / 3', 'len / 2')}`, thma('13', '20'), 6)
  })
})

describe('⭐⭐ M-A: the community shapes, each version (HIST-F2..F4)', () => {
  it('v5 (HIST-F2): a parameter divided in a helper, fixed per call site', () => {
    const f = 'h(src, len) => ta.wma(src, len / 3)\nlen = input.int(40, "len")\n'
    sameAs(`${f}${X}plot(h(x, len))\n`, `${X}plot(ta.wma(x, 13))\n`, 5)
  })
  it('v4 (HIST-F3, obv-macd / hma-kahlman): hma(src, len) => wma(2*wma(src, len/2)-wma(src, len), round(sqrt(len)))', () => {
    const hma = 'hma(src, len) => wma(2*wma(src, len/2)-wma(src, len), round(sqrt(len)))\nlen = input(9)\n'
    sameAs(`${hma}${X}plot(hma(x, len))\n`, `${X}plot(wma(2*wma(x, 4)-wma(x, 9), 3))\n`, 4)
  })
  it('v4: nested division keeps the fraction, then truncates (hma3: p = len/2, wma(x, p/3), len = 9 -> 1)', () => {
    const f = 'h3(src, len) =>\n    p = len/2\n    wma(src, p/3)\nlen = input(9)\n'
    sameAs(`${f}${X}plot(h3(x, len))\n`, `${X}plot(wma(x, 1))\n`, 4)
  })
  for (const [per, want] of [[25, 7], [26, 7]]) {
    it(`v3 (HIST-F4, range-filter-v1): wper = (t/3) - 1 with t = ${per} is sma(x, ${want})`, () => {
      const f = `g(src, t) =>\n    wper = (t/3) - 1\n    sma(src, wper)\nper = input(${per})\n`
      sameAs(`${f}${X}plot(g(x, per))\n`, `${X}plot(sma(x, ${want}))\n`, 3)
    })
  }
})

describe('⛔ M-A: what stays refused, by name', () => {
  it('a fractional history OFFSET: not captured (Q-DYN-1 H rows); on master it built and drew `na` on every bar', () => {
    const r = refusal(`len = input.int(9, "len")\n${X}plot(x[len / 2])\n`, 6)
    expect(r.guard).toBe('runtime:history-dynamic-offset')
    expect(r.message).toMatch(/not captured for offsets \(DY1, Q-DYN-1 H rows\)/)
  })
  it('a per-bar offset written with `/` (bar_index / 2): refused, never read as `na`', () => {
    const r = refusal(`${X}plot(x[bar_index / 2])\n`, 6)
    expect(r.guard).toBe('runtime:history-dynamic-offset')
  })
  it('an offset whose proved bounds are whole (0 and 2) but which can read 1.5: refused (on master it built)', () => {
    const r = refusal(`${X}plot(x[(close > open ? 0 : close > 100 ? 3 : 4) * 0.5])\n`, 6)
    expect(r.guard).toBe('runtime:history-dynamic-offset')
    expect(r.message).toMatch(/not captured for offsets \(DY1, Q-DYN-1 H rows\)/)
  })
  it('control: a fraction in a `?:` TEST chooses a whole offset and still builds', () => {
    expect(build(`${X}plot(x[close > open * 1.01 ? 1 : 2])\n`, 6).ok).toBe(true)
  })
  it('control: one folded whole quotient (`len / 3`, len = 9) is exact and still builds', () => {
    expect(build(`len = input.int(9, "len")\n${X}plot(x[len / 3])\n`, 6).ok).toBe(true)
  })
  it('control: a whole-number per-bar offset still builds (close > open ? 2 : 1)', () => {
    expect(build(`${X}plot(x[close > open ? 2 : 1])\n`, 6).ok).toBe(true)
  })
  it('a quotient of two literals (`9 / 2`): Q-DYN-1\'s own question', () => {
    const r = refusal(`${X}plot(ta.wma(x, 9 / 2))\n`, 6)
    expect(r.guard).toBe('runtime:history-dynamic-offset')
  })
  it('a quotient below 1 is no window: refused, never clamped', () => {
    const r = refusal(`len = input.int(1, "len")\n${X}plot(ta.ema(x, len / 2))\n`, 6)
    expect(r.guard).toBe('runtime:history-dynamic-offset')
  })
  it('control: the same window with a whole-number length builds', () => {
    expect(build(`len = input.int(40, "len")\n${X}plot(ta.wma(x, len - 27))\n`, 6).ok).toBe(true)
  })
})

describe('⭐ DY1 names what is uncaptured: offsets, never window lengths', () => {
  it('a per-bar window length built with `/` cites HIST-F, not Q-DYN-1', () => {
    const src = 'f(src, n) => ta.wma(src, n)\n' + X + 'k = bar_index % 7 + 2\nplot(f(x, k / 2))\n'
    const r = refusal(src, 6)
    expect(r.guard).toBe('runtime:history-dynamic-offset')
    expect(r.message).toMatch(/HIST-F1\.\.F4/)
    expect(r.message).not.toMatch(/Q-DYN-1/)
  })
  it('a per-bar history offset built with `/` cites Q-DYN-1 H rows, for offsets', () => {
    const src = 'f(src, n) => src[n]\n' + X + 'k = bar_index % 7 + 2\nplot(f(x, k / 2))\n'
    const r = refusal(src, 6)
    expect(r.guard).toBe('runtime:history-dynamic-offset')
    expect(r.message).toMatch(/not captured for offsets \(DY1, Q-DYN-1 H rows\)/)
  })
})
