// app/src/components/chart/engine/runtime/__tests__/rt10PivotOverState.test.js
//
// ─── ⭐⭐ RT10 — Pine's pivot over RUNTIME STATE, at its confirmation bar ─────────
//
// `ta.pivothigh(x, L, R)` answers on bar t with x[R] when x[R] beats every bar on
// its right (x[R-1] … x[0]) and at least matches every bar on its left (x[R+1] …
// x[R+L]), and `na` otherwise. ⭐ H11 (CAP5, `vw-rt10-runtime-walls-rddt-1d-2026-
// 10-04`, 4 x 636 bars): an `na` in the window is a BARRIER — the comparison walks
// outward from the candidate and stops at the first `na` on each side. That is the
// host lane's `pivotCol` rule (H1, graded against `pivot-point-supertrend` RDDT:
// a LEFT tie pivots, a RIGHT tie does not) read through Pine's `[R]` confirmation
// shift. Graded two ways: against a hand replay of that sentence, and against the
// SAME call over a pure source, which the columnar lane answers — the runtime run
// must equal it bar for bar on a series with plateaus on both sides and a hole.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

// closes with plateaus: a left tie at bars 5/6, a right tie at 13/14, a lone peak at 20
const CLOSES = [10, 11, 12, 11, 10, 15, 15, 12, 11, 10, 9, 12, 13, 16, 16, 12, 11, 10, 12, 14,
  18, 14, 12, 10, 8, 9, 10, 7, 6, 8, 9, 11, 10, 9, 12, 13, 12, 11, 10, 9]
const N = CLOSES.length
const BARS = CLOSES.map((c, i) => ({ t: 1700000000 + i * 86400, o: c, h: c + 1, l: c - 1, c, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

function build(src, head = '//@version=5\nindicator("t")\n') { return buildRuntimeIr(head + src, { bars: BARS, inputs: {} }) }
function run(src, head) {
  const built = build(src, head)
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return { outputs: outputs.map((o) => Array.from(o, (v) => (Number.isFinite(v) ? v : null))), program }
}

// the reference sentence, read at the confirmation bar
const replay = (xs, L, R, high) => xs.map((_, t) => {
  if (t < L + R) return null
  const c = t - R
  const v = xs[c]
  if (v === null) return null
  for (let j = c - 1; j >= c - L; j -= 1) {
    const w = xs[j]
    if (w === null) break
    if (!((high ? v > w : v < w) || v === w)) return null
  }
  for (let j = c + 1; j <= c + R; j += 1) {
    const w = xs[j]
    if (w === null) break
    if (!(high ? v > w : v < w)) return null
  }
  return v
})

const X = 'var float x = na\nx := bar_index == 30 ? na : close * 2\n'
const xs = CLOSES.map((c, i) => (i === 30 ? null : c * 2))

describe('⭐⭐ RT10 — ta.pivothigh / ta.pivotlow over runtime state', () => {
  it('equals the hand replay and the columnar lane on the same values (ties and a hole)', () => {
    const { outputs, program } = run(`${X}y = bar_index == 30 ? na : close * 2\n`
      + 'plot(ta.pivothigh(x, 2, 3))\nplot(ta.pivotlow(x, 2, 2))\nplot(ta.pivothigh(y, 2, 3))\nplot(ta.pivotlow(y, 2, 2))\n')
    // non-vacuity: the runtime calls really are runtime windows, the control is a column
    expect(program.windows.map((w) => w.fn)).toEqual(['pivothighPine', 'pivotlowPine'])
    const hi = replay(xs, 2, 3, true)
    const lo = replay(xs, 2, 2, false)
    expect(hi.filter((v) => v !== null).length).toBeGreaterThan(2)
    expect(lo.filter((v) => v !== null).length).toBeGreaterThan(2)
    expect(hi[6 + 3]).toBe(30) // the LEFT tie (bars 5/6) pivots on its last bar
    expect(hi[13 + 3]).toBe(null) // the RIGHT tie (bars 13/14) does not pivot on its first bar
    // ⭐ H11 — the hole at bar 30 is a BARRIER (CAP5): bar 29 (16) beats 14 / 12 on
    // its left and nothing past the hole is compared, so it pivots HIGH (confirmed on
    // bar 32); bar 28 (12) beats 20 / 14 and 16, and pivots LOW (confirmed on bar 30).
    // Under the old "a hole vetoes" rule both were `na`.
    expect(hi[32]).toBe(16)
    expect(lo[30]).toBe(12)
    expect(outputs[0]).toEqual(hi)
    expect(outputs[1]).toEqual(lo)
    expect(outputs[2]).toEqual(hi)
    expect(outputs[3]).toEqual(lo)
  })

  it('v4 bare `pivothigh(src, L, R)` is Pine\'s, and two call sites of one function keep two windows', () => {
    const v4 = '//@version=4\nstudy("t")\n'
    const { outputs } = run('var float x = na\nx := close * 2\nf(s) => pivotlow(s, 1, 2)\n'
      + 'plot(pivothigh(x, 2, 3))\nplot(f(x))\nplot(f(x + 1))\n', v4)
    const ys = CLOSES.map((c) => c * 2)
    expect(outputs[0]).toEqual(replay(ys, 2, 3, true))
    expect(outputs[1]).toEqual(replay(ys, 1, 2, false))
    expect(outputs[2]).toEqual(replay(ys.map((v) => v + 1), 1, 2, false))
  })

  it('bar counts only known while the bar runs refuse by name', () => {
    const b = build(`${X}n = bar_index % 3 + 1\nplot(ta.pivothigh(x, n, 2))\n`)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:history-dynamic-offset')
  })

  it('control: the script\'s own `pivothigh` wins over the builtin', () => {
    const { outputs } = run('var float x = na\nx := close\npivothigh(s, a, b) => s + a + b\nplot(pivothigh(x, 1, 2))\n',
      '//@version=4\nstudy("t")\n')
    expect(outputs[0]).toEqual(CLOSES.map((c) => c + 3))
  })
})
