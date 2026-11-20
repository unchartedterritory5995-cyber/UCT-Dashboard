// app/src/testing/runtimeGate.js
//
// ─── THE TEST GRANT ON THE RUNTIME GATE, AND THE WAY A SUITE TAKES IT BACK ────────────────
//
// `src/test-setup.js` runs every test as a PERMITTED member with EVERY script graded and the
// host-known-divergence list and the held withholds ignored (`grantRuntimeGate`, in a root `beforeEach`), so the suites
// that exercise the runtime LANE keep measuring the lane rather than its doors.
//
// ⛔⛔ THE FINDING THIS FILE EXISTS FOR (test-grant census, 2026-11-19). A suite that narrowed
// those doors ONCE, in `beforeAll` (or at module / describe-body scope, while vitest collects),
// was re-granted before every test by the root `beforeEach`, so its "member" assertions all ran
// under the grant. Three suites did it; one of them hid 31 red cases (the reach run's
// `capabilityEvidenceLane` describe, measured with the host-known-divergence list ignored while it
// believed it was asking the member's door). Two rails make that impossible now:
//   · RUNTIME: `test-setup.js` asks `gateNarrowedOutsideTest` before it re-grants. A gate that a
//     hook OUTSIDE any test moved away from the grant (beforeAll, a describe's afterAll) fails the
//     next test by name, GATE-BLIND. Railed in `runtimeGate.test.js`.
//   · STATIC: `narrowingsOutsideTests` finds a narrowing call at module or describe-body scope
//     (collection runs before every hook, so the runtime rail cannot see one). Railed over every
//     test file in `runtimeGateScope.rail.test.js`.
//
// ⭐ THE ONE WAY A SUITE TESTS THE MEMBER'S DOORS: `asMember({...})`, at module or describe scope.
// It registers a `beforeEach` that narrows, AFTER the root re-grant, so every test in its scope
// runs behind exactly the doors it names. A narrowing inside a test body is fine too (the next
// test is re-granted); a narrowing in `beforeAll` is not.
import { beforeEach } from 'vitest'
import {
  __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList, setRuntimeAllowList, runtimeAllowList,
  __resetRuntimeAdmission, setRuntimeCapabilityAdmission, latchRuntimeAdmission, runtimeCapabilityAdmissionOn,
} from '../components/chart/engine/runtimeKill'
import {
  __permitRuntimePaneForTests, __resetRuntimePanePermission, runtimePanePermissionDebug,
} from '../components/chart/engine/runtimePaneGate'
import {
  __ignoreHostKnownDivergenceForTests, __resetHostKnownDivergence, __setHostKnownDivergenceForTests,
  hostKnownDivergenceActive,
} from '../components/chart/engine/hostKnownDivergence'
import {
  __ignoreHeldWithholdsForTests, __resetHeldWithholds, __setHeldWithholdsForTests, heldWithholdsState,
} from '../components/chart/engine/heldWithholds'

/** The calls that take a door back from the test grant (or set admission, which the grant
 *  makes moot). ONE list: the static rail reads it, and `asMember` uses only names on it. */
export const GATE_NARROWINGS = Object.freeze([
  '__resetRuntimeAllowList', 'setRuntimeAllowList',
  '__resetRuntimePanePermission', 'latchRuntimePanePermission',
  '__resetHostKnownDivergence', '__setHostKnownDivergenceForTests',
  '__resetRuntimeAdmission', 'setRuntimeCapabilityAdmission', 'latchRuntimeAdmission',
  // ⭐ the held withholds (`engine/heldWithholds.js`), a declared door of the grant since the e89 follow-up
  '__resetHeldWithholds', '__setHeldWithholdsForTests',
])

/** The test grant (`src/test-setup.js`, every test). */
export function grantRuntimeGate() {
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  __ignoreHostKnownDivergenceForTests()
  __ignoreHeldWithholdsForTests()
}

/** The five doors as they stand, one comparable string: the allowlist (`*` under the grant),
 *  the pane permission latch, whether the host-known-divergence list is consulted, whether
 *  capability admission is latched on, and the held withholds' state (`ignored` under the grant). */
export function gateState() {
  return JSON.stringify([
    runtimeAllowList().join(','), runtimePanePermissionDebug().permitted,
    hostKnownDivergenceActive(), runtimeCapabilityAdmissionOn(), heldWithholdsState(),
  ])
}

/** ⭐ THE DECISION (pure). `granted` is the gate under the grant, `after` the gate as the last
 *  test LEFT it (or as the root `beforeAll` granted it), `now` the gate as this test is about to
 *  start. Only a hook outside any test runs between those two, so `now` differing from `after` is
 *  a hook's doing, and a hook that moved the gate AWAY from the grant is about to be undone by the
 *  re-grant: the suite would assert the member's doors under the grant. Returns the failure
 *  sentence, or null.
 *  ⭐ Three cases, railed: a beforeAll narrowing -> refused; a test that narrowed and left it so ->
 *  null (`now === after`; the re-grant is the default working); a hook that RESTORED the grant ->
 *  null (`now === granted`). */
export function gateNarrowedOutsideTest({ granted, after, now }) {
  if (now === granted || now === after) return null
  return `GATE-BLIND: a hook outside any test (beforeAll, or a describe's afterAll) narrowed the runtime gate `
    + `(${after} -> ${now}), and the test grant would undo it before this test runs, so the test would assert `
    + 'the member\'s doors under the grant. Narrow in beforeEach instead: asMember({...}) from src/testing/runtimeGate.js.'
}

/** ⛔ ONLY FOR A FILE THAT MEASURES WHILE IT IS COLLECTED (the vendor corpus harness grades every capture in its
 *  describe body, then its tests assert the STORED run, never the live gate). Takes back the doors it names at
 *  once, so the measurement that follows in the same collection sees the member's doors; the root hooks re-grant
 *  before the first test, which is harmless only because no test reads the gate. Anywhere else, use `asMember`.
 *    hkd  true: the host lane's known-divergence list APPLIED (the app's state). */
export function memberDoorsAtCollection({ hkd = true } = {}) {
  if (hkd === true) __resetHostKnownDivergence()
}

/** ⭐ Run every test in this scope behind the MEMBER'S doors. Call it at module or describe scope
 *  (it registers a `beforeEach`, which runs after the root re-grant). Each option names a door the
 *  test grant opens and this takes back:
 *    allow      true: the starter allowlist as the server leaves it (empty, nothing graded), or an
 *               array: that list latched.
 *    pane       true: the per-member pane permission unlatched (nothing heard from the server).
 *    hkd        true: the host lane's known-divergence list APPLIED (the app's state), or a list
 *               document (`{scripts: [...]}`): that list applied instead.
 *    admission  true: capability admission latched ON with no verdicts, as the server switches it on;
 *               an object `{ [sha256]: {admitted, historyOnly?} }`: those verdicts latched as well.
 *    held       true: the committed held withholds APPLIED (the app's state), or a withholds document
 *               (`{scripts: [...]}`): that one applied instead.
 *  Defaults are the member's doors the test grant hides most often: `{allow: true, hkd: true}`
 *  (a permitted member, admission off). Pass `false` to leave a door granted. */
export function asMember({ allow = true, pane = false, hkd = true, admission = false, held = false } = {}) {
  beforeEach(() => {
    if (allow === true) __resetRuntimeAllowList()
    else if (Array.isArray(allow)) setRuntimeAllowList(allow)
    if (pane === true) __resetRuntimePanePermission()
    if (hkd === true) __resetHostKnownDivergence()
    else if (hkd && typeof hkd === 'object') __setHostKnownDivergenceForTests(hkd)
    if (held === true) __resetHeldWithholds()
    else if (held && typeof held === 'object') __setHeldWithholdsForTests(held)
    if (admission) {
      __resetRuntimeAdmission()
      setRuntimeCapabilityAdmission(true)
      if (typeof admission === 'object') {
        for (const [hash, verdict] of Object.entries(admission)) latchRuntimeAdmission(hash, verdict)
      }
    }
  })
}
