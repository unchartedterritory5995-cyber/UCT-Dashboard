// app/src/components/chart/engine/__tests__/formingReasonAgrees.test.js
//
// ─── ⭐ G6 — ALL THREE FORMING-BAR SENTENCES SAY THE SERVER'S REASON, AND THE SAME ONE ────────────────────
//
// Found by Deepvue (#2411 fixed the runtime document's sentence): a script the server admits for finished bars
// only because it reads ANOTHER SYMBOL, or keeps a `varip`, was told it "reads the state of the bar as it forms".
// Three surfaces say it: a runtime document's refusal (`runtimeKill.js::runtimeFormingRefusalOf`), a run colour's
// (`nativeRegistry.js::runtimeColourWhy`) and a run half's drawing note (`binder.js::runHalfWhyFor` ->
// `ast/objectLoss.js::runHalfRefusedSentence`). Each DERIVES its reason from `formingReason.js::formingReasonOf`;
// this rail holds that, for every id, two ids, an id this tab does not know, and none (fail closed).
// The run colour through its real door (`computeFor`) is railed beside its fixture, `div4RuntimeReadPaint.test.js`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  latchRuntimeAdmission, runtimeSourceHash, setRuntimeCapabilityAdmission, __resetRuntimeAdmission,
  __resetRuntimeAllowList, runtimeFormingRefusalOf, runtimeFormingIdsOf, RUNTIME_FORMING_GUARD,
} from '../runtimeKill'
import { formingReasonOf, FORMING_REASON_BY_ID, FORMING_REASON_UNKNOWN } from '../formingReason.js'
import { runtimeColourWhy } from '../nativeRegistry'
import { RUN_HALF_FORMING_CODE } from '../ast/objectLoss'
import { runHalfWhyFor } from '../binder'

const SRC = '//@version=5\nindicator("fa")\nplot(request.security("SPY", "D", close))\n'
const H = runtimeSourceHash(SRC)
const RUN_HALF_DEF = { compute: { kind: 'ast', runtimeObjects: { source: SRC, outputs: {} } } }
const REFUSED = { state: 'refused', code: RUNTIME_FORMING_GUARD }

beforeEach(() => { __resetRuntimeAllowList(); __resetRuntimeAdmission(); setRuntimeCapabilityAdmission(true) })
afterEach(() => { __resetRuntimeAdmission(); __resetRuntimeAllowList() })

/** The three sentences for the script whose verdict was latched with `ids`. */
const said = (ids) => {
  latchRuntimeAdmission(H, { admitted: true, historyOnly: true, historyOnlyIds: ids })
  return {
    document: runtimeFormingRefusalOf({ source: SRC, newestBarIsForming: true }),
    colour: runtimeColourWhy(RUNTIME_FORMING_GUARD, { formingIds: runtimeFormingIdsOf({ source: SRC }) }),
    runHalf: runHalfWhyFor(RUN_HALF_DEF, REFUSED),
  }
}

describe('G6 — every forming-bar sentence says the reason the server named, and all three agree', () => {
  it('FA0: the run half compares against the forming guard itself (its restated code equals runtimeKill\'s)', () => {
    expect(RUN_HALF_FORMING_CODE).toBe(RUNTIME_FORMING_GUARD)
  })

  it.each([
    ['FA1', ['realtime-state']],
    ['FA2', ['varip']],
    ['FA3', ['request-other']],
    ['FA4', ['request-other', 'varip']],
    ['FA5', ['some-new-capability']],
    ['FA6', []],
  ])('%s: ids %j are said the same way by the document, the run colour and the run half', (_tag, ids) => {
    const want = formingReasonOf(ids)
    const s = said(ids)
    expect(s.document).toContain(`this script ${want}, and that has only been checked`)
    expect(s.colour).toContain(`this script ${want}, which has only been checked`)
    expect(s.runHalf).toContain(`the script ${want}, which has only been checked`)
    // and none of them says a reason the server did not give
    for (const [id, phrase] of Object.entries(FORMING_REASON_BY_ID)) {
      if (ids.includes(id)) continue
      expect(s.document, id).not.toContain(phrase)
      expect(s.colour, id).not.toContain(phrase)
      expect(s.runHalf, id).not.toContain(phrase)
    }
    if (!ids.some((id) => Object.hasOwn(FORMING_REASON_BY_ID, id))) {
      for (const k of Object.keys(s)) expect(s[k], k).toContain(FORMING_REASON_UNKNOWN)
    }
  })

  it('FA7: a run half or run colour asked without ids still refuses, said plainly (fail closed)', () => {
    expect(runtimeColourWhy(RUNTIME_FORMING_GUARD)).toContain(`this script ${FORMING_REASON_UNKNOWN}, which`)
    expect(runHalfWhyFor({ compute: {} }, REFUSED)).toContain(`the script ${FORMING_REASON_UNKNOWN}, which`)
  })

  it('CONTROLS: another refusal code keeps its own words; a run half that is not refused says nothing', () => {
    latchRuntimeAdmission(H, { admitted: true, historyOnly: true, historyOnlyIds: ['request-other'] })
    expect(runtimeColourWhy('pane:killed', { formingIds: ['request-other'] })).not.toContain('another symbol')
    expect(runHalfWhyFor(RUN_HALF_DEF, { state: 'refused', code: 'pane:killed' })).not.toContain('another symbol')
    expect(runHalfWhyFor(RUN_HALF_DEF, { state: 'served' })).toBeNull()
    expect(runHalfWhyFor(RUN_HALF_DEF, null)).toBeNull()
  })
})
