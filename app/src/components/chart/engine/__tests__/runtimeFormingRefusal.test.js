// @vitest-environment node
// app/src/components/chart/engine/__tests__/runtimeFormingRefusal.test.js
//
// ─── ⭐⭐ G6 (coordinator ruling 2026-11-15) — `realtime-state` FOR CLOSED-BAR HISTORY ONLY ──
//
// `realtime-state` (barstate.*, timenow, ...) is admitted by capability on CLOSED-BAR
// evidence: no capture grades what a script does on a FORMING bar. The server answers an
// admitted script that uses it with `historyOnly` (`runtime_definitions.runtime_admission`);
// this tab latches that as one boolean, and every run door refuses the script BY NAME
// while the chart's newest bar is forming or not known to be closed. The server half is
// `tests/test_pine_capability_admission.py` (G6). The run-half and run-colour doors are
// railed beside their own fixtures (`runHalf.test.jsx`, `div4RuntimeReadPaint.test.js`).
// ⛔ Node environment on purpose: `window` is absent unless a test installs it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  computeFor, columnErrors, registerRuntimeLane,
} from '../nativeRegistry'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../runtimePaneGate'
import {
  setRuntimeKillList, setRuntimeAllowList, __resetRuntimeAllowList, __resetRuntimeListsRecheck,
  __allowEveryRuntimeScriptForTests, setRuntimeCapabilityAdmission, latchRuntimeAdmission,
  runtimeAdmissionOf, requestRuntimeAdmission, __resetRuntimeAdmission, runtimeSourceHash,
  runtimeFormingRefusalOf, runtimeNotGradedOf, RUNTIME_FORMING_GUARD,
} from '../runtimeKill'

const SRC = '//@version=5\nindicator("rt")\nplot(barstate.isconfirmed ? close : open)\n'
const H = runtimeSourceHash(SRC)
const DEF = {
  id: 'u_00000000f0b6', version: 1,
  compute: { kind: 'runtime', source: SRC, outputs: { value: 0 } },
  plots: [{ key: 'value' }],
}
const BARS = [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }]
const FORMING = /not drawn bar by bar while this chart's newest bar is still forming/
const UNTOLD = /cannot say yet whether its newest bar has finished/
const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve() }

let lane
beforeEach(() => {
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __resetRuntimePanePermission()
  __permitRuntimePaneForTests()
  __resetRuntimeAllowList()
  __resetRuntimeAdmission()
  setRuntimeKillList([])
  __resetRuntimeListsRecheck()
  setRuntimeCapabilityAdmission(true)
  lane = vi.fn(() => ({ value: [42] }))
  registerRuntimeLane(lane)
})
afterEach(() => {
  registerRuntimeLane(null)
  __resetRuntimeAdmission()
  setRuntimeKillList([])
  __resetRuntimeListsRecheck()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const run = (newestBarIsForming) => computeFor(DEF, BARS, {}, { tf: 'D', newestBarIsForming })

describe('G6 — the latch keeps `historyOnly` as one boolean', () => {
  it('a verdict latched without it is not history-only; with it, it is', () => {
    latchRuntimeAdmission(H, { admitted: true })
    expect(runtimeAdmissionOf({ hash: H }).historyOnly).toBe(false)
    latchRuntimeAdmission(H, { admitted: true, historyOnly: true })
    expect(runtimeAdmissionOf({ hash: H }).historyOnly).toBe(true)
    latchRuntimeAdmission(H, { admitted: true, historyOnly: 'yes' })      // only `true` is true
    expect(runtimeAdmissionOf({ hash: H }).historyOnly).toBe(false)
  })

  it.each([
    [['realtime-state'], true],
    [[], false],
    [undefined, false],
    ['realtime-state', true],          // ⛔ malformed but present: fail closed
    [{}, true],
    [null, true],
  ])('the server answer %j latches historyOnly=%s', async (historyOnly, want) => {
    vi.stubGlobal('window', {})
    const body = { sha256: H, admitted: true, missing: [] }
    if (historyOnly !== undefined) body.historyOnly = historyOnly
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })))
    requestRuntimeAdmission(SRC)
    await flush()
    expect(runtimeAdmissionOf({ hash: H })).toMatchObject({ admitted: true, historyOnly: want })
  })
})

describe('G6 — who is asked', () => {
  it('a history-only verdict: closed is drawn, forming and untold are refused, each with its own sentence', () => {
    latchRuntimeAdmission(H, { admitted: true, historyOnly: true })
    expect(runtimeNotGradedOf({ source: SRC })).toBeNull()                  // admitted ...
    expect(runtimeFormingRefusalOf({ source: SRC, newestBarIsForming: false })).toBeNull()
    expect(runtimeFormingRefusalOf({ source: SRC, newestBarIsForming: true })).toMatch(FORMING)
    for (const untold of [null, undefined, 'false', 0]) {
      expect(runtimeFormingRefusalOf({ source: SRC, newestBarIsForming: untold }), String(untold)).toMatch(UNTOLD)
    }
    expect(runtimeFormingRefusalOf({ hash: H, newestBarIsForming: true })).toMatch(FORMING)
  })

  it('CONTROLS: never asked of a verdict without it, a refused verdict, admission off, the graded allowlist or the test grant', () => {
    latchRuntimeAdmission(H, { admitted: true })
    expect(runtimeFormingRefusalOf({ source: SRC, newestBarIsForming: true })).toBeNull()
    latchRuntimeAdmission(H, { admitted: false, historyOnly: true })
    expect(runtimeFormingRefusalOf({ source: SRC, newestBarIsForming: true })).toBeNull()  // "not graded" answers it
    latchRuntimeAdmission(H, { admitted: true, historyOnly: true })
    setRuntimeAllowList([H.slice(0, 16)])
    expect(runtimeFormingRefusalOf({ source: SRC, newestBarIsForming: true })).toBeNull()
    __resetRuntimeAllowList()
    __allowEveryRuntimeScriptForTests()
    expect(runtimeFormingRefusalOf({ source: SRC, newestBarIsForming: true })).toBeNull()
    __resetRuntimeAllowList()
    setRuntimeCapabilityAdmission(false)
    expect(runtimeFormingRefusalOf({ source: SRC, newestBarIsForming: true })).toBeNull()
  })
})

describe('G6 — the refusal names the reason the SERVER gave (found by Deepvue: request-other and varip were told "barstate")', () => {
  const BARSTATE = 'reads the state of the bar as it forms (barstate or the clock)'
  const VARIP = 'keeps a `varip` value that changes within a forming bar'
  const OTHER = 'reads another symbol or timeframe'
  const UNKNOWN = 'uses a part of Pine'
  const ALL = [BARSTATE, VARIP, OTHER, UNKNOWN]
  const answer = async (historyOnly) => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ sha256: H, admitted: true, missing: [], historyOnly }) })))
    requestRuntimeAdmission(SRC)
    await flush()
    return runtimeFormingRefusalOf({ source: SRC, newestBarIsForming: true })
  }
  const only = (said, want) => {
    expect(said).toContain(`this script ${want}, and that has only been checked`)
    for (const other of ALL.filter((p) => p !== want && !want.includes(p))) expect(said).not.toContain(other)
  }

  it.each([
    ['FR1', 'realtime-state', BARSTATE],
    ['FR2', 'varip', VARIP],
    ['FR3', 'request-other', OTHER],
  ])('%s: the server id %s is said as its own reason, and no other', async (_tag, id, want) => {
    const said = await answer([id])
    expect(said).toMatch(FORMING)
    only(said, want)
    expect(runtimeAdmissionOf({ hash: H }).historyOnlyIds).toEqual([id])
  })

  it('FR4: two ids are both said, in the server\'s order, joined by "and"', async () => {
    const said = await answer(['request-other', 'varip'])
    expect(said).toContain(`this script ${OTHER} and ${VARIP}, and that has only been checked`)
    expect(said).not.toContain(BARSTATE)
    expect(said).not.toContain(UNKNOWN)
    // and the untold half keeps its own ending with the same reason
    expect(runtimeFormingRefusalOf({ source: SRC, newestBarIsForming: null })).toContain(`this script ${OTHER} and ${VARIP}, and`)
    expect(runtimeFormingRefusalOf({ source: SRC, newestBarIsForming: null })).toMatch(UNTOLD)
  })

  it.each([
    ['FR5 an id this tab does not know', ['some-new-capability']],
    ['FR5 a malformed answer (a string)', 'realtime-state'],
    ['FR5 a malformed answer (an object)', {}],
    ['FR5 a list with no string id', [7, null]],
  ])('%s: still refused (fail closed), said plainly', async (_name, historyOnly) => {
    const said = await answer(historyOnly)
    expect(said).toMatch(FORMING)
    expect(said).toContain(`this script ${UNKNOWN}, and that has only been checked`)
    expect(said).not.toContain(BARSTATE)
  })

  it('FR6: a known id beside an unknown one says both, each once', async () => {
    const said = await answer(['varip', 'some-new-capability', 'varip'])
    expect(said).toContain(`this script ${VARIP} and ${UNKNOWN}, and that has only been checked`)
    expect(said.split(VARIP).length - 1).toBe(1)
  })

  it('CONTROL: an empty list is not history-only, so nothing is said at all', async () => {
    expect(await answer([])).toBeNull()
  })
})

describe('G6 — a runtime document, at every run', () => {
  it('⭐ drawn on a closed bar; the NEXT run on a forming or untold bar draws nothing and says why', () => {
    latchRuntimeAdmission(H, { admitted: true, historyOnly: true })
    expect(run(false).value).toEqual([42])
    expect(lane).toHaveBeenCalledTimes(1)
    for (const forming of [true, null, undefined]) {
      const out = run(forming)
      expect(out.value, String(forming)).toBeUndefined()
      expect(columnErrors(out).value.guard).toBe(RUNTIME_FORMING_GUARD)
      expect(columnErrors(out).value.message).toMatch(forming === true ? FORMING : UNTOLD)
      expect(columnErrors(out).value.message).not.toMatch(/\b(pane|runtime):[a-z]/)
    }
    expect(lane).toHaveBeenCalledTimes(1)                                   // the lane never ran
    expect(run(false).value).toEqual([42])                                   // the bar finished: drawn again
  })

  it('CONTROL: the same script admitted without the restriction is drawn on a forming bar', () => {
    latchRuntimeAdmission(H, { admitted: true })
    expect(run(true).value).toEqual([42])
  })
})
