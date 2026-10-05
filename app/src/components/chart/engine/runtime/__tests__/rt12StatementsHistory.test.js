// app/src/components/chart/engine/runtime/__tests__/rt12StatementsHistory.test.js
//
// ─── ⭐⭐ RT12 — statements and history on the runtime lane ─────────────────────
//
// Two constructs, each graded against the SAME program written the way the lane
// already served it (the form Pine defines the new one as), and a hand replay:
//
//   1. a comma line of a binding and calls (`pine.js::commaCallSplit`), and a
//      value builtin on a line of its own whose value is discarded
//      (`pineRuntimeFrontend.js`, the bare-call branch, `argumentHasEffect`) —
//      atr-trailing-stoploss-strategy:12, nonlinear-regression-…-loxx:93;
//   2. a function-body local bound once from values the CALL SITE fixes is fixed
//      for that call site too (`frameDerived`, `substFrameNames`), and a length
//      that is constant arithmetic folds (`foldConstNode`) —
//      range-filter-bs-signals:16 `wper = (n*2) - 1`, `ema(avrng, wper)`.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 60
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + (i % 6), h: 103 + (i % 4) + (i % 11) * 0.5, l: 97 - (i % 3), c: 100 + (i % 9) - 4 + (i % 7) * 0.25, v: 1000 + (i % 5) * 300,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const headOf = (v) => `//@version=${v}\n${v >= 5 ? 'indicator' : 'study'}("t")\n`
const build = (src, v = 5) => buildRuntimeIr(headOf(v) + src, { bars: BARS, inputs: {} })
const r9 = (v) => (v === null ? null : Math.round(v * 1e9) / 1e9)
function run(src, v = 5) {
  const built = build(src, v)
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return outputs.map((o) => Array.from(o, (x) => (Number.isFinite(x) ? r9(x) : null)))
}

describe('⭐⭐ RT12 (1) — a comma line of a binding and calls; a discarded value call', () => {
  it('`Prev = highest(…), barssince(…)` (v4 bare names) equals the binding alone', () => {
    const comma = run('Prev = highest(high, 5), barssince(close > close[1])\nplot(Prev)\n', 4)
    const alone = run('Prev = highest(high, 5)\nplot(Prev)\n', 4)
    expect(comma).toEqual(alone)
    const hs = BARS.map((b) => b.h)
    for (let i = 4; i < N; i += 1) expect(comma[0][i]).toBe(Math.max(...hs.slice(i - 4, i + 1)))
  })

  it('a binding whose trailing comma carries the next line\'s `plot` draws that plot', () => {
    const comma = run('float out = ta.ema(close, 4)\ncolor c = out > out[1] ? color.green : color.red,\nplot(out, "o", color = c)\n')
    const lines = run('float out = ta.ema(close, 4)\ncolor c = out > out[1] ? color.green : color.red\nplot(out, "o", color = c)\n')
    expect(comma).toEqual(lines)
    expect(comma[0].filter((v) => v !== null).length).toBeGreaterThan(40)
  })

  it('`ta.change(x)` and `ta.sma(close, 3)` on lines of their own are dropped (v5 spellings)', () => {
    const out = run('var float x = 0.0\nx := x + close\nta.change(x)\nta.sma(close, 3)\nplot(x)\n')
    expect(out).toEqual(run('var float x = 0.0\nx := x + close\nplot(x)\n'))
  })

  it('control: a discarded call to a user function that keeps state is still LOWERED (not dropped)', () => {
    // the helper's `var` count is read back through a global array it pushes to:
    // dropping the call would leave the array empty.
    const out = run('var a = array.new_float()\nf(x) =>\n    array.push(a, x)\n    x\nf(close)\nplot(array.size(a))\n')
    expect(out[0].slice(-1)[0]).toBe(N)
  })

  it('control: a discarded call to a name nothing declares keeps a refusal', () => {
    const b = build('Prev = ta.highest(high, 5), nosuchfn(close)\nplot(Prev)\n')
    expect(b.ok).toBe(false)
  })
})

describe('⭐⭐ RT12 (2) — a local fixed by its call site, and constant arithmetic in a length', () => {
  const RNG = 'rng(x, n) =>\n    wper = (n*2) - 1\n    ta.ema(x, wper)\n'

  it('`wper = (n*2) - 1` sizes `ema` per call site: equals the literal window, two sites two windows', () => {
    const out = run(`${RNG}per = input.int(4, "p")\nplot(rng(close, per))\nplot(rng(close, 6))\nplot(ta.ema(close, 7))\nplot(ta.ema(close, 11))\n`)
    expect(out[0]).toEqual(out[2])
    expect(out[1]).toEqual(out[3])
    expect(out[0]).not.toEqual(out[1])
    expect(out[0].filter((v) => v !== null).length).toBeGreaterThan(40)
  })

  it('range-filter-bs-signals\' `rng_size` as written (v4) equals its hand-folded form', () => {
    const src = (len) => 'rng_size(x, qty, n)=>\n    wper      = (n*2) - 1\n    avrng     = ema(abs(x - x[1]), n)\n'
      + `    AC = ema(avrng, ${len})*qty\n    rng_size = AC\nper = input(defval=5, minval=1, title="p")\n`
      + 'plot(rng_size(close, 3.5, per))\n'
    const folded = run(src('wper'), 4)
    expect(folded).toEqual(run(src('9'), 4))
    expect(folded).not.toEqual(run(src('8'), 4))
    expect(folded[0].filter((v) => v !== null).length).toBeGreaterThan(40)
  })

  it('a top-level length of constant arithmetic (`len * 2 + 1`) folds to one window', () => {
    const out = run('len = input.int(3, "l")\nplot(ta.ema(close, len * 2 + 1))\nplot(ta.ema(close, 7))\n')
    expect(out[0]).toEqual(out[1])
  })

  it('control: a local derived by DIVISION keeps the refusal (integer division is version-dependent)', () => {
    const b = build('f(x, n) =>\n    w = n / 2\n    ta.ema(x, w)\nplot(f(close, 8))\n')
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:history-dynamic-offset')
    // …and as a bar OFFSET (`constValueOf`, which folds arithmetic on its own):
    // the local is not read through at all, so the quotient never reaches a fold
    const o = build('var float s = 0.0\ns := s + close\nf(x, n) =>\n    w = n / 2\n    x[w]\nplot(f(s, 8))\n')
    expect(o.ok).toBe(false)
  })

  it('control: a local that is REASSIGNED, or a `var`, is not read through', () => {
    const re = build('f(x, n) =>\n    w = n * 2\n    w := w + 1\n    ta.ema(x, w)\nplot(f(close, 4))\n')
    expect(re.ok).toBe(false)
    expect(re.refusal.guard).toBe('runtime:history-dynamic-offset')
    const vr = build('f(x, n) =>\n    var w = n * 2\n    ta.ema(x, w)\nplot(f(close, 4))\n')
    expect(vr.ok).toBe(false)
    expect(vr.refusal.guard).toBe('runtime:history-dynamic-offset')
  })

  it('control: a local read from a SERIES (`close`) is not fixed', () => {
    const b = build('f(x, n) =>\n    w = n + close\n    ta.ema(x, w)\nplot(f(close, 4))\n')
    expect(b.ok).toBe(false)
  })
})

describe('⭐⭐ RT12 (3) — a STATEFUL expression in a function: its history, on every evaluation', () => {
  const ATR = 'f(len) => math.min(ta.atr(len) * 0.3, close * 0.003)[3] / 2\n'
  const HAND = 'g(len) =>\n    v = math.min(ta.atr(len) * 0.3, close * 0.003)\n    v[3] / 2\n'

  it('`math.min(ta.atr(len) * 0.3, …)[3] / 2` (smart-money-breakouts-chartprime:85) equals the hand-bound local', () => {
    const out = run(`${ATR}${HAND}plot(f(5))\nplot(g(5))\nplot(f(8))\nplot(g(8))\n`)
    expect(out[0]).toEqual(out[1])
    expect(out[2]).toEqual(out[3])
    expect(out[0]).not.toEqual(out[2])
    expect(out[0].filter((v) => v !== null).length).toBeGreaterThan(40)
  })

  it('`ta.sma(ta.ema(s, 3) * 2, 4)` in a frame equals the hand-bound local', () => {
    const out = run('f(s) => ta.sma(ta.ema(s, 3) * 2, 4)\ng(s) =>\n    e = ta.ema(s, 3) * 2\n    ta.sma(e, 4)\nplot(f(close))\nplot(g(close))\n')
    expect(out[0]).toEqual(out[1])
    expect(out[0].filter((v) => v !== null).length).toBeGreaterThan(40)
  })

  it('control: inside a `?:` ARM (evaluated on some calls only) the refusal stays', () => {
    const b = build('f(len, c) => c ? (ta.atr(len) * 2)[3] : 0.0\nplot(f(5, close > open))\n')
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:history-expression')
  })

  it('control: on the right of `and` (short-circuited) the refusal stays', () => {
    const b = build('f(len) => close > open and (ta.atr(len) * 2)[3] > 1\nplot(f(5) ? 1 : 0)\n')
    expect(b.ok).toBe(false)
  })
})
