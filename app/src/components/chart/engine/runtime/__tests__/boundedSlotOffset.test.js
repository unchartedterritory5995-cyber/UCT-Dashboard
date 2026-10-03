// app/src/components/chart/engine/runtime/__tests__/boundedSlotOffset.test.js
//
// ─── ⭐⭐ RT3 — `x[i]` OVER A VARIABLE'S RING, UNDER A BOUND PROVED BEFORE BAR 0 ─
//
// `READ_HIST_SLOT_DYN` was reserved in 2F-2 with its condition written beside
// it: a variable's past lives in a ring whose depth is fixed before bar 0, so an
// offset only known while the bar runs could not be admitted until the depth it
// may reach is STATICALLY BOUNDED — otherwise it answers `na` where Pine answers
// a number. RT3 proves that bound (`pineRuntimeFrontend.js::offsetRange`): a
// `for` counter whose bounds fold, constant arithmetic over it. The ring is sized
// to the bound; anything this cannot bound keeps its refusal by name.
//
// Every number below is graded against a spelling of the SAME Pine program the
// lane already computed correctly (constant offsets, a closed-table builtin) —
// argued exactly from Pine semantics, since no vendor capture covers these
// scripts (`docs/pine/vendor-harness/objects-triage-2026-09-28.md`, RT3).

import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { makeIrProgram, SLOT, histSlotDyn, read, num, assign, emit as irEmit } from '../ir.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 12
// closes that never repeat a difference, so a wrong bar is a wrong number
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100, h: 110 + i, l: 90, c: 100 + i * i * 0.5 + (i % 3), v: 1000 + 37 * i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'

function run(src, inputs = {}) {
  const built = buildRuntimeIr(src, { bars: BARS, inputs })
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return r.outputs.map((o) => Array.from(o))
}
const refusalOf = (src) => {
  const b = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}
const same = (a, b) => a.length === b.length && a.every((v, i) => (Number.isNaN(v) ? Number.isNaN(b[i]) : Math.abs(v - b[i]) <= 1e-9 * Math.max(1, Math.abs(b[i]))))

describe('⭐⭐ admitted: a counter whose bounds fold', () => {
  it('a descending loop and an offset expression `n - 1 - j` equal the constant spelling', () => {
    const x = 'var float x = 0.0\nx := close * 2 - open\n'
    const [dyn] = run(`${head}${x}n = 4\ns = 0.0\nfor j = n - 1 to 0\n    s := s + x[n - 1 - j] * (j + 1)\nplot(s)\n`)
    const [ref] = run(`${head}${x}plot(x[0] * 4 + x[1] * 3 + x[2] * 2 + x[3] * 1)\n`)
    expect(same(dyn, ref)).toBe(true)
    expect(dyn.filter((v) => !Number.isNaN(v)).length).toBe(N - 3) // non-vacuity: warm-up, then numbers
  })

  it('inside a FUNCTION over a series PARAMETER, a loop sized by an `int` parameter, per call site', () => {
    // `pine_wma` (volume-divergence-by-mm's helper): Pine's own weighted average.
    const fn = 'pine_wma(x, y) =>\n    norm = 0.0\n    sum = 0.0\n    for i = 0 to y - 1\n'
      + '        weight = (y - i) * y\n        norm := norm + weight\n        sum := sum + x[i] * weight\n    sum / norm\n'
    const v = 'var float v = 0.0\nv := close - open\n'
    const [a, b] = run(`${head}${fn}${v}plot(pine_wma(v, 3))\nplot(pine_wma(v, 5))\n`)
    // the closed-table builtin over the same series is the reference
    const [ra, rb] = run(`${head}${v}plot(ta.wma(v, 3))\nplot(ta.wma(v, 5))\n`)
    expect(same(a, ra)).toBe(true)
    expect(same(b, rb)).toBe(true)
    expect(same(a, b)).toBe(false) // non-vacuity: two call sites, two rings, two answers
  })

  it('`na` offset reads the current bar (C29\'s measured rule); before bar 0 is `na`, never a clamp', () => {
    const [out] = run(`${head}var float x = 0.0\nx := close\ns = 0.0\nfor i = 3 to 3\n    s := x[i]\nplot(s)\n`)
    for (let b = 0; b < N; b += 1) {
      if (b < 3) expect(Number.isNaN(out[b]), `bar ${b}`).toBe(true)
      else expect(out[b]).toBe(BARS[b - 3].c)
    }
  })
})

describe('⛔ still refused, by name: what cannot be bounded', () => {
  const x = 'var float x = 0.0\nx := close\n'
  it.each([
    ['a counter the body assigns', `${x}s = 0.0\nfor i = 0 to 3\n    s := s + x[i]\n    i := i + 1\nplot(s)\n`],
    ['a compound assignment to the counter', `${x}s = 0.0\nfor i = 0 to 3\n    s := s + x[i]\n    i += 1\nplot(s)\n`],
    ['a bound only known while the bar runs', `${x}s = 0.0\nfor i = 0 to bar_index\n    s := s + x[i]\nplot(s)\n`],
    ['an offset that can go negative', `${x}s = 0.0\nfor i = 0 to 3\n    s := s + x[i - 1]\nplot(s)\n`],
    ['a `%` (not bounded by this proof)', `${x}s = 0.0\nfor i = 0 to 3\n    s := s + x[i % 2]\nplot(s)\n`],
    ['deeper than Pine\'s own 5000-bar ceiling', `${x}s = 0.0\nfor i = 0 to 6000\n    s := s + x[i]\nplot(s)\n`],
  ])('%s', (_, body) => {
    expect(refusalOf(`${head}${body}`).guard).toBe('runtime:history-dynamic-offset')
  })

  it('control: the same loops with the hole removed compile', () => {
    expect(() => run(`${head}${x}s = 0.0\nfor i = 0 to 3\n    s := s + x[i]\nplot(s)\n`)).not.toThrow()
    expect(() => run(`${head}${x}s = 0.0\nfor i = 1 to 3\n    s := s + x[i - 1]\nplot(s)\n`)).not.toThrow()
  })
})

describe('⛔⛔ the VM refuses an offset deeper than its ring — the bound\'s last line of defence', () => {
  it('a program whose offset outruns its proved depth stops by name, never answers', () => {
    // Built by hand: the IR claims depth 2 and the offset is 3. Before bar 3 the
    // read is before bar 0 (`na`); from bar 3 it would read a WRAPPED cell — a
    // different bar's value — so the VM must throw rather than answer.
    const p = makeIrProgram({
      slots: [{ name: 'x', kind: SLOT.LOCAL }],
      columns: [],
      statements: [assign(0, num(7)), irEmit(0, histSlotDyn(0, 0, num(3), 2))],
      outputs: [{ call: 'plot' }],
      history: [{ name: 'x', varSlot: 0, depth: 2 }],
    })
    const program = lowerIrProgram(p)
    expect(() => execute(program, { bars: 2, series: SERIES, columns: [], confirmed: true })).not.toThrow()
    expect(() => execute(program, { bars: N, series: SERIES, columns: [], confirmed: true }))
      .toThrow(/reaches past its ring of depth 2/)
  })

  it('and an input set ABOVE the default the bound was proved at fails loudly, never wrong', () => {
    // The bound folds the AUTHOR'S default (the frozen resolver, as every ring
    // size does); a member value larger than it would reach past the ring.
    const src = `${head}len = input.int(3, "len")\nvar float x = 0.0\nx := close\ns = 0.0\n`
      + 'for i = 0 to len - 1\n    s := s + x[i]\nplot(s)\n'
    expect(() => run(src)).not.toThrow()
    const built = buildRuntimeIr(src, { bars: BARS, inputs: { len: 6 } })
    expect(built.ok).toBe(true)
    const program = lowerIrProgram(built.ir)
    expect(() => execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true }))
      .toThrow(/reaches past its ring/)
  })
})
