// app/src/components/chart/builder/memberPane/objectsUnitProbe.measure.test.js
//
// ─── ⭐⭐ PARITY UNIT 1 (`objects`) — THE RUNTIME LANE, ASKED OF THE ATTACHED-DIRTY ROWS ──
//
// The parity roadmap (2026-11-18, `docs/pine/PARITY-ROADMAP-2026-11-18.md` U-OBJ) counts 45
// scripts whose ONLY walls are host object-program drops (`object op dropped: …`, a withheld
// paint). The census never offered them to the runtime lane: the host lane ATTACHED them (with a
// dirty object program), so its rows hold no runtime reading (`attachedDirtyWalls`, no `rtProbe`),
// and the census's own door record (`coverageMapDoorCensus.measure.test.js::oneDoor`) carries no
// run half either. This asks the door the questions the census did not, per script:
//
//   prod    the member door as PRODUCTION runs it: objects-only pane armed, runtime pane on,
//           the committed kill list and graded allowlist latched, capability admission ON and the
//           server's verdict for THIS source latched (`latchRuntimeAdmission`, as
//           `runtimeKill.js::requestRuntimeAdmission` would) — the host document, its object loss,
//           and its RUN HALF (`hostPartialRunHalf`): minted, or declined by code
//   grant   the same door with the test grant (every script graded): the upper bound, so a wall
//           behind admission is still named
//   bind    each minted run half BOUND on the reference capture's bars (RDDT 1D from the listing,
//           the census's own `BOUND_REFERENCE`), as the binder binds it (`registry.computeFor`):
//           served, or refused by code (`nativeRegistry.js::withRunHalf`)
//   build   the drawing build alone (`probeRuntimeProgram(source, {objectsInRun: true})`): its
//           refusal's guard, line and token, or its counts
//
// Nothing here decides what is supported: it records what the door answered. Parity is the
// vendor harness's question (`vendorHarness.corpus.test.js`), never this file's.
//
// ⛔ OPT-IN, NEVER AN ORDINARY RUN. The sources are the local sample cache's (licence-held
// reference and built-in scripts never leave this machine): the input names local paths, the
// output carries keys, hashes, codes and line numbers only — never a source line.
//   cd app && OBJECTS_PROBE_IN=<in.json> OBJECTS_PROBE_OUT=<out.json> \
//     node node_modules/vitest/vitest.mjs run \
//     src/components/chart/builder/memberPane/objectsUnitProbe.measure.test.js --maxWorkers=1
// `in.json`: `{rows: [{key, path, hash, verdict: {admitted, historyOnly}}], killList, allowList}`,
// written from the committed registry by `tools/pine_coverage/objects_probe.py input`.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { memberPaneDefinition } from './memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'
import { assessObjectLoss } from '../../engine/ast/objectLoss'
import { probeRuntimeProgram, runtimeColumnsFor } from '../../engine/runtime/runtimeColumns'
import { runHalfOf, carriesRunHalf, runtimeObjectsOf, runtimeObjectsWithheldOf } from '../../engine/runtime/runtimeObjects'
import { __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import {
  __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList, setRuntimeAllowList, setRuntimeKillList,
  setRuntimeCapabilityAdmission, latchRuntimeAdmission, __resetRuntimeAdmission, runtimeSourceHash,
} from '../../engine/runtimeKill'
import { loadCapture } from '../../engine/__tests__/vendorHarness/harness.js'
import { toProductBars } from '../../engine/__tests__/vendorHarness/ourSide.js'

const IN = process.env.OBJECTS_PROBE_IN
const OUT = process.env.OBJECTS_PROBE_OUT
const RUN = !!(IN && OUT)
const DEF_ID = 'u_objects-probe'
const short = (s, n = 240) => (s == null ? null : String(s).slice(0, n))

afterEach(() => { vi.unstubAllEnvs() })

const REFERENCE = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness/k-clustering-rddt-1d-2026-09-28.json')
const CTX = Object.freeze({
  tf: 'D', symbol: Object.freeze({ ticker: 'RDDT', exchange: 'NYSE' }), newestBarIsForming: false, historyFromListing: true,
})
let bars = null
const referenceBars = () => { if (!bars) bars = toProductBars(loadCapture(REFERENCE).capture); return bars }

/** The guard behind each dropped op, identifiers only: the census's own cut
 *  (`coverageMapDoorCensus.measure.test.js::dropHeads`; a test file is not imported, its
 *  suites would run here). `<op>@<line>: <guard>`. */
function dropHeads(diag) {
  const d = diag || {}
  const outv = []
  for (const e of d.guardRefusals || []) outv.push(short(String(e), 120))
  for (const e of d.createDropWhy || []) {
    const m = /^create (\w+)@([\d?]+) [^:]*: (\S+)/.exec(String(e))
    if (m) outv.push(`create:${m[1]}@${m[2]}: ${m[3] === 'no' ? 'unrecorded' : m[3]}`)
  }
  for (const e of d.cellTextWhy || []) {
    const m = /^cell@([\d?]+): (\S+)/.exec(String(e))
    if (m) outv.push(`cell:text@${m[1]}: ${m[2] === 'no' ? 'unrecorded' : m[2]}`)
  }
  for (const e of d.guardPartial || []) {
    const m = /^\w+@([\d?]+): (\S+)/.exec(String(e))
    if (m) outv.push(`partial@${m[1]}: ${m[2] === 'refused' ? 'unrecorded' : m[2]}`)
  }
  return [...new Set(outv)].slice(0, 60)
}

/** The lane flags production runs (objects-only armed, runtime pane on for this member). */
function armPane() {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
}

/** PRODUCTION's lists and this source's admission verdict, latched as the page latches them. */
function productionLists(input, row, source) {
  __resetRuntimeAllowList()
  __resetRuntimeAdmission()
  setRuntimeKillList(input.killList || [])
  setRuntimeAllowList(input.allowList || [])
  setRuntimeCapabilityAdmission(true)
  // ⚠️ under the hash of the text AS THE DOOR READS IT (a CRLF checkout hashes otherwise than the input's
  // universal-newline hash; latched under that one, the door found no verdict: the first cut's defect)
  latchRuntimeAdmission(runtimeSourceHash(source), row.verdict)
}

function grantLists(input) {
  __resetRuntimeAdmission()
  setRuntimeKillList(input.killList || [])
  __allowEveryRuntimeScriptForTests()
}

function doorOf(source) {
  let d
  try { d = memberPaneDefinition({ source, id: DEF_ID, name: 'objects probe' }) } catch (err) {
    return { d: null, row: { threw: short((err && err.message) || err) } }
  }
  const t = d.translation || {}
  let loss = null
  try { loss = assessObjectLoss(t) } catch { loss = null }
  const diag = t.objectDiagnostics || {}
  const paints = ((t.presentation || {}).paints || []).filter(Boolean)
  return {
    d,
    row: {
      ok: !!d.ok,
      lane: d.lane || (d.ok ? 'host' : null),
      guard: d.guard || null,
      reason: d.ok ? null : short(d.reason),
      runtimeDeclined: d.runtimeDeclined ? { code: d.runtimeDeclined.code, why: short(d.runtimeDeclined.why) } : null,
      lossVerdict: loss ? loss.verdict : null,
      attemptedOps: diag.attemptedOps || 0,
      droppedOps: diag.droppedOps || 0,
      dropReasons: diag.dropReasons || {},
      dropHeads: dropHeads(diag),
      paintsWithheld: paints.filter((p) => p.withheld).map((p) => ({ kind: p.kind,
        code: (p.withheld && p.withheld.code) || null, line: Number.isInteger(p.line) ? p.line : null })),
      drawsObjects: !!(d.definition && d.definition.objects),
      runHalf: d.runHalf ? 'minted' : null,
      runHalfDeclined: d.runHalfDeclined ? { code: d.runHalfDeclined.code, why: short(d.runHalfDeclined.why) } : null,
      costRoute: d.costRoute ? { moved: !!d.costRoute.moved, code: d.costRoute.code || null } : null,
      ownObjects: !!(d.definition && d.definition.compute && d.definition.compute.objects === true),
    },
  }
}

/** One bind of the door's document on the reference bars, the binder's own call: a run half's state (and,
 *  served, the drawings it draws, counts by family), or a runtime document's column errors and the drawings
 *  its run kept (counts by family) or withheld. */
function bindRunHalf(d) {
  const runtimeDoc = !!(d && d.ok && d.definition && d.definition.compute && d.definition.compute.kind === 'runtime')
  if (!d || !d.ok || !(carriesRunHalf(d.definition) || runtimeDoc)) return null
  const { installed, errors } = registry.installUserDefinitions([d.definition])
  if (!installed.length) return { installed: false, why: short(errors.join(' | ')) }
  try {
    const cols = registry.computeFor(installed[0], referenceBars(), undefined, CTX)
    if (cols && typeof cols.then === 'function') return { state: 'async' }
    if (runtimeDoc) {
      const errs = Object.entries(registry.columnErrors(cols) || {}).map(([k, e]) => `${k}:${(e && (e.guard || e.status)) || 'error'}`)
      const objs = runtimeObjectsOf(cols)
      const fam = {}
      for (const o of (objs && objs.live) || []) fam[o.family] = (fam[o.family] || 0) + 1
      return { runtime: true, columnErrors: errs.slice(0, 12), objects: objs ? fam : null,
        objectsWithheld: runtimeObjectsWithheldOf(cols), withheldFamilies: objs && objs.withheld ? Object.keys(objs.withheld) : [] }
    }
    const half = runHalfOf(cols)
    if (!half) return { state: null }
    const objs = half.state === 'served' ? runtimeObjectsOf(cols) : null
    const fam = {}
    for (const o of (objs && objs.live) || []) fam[o.family] = (fam[o.family] || 0) + 1
    return { state: half.state, code: half.code || null, why: short(half.why || half.reason || null),
      ...(objs ? { objects: fam } : {}) }
  } catch (err) {
    return { threw: short((err && err.message) || err) }
  } finally {
    try { registry.uninstallUserDefinition(DEF_ID) } catch { /* nothing installed */ }
  }
}

function buildOf(source) {
  try {
    const p = probeRuntimeProgram(source, { objectsInRun: true })
    if (!p.ok) {
      const r = p.refusal || {}
      return { ok: false, guard: r.guard || null, line: Number.isInteger(r.line) ? r.line : null,
        token: r.token != null ? short(r.token, 80) : null, message: short(r.message) }
    }
    return { ok: true, objectOps: p.objectOps || 0, requests: p.requests || 0, naTests: p.naTests || 0,
      broker: !!p.broker, outputs: (p.outputs || []).length,
      requestTargets: (p.requestTargets || []).map((x) => (x ? { ticker: x.ticker || null, tf: x.tf || x.timeframe || null } : null)) }
  } catch (err) {
    return { ok: false, guard: 'probe:threw', message: short((err && err.message) || err) }
  }
}

describe.skipIf(!RUN)('objects unit: the runtime lane asked of the attached-dirty rows', () => {
  it('answers every input script', () => {
    const input = JSON.parse(fs.readFileSync(IN, 'utf8'))
    // the lane a chart loads once a run exists (`runtimeAsync.js::ensureRuntimeLane`); here, in
    // process: no worker, the run computed where it is asked (the rs run-half rails' own call)
    registry.registerRuntimeLane(runtimeColumnsFor)
    const out = []
    for (const row of input.rows) {
      const source = fs.readFileSync(row.path, 'utf8')
      const lane = (lists) => {
        armPane()
        lists()
        const a = doorOf(source)
        const bind = bindRunHalf(a.d)
        vi.unstubAllEnvs()
        return { ...a.row, bind }
      }
      out.push({ key: row.key, unit: row.unit, hash: row.hash, admitted: row.verdict.admitted, missing: row.missing,
        // the door (unchanged by this unit) and its run half bound by the rail of the tree it runs on (the
        // lost-drawings rule, or master's for the BEFORE column), production's lists and the grant
        prod: lane(() => productionLists(input, row, source)),
        grant: lane(() => grantLists(input)),
        build: buildOf(source) })
    }
    fs.writeFileSync(OUT, JSON.stringify({ engineFile: 'scriptEngineVersion.js', rows: out }, null, 1))
    expect(out.length).toBe(input.rows.length)
  }, 3600 * 1000)
})
