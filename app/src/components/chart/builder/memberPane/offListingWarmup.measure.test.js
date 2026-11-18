// app/src/components/chart/builder/memberPane/offListingWarmup.measure.test.js
//
// ─── ⭐⭐ PARITY UNIT 1 (`objects`) — THE OFF-LISTING WARM-UP GAP, MEASURED PER SCRIPT ──────────────
//
// The coordinator's second condition (2026-11-18): "Measure, per moved script, on the committed off-listing
// captures, which plot bars the host draws that the run leaves blank." The run of a script is told it starts
// at the listing (`runtimeHistory: 'listing'`); off the listing (`history.startsAtBar0` false: an SPY 1D chart
// whose history starts after 1993) it withholds its warm-up bars (`runtimeObjects.js::runtimeWarmupOf`) where
// the host formula draws its bounded window. For every script the unit draws differently and every committed
// capture of it, this records, per visible plot:
//   host      the bars the HOST document draws (a finite value);
//   pane      of those, the bars the chart PANE leaves blank with the run half bound (its plots are the host's
//             columns: 0 by construction, measured, not assumed);
//   run       of those, the bars the RUN leaves blank (what a runtime document, the unit's first cut, drew);
// and the run half's answer on that capture (`served` / `refused` by code).
//
// ⛔ OPT-IN, NEVER AN ORDINARY RUN (8,507-bar captures through the per-bar run):
//   cd app && OFFLISTING_OUT=<out.json> node node_modules/vitest/vitest.mjs run \
//     src/components/chart/builder/memberPane/offListingWarmup.measure.test.js --maxWorkers=1
// Committed scripts and committed captures only; the output carries keys, counts and codes.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { memberPaneDefinition, RUN_HALF_SOURCE_STAMP } from './memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'
import { RUN_HALF_DRAWING_SENTENCE } from '../../engine/ast/objectLoss'
import { runHalfOf, runtimeWarmupOf, runtimeObjectsOf } from '../../engine/runtime/runtimeObjects'
import { runtimeColumnsFor, setRuntimeDoorClock } from '../../engine/runtime/runtimeColumns'
import { __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../engine/runtimeKill'

const OUT = process.env.OFFLISTING_OUT
const REPO = path.resolve(__dirname, '../../../../../..')
const HARNESS = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness')
const SCRIPTS = [
  ['committed:atr-support-and-resistance', 'corpus/committed/atr-support-and-resistance__3e9ddb38c4.pine', 'atr-support-and-resistance-'],
  ['committed:atr-trailing-stop-by-ceyhun', 'corpus/committed/atr-trailing-stop-by-ceyhun__UMldb6tGLd.pine', 'atr-trailing-stop-by-ceyhun-'],
  ['committed:volume-profile', 'corpus/committed/volume-profile__X0dKLxdLh4.pine', 'volume-profile-rddt-', 'volume-profile-spy-'],
  ['committed:vdubus-pattern-gen-v2-restored-refined', 'corpus/committed/vdubus-pattern-gen-v2-restored-refined__66dc68412e.pine', 'vdubus-pattern-gen-v2-restored-refined-'],
  ['probe:vw-w3n-draw-block-history-a', 'tools/visual_conformance/probes/vw-w3n-draw-block-history-a.pine', 'vw-w3n-draw-block-history-a-'],
  ['probe:vw-w3n-draw-block-history-b', 'tools/visual_conformance/probes/vw-w3n-draw-block-history-b.pine', 'vw-w3n-draw-block-history-b-'],
  ['probe:vw-w3n-draw-block-history-c', 'tools/visual_conformance/probes/vw-w3n-draw-block-history-c.pine', 'vw-w3n-draw-block-history-c-'],
]
const SYMBOL = { rddt: { ticker: 'RDDT', exchange: 'NYSE' }, spy: { ticker: 'SPY', exchange: 'AMEX' } }
const barsOf = (rows) => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const fin = (x) => typeof x === 'number' && Number.isFinite(x)

function withoutRunHalf(def) {
  const compute = { ...def.compute }
  delete compute.runtimeObjects
  const meta = { ...(def.meta || {}) }
  delete meta[RUN_HALF_SOURCE_STAMP]
  if (Array.isArray(meta.disclosures)) {
    meta.disclosures = meta.disclosures.map((n) => (n && typeof n.note === 'string' && n.note.endsWith(` ${RUN_HALF_DRAWING_SENTENCE}`)
      ? { ...n, note: n.note.slice(0, -(RUN_HALF_DRAWING_SENTENCE.length + 1)) } : n))
  }
  return { ...def, compute, meta }
}
/** The run's own document, as the bind hands it (`nativeRegistry.js::runHalfDefOf`, at the defaults). */
function runDefOf(def) {
  const ro = def.compute.runtimeObjects
  const meta = { runtimeHistory: 'listing' }
  for (const k of ['runtimeLanguage', 'runtimeFrontend', 'runtimeIr', 'runtimeOutputSignature']) if (ro[k] !== undefined) meta[k] = ro[k]
  return { id: `${def.id}~run`, compute: { kind: 'runtime', fn: `runtime:${def.id}~run`, rev: 1, source: ro.source,
    outputs: { ...(ro.outputs || {}) }, objects: true }, meta }
}

describe.skipIf(!OUT)('the off-listing warm-up gap, per script, on the committed captures', () => {
  it('measures every committed capture of every script the unit draws differently', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
    registry.registerRuntimeLane(runtimeColumnsFor)
    setRuntimeDoorClock(() => 0)
    const files = fs.readdirSync(HARNESS)
    const out = []
    for (const [key, rel, ...prefixes] of SCRIPTS) {
      const source = fs.readFileSync(path.join(REPO, rel), 'utf8')
      const d = memberPaneDefinition({ source, id: 'u_offlisting', name: 'offlisting' })
      const def = d.ok ? d.definition : null
      const row = { key, runHalf: d.runHalf ? 'minted' : (d.runHalfDeclined ? `declined:${d.runHalfDeclined.code}` : null), captures: [] }
      for (const f of files.filter((x) => prefixes.some((p) => x.startsWith(p)) && x.endsWith('.json')).sort()) {
        const cap = JSON.parse(fs.readFileSync(path.join(HARNESS, f), 'utf8'))
        const sym = SYMBOL[(/-(rddt|spy)-/.exec(f) || [])[1]]
        const ctx = { tf: 'D', newestBarIsForming: false, symbol: sym,
          historyFromListing: !!(cap.history && cap.history.startsAtBar0 === true) }
        const bars = barsOf(cap.bars.rows)
        const rec = { capture: f, offListing: !ctx.historyFromListing, bars: bars.length, plots: [] }
        if (def) {
          const pane = registry.computeFor(def, bars, undefined, ctx)
          const host = registry.computeFor(withoutRunHalf(def), bars, undefined, ctx)
          const half = runHalfOf(pane)
          rec.runHalf = half ? { state: half.state, code: half.code || null } : null
          if (half && half.state === 'served') {
            const fam = {}
            for (const o of runtimeObjectsOf(pane).live) fam[o.family] = (fam[o.family] || 0) + 1
            rec.runHalf.objects = fam
          }
          let run = null
          if (def.compute.runtimeObjects) {
            try { run = runtimeColumnsFor(runDefOf(def), bars, {}, ctx) } catch (err) { rec.runThrew = String((err && err.message) || err).slice(0, 200) }
            const warm = run ? runtimeWarmupOf(run) : null
            rec.runWarmupWithheld = warm && Number.isInteger(warm.withheldBars) ? warm.withheldBars : 0
          }
          const outputs = (def.compute.runtimeObjects && def.compute.runtimeObjects.outputs) || {}
          for (const p of def.plots || []) {
            if (!p || typeof p.key !== 'string' || p.style === 'hlines' || p.hidden) continue
            const h = host[p.key]
            if (!h || typeof h.length !== 'number') continue
            const pc = pane[p.key]
            const rc = run && Object.prototype.hasOwnProperty.call(outputs, p.key) ? run[p.key] : null
            let hostDrawn = 0; let paneBlank = 0; let runBlank = 0; let firstRunBlank = null; let lastRunBlank = null
            for (let i = 0; i < h.length; i += 1) {
              if (!fin(h[i])) continue
              hostDrawn += 1
              if (!(pc && fin(pc[i]))) paneBlank += 1
              if (rc && !fin(rc[i])) {
                runBlank += 1
                if (firstRunBlank === null) firstRunBlank = i
                lastRunBlank = i
              }
            }
            rec.plots.push({ key: p.key, title: p.title || null, host: hostDrawn, paneBlank,
              runBlank: rc ? runBlank : null, runBlankBars: rc && runBlank ? [firstRunBlank, lastRunBlank] : null })
          }
        }
        row.captures.push(rec)
      }
      out.push(row)
    }
    setRuntimeDoorClock(null)
    fs.writeFileSync(OUT, JSON.stringify({ rows: out }, null, 1))
    expect(out.length).toBe(SCRIPTS.length)
  }, 3600 * 1000)
})
