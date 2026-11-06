// app/src/components/chart/engine/runtime/__tests__/w4StateKernels.test.js
//
// ─── ⭐⭐ W4 T10 — STATE KERNELS OVER A VALUE THE RUN COMPUTES ─────────────────
//
// `ta.cum`, `ta.pivothigh`/`ta.pivotlow`, `ta.stoch` and `ta.vwap(source)` refused
// `runtime:call-windowed-state` whenever their source was a mutable variable, while
// the same call over a pure series was a column. Each is now the columnar lane's
// own arithmetic stepped a bar at a time (`interpret.js`: `CARRIED.cumPine`,
// `.pivotHighPine`, `.pivotLowPine`; `CARRIED2.stochPine`, `.vwapPine`).
//
// ⭐ THE GRADE IS THE COLUMNAR LANE, NEVER A COPY OF THE KERNEL: the SAME numbers
// reach the columnar door as a pure expression (or the shipped function) and the
// runtime as a mutable variable, and the two series must agree bar for bar —
// warm-up, `na`, ties and session resets included.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr, RUNTIME_STATE_KERNELS, MAX_PIVOT_SPAN } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { translatePine } from '../../ast/pine.js'
import { parseFormula } from '../../ast/parse.js'
import { interpret, CARRIED, CARRIED2 } from '../../ast/interpret.js'
import { computeVWAP } from '../../../indicators.js'

// Intraday bars over FIVE ET sessions (13 half-hour bars from 09:30 ET), with a
// plateau of equal highs and lows so the pivot tie rule is exercised.
const DAYS = 5
const PER_DAY = 13
const N = DAYS * PER_DAY
const T0 = Date.UTC(2023, 10, 13, 14, 30) / 1000        // 2023-11-13 09:30 ET (EST)
const BARS = Array.from({ length: N }, (_, i) => {
  const d = Math.floor(i / PER_DAY)
  const k = i % PER_DAY
  const wave = Math.round(Math.sin(i * 0.9) * 6 + Math.cos(i * 0.31) * 4)
  const plateau = (i >= 20 && i <= 22) ? 5 : 0           // three equal highs
  return {
    t: T0 + d * 86400 + k * 1800,
    o: 100 + wave,
    h: 110 + wave + plateau * 0 + (plateau ? 4 : 0),
    l: 90 + wave - (plateau ? 4 : 0),
    c: 100 + Math.round(Math.sin(i * 0.5) * 7),
    v: 1000 + ((i * 7919) % 613),
  }
})
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

const heads = {
  4: '//@version=4\nstudy("t")\n',
  5: '//@version=5\nindicator("t")\n',
  6: '//@version=6\nindicator("t")\n',
}

function build(version, body, bars = BARS) {
  return buildRuntimeIr(`${heads[version]}${body}`, { bars, inputs: {} })
}
function run(version, body, bars = BARS) {
  const built = build(version, body, bars)
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true, barTimes: BARS.map((b) => b.t),
  })
  return r.outputs.map((o) => Array.from(o))
}
const refusalOf = (version, body) => {
  const built = build(version, body)
  return built.ok ? null : built.refusal
}
const state = (name, expr) => `var float ${name} = 0.0\n${name} := ${expr}\n`

/** The columnar lane's answer to a PURE Pine expression. */
function pureLane(version, expr) {
  const t = translatePine(`${heads[version]}plot(${expr})\n`)
  expect(t.ok, JSON.stringify(t.refusal || {})).toBe(true)
  const parsed = parseFormula(t.outputs[0].formula)
  expect(parsed.ok).toBe(true)
  const col = interpret(parsed.ast, BARS, {})
  return Array.from({ length: N }, (_, i) => (typeof col === 'number' ? col : col[i]))
}
/** A house-formula column (`cum(...)`), which Pine's own spelling refuses. */
function houseLane(formula) {
  const parsed = parseFormula(formula)
  expect(parsed.ok, formula).toBe(true)
  const col = interpret(parsed.ast, BARS, {})
  return Array.from({ length: N }, (_, i) => col[i])
}
function same(got, want, label) {
  expect(got.length).toBe(want.length)
  let finite = 0
  for (let i = 0; i < want.length; i += 1) {
    if (Number.isNaN(want[i])) {
      expect(Number.isNaN(got[i]), `${label} bar ${i}: ours ${got[i]}, want na`).toBe(true)
    } else {
      expect(Math.abs(got[i] - want[i]), `${label} bar ${i}: ours ${got[i]}, want ${want[i]}`)
        .toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(want[i])))
      finite += 1
    }
  }
  return finite
}

describe('⭐⭐ W4 T10 — ta.cum over a value the run computes', () => {
  it('equals the columnar running total, and an na bar is na while the total HOLDS', () => {
    const [clean] = run(5, `${state('x', 'close + 1')}plot(ta.cum(x))\n`)
    expect(same(clean, houseLane('cum(close + 1)'), 'cum')).toBe(N)
    // with holes: the columnar loop (`cumCol`) replayed by hand over the same values
    const X = '(bar_index % 7 == 3 or bar_index < 4 ? na : close + 1)'
    const [out] = run(5, `${state('x', X)}plot(ta.cum(x))\n`)
    let total = 0
    const want = BARS.map((b, i) => {
      if (i % 7 === 3 || i < 4) return NaN
      total += b.c + 1
      return total
    })
    expect(want.filter(Number.isNaN).length).toBeGreaterThan(8)
    expect(same(out, want, 'cum holes')).toBeGreaterThan(30)
  })

  it('the na-carry: the bar AFTER an na continues the total, it does not restart', () => {
    const [out] = run(5, `${state('x', '(bar_index == 5 ? na : 1)')}plot(ta.cum(x))\n`)
    expect(out.slice(0, 8)).toEqual([1, 2, 3, 4, 5, NaN, 6, 7])
  })

  it('two call sites of one function keep two totals', () => {
    const [a, b] = run(5, `${state('x', 'close')}f(s) => ta.cum(s)\nplot(f(x))\nplot(f(x * 2))\n`)
    for (let i = 0; i < N; i += 1) expect(b[i]).toBeCloseTo(a[i] * 2, 9)
  })

  it('v4 spells it bare `cum(x)`; from v5 a bare `cum` is no Pine function and stays refused', () => {
    const [out] = run(4, `${state('x', 'close')}plot(cum(x))\n`)
    expect(out[N - 1]).toBeCloseTo(BARS.reduce((s, b) => s + b.c, 0), 9)
    const r = refusalOf(5, `${state('x', 'close')}plot(cum(x))\n`)
    expect(r).not.toBeNull()
    expect(r.guard).toBe('runtime:call-windowed-state')
  })

  it('a scripts own function of the same name wins (v4 `cum`, `stoch`)', () => {
    const [a] = run(4, `${state('x', 'close')}cum(s) => s * 2
plot(cum(x))
`)
    expect(a[7]).toBe(BARS[7].c * 2)
    const [b] = run(4, `${state('x', 'close')}stoch(a, b, c, n) => a + b + c + n
plot(stoch(x, 1, 2, 3))
`)
    expect(b[7]).toBe(BARS[7].c + 6)
  })

  it('a named argument refuses by name', () => {
    expect(refusalOf(5, `${state('x', 'close')}plot(ta.cum(source = x))\n`).guard).toBe('runtime:builtin-args')
  })
})

describe('⭐⭐ W4 T10 — ta.pivothigh / ta.pivotlow over a value the run computes', () => {
  const PH = (L, R) => pureLane(5, `ta.pivothigh(high, ${L}, ${R})`)
  const PL = (L, R) => pureLane(5, `ta.pivotlow(low, ${L}, ${R})`)

  it('equals the columnar pivot (a tie on the LEFT pivots, one on the RIGHT does not)', () => {
    const [hi, lo] = run(5, `${state('h', 'high')}${state('l', 'low')}`
      + 'plot(ta.pivothigh(h, 3, 3))\nplot(ta.pivotlow(l, 3, 3))\n')
    const wantHi = PH(3, 3)
    const wantLo = PL(3, 3)
    expect(same(hi, wantHi, 'pivothigh')).toBeGreaterThan(2)
    expect(same(lo, wantLo, 'pivotlow')).toBeGreaterThan(2)
  })

  it('asymmetric windows equal the columnar pivot; a zero count refuses (the columnar lane refuses it too)', () => {
    for (const [L, R] of [[5, 2], [2, 5], [1, 1]]) {
      const [hi] = run(5, `${state('h', 'high')}plot(ta.pivothigh(h, ${L}, ${R}))\n`)
      expect(same(hi, PH(L, R), `pivothigh ${L},${R}`)).toBeGreaterThan(0)
    }
    expect(refusalOf(5, `${state('h', 'high')}plot(ta.pivothigh(h, 3, 0))\n`).guard).toBe('runtime:builtin-args')
    expect(refusalOf(5, `${state('h', 'high')}plot(ta.pivothigh(h, 0, 3))\n`).guard).toBe('runtime:builtin-args')
  })

  it('⛔ THE DELAY: a pivot appears `rightbars` bars AFTER its bar, never on it', () => {
    const L = 3
    const R = 4
    const [hi] = run(5, `${state('h', 'high')}plot(ta.pivothigh(h, ${L}, ${R}))\n`)
    const fired = hi.map((v, i) => (Number.isNaN(v) ? -1 : i)).filter((i) => i >= 0)
    expect(fired.length).toBeGreaterThan(1)
    for (const t of fired) {
      // the value on the confirmation bar IS the high `R` bars earlier, and that bar
      // is the strict extreme of its window on the right
      const c = t - R
      expect(hi[t]).toBe(BARS[c].h)
      expect(t).toBeGreaterThanOrEqual(L + R)
      for (let j = c + 1; j <= c + R; j += 1) expect(BARS[j].h).toBeLessThan(BARS[c].h)
    }
  })

  it('the two-argument form never reaches this lane: it mentions no mutable value, so the columnar lane answers it', () => {
    expect(RUNTIME_STATE_KERNELS['ta.pivothigh'].arity).toEqual([3])
    const [hi] = run(5, `${state('z', 'close')}f(s) => ta.pivothigh(3, 3) + 0 * s
plot(f(z))
`)
    same(hi, PH(3, 3), 'pivothigh(3,3)')
  })

  it('an na anywhere in the window makes the answer na (the columnar rule)', () => {
    const X = '(bar_index == 30 ? na : high)'
    const [hi] = run(5, `${state('h', X)}plot(ta.pivothigh(h, 3, 3))\n`)
    const want = pureLane(5, `ta.pivothigh(${X}, 3, 3)`)
    same(hi, want, 'pivothigh na')
    // non-vacuity: no pivot is reported within 3 bars either side of the hole
    for (let t = 30; t <= 36; t += 1) expect(Number.isNaN(hi[t])).toBe(true)
  })

  it('two call sites of one function keep two rings (the wall T7 recorded)', () => {
    const [a, b] = run(5, `${state('h', 'high')}f(s) => ta.pivothigh(s, 3, 3)\nplot(f(h))\nplot(f(-h))\n`)
    same(a, PH(3, 3), 'f(h)')
    expect(b.some((v) => !Number.isNaN(v))).toBe(true)
    expect(b.every((v, i) => Number.isNaN(v) || v < 0)).toBe(true)
  })

  it('v4 spells it bare `pivothigh(x, 3, 3)` and it is PINE\'S (confirmation bar); v5 bare stays refused', () => {
    const [hi] = run(4, `${state('h', 'high')}plot(pivothigh(h, 3, 3))\n`)
    same(hi, PH(3, 3), 'v4 pivothigh')
    expect(refusalOf(5, `${state('h', 'high')}plot(pivothigh(h, 3, 3))\n`).guard).toBe('runtime:call-windowed-state')
  })

  it('refuses a bar count that is not a whole number, negative, past the ceiling, or named', () => {
    // a count that does not fold to a whole number is refused (by `foldConstNode`'s own name or ours)
    for (const bad of ['2.5, 3', '3, -1']) {
      const g = refusalOf(5, `${state('h', 'high')}plot(ta.pivothigh(h, ${bad}))\n`).guard
      expect(['runtime:builtin-args', 'runtime:history-dynamic-offset'], bad).toContain(g)
    }
    expect(refusalOf(5, `${state('h', 'high')}plot(ta.pivothigh(h, ${MAX_PIVOT_SPAN}, 3))\n`).guard).toBe('runtime:builtin-args')
    expect(refusalOf(5, `${state('h', 'high')}plot(ta.pivothigh(h, leftbars = 3, rightbars = 3))\n`).guard).toBe('runtime:builtin-args')
    // control: the largest legal span builds
    expect(build(5, `${state('h', 'high')}plot(ta.pivothigh(h, ${MAX_PIVOT_SPAN - 4}, 3))\n`).ok).toBe(true)
  })
})

describe('⭐⭐ W4 T10 — ta.stoch over values the run computes', () => {
  it('equals the columnar stochastic bar for bar, including the warm-up', () => {
    const [out] = run(5, `${state('c', 'close + 1')}${state('h', 'high + 2')}${state('l', 'low - 2')}`
      + 'plot(ta.stoch(c, h, l, 14))\n')
    const want = pureLane(5, 'ta.stoch(close + 1, high + 2, low - 2, 14)')
    expect(want.slice(0, 13).every(Number.isNaN)).toBe(true)
    expect(same(out, want, 'stoch')).toBeGreaterThan(40)
    // %K lives in 0..100 and is not constant (non-vacuity)
    const fin = out.filter((v) => !Number.isNaN(v))
    expect(Math.min(...fin)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...fin)).toBeLessThanOrEqual(100)
    expect(new Set(fin.map((v) => v.toFixed(6))).size).toBeGreaterThan(10)
  })

  it('a source computed by the run that is na for a leading run starts after it (StochRSI shape)', () => {
    const C = '(bar_index < 9 ? na : close + 1)'
    const [out] = run(5, `${state('c', C)}plot(ta.stoch(c, c, c, 6))\n`)
    const want = pureLane(5, `ta.stoch(${C}, ${C}, ${C}, 6)`)
    same(out, want, 'stoch prefix')
    // first value is 9 + 6 - 1 = bar 14
    expect(out.findIndex((v) => !Number.isNaN(v))).toBe(14)
  })

  it('a zero range is 50, as computeStochastic answers', () => {
    const [out] = run(5, `${state('c', '5.0')}plot(ta.stoch(c, c, c, 4))\n`)
    expect(out.slice(3, 8)).toEqual([50, 50, 50, 50, 50])
  })

  it('an interior hole RESTARTS the window: na there and for the next length - 1 bars', () => {
    const C = '(bar_index == 30 ? na : close)'
    const [out] = run(5, `${state('c', C)}plot(ta.stoch(c, high, low, 5))\n`)
    for (let t = 30; t <= 34; t += 1) expect(Number.isNaN(out[t]), `bar ${t}`).toBe(true)
    expect(Number.isNaN(out[35])).toBe(false)
    expect(Number.isNaN(out[29])).toBe(false)
    // and from the restart on it equals the columnar column of the tail it can see
    const tail = pureLane(5, 'ta.stoch(close, high, low, 5)')
    // bars >= 35 see 5 clean bars, exactly the columnar window
    for (let t = 35; t < N; t += 1) expect(out[t]).toBeCloseTo(tail[t], 9)
  })

  it('two call sites of one function keep two states', () => {
    const [a, b] = run(5, `${state('c', 'close')}f(s) => ta.stoch(s, s, s, 6)\nplot(f(c))\nplot(f(c * 3))\n`)
    // stoch is scale invariant: the second site must agree with the first
    same(b, a, 'scale invariance')
  })

  it('v4 spells it bare `stoch(c, h, l, n)`; a length below 1 or a named argument refuses', () => {
    const [out] = run(4, `${state('c', 'close')}plot(stoch(c, high, low, 7))\n`)
    same(out, pureLane(5, 'ta.stoch(close, high, low, 7)'), 'v4 stoch')
    expect(refusalOf(5, `${state('c', 'close')}plot(ta.stoch(c, high, low, 0))\n`).guard).toBe('runtime:builtin-args')
    expect(refusalOf(5, `${state('c', 'close')}plot(ta.stoch(c, high, low, length = 5))\n`).guard).toBe('runtime:builtin-args')
  })
})

describe('⭐⭐ W4 T10 — ta.vwap(source) over a value the run computes', () => {
  it('equals the shipped session accumulator, resetting at each ET session', () => {
    const [out] = run(5, `${state('p', 'close * 1.01 + 0.5')}plot(ta.vwap(p))\n`)
    const price = BARS.map((b) => b.c * 1.01 + 0.5)
    const want = computeVWAP(BARS, price).map((p) => (typeof p.value === 'number' ? p.value : NaN))
    expect(same(out, want, 'vwap')).toBe(N)
    // non-vacuity: the session boundary is real (the first bar of a day IS its price)
    for (let d = 1; d < DAYS; d += 1) expect(out[d * PER_DAY]).toBeCloseTo(price[d * PER_DAY], 9)
    expect(Math.abs(out[PER_DAY - 1] - price[PER_DAY - 1])).toBeGreaterThan(1e-6)
  })

  it('equals the columnar `ta.vwap(hlc3)` when the state is a plain bar price', () => {
    const [out] = run(5, `${state('p', 'hlc3')}plot(ta.vwap(p))\n`)
    same(out, pureLane(5, 'ta.vwap(hlc3)'), 'vwap hlc3')
  })

  it('a non-finite price blanks the REST OF ITS SESSION and the next session starts clean', () => {
    const P = '(bar_index == PER + 4 ? na : close)'.replace('PER', String(PER_DAY))
    const [out] = run(5, `${state('p', P)}plot(ta.vwap(p))\n`)
    const price = BARS.map((b, i) => (i === PER_DAY + 4 ? NaN : b.c))
    const want = computeVWAP(BARS, price).map((q) => (typeof q.value === 'number' ? q.value : NaN))
    same(out, want, 'vwap hole')
    for (let t = PER_DAY + 4; t < 2 * PER_DAY; t += 1) expect(Number.isNaN(out[t])).toBe(true)
    expect(Number.isNaN(out[2 * PER_DAY])).toBe(false)
  })

  it('two call sites of one function keep two accumulators', () => {
    const [a, b] = run(5, `${state('p', 'close')}f(s) => ta.vwap(s)\nplot(f(p))\nplot(f(p * 2))\n`)
    for (let i = 0; i < N; i += 1) expect(b[i]).toBeCloseTo(a[i] * 2, 9)
  })

  it('a run with no bar instants answers na (no readable session), never a guess', () => {
    const built = build(5, `${state('p', 'close')}plot(ta.vwap(p))
`)
    const program = lowerIrProgram(built.ir)
    const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
    expect(Array.from(r.outputs[0]).every(Number.isNaN)).toBe(true)
  })

  it('the anchored / banded forms stay refused, as does a bare `vwap(x)` call', () => {
    expect(refusalOf(5, `${state('p', 'close')}plot(ta.vwap(p, timeframe.change("D")))\n`)).not.toBeNull()
    expect(refusalOf(4, `${state('p', 'close')}plot(vwap(p))\n`)).not.toBeNull()
  })
})

describe('⭐ W4 T10 — the table and the kernels', () => {
  it('every served name has a kernel behind it, and only v1-v4 bare names are legacy', () => {
    const kinds = new Set(Object.values(RUNTIME_STATE_KERNELS).map((k) => k.kind))
    expect([...kinds].sort()).toEqual(['pivot-high', 'pivot-low', 'running-total', 'session-vwap', 'stochastic'])
    for (const [name, k] of Object.entries(RUNTIME_STATE_KERNELS)) {
      expect(k.legacy, name).toBe(!name.startsWith('ta.'))
    }
    expect(RUNTIME_STATE_KERNELS['ta.vwap'].arity).toEqual([1])
    expect(Object.keys(RUNTIME_STATE_KERNELS)).not.toContain('vwap')
  })

  it('the kernels are declared where the VM looks them up', () => {
    for (const k of ['cumPine', 'pivotHighPine', 'pivotLowPine']) expect(CARRIED[k].runtimeOnly, k).toBe(true)
    for (const k of ['stochPine', 'vwapPine']) expect(CARRIED2[k].inputs, k).toBe(3)
    // the existing two-input members are still two-input
    expect(CARRIED2.valuewhen.inputs).toBeUndefined()
    expect(CARRIED2.crossOver.inputs).toBeUndefined()
  })
})
