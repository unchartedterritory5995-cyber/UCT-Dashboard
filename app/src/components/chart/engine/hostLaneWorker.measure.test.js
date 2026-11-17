// app/src/components/chart/engine/hostLaneWorker.measure.test.js
//
// ─── WHAT MOVING THE HOST LANE OFF THE MAIN THREAD LEAVES BEHIND (opt-in, measurement only) ──────
//
// docs/pine/evidence/2026-11-17-host-lane-worker/EVIDENCE.md. For every committed script the member
// door installs on the HOST lane, in both views a member can have (runtime pane off, and on: what
// production serves today, `PINE_RUNTIME_STAGE=all`), this times the parts of a host document's paint
// that are NOT its values, because those are what stay on the main thread when the values go to the
// worker (`hostLaneAsync.js`):
//
//   values   `astLaneColumns` with no run-read parts: the part the worker computes
//   full     `computeFor`: the values plus the run-read colours and the run half (`astRunExtras`)
//   objects  the host object program (`runHalfObjectRail.hostObjectRun`), which the binder evaluates
//            on every sync (`binder.syncObjects`)
//   stop     the script's own `runtime.error` evaluation (`runtimeErrorStopFor`), when it has one
//   clone    one structured clone of the document (what posting it to a worker costs the main thread)
//
//   cd app && HOST_WORKER_MEASURE_OUT=<file.json> [HOST_LANE_COST_ONLY=<slug,...>] \
//     node node_modules/vitest/vitest.mjs run \
//     src/components/chart/engine/hostLaneWorker.measure.test.js --maxWorkers=1 --testTimeout=7200000
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import * as registry from './nativeRegistry'
import { astLaneColumns } from './astColumns'
import { hostLaneCostOf } from './hostLaneCost'
import { hostObjectRun, hostObjectReaderOpts } from './runHalfObjectRail'
import { runtimeErrorStopFor } from './runtimeErrorStop'
import { enterMemberDoor, HARNESS_DEF_ID } from './__tests__/vendorHarness/ourSide'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList } from './runtimeKill'
import { __resetHostKnownDivergence, __ignoreHostKnownDivergenceForTests } from './hostKnownDivergence'
import { setRuntimeDoorClock } from './runtime/runtimeColumns'

const OUT = process.env.HOST_WORKER_MEASURE_OUT
const ONLY = process.env.HOST_LANE_COST_ONLY ? new Set(process.env.HOST_LANE_COST_ONLY.split(',')) : null
const REPO = path.resolve(process.cwd(), '..')
const SERIES = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness', 'vw-deadband-ticks-aapl-1d-2026-09-28.json')
const N_BARS = 5000
const SLOW_MS = 3000
const SYMBOL = Object.freeze({ ticker: 'AAPL', exchange: 'NASDAQ' })
const CTX_5000 = Object.freeze({ tf: 'D', newestBarIsForming: false, historyFromListing: false, symbol: SYMBOL })
const CTX_LISTING = Object.freeze({ tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: SYMBOL })

afterEach(() => { vi.unstubAllEnvs() })

const freshBars = (rows) => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))

/** One warm run, then the median of three (one run when the first takes over `SLOW_MS`). */
function measure(rows, run) {
  const once = () => {
    const bars = freshBars(rows)
    const t0 = performance.now()
    let error = null
    try { run(bars) } catch (e) { error = String((e && e.message) || e).slice(0, 160) }
    return { ms: performance.now() - t0, error }
  }
  const first = once()
  if (first.error || first.ms > SLOW_MS) return { ms: Number(first.ms.toFixed(1)), runs: 1, error: first.error || null }
  const times = [once().ms, once().ms, once().ms].sort((a, b) => a - b)
  return { ms: Number(times[1].toFixed(1)), runs: 3 }
}

const views = {
  off: () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '0')
    __resetRuntimePanePermission()
    __resetRuntimeAllowList()
    __resetHostKnownDivergence()
  },
  on: () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
    __resetHostKnownDivergence()
  },
}

describe.skipIf(!OUT)('what stays on the main thread when the host values move (opt-in)', () => {
  it('times values, run-read parts, objects, the runtime.error stop and a clone of every host document', () => {
    const cap = JSON.parse(fs.readFileSync(SERIES, 'utf8'))
    const all = cap.bars.rows
    const rows5k = all.slice(-N_BARS)
    const corpus = path.join(REPO, 'corpus', 'committed')
    const files = fs.readdirSync(corpus).filter((f) => f.endsWith('.pine')).sort()
    const progress = `${OUT}.progress.jsonl`
    const out = []
    setRuntimeDoorClock(() => 0)
    try {
      for (const f of files) {
        const slug = f.replace(/\.pine$/, '')
        if (ONLY && !ONLY.has(slug) && !ONLY.has(slug.replace(/__.*$/, ''))) continue
        const source = fs.readFileSync(path.join(corpus, f), 'utf8')
        for (const [view, enter] of Object.entries(views)) {
          enter()
          let door
          try { door = enterMemberDoor(source) } catch { registry.uninstallUserDefinition(HARNESS_DEF_ID); continue }
          const def = door.def
          try {
            if (!def || !def.compute || def.compute.kind !== 'ast') continue
            const cost = hostLaneCostOf(def)
            const row = { file: slug, view, stepsPerBar: cost.stepsPerBar, over: cost.over,
              objects: !!(def.objects && (def.objects.ops || []).length),
              runHalf: !!def.compute.runtimeObjects, runColours: !!def.compute.runtimeColours,
              runtimeErrors: !!(def.meta && def.meta.runtimeErrors), bytes: JSON.stringify(def).length }
            // the clone a post costs (a function or a Map in the document would throw here)
            try {
              const c = [0, 0, 0].map(() => { const t0 = performance.now(); structuredClone(def); return performance.now() - t0 })
              row.cloneMs = Number(c.sort((a, b) => a - b)[1].toFixed(2))
            } catch (e) { row.cloneError = String((e && e.message) || e).slice(0, 160) }
            const v5 = measure(rows5k, (bars) => astLaneColumns(def, bars, undefined, { ...CTX_5000 }))
            row.values5000 = v5
            if (view === 'on' || v5.ms >= 50) {
              row.full5000 = measure(rows5k, (bars) => registry.computeFor(def, bars, undefined, { ...CTX_5000 }))
            }
            if (row.objects) {
              row.objects5000 = measure(rows5k, (bars) => hostObjectRun(def, bars, hostObjectReaderOpts(CTX_5000, undefined)))
              if (row.objects5000.ms >= 20 || v5.ms >= 50) {
                row.objectsListing = measure(all, (bars) => hostObjectRun(def, bars, hostObjectReaderOpts(CTX_LISTING, undefined)))
              }
            }
            if (row.runtimeErrors) {
              row.stop5000 = measure(rows5k, (bars) => runtimeErrorStopFor(def, bars, undefined, { ...CTX_5000 }))
            }
            if (v5.ms >= 50) {
              row.valuesListing = measure(all, (bars) => astLaneColumns(def, bars, undefined, { ...CTX_LISTING }))
              row.fullListing = measure(all, (bars) => registry.computeFor(def, bars, undefined, { ...CTX_LISTING }))
            }
            out.push(row)
            fs.appendFileSync(progress, `${JSON.stringify(row)}\n`)
            // eslint-disable-next-line no-console
            console.log(`[host-worker] ${slug} (${view}): values ${v5.ms} ms${row.objects5000 ? ` objects ${row.objects5000.ms} ms` : ''}${row.stop5000 ? ` stop ${row.stop5000.ms} ms` : ''} clone ${row.cloneMs} ms`)
          } finally {
            registry.uninstallUserDefinition(HARNESS_DEF_ID)
          }
        }
      }
    } finally {
      setRuntimeDoorClock(null)
      __resetHostKnownDivergence()
      __ignoreHostKnownDivergenceForTests()
      __permitRuntimePaneForTests()
      __allowEveryRuntimeScriptForTests()
    }
    fs.writeFileSync(OUT, JSON.stringify({ measuredOn: new Date().toISOString(), node: process.version,
      series: path.relative(REPO, SERIES).replace(/\\/g, '/'), bars5000: N_BARS, barsListing: all.length, rows: out }, null, 1))
    expect(out.length).toBeGreaterThan(0)
  })
})
