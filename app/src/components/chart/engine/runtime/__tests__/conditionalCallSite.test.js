// app/src/components/chart/engine/runtime/__tests__/conditionalCallSite.test.js
//
// ─── ⭐⭐⭐ WS-C (Phase 3) — A CONDITIONAL `ta.*` KEEPS ITS CALL SITE'S HISTORY ──
//
// P3 / owner ruling R4 (2026-10-31). On the runtime PLOT lane a pure `ta.*`
// written inside an `if`, a loop or a function body was lowered to an every-bar
// COLUMN, so a call that runs on SOME bars answered from EVERY bar. Pine keeps
// that history per call site: a window counts the RUNS of its call, the EMA is
// seeded by the mean of its first n runs, a block local's `[1]` is the previous
// RUN's value.
//
// ⭐ THE WITNESS — `vw-call-site-history-rddt-1d-2026-10-01` (NYSE:RDDT 1D from
// the listing) and `-spy-1d-2026-10-01` (AMEX:SPY 1D, the newest 1,800 bars),
// probe `tools/visual_conformance/probes/vw-call-site-history.pine`. Rows used:
//   C03 `ta.sma(close, 3)` and C04 `ta.ema(close, 3)` under `close > open`;
//   D02 `ta.sma(close, 3)` under `bar_index % 2 == 0` (a window over RUNS and a
//   window over BARS differ on every even bar).
//
// ⭐ WHAT IS PINNED:
//   1. SERVED, EXACTLY: the runtime lane, given the probe's own rows and the
//      capture's bars, prints TradingView's number on every bar the row runs;
//   2. ⚰️ THE DEFECT, MEASURED: the every-bar column it used to print (E03 / E04,
//      masked to the run bars) differs from TradingView on most run bars;
//   3. R4 — every other conditional shape is REFUSED BY NAME
//      (`runtime:conditional-history`), never the every-bar number;
//   4. what was always right stays served: a ROOT-level series read in a block,
//      a function with history called on every bar, `close[1]` in a block.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const load = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))
const RDDT = load('vw-call-site-history-rddt-1d-2026-10-01.json')
const SPY = load('vw-call-site-history-spy-1d-2026-10-01.json')

const barsOf = (cap) => cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v == null ? 0 : v }))
const seriesOf = (bars) => ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))

/** The capture's row `plot_<k>` keyed by bar time. */
const rowOf = (cap, k) => {
  const at = cap.plotValues.fields.indexOf(`plot_${k}`)
  const m = new Map()
  for (const r of cap.plotValues.rows) m.set(r[0], r[at] == null ? NaN : r[at])
  return m
}

function run(src, cap) {
  const bars = barsOf(cap)
  const built = buildRuntimeIr(src, { bars, inputs: {} })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: bars.length, series: seriesOf(bars), columns: program.columns, confirmed: true })
  return r.outputs.map((o) => Array.from(o))
}
const refusalOf = (src, cap = RDDT) => {
  const b = buildRuntimeIr(src, { bars: barsOf(cap), inputs: {} })
  return b.ok ? null : b.refusal
}

/** Compare a computed row with a capture row on every bar the capture has; skip
 *  the first `warm` RUNS (a chart that does not start at the listing cannot know
 *  the runs before it). Returns {compared, mismatched}. */
function grade(cap, ours, theirs, { warm = 0, runs = null } = {}) {
  const bars = barsOf(cap)
  let seen = 0
  let compared = 0
  const mismatched = []
  bars.forEach((b, i) => {
    if (!theirs.has(b.t)) return
    const tv = theirs.get(b.t)
    const ran = runs ? runs(i, bars) : true
    if (ran) seen += 1
    if (ran && seen <= warm) return
    const us = ours[i]
    compared += 1
    const both = Number.isNaN(tv) && Number.isNaN(us)
    if (!both && !(Math.abs(us - tv) <= 1e-6 * Math.max(1, Math.abs(tv)))) mismatched.push({ i, tv, us })
  })
  return { compared, mismatched }
}

const UP = (i, bars) => bars[i].c > bars[i].o
const EVEN = (i) => i % 2 === 0

const SRC_C = `//@version=6
indicator("t")
float c_sma = na
float c_ema = na
if close > open
    c_sma := ta.sma(close, 3)
    c_ema := ta.ema(close, 3)
plot(c_sma)
plot(c_ema)
`
const SRC_D = `//@version=6
indicator("t")
float d_sma = na
if bar_index % 2 == 0
    d_sma := ta.sma(close, 3)
plot(d_sma)
`

describe('⭐⭐⭐ served exactly — a conditional `ta.sma` / `ta.ema` counts its RUNS (C48 rows C03, C04, D02)', () => {
  it('RDDT from the listing: C03 / C04 / D02 equal TradingView on every captured bar', () => {
    const [sma, ema] = run(SRC_C, RDDT)
    const [dsma] = run(SRC_D, RDDT)
    for (const [ours, k] of [[sma, 2], [ema, 3], [dsma, 13]]) {
      const g = grade(RDDT, ours, rowOf(RDDT, k))
      expect(g.compared).toBeGreaterThan(600)
      expect(g.mismatched, `plot_${k}`).toEqual([])
    }
  })
  it('SPY (not from the listing): equal once the window holds runs this chart saw', () => {
    const [sma, ema] = run(SRC_C, SPY)
    const [dsma] = run(SRC_D, SPY)
    // the window's own n runs; the EMA forgets its seed at alpha 1/2 per run
    expect(grade(SPY, sma, rowOf(SPY, 2), { warm: 3, runs: UP }).mismatched).toEqual([])
    expect(grade(SPY, ema, rowOf(SPY, 3), { warm: 60, runs: UP }).mismatched).toEqual([])
    expect(grade(SPY, dsma, rowOf(SPY, 13), { warm: 3, runs: EVEN }).mismatched).toEqual([])
  })
  it('v4 spelling (`sma` / `ema`) is the same call site', () => {
    const v4 = SRC_C.replace('//@version=6', '//@version=4').replace('indicator(', 'study(')
      .replace(/ta\.sma/g, 'sma').replace(/ta\.ema/g, 'ema')
      .replace('float c_sma = na', 'c_sma = float(na)').replace('float c_ema = na', 'c_ema = float(na)')
    const [sma, ema] = run(v4, RDDT)
    expect(grade(RDDT, sma, rowOf(RDDT, 2)).mismatched).toEqual([])
    expect(grade(RDDT, ema, rowOf(RDDT, 3)).mismatched).toEqual([])
  })
  it('a value-position arm (`x = if …`) is the same call site', () => {
    const src = `//@version=6
indicator("t")
c = if close > open
    ta.sma(close, 3)
plot(c)
`
    const [c] = run(src, RDDT)
    expect(grade(RDDT, c, rowOf(RDDT, 2)).mismatched).toEqual([])
  })
})

describe('⚰️ the defect — the every-bar column, masked to the run bars, is NOT TradingView', () => {
  it('E03 / E04 (the old answer) differ on most run bars of C03 / C04 / D02', () => {
    const src = `//@version=6
indicator("t")
plot(ta.sma(close, 3))
plot(ta.ema(close, 3))
`
    const [esma, eema] = run(src, RDDT)
    const bars = barsOf(RDDT)
    const masked = (row, ran) => row.map((v, i) => (ran(i, bars) ? v : NaN))
    const c03 = grade(RDDT, masked(esma, UP), rowOf(RDDT, 2))
    const c04 = grade(RDDT, masked(eema, UP), rowOf(RDDT, 3))
    const d02 = grade(RDDT, masked(esma, EVEN), rowOf(RDDT, 13))
    expect(c03.mismatched.length).toBeGreaterThan(150)
    expect(c04.mismatched.length).toBeGreaterThan(150)
    expect(d02.mismatched.length).toBeGreaterThan(150)
  })
})

describe('⭐⭐ R4 — every other conditional shape is refused BY NAME on the plot lane', () => {
  const head = '//@version=6\nindicator("t")\nfloat y = na\n'
  const cases = {
    'an unwitnessed window (`ta.highest`) in a block': 'if close > open\n    y := ta.highest(high, 10)\nplot(y)\n',
    'an unwitnessed recurrence (`ta.rsi`) in a block': 'if close > open\n    y := ta.rsi(close, 14)\nplot(y)\n',
    'a `ta.*` in a loop': 'for i = 0 to 2\n    y := ta.sma(close, 3)\nplot(y)\n',
    'a `ta.*` in a branch of a function body': 'f(x) =>\n    r = 0.0\n    if x > 0\n        r := ta.sma(close, 3)\n    r\ny := f(close - open)\nplot(y)\n',
    'a function with column history called conditionally': 'g() => ta.sma(close, 3)\nif close > open\n    y := g()\nplot(y)\n',
    'a block local\'s `[1]`': 'if close > open\n    cx = close * 2\n    y := cx[1]\nplot(y)\n',
    'a block-bound series\' `[1]`': 'if close > open\n    m = ta.sma(close, 3)\n    y := m[1]\nplot(y)\n',
    'a `ta.*` in an arm of `?:` inside a block': 'if close > open\n    y := volume > 0 ? ta.sma(close, 3) : 0\nplot(y)\n',
    'a window over a variable that reads the bar ring (`ta.highest(v, n)`)': 'v = close * 2\nv := v + 1\nif close > open\n    y := ta.highest(v, 3)\nplot(y)\n',
  }
  for (const [name, body] of Object.entries(cases)) {
    it(name, () => {
      const r = refusalOf(head + body)
      expect(r, name).not.toBeNull()
      expect(r.guard).toBe('runtime:conditional-history')
    })
  }
})

describe('✅ what was always right stays served', () => {
  const head = '//@version=6\nindicator("t")\nfloat y = na\n'
  it('a ROOT-level `ta.*` read inside a block is the every-bar series', () => {
    const [y] = run(head + 'ma = ta.sma(close, 3)\nif close > open\n    y := ma\nplot(y)\n', RDDT)
    const [e] = run('//@version=6\nindicator("t")\nplot(ta.sma(close, 3))\n', RDDT)
    const bars = barsOf(RDDT)
    bars.forEach((b, i) => {
      if (b.c > b.o) expect(Object.is(y[i], e[i]) || Math.abs(y[i] - e[i]) < 1e-12).toBe(true)
      else expect(Number.isNaN(y[i])).toBe(true)
    })
  })
  it('`close[1]` and `bar_index[1]` in a block are the chart\'s (C06 is served)', () => {
    const [bi] = run(head + 'if close > open\n    y := bar_index[1]\nplot(y)\n', RDDT)
    expect(grade(RDDT, bi, rowOf(RDDT, 5)).mismatched).toEqual([])
  })
  it('a function with history called on EVERY bar keeps its column', () => {
    const [y] = run(head + 'g() => ta.sma(close, 3)\ny := g()\nplot(y)\n', RDDT)
    const [e] = run('//@version=6\nindicator("t")\nplot(ta.sma(close, 3))\n', RDDT)
    expect(y).toEqual(e)
  })
  // ⭐ A block whose test reads nothing per-bar (an input, a literal) runs on
  // EVERY bar or on NONE, so its history IS the bar's: it is not conditional.
  // The owner's own uncharted-volume picks its range smoother this way.
  const E = () => run('//@version=6\nindicator("t")\nplot(ta.sma(close, 3))\n', RDDT)[0]
  it('an `if` on an INPUT (bool, text) keeps the every-bar column', () => {
    const [b] = run(head + 'on = input.bool(true, "on")\nif on\n    y := ta.sma(close, 3)\nplot(y)\n', RDDT)
    expect(b).toEqual(E())
    const [t] = run(head + 'm = input.string("SMA", "m", options = ["SMA", "EMA"])\n'
      + 'if m == "EMA"\n    y := ta.ema(close, 3)\nelse if m == "SMA"\n    y := ta.sma(close, 3)\nplot(y)\n', RDDT)
    expect(t).toEqual(E())
  })
  it('a `switch` on an input, with block arms, keeps the every-bar column', () => {
    const [s] = run('//@version=6\nindicator("t")\nm = input.string("SMA", "m", options = ["SMA", "EMA"])\n'
      + 'y = switch m\n    "EMA" =>\n        ta.ema(close, 3)\n    =>\n        ta.sma(close, 3)\nplot(y)\n', RDDT)
    expect(s).toEqual(E())
  })
  it('… and a `switch` on a PER-BAR subject is a conditional region (served for `ta.sma`)', () => {
    const [s] = run('//@version=6\nindicator("t")\n'
      + 'y = switch close > open\n    true => ta.sma(close, 3)\n    => na\nplot(y)\n', RDDT)
    expect(grade(RDDT, s, rowOf(RDDT, 2)).mismatched).toEqual([])
  })
  it('a function-body `if` on a text input is the call site\'s every call (uncharted-volume\'s f_getDailyData)', () => {
    const src = '//@version=6\nindicator("t")\nm = input.string("RMA", "m")\n'
      + 'f() =>\n    float r = na\n    if m == "RMA"\n        r := ta.rma(high - low, 3)\n    else\n        r := ta.sma(high - low, 3)\n    r\n'
      + 'plot(f())\n'
    expect(refusalOf(src)).toBeNull()
  })
  it('a binding made in one branch and read in a deeper one is refused, never re-stepped there', () => {
    const r = refusalOf(head + 'if close > open\n    m = ta.sma(close, 3)\n    if volume > 0\n        y := m\nplot(y)\n')
    expect(r && r.guard).toBe('runtime:conditional-history')
  })
  it('a function with only body-local `[k]` called conditionally (held per site, vendor-pinned) still builds', () => {
    expect(refusalOf(head + 'h(s) =>\n    s[1]\nif close > open\n    y := h(close)\nplot(y)\n')).toBeNull()
  })
})
