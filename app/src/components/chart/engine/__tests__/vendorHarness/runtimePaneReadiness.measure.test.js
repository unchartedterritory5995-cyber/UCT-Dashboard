// app/src/components/chart/engine/__tests__/vendorHarness/runtimePaneReadiness.measure.test.js
//
// ─── ⭐⭐ RF — WHAT A RUNTIME-ONLY PANE COSTS ON A MEMBER'S CHART, AT EVERY LENGTH ─
//
// RT1's `runtimeFallbackPerf.measure.test.js` timed the run on ONE length (5,000
// daily bars). A member's chart loads more than that: `utils/barsBackfill.js::
// fullBarsFor` takes a daily chart to 12,500 bars and an intraday one to 20,000-
// 32,000. This census takes every corpus script the member door draws ONLY
// through the runtime lane (attached with the runtime pane ON, refused with it
// OFF — the census' `runtime` state minus its `on` state) and measures, per script:
//
//   * the DOOR (`memberPaneDefinition`, translation + the runtime probe's compile)
//     — this runs on the MAIN thread, in the member's editor, on every edit;
//   * the RUN (`computeRuntimeColumns`, the one computation the worker runs) on
//     5,000 and 11,534 daily bars and on 20,208 and 32,000 five-minute bars, with
//     the listing fact stated so the run computes (the product refuses a fallback
//     document on intraday by name, `runtime:history-start`; that answer is
//     recorded beside the timing);
//   * the heap the run holds at its peak (sampled through the run's own clock
//     hook) and the bytes of the columns it hands back;
//   * whether it passes the pane's budget (`RUNTIME_PANE_TIME_BUDGET_MS`), and if
//     it does, that it stops BY NAME (`runtime:time-budget`), never by freezing.
//
// ⛔ OPT-IN, AND IT ASSERTS NO TIMING (a wall clock is the machine's). It asserts
// the corpus was found, every runtime-only script was measured at every length,
// and a budget stop carries its guard.
//   cd app && RF_READINESS=1 RF_READINESS_OUT=<file.json> [RF_DEFS_OUT=<defs.json>] \
//     node node_modules/vitest/vitest.mjs run --maxWorkers=1 \
//     src/components/chart/engine/__tests__/vendorHarness/runtimePaneReadiness.measure.test.js
// `RF_DEFS_OUT` also writes the minted documents and the bars, for the browser
// harness that runs them in the REAL worker bundle (`tools/runtime_pane_worker_probe.py`).
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import {
  computeRuntimeColumns, probeRuntimeProgram, RUNTIME_PANE_TIME_BUDGET_MS, RUNTIME_TIME_BUDGET_GUARD,
} from '../../runtime/runtimeColumns'
import { runtimeRepaintOf } from '../../runtime/runtimeRepaint'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'

const RUN = process.env.RF_READINESS === '1'
const OUT = process.env.RF_READINESS_OUT
const DEFS_OUT = process.env.RF_DEFS_OUT
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const FIX = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness')
const DAILY = path.join(FIX, 'vw-deadband-ticks-aapl-1d-2026-09-28.json')
const FIVE = path.join(FIX, 'vw-bar-origin-rddt-5-2026-10-02.json')
const RUNS = 3

afterEach(() => { vi.unstubAllEnvs() })

const rowsOf = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).bars.rows
const toBars = (rows) => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))

/** 32,000 five-minute bars: the 20,208 captured ones preceded by their own first
 *  11,792 shifted one series-length earlier (prices identical — this measures
 *  cost, never a value). `fullBarsFor('30'|'60')` is 32,000, the longest a chart
 *  loads. */
function longIntraday(rows, n) {
  const span = rows[rows.length - 1][0] - rows[0][0] + 300
  const head = rows.slice(0, n - rows.length).map(([t, ...rest]) => [t - span, ...rest])
  return [...head, ...rows]
}

function timeRun(def, rows, ctx) {
  const times = []
  let peak = 0
  let err = null
  let cols = null
  for (let k = 0; k < RUNS; k += 1) {
    const bars = toBars(rows)
    const base = process.memoryUsage().heapUsed
    let calls = 0
    const now = () => {
      calls += 1
      if (calls % 512 === 0) {
        const h = process.memoryUsage().heapUsed - base
        if (h > peak) peak = h
      }
      return performance.now()
    }
    const t0 = performance.now()
    try {
      cols = computeRuntimeColumns(def, bars, ctx, { budgetMs: 60000, now })
    } catch (e) { err = e }
    times.push(performance.now() - t0)
  }
  times.sort((a, b) => a - b)
  const colBytes = cols ? Object.values(cols).reduce((s, c) => s + c.length * 8, 0) : 0
  return {
    bars: rows.length,
    medianMs: Number(times[Math.floor(times.length / 2)].toFixed(1)),
    maxMs: Number(times[times.length - 1].toFixed(1)),
    peakHeapMB: Number((peak / 1048576).toFixed(1)),
    columnBytes: colBytes,
    error: err ? { guard: err.guard || null, name: err.name, message: String(err.message).slice(0, 160) } : null,
  }
}

describe.skipIf(!RUN)('RF — runtime-only panes: door, run, heap and budget at every chart length (opt-in)', () => {
  it('measures every runtime-only corpus script', () => {
    expect(OUT, 'RF_READINESS_OUT must name the output file').toBeTruthy()
    const daily = rowsOf(DAILY)
    const five = rowsOf(FIVE)
    expect(daily.length).toBeGreaterThan(11000)
    expect(five.length).toBeGreaterThan(20000)
    const lengths = [
      { name: 'D 5000', rows: daily.slice(-5000), tf: 'D' },
      { name: `D ${daily.length}`, rows: daily, tf: 'D' },
      { name: `5m ${five.length}`, rows: five, tf: '5' },
      { name: '5m 32000', rows: longIntraday(five, 32000), tf: '5' },
    ]
    const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
    expect(files.length).toBeGreaterThan(200)
    const out = []
    const defs = []
    for (const f of files) {
      const source = fs.readFileSync(path.join(CORPUS, f), 'utf8')
      // ⭐ runtime-only: refused with the runtime pane OFF (objects-only ON, as
      // production), attached with it ON through the runtime lane.
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
      let offDoor
      try { offDoor = enterMemberDoor(source) } catch { offDoor = { def: null } }
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
      if (offDoor.def) continue
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
      let door
      try { door = enterMemberDoor(source) } catch { registry.uninstallUserDefinition(HARNESS_DEF_ID); continue }
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
      if (!door.def || !door.built || door.built.lane !== 'runtime') continue
      // the DOOR, on the main thread: cold once, then the median of warm builds
      const doorTimes = []
      for (let k = 0; k < RUNS + 1; k += 1) {
        const t0 = performance.now()
        memberPaneDefinition({ source, id: HARNESS_DEF_ID, name: 'rf' })
        doorTimes.push(performance.now() - t0)
      }
      const doorCold = doorTimes[0]
      const warm = doorTimes.slice(1).sort((a, b) => a - b)
      // the runtime lane's OWN share of the door: its compile probe (`probeRuntimeProgram`)
      // and its repaint classifier; the rest is the host translation every script pays
      const probeTimes = []
      for (let k = 0; k < RUNS; k += 1) {
        const t0 = performance.now()
        runtimeRepaintOf(source)
        probeRuntimeProgram(source)
        probeTimes.push(performance.now() - t0)
      }
      probeTimes.sort((a, b) => a - b)
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
      const offTimes = []
      for (let k = 0; k < RUNS; k += 1) {
        const t0 = performance.now()
        memberPaneDefinition({ source, id: HARNESS_DEF_ID, name: 'rf' })
        offTimes.push(performance.now() - t0)
      }
      offTimes.sort((a, b) => a - b)
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
      const def = door.def
      const slug = f.replace(/\.pine$/, '').split('__')[0]
      const runs = lengths.map((L) => ({
        length: L.name,
        ...timeRun(def, L.rows, { tf: L.tf, newestBarIsForming: false, historyFromListing: true }),
      }))
      // ⛔ THE PRODUCT'S OWN ANSWER on the same intraday bars: a fallback document
      // is refused by name there (`runtime:history-start`), so the timing above is
      // what it WOULD cost, not what a member pays.
      let productIntraday = null
      try {
        computeRuntimeColumns(def, toBars(five.slice(-100)), { tf: '5', newestBarIsForming: false },
          { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS })
        productIntraday = 'computes'
      } catch (e) { productIntraday = e.guard || e.name }
      // ⭐ THE BUDGET, AS SHIPPED: every length that took longer than the budget
      // is re-run under it, and must stop BY NAME.
      const budget = runs.filter((r) => r.maxMs > RUNTIME_PANE_TIME_BUDGET_MS * 0.8).map((r) => {
        const L = lengths.find((x) => x.name === r.length)
        try {
          computeRuntimeColumns(def, toBars(L.rows), { tf: L.tf, newestBarIsForming: false, historyFromListing: true },
            { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS })
          return { length: r.length, stopped: null }
        } catch (e) {
          return { length: r.length, stopped: e.guard || e.name, message: String(e.message).slice(0, 200) }
        }
      })
      out.push({
        slug,
        file: `corpus/committed/${f}`,
        plots: (door.built.rows || []).length,
        withheld: door.built.withheld || [],
        drawsObjects: !!(def.objects && (def.objects.ops || []).length),
        runtimeHistory: (def.meta && def.meta.runtimeHistory) || null,
        repaint: def.meta && def.meta.repaint,
        doorColdMs: Number(doorCold.toFixed(1)),
        doorWarmMedianMs: Number(warm[Math.floor(warm.length / 2)].toFixed(1)),
        doorRuntimeOffMedianMs: Number(offTimes[Math.floor(offTimes.length / 2)].toFixed(1)),
        runtimeProbeMedianMs: Number(probeTimes[Math.floor(probeTimes.length / 2)].toFixed(1)),
        runs,
        productIntraday,
        budget,
      })
      defs.push({ slug, def: JSON.parse(JSON.stringify(def)) })
    }
    expect(out.length).toBeGreaterThan(0) // non-vacuity
    for (const r of out) {
      expect(r.runs.length).toBe(lengths.length)
      for (const b of r.budget) if (b.stopped !== null) expect(b.stopped, r.slug).toBe(RUNTIME_TIME_BUDGET_GUARD)
    }
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true })
    fs.writeFileSync(OUT, `${JSON.stringify({
      generatedBy: 'app/src/components/chart/engine/__tests__/vendorHarness/runtimePaneReadiness.measure.test.js',
      budgetMs: RUNTIME_PANE_TIME_BUDGET_MS,
      runs: RUNS,
      lengths: lengths.map((L) => L.name),
      scripts: out,
    }, null, 1)}\n`)
    if (DEFS_OUT) {
      fs.writeFileSync(DEFS_OUT, JSON.stringify({
        defs,
        bars: { 'D 5000': toBars(daily.slice(-5000)), '5m 32000': toBars(longIntraday(five, 32000)) },
      }))
    }
    // eslint-disable-next-line no-console
    console.log(out.map((r) => `${r.slug}: door ${r.doorColdMs}/${r.doorWarmMedianMs} ms; `
      + `(runtime off ${r.doorRuntimeOffMedianMs}, probe ${r.runtimeProbeMedianMs}); `
      + r.runs.map((x) => `${x.length} ${x.medianMs}ms ${x.peakHeapMB}MB${x.error ? ` [${x.error.guard || x.error.name}]` : ''}`).join('; ')
      + `; intraday in product: ${r.productIntraday}; budget: ${JSON.stringify(r.budget)}`).join('\n'))
  }, 1800000)
})
