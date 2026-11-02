// app/src/components/chart/engine/runtime/__tests__/w19r1HullOverState.test.js
//
// ─── ⭐⭐ W19-R1 — `ta.hma` over a runtime series, and a `?:` the call site fixes ──
//
// (1) `ta.hma(x, n)` where `x` is runtime state (a function parameter, a `var`)
//     refused `runtime:call-windowed-state`. It is now lowered as the columnar
//     lane computes it — `wma(2 * wma(x, half) - wma(x, n), root)`, `hullSpans`
//     the one authority for half / root — with the inner difference given its
//     own committed slot. GRADED against TradingView's own `ta.hma(close, 20)`
//     (`tests/fixtures/vendor/observations/hma-close20-2026-09-06.json`, SPY 1D,
//     2,031 bars, from bar 22 — the capture's stated warm-up) and against the
//     column on the same bars for several lengths.
// (2) In a function compiled for one call site, a `?:` whose test reads only
//     parameters that call site fixed takes ONE arm and never lowers the other
//     (C47's `switch` rule) — momentum-based-zigzag's `moving_average`.
// Refused by name: `ta.hma` in an arm that is not fixed / on the right of
// `and` / `or` (Pine keeps a built-in's own series only on the evaluations that
// reach it), a length only known while the bar runs, a length below 1.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const OBS = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/observations/hma-close20-2026-09-06.json'), 'utf8'))
const BARS = OBS.market.bars.map((b) => ({ t: Number(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }))
const N = BARS.length
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const WARMUP = OBS._vendor_parity_warmup_bars
const TOL = 0.5 * 10 ** -OBS.vendor.readDecimals

const head = '//@version=5\nindicator("t")\n'
const build = (src, inputs = {}) => buildRuntimeIr(head + src, { bars: BARS, inputs })
function run(src, inputs = {}) {
  const built = build(src, inputs)
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return outputs.map((o) => Array.from(o, (v) => (Number.isFinite(v) ? v : null)))
}
const refusal = (src, inputs = {}) => {
  const built = build(src, inputs)
  expect(built.ok).toBe(false)
  return built.refusal
}
const STATE = 'var float s = na\ns := close\n'

/** every vendor bar from the warm-up on, against one output; returns the count graded */
function gradeAgainstVendor(out) {
  let graded = 0
  BARS.forEach((b, i) => {
    const want = OBS.vendor.values[String(b.t)]
    if (i < WARMUP || want === undefined || want === null) return
    expect(out[i], `bar ${i}`).not.toBeNull()
    expect(Math.abs(out[i] - want), `bar ${i}`).toBeLessThanOrEqual(TOL)
    graded += 1
  })
  return graded
}

describe('⭐⭐ W19-R1 — `ta.hma` over a runtime series', () => {
  it('a function parameter, a `var` and a hoisted expression all draw TradingView\'s `ta.hma(close, 20)`', () => {
    const out = run(`${STATE}f(x, n) => ta.hma(x, n)\nplot(f(close, 20))\nplot(ta.hma(s, 20))\nplot(ta.hma(s * 1, 20))\n`)
    for (const o of out) {
      expect(gradeAgainstVendor(o)).toBeGreaterThan(2000)
      // nothing before the Hull's own warm-up (wma 20, then wma 4 of the difference)
      expect(o.slice(0, WARMUP).every((v) => v === null)).toBe(true)
    }
  })

  it('equals the column (`ta.hma(close, n)`, the host lane) bar for bar, lengths 1..9 and 20, 55', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 20, 55]) {
      const [col, frame, root] = run(`${STATE}f(x, k) => ta.hma(x, k)\nplot(ta.hma(close, ${n}))\nplot(f(close, ${n}))\nplot(ta.hma(s, ${n}))\n`)
      expect(col.filter((v) => v !== null).length).toBeGreaterThan(N - 70)
      expect(frame, `n=${n} frame`).toEqual(col)
      expect(root, `n=${n} root`).toEqual(col)
    }
  })

  it('two call sites of one function keep two Hulls (two lengths, two sources)', () => {
    const [a, b, ca, cb] = run(`${STATE}f(x, n) => ta.hma(x, n)\nplot(f(s, 9))\nplot(f(volume, 4))\n`
      + 'plot(ta.hma(close, 9))\nplot(ta.hma(volume, 4))\n')
    expect(a).toEqual(ca)
    expect(b).toEqual(cb)
  })

  it('a function CALLED in an arm still serves the Hull in its own body (the frame runs only when the arm does)', () => {
    // the body is compiled at the call site (a specialisation on `n`) while the
    // arm is being lowered; "every evaluation" is asked of the FRAME, and the
    // Hull equals the same function with the composition written by hand
    const [a, b] = run(`${STATE}f(x, n) => ta.hma(x, n)\n`
      + 'g(x, n) =>\n    d = 2 * ta.wma(x, 2) - ta.wma(x, n)\n    ta.wma(d, 2)\n'
      + 'plot(close > open ? f(s, 5) : na)\nplot(close > open ? g(s, 5) : na)\n')
    expect(a.filter((v) => v !== null).length).toBeGreaterThan(500)
    expect(a).toEqual(b)
  })

  it('refused by name: in an unfixed `?:` arm, on the right of `and`, a running length, a length of 0', () => {
    const arm = refusal(`${STATE}plot(close > open ? ta.hma(s, 20) : na)\n`)
    expect(arm.guard).toBe('runtime:call-windowed-state')
    expect(arm.message).toMatch(/one arm of `\?:`/)
    const lazy = refusal(`${STATE}plot(close > open and ta.hma(s, 5) > s ? 1 : 0)\n`)
    expect(lazy.guard).toBe('runtime:call-windowed-state')
    expect(refusal(`${STATE}plot(ta.hma(s, bar_index + 1))\n`).guard).toBe('runtime:history-dynamic-offset')
    const zero = refusal(`${STATE}plot(ta.hma(s, 0))\n`)
    expect(zero.guard).toBe('runtime:statement')
    expect(zero.message).toMatch(/`ta\.hma` needs a length of at least 1, got 0/)
  })
})

describe('⭐⭐ W19-R1 — a `?:` whose test the call site fixes takes one arm', () => {
  // momentum-based-zigzag:44, trimmed to the arms that matter
  const MA = 'smoothing = input.string("SMA", "Average type", options=["EMA", "SMA", "HMA"])\n'
    + 'ma(_series, _length, _smoothing) =>\n'
    + '    _smoothing == "EMA" ? ta.ema(_series, _length) : _smoothing == "SMA" ? ta.sma(_series, _length) : _smoothing == "HMA" ? ta.hma(_series, _length) : ta.ema(_series, _length)\n'
    + 'plot(ma(close, 20, smoothing))\n'
    + 'plot(ta.sma(close, 20))\nplot(ta.hma(close, 20))\nplot(ta.ema(close, 20))\n'

  it('the default (`SMA`) and each member choice draw exactly the arm they select', () => {
    const [d, sma] = run(MA)
    expect(d).toEqual(sma)
    const [h, , hma] = run(MA, { smoothing: 'HMA' })
    expect(h).toEqual(hma)
    expect(gradeAgainstVendor(h)).toBeGreaterThan(2000)
    const [e, , , ema] = run(MA, { smoothing: 'EMA' })
    expect(e).toEqual(ema)
  })

  it('the arm a fixed test never takes is not lowered — its refusal does not stop the script', () => {
    const src = 'f(x, m) =>\n    m == "A" ? ta.sma(x, 5) : ta.hma(x, bar_index + 1)\nplot(f(close, "A"))\nplot(ta.sma(close, 5))\n'
    const [a, want] = run(src)
    expect(a).toEqual(want)
    // …and when the call site picks the refused arm, ITS refusal is what is shown
    expect(refusal(src.replace('f(close, "A")', 'f(close, "B")')).guard).toBe('runtime:history-dynamic-offset')
  })

  it('a test the call site cannot fix keeps the arm\'s own refusal (never a sentence about the test)', () => {
    const r = refusal(`${STATE}g(x, m) => m == "A" ? ta.hma(x, 5) : x\nplot(g(s, close > open ? "A" : "B"))\n`)
    expect(r.guard).toBe('runtime:call-windowed-state')
    expect(r.message).toMatch(/one arm of `\?:`/)
  })
})
