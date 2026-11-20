// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.objLinefillEvidence.test.js
//
// ─── ⭐⭐ PARITY UNIT LF step 3 (2026-11-18) — `obj:linefill`'s evidence is DRAWN BY THE RUN ────────────────────────
//
// An `obj:*` registry row counts a capture only when its objects are the RUN's (`objectsLane: "runtime"`,
// `rollout_gate._pine_capability_evidence_counts`). The Python rail (A8) holds every entry's verdict, objects v2
// grade, paired count and x answer to the committed runtime-on snapshot; the LANE is the one claim the snapshot does
// not record. This rail measures it, entry by entry, through the product's own door and binder predicate:
//   · the member door (`memberPaneDefinition`, the runtime pane on) mints a runtime document whose run owns its
//     drawings (`compute.objects`);
//   · on the capture's own bars, the chart draws the RUN's objects (`drawsRunObjectsOn`, the binder's and the
//     harness's one predicate), not the clean host program carried beside them (PARITY UNIT LF step 1);
//   · the run holds exactly the linefills the entry says the grade paired (`objectsPaired`).
// CONTROL: trend-targets-algoalpha SPY 1D 2026-11-15, bound with the symbol alone, where the run holds its drawings
// back by name (`format:tick-unsettled`) and the HOST program draws them: the predicate answers false there, so this
// rail can tell a run-drawn capture from a host-drawn one.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { loadCapture } from './harness'
import * as registry from '../../nativeRegistry'
import { runtimeColumnsFor } from '../../runtime/runtimeColumns'
import { drawsRunObjectsOn, runtimeObjectsOf } from '../../runtime/runtimeObjects'
import { toProductBars } from './ourSide'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList } from '../../runtimeKill'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'

const ROOT = path.resolve(process.cwd(), '..')
const DIR = path.join(ROOT, 'tests/fixtures/vendor/harness')
const ALLOW = JSON.parse(fs.readFileSync(path.join(ROOT, 'api/data/pine_runtime_allowlist.json'), 'utf8'))
const ROW = ALLOW.capabilities['obj:linefill']
const CONTROL = 'trend-targets-algoalpha-spy-1d-2026-11-15'

function lane(fn) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  registry.registerRuntimeLane(runtimeColumnsFor)
  try { return fn() } finally {
    vi.unstubAllEnvs()
    __resetRuntimePanePermission()
    __resetRuntimeAllowList()
  }
}
const symbolOf = (id) => (/-spy-/.test(id) ? { ticker: 'SPY', exchange: 'AMEX' } : { ticker: 'RDDT', exchange: 'NYSE' })

/** The chart's answer for one capture: does it draw the run's objects, and how many linefills does the run hold? */
function runDrawn(id) {
  const loaded = loadCapture(path.join(DIR, `${id}.json`))
  expect(loaded.capture, loaded.reason).toBeTruthy()
  const d = memberPaneDefinition({ source: loaded.capture.source.text, id: `u_lf3-${id.slice(0, 12)}`, name: 'lf3' })
  expect(d.ok, d.reason || '').toBe(true)
  const bars = toProductBars(loaded.capture)
  const cols = registry.computeFor(d.definition, bars, undefined, { tf: 'D', symbol: symbolOf(id), newestBarIsForming: false,
    historyFromListing: !!(loaded.capture.history && loaded.capture.history.startsAtBar0) })
  const run = runtimeObjectsOf(cols)
  return {
    runOwns: d.definition.compute && d.definition.compute.objects === true,
    draws: drawsRunObjectsOn(d.definition, cols),
    linefills: run ? run.live.filter((o) => o.family === 'linefill').length : null,
  }
}

describe('⭐⭐ obj:linefill: every evidence capture is drawn by the run', () => {
  it('the row exists, admitted, and states the run lane for every entry', () => {
    expect(ROW && ROW.admitted).toBe(true)
    expect(ROW.evidence.length).toBeGreaterThanOrEqual(2)
    for (const e of ROW.evidence) expect(e.objectsLane, e.capture).toBe('runtime')
  })
  for (const e of (ROW ? ROW.evidence : [])) {
    it(`${e.capture}: the run owns and draws its drawings, ${e.objectsPaired} linefills`, () => lane(() => {
      const got = runDrawn(e.capture)
      expect(got.runOwns, 'the door minted a run-owned document').toBe(true)
      expect(got.draws, 'the chart draws the RUN\'s objects on this capture').toBe(true)
      expect(got.linefills, 'the run holds the linefills the grade paired').toBe(e.objectsPaired)
    }), 120000)
  }
  it(`CONTROL ${CONTROL}: the run holds back, the host program draws, so the rail answers false`, () => lane(() => {
    const got = runDrawn(CONTROL)
    expect(got.runOwns).toBe(true)
    expect(got.draws).toBe(false)
    expect(ROW.evidence.map((e) => e.capture)).not.toContain(CONTROL)
  }), 120000)
})
