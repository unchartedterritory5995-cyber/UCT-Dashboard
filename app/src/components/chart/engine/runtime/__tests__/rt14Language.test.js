// app/src/components/chart/engine/runtime/__tests__/rt14Language.test.js
//
// ─── ⭐⭐ RT14 — core language completeness on the runtime lane ─────────────────
//
// Each block is one wall RT14 took, with the rule it serves and a control that
// fails without it. The rules are Pine's own language (the manual's spelling of a
// type, the value of a block); no number here is a new semantic choice, and the
// numeric ones are checked against the same script written in the spelling the
// lane already served.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 8
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 103 + (i % 3) * 2, l: 97 - (i % 2), c: 100 + ((i * 7) % 5), v: 1000 + i,
}))
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

describe('⭐⭐ RT14 — `T[] name` in a function header is `array<T> name`', () => {
  const body = (param) => [
    `total(${param}) =>`,
    '    float s = 0.0',
    '    for i = 0 to array.size(a) - 1',
    '        s += array.get(a, i)',
    '    s',
    'var float[] xs = array.new_float()',
    'array.push(xs, close)',
    'if array.size(xs) > 3',
    '    array.shift(xs)',
    'plot(total(xs))',
  ].join('\n') + '\n'

  it('`float[] a`, `float []a` and `array<float> a` compute the same column', () => {
    const generic = run(body('array<float> a'))
    expect(run(body('float[] a'))).toEqual(generic)
    expect(run(body('float []a'))).toEqual(generic)
    // and the column is the rolling sum it says it is (not all-na)
    expect(generic[0][N - 1]).toBe(SERIES[3].slice(N - 3).reduce((p, x) => p + x, 0))
  })

  it('a typed qualifier in front (`series float[] a`) reads the same', () => {
    expect(run(body('series float[] a'))).toEqual(run(body('array<float> a')))
  })

  it('CONTROL: a non-empty `[ ]` in a header is still not a parameter list', () => {
    const r = build('f(a[1]) => a\nplot(f(close))\n')
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:function')
  })

  it('CONTROL: `x[1]` in a body is a history read, untouched by the header fold', () => {
    const out = run('f(float[] a) => array.size(a)\nfloat[] q = array.new_float()\narray.push(q, 1)\nplot(close[1] + f(q))\n')
    expect(out[0][0]).toBe(null)
    expect(out[0][2]).toBe(SERIES[3][1] + 1)
  })
})
