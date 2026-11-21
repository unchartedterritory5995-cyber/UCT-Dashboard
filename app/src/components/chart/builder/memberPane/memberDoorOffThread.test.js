// @vitest-environment node
// app/src/components/chart/builder/memberPane/memberDoorOffThread.test.js
//
// ─── ⭐⭐ THE PASTE WORKER — THE WORKER'S ANSWER IS THE MAIN THREAD'S ANSWER ─────────────────────────────────
//
// docs/pine/evidence/2026-11-20-paste-worker/EVIDENCE.md. The member door builds a pasted script in a Web Worker
// (`memberDoorAsync.js`), and a worker is its own module graph: every page state the door reads starts there
// EMPTY. So the rail builds in a FRESH module graph (`vi.resetModules()`, then the worker's own handler), over a
// structured clone of the real job (the page's image, `memberDoorImage.js`, as the page takes it), and asks for the
// main thread's answer, byte for byte (`canonOf`: key order, every value, shared identity), in every page state an
// image part carries:
//   the test grant (runtime lane on, every script graded) · a member with no permission (runtime lane off) · the
//   starter allowlist empty (nothing graded) · the script on the kill list · capability admission on with no
//   verdict ("still being checked") and with one · a library the script imports · the host lane's known-divergence
//   list applied (a committed script on it) and a synthetic one · a synthetic held withhold list.
// ⛔ A page state the door reads that the image does not carry answers wrong here, in the state that sets it.
// ⭐ CONTROLS: the sample answers on the host lane, on the runtime lane and with a refusal (so "equal" is not
// "equal because nothing was drawn"), and each image part round-trips through a fresh graph to the same image.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { memberPaneDefinition, MEMBER_PANE_DEF_PREFIX } from './memberPaneDefinition'
import { memberDoorImage } from './memberDoorImage'
import { MEMBER_DOOR_JOB } from './memberDoorWorkerCore'
import {
  setRuntimeKillList, __resetRuntimeAllowList, setRuntimeCapabilityAdmission, latchRuntimeAdmission,
  runtimeSourceHash, runtimeConsultPendingOf, __resetRuntimeAdmission,
} from '../../engine/runtimeKill'
import { __resetRuntimePanePermission } from '../../engine/runtimePaneGate'
import { __setHostKnownDivergenceForTests, __resetHostKnownDivergence } from '../../engine/hostKnownDivergence'
import { __setHeldWithholdsForTests } from '../../engine/heldWithholds'
import { registerPineLibrary, clearPineLibraries } from '../../engine/ast/pineLibraryStore'
import { setRunHalfObjectEvidence } from '../../engine/runHalfRailSeam'
import { fixtureLibrary } from '../../engine/ast/__tests__/libraryFixture.js'
import { canonOf, importWorkerCore } from '../../../../testing/builder/memberDoor.testkit.js'
import { restoreFaithful, INSPECT_JOB } from './memberDoorProtocol'
import { inspectSource } from '../inspectSource'

const REPO = path.resolve(__dirname, '../../../../../..')
const corpus = (n) => fs.readFileSync(path.join(REPO, 'corpus/committed', n), 'utf8')
const member = (n) => fs.readFileSync(path.join(REPO, 'tests/fixtures/member', n), 'utf8')

/** A small sample: drawn by the host lane, by the runtime lane, refused, a committed known-divergence script. */
const SAMPLE = {
  rvol: corpus('rvol__05fcd9e160.pine'),
  adx: corpus('adx-and-di-for-v4__932.pine'),
  twinRange: corpus('twin-range-filter__xF3L2PeXm7.pine'),
  parabolicSar: corpus('parabolic-sar__xoeoPMOWGJ.pine'),
  insideBar: corpus('inside-bar-boxes__2f747d848b.pine'),
  engulfing: corpus('engulfingcandle__0df91dc775.pine'),
  stopTake: corpus('stop-loss-and-take-profit-in-example__YlblCbts4x.pine'),
  vold: corpus('vold-market-breadth__9c5cde9557.pine'),
  clouds: member('uncharted-clouds.pine'),
}
const MPL = '// This Pine Script code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/'
const LIB = fixtureLibrary({ path: 'tester/pwlib/1', licence: 'MPL-2.0', source: `${MPL}\n//@version=5\nlibrary("pwlib")\nexport mid(float h, float l) => (h + l) / 2\n` })
const IMPORTS = '//@version=5\nindicator("t")\nimport tester/pwlib/1 as fx\nvar float x = 0.0\nx := fx.mid(high, low)\ns = 0.0\nfor i = 0 to 2\n    s := s + x[i]\nplot(s, "S")\n'

let core = null     // the worker's handler, in a fresh module graph
let jobId = 1

// ⭐ A FRESH GRAPH PER CASE, as the page starts a fresh worker where one would answer from a stale state: a worker that
// latched "not permitted" cannot be told "permitted" (`memberDoorAsync.js` replaces it; railed in its own file)
beforeEach(async () => {
  core = await importWorkerCore(vi)
}, 120000)

beforeEach(() => {
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
})
afterEach(() => {
  vi.unstubAllEnvs()
  clearPineLibraries()
  setRunHalfObjectEvidence([])
  setRuntimeKillList([])
  __resetRuntimeAdmission()
})

/** The job as the page posts it (a structured clone), answered in the fresh graph, the reply cloned back. */
function offThread(source) {
  const job = structuredClone({ kind: MEMBER_DOOR_JOB, id: jobId++, args: { source, id: MEMBER_PANE_DEF_PREFIX }, image: memberDoorImage() })
  return structuredClone(core.answerMemberDoorJob(job))
}

/** Main thread vs worker, for each script: equal canonical text; returns what each answered, for the controls. */
function sameEverywhere(names) {
  const seen = []
  for (const name of names) {
    const source = name === 'imports' ? IMPORTS : SAMPLE[name]
    const main = memberPaneDefinition({ source, id: MEMBER_PANE_DEF_PREFIX })
    const reply = offThread(source)
    expect(reply.ok, `${name}: the worker answered`).toBe(true)
    expect(reply.lost, `${name}: nothing the clone could not carry`).toBe(0)
    // ⭐ field for field, the non-enumerable ones too (`memberDoorProtocol.js`), as the page reads it
    const landed = restoreFaithful({ value: reply.answer, hidden: reply.hidden })
    expect(canonOf(landed, { hidden: true }), `${name}: the worker's answer is the main thread's`).toBe(canonOf(main, { hidden: true }))
    seen.push({ name, ok: !!main.ok, lane: main.ok ? (main.lane || 'host') : null, guard: main.guard || null, reply })
  }
  return seen
}

describe('⭐⭐ the paste worker answers exactly as the main thread does, in every page state', () => {
  it('the test grant: runtime lane on, every script graded (controls: host, runtime and refused answers)', () => {
    const seen = sameEverywhere(Object.keys(SAMPLE))
    expect(seen.some((s) => s.ok && s.lane === 'host'), 'a host-lane answer in the sample').toBe(true)
    expect(seen.some((s) => s.ok && s.lane === 'runtime'), 'a runtime-lane answer in the sample').toBe(true)
    expect(seen.some((s) => !s.ok), 'a refusal in the sample').toBe(true)
  }, 240000)

  it('a member the runtime pane is not permitted for (the permission latch)', () => {
    __resetRuntimePanePermission()
    const seen = sameEverywhere(['adx', 'stopTake', 'twinRange', 'insideBar'])
    expect(seen.every((s) => s.lane !== 'runtime')).toBe(true)
  }, 240000)

  it('the starter allowlist empty: nothing graded (the lists)', () => {
    __resetRuntimeAllowList()
    sameEverywhere(['adx', 'stopTake', 'insideBar'])
  }, 240000)

  it('the script on the runtime kill list (the lists)', () => {
    setRuntimeKillList(Object.values(SAMPLE).map((s) => runtimeSourceHash(s).slice(0, 16)))
    sameEverywhere(['adx', 'stopTake', 'insideBar'])
  }, 240000)

  it('capability admission on, no verdict yet: "still being checked", and the build says so (consultPending)', () => {
    __resetRuntimeAllowList()
    __resetRuntimeAdmission()
    setRuntimeCapabilityAdmission(true)
    const [{ reply }] = sameEverywhere(['stopTake'])
    expect(reply.consultPending, 'the worker read "still being checked" right after the build').toBe(runtimeConsultPendingOf({ source: SAMPLE.stopTake }))
    expect(reply.consultPending).toBe(true)
    expect(reply.consults.some((c) => c.fn === 'notGraded'), 'the consults the page replays').toBe(true)
  }, 240000)

  it('capability admission on, the script admitted (a verdict)', () => {
    __resetRuntimeAllowList()
    __resetRuntimeAdmission()
    setRuntimeCapabilityAdmission(true)
    for (const s of [SAMPLE.stopTake, SAMPLE.adx]) latchRuntimeAdmission(runtimeSourceHash(s), { admitted: true })
    const seen = sameEverywhere(['stopTake', 'adx'])
    expect(seen.every((s) => s.reply.consultPending === false)).toBe(true)
  }, 240000)

  it('a library the script imports (the library registry)', () => {
    registerPineLibrary(LIB)
    const [s] = sameEverywhere(['imports'])
    expect(s.ok, 'drawn, with the library linked').toBe(true)
  }, 240000)

  it('the host lane known-divergence list applied: a committed script on it, and a synthetic list', () => {
    __resetHostKnownDivergence()
    const [vold] = sameEverywhere(['vold'])
    expect(vold.guard === 'pine:known-divergence' || vold.lane === 'runtime', 'the committed list was consulted').toBe(true)
    __setHostKnownDivergenceForTests({ scripts: [{ sha256: runtimeSourceHash(SAMPLE.rvol), slug: 'pw', reason: 'its line differs on one captured chart' }] })
    const [rvol] = sameEverywhere(['rvol'])
    expect(rvol.guard === 'pine:known-divergence' || rvol.lane === 'runtime').toBe(true)
  }, 240000)

  it('a synthetic held withhold list (the held list)', () => {
    const plain = memberPaneDefinition({ source: SAMPLE.adx, id: MEMBER_PANE_DEF_PREFIX })
    const held = (door) => ({ door, scope: 'output', title: 'DI+', why: 'plot `DI+`: a synthetic withhold', lanes: ['production', 'runtime-on'], evidence: ['pw-1', 'pw-2'] })
    __setHeldWithholdsForTests({ scripts: [{ sha256: runtimeSourceHash(SAMPLE.adx), withholds: [held('host'), held('runtime')] }] })
    const [s] = sameEverywhere(['adx'])
    // ⭐ the control: the list changes this script's answer (so "equal" is about the list, not about nothing)
    expect(canonOf(memberPaneDefinition({ source: SAMPLE.adx, id: MEMBER_PANE_DEF_PREFIX }))).not.toBe(canonOf(plain))
    expect(s.name).toBe('adx')
  }, 240000)
})

describe('each image part round-trips through a fresh module graph', () => {
  it('the image a fresh graph holds after applying it is the image it was given', async () => {
    registerPineLibrary(LIB)
    setRuntimeKillList(['u_0123456789ab', runtimeSourceHash('x').slice(0, 20)])
    setRuntimeCapabilityAdmission(true)
    latchRuntimeAdmission(runtimeSourceHash('y'), { admitted: true, historyOnly: true })
    setRunHalfObjectEvidence([{ sha256: runtimeSourceHash('z'), captures: [{ capture: 'c1', verdict: 'MATCH' }] }])
    __setHostKnownDivergenceForTests({ scripts: [{ sha256: runtimeSourceHash('h'), slug: 'h', reason: 'r' }] })
    const img = memberDoorImage()
    const fresh = await import('./memberDoorImage.js')   // the fresh graph's own (beforeEach reset the registry)
    fresh.applyMemberDoorImage(structuredClone(img))
    expect(canonOf(fresh.memberDoorImage())).toBe(canonOf(img))
    // ⭐ the control: a part this rail changes is seen (the image is not compared with itself)
    setRuntimeKillList([])
    expect(canonOf(memberDoorImage())).not.toBe(canonOf(img))
  }, 120000)
})

describe("⭐⭐ PasteBox's report crosses faithfully: the worker's report is the main thread's, field for field", () => {
  /** The report job as the page posts it, answered in the worker's graph, the reply cloned back. */
  const inspectOff = (source, dialect = 'auto') => structuredClone(core.answerInspectJob(structuredClone(
    { kind: INSPECT_JOB, id: jobId++, args: { source, dialect }, image: memberDoorImage() })))
  it('every sample script: the same report, non-enumerable properties included; a plain clone would differ', () => {
    let tagged = 0
    let plainWouldDiffer = 0
    for (const [name, source] of Object.entries({ ...SAMPLE, imports: IMPORTS })) {
      if (name === 'imports') registerPineLibrary(LIB)
      const main = inspectSource(source, 'auto')
      const reply = inspectOff(source)
      expect(reply.ok, `${name}: the worker answered`).toBe(true)
      expect(reply.lost, `${name}: nothing the clone could not carry`).toBe(0)
      tagged += reply.hidden.length
      const landed = restoreFaithful({ value: reply.answer, hidden: reply.hidden })
      expect(canonOf(landed, { hidden: true }), `${name}: the worker's report is the main thread's`).toBe(canonOf(main, { hidden: true }))
      // ⛔ THE CONTROL: the same reply WITHOUT its hidden properties put back is not the main thread's report
      if (reply.hidden.length && canonOf(reply.answer, { hidden: true }) !== canonOf(main, { hidden: true })) plainWouldDiffer += 1
    }
    expect(tagged, 'the sample carries non-enumerable properties (parameter ids, row handoffs)').toBeGreaterThan(10)
    expect(plainWouldDiffer, 'a plain clone loses them: the rail can tell').toBeGreaterThan(0)
  }, 240000)
})
