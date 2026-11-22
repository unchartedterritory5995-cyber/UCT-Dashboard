// app/src/components/chart/builder/memberPane/wseReviewFixes2.test.js
//
// ─── ⭐⭐ PHASE 3 WS-E — THE RE-REVIEW'S FOLLOW-UPS ON 539c92b62d, AS RAILS ─────
//
//   M-A / M-B / M-C  SETTLED by CBC-FMT: the window's `bar_index` base is witnessed (0),
//        so the probe these railed is gone and the shapes it refused are drawn (below).
//   low  `fill(p1, p2, na, …)` is a hidden fill, not a gradient.
import { describe, it, expect, vi, afterEach } from 'vitest'

import { memberPaneDefinition } from './memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'
import { computeRuntimeColumns } from '../../engine/runtime/runtimeColumns'
import { runtimeObjectsOf } from '../../engine/runtime/runtimeObjects'

import { buildRuntimeIr } from '../../engine/ast/pineRuntimeFrontend'

const ID = 'u_wse-review2'
const N = 260
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 9) + i * 0.1
  return { t: 1700000000 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + (i % 7) }
})
const CTX = { tf: 'D', newestBarIsForming: false }
const flags = () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
}
const door = (source) => memberPaneDefinition({ source, id: ID, name: 'T' })
const CB = '//@version=6\nindicator("t", overlay = true, calc_bars_count = 100)\n'
const ACC = 'var float acc = 0.0\nacc += close\nplot(acc, "acc")\n'
function install(d) {
  const { installed, errors } = registry.installUserDefinitions([d.definition])
  expect(errors).toEqual([])
  return installed[0]
}
function run(d, bars = BARS, ctx = CTX, opts = {}) {
  try { return { cols: computeRuntimeColumns(install(d), bars, ctx, opts) } } catch (err) { return { err } }
}

afterEach(() => { registry.uninstallUserDefinition(ID); vi.unstubAllEnvs() })

// ⭐⭐ CBC-FMT — THE PROBE THESE RAILS HELD IS GONE, BECAUSE ITS QUESTION IS ANSWERED. Re-review
// M-A / M-B / M-C railed a second run with `bar_index` moved 1,000,003 bars on, which refused
// any windowed run whose answer moved with the window's `bar_index` base. That base is now
// WITNESSED (0: `vw-cs1-calc-bars-rddt-1d-2026-11-14` A00, chart bars 566..665 read 0..99), so
// every shape below is computed off it and drawn, in ONE run (no second run, no probe budget,
// no probe verdict cache). What a window still does not witness keeps a refusal by name.
describe('CBC-FMT — the shapes the bar_index probe refused are drawn off the witnessed base', () => {
  for (const tail of [
    'plot(bar_index > 5000 ? 1 : 0, "t1")\n',
    'plot(bar_index < 5000 ? close : na, "t2")\n',
    'plot(math.max(bar_index, 5000), "t3")\n',
    'f(x) =>\n    r = x\n    if bar_index > 2000\n        r := x * 2\n    r\nplot(f(close), "t4")\n',
    'b = bar_index\nvar float k = 0.0\nif b > 5000\n    k := 1\nplot(k, "t5")\n',
    's = 0.0\nfor i = 0 to math.min(bar_index, 3000)\n    s += 0\nplot(s, "s")\n',
    'if bar_index > 5000\n    runtime.error("boom")\n',
    'a = array.new_float(bar_index + 1)\nplot(array.size(a), "n")\n',
  ]) {
    it(`⭐ drawn: ${tail.split('\n').slice(-2)[0]}`, () => {
      flags()
      const d = door(`${CB}${ACC}${tail}`)
      expect(d.ok, d.reason || (d.runtimeDeclined && d.runtimeDeclined.why)).toBe(true)
      const r = run(d)
      expect(r.err, r.err && r.err.message).toBeUndefined()
    })
  }

  it('⭐ `bar_index > 5000` reads FALSE on every window bar (base 0, 100 bars)', () => {
    flags()
    const d = door(`${CB}${ACC}plot(bar_index > 50 ? 1 : 0, "t")\n`)
    const t = run(d).cols[d.definition.plots.find((p) => p.label === 't').key]
    expect(t[N - 100]).toBe(0)
    expect(t[N - 100 + 51]).toBe(1)
  })

  it('⭐ an ABSOLUTE bar-index coordinate (`label.new(10, …)`) lands on the window\'s bar 10', () => {
    flags()
    const d = door(`${CB}${ACC}if barstate.islast\n    label.new(10, close, "abs")\n`)
    const r = run(d)
    expect(r.err, r.err && r.err.message).toBeUndefined()
    expect(runtimeObjectsOf(r.cols).live.map((o) => o.props.x)).toEqual([N - 100 + 10])
  })

  it('⭐ a comparison with `last_bar_index` in a window reads the window\'s own (S10: last_bar_index = 99)', () => {
    flags()
    const d = door(`${CB}${ACC}plot(bar_index > last_bar_index - 10 ? 1 : 0, "tail")\n`)
    const r = run(d)
    expect(r.err, r.err && r.err.message).toBeUndefined()
    const t = r.cols[d.definition.plots.find((p) => p.label === 'tail').key]
    expect(t[N - 11]).toBe(0)
    expect(t[N - 10]).toBe(1)
  })

  it('⭐ ONE run: a windowed run fits a budget its main run fits (no second, shifted run)', () => {
    flags()
    const d = door(`${CB}${ACC}plot(bar_index - bar_index[1], "gap")\n`)
    let u = 0
    computeRuntimeColumns(install(d), BARS.slice(N - 100), { ...CTX, historyFromListing: true }, { budgetMs: 1e9, now: () => (u += 1), incremental: false })
    const r = run(d, BARS, CTX, { budgetMs: Math.ceil(u * 1.5), now: (() => { let v = 0; return () => (v += 1) })(), incremental: false })
    expect(r.err, r.err && r.err.message).toBeUndefined()
  })

  it('⭐ M-C CONTROL — a limit the run reaches is still runtime:limit, by its own name', () => {
    flags()
    const d = door(`${CB}${ACC}s = 0.0\nfor i = 0 to bar_index\n    s += 0\nplot(s, "s")\n`)
    expect(run(d, BARS, CTX, { limits: { LOOP_ITERATIONS: 200 } }).err.guard).toBe('runtime:limit')
  })
})

describe('WS-E re-review low — a fill coloured `na` is hidden, not a gradient', () => {
  const H = '//@version=6\nindicator("t", overlay = true)\n'
  const P = `${ACC}p1 = plot(acc * 1.1, "A")\np2 = plot(acc * 0.9, "B")\n`
  for (const f of ['fill(p1, p2, na, "t", true, false)', 'fill(p1, p2, na, na)']) {
    it(`⛔ ${f}`, () => {
      const built = buildRuntimeIr(`${H}${P}${f}\n`, { bars: BARS.slice(0, 5), inputs: {} })
      expect(built.ok, built.refusal && built.refusal.message).toBe(true)
      const fill = built.ir.outputs.find((o) => o.call === 'fill')
      expect(fill.gradient).toBeUndefined()
      expect(fill.hidden).toBe(true)
    })
  }
  it('⭐ CONTROL — `fill(p1, p2, na, na, color.red, color.green)` stays the gradient form', () => {
    const built = buildRuntimeIr(`${H}${P}fill(p1, p2, na, na, color.red, color.green)\n`, { bars: BARS.slice(0, 5), inputs: {} })
    expect(built.ok).toBe(true)
    expect(built.ir.outputs.find((o) => o.call === 'fill').gradient).toBe(true)
  })
})
