// app/src/components/chart/engine/__tests__/vendorHarness/runtimeFallbackPerf.measure.test.js
//
// ─── ⭐⭐ RT1 — WHAT A RUNTIME-LANE PANE COSTS ON A 5,000-BAR CHART ───────────
//
// The runtime lane executes a member's script once per bar. This census builds
// every committed corpus script through the member door with the runtime pane ON
// (the same `enterMemberDoor` the vendor harness and the member-door census use),
// and for each one the door drew from the RUNTIME lane it times `computeFor` on a
// real 5,000-bar daily series (the newest 5,000 bars of a committed capture),
// cold — a fresh bars array each run, so the per-bars memo never answers.
//
// ⛔ OPT-IN, LIKE EVERY CENSUS HERE, AND IT ASSERTS NO TIMING. A wall-clock
// number is a property of the machine; pinning one would go red on a busy box.
// What it asserts is that the corpus was found and every runtime document was
// timed. The BUDGET the product enforces is `runtime/limits.js` (named there,
// deterministic), and the record of these readings is the triage doc's RT1
// section.
//   cd app && RUNTIME_PERF_CENSUS=1 RUNTIME_PERF_OUT=<file.json> \
//     node node_modules/vitest/vitest.mjs run \
//     src/components/chart/engine/__tests__/vendorHarness/runtimeFallbackPerf.measure.test.js
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'

const RUN = process.env.RUNTIME_PERF_CENSUS === '1'
const OUT = process.env.RUNTIME_PERF_OUT
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const SERIES = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness', 'vw-deadband-ticks-aapl-1d-2026-09-28.json')
const N_BARS = 5000
const RUNS = 5

afterEach(() => { vi.unstubAllEnvs() })

const freshBars = (rows) => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))

describe.skipIf(!RUN)('runtime-lane pane cost on 5,000 bars (opt-in)', () => {
  it('times every runtime document the member door mints', () => {
    expect(OUT, 'RUNTIME_PERF_OUT must name the output file').toBeTruthy()
    const cap = JSON.parse(fs.readFileSync(SERIES, 'utf8'))
    const rows = cap.bars.rows.slice(-N_BARS)
    expect(rows.length).toBe(N_BARS) // non-vacuity: the series is long enough
    const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
    expect(files.length).toBeGreaterThan(200)
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const out = []
    for (const f of files) {
      const source = fs.readFileSync(path.join(CORPUS, f), 'utf8')
      let door
      try { door = enterMemberDoor(source) } catch { registry.uninstallUserDefinition(HARNESS_DEF_ID); continue }
      try {
        if (!door.def || !door.built || door.built.lane !== 'runtime') continue
        const times = []
        let errors = null
        for (let k = 0; k < RUNS; k += 1) {
          const bars = freshBars(rows)
          const t0 = performance.now()
          const cols = registry.computeFor(door.def, bars, undefined,
            { tf: 'D', newestBarIsForming: false, historyFromListing: true })
          times.push(performance.now() - t0)
          errors = registry.columnErrors(cols)
        }
        times.sort((a, b) => a - b)
        out.push({
          file: `corpus/committed/${f}`,
          slug: f.replace(/\.pine$/, '').split('__')[0],
          bars: N_BARS,
          medianMs: Number(times[Math.floor(times.length / 2)].toFixed(2)),
          maxMs: Number(times[times.length - 1].toFixed(2)),
          columnErrors: errors && Object.keys(errors).length ? errors : null,
        })
      } finally {
        registry.uninstallUserDefinition(HARNESS_DEF_ID)
      }
    }
    expect(out.length).toBeGreaterThan(0) // non-vacuity: something was timed
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true })
    fs.writeFileSync(OUT, `${JSON.stringify({
      generatedBy: 'app/src/components/chart/engine/__tests__/vendorHarness/runtimeFallbackPerf.measure.test.js',
      series: path.relative(REPO, SERIES).split(path.sep).join('/'),
      bars: N_BARS,
      runs: RUNS,
      scripts: out,
    }, null, 1)}\n`)
    // eslint-disable-next-line no-console
    console.log(`runtime perf: ${out.length} runtime documents timed on ${N_BARS} bars -> ${OUT}\n`
      + out.map((r) => `  ${r.slug}: median ${r.medianMs} ms, max ${r.maxMs} ms${r.columnErrors ? ' (column errors)' : ''}`).join('\n'))
  }, 900000)
})
