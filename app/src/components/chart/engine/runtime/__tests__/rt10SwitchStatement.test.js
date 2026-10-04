// app/src/components/chart/engine/runtime/__tests__/rt10SwitchStatement.test.js
//
// ─── ⭐⭐ RT10 — `switch` as a STATEMENT on the runtime lane ────────────────────
//
// Pine reference (`switch`): with a subject, the first arm whose expression EQUALS
// the subject runs; without one, the first arm whose expression is TRUE runs; the
// bare `=>` arm runs when nothing matched; a switch whose arms all miss and that has
// no default runs nothing. The subject is evaluated once. Graded against a hand
// replay of exactly those rules; the value form (`x = switch …`) is unchanged and
// is the control.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 30
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 103 + (i % 4), l: 97 - (i % 3), c: 100 + (i % 9) - 4, v: 1000 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'

function build(src) { return buildRuntimeIr(head + src, { bars: BARS, inputs: {} }) }
function run(src) {
  const built = build(src)
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return outputs.map((o) => Array.from(o, (v) => (Number.isFinite(v) ? v : null)))
}

describe('⭐⭐ RT10 — a switch statement runs the first matching arm for its effect', () => {
  it('with a subject: `==`, first match wins, default when nothing matched', () => {
    const out = run([
      'var float acc = 0.0',
      'k = bar_index % 4',
      'switch k',
      '    0 => acc := acc + 1',
      '    1 => acc := acc + 10',
      '    1 => acc := acc + 1000',
      '    => acc := acc + 100',
      'plot(acc)',
    ].join('\n') + '\n')
    let acc = 0
    const want = BARS.map((_, i) => { const k = i % 4; acc += k === 0 ? 1 : k === 1 ? 10 : 100; return acc })
    expect(out[0]).toEqual(want)
  })

  it('without a subject: the first TRUE arm runs; no default and no match runs nothing', () => {
    const out = run([
      'var float a = 0.0',
      'var float b = 0.0',
      'switch',
      '    close > 100 =>',
      '        a := a + 1',
      '        b := b + 2',
      '    close > 97 => b := b + 5',
      'plot(a)',
      'plot(b)',
    ].join('\n') + '\n')
    let a = 0; let b = 0
    const wa = []; const wb = []
    for (const r of BARS) {
      if (r.c > 100) { a += 1; b += 2 } else if (r.c > 97) b += 5
      wa.push(a); wb.push(b)
    }
    // non-vacuity: every arm, and the no-match case, is reached
    expect(BARS.some((r) => r.c > 100)).toBe(true)
    expect(BARS.some((r) => !(r.c > 100) && r.c > 97)).toBe(true)
    expect(BARS.some((r) => !(r.c > 97))).toBe(true)
    expect(out[0]).toEqual(wa)
    expect(out[1]).toEqual(wb)
  })

  it('the subject is evaluated ONCE: a stateful subject steps once per bar, not once per arm tested', () => {
    // `ta.barssince` steps its counter each time it is called; tested by three
    // arms it would advance up to three times a bar if re-evaluated per arm
    const out = run([
      'var float hits = 0.0',
      'switch ta.barssince(close > 100)',
      '    0 => hits := hits + 1',
      '    1 => hits := hits + 10',
      '    2 => hits := hits + 100',
      'plot(hits)',
      'plot(ta.barssince(close > 100))',
    ].join('\n') + '\n')
    let hits = 0
    const want = out[1].map((bs) => { if (bs === 0) hits += 1; else if (bs === 1) hits += 10; else if (bs === 2) hits += 100; return hits })
    expect(out[1].some((v) => v === 2)).toBe(true) // non-vacuity: the third arm is reached
    expect(out[0]).toEqual(want)
  })

  it('text subject (an input) compares as text', () => {
    const out = run([
      'mode = input.string("B", "Mode", options=["A", "B"])',
      'var float x = 0.0',
      'switch mode',
      '    "A" => x := 1',
      '    "B" => x := 2',
      'plot(x)',
    ].join('\n') + '\n')
    expect(out[0]).toEqual(BARS.map(() => 2))
  })

  it('control: the value form is unchanged', () => {
    const out = run('k = bar_index % 3\ny = switch k\n    0 => 5\n    1 => 6\n    => 7\nplot(y)\n')
    expect(out[0]).toEqual(BARS.map((_, i) => [5, 6, 7][i % 3]))
  })

  it('an arm after the default refuses by name', () => {
    const b = build('var float x = 0.0\nswitch\n    => x := 1\n    close > open => x := 2\nplot(x)\n')
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:switch')
  })
})
