// app/src/components/chart/engine/runtime/__tests__/rt11ValueBuildTostring.test.js
//
// ─── ⭐⭐ RT11 — `str.tostring` / v4 `tostring` OVER RUNTIME STATE IN A VALUE BUILD ──
//
// RT5 served `str.tostring` only in a build that draws its own objects. A VALUE
// build (the host object program draws) still LOWERS every binding that reads
// runtime state, so order-block-finder's
//     row1 = ' Bullish - High: ' + tostring(latest_bull_high, '#.##')
// — text only a label prints — refused `runtime:call-undeclared-builtin-state`
// for a name this lane serves. It is now lowered in every build, by the SAME
// formatter (`objectRuntime.formatNumber`, the host object lane's; `#.##` graded
// on max-pain's labels, C20) and with the SAME refusals.
//
// ⛔ The fixtures make the text observable through `str.length`, so a rail that
// only asked "does it build?" cannot pass by the text being dropped.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { formatNumber } from '../../objectRuntime.js'

const N = 30
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + (i % 5), h: 110 + (i % 7), l: 90 - (i % 3), c: 100 + (i % 11) + i / 7, v: 10 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

function build(src) {
  return buildRuntimeIr(src, { bars: BARS, inputs: {} })
}
function run(src) {
  const built = build(src)
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const prog = lowerIrProgram(built.ir)
  const r = execute(prog, { bars: N, series: SERIES, columns: prog.columns, confirmed: true })
  return Array.from(r.outputs[0])
}

// a running high only the run holds (a reassigned var), as order-block-finder's
const STATE = 'var float hi = na\nhi := na(hi) or close > hi ? close : hi\n'
const expectLen = (fmt) => {
  let hi = NaN
  return BARS.map((b) => {
    hi = Number.isNaN(hi) || b.c > hi ? b.c : hi
    return ('H: ' + formatNumber(hi, fmt)).length
  })
}

describe('RT11 — tostring over runtime state in a value build', () => {
  it('v4 bare `tostring(x, "#.##")` builds and prints by the host formatter', () => {
    const out = run(`//@version=4\nstudy("t")\n${STATE}s = "H: " + tostring(hi, "#.##")\nplot(str.length(s))\n`)
    expect(out).toEqual(expectLen('#.##'))
  })
  it('v6 `str.tostring(x)` (no format) is the formatter\'s default too', () => {
    const out = run(`//@version=6\nindicator("t")\n${STATE}s = "H: " + str.tostring(hi)\nplot(str.length(s))\n`)
    expect(out).toEqual(expectLen(undefined))
    // non-vacuity: the default and `#.##` print different lengths on this series
    expect(expectLen(undefined)).not.toEqual(expectLen('#.##'))
  })
  it('⛔ the RT5 refusals stand: a condition, and a format that is not a plain #/0 pattern', () => {
    const cond = build(`//@version=6\nindicator("t")\n${STATE}s = str.tostring(hi > 100)\nplot(str.length(s))\n`)
    expect(cond.ok).toBe(false)
    expect(cond.refusal.guard).toBe('runtime:call-text-state')
    const mint = build(`//@version=6\nindicator("t")\n${STATE}s = str.tostring(hi, format.mintick)\nplot(str.length(s))\n`)
    expect(mint.ok).toBe(false)
    expect(mint.refusal.guard).toBe('runtime:call-text-state')
  })
})
