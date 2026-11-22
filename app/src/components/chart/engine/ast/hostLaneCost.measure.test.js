// app/src/components/chart/engine/ast/hostLaneCost.measure.test.js
//
// ─── THE HOST LANE'S COST, AND THE SAME SCRIPTS ON THE RUNTIME LANE (opt-in) ────────────────────
//
// Measurement only (docs/pine/evidence/2026-11-17-host-lane-cost/EVIDENCE.md). For every committed
// script (`corpus/committed/*.pine`) the member door installs on the HOST lane,
// this times `computeFor` on that document, then asks the SAME door for the runtime lane's
// document of the same script and times that, and compares the two lanes output by output.
//
//   cd app && HOST_LANE_COST_OUT=<file.json> [HOST_LANE_COST_ONLY=<slug,slug>] \
//     node node_modules/vitest/vitest.mjs run \
//     src/components/chart/engine/ast/hostLaneCost.measure.test.js --maxWorkers=1
//
// ⭐ THE MEMBER'S VIEW, NOT THE TEST HOST'S: `src/test-setup.js` permits the runtime pane, grades
// every script and ignores the host known-divergence list. The host pass is what the door served a member
// for a host-accepted script before the cost route (it asks the host lane first, whatever the stage): it
// runs with the runtime pane OFF and the committed
// known-divergence list ON, which is the door a member walks through.
//
// ⭐ THE RUNTIME PASS FORCES THE DOOR'S OWN RUNTIME ROUTE for one script at a time: the script's
// hash is the only entry of a synthetic known-divergence list, so the door refuses it on the host
// lane BY NAME and offers it to the runtime lane exactly as it offers every host refusal
// (`memberPaneDefinition.js`, `routed: false`). Its decline codes are the door's own. The runtime
// lane is timed with the door clock pinned (`setRuntimeDoorClock`, as the vendor harness does), so
// a run longer than `RUNTIME_PANE_TIME_BUDGET_MS` is read as its true cost and flagged, not stopped.
//
// ⭐ TWO BAR SETS, BOTH REAL: the newest 5,000 daily bars of the AAPL capture (the compute-caps
// evidence's frame), and the whole capture from AAPL's listing day (11,534 bars,
// `historyFromListing: true`), which is what a member's standalone daily chart computes over once
// its deep history lands (`StockChart._deepFirstPaint`, `fullBarsFor('D')` = 12,500).
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import * as registry from '../nativeRegistry'
import { enterMemberDoor, HARNESS_DEF_ID } from '../__tests__/vendorHarness/ourSide'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList, runtimeSourceHash } from '../runtimeKill'
import {
  __setHostKnownDivergenceForTests, __resetHostKnownDivergence, __ignoreHostKnownDivergenceForTests,
} from '../hostKnownDivergence'
import { setRuntimeDoorClock, RUNTIME_PANE_TIME_BUDGET_MS } from '../runtime/runtimeColumns'
import { parityOf } from '../../builder/memberPane/costRouteParity'

const OUT = process.env.HOST_LANE_COST_OUT
const ONLY = process.env.HOST_LANE_COST_ONLY ? new Set(process.env.HOST_LANE_COST_ONLY.split(',')) : null
/** A host document cheaper than this at 5,000 bars is not asked of the runtime lane. */
const DEEP_FROM_MS = Number(process.env.HOST_LANE_COST_DEEP_FROM_MS || 50)
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
    let result = null
    let error = null
    try { result = run(bars) } catch (e) { error = String((e && e.message) || e).slice(0, 200) }
    return { ms: performance.now() - t0, result, error }
  }
  const first = once()
  if (first.error) return { ms: Number(first.ms.toFixed(1)), runs: 1, error: first.error, result: null }
  if (first.ms > SLOW_MS) return { ms: Number(first.ms.toFixed(1)), runs: 1, firstMs: Number(first.ms.toFixed(1)), result: first.result }
  const times = []
  let last = first
  for (let k = 0; k < 3; k += 1) { last = once(); times.push(last.ms) }
  times.sort((a, b) => a - b)
  return { ms: Number(times[1].toFixed(1)), runs: 3, firstMs: Number(first.ms.toFixed(1)), result: last.result }
}

const hostView = () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '0')
  __resetRuntimePanePermission()
  __resetRuntimeAllowList()
  __resetHostKnownDivergence()
}
const runtimeViewFor = (source, slug) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  __setHostKnownDivergenceForTests({ scripts: [{ sha256: runtimeSourceHash(source), slug, reason: 'measured on the runtime lane' }] })
}

const ESTIMATE_OUT = process.env.HOST_LANE_COST_ESTIMATE_OUT

describe.skipIf(!ESTIMATE_OUT)('the static recurrence estimate of every host document (opt-in, no compute)', () => {
  it('records recurrenceStepsPerBar per document, summed per tree and over the union', async () => {
    const { recurrenceStepsPerBar } = await import('./interpret')
    const corpus = path.join(REPO, 'corpus', 'committed')
    const files = fs.readdirSync(corpus).filter((f) => f.endsWith('.pine')).sort()
    const out = []
    try {
      for (const f of files) {
        const slug = f.replace(/\.pine$/, '')
        if (ONLY && !ONLY.has(slug)) continue
        const source = fs.readFileSync(path.join(corpus, f), 'utf8')
        hostView()
        let door
        try { door = enterMemberDoor(source) } catch { registry.uninstallUserDefinition(HARNESS_DEF_ID); continue }
        try {
          const doc = door.built && door.built.definition
          if (!door.def || !doc || !doc.compute || doc.compute.kind !== 'ast') continue
          const trees = doc.compute.trees ? Object.values(doc.compute.trees) : [doc.compute.ast]
          let perTree = 0
          for (const t of trees) perTree += recurrenceStepsPerBar(t)
          const union = recurrenceStepsPerBar({ type: 'op', name: '+', args: trees })
          out.push({ file: slug, trees: trees.length, perTree, union })
        } finally {
          registry.uninstallUserDefinition(HARNESS_DEF_ID)
        }
      }
    } finally {
      __resetHostKnownDivergence()
      __ignoreHostKnownDivergenceForTests()
      __permitRuntimePaneForTests()
      __allowEveryRuntimeScriptForTests()
    }
    fs.writeFileSync(ESTIMATE_OUT, JSON.stringify(out, null, 1))
    expect(out.length).toBeGreaterThan(0)
  })
})

const ROWS_OUT = process.env.HOST_LANE_COST_ROWS_OUT

/** What a document draws: its visible plots (by translation output), fills, paints and objects. */
function drawnOf(built) {
  const def = built && built.definition
  const plots = (def && def.plots) || []
  const outIndex = new Map()
  for (const [index, o] of ((built.translation && built.translation.outputs) || []).entries()) {
    if (o && o.ast) outIndex.set(o.ast, index)
  }
  const rowOutput = new Map((built.rows || []).map((r) => [r.key, Number.isInteger(r.output) ? r.output : outIndex.get(r.ast)]))
  return {
    visible: plots.filter((p) => p && !p.hidden && !p.fill && p.style !== 'hlines').map((p) => ({ key: p.key, title: p.title || null, output: rowOutput.get(p.key) ?? null, style: p.style || null })),
    hidden: plots.filter((p) => p && p.hidden).length,
    fills: plots.filter((p) => p && p.fill).length,
    hlines: plots.filter((p) => p && p.style === 'hlines').length,
    paints: ((def && def.paints) || []).length,
    objects: !!(def && def.objects && (def.objects.ops || []).length),
    notes: (built.notes || []).map((n) => String(n).slice(0, 160)),
  }
}

describe.skipIf(!ROWS_OUT)('what each lane draws for the same script (opt-in, no compute)', () => {
  it('records the host and runtime documents row by row', () => {
    const corpus = path.join(REPO, 'corpus', 'committed')
    const out = []
    try {
      for (const slug of [...(ONLY || [])]) {
        const source = fs.readFileSync(path.join(corpus, `${slug}.pine`), 'utf8')
        hostView()
        const h = enterMemberDoor(source)
        registry.uninstallUserDefinition(HARNESS_DEF_ID)
        runtimeViewFor(source, slug)
        const r = enterMemberDoor(source)
        registry.uninstallUserDefinition(HARNESS_DEF_ID)
        out.push({ file: slug, host: h.built && h.built.ok ? drawnOf(h.built) : { refusal: h.refusal },
          runtime: r.built && r.built.ok ? drawnOf(r.built) : { refusal: r.refusal } })
      }
    } finally {
      __resetHostKnownDivergence()
      __ignoreHostKnownDivergenceForTests()
      __permitRuntimePaneForTests()
      __allowEveryRuntimeScriptForTests()
    }
    fs.writeFileSync(ROWS_OUT, JSON.stringify(out, null, 1))
    expect(out.length).toBeGreaterThan(0)
  })
})

describe.skipIf(!OUT)('the host lane cost, and the same scripts on the runtime lane (opt-in)', () => {
  it('times every host document a member is served, and its runtime-lane twin', () => {
    const cap = JSON.parse(fs.readFileSync(SERIES, 'utf8'))
    const all = cap.bars.rows
    const rows5k = all.slice(-N_BARS)
    expect(rows5k.length).toBe(N_BARS)
    expect(all.length).toBeGreaterThan(N_BARS)
    const progress = `${OUT}.progress.jsonl`
    const corpus = path.join(REPO, 'corpus', 'committed')
    const files = fs.readdirSync(corpus).filter((f) => f.endsWith('.pine')).sort()
    expect(files.length).toBeGreaterThan(200)
    const out = []
    setRuntimeDoorClock(() => 0)
    try {
      for (const f of files) {
        const slug = f.replace(/\.pine$/, '')
        if (ONLY && !ONLY.has(slug)) continue
        const source = fs.readFileSync(path.join(corpus, f), 'utf8')
        // ── the host lane, as a member gets it ──
        hostView()
        let door
        try { door = enterMemberDoor(source) } catch { registry.uninstallUserDefinition(HARNESS_DEF_ID); continue }
        const hostBuilt = door.built
        const hostDoc = hostBuilt && hostBuilt.definition
        if (!door.def || !hostDoc || !hostDoc.compute || hostDoc.compute.kind !== 'ast') {
          registry.uninstallUserDefinition(HARNESS_DEF_ID)
          continue
        }
        const row = { file: slug, sha12: runtimeSourceHash(source).slice(0, 12), bars5000: N_BARS, barsListing: all.length }
        let host5k
        try {
          host5k = measure(rows5k, (bars) => registry.computeFor(door.def, bars, undefined, { ...CTX_5000 }))
          row.host5000 = { ms: host5k.ms, runs: host5k.runs, firstMs: host5k.firstMs, error: host5k.error || null }
          if (host5k.ms >= DEEP_FROM_MS) {
            const hl = measure(all, (bars) => registry.computeFor(door.def, bars, undefined, { ...CTX_LISTING }))
            row.hostListing = { ms: hl.ms, runs: hl.runs, firstMs: hl.firstMs, error: hl.error || null }
          }
        } finally {
          registry.uninstallUserDefinition(HARNESS_DEF_ID)
        }
        // ── the same script on the runtime lane, through the same door ──
        if (host5k.ms >= DEEP_FROM_MS) {
          runtimeViewFor(source, slug)
          let rdoor
          try {
            rdoor = enterMemberDoor(source)
          } catch (e) {
            registry.uninstallUserDefinition(HARNESS_DEF_ID)
            row.runtime = { threw: String((e && e.message) || e).slice(0, 200) }
          }
          if (rdoor) {
            try {
              const rb = rdoor.built
              row.runtime = {
                lane: rb && rb.ok ? (rb.lane || (rb.definition && rb.definition.compute && rb.definition.compute.kind)) : null,
                declined: rb && rb.runtimeDeclined ? rb.runtimeDeclined.code : null,
                declinedWhy: rb && rb.runtimeDeclined ? String(rb.runtimeDeclined.why || '').slice(0, 200) : null,
                refusal: rdoor.refusal ? rdoor.refusal.slice(0, 200) : null,
              }
              if (rdoor.def && row.runtime.lane === 'runtime') {
                const r5 = measure(rows5k, (bars) => registry.computeFor(rdoor.def, bars, undefined, { ...CTX_5000 }))
                const e5 = registry.columnErrors(r5.result || {})
                row.runtime.r5000 = { ms: r5.ms, runs: r5.runs, firstMs: r5.firstMs, error: r5.error || null,
                  overBudget: r5.ms > RUNTIME_PANE_TIME_BUDGET_MS,
                  guards: e5 && Object.keys(e5).length ? [...new Set(Object.values(e5).map((v) => v && v.guard))] : null }
                const rl = measure(all, (bars) => registry.computeFor(rdoor.def, bars, undefined, { ...CTX_LISTING }))
                const el = registry.columnErrors(rl.result || {})
                row.runtime.rListing = { ms: rl.ms, runs: rl.runs, firstMs: rl.firstMs, error: rl.error || null,
                  overBudget: rl.ms > RUNTIME_PANE_TIME_BUDGET_MS,
                  guards: el && Object.keys(el).length ? [...new Set(Object.values(el).map((v) => v && v.guard))] : null }
                // ── parity, on both bar sets: host columns (a fresh host door) vs these runtime columns ──
                registry.uninstallUserDefinition(HARNESS_DEF_ID)
                const bars = freshBars(rows5k)
                const barsAll = freshBars(all)
                const runCols = registry.computeFor(rdoor.def, bars, undefined, { ...CTX_5000 })
                const runColsAll = registry.computeFor(rdoor.def, barsAll, undefined, { ...CTX_LISTING })
                hostView()
                const hdoor = enterMemberDoor(source)
                try {
                  const hostCols = registry.computeFor(hdoor.def, bars, undefined, { ...CTX_5000 })
                  row.parity5000 = parityOf(hdoor.built, hostCols, rb, runCols)
                  const hostColsAll = registry.computeFor(hdoor.def, barsAll, undefined, { ...CTX_LISTING })
                  row.parityListing = parityOf(hdoor.built, hostColsAll, rb, runColsAll)
                } finally {
                  registry.uninstallUserDefinition(HARNESS_DEF_ID)
                }
              }
            } finally {
              registry.uninstallUserDefinition(HARNESS_DEF_ID)
            }
          }
        }
        out.push(row)
        fs.appendFileSync(progress, `${JSON.stringify(row)}\n`)
        // eslint-disable-next-line no-console
        console.log(`[host-lane-cost] ${slug}: host ${row.host5000.ms} ms${row.hostListing ? ` / listing ${row.hostListing.ms} ms` : ''}`
          + `${row.runtime ? ` | runtime ${row.runtime.lane || row.runtime.declined || 'declined'}`
            + `${row.runtime.r5000 ? ` ${row.runtime.r5000.ms} ms / listing ${row.runtime.rListing.ms} ms` : ''}` : ''}`)
      }
    } finally {
      setRuntimeDoorClock(null)
      __resetHostKnownDivergence()
      __ignoreHostKnownDivergenceForTests()
      __permitRuntimePaneForTests()
      __allowEveryRuntimeScriptForTests()
    }
    const ms = out.map((r) => r.host5000.ms).sort((a, b) => a - b)
    const q = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))]
    fs.writeFileSync(OUT, JSON.stringify({
      measuredOn: new Date().toISOString(), node: process.version, series: path.relative(REPO, SERIES).replace(/\\/g, '/'),
      bars5000: N_BARS, barsListing: all.length, deepFromMs: DEEP_FROM_MS, runtimeBudgetMs: RUNTIME_PANE_TIME_BUDGET_MS,
      hostSummary: { scripts: out.length, medianMs: q(0.5), p90Ms: q(0.9), maxMs: ms[ms.length - 1],
        over50: ms.filter((x) => x > 50).length, over1000: ms.filter((x) => x > 1000).length },
      rows: out,
    }, null, 1))
    expect(out.length).toBeGreaterThan(0) // non-vacuity: the host lane served something
  })
})
