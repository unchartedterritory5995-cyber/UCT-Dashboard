// app/src/components/chart/engine/runtime/__tests__/p3WsaForBoundAndStatements.test.js
//
// ─── ⭐⭐ PHASE 3, WORKSTREAM A — THE v6 `for` BOUND, `runtime.error`, SENTENCES ──
//
// docs/pine/PHASE3-RUNTIME-PLAN.md 3.5 / 3.6 item 3 / section 5 row A.
//
//   F1  Pine 6 re-reads a `for` loop's `to` bound before every pass; this lane
//       reads it once. The two agree when no pass can move the bound, so that
//       is served; a v6 body that CAN move it is refused by name (standing
//       ruling 2: no capture pins the per-pass rule yet,
//       docs/pine/capture-queue-2026-10-31-wsa-for-bound.md). Up to v5 the
//       bound is read once, as here, and the same script is served.
//   F2  `runtime.error(…)` as a statement: lowered, silent where not reached,
//       the run's own stop where reached.
//   F3  refusal sentences no longer claim a capability is missing that exists.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr, RUNTIME_REFUSALS } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 8
// close runs 100..107
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100, h: 102 + i, l: 98, c: 100 + i, v: 1000,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const v5 = '//@version=5\nindicator("t")\n'
const v6 = '//@version=6\nindicator("t")\n'

const build = (src) => buildRuntimeIr(src, { bars: BARS, inputs: {}, p3Statements: true })
function runOrThrow(src) {
  const built = build(src)
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  return execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t),
  })
}
const run = (src) => Array.from(runOrThrow(src).outputs[0])
const refusalOf = (src) => {
  const b = build(src)
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}

// The body writes the bound's own name on pass 1. Read once: 4 passes.
// Re-read per pass (v6): 6 passes. The fixture distinguishes the two rules.
const MOVING = 'n = 3\ns = 0.0\nfor i = 0 to n\n    s += 1\n    if i == 1\n        n := 5\nplot(s)\n'

describe('F1 — a Pine 6 `for` whose body can move its `to` bound', () => {
  it('⛔ CONTROL — up to v5 the bound is read once: the same script runs 4 passes', () => {
    expect(run(v5 + MOVING)).toEqual(Array(N).fill(4))
  })

  it('⛔⛔ v6: the body writes the bound\'s name — refused by name, never 4 passes', () => {
    const r = refusalOf(v6 + MOVING)
    expect(r.guard).toBe('runtime:loop')
    expect(r.message).toMatch(/Pine 6 re-reads/)
    expect(r.message).toMatch(/writes `n`/)
    expect(r.line).toBe(5)
  })

  it('⭐ v6: a bound no pass can move is served, and agrees with the read-once count', () => {
    expect(run(`${v6}n = 3\ns = 0.0\nfor i = 0 to n\n    s += 1\nplot(s)\n`)).toEqual(Array(N).fill(4))
  })

  it('⭐ v6: a body that declares its own names (not the bound\'s) is served', () => {
    expect(run(`${v6}n = 3\ns = 0.0\nfor i = 0 to n\n    m = 0\n    m := i\n    s += m\nplot(s)\n`))
      .toEqual(Array(N).fill(6))
  })

  it('⭐ v6: a bound reading a committed past value (`n[1]`) is served — no pass moves history', () => {
    const out = run(`${v6}var n = 2\ns = 0.0\nfor i = 0 to n[1]\n    s += 1\n    n := 2\nplot(s)\n`)
    expect(out.slice(1)).toEqual(Array(N - 1).fill(3))
  })

  it('⭐ v6: `array.size(a)` bound with a read-only body (`array.get`) is served', () => {
    const src = `${v6}var a = array.new_float(0)\nif bar_index == 0\n    array.push(a, 1)\n    array.push(a, 2)\n`
      + 's = 0.0\nfor i = 0 to array.size(a) - 1\n    s += array.get(a, i)\nplot(s)\n'
    expect(run(src)).toEqual(Array(N).fill(3))
  })

  it('⛔⛔ v6: `array.size(a)` bound with a body that pushes — refused by name', () => {
    const src = `${v6}var a = array.new_float(0)\nif bar_index == 0\n    array.push(a, 1)\n`
      + 's = 0.0\nfor i = 0 to array.size(a) - 1\n    s += array.get(a, i)\n    if array.size(a) < 3\n        a.push(1)\nplot(s)\n'
    const r = refusalOf(src)
    expect(r.guard).toBe('runtime:loop')
    expect(r.message).toMatch(/changes an array \(`array\.push`\)/)
  })

  it('⭐ v6: a size-only bound with a body that SETS elements (the length never moves) — served', () => {
    const src = `${v6}f(array<float> w) =>\n    for i = 0 to array.size(w) - 1\n        array.set(w, i, array.get(w, i) * 2)\n    array.sum(w)\n`
      + 'plot(f(array.from(1.0, 2.0, 3.0)))\n'
    expect(run(src)).toEqual(Array(N).fill(12))
  })

  it('⛔⛔ v6: an element bound (`array.get(a, 0)`) with a body that sets that element — refused', () => {
    const src = `${v6}a = array.from(3.0)\nfloat s = 0.0\nfor i = 0 to array.get(a, 0)\n    s += 1\n    array.set(a, 0, 5.0)\nplot(s)\n`
    const r = refusalOf(src)
    expect(r.guard).toBe('runtime:loop')
    expect(r.message).toMatch(/changes an array \(`array\.set`\)/)
  })

  it('⛔ CONTROL — v5: a body that grows the array its bound reads walks the entry size once', () => {
    const src = `${v5}a = array.from(1.0, 2.0)\nfloat s = 0.0\nfor i = 0 to array.size(a) - 1\n`
      + '    s := s + array.get(a, i)\n    array.push(a, 9.0)\nplot(s)\n'
    expect(run(src)).toEqual(Array(N).fill(3))
  })

  it('⭐⭐ v6: the split-and-walk idiom — bound reads `toks`, body pushes to a DIFFERENT fresh `out` — is served', () => {
    const src = `${v6}toks = str.split("A,B,,C", ",")\nout = array.new_string(0)\n`
      + 'for i = 0 to array.size(toks) - 1\n    t = array.get(toks, i)\n    if str.length(t) > 0\n        array.push(out, t)\n'
      + 'plot(array.size(out))\n'
    expect(run(src)).toEqual(Array(N).fill(3))
  })

  it('⭐ v6: the bound reads a PRIVATE array; the body pushes to one a function returned — served', () => {
    const src = `${v6}mk() =>\n    r = array.new_float(0)\n    r\nfloat s = 0.0\nsrc = array.from(1.0, 2.0, 3.0)\nout = mk()\n`
      + 'for i = 0 to array.size(src) - 1\n    s += array.get(src, i)\n    array.push(out, 1.0)\nplot(s)\n'
    expect(run(src)).toEqual(Array(N).fill(6))
  })

  it('⛔⛔ v6: a `slice` shares its source\'s storage — the source is never told apart: refused', () => {
    const src = `${v6}a = array.from(1.0, 2.0)\nv = a.slice(0, 1)\nfloat s = 0.0\nfor i = 0 to array.size(a) - 1\n`
      + '    s += 1\n    if array.size(a) < 4\n        array.push(v, 9.0)\nplot(s)\n'
    const r = refusalOf(src)
    expect(r.guard).toBe('runtime:loop')
  })

  it('⛔⛔ v6: `b = a` makes two names ONE array — pushing through `b` moves `array.size(a)`: refused', () => {
    const src = `${v6}a = array.from(1.0, 2.0)\nb = a\nfloat s = 0.0\nfor i = 0 to array.size(a) - 1\n`
      + '    s += 1\n    if array.size(b) < 4\n        array.push(b, 9.0)\nplot(s)\n'
    const r = refusalOf(src)
    expect(r.guard).toBe('runtime:loop')
    expect(r.message).toMatch(/changes an array/)
  })

  it('⛔⛔ v6: two names unpacked from one tuple may hold ONE array — refused', () => {
    const src = `${v6}f() =>\n    x = array.from(1.0, 2.0)\n    [x, x]\n[a, b] = f()\ns = 0.0\n`
      + 'for i = 0 to array.size(a) - 1\n    s += 1\n    if array.size(b) < 4\n        array.push(b, 9.0)\nplot(s)\n'
    const r = refusalOf(src)
    expect(r.guard).toBe('runtime:loop')
    expect(r.message).toMatch(/changes an array/)
  })

  it('⛔⛔ v6: an array reached through a function parameter is never told apart — refused', () => {
    const src = `${v6}f(arr, src) =>\n    out = array.new_float(0)\n    for i = 0 to array.size(src) - 1\n`
      + '        array.push(arr, 1.0)\n    array.size(arr)\nx = array.from(1.0)\nplot(f(x, x))\n'
    const r = refusalOf(src)
    expect(r.guard).toMatch(/runtime:loop|runtime:function/)
    expect(r.message).toMatch(/Pine 6 re-reads/)
  })

  it('⛔⛔ v6: a function called in the body that pushes to the bound\'s array — refused by name', () => {
    const src = `${v6}grow(x) =>\n    array.push(x, 9.0)\n    0\na = array.from(1.0, 2.0)\nfloat s = 0.0\n`
      + 'for i = 0 to array.size(a) - 1\n    s += 1\n    if array.size(a) < 4\n        grow(a)\nplot(s)\n'
    const r = refusalOf(src)
    expect(r.guard).toBe('runtime:loop')
    expect(r.message).toMatch(/calls a function/)
  })

  it('⭐ v6: a function called in the body that only computes — served (the dual-view shape)', () => {
    const src = `${v6}twice(v) =>\n    v * 2\na = array.from(1.0, 2.0)\nfloat s = 0.0\n`
      + 'for i = 0 to array.size(a) - 1\n    s += twice(array.get(a, i))\nplot(s)\n'
    expect(run(src)).toEqual(Array(N).fill(6))
  })

  it('⛔⛔ v6: a field bound with a body that writes a field — refused by name', () => {
    const src = `${v6}type Box\n    float n = 3\nvar b = Box.new()\ns = 0.0\nfor i = 0 to b.n\n    s += 1\n    b.n := 1\nplot(s)\n`
    const r = refusalOf(src)
    expect(r.guard).toBe('runtime:loop')
    expect(r.message).toMatch(/writes a field/)
  })

  it('⛔ CONTROL — the same field loop in v5 is served (bound read once)', () => {
    const src = `${v5}type Box\n    float n = 3\nvar b = Box.new()\ns = 0.0\nfor i = 0 to b.n\n    s += 1\n    b.n := 3\nplot(s)\n`
    expect(run(src)).toEqual(Array(N).fill(4))
  })
})

describe('F2 — `runtime.error(…)` as a statement', () => {
  it('⭐ not reached: lowered as a statement, the plot is untouched', () => {
    expect(run(`${v5}msg = "bad"\nif close < 0\n    runtime.error(msg)\nplot(close)\n`))
      .toEqual(BARS.map((b) => b.c))
  })

  it('⭐ reached: the run stops with the script\'s own error, by its own guard', () => {
    let err = null
    try { runOrThrow(`${v5}if close > 103\n    runtime.error("stop")\nplot(close)\n`) } catch (e) { err = e }
    expect(err).not.toBe(null)
    expect(err.guard).toBe('runtime:runtime.error')
    expect(String(err.message)).toMatch(/stop/)
  })
})

describe('F4 — a `switch` default is the LAST arm', () => {
  it('⛔ CONTROL — the default last is served, and is taken where no case matches', () => {
    expect(run(`${v5}x = switch\n    close > 103 => 1\n    => 2\nplot(x)\n`)).toEqual([2, 2, 2, 2, 1, 1, 1, 1])
  })
  it('⛔⛔ an arm after the default is refused by name, never re-ordered', () => {
    const r = refusalOf(`${v5}x = switch\n    => 2\n    close > 103 => 1\nplot(x)\n`)
    expect(r.guard).toBe('runtime:switch')
    expect(r.message).toMatch(/an arm after the default/)
    expect(r.line).toBe(5)
  })
  it('⛔⛔ the same in statement position, and a second default', () => {
    expect(refusalOf(`${v5}var y = 0\nswitch\n    => y := 2\n    close > 103 => y := 1\nplot(y)\n`).guard).toBe('runtime:switch')
    expect(refusalOf(`${v5}x = switch\n    close > 103 => 1\n    => 2\n    => 3\nplot(x)\n`).guard).toBe('runtime:switch')
  })
})

describe('F3 — the refusal vocabulary claims no missing capability that exists', () => {
  it('⭐ `runtime:loop` names no single form in its stock sentence (the detail does)', () => {
    expect(RUNTIME_REFUSALS['runtime:loop']).not.toMatch(/for … in/)
  })
  it('⭐ the history guards no longer say per-slot / per-call-site rings are missing', () => {
    expect(RUNTIME_REFUSALS['runtime:history-variable']).not.toMatch(/needs per-slot history/)
    expect(RUNTIME_REFUSALS['runtime:history-function-local']).not.toMatch(/not yet vendor-pinned/)
  })
  it('⭐ `runtime:udt-method` no longer says a method is not bound', () => {
    expect(RUNTIME_REFUSALS['runtime:udt-method']).not.toMatch(/does not yet bind/)
  })
})
