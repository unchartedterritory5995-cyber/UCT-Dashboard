// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.rt8DoorState.test.js
//
// ─── RT8 (step 87) — A "runtime" MEASUREMENT REALLY RUNS THE RUNTIME PANE ──────
//
// GT made the runtime pane need the build flag AND a per-member permission latched
// in module state, AND a graded script. `src/test-setup.js` grants the last two in
// a `beforeEach`. The corpus CLI graded in its `describe` body (collection time,
// before any hook), so with `VITE_PINE_RUNTIME_PANE_ENABLED=1` it reported exactly
// the objects-only numbers (measured at 476412b297: MATCH 79 / DIVERGE 80 /
// INCONCLUSIVE 136 either way). `harness.js::enterDoorState` now enters the state
// explicitly. These rails prove (1) the failure is real, (2) the helper enters the
// state from a cold latch, (3) NON-VACUITY: on a capture only the runtime lane can
// draw, the runtime state's verdict differs from the on state's, and (4) the flag
// names the helper stubs are the ones the gates read.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { gradeCapture, loadCapture, HARNESS_DIR, REPO, enterDoorState, withDoorState, doorGates, ambientDoorState, doorStateMismatch } from './harness'
import { __resetRuntimePanePermission } from '../../runtimePaneGate'
import { __resetRuntimeAllowList } from '../../runtimeKill'

afterEach(() => { vi.unstubAllEnvs() })

// fvg-trend RDDT 1D (from the listing): the host lane refuses it; RT6 graded it on
// the runtime lane (fvgCounter MATCH, bgcolor agree). A runtime-only script.
const RUNTIME_ONLY = 'fvg-trend-rddt-1d-2026-09-27'
const cap = () => loadCapture(path.join(HARNESS_DIR, `${RUNTIME_ONLY}.json`)).capture
const signature = (v) => JSON.stringify({
  verdict: v.verdict,
  plots: (v.plots || []).map((p) => [p.title, p.verdict]),
})

describe('RT8 — the door state is entered, never inherited', () => {
  it('reproduces the instrument failure: build flags on, latch cold => the runtime gate says NO', () => {
    __resetRuntimePanePermission()
    __resetRuntimeAllowList()
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    expect(doorGates().runtime).toBe(false)
  })

  it('enterDoorState("runtime") from a cold latch permits the member and grades every script', () => {
    __resetRuntimePanePermission()
    __resetRuntimeAllowList()
    const g = enterDoorState('runtime')
    expect(g).toMatchObject({ objectsOnly: true, runtime: true, runtimePermitted: true, runtimeAllow: '*' })
  })

  it('off and on states never draw through the runtime lane, even with the latch warm and the ambient flag set', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    expect(withDoorState('on', (g) => g)).toMatchObject({ objectsOnly: true, runtime: false })
    expect(withDoorState('off', (g) => g)).toMatchObject({ objectsOnly: false, runtime: false })
  })

  it('a run whose gates disagree with its state is refused, never measured (the cold-latch case)', () => {
    expect(doorStateMismatch('runtime', { objectsOnly: true, runtime: false })).toMatch(/door state runtime not entered/)
    expect(doorStateMismatch('on', { objectsOnly: true, runtime: true })).toMatch(/not entered/)
    expect(doorStateMismatch('off', { objectsOnly: true, runtime: false })).toMatch(/not entered/)
    // control: agreeing gates pass
    expect(doorStateMismatch('runtime', { objectsOnly: true, runtime: true })).toBe(null)
    expect(doorStateMismatch('off', { objectsOnly: false, runtime: false })).toBe(null)
  })

  it('refuses an unknown state by name', () => {
    expect(() => enterDoorState('runtme')).toThrow(/unknown door state/)
  })

  it('the CLI default state is read off the ambient build flags', () => {
    expect(ambientDoorState({})).toBe('off')
    expect(ambientDoorState({ VITE_PINE_OBJECTS_ONLY_PANE_ENABLED: '1' })).toBe('on')
    expect(ambientDoorState({ VITE_PINE_OBJECTS_ONLY_PANE_ENABLED: '1', VITE_PINE_RUNTIME_PANE_ENABLED: '1' })).toBe('runtime')
  })

  it('the flag names it stubs are the ones the two gates read (derived off their sources)', () => {
    const read = (f) => (fs.readFileSync(path.join(REPO, 'app/src/components/chart/engine', f), 'utf8')
      .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
    const harnessSrc = fs.readFileSync(path.join(__dirname, 'harness.js'), 'utf8')
    for (const name of [read('objectsOnlyPaneGate.js'), read('runtimePaneGate.js')]) {
      expect(name).toMatch(/^VITE_/)
      expect(harnessSrc).toContain(`vi.stubEnv('${name}'`)
    }
  })

  it('⛔ NON-VACUITY — on a runtime-only capture the runtime state grades differently from the on state', () => {
    const on = withDoorState('on', () => gradeCapture(cap()).verdict)
    // the collection-time failure: flags on, latch cold — must equal the on state
    __resetRuntimePanePermission()
    __resetRuntimeAllowList()
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const cold = gradeCapture(cap()).verdict
    vi.unstubAllEnvs()
    const runtime = withDoorState('runtime', () => gradeCapture(cap()).verdict)
    expect(signature(cold)).toBe(signature(on))
    expect(signature(runtime)).not.toBe(signature(on))
    // and the runtime state actually drew the plot the host lane cannot
    expect(runtime.plots.some((p) => p.title === 'fvgCounter' && p.verdict === 'MATCH')).toBe(true)
    expect(on.plots.some((p) => p.verdict === 'MATCH')).toBe(false)
  }, 120000)
})
