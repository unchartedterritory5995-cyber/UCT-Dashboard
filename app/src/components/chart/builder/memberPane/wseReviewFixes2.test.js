// app/src/components/chart/builder/memberPane/wseReviewFixes2.test.js
//
// ─── ⭐⭐ PHASE 3 WS-E — THE RE-REVIEW'S FOLLOW-UPS ON 539c92b62d, AS RAILS ─────
//
//   M-A  the window's `bar_index` probe must see a comparison with a constant the
//        window never reaches (`bar_index > 5000`, `math.max(bar_index, 5000)`, inside
//        a UDF), and an ABSOLUTE numeric bar-index coordinate (`label.new(10, …)`).
//   M-B  the probe run spends only the budget the main run left, a budget / limit /
//        `runtime.error` stop keeps its own name, and a tick that only re-runs the
//        forming bar does not pay a cold N-bar probe.
//   low  `fill(p1, p2, na, …)` is a hidden fill, not a gradient.
import { describe, it, expect, vi, afterEach } from 'vitest'

import { memberPaneDefinition } from './memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'
import { computeRuntimeColumns, RUNTIME_TIME_BUDGET_GUARD, __resetBarIndexProbeCacheForTests } from '../../engine/runtime/runtimeColumns'
import { CALC_BARS_INDEX_GUARD } from '../../engine/runtime/calcBarsWindow'
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

afterEach(() => { registry.uninstallUserDefinition(ID); vi.unstubAllEnvs(); __resetBarIndexProbeCacheForTests() })

describe('WS-E re-review M-A — what the +1 probe could not see', () => {
  for (const tail of [
    'plot(bar_index > 5000 ? 1 : 0, "t1")\n',
    'plot(bar_index < 5000 ? close : na, "t2")\n',
    'plot(math.max(bar_index, 5000), "t3")\n',
    'f(x) =>\n    r = x\n    if bar_index > 2000\n        r := x * 2\n    r\nplot(f(close), "t4")\n',
    'b = bar_index\nvar float k = 0.0\nif b > 5000\n    k := 1\nplot(k, "t5")\n',
  ]) {
    it(`⛔ refused by name: ${tail.split('\n').slice(-2)[0]}`, () => {
      flags()
      const d = door(`${CB}${ACC}${tail}`)
      expect(d.ok, d.reason || (d.runtimeDeclined && d.runtimeDeclined.why)).toBe(true)
      const r = run(d)
      expect(r.err && r.err.guard).toBe(CALC_BARS_INDEX_GUARD)
    })
  }

  it('⛔ an ABSOLUTE bar-index coordinate (`label.new(10, …)`, no `bar_index` read) is refused by name', () => {
    flags()
    const d = door(`${CB}${ACC}if barstate.islast\n    label.new(10, close, "abs")\n`)
    expect(d.ok, d.reason).toBe(true)
    expect(run(d).err && run(d).err.guard).toBe(CALC_BARS_INDEX_GUARD)
  })

  it('⭐ CONTROL — a drawing placed by TIME (`xloc.bar_time`) and no `bar_index` read is drawn', () => {
    flags()
    const d = door(`${CB}${ACC}if barstate.islast\n    label.new(time, close, "t", xloc = xloc.bar_time)\n`)
    const r = run(d)
    expect(r.err, r.err && r.err.message).toBeUndefined()
  })

  it('⭐ CONTROL — a comparison of two indices (`bar_index > last_bar_index - 10`) is drawn', () => {
    flags()
    const d = door(`${CB}${ACC}plot(bar_index > last_bar_index - 10 ? 1 : 0, "tail")\n`)
    const r = run(d)
    expect(r.err, r.err && r.err.message).toBeUndefined()
  })
})

describe('WS-E re-review M-B — the probe\'s budget, its errors, and ticks', () => {
  const SRC = `${CB}${ACC}plot(bar_index - bar_index[1], "gap")\n`

  it('⛔ the probe gets only what the main run left: a budget spent by the main run is runtime:time-budget', () => {
    flags()
    const d = door(SRC)
    // a clock that advances 1 ms per read: the main run spends most of a small budget
    let t = 0
    const now = () => (t += 1)
    const { cols } = run(d, BARS, CTX, { budgetMs: 1e9, now })
    expect(cols).toBeTruthy()
    const spentByMain = (() => { let u = 0; const n2 = () => (u += 1); computeRuntimeColumns(install(d), BARS.slice(N - 100), { ...CTX, historyFromListing: true }, { budgetMs: 1e9, now: n2, incremental: false }); return u })()
    // a budget the main run fits but main + a second full run cannot
    __resetBarIndexProbeCacheForTests()
    const r = run(d, BARS, CTX, { budgetMs: Math.ceil(spentByMain * 1.5), now: (() => { let u = 0; return () => (u += 1) })(), incremental: false })
    expect(r.err && r.err.guard).toBe(RUNTIME_TIME_BUDGET_GUARD)
  })

  // ⭐ review M-C — the main run already passed under the same limits, so a limit, a
  // collection failure or a `runtime.error` reached ONLY by the probe (its `bar_index`
  // a million further on) is evidence the run depends on the count: named as such,
  // never as a stop this chart's script does not make.
  it('⛔ M-C — a limit only the probe reaches (lowered loop limit) is calc-bars-bar-index, not runtime:limit', () => {
    flags()
    const d = door(`${CB}${ACC}s = 0.0\nfor i = 0 to math.min(bar_index, 3000)\n    s += 0\nplot(s, "s")\n`)
    const limits = { LOOP_ITERATIONS: 50000 }
    const main = (() => { try { computeRuntimeColumns(install(d), BARS.slice(N - 100), { ...CTX, historyFromListing: true }, { limits }); return 'ok' } catch (e) { return e.guard } })()
    expect(main, 'the main run alone fits the limit').toBe('ok')
    expect(run(d, BARS, CTX, { limits }).err.guard).toBe(CALC_BARS_INDEX_GUARD)
  })

  for (const [name, tail] of [
    ['`for i = 0 to bar_index` (INSTRUCTIONS_PER_BAR in the probe)', 's = 0.0\nfor i = 0 to bar_index\n    s += 0\nplot(s, "s")\n'],
    ['`runtime.error` behind `bar_index > 5000`', 'if bar_index > 5000\n    runtime.error("boom")\n'],
    ['`array.new_float(bar_index + 1)` (ARRAY_ELEMENTS in the probe)', 'a = array.new_float(bar_index + 1)\nplot(array.size(a), "n")\n'],
  ]) {
    it(`⛔ M-C — ${name}: draws unwindowed, refused as calc-bars-bar-index windowed`, () => {
      flags()
      const plain = door(`//@version=6\nindicator("t", overlay = true)\n${ACC}${tail}`)
      expect(plain.ok, plain.reason || (plain.runtimeDeclined && plain.runtimeDeclined.why)).toBe(true)
      expect(run(plain, BARS.slice(0, 100), { ...CTX, historyFromListing: true }).err).toBeUndefined()
      registry.uninstallUserDefinition(ID)
      const d = door(`${CB}${ACC}${tail}`)
      const r = run(d)
      expect(r.err && r.err.guard).toBe(CALC_BARS_INDEX_GUARD)
      expect(String(r.err.message)).not.toMatch(/boom/)
    })
  }

  it('⭐ M-C CONTROL — a limit the MAIN run reaches is still runtime:limit', () => {
    flags()
    const d = door(`${CB}${ACC}s = 0.0\nfor i = 0 to bar_index\n    s += 0\nplot(s, "s")\n`)
    expect(run(d, BARS, CTX, { limits: { LOOP_ITERATIONS: 200 } }).err.guard).toBe('runtime:limit')
  })

  it('⭐ a tick that changes only the forming bar does not re-probe; a new closed bar does', () => {
    flags()
    const d = door(SRC)
    const def = install(d)
    const forming = { tf: 'D', newestBarIsForming: true }
    let probes = 0
    const opts = { onBarIndexProbe: () => { probes += 1 } }
    computeRuntimeColumns(def, BARS, forming, opts)
    expect(probes).toBe(1)
    const tick = BARS.map((b, i) => (i === N - 1 ? { ...b, c: b.c + 0.25, h: b.h + 0.25 } : b))
    computeRuntimeColumns(def, tick, forming, opts)
    expect(probes, 'only the forming bar moved: the verdict is reused').toBe(1)
    // CONTROL — a CLOSED bar's value moves: probed again
    const edit = BARS.map((b, i) => (i === N - 5 ? { ...b, c: b.c + 0.25 } : b))
    computeRuntimeColumns(def, edit, forming, opts)
    expect(probes).toBe(2)
    // CONTROL — a new bar arrives (the window moves): probed again
    const next = [...BARS.slice(1), { ...BARS[N - 1], t: BARS[N - 1].t + 86400 }]
    computeRuntimeColumns(def, next, forming, opts)
    expect(probes).toBe(3)
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
