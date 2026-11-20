// app/src/testing/runtimeGate.test.js
//
// ⭐ The GATE-BLIND rail's decision, and the proof that `src/test-setup.js` actually runs it.
// A pure function nobody calls is green and unreachable, so the wiring is railed here too: through
// the real root hooks, in this file's own describes (vitest runs them in order).
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { gateNarrowedOutsideTest, gateState, grantRuntimeGate, asMember, GATE_NARROWINGS } from './runtimeGate'
import * as runtimeKill from '../components/chart/engine/runtimeKill'
import * as paneGate from '../components/chart/engine/runtimePaneGate'
import * as hkd from '../components/chart/engine/hostKnownDivergence'

const G = 'granted'
describe('gateNarrowedOutsideTest: the decision (pure)', () => {
  it('a hook outside any test (beforeAll) narrowed the gate: refused, by name, naming both states', () => {
    const why = gateNarrowedOutsideTest({ granted: G, after: G, now: 'member' })
    expect(why).toMatch(/^GATE-BLIND: /)
    expect(why).toContain('(granted -> member)')
    expect(why).toMatch(/asMember/)
  })
  it('a test narrowed the gate and left it so: not refused (the re-grant is the default working)', () => {
    expect(gateNarrowedOutsideTest({ granted: G, after: 'member', now: 'member' })).toBeNull()
  })
  it('a hook RESTORED the grant after a test that narrowed: not refused', () => {
    expect(gateNarrowedOutsideTest({ granted: G, after: 'member', now: G })).toBeNull()
  })
  it('CONTROL: a hook that narrowed further after a narrowing test is still refused', () => {
    expect(gateNarrowedOutsideTest({ granted: G, after: 'member', now: 'member+admission' })).toMatch(/^GATE-BLIND/)
  })
})

describe('gateState: every door the grant opens moves it', () => {
  it('the allowlist, the pane permission, the host-known-divergence list and admission each change the state', () => {
    grantRuntimeGate()
    const granted = gateState()
    const moves = [
      [() => runtimeKill.__resetRuntimeAllowList(), () => runtimeKill.__allowEveryRuntimeScriptForTests()],
      [() => paneGate.__resetRuntimePanePermission(), () => paneGate.__permitRuntimePaneForTests()],
      [() => hkd.__resetHostKnownDivergence(), () => hkd.__ignoreHostKnownDivergenceForTests()],
      [() => runtimeKill.setRuntimeCapabilityAdmission(true), () => runtimeKill.__resetRuntimeAdmission()],
    ]
    for (const [narrow, restore] of moves) {
      narrow()
      expect(gateState()).not.toBe(granted)
      restore()
      expect(gateState()).toBe(granted)
    }
  })
  it('the narrowing list names only real exports of the gate modules', () => {
    const exported = new Set([...Object.keys(runtimeKill), ...Object.keys(paneGate), ...Object.keys(hkd)])
    for (const name of GATE_NARROWINGS) expect(exported.has(name), name).toBe(true)
  })
})

// ─── THE WIRING: the real root hooks of src/test-setup.js ─────────────────────────────────
describe('wired: a test that narrows is re-granted before the next one', () => {
  it('narrows the allowlist and leaves it narrowed', () => {
    runtimeKill.__resetRuntimeAllowList()
    expect(runtimeKill.runtimeAllowList()).toEqual([])
  })
  it('the next test starts under the grant, and was not refused', () => {
    expect(runtimeKill.runtimeAllowList()).toEqual(['*'])
  })
})

describe('wired: a file afterEach that narrows is not a hook outside a test', () => {
  afterEach(() => { hkd.__resetHostKnownDivergence() })
  it('first', () => { expect(hkd.hostKnownDivergenceActive()).toBe(false) })
  it('second: re-granted, not refused', () => { expect(hkd.hostKnownDivergenceActive()).toBe(false) })
})

describe('wired: asMember narrows in beforeEach, after the re-grant, for every test in its scope', () => {
  asMember({ allow: true, hkd: true, admission: true })
  it('first test: the member\'s doors', () => {
    expect(runtimeKill.runtimeAllowList()).toEqual([])
    expect(hkd.hostKnownDivergenceActive()).toBe(true)
    expect(runtimeKill.runtimeCapabilityAdmissionOn()).toBe(true)
    expect(paneGate.runtimePanePermitted()).toBe(true) // pane left granted by default
  })
  it('second test: the member\'s doors again (the root re-grant ran first, and was not refused)', () => {
    expect(runtimeKill.runtimeAllowList()).toEqual([])
    expect(hkd.hostKnownDivergenceActive()).toBe(true)
  })
})

describe('wired: asMember leaves alone what it is told to (allow: false)', () => {
  asMember({ allow: false, hkd: true })
  it('the allowlist stays granted; the host list is applied', () => {
    expect(runtimeKill.runtimeAllowList()).toEqual(['*'])
    expect(hkd.hostKnownDivergenceActive()).toBe(true)
  })
})

// ⛔ The refusal itself, through the real hook: this describe narrows in beforeAll, so the root
// beforeEach must fail its first test. `it.fails` passes only if the test FAILS. Its body asserts the
// BLIND outcome (the grant silently re-applied), so without the detector the body PASSES and
// `it.fails` goes red: the case cannot pass by the body failing for an unrelated reason.
describe('wired: a beforeAll narrowing fails the next test (GATE-BLIND), never runs it under the grant', () => {
  beforeAll(() => { runtimeKill.__resetRuntimeAllowList() })
  it.fails('BLIND would be: the grant silently re-applied over the beforeAll narrowing', () => {
    expect(runtimeKill.runtimeAllowList()).toEqual(['*'])
  })
})
