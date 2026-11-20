// app/src/components/chart/engine/runtime/__tests__/a6ArmDrawFixedParam.test.js
//
// ─── ⭐⭐ A6 — A DRAWING MADE IN ONE ARM OF A `?:` IN A FUNCTION BODY, ON A TEST ITS CALL SITE FIXES ─────────────
//
// fibonacci-retracement-mtflog (v6): `f_ret(s, k, c) => var line ln = na, line.delete(ln) … ln := s ? line.new(…) : na`,
// called eight times with `s_0236 = input.bool(true, …)` and the like. The shared frame cannot choose the arm (`s` is a
// slot there) and a drawing in an arm is refused (Pine makes it only on the bars the arm is taken). At a call that
// passes a value fixed before bar 0 the arm is taken on EVERY call or on NONE, exactly as for a test on the input
// itself (C47, which already serves `tr ? line.new(…) : na` on the global `tr`): the copy compiled for that call site
// (C35, `frameConsts`) lowers only the arm the value takes. A per-bar test keeps the refusal, now naming the parameter
// (what TradingView draws from an arm on a per-bar test is not captured: Q-A6-1).
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { BARS } from '../__fixtures__/rsRatingSynthetic.js'

const v6 = (body) => `//@version=6\nindicator("t", overlay = true)\n${body}`
const opts = () => ({ bars: BARS, inputs: {}, objectsInRun: true, tf: 'D', basePeriod: 'D', ...runtimeClockOpts(false, { tf: 'D' }) })
function runDrawing(src) {
  const built = buildRuntimeIr(src, opts())
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
  const res = execute(program, { bars: BARS.length, series, columns: program.columns, confirmed: true, barTimes: BARS.map((b) => b.t) })
  return { fin: res.objects.finish(), built }
}
const refusal = (src) => { const b = buildRuntimeIr(src, opts()); return b.ok ? null : b.refusal }
const lines = (fin) => fin.live.filter((o) => o.family === 'line')
const labels = (fin) => fin.live.filter((o) => o.family === 'label')

// the mtflog shape: each call keeps its own `var` handle, deletes it, and re-makes it in an arm of `?:`
const F = 'f(s, y) =>\n    var line ln = na, line.delete(ln)\n    var label lb = na, label.delete(lb)\n'
  + '    ln := s ? line.new(bar_index - 1, y, bar_index, y) : na\n'
  + '    lb := s ? label.new(bar_index, y, "x") : na\n    y\n'

describe('A6 — a drawing in one arm of `?:` whose test the call site fixes', () => {
  it('calls passing an input at true draw their line and label; a call passing false draws none (the mtflog shape)', () => {
    const src = v6(`a = input.bool(true, "a")\nb = input.bool(true, "b")\nc = input.bool(false, "c")\n${F}`
      + 'p1 = f(a, high)\np2 = f(b, low)\np3 = f(c, close)\nplot(p1)\nplot(p2)\nplot(p3)\n')
    const { fin, built } = runDrawing(src)
    expect(built.diagnostics.specialisedCalls).toBeGreaterThanOrEqual(2)
    // each drawing call site keeps one live handle (the previous bar's is deleted): two lines, two labels at the end
    expect(lines(fin)).toHaveLength(2)
    expect(labels(fin)).toHaveLength(2)
    const last = BARS.length - 1
    const ys = lines(fin).map((l) => l.props.y1).sort((x, y) => x - y)
    expect(ys).toEqual([BARS[last].l, BARS[last].h].sort((x, y) => x - y))
  })
  it('a literal argument is fixed too, and the arm it does not take is not lowered at all', () => {
    const { fin } = runDrawing(v6(`${F}plot(f(false, close))\nplot(f(true, open))\n`))
    expect(lines(fin)).toHaveLength(1)
    expect(lines(fin)[0].props.y1).toBe(BARS[BARS.length - 1].o)
  })
  it('a caller\'s own parameter is fixed by ITS call site (the C35 chain)', () => {
    const { fin } = runDrawing(v6(`${F}g(on, y) => f(on, y)\nplot(g(true, high))\n`))
    expect(lines(fin)).toHaveLength(1)
  })
  it('⛔ a per-bar argument keeps the refusal, now naming the parameter', () => {
    const r = refusal(v6(`${F}plot(f(close > open, close))\n`))
    expect(r && r.guard).toBe('runtime:object-op')
    expect(r.message).toMatch(/`s` decides whether a drawing in one arm of `\?:` in `f` is made/)
  })
  it('⛔ a branch on a body LOCAL (no call site can fix it) keeps the original refusal', () => {
    const r = refusal(v6('h(y) =>\n    var line ln = na, line.delete(ln)\n    k = y > 0\n'
      + '    ln := k ? line.new(bar_index - 1, y, bar_index, y) : na\n    y\nplot(h(close))\n'))
    expect(r && r.guard).toBe('runtime:object-op')
    expect(r.message).toMatch(/a drawing call inside one arm of `\?:`/)
  })
})
