// app/src/components/chart/engine/runtime/__tests__/functionGlobalHistory.test.js
//
// ─── ⭐⭐ U-FGS (libraries chain, 2026-11-19) — A FUNCTION BODY READING A GLOBAL WITH HISTORY ─────────────────
//
// THE WITNESS. `vw-udt-fn-global-history-rddt-1d-2026-11-16` (committed; our probe
// `tools/visual_conformance/probes/vw-udt-fn-global-history.pine`, NYSE:RDDT 1D from the listing) reads what
// Pine answers for a MUTABLE global read with history inside a user function:
//   G01  `f() => g[1]`, g a `var` counter                       the previous bar's g (called every bar)
//   G03  `m[1]` with `m := m + 5` AFTER the call each bar         (b-1)*10, NOT (b-1)*10+5: the value AT THE CALL
//   G04  `g[n]`, n a run-time offset                             the value n calls back
//   G05  the function called on even bars only                   1, 3, 5, …: the previous CALL's value
//   G06  a plain global reassigned with `:=` every bar           the previous bar's value
// So a global inside a function is an IMPLICIT ARGUMENT: its value at the call, its history per call site. F2
// serves exactly that (`pineRuntimeFrontend.js::frameGlobalCopy`): the body's first statement copies the global
// into a frame-local slot, and every history read, window and `ta.change` of it in the body reads the copy.
//
// WHAT STILL REFUSES, BY NAME:
//   · a global bound ONCE (`h = …`, never reassigned): whether its past inside a function is the previous call's
//     or the previous bar's is capture rows W13 / W14 (`vw-fn-global-window.pine`);
//   · a copy's history read in a block of the body whose test may vary per call (W08 / V04): the region rule
//     (drawn as on every bar and checked as it runs: a block that skips a call stops the run by name);
//   · at the object door (it keeps the answer it had). A request's value is not this frame at all: the request
//     region lowers the function's body in its own sub-run (`lowerInlineCall`), and the copy is never taken there.
//
// F1 (the same unit, the wall's mislabels): `ta.change(pl)` at the ROOT, `pl` a binding the lane holds as an
// expression, and the one-argument `ta.lowest(n)` over the chart's own `low`, both refused as "a function body
// reading a mutable GLOBAL" where there is no function and nothing mutable.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { loadCapture } from '../../__tests__/vendorHarness/harness'
import { runOurSide } from '../../__tests__/vendorHarness/ourSide'

beforeAll(() => { vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

const N = 12
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + ((i * 7) % 5), h: 106 + ((i * 3) % 7), l: 95 - ((i * 5) % 4),
  c: 100 + ((i * 11) % 9) - 4, v: 1000 + i * 10,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const v6 = '//@version=6\nindicator("t")\n'
const build = (src) => buildRuntimeIr(v6 + src, { bars: BARS, inputs: {} })
function outs(src) {
  const b = build(src)
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  const program = lowerIrProgram(b.ir)
  return execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
    .outputs.map((o) => Array.from(o, (x) => (Number.isNaN(x) ? null : x)))
}
const refusal = (src) => {
  const b = build(src)
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}

// G04 (`g[n]`, n a run-time offset through a parameter) is a DIFFERENT wall: the ring a per-bar offset needs
// cannot be sized before bar 0 (`runtime:history-dynamic-offset`, the dynamic-history unit). Its function and its
// plot read nothing the other rows read, so the witness grades the other rows on the script WITHOUT those two
// lines, against TradingView's values for the script with them: removing an independent plot moves no other one.
const G04 = '\n\nf4(int n) =>\n    g[n]\nplot(f4(bar_index % 3), "G04_global_hist_runtime_offset")\n'

describe('⭐⭐ the witness: vw-udt-fn-global-history, every plot on every bar', () => {
  it('G01 / G03 / G05 / G06 (and the control) equal TradingView\'s through the runtime lane', () => {
    const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
    const cap = loadCapture(path.join(DIR, 'vw-udt-fn-global-history-rddt-1d-2026-11-16.json')).capture
    expect(cap.history.startsAtBar0).toBe(true)
    // the whole probe stops at G04's wall, by name, and only there
    const whole = runOurSide(cap)
    expect(whole.ok).toBe(false)
    expect(JSON.stringify(whole.refusal)).toMatch(/history-dynamic-offset/)
    expect(cap.source.text.split(G04).length).toBe(2)
    const ours = runOurSide({ ...cap, source: { ...cap.source, text: cap.source.text.replace(G04, '\n') } })
    expect(ours.ok, JSON.stringify(ours.refusal || null)).toBe(true)
    const titles = cap.study.plots.map((p) => p.title)
    const graded = titles.filter((t) => !t.startsWith('G04'))
    expect(ours.plots.map((p) => p.title)).toEqual(graded)
    let compared = 0
    ours.plots.forEach((p) => {
      expect(p.missingReason || null, p.title).toBeNull()
      const k = titles.indexOf(p.title)
      const col = Array.from(p.column)
      cap.plotValues.rows.forEach((r, i) => {
        const tv = r[k + 1]
        if (tv === null) expect(Number.isFinite(col[i]), `${p.title} bar ${i}`).toBe(false)
        else { expect(col[i], `${p.title} bar ${i}`).toBe(tv); compared += 1 }
      })
    })
    expect(compared).toBeGreaterThan(5 * 300)
  }, 120000)
})

describe('⭐ F2 — the frame copy is the value at the call, per call site', () => {
  it('two call sites of one function keep two rings (every bar / every third bar)', () => {
    const [a, b] = outs('var float g = 0.0\ng += 1\nf() =>\n    ta.change(g)\nplot(f())\n'
      + 'float r = na\nif bar_index % 3 == 0\n    r := f()\nplot(r)\n')
    expect(a).toEqual([null, ...Array(N - 1).fill(1)])
    // the second site's previous call was three bars back: g moved by 3 between its calls
    expect(b).toEqual(BARS.map((_, i) => (i % 3 !== 0 ? null : (i === 0 ? null : 3))))
  })

  it('a block of the body the call site settles (an input) is served; one whose test varies stops by name (W08)', () => {
    expect(outs('show = input.bool(true)\nvar float g = 0.0\ng += 1\nf() =>\n    float r = na\n    if show\n'
      + '        r := g[1]\n    r\nplot(f())\n')[0]).toEqual([null, ...BARS.slice(1).map((_, i) => i + 1)])
    // the region rule (HIST-S3): drawn as on every bar and CHECKED as it runs, so a block that skips a bar stops
    // the run, naming the read, rather than answer what W08 has not read yet
    expect(BARS.some((b) => !(b.c > b.o)) && BARS.some((b) => b.c > b.o)).toBe(true)
    expect(() => outs('var float g = 0.0\ng += 1\nf() =>\n    float r = na\n    if close > open\n        r := g[1]\n'
      + '    r\nplot(f())\n')).toThrow(/history of the global `g`, read in a block of a function body/)
  })

  it('a window over the copy reads the global AT THE CALL (the root\'s window, called every bar)', () => {
    // the window on a statement of the body, before its last line: the copy must already hold this call's value
    const [fn, line, root] = outs('var float g = 0.0\ng += close\nf() =>\n    ta.sma(g, 3)\n'
      + 'h() =>\n    s = ta.sma(g, 3)\n    s\nplot(f())\nplot(h())\nplot(ta.sma(g, 3))\n')
    expect(fn).toEqual(root)
    expect(line).toEqual(root)
    expect(root.filter((x) => x !== null).length).toBe(N - 2)
  })

  it('a global bound once keeps its refusal, naming the capture rows that decide it', () => {
    const r = refusal('var float g = 0.0\ng += 1\nh = g * 2\nf() =>\n    h[1]\nplot(f())\n')
    expect(r.guard).toBe('runtime:function-global-state')
    expect(r.message).toMatch(/bound once/)
    expect(r.message).toMatch(/W13/)
  })

  it('at the object door the global keeps the answer it had', () => {
    const b = buildRuntimeIr(`${v6}var float g = 0.0\ng += 1\nf() =>\n    g[1]\nplot(f())\n`,
      { bars: BARS, inputs: {}, objectDoor: true, objectTrees: [] })
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:function-global-state')
  })
})

describe('⭐ F1 — the root sites the wall mislabelled', () => {
  it('`ta.change(pl)` at the root, `pl` a binding held as an expression, is `pl - pl[1]`', () => {
    const [got] = outs('pl = fixnan(ta.pivotlow(low, 2, 2))\nplot(ta.change(pl))\n')
    const [want] = outs('pl = fixnan(ta.pivotlow(low, 2, 2))\nplot(pl - pl[1])\n')
    expect(got).toEqual(want)
    expect(want.some((x) => x !== null)).toBe(true)
  })

  it('the same inside a root block, where no line can commit it, refuses as the expression it is (not a global)', () => {
    const r = refusal('pl = fixnan(ta.pivotlow(low, 2, 2))\nfloat x = na\nif close > open\n    x := ta.change(pl)\nplot(x)\n')
    expect(r.guard).toBe('runtime:history-expression')
  })

  // in a block (no line to hoist on), as market-structure-break-order-block reached it; the block is settled by an
  // input, so it runs on every bar
  const blockSrc = (call) => `show = input.bool(true)\nvar int k = 0\nk := k % 4 + 1\nfloat x = na\nif show\n`
    + `    x := ${call}\nplot(x)\n`

  it('a `skip` window over a bare chart series with a length read per bar is served in place (the root\'s values)', () => {
    const got = outs(blockSrc('ta.sma(close, k)'))
    expect(got[0]).toEqual(BARS.map((_, i) => {
      const k = (i % 4) + 1
      if (i + 1 < k) return null
      const w = BARS.slice(i - k + 1, i + 1).map((b) => b.c)
      return w.reduce((s, c) => s + c, 0) / k
    }))
  })

  it('the one-argument `ta.lowest(n)` with a length read per bar is refused as the length it is, never "a global"', () => {
    // ⛔ a `finite` window handed a source in place with a per-bar length answers `na` above length 1 (measured
    // 2026-11-19), so F1 refuses it by the wall's own name rather than draw it blank
    const r = refusal(blockSrc('ta.lowest(k)'))
    expect(r.guard).toBe('runtime:history-dynamic-offset')
    expect(r.message).toMatch(/over `low`/)
  })
})
