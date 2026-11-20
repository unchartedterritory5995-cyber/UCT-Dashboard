// app/src/components/chart/engine/runtime/__tests__/a4ParamBranchChecked.test.js
//
// ─── ⭐⭐ A4 — A BRANCH DECIDED BY A PARAMETER THE CALL SITE PASSES PER BAR, CHECKED TO RUN ON EVERY CALL ──────
//
// support-and-resistance (v4): `Variance(src, p) => p == 1 ? 0 : Sma(src * src, p) - pow(Sma(src, p), 2)`,
// `Sma(src, p) => a = cum(src), (a - a[max(p, 0)]) / max(p, 0)`, called `Variance(n, k)` with
// `k = n - val > 0 ? n - val : 2`. The test reads a value that changes every bar, so no call site can fix the
// branch (C35), and the arm holds history (`cum`, `a[p]`): until A4 the call was refused
// `runtime:conditional-history` ("`p` decides a branch of `Variance` ... this lane does not serve that shape yet").
//
// Pine keeps that history per call site, over the calls the arm RAN on (C48; a v4 `?:` arm is LAZY:
// `vw-cs2-v4-ternary-lazy` T00 / T01 / T02 count the arm's runs on 666 / 666 RDDT bars). While the arm has run on
// EVERY call of a call that runs on every bar, those calls are every bar, and the every-bar value is TradingView's
// whatever the version's arm rule. So the copy compiled for that call site lowers the branch with HIST-S3's every-bar
// check (`collections.js::callSiteRuns`): drawn while the branch has run on every call, and the first call it skips
// STOPS the run by name. The engine-64 queue doc names exactly this as an engine gap, not a capture question
// (docs/pine/capture-queue-2026-11-16-runtime-history.md).
//
// Acceptance: every drawn value equals Pine's semantics computed here by hand from the bars (an independent oracle,
// not the lane's kernels); a branch that skips a call stops by name at that call; every shape this does not serve
// keeps its refusal by name.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { probeRuntimeProgram } from '../runtimeColumns.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { runRefusalOf } from './condHistoryOutcome.js'

const barsOf = (n) => Array.from({ length: n }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + i * 0.1 + Math.cos(i / 1.7) * 2,
  h: 104 + i * 0.1 + (i % 3),
  l: 96 + i * 0.1 - (i % 4),
  c: 100 + Math.sin(i / 2.3) * 12 + i * 0.07,
  v: 1000 + i,
}))
const N = 80
const BARS = barsOf(N)
const C = BARS.map((b) => b.c)
const H = BARS.map((b) => b.h)
const R4 = 'runtime:conditional-history'
const v4 = (body) => `//@version=4\nstudy("t")\n${body}`
const v5 = (body) => `//@version=5\nindicator("t")\n${body}`
const v6 = (body) => `//@version=6\nindicator("t")\n${body}`

const build = (src, extra = {}) => buildRuntimeIr(src, { bars: BARS, inputs: {}, ...extra })
function run(src) {
  const built = build(src)
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir, { historyFromListing: true })
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
  const r = execute(program, { bars: BARS.length, series, columns: program.columns, confirmed: true })
  return { outs: r.outputs.map((o) => Array.from(o)), built }
}
const outcome = (src) => runRefusalOf(src, { bars: BARS })
const same = (got, want, label) => {
  expect(got.length).toBe(want.length)
  let compared = 0
  for (let i = 0; i < want.length; i += 1) {
    if (Number.isNaN(want[i])) expect(Number.isNaN(got[i]), `${label} bar ${i} should be na (got ${got[i]})`).toBe(true)
    else {
      expect(got[i], `${label} bar ${i}`).toBeCloseTo(want[i], 6)
      compared += 1
    }
  }
  return compared
}

// ─── the oracle: Pine's `cum`, `a[k]` and the two `Sma` calls, by hand ───────────────────────────────────────
const cumOf = (xs) => { let s = 0; return xs.map((x) => (s += x)) }
/** `Sma(src, p) => a = cum(src), (a - a[max(p, 0)]) / max(p, 0)` on bar i, the call run on every bar. */
const smaAt = (A, i, p) => {
  const k = Math.max(p, 0)
  const back = i - k >= 0 ? A[i - k] : NaN
  return (A[i] - back) / k
}
/** `Variance(src, p)` on bar i with the else arm run on every bar (the test false on every bar). */
const varianceOf = (xs, ps) => {
  const A1 = cumOf(xs.map((x) => x * x))
  const A0 = cumOf(xs)
  return xs.map((_, i) => (ps[i] === 1 ? 0 : smaAt(A1, i, ps[i]) - smaAt(A0, i, ps[i]) ** 2))
}
const highestOf = (xs, n) => xs.map((_, i) => (i + 1 < n ? NaN : Math.max(...xs.slice(i - n + 1, i + 1))))

const SR = 'Sma(src,p) => a = cum(src), (a - a[max(p,0)])/max(p,0)\n'
  + 'Variance(src,p) => p == 1 ? 0 : Sma(src*src,p) - pow(Sma(src,p),2)\n'
// a value the fold cannot know, never 1: 5 after bar 10, 2 before (the S&R `k`: `n - val`, or 2)
const K_NEVER_ONE = 'k = bar_index > 10 ? 5 : 2\n'
const kNeverOne = BARS.map((_, i) => (i > 10 ? 5 : 2))

describe('A4 — support-and-resistance\'s Variance: a per-bar branch parameter, drawn while the arm runs every call', () => {
  it('the S&R shape builds and every bar equals Pine\'s value (the arm ran on every bar)', () => {
    const { outs, built } = run(v4(`${SR}${K_NEVER_ONE}plot(Variance(close, k))\n`))
    expect(built.diagnostics.checkedSpecialisedCalls).toBeGreaterThanOrEqual(1)
    expect(same(outs[0], varianceOf(C, kNeverOne), 'Variance')).toBeGreaterThan(60)
  })
  it('⚰️ THE WALL IT WAS: refused at the call, naming `p` (no call site fixes a per-bar value)', () => {
    // the same script with the branch on a value the call site DOES fix compiles C35's copy, not A4's
    const fixed = run(v4(`${SR}plot(Variance(close, 5))\n`))
    expect(fixed.built.diagnostics.checkedSpecialisedCalls || 0).toBe(0)
    expect(same(fixed.outs[0], varianceOf(C, C.map(() => 5)), 'Variance(close, 5)')).toBeGreaterThan(60)
  })
  it('a call reached through the caller\'s own parameter checks the branch in the inner copy', () => {
    const { outs } = run(v4(`${SR}g(x, q) => Variance(x, q)\n${K_NEVER_ONE}plot(g(close, k))\n`))
    same(outs[0], varianceOf(C, kNeverOne), 'g -> Variance')
  })
  it('the first call the arm skips STOPS the run by name, naming the bars (the then-arm taken on bar 3)', () => {
    const r = outcome(v4(`${SR}k = bar_index == 3 ? 1 : 5\nplot(Variance(close, k))\n`))
    expect(r && r.guard).toBe(R4)
    expect(r.at).toBe('run')
    expect(r.message).toMatch(/skips bar 3 and runs again on bar 4/)
  })
  it('a first run after the first bar stops too (the then-arm taken on bar 0)', () => {
    const r = outcome(v4(`${SR}k = bar_index == 0 ? 1 : 5\nplot(Variance(close, k))\n`))
    expect(r && r.guard).toBe(R4)
    expect(r.at).toBe('run')
    expect(r.message).toMatch(/skips bar 0 and runs again on bar 1/)
  })
})

describe('A4 — the same rule for an `if` branch on a parameter, any version', () => {
  const F = 'f(src, p) =>\n    float r = 0.0\n    if p > 3\n        r := ta.highest(src, 3)\n    r\n'
  it('a branch that runs on every call is drawn, and equals the every-bar call', () => {
    const { outs } = run(v6(`${F}k = close > 0 ? 5 : 4\nplot(f(high, k))\nplot(ta.highest(high, 3))\n`))
    // the every-bar call on every bar, and the oracle's highest of the last 3 highs once 3 bars exist
    same(outs[0], outs[1], 'f(high, k) vs the every-bar ta.highest')
    const want = highestOf(H, 3)
    for (let i = 2; i < N; i += 1) expect(outs[0][i], `bar ${i}`).toBeCloseTo(want[i], 9)
  })
  it('a branch that skips a call stops by name at that call', () => {
    const r = outcome(v6(`${F}k = bar_index % 9 == 4 ? 2 : 5\nplot(f(high, k))\n`))
    expect(r && r.guard).toBe(R4)
    expect(r.at).toBe('run')
    expect(r.message).toMatch(/skips bar 4 and runs again on bar 5/)
  })
})

describe('A4 — what keeps the refusal by name', () => {
  it('a parameter declared `simple` passed a per-bar value (Pine does not compile it)', () => {
    const b = build(v5('V(float src, simple int p) => p == 1 ? 0.0 : ta.highest(src, 3)\nk = close > 0 ? 5 : 4\nplot(V(close, k))\n'))
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe(R4)
    expect(b.refusal.message).toMatch(/`p` decides a branch of `V`/)
  })
  it('the call in a loop (several calls a bar)', () => {
    const b = build(v4(`${SR}${K_NEVER_ONE}s = 0.0\nfor i = 0 to 1\n    s := s + Variance(close, k)\nplot(s)\n`))
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe(R4)
  })
  it('the drawing build (HIST-S3 runs on the value lane only)', () => {
    const drawn = probeRuntimeProgram(v4(`${SR}${K_NEVER_ONE}var line l = na\nif barstate.islast\n    l := line.new(bar_index - 1, 0, bar_index, Variance(close, k))\n`), { objectsInRun: true })
    expect(drawn.ok).toBe(false)
    expect(drawn.refusal.guard).toBe(R4)
    expect(String(drawn.refusal.message)).toMatch(/`p` decides a branch of `Variance`/)
  })
})
