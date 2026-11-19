// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.lfRunOwnedDrawings.test.js
//
// ─── ⭐⭐ PARITY UNIT LF (2026-11-18) — A CLEAN HOST PROGRAM'S RUNTIME DOCUMENT, DRAWN BY ITS RUN ────────
//
// `committed:trend-targets-algoalpha` is refused by the host lane (`pine:state`) and drawn by the runtime
// lane; its host object program is CLEAN, so until LF the document's drawings were the HOST program's and its
// objects-v2 MATCH captures said nothing about the run's drawings. Now the run's drawings are the document's
// (`runtimeObjectsDoor.js`, `hostFallback`), and the clean program rides beside them, drawn instead whenever
// the run holds back a family it draws (`runtime/runtimeObjects.js::drawsRunObjectsOn`).
//   · RDDT 1D 2026-11-15: the RUN draws 5 lines, 5 labels and 2 linefills, graded MATCH (objects v1 here; the
//     corpus run's objects v2 is MATCH too);
//   · SPY 1D 2026-11-15, bound with the symbol alone (no tick size): the run stops its drawings by name
//     (`format:tick-unsettled`, a `format.mintick` text no capture settles), so the HOST program draws them,
//     exactly as before LF. Without the fallback that chart would show the run's empty picture.
//   · the grader asks the same predicate (`__objectsReportForTests`): a run that holds back is graded on the
//     host program, never on its own empty picture.
import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'

import { loadCapture, gradeCapture } from './harness'
import * as registry from '../../nativeRegistry'
import { runtimeColumnsFor } from '../../runtime/runtimeColumns'
import { drawsRunObjectsOn, runtimeObjectsOf, withRuntimeObjects } from '../../runtime/runtimeObjects'
import { toProductBars, __objectsReportForTests } from './ourSide'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList } from '../../runtimeKill'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const RDDT = 'trend-targets-algoalpha-rddt-1d-2026-11-15.json'
const SPY = 'trend-targets-algoalpha-spy-1d-2026-11-15.json'

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
const symbolOf = (file) => (/-spy-/.test(file) ? { ticker: 'SPY', exchange: 'AMEX' } : { ticker: 'RDDT', exchange: 'NYSE' })

describe('⭐⭐ trend-targets-algoalpha: the run draws its clean host program\'s drawings', () => {
  for (const [file, runDraws] of [[RDDT, true], [SPY, false]]) {
    it(`${file}: ${runDraws ? 'drawn by the RUN' : 'the run holds back, the HOST program draws'}; graded MATCH`, () => lane(() => {
      const loaded = loadCapture(path.join(DIR, file))
      expect(loaded.capture, loaded.reason).toBeTruthy()
      const d = memberPaneDefinition({ source: loaded.capture.source.text, id: 'u_lf-tt', name: 'lf tt' })
      expect(d.ok, d.reason || '').toBe(true)
      expect(d.definition.compute.kind).toBe('runtime')
      expect(d.definition.compute.objects, 'the run owns the drawings').toBe(true)
      expect(d.definition.objects, 'the clean host program rides beside them').toBeTruthy()
      const bars = toProductBars(loaded.capture)
      const cols = registry.computeFor(d.definition, bars, undefined, { tf: 'D', symbol: symbolOf(file), newestBarIsForming: false,
        historyFromListing: !!(loaded.capture.history && loaded.capture.history.startsAtBar0) })
      expect(drawsRunObjectsOn(d.definition, cols)).toBe(runDraws)
      if (runDraws) {
        const fam = {}
        for (const o of runtimeObjectsOf(cols).live) fam[o.family] = (fam[o.family] || 0) + 1
        expect(fam).toEqual({ line: 5, label: 5, linefill: 2 })
      }
      const { verdict } = gradeCapture(loaded.capture)
      expect(verdict.verdict, verdict.reason).toBe('MATCH')
      expect(verdict.objects && verdict.objects.verdict, JSON.stringify(verdict.objects)).toBe('MATCH')
    }), 120000)
  }
})

describe('⛔ the grader draws what the chart draws: the host program when the run holds back', () => {
  it('a run that withholds its drawings whole is graded on the host program, never on the run\'s empty picture', () => lane(() => {
    const loaded = loadCapture(path.join(DIR, RDDT))
    const d = memberPaneDefinition({ source: loaded.capture.source.text, id: 'u_lf-tt2', name: 'lf tt' })
    const bars = toProductBars(loaded.capture)
    const ctx = { tf: 'D', symbol: symbolOf(RDDT), newestBarIsForming: false, historyFromListing: true }
    const cols = registry.computeFor(d.definition, bars, undefined, ctx)
    expect(__objectsReportForTests(d.definition, bars, ctx, cols).lane, 'CONTROL: the run draws').toBe('runtime')
    const held = withRuntimeObjects({ ...cols }, { status: 'WITHHELD', live: [], guard: 'format:tick-unsettled', reason: 'x' })
    const r = __objectsReportForTests(d.definition, bars, ctx, held)
    expect(r.lane, JSON.stringify(r).slice(0, 300)).not.toBe('runtime')
  }), 120000)
})
