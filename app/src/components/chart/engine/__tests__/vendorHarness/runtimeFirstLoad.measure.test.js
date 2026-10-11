// app/src/components/chart/engine/__tests__/vendorHarness/runtimeFirstLoad.measure.test.js
//
// ⭐⭐ UIE PHASE 5 (M4) — WHERE A RUNTIME PANE'S FIRST LOAD GOES, PHASE BY PHASE.
//
// For the slow runtime-only scripts, on real 5-minute bars (from the listing: one run;
// off it: the curtain's two), best of RUNS after a JIT warm-up:
//   build   — `buildRuntimeIr` (lex, parse, front end, the precomputed COLUMNS over every bar)
//   lower   — `lowerIrProgram`
//   vm      — `execute` (the bar loop), as the pane runs it
//   product — `computeRuntimeColumns` cold (no session): everything above + the curtain
//   clone   — the worker's structured clone of the bars in and the columns out
// so the cost that remains after incremental execution (a first load, an invalidation)
// is attributed, not guessed.
//
// ⛔ OPT-IN (UIE_FIRSTLOAD=1, UIE_FIRSTLOAD_OUT=<file.json>). Asserts only that it ran.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../../nativeRegistry'
import { computeRuntimeColumns, resetRuntimeSessions } from '../../runtime/runtimeColumns'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../../runtime/lowerIr.js'
import { execute } from '../../runtime/vm.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'
import { HARNESS_DIR } from './harness'

const RUN = process.env.UIE_FIRSTLOAD === '1'
const OUT = process.env.UIE_FIRSTLOAD_OUT
const RUNS = 3
const SCRIPTS = ['delta-rsi-oscillator-strategy', 'fibonacci-dolphintradebot', 'cc-yata', 'wyckoff-accumulation',
  'nadaraya-watson-rational-quadratic', 'atr-stepped-pdf-ma-loxx', 'kalman-price-filter-backquant']
const LIFTED = { CALL_COUNT: 1e12, TOTAL_INSTRUCTIONS: 1e12, LOOP_ITERATIONS: 1e12, ARRAY_OPERATIONS: 1e12, CARRIED_STEPS: 1e12, WINDOW_CELLS: 1e12, WALL_TIME: 1e9 }
afterEach(() => { vi.unstubAllEnvs() })
const best = (f) => { f(); let m = Infinity; let r; for (let k = 0; k < RUNS; k += 1) { const t0 = performance.now(); r = f(); m = Math.min(m, performance.now() - t0) } return { ms: Math.round(m * 10) / 10, r } }

describe.skipIf(!RUN)('UIE Phase 5 — first-load phases (opt-in)', () => {
  it('attributes the first load', () => {
    const REPO = path.resolve(process.cwd(), '..')
    const five = JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, 'vw-bar-origin-rddt-5-2026-10-02.json'), 'utf8'))
      .bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
    const rows = five.slice(-10000)
    const out = []
    for (const slug of SCRIPTS) {
      const file = fs.readdirSync(path.join(REPO, 'corpus/committed')).find((x) => x.startsWith(slug))
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
      const door = enterMemberDoor(fs.readFileSync(path.join(REPO, 'corpus/committed', file), 'utf8'))
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
      const def = door.def
      const objects = def.compute.objects === true
      const symbol = { ticker: 'RDDT', exchange: 'NYSE' }
      const buildOpts = { bars: rows, inputs: {}, ...(objects ? { objectsInRun: true } : { objectTrees: [] }), pane: true,
        plotColours: true, symbol, basePeriod: '5', tf: '5', ...runtimeClockOpts(false, { tf: '5' }) }
      const build = best(() => buildRuntimeIr(def.compute.source, buildOpts))
      const lower = best(() => lowerIrProgram(build.r.ir, { historyFromListing: true }))
      const program = lower.r
      const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(rows.map((b) => b[k])))
      const vm = best(() => execute(program, { bars: rows.length, series, columns: program.columns, confirmed: true, barTimes: rows.map((b) => b.t) }, LIFTED))
      const ctxL = { tf: '5', newestBarIsForming: false, historyFromListing: true, symbol }
      const ctxO = { tf: '5', newestBarIsForming: false, symbol }
      const product = (ctx) => best(() => { resetRuntimeSessions(); try { return computeRuntimeColumns(def, rows, ctx, { incremental: false, limits: LIFTED }) } catch (e) { return { err: e.guard } } })
      const pl = product(ctxL)
      const po = product(ctxO)
      const cloneIn = best(() => structuredClone(rows))
      const cloneOut = best(() => structuredClone(pl.r && !pl.r.err ? pl.r : {}))
      out.push({ slug, bars: rows.length, buildMs: build.ms, columns: (program.columns || []).length, lowerMs: lower.ms, vmMs: vm.ms,
        productListingMs: pl.ms, productOffListingMs: po.ms, cloneInMs: cloneIn.ms, cloneOutMs: cloneOut.ms,
        err: (pl.r && pl.r.err) || (po.r && po.r.err) || null })
    }
    expect(out.length).toBe(SCRIPTS.length)
    if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1))
  }, 3600000)
})
