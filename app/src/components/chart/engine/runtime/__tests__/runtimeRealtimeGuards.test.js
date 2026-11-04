// app/src/components/chart/engine/runtime/__tests__/runtimeRealtimeGuards.test.js
//
// ⭐ P3 WS-F — the guards of the session build cache (B5) and the realtime ledger that
// `runtimeBuildCache.test.js` and `runtimeRealtimeTicks.test.js` do not reach by a
// chart's ordinary life. Each was mutation-proved: break it, see this file red.
//   * a build in which a column evaluation THREW is never kept (`buildRecorder`);
//   * a kept build whose re-evaluation throws answers null, so the run rebuilds
//     (`columnsOver`);
//   * a column is carried only over bars with the SAME TIMES, not merely the same count
//     (a sliding window keeps the count and moves every time);
//   * a run that STOPS records nothing in the ledger (`commit` after success only);
//   * an objects run that falls back to the plain run is named by the plain run's TIME
//     stop when that is what kept its plots from being drawn (WS-H, B2: wyckoff).
import { describe, it, expect, beforeEach } from 'vitest'
import { runtimeObjectsOf } from '../runtimeObjects.js'
import {
  computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeIncrementalOf,
  buildRecorder, columnsOver, RUNTIME_TIME_BUDGET_GUARD,
} from '../runtimeColumns.js'

const doc = (body, outputs = { a: 0, b: 1 }, extra = {}) => ({
  id: 'rt-guards', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:rt-guards', outputs, source: `//@version=5\nindicator("g")\n${body}`, ...extra },
})
const mk = (n, from = 0) => Array.from({ length: n }, (_, j) => {
  const i = j + from
  const c = 100 + 3 * Math.sin(i / 4) + i * 0.05
  return { t: 1700000000 + i * 86400, o: c - 0.3, h: c + 1, l: c - 1, c, v: 1000 + i }
})
const LIVE = { tf: 'D', newestBarIsForming: true, historyFromListing: true }
const tick = (rows, dc) => {
  const last = rows[rows.length - 1]
  const c = last.c + dc
  return [...rows.slice(0, -1), { ...last, c, h: Math.max(last.h, c), l: Math.min(last.l, c) }]
}
const same = (x, y, at) => {
  for (const k of Object.keys(y)) {
    expect(x[k].length, at).toBe(y[k].length)
    for (let i = 0; i < y[k].length; i += 1) if (!Object.is(x[k][i], y[k][i])) expect.fail(`${at}: ${k}[${i}] ${x[k][i]} vs ${y[k][i]}`)
  }
}

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

const num = (value) => ({ type: 'num', value })
const series = (name) => ({ type: 'series', name })

describe('⛔ buildRecorder — a build in which a column threw is never kept', () => {
  it('every column evaluated cleanly: the build is kept, its trees in order', () => {
    const rec = buildRecorder()
    const rows = mk(5)
    rec.interpret(num(1), rows, {}, undefined)
    rec.interpret(series('close'), rows, {}, undefined)
    const kept = rec.done({ columns: [new Float64Array(5), new Float64Array(5)] })
    expect(kept && kept.trees.length).toBe(2)
    expect(kept.ir.columns).toEqual([])
  })
  it('one evaluation threw (the front end may have caught it and routed elsewhere): nothing is kept', () => {
    const rec = buildRecorder()
    const rows = mk(5)
    rec.interpret(num(1), rows, {}, undefined)
    expect(() => rec.interpret({ type: 'call', name: 'no.such.function', args: [] }, rows, {}, undefined)).toThrow()
    expect(rec.done({ columns: [new Float64Array(5)] })).toBeNull()
  })
})

describe('⛔ columnsOver — a kept build that cannot re-evaluate answers null (the run rebuilds)', () => {
  it('a tree that throws over these bars', () => {
    const build = { ir: { columns: [] }, trees: [{ tree: { type: 'call', name: 'no.such.function', args: [] }, inputs: {}, interpretOpts: undefined, invariant: false }] }
    expect(columnsOver(build, mk(5), null)).toBeNull()
  })
  it('control: a tree that evaluates answers its column', () => {
    const build = { ir: { columns: [] }, trees: [{ tree: series('close'), inputs: {}, interpretOpts: undefined, invariant: false }] }
    const out = columnsOver(build, mk(5), null)
    expect(Array.from(out[0])).toEqual(mk(5).map((b) => b.c))
  })
})

describe('⛔ a carried column needs the same TIMES, not just the same count', () => {
  it('a sliding window (one bar drops off, one arrives): every clock column re-evaluated, still exact', () => {
    const d = doc('plot(time % 1000003 + bar_index)\nplot(close + (barstate.isconfirmed ? 0 : 1))\n')
    computeRuntimeColumns(d, mk(60), LIVE)
    const slid = mk(60, 1)
    const out = computeRuntimeColumns(d, slid, LIVE)
    expect(runtimeIncrementalOf(out).rebuilt, 'the build was reused').toBe(false)
    const cold = computeRuntimeColumns(d, slid, LIVE, { incremental: false })
    same(out, cold, 'slid window')
  })
})

describe('⛔ a run that stops records nothing in the realtime ledger', () => {
  it('a tick stopped by the time budget on the forming bar: the next update counts as if it never ran', () => {
    const d = doc('var int a = 0\na += 1\nvarip int b = 0\nb += 1\nplot(a)\nplot(b)\n')
    let rows = mk(50)
    expect(computeRuntimeColumns(d, rows, LIVE).b[49]).toBe(50)
    rows = tick(rows, 0.1)
    let k = 0
    expect(() => computeRuntimeColumns(d, rows, LIVE, { budgetMs: 500, now: () => (k += 1000) }))
      .toThrow(expect.objectContaining({ guard: RUNTIME_TIME_BUDGET_GUARD }))
    rows = tick(rows, 0.1)
    const out = computeRuntimeColumns(d, rows, LIVE)
    expect(out.b[49], 'the stopped update left no trace: this is the bar\'s second execution').toBe(51)
    expect(out.a[49]).toBe(50)
  })
})

describe('⭐ an objects run falling back to its plain run is named by the plain run\'s time stop', () => {
  const OBJ = {
    id: 'rt-obj', meta: { runtimeHistory: 'listing' },
    compute: { kind: 'runtime', fn: 'runtime:rt-obj', outputs: { v: 0 }, objects: true,
      // ⭐ a drawing wall the objects run names (`polyline.all` as a value). It was
      // `calc_bars_count = 50` until WS-E (#556) started serving that by a window.
      source: '//@version=6\nindicator("w", overlay = true)\nplot(ta.ema(close, 10))\nb = box.new(bar_index, high, bar_index, low)\nbox.set_text(b, polyline.all)\n' },
  }
  const CLOSED = { tf: 'D', newestBarIsForming: false, historyFromListing: true }
  it('control: with time to spare, the drawings are withheld by their own name and the plots draw', async () => {
    const { runtimeObjectsWithheldOf } = await import('../runtimeObjects.js')
    const out = computeRuntimeColumns(OBJ, mk(300), CLOSED, { incremental: false })
    expect(out.v.length).toBe(300)
    expect(runtimeObjectsWithheldOf(out).guard).toBe('pine:drawing')
  })
  it('out of time: the answer is the time budget, not the drawings\' refusal', () => {
    let k = 0
    expect(() => computeRuntimeColumns(OBJ, mk(300), CLOSED, { incremental: false, budgetMs: 500, now: () => (k += 1000) }))
      .toThrow(expect.objectContaining({ guard: RUNTIME_TIME_BUDGET_GUARD }))
  })
})

describe('⭐ a drawing script on a kept build, re-run from bar 0 after an old bar moved, draws what a cold run draws', () => {
  const DRAW = (body) => ({
    id: 'rt-draw', meta: { runtimeHistory: 'listing' },
    compute: { kind: 'runtime', fn: 'runtime:rt-draw', outputs: { v: 0 }, objects: true,
      source: `//@version=6\nindicator("w", overlay = true)\nplot(ta.ema(close, 10))\n${body}` },
  })
  const BODIES = {
    'a var line extended every bar': 'var line l = line.new(bar_index, close, bar_index, close)\nline.set_xy2(l, bar_index, close)\n',
    'labels at crossovers': 'if ta.crossover(close, ta.sma(close, 5))\n    label.new(bar_index, high, "x")\n',
  }
  for (const [name, body] of Object.entries(BODIES)) {
    it(name, () => {
      let rows = mk(120)
      computeRuntimeColumns(DRAW(body), rows, LIVE)
      rows = rows.map((r, i) => (i === 3 ? { ...r, c: r.c + 0.5 } : r))
      const got = computeRuntimeColumns(DRAW(body), rows, LIVE)
      expect(runtimeIncrementalOf(got)).toMatchObject({ resumedFrom: null, rebuilt: false })
      const cold = computeRuntimeColumns(DRAW(body), rows, LIVE, { incremental: false })
      expect(runtimeObjectsOf(got)).toEqual(runtimeObjectsOf(cold))
      same(got, cold, name)
    })
  }
})
