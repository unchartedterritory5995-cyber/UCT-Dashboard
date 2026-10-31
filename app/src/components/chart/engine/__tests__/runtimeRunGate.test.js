// @vitest-environment node
// app/src/components/chart/engine/__tests__/runtimeRunGate.test.js
//
// ─── ⭐⭐ WS-I (2026-10-31, gap S6) — A LOADED LANE STOPS ON ITS NEXT RUN ─────
//
// Once the runtime lane was loaded, `nativeRegistry.runtimeColumnsOrReasons`
// consulted neither the gate nor the kill list again, so a switch-off or a kill
// that reached the tab (the latch's one-way revocation, the lists' re-read,
// `app/src/lib/runtimePaneRevocation.test.js`) never stopped a pane already
// drawing. Every run now re-asks both. This rails it with a STAND-IN lane (the
// question is the door in front of the lane, not the lane's own maths).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  computeFor, columnErrors, registerRuntimeLane,
  RUNTIME_SWITCHED_OFF_GUARD, RUNTIME_KILLED_GUARD,
} from '../nativeRegistry'
import {
  latchRuntimePanePermission, __resetRuntimePanePermission, __permitRuntimePaneForTests,
} from '../runtimePaneGate'
import { setRuntimeKillList, runtimeSourceHash, __resetRuntimeListsRecheck } from '../runtimeKill'

const DEF = {
  id: 'u_00000000a1b2', version: 1,
  compute: { kind: 'runtime', source: '//@version=5\nindicator("x")\nplot(close)\n', outputs: { value: 0 } },
  plots: [{ key: 'value' }],
}
const BARS = [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }]

let lane
beforeEach(() => {
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __resetRuntimePanePermission()
  setRuntimeKillList([])
  __resetRuntimeListsRecheck()
  lane = vi.fn(() => ({ value: [42] }))
  registerRuntimeLane(lane)
})
afterEach(() => {
  registerRuntimeLane(null)
  setRuntimeKillList([])
  __resetRuntimeListsRecheck()
  vi.unstubAllEnvs()
})

const run = () => computeFor(DEF, BARS, {}, {})

describe('WS-I S6 — every run re-asks the per-member permission', () => {
  it('⭐ draws while permitted, and the NEXT run after a revocation draws nothing and says why', () => {
    latchRuntimePanePermission({ pine_runtime_pane_enabled: true })
    expect(run().value).toEqual([42])
    expect(lane).toHaveBeenCalledTimes(1)
    latchRuntimePanePermission({ pine_runtime_pane_enabled: false })   // the switch-off lands
    const off = run()
    expect(off.value).toBeUndefined()
    expect(columnErrors(off).value.guard).toBe(RUNTIME_SWITCHED_OFF_GUARD)
    expect(columnErrors(off).value.message).toMatch(/switched off/)
    expect(lane).toHaveBeenCalledTimes(1)                              // the lane never ran
  })

  it('a permission that comes back draws again (nothing was deleted)', () => {
    latchRuntimePanePermission({ pine_runtime_pane_enabled: false })
    expect(columnErrors(run()).value.guard).toBe(RUNTIME_SWITCHED_OFF_GUARD)
    __permitRuntimePaneForTests()
    expect(run().value).toEqual([42])
  })

  it('⛔ it is the per-member PERMISSION that is asked (nothing latched = off)', () => {
    __resetRuntimePanePermission()
    expect(columnErrors(run()).value.guard).toBe(RUNTIME_SWITCHED_OFF_GUARD)
    expect(lane).not.toHaveBeenCalled()
  })
})

describe('WS-I S6 — every run re-asks the kill list', () => {
  it.each([
    ['its definition id', () => DEF.id],
    ['its source sha256 prefix', () => runtimeSourceHash(DEF.compute.source).slice(0, 12)],
  ])('⭐ a script killed by %s stops on its next run, and comes back when unlisted', (_n, entry) => {
    __permitRuntimePaneForTests()
    expect(run().value).toEqual([42])
    setRuntimeKillList([entry()])
    const killed = run()
    expect(killed.value).toBeUndefined()
    expect(columnErrors(killed).value.guard).toBe(RUNTIME_KILLED_GUARD)
    expect(columnErrors(killed).value.message).toMatch(/kill list/)
    expect(lane).toHaveBeenCalledTimes(1)
    setRuntimeKillList([])
    expect(run().value).toEqual([42])
  })

  it('control: a different script on the list does not stop this one', () => {
    __permitRuntimePaneForTests()
    setRuntimeKillList(['u_ffffffffffff', 'f'.repeat(64)])
    expect(run().value).toEqual([42])
  })
})
