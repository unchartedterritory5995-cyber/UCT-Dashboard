// app/src/components/chart/engine/__tests__/vendorHarness/runtimeAllowlistParity.test.js
//
// ─── ⭐⭐ W2 (2026-11-02) — THE ALLOWLIST'S MATCH IS RE-GRADED ON EVERY TREE ────
//
// Phase 3 arming checklist P1 / P4 (`docs/pine/PHASE3-RUNTIME-PLAN.md` 4.2). The
// starter allowlist (`api/data/pine_runtime_allowlist.json`) names, for every
// script it serves, the TradingView captures that graded it MATCH with the
// runtime pane ON. Until this rail, that verdict was a RECORD: taken once, by a
// harness run at `b09a6bcee6`, and checked since only for being well formed
// (`tests/test_pine_runtime_switch_on.py` reads the ids, the files and the
// hashes, never the verdict). The engine moved four versions under it.
//
// This rail grades every capture the allowlist names, on THIS tree, through the
// REAL member door, with the gate exactly as a permitted member meets it in
// production: both panes on, the per-member permission granted, and the
// server's allowlist latched from the committed file (⛔ NOT the suites'
// allow-every-script override, which would grade a script the server never
// serves). Each must:
//   1. be drawn BY THE RUNTIME LANE (a host attach would grade the other lane);
//   2. grade MATCH, with every vendor plot compared (non-vacuity).
// A control proves the latch is the real one: a runtime-only script the file
// does not list is declined by the gate, by name (`runtime:not-yet-graded`).
//
// ⛔ It reads only the `sha256` and `captures[].id` fields; WHICH scripts the
// server serves is `rollout_gate.pine_runtime_admission`'s answer (Python), and
// this grades a SUPERSET (every listed script), so it can never be laxer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { loadCapture, gradeCapture, REPO, HARNESS_DIR } from './harness'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { runtimeDeclinedTag } from '../../../../../../../tools/pine_coverage/runtime_lane.mjs'
import { enterMemberDoor } from './ourSide'
import {
  setRuntimeAllowList, setRuntimeKillList, runtimeAllowList, runtimeSourceHash,
  __allowEveryRuntimeScriptForTests,
} from '../../runtimeKill'
import { __permitRuntimePaneForTests, runtimePaneEnabled } from '../../runtimePaneGate'
import { setRunHalfObjectEvidence, runHalfEvidenceAdmits } from '../../runHalfRailSeam'

const ALLOWLIST = path.join(REPO, 'api', 'data', 'pine_runtime_allowlist.json')
const doc = JSON.parse(fs.readFileSync(ALLOWLIST, 'utf8'))
const scripts = doc.scripts
const listedHashes = scripts.map((s) => String(s.sha256).toLowerCase())
/** ⭐ RS Rating (2026-11-16) — WHAT THE KILL READ SERVES AS `run_half_evidence` for the committed list,
 *  field for field as `api/services/runtime_definitions.py::run_half_evidence` builds it (a record's
 *  captures that carry an `objectsV2` grade). Production latches exactly this beside the allowlist
 *  (`runtimeKill.js`), and a host-partial script's labels are drawn only on it. ⛔ Whether an entry
 *  ADMITS is still the seam's own rule (`runHalfEvidenceAdmits`), never decided here. */
const servedRunHalfEvidence = scripts
  .map((s) => ({ s, caps: (s.captures || []).filter((c) => c && 'objectsV2' in c && typeof c.id === 'string' && c.id) }))
  .filter(({ caps }) => caps.length)
  .map(({ s, caps }) => ({
    sha256: String(s.sha256).toLowerCase(),
    ...('admission' in s ? { admission: s.admission, substituted: s.substituted } : {}),
    captures: caps.map((c) => ({
      capture: c.id, verdict: c.verdict, objectsV2: c.objectsV2 === 'MATCH', runtimeOn: c.runtimePane === 'on',
      ...('substituted' in c ? { substituted: c.substituted } : {}),
      // ⭐ SETTINGS PARITY (2c): the settings a capture was taken at (the server serves them as given)
      ...(c.inputs && typeof c.inputs === 'object' && Object.keys(c.inputs).length ? { inputs: { ...c.inputs } } : {}),
      ...(c.objectsV2 === 'MATCH_SUBSTITUTED' ? { objectsV2Substituted: c.objectsV2Substituted || [] } : {}),
    })),
  }))

/** The flag NAMES are read off their gate modules, never typed. */
const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
const RUNTIME_FLAG = flagOf('src/components/chart/engine/runtimePaneGate.js')
const OBJECTS_FLAG = flagOf('src/components/chart/engine/objectsOnlyPaneGate.js')

/** A runtime-only corpus script that is NOT on the allowlist (the control). */
const CONTROL = 'cc-yata-rddt-1d-2026-09-27.json'

const capture = (file) => {
  const loaded = loadCapture(path.join(HARNESS_DIR, file))
  if (!loaded.capture) throw new Error(`${file}: not a capture — ${loaded.reason}`)
  return loaded.capture
}

beforeEach(() => {
  vi.stubEnv(RUNTIME_FLAG, '1')
  vi.stubEnv(OBJECTS_FLAG, '1')
  __permitRuntimePaneForTests()
  setRuntimeKillList([])
  // ⛔ THE SERVER'S LIST, not the suites' allow-every override (`src/test-setup.js`)
  setRuntimeAllowList(listedHashes)
  setRunHalfObjectEvidence(servedRunHalfEvidence)
})

afterEach(() => {
  vi.unstubAllEnvs()
  setRuntimeKillList([])
  setRunHalfObjectEvidence([])
  __allowEveryRuntimeScriptForTests()
})

describe('W2 — every allowlisted script still grades MATCH through the runtime lane, on this tree', () => {
  it('⛔ the gate is the production gate: flags on, member permitted, the committed list latched', () => {
    expect(RUNTIME_FLAG).toBe('VITE_PINE_RUNTIME_PANE_ENABLED')
    expect(OBJECTS_FLAG).toBeTruthy()
    expect(runtimePaneEnabled()).toBe(true)
    expect(runtimeAllowList()).not.toContain('*')
    expect(runtimeAllowList()).toEqual(listedHashes)
    expect(scripts.length).toBeGreaterThan(0)
  })

  it('⛔ control: a runtime-only script the allowlist does not name is declined BY THE GATE, by name', () => {
    const cap = capture(CONTROL)
    expect(listedHashes).not.toContain(runtimeSourceHash(cap.source.text))
    const door = enterMemberDoor(cap.source.text)
    expect(door.built.ok).toBe(false)
    expect(door.refusal).toContain(runtimeDeclinedTag('runtime:not-yet-graded'))
    // …and with every script allowed, the same script IS a runtime-lane script:
    // the decline above is the gate, never a lane that cannot build it.
    __allowEveryRuntimeScriptForTests()
    const open = memberPaneDefinition({ source: cap.source.text, id: 'u_w2-allowlist-control' })
    expect(open.ok, open.reason).toBe(true)
    expect(open.lane).toBe('runtime')
  })

  for (const s of scripts) {
    for (const c of s.captures) {
      it(`⭐ ${s.slug} · ${c.id}: drawn by the runtime lane and graded ${c.verdict}`, () => {
        // ⭐ L7 (RS Rating, 2026-11-16) — a record on the SUBSTITUTED path is graded MATCH_SUBSTITUTED and
        // never MATCH (`rollout_gate.pine_runtime_admission`): every plot and object equals the vendor's
        // with the vendor's own value of each substituted input fed. Any other record must grade MATCH.
        const want = s.admission === 'substituted' ? 'MATCH_SUBSTITUTED' : 'MATCH'
        expect(c.verdict).toBe(want)
        expect(c.runtimePane).toBe('on')
        const cap = capture(`${c.id}.json`)
        expect(runtimeSourceHash(cap.source.text)).toBe(s.sha256)
        const door = memberPaneDefinition({ source: cap.source.text, id: 'u_w2-allowlist-probe' })
        expect(door.ok, door.reason).toBe(true)
        // A script the runtime lane runs WHOLE answers `lane: 'runtime'`. RS Rating is a host-partial
        // script: the host lane draws its plots and the RUN draws its labels (the run half, L5), so the
        // door answers no lane and a minted run half. Either way the per-bar run is what was admitted.
        if (door.lane === 'runtime') expect(door.runHalf).toBeUndefined()
        else expect(door.runHalf && door.runHalf.minted, 'neither a runtime-lane script nor a minted run half').toBe(true)
        if (s.admission !== 'substituted') expect(door.lane).toBe('runtime')
        const { verdict } = gradeCapture(cap)
        // ⛔⛔ WHAT EACH GRADE HERE COVERS (2026-11-16 correction, after #1410 overstated it):
        //   · `verdict.objects` is objects v1: counts, texts and colours. NO coordinates, no x.
        //   · objects v2, WITH x witnessed, is what admits a run half (`runHalfEvidenceAdmits`, from the
        //     record's `objectsV2` grade). This rail never reads objects v2.
        //   · a capture that records no x table can never admit one: its objects v2 is INCONCLUSIVE.
        // So for a host-partial script the drawings are checked on v1 ONLY where the committed evidence
        // admits the run half. Where it does not (RS Rating today: its three captures predate the x
        // table), the labels must be WITHHELD BY NAME at the production gate, never drawn on a claim
        // the harness does not reproduce, and the capture then grades DIVERGE for that named gap alone.
        const runHalfAdmitted = door.lane !== 'runtime' && runHalfEvidenceAdmits(String(s.sha256).toLowerCase())
        if (door.lane === 'runtime' || runHalfAdmitted) {
          expect(verdict.verdict, verdict.reason).toBe(want)
        } else {
          expect((c.objectsV2 || null), 'a record that admits no run half does not claim an objects-v2 MATCH').not.toMatch(/^MATCH/)
          expect(verdict.objects && verdict.objects.verdict, verdict.objects && verdict.objects.reason).toBe('DIVERGE')
          expect(String(verdict.objects.reason)).toMatch(/our drawing is withheld by name \(pine:object-removal-lost\)/)
          expect(verdict.verdict, verdict.reason).toBe('DIVERGE')
        }
        if (runHalfAdmitted) {
          // ⛔ non-vacuity: TradingView holds drawings and ours are drawn and agree on objects v1
          expect(String(verdict.objects && verdict.objects.reason), 'the capture holds drawings').not.toMatch(/neither side draws/)
          expect(['MATCH', 'MATCH_SUBSTITUTED'], verdict.objects && verdict.objects.reason).toContain(verdict.objects && verdict.objects.verdict)
        }
        const compared = (verdict.plots || []).filter((p) => p.verdict === want)
        // every vendor plot that draws a VALUE is compared and agrees. A `colorer` row is the colour
        // channel of the plot before it, graded with that plot (RS Rating has four lines and four
        // colourers); an `alertcondition` draws nothing on TradingView either.
        const NOT_A_VALUE = new Set(['colorer', 'bar_colorer', 'alertcondition'])
        const valuePlots = cap.study.plots.filter((p) => !NOT_A_VALUE.has(p.type))
        expect(valuePlots.length, 'the capture holds value plots').toBeGreaterThan(0)
        expect((verdict.plots || []).length, 'every graded plot agrees').toBe(compared.length)
        expect(compared.length, 'every vendor value plot compared').toBe(valuePlots.length)
        // 60 s, not the suite's 15: the FIRST capture graded here pays the runtime lane's and the run
        // half's cold start (13.5 s measured alone on one worker for RS Rating's RDDT capture, whose
        // run half is admitted since Q-RS8 and so is now run and object-railed), and it timed out at
        // 15 s under two workers. A time limit is not part of the grade.
      }, 60_000)
    }
  }
})
