// app/src/components/chart/engine/runtime/__tests__/e99Dispatch2.test.js
//
// ─── e99 dispatch-2 — THREE EXACT TRIMS OF THE VM'S HOT LOOP (`vm.js`) ─────────────────────────────────────────
// Each change only moves work, and each rail holds the value it must not move:
//   c6 RING      `s[i]` inside a function reads its ring at `cm - n` (+depth below 0), `cm = committed % depth`
//                cached per slot per bar: the values equal a plain-JS reference over a ring that wraps many times;
//   c1 POINTWISE each pointwise index keeps the implementation its first touch found: several builtins over
//                runtime state in one program answer the reference, and a missing one is still refused by name;
//   c2 HALT      HALT leaves the dispatch loop through its label: a run ends on every bar with its outputs.
// The census (`runtimeDigestCensus.measure.test.js`, RUNTIME_PERF_CENSUS=digest) holds the whole corpus to the
// same columns, counts and stops.
import { describe, it, expect } from 'vitest'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { makeProgram, OP } from '../program.js'

const daily = (n) => Array.from({ length: n }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 7) + i * 0.25
  return { t: 1500000000 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + (i % 13) * 10 }
})
const head = '//@version=6\nindicator("d2", overlay = false)\n'
const L = (...lines) => `${lines.join('\n')}\n`
function ctxOf(bars, columns) {
  return { bars: bars.length, series: ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k]))),
    columns: columns || [], confirmed: true, barTimes: bars.map((b) => b.t), requestBars: {} }
}
function run(src, n) {
  const bars = daily(n)
  const built = buildRuntimeIr(head + src, { bars, inputs: {}, tf: 'D', basePeriod: 'D' })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const p = lowerIrProgram(built.ir)
  const res = execute(p, ctxOf(bars, p.columns), undefined, {})
  return { p, bars, out: res.outputs[0] }
}
const opsOf = (p) => { const s = new Set(); for (let i = 0; i < p.code.length; i += 3) s.add(p.code[i]); return s }

describe('e99 dispatch-2 — exact trims of the hot loop', () => {
  it('c6 RING: a function\'s `s[i]` over a ring that wraps reads exactly the bar it names, on every bar', () => {
    const LEN = 7
    const N = 90
    const { p, bars, out } = run(L(
      'f(series float s, int len) =>',
      '    float acc = 0.0',
      '    for i = 0 to len - 1',
      '        acc += nz(s[i]) * (i + 1)',
      '    acc',
      `plot(f(close * 1.5, ${LEN}))`), N)
    // non-vacuity: the read IS the frame-relative dynamic ring read this change touched, over a short ring
    expect(opsOf(p).has(OP.READ_HIST_SLOT_DYN)).toBe(true)
    expect(Math.min(...p.history.map((h) => h.depth))).toBeLessThan(N / 4)
    for (let b = 0; b < N; b += 1) {
      let acc = 0
      for (let i = 0; i < LEN; i += 1) acc += (b - i >= 0 ? bars[b - i].c * 1.5 : 0) * (i + 1)
      expect(out[b], `RING: bar ${b}`).toBe(acc)
    }
  })

  it('c1 POINTWISE: each builtin index answers its own implementation over runtime state', () => {
    const N = 40
    const { p, bars, out } = run(L(
      'var float x = 0.0',
      'x := x * 0.5 + close',
      'plot(math.abs(x - 150) + nz(x[1]) + math.max(x, 120) + math.sqrt(x))'), N)
    expect(p.pointwise.length).toBeGreaterThanOrEqual(3)
    expect(opsOf(p).has(OP.POINTWISE)).toBe(true)
    let x = 0
    let prev = NaN
    for (let b = 0; b < N; b += 1) {
      x = x * 0.5 + bars[b].c
      const want = Math.abs(x - 150) + (Number.isNaN(prev) ? 0 : prev) + Math.max(x, 120) + Math.sqrt(x)
      expect(out[b], `POINTWISE: bar ${b}`).toBeCloseTo(want, 9)
      prev = x
    }
  })

  it('c1 POINTWISE: a name with no implementation is still refused by name', () => {
    const p = makeProgram({
      code: [OP.CONST, 0, 0, OP.POINTWISE, 0, 1, OP.EMIT, 0, 0, OP.HALT, 0, 0],
      consts: [1], outputs: ['x'], pointwise: ['no_such_builtin'],
    })
    expect(() => execute(p, ctxOf(daily(3)), undefined, {})).toThrow(/no pointwise implementation for no_such_builtin/)
  })

  it('c2 HALT: a run leaves the dispatch loop at HALT on every bar, its outputs written', () => {
    const p = makeProgram({ code: [OP.CONST, 0, 0, OP.EMIT, 0, 0, OP.HALT, 0, 0], consts: [42], outputs: ['x'] })
    const res = execute(p, ctxOf(daily(5)), undefined, {})
    expect(Array.from(res.outputs[0]), 'HALT').toEqual([42, 42, 42, 42, 42])
    expect(res.budget.counts.TOTAL_INSTRUCTIONS, 'HALT: three instructions a bar, HALT counted').toBe(15)
  })
})
