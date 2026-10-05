// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c18KClustering.test.js
//
// ─── C18 — K-CLUSTERING: THE LOOP IS EXACT, AND THE BAR IS OVER THE CEILING ─────
//
// Captured on a live TradingView chart 2026-09-28 (NYSE:RDDT 1D, 632 bars from the
// listing day). On the last bar the script runs K-means: a `while err > .01` whose
// every pass re-assigns the 252 closes to their nearest centre (a `for` inside a
// `for`), recomputes the centres through helpers that build arrays per call, and
// reassigns `clust`, `sd_clust` and `n_clust` whole with `array.copy` of
// `array.slice`s. It draws nine lines (three centres, six ±1 SD bands) and three
// density cells.
//
// ⭐ THE RUNTIME LANE COMPUTES IT EXACTLY. Run with a per-bar ceiling large enough
// for the loop, the `while` converges in 15 passes and every one of the nine line
// levels and the three densities is TradingView's to the last bit — the rail below
// holds that against the capture, so the refusal on the product path is about the
// ceiling and never about the arithmetic.
//
// ⛔ AND ON THE PRODUCT PATH IT IS REFUSED, BY NAME. The last bar needs 800,613 VM
// instructions against the runtime's `INSTRUCTIONS_PER_BAR` ceiling of 200,000 (an
// engine limit, `limits.js`). Raising a runtime budget is not this lane's call, so
// the values are withheld (`runtime:INSTRUCTIONS_PER_BAR`) and nothing is drawn off
// them: the chart keeps the five cells the columnar lane draws by itself.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects, defaultNumberText } from '../../objectRuntime'
import { toRenderState } from '../../objectRenderState'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock'
import { lowerIrProgram } from '../../runtime/lowerIr'
import { execute } from '../../runtime/vm'
import { Budget, DEFAULT_LIMITS } from '../../runtime/limits'
import { RUNTIME_PROBES } from '../../runtime/runtimeColumns'

const FILE = path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/harness/k-clustering-rddt-1d-2026-09-28.json')

describe('⭐ C18 — k-clustering', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  const load = () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const loaded = loadCapture(FILE)
    expect(loaded.capture, loaded.reason).toBeTruthy()
    const cap = loaded.capture
    const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c18_kc', name: 'kc' })
    expect(d.ok, d.reason).toBe(true)
    return { cap, bars: toProductBars(cap), d }
  }

  it('the runtime lane computes TradingView\'s nine levels and three densities exactly', () => {
    const { cap, bars, d } = load()
    const rt = d.definition.objects.runtime
    expect(rt, 'the program reads from the runtime lane').toBeTruthy()
    const built = buildRuntimeIr(rt.source, {
      bars, inputs: {}, objectTrees: [], objectTreesAt: rt.at, basePeriod: 'D', tf: 'D',
      ...runtimeClockOpts(false, { tf: 'D' }),
    })
    expect(built.ok, JSON.stringify(built.refusal)).toBe(true)
    const program = lowerIrProgram(built.ir)
    const series = ['o', 'h', 'l', 'c', 'v'].map((f) => Float64Array.from(bars.map((b) => b[f])))
    const runAt = (probe) => {
      // ⚠️ A TEST-ONLY CEILING, so the exactness of the arithmetic can be shown;
      // the product runs at DEFAULT_LIMITS (the next case).
      // ⭐ RT10 (2026-10-04): `LOOP_ITERATIONS` is now a PER-BAR ceiling held just under
      // what `INSTRUCTIONS_PER_BAR` allows (`limits.js`), so a test that raises the bar's
      // instructions raises the bar's loop passes with it.
      // ⭐ RT17 (2026-10-04): the same for the per-bar WORK limits (`PER_BAR_CHARGED`):
      // the last bar's whole run of the clustering takes more array operations and
      // calls than one product bar allows, and past `INSTRUCTIONS_PER_BAR` first.
      const budget = new Budget({ INSTRUCTIONS_PER_BAR: 2000000, TOTAL_INSTRUCTIONS: 20000000, LOOP_ITERATIONS: 2000000,
        ARRAY_OPERATIONS: 2000000, CALL_COUNT: 2000000 })
      budget.unmeasured = { ...probe, hits: [] }
      const res = execute(program, {
        bars: bars.length, series, columns: program.columns, confirmed: true, barTimes: bars.map((b) => b.t),
      }, undefined, { budget })
      return { res, budget }
    }
    const a = runAt(RUNTIME_PROBES[0])
    const b = runAt(RUNTIME_PROBES[1])
    expect(a.budget.counts.WHILE_ITERATIONS).toBe(15)
    // the last bar's passes, all loops together: past the product's per-bar ceiling,
    // and past `INSTRUCTIONS_PER_BAR` first, which is the stop the product path meets
    expect(a.budget.counts.LOOP_ITERATIONS).toBe(22820)
    expect(a.budget.counts.LOOP_ITERATIONS).toBeGreaterThan(DEFAULT_LIMITS.LOOP_ITERATIONS)
    expect(a.budget.counts.INSTRUCTIONS_PER_BAR).toBeGreaterThan(DEFAULT_LIMITS.INSTRUCTIONS_PER_BAR)
    // ⭐ RT17 — the same bar's array operations and calls, measured: past one product
    // bar's ceiling too, and only on the bar `INSTRUCTIONS_PER_BAR` already stops.
    expect(a.budget.counts.ARRAY_OPERATIONS).toBe(11718)
    expect(a.budget.counts.CALL_COUNT).toBe(11550)
    expect(a.budget.counts.ARRAY_OPERATIONS).toBeGreaterThan(DEFAULT_LIMITS.ARRAY_OPERATIONS)
    // the empty clusters (k = 3 of 6) are averaged on every pass. ⭐ H7 (step 92h) —
    // that answer is MEASURED now (`array.avg` of an empty array is `na`, CAP4
    // Q-RT7a), so it no longer takes the probe: no hit, and the two runs agree
    // everywhere because nothing in them is unknown.
    expect(a.budget.unmeasured.hits).toEqual([])
    const last = bars.length - 1
    const value = (res, k) => res.outputs[built.objectAtOutputs[k]][last]
    const vals = rt.at.map((_, k) => value(a.res, k))
    rt.at.forEach((_, k) => expect(Object.is(value(b.res, k), vals[k]) || (Number.isNaN(vals[k]) && Number.isNaN(value(b.res, k)))).toBe(true))
    // every TradingView line level is one of the values read at a drawing
    const finite = new Set(vals.filter((v) => Number.isFinite(v)))
    for (const l of cap.objects.records.lines) {
      expect(finite.has(l.y1), `line ${l.id} at ${l.y1}`).toBe(true)
    }
    // and the densities, read where the cells stand, print as TradingView's
    const pct = rt.at.map((a2, k) => (a2.line >= 185 && a2.line <= 187 ? vals[k] : null)).filter((v) => v !== null)
    expect(pct.map((v) => defaultNumberText(v) + '%')).toEqual(['52%', '29.4%', '18.7%'])
  })

  it('⛔ on the product path the last bar is over INSTRUCTIONS_PER_BAR — withheld by name, nothing drawn off it', () => {
    const { cap, bars, d } = load()
    const reader = objectReaderFor(d.definition, bars, {
      tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
      historyFromListing: true,
    })
    expect(reader.runtime).toEqual({ served: false, reason: 'runtime:INSTRUCTIONS_PER_BAR' })
    const run = evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
    })
    expect(run.live.filter((o) => o.family === 'line')).toEqual([])
    const texts = toRenderState(run.live, { bars, tf: 'D' }).tables.flatMap((t) => t.cells).map((c) => c.text)
    expect(texts.sort()).toEqual(['1', '2', '3', 'Cluster', 'Density'])
  })
})
