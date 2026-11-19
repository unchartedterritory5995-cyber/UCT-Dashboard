// app/src/components/chart/engine/runtime/__tests__/forInParamTypes.test.js
//
// ─── ⭐⭐ ENGINE NUMBER PENDING (U-LOOP) — A `for … in` OVER AN UNTYPED PARAMETER, AND OVER A
//     DESTRUCTURED FUNCTION RESULT ─────────────────────────────────────────────────────────────────────
//
// The runtime lane walks `for x in a` once it knows `a` is an array (`lowerForIn`). Inside a function
// body an UNTYPED parameter has no type in the shared frame, so `f(a) => for x in a …` refused
// "the type of `a` cannot be told" for every call. The Pine v6 User Manual, *User-defined functions*
// > *Declaring parameter types*: "In each separate call to the function, the parameter automatically
// inherits the same type as its specified argument." So the refusal now names the function's untyped
// parameters and a call site whose arguments are typed compiles its own copy (`typeSpecialisation`,
// the C35 / TC rule), where the walk is typed. And `[a, b] = f(…)` over a function that hands back its
// own slots takes those slots' types. The walk itself is engine 69's live list (IMP-1,
// `vw-forin-collections-2`, `array.remove` among the witnessed mutations), unchanged.
// reference:order-block-detector-luxalgo (licence-held, so not read here) is the shape: its arrays come
// out of a function as a tuple, and its walk is `for element in (bull ? ob_btm : ob_top)` with
// `array.remove` on both inside.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 60
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + ((i * 7) % 11), h: 112 + (i % 5), l: 90 - (i % 3), c: 100 + ((i * 5) % 13), v: 1000 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'

function build(src) {
  return buildRuntimeIr(src, { bars: BARS, inputs: {}, ...runtimeClockOpts(false) })
}
function run(src) {
  const b = build(src)
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  const program = lowerIrProgram(b.ir, { historyFromListing: true })
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return { outs: r.outputs.map((o) => Array.from(o)), diagnostics: b.diagnostics }
}
const same = (a, b) => a.length === b.length && a.every((x, i) => (Number.isNaN(x) && Number.isNaN(b[i])) || x === b[i])

// two arrays filled every 4th bar; `bull` walks one and removes from both, as order-block-detector does
const fill = 'var a = array.new_float(0)\nvar b = array.new_float(0)\nif bar_index % 4 == 0\n'
  + '    array.unshift(a, high)\n    array.unshift(b, low)\n'
  // a target that crosses the stored lows on some bars, so the walk removes on some bars and not on others
  + 'tgt = low - bar_index % 7\n'
const viaFunction = `${head}${fill}`
  + 'strip(x, y, target, bull) =>\n'
  + '    hit = false\n'
  + '    t = bull ? y : x\n'
  + '    for e in t\n'
  + '        idx = array.indexof(t, e)\n'
  + '        if (bull ? target < e : target > e)\n'
  + '            hit := true\n'
  + '            array.remove(x, idx)\n'
  + '            array.remove(y, idx)\n'
  + '    hit\n'
  + 'h = strip(a, b, tgt, true)\n'
  + 'plot(array.size(a))\nplot(h ? 1 : 0)\n'
const inline = `${head}${fill}`
  + 'hit = false\n'
  + 't = true ? b : a\n'
  + 'for e in t\n'
  + '    idx = array.indexof(t, e)\n'
  + '    if (true ? tgt < e : tgt > e)\n'
  + '        hit := true\n'
  + '        array.remove(a, idx)\n'
  + '        array.remove(b, idx)\n'
  + 'plot(array.size(a))\nplot(hit ? 1 : 0)\n'

describe('U-LOOP — a walk over an untyped parameter is typed by the call site\'s argument (User Manual)', () => {
  it('builds, and computes exactly what the same walk written at the top level computes', () => {
    const f = run(viaFunction)
    const i = run(inline)
    expect(same(f.outs[0], i.outs[0]), 'array size').toBe(true)
    expect(same(f.outs[1], i.outs[1]), 'hit').toBe(true)
    // ⛔ non-vacuous: the walk removed something on some bars and not on others
    expect(new Set(f.outs[0]).size).toBeGreaterThanOrEqual(2)
    expect(f.outs[1].some((v) => v === 1) && f.outs[1].some((v) => v === 0)).toBe(true)
    expect(f.diagnostics.specialisedCalls).toBeGreaterThanOrEqual(1)
  })
  it('a plain walk over an untyped array parameter', () => {
    const src = `${head}${fill}total(x) =>\n    s = 0.0\n    for e in x\n        s += e\n    s\nplot(total(a))\n`
    const top = `${head}${fill}s = 0.0\nfor e in a\n    s += e\nplot(s)\n`
    expect(same(run(src).outs[0], run(top).outs[0])).toBe(true)
  })
  it('two call sites with two element types compile two copies, each its own', () => {
    const src = `${head}var fa = array.from(1.5, 2.5)\nvar ia = array.from(1, 2, 3)\n`
      + 'count(x) =>\n    n = 0\n    for e in x\n        n += 1\n    n\nplot(count(fa))\nplot(count(ia))\n'
    const { outs, diagnostics } = run(src)
    expect(outs[0].every((v) => v === 2)).toBe(true)
    expect(outs[1].every((v) => v === 3)).toBe(true)
    expect(diagnostics.specialisedCalls).toBeGreaterThanOrEqual(2)
  })
  it('⛔ an argument whose type cannot be told keeps the refusal, by name', () => {
    const src = `${head}total(x) =>\n    s = 0.0\n    for e in x\n        s += e\n    s\nplot(total(na))\n`
    const b = build(src)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:loop')
    expect(b.refusal.message).toMatch(/cannot be told/)
  })
})

describe('U-LOOP — a destructured function result keeps the types of the slots it hands back', () => {
  const src = `${head}`
    + 'coords(cond) =>\n'
    + '    var top = array.new_float(0)\n'
    + '    var btm = array.new_float(0)\n'
    + '    if cond\n'
    + '        array.unshift(top, high)\n'
    + '        array.unshift(btm, low)\n'
    + '    [top, btm]\n'
    + '[bt, bb] = coords(bar_index % 4 == 0)\n'
  it('`for e in bt` over `[bt, bb] = coords(…)` is walked', () => {
    const { outs } = run(`${src}s = 0.0\nfor e in bt\n    s += e\nplot(s)\nplot(array.size(bb))\n`)
    expect(outs[0].some((v) => v > 0)).toBe(true)
    expect(outs[1][N - 1]).toBe(Math.ceil(N / 4))
  })
  it('and handed to a function that walks it (the order-block-detector shape, end to end)', () => {
    const body = `${src}`
      + 'strip(x, y, target, bull) =>\n'
      + '    hit = false\n'
      + '    t = bull ? y : x\n'
      + '    for e in t\n'
      + '        idx = array.indexof(t, e)\n'
      + '        if (bull ? target < e : target > e)\n'
      + '            hit := true\n'
      + '            array.remove(x, idx)\n'
      + '            array.remove(y, idx)\n'
      + '    hit\n'
      + 'h = strip(bt, bb, low - bar_index % 7, true)\nplot(array.size(bt))\nplot(h ? 1 : 0)\n'
    const { outs } = run(body)
    expect(new Set(outs[0]).size).toBeGreaterThanOrEqual(2)
    // ⛔ the walk removed on some bars and not on others
    expect(outs[1].some((v) => v === 1) && outs[1].some((v) => v === 0)).toBe(true)
    // and it is the same walk written at the top level over the destructured arrays
    const top = run(`${src}tgt = low - bar_index % 7\nhit = false\nt = true ? bb : bt\nfor e in t\n    idx = array.indexof(t, e)\n`
      + '    if tgt < e\n        hit := true\n        array.remove(bt, idx)\n        array.remove(bb, idx)\n'
      + 'plot(array.size(bt))\nplot(hit ? 1 : 0)\n')
    expect(same(outs[0], top.outs[0]) && same(outs[1], top.outs[1])).toBe(true)
  })
})
