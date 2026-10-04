// app/src/components/chart/engine/runtime/__tests__/rt10ForIn.test.js
//
// ─── ⭐⭐ RT10 — `for … in` over an array on the runtime lane ───────────────────
//
// Graded against the vendor's own answers for the same walk shapes, read off
// `vw-forin-collections-rddt-1d-2026-10-01` (probe `vw-forin-collections.pine`, C48):
//   F01  5 passes over 5 elements, `[i, x]` hands the position (0 first)
//   F02  0 passes over an empty list
//   F03  3 passes when the body shifts the list it walks (the LIVE length)
//   F04  13 passes when the body pushes ten more onto a three-element list
//   F05  a slot replaced before the walk reaches it is handed to that pass
// The probe walks lines; these rows walk numbers with the SAME control flow, since
// the rule under test is the walk, not the drawing.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 6
const BARS = Array.from({ length: N }, (_, i) => ({ t: 1700000000 + i * 86400, o: 100, h: 101, l: 99, c: 100 + i, v: 1000 }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'
const build = (src) => buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
function run(src) {
  const built = build(src)
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return outputs.map((o) => Array.from(o, (v) => (Number.isFinite(v) ? v : null)))
}
const last = (col) => col[col.length - 1]

describe('⭐⭐ RT10 — for … in walks the LIVE array (C48 vendor answers)', () => {
  it('F01: five passes, the position handed in order, the element read per pass', () => {
    const out = run([
      'float[] a = array.new_float()',
      'for k = 0 to 4',
      '    array.push(a, 10 + k)',
      'float passes = 0',
      'float wsum = 0',
      'for [i, x] in a',
      '    passes += 1',
      '    wsum += i * x',
      'plot(passes)',
      'plot(wsum)',
    ].join('\n') + '\n')
    expect(last(out[0])).toBe(5)
    expect(last(out[1])).toBe(0 * 10 + 1 * 11 + 2 * 12 + 3 * 13 + 4 * 14)
  })

  it('F02: an empty list walks zero times', () => {
    const out = run('float[] a = array.new_float()\nfloat p = 0\nfor x in a\n    p += 1\nplot(p)\n')
    expect(last(out[0])).toBe(0)
  })

  it('F03: the body shifts the list it walks — 3 passes', () => {
    const out = run([
      'float[] a = array.new_float()',
      'for k = 0 to 4',
      '    array.push(a, 20 + k)',
      'float p = 0',
      'for x in a',
      '    if array.size(a) > 0',
      '        array.shift(a)',
      '    p += 1',
      'plot(p)',
      'plot(array.size(a))',
    ].join('\n') + '\n')
    expect(last(out[0])).toBe(3)
    expect(last(out[1])).toBe(2)
  })

  it('F04: the body pushes ten more — 13 passes', () => {
    const out = run([
      'float[] a = array.new_float()',
      'for k = 0 to 2',
      '    array.push(a, 30 + k)',
      'float p = 0',
      'for x in a',
      '    if p < 10',
      '        array.push(a, 40 + p)',
      '    p += 1',
      'plot(p)',
    ].join('\n') + '\n')
    expect(last(out[0])).toBe(13)
  })

  it('F05: a later slot replaced before the walk reaches it is what that pass reads', () => {
    const out = run([
      'float[] a = array.new_float()',
      'for k = 0 to 2',
      '    array.push(a, 50 + k)',
      'float seen = na',
      'for [i, x] in a',
      '    if i == 0',
      '        array.set(a, 2, 59)',
      '    if i == 2',
      '        seen := x',
      'plot(seen)',
    ].join('\n') + '\n')
    expect(last(out[0])).toBe(59)
  })

  it('break and continue keep their meaning inside the walk', () => {
    const out = run([
      'float[] a = array.from(1.0, 2.0, 3.0, 4.0, 5.0)',
      'float s = 0',
      'for x in a',
      '    if x == 2',
      '        continue',
      '    if x == 4',
      '        break',
      '    s += x',
      'plot(s)',
    ].join('\n') + '\n')
    expect(last(out[0])).toBe(1 + 3)
  })

  it('refuses by name: a list made by a call, and a map', () => {
    const a = build('float s = 0\nfor x in array.from(1.0, 2.0)\n    s += x\nplot(s)\n')
    expect(a.ok).toBe(false)
    expect(a.refusal.guard).toBe('runtime:loop')
    const b = build('m = map.new<string, float>()\nfloat s = 0\nfor [k, v] in m\n    s += v\nplot(s)\n')
    expect(b.ok).toBe(false)
  })
})
