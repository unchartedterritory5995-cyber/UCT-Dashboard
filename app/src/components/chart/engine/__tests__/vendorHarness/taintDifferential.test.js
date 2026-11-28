// app/src/components/chart/engine/__tests__/vendorHarness/taintDifferential.test.js
//
// ─── START-TAINT PART 2: THE TAINT RUN NEVER CHANGES A VALUE — bit for bit, over the runtime corpus ────────────────
//
// `vmTaint.js::executeTainted` carries a tag beside every value; it must compute exactly `vm.js::execute`'s values,
// or the run whose values an off-listing chart is served from (part 6) is not the run the tags describe. This rail
// runs every committed corpus script the member door puts on the RUNTIME lane (and each host document's run half),
// through the product's own `computeRuntimeColumns`, on a real capture, with `execute` wrapped: each top-level run is
// made a second time by `executeTainted` over the same program and bars, and every output bar, every iteration
// buffer cell and the object store's final state must be identical (`Object.is`: an `na` is an `na`, a -0 is a -0).
// A run the taint run does not take (a request's sub-run, a probe, a realtime ledger, an armed broker) is counted by
// name, not compared; every run here starts at bar 0 (each document is run once, in a fresh session).
//
// ⭐ OVERHEAD (opt-in, RUNTIME_PERF_CENSUS=taint): the same corpus on 5,000 bars, each run timed three times on both
// paths (the fastest of each kept), per script and in total, written to remote-out/taint-overhead/.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'

const REC = vi.hoisted(() => ({
  on: false, measure: false, script: '', compared: 0, scripts: new Set(), skipped: {}, mismatches: [],
  timing: {},
}))

vi.mock('../../runtime/vm.js', async (importOriginal) => {
  const real = await importOriginal()
  const now = () => performance.now()
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1 }
  const canon = (v, seen = new Set()) => {
    if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v)
    if (v === null || typeof v !== 'object') return typeof v === 'function' ? '[fn]' : JSON.stringify(v)
    if (seen.has(v)) return '[cycle]'
    seen.add(v)
    const out = v instanceof Map ? `Map{${[...v].map(([k, x]) => `${canon(k, seen)}:${canon(x, seen)}`).join(',')}}`
      : v instanceof Set ? `Set{${[...v].map((x) => canon(x, seen)).join(',')}}`
        : Array.isArray(v) || ArrayBuffer.isView(v) ? `[${Array.from(v, (x) => canon(x, seen)).join(',')}]`
          : `{${Object.keys(v).sort().map((k) => `${k}:${canon(v[k], seen)}`).join(',')}}`
    seen.delete(v)
    return out
  }
  const firstDiff = (a, b) => {
    if (a.length !== b.length) return `length ${a.length} vs ${b.length}`
    for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return `bar ${i}: ${a[i]} vs ${b[i]}`
    return null
  }
  function compareRun(program, ctx, limits, opts, res) {
    const why = opts && opts.entry !== undefined ? 'request sub-run'
      : opts && opts.probe ? 'probe' : opts && opts.realtime ? 'realtime'
        : program.broker && !(opts && opts.brokerDisarmed === true) ? 'broker' : null
    if (why) { bump(REC.skipped, why); return }
    // the taint run's own: a fresh budget from the same limits, its own object store, none of the caller's hooks
    const topts = { taint: {}, ...(opts && opts.now ? { now: opts.now } : {}), ...(opts && opts.brokerDisarmed ? { brokerDisarmed: true } : {}) }
    let tr
    try {
      tr = real.executeTainted(program, ctx, limits, topts)
    } catch (err) {
      REC.mismatches.push(`${REC.script}: the taint run threw where the plain run did not: ${String(err && err.message).slice(0, 160)}`)
      return
    }
    REC.compared += 1
    REC.scripts.add(REC.script)
    for (let k = 0; k < res.outputs.length; k += 1) {
      const d = firstDiff(res.outputs[k], tr.outputs[k])
      if (d) REC.mismatches.push(`${REC.script}: output ${k} differs, ${d}`)
    }
    for (let k = 0; k < res.iters.length; k += 1) {
      const d = firstDiff(res.iters[k], tr.iters[k])
      if (d) REC.mismatches.push(`${REC.script}: iteration buffer ${k} differs, ${d}`)
    }
    // the drawings: the plain run's store (its own, or the one its caller handed it) against the taint run's own
    const ps = res.objects || (opts && opts.objects)
    if (ps && typeof ps.snapshot === 'function' && (!tr.objects || canon(ps.snapshot()) !== canon(tr.objects.snapshot()))) {
      REC.mismatches.push(`${REC.script}: the object store differs`)
    }
    if (REC.measure) {
      // the fastest of three on each path (the first of each is the run above / just made)
      const t = REC.timing[REC.script] || (REC.timing[REC.script] = { plainMs: 0, taintMs: 0, runs: 0, bars: ctx.bars })
      let p = Infinity
      let q = Infinity
      for (let r = 0; r < 3; r += 1) {
        const o1 = { ...(opts && opts.now ? { now: opts.now } : {}), ...(opts && opts.brokerDisarmed ? { brokerDisarmed: true } : {}) }
        const a = now(); real.execute(program, ctx, limits, o1); p = Math.min(p, now() - a)
        const b = now(); real.executeTainted(program, ctx, limits, topts); q = Math.min(q, now() - b)
      }
      t.plainMs += p
      t.taintMs += q
      t.runs += 1
    }
  }
  return {
    ...real,
    execute: (program, ctx, limits, opts) => {
      const res = real.execute(program, ctx, limits, opts)
      if (REC.on) compareRun(program, ctx, limits, opts, res)
      return res
    },
  }
})

import * as registry from '../../nativeRegistry'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'
import { computeRuntimeColumns, resetRuntimeSessions, withMemberDoorClock } from '../../runtime/runtimeColumns'

const MEASURE = process.env.RUNTIME_PERF_CENSUS === 'taint'
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const HARNESS = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness')
const SERIES = { file: 'adx-and-di-for-v4-spy-1d-2026-11-17.json', tf: 'D', ticker: 'SPY', exchange: 'NYSE Arca' }

afterEach(() => { vi.unstubAllEnvs(); REC.on = false })

function corpusRun(bars) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  const cap = JSON.parse(fs.readFileSync(path.join(HARNESS, SERIES.file), 'utf8'))
  const rows = cap.bars.rows.slice(0, bars)   // from the listing: the capture starts there
  const fresh = () => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
  const base = { tf: SERIES.tf, newestBarIsForming: false, symbol: { ticker: SERIES.ticker, exchange: SERIES.exchange },
    historyFromListing: true }
  const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
  const docs = { runtime: 0, runHalves: 0, refused: 0 }
  for (const f of files) {
    const source = fs.readFileSync(path.join(CORPUS, f), 'utf8')
    let door
    try { door = enterMemberDoor(source) } catch { registry.uninstallUserDefinition(HARNESS_DEF_ID); continue }
    try {
      if (!door.def || !door.built) continue
      let def
      const ro = door.def.compute && door.def.compute.runtimeObjects
      if (door.built.lane === 'runtime' && door.def.compute.kind === 'runtime') {
        docs.runtime += 1
        def = door.def
      } else if (ro && typeof ro.source === 'string') {
        docs.runHalves += 1
        def = { id: `${HARNESS_DEF_ID}~run`, compute: { kind: 'runtime', fn: `runtime:${HARNESS_DEF_ID}~run`, source: ro.source,
          objects: true, outputs: ro.outputs }, meta: { runtimeHistory: 'listing', ...(ro.libraries ? { libraries: ro.libraries } : {}) } }
      } else continue
      REC.script = f
      REC.on = true
      try {
        resetRuntimeSessions()
        withMemberDoorClock(() => computeRuntimeColumns(def, fresh(), base))
      } catch { docs.refused += 1 } finally { REC.on = false }
    } finally {
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
      resetRuntimeSessions()
    }
  }
  return docs
}

describe('the taint run computes the plain run\'s values, bit for bit, over the runtime corpus', () => {
  it.skipIf(MEASURE)('SPY 1D, 1,500 bars from the listing: every top-level run of every runtime document', () => {
    const docs = corpusRun(1500)
    // eslint-disable-next-line no-console
    console.log(`taint differential: ${JSON.stringify({ ...docs, compared: REC.compared, scripts: REC.scripts.size,
      skipped: REC.skipped, mismatches: REC.mismatches.length })}\n${REC.mismatches.slice(0, 60).join('\n')}`)
    expect(docs.runtime, 'non-vacuity: the runtime corpus was reached').toBeGreaterThan(20)
    expect(REC.scripts.size, 'non-vacuity: runs were compared on many scripts').toBeGreaterThan(20)
    expect(REC.mismatches).toEqual([])
  }, 1800000)

  it.skipIf(!MEASURE)('OVERHEAD: the taint run against the plain run, 5,000 bars, fastest of three each (opt-in)', () => {
    REC.measure = true
    try { corpusRun(5000) } finally { REC.measure = false }
    const per = Object.entries(REC.timing).map(([script, t]) => ({ script, ...t,
      ratio: t.plainMs > 0 ? +(t.taintMs / t.plainMs).toFixed(2) : null }))
      .sort((a, b) => b.plainMs - a.plainMs)
    const plain = per.reduce((s, t) => s + t.plainMs, 0)
    const taint = per.reduce((s, t) => s + t.taintMs, 0)
    const ratios = per.filter((t) => t.plainMs >= 5).map((t) => t.ratio).sort((a, b) => a - b)
    const out = { series: SERIES.file, bars: 5000, scripts: per.length, totalPlainMs: Math.round(plain), totalTaintMs: Math.round(taint),
      totalRatio: +(taint / plain).toFixed(2), medianRatio: ratios.length ? ratios[Math.floor(ratios.length / 2)] : null,
      maxRatio: ratios.length ? ratios[ratios.length - 1] : null, mismatches: REC.mismatches.length, per }
    const dir = path.join(REPO, 'remote-out', 'taint-overhead')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'overhead.json'), JSON.stringify(out, null, 1))
    // eslint-disable-next-line no-console
    console.log(`taint overhead: ${JSON.stringify({ ...out, per: per.slice(0, 15) })}`)
    expect(per.length).toBeGreaterThan(20)
    expect(REC.mismatches).toEqual([])
  }, 3600000)
})
