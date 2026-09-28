// app/src/components/chart/builder/memberPane/runtimeLaneLazyDoor.test.jsx
//
// ─── ⭐⭐ THE RUNTIME LANE ARRIVES ON DEMAND — and waiting is not refusing ─────
//
// ⚰️ 2026-09-27: the door's first cut imported the runtime lane STATICALLY from
// `memberPaneDefinition.js` and `nativeRegistry.js`, which put the whole runtime
// in every page's eager bundle with the flag OFF (+328 KB, CI's `bytes` check).
// The lane is now a lazy chunk. This file is the behaviour of the wait: vitest
// gives each file its own module graph, and NOTHING here imports the lane, so the
// door really does meet an unloaded lane. `pineRuntimeFrontendGate.test.js` holds
// the source-level half (no static importer outside the chunk).
//
// ⚠️ `ChartPane` is mocked, as in `MemberPane.test.jsx`: this is about what the
// pane is handed and says, never about pixels.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, waitFor } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../../engine/nativeRegistry'
import {
  memberPaneDefinition, loadRuntimeLaneDoor, runtimeLaneDoorLoaded,
  RUNTIME_LANE_LOADING_REASON, MEMBER_PANE_DEF_PREFIX,
} from './memberPaneDefinition'
import { loadedPineRuntimeLane } from '../../engine/pineRuntimeLaneGate'

vi.mock('../../pane/ChartPane', () => ({
  default: () => <div data-testid="mock-chart-pane" />,
}))

const REPO = path.resolve(process.cwd(), '..')
const ADX = fs.readFileSync(
  path.join(REPO, 'corpus/committed', 'adx-and-di-for-v4__932.pine'), 'utf8')
const DEF = { kind: 'pine', source: ADX, columns: { value: { output: 0, call: 'plot' } } }
const BARS = [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }]

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  registry.uninstallUserDefinition(MEMBER_PANE_DEF_PREFIX)
})

// ⛔ ORDER IS THE POINT: the lane is loaded exactly once, by the last block, and
// every case before it runs against an unloaded lane. Vitest runs a file's tests
// in order by default; the first assertion of each case re-checks the state.
describe('⭐⭐ before the lane has loaded', () => {
  it('⭐ NON-VACUITY — nothing in this file has loaded the lane yet', () => {
    expect(runtimeLaneDoorLoaded()).toBe(false)
    expect(loadedPineRuntimeLane()).toBe(null)
  })

  it('flag ON: a script the host refuses is PENDING, not refused — and carries the host refusal', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
    expect(runtimeLaneDoorLoaded()).toBe(false)
    const d = memberPaneDefinition({ source: ADX, id: 'u_member-pane-lazy' })
    expect(d.ok).toBe(false)
    expect(d.pending).toBe('runtime-lane')
    expect(d.guard).toBe('runtime-door:loading')
    expect(d.reason).toBe(RUNTIME_LANE_LOADING_REASON)
    expect(d.hostRefusal && d.hostRefusal.guard).toMatch(/^pine:/)
    // ⛔ Asking is not loading: the door never starts the load itself.
    expect(runtimeLaneDoorLoaded()).toBe(false)
  })

  it('flag OFF: the same script is the host refusal it always was — never pending', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '')
    const d = memberPaneDefinition({ source: ADX, id: 'u_member-pane-lazy-off' })
    expect(d.ok).toBe(false)
    expect(d.pending).toBeUndefined()
    expect(d.guard).toMatch(/^pine:/)
  })

  it('computeFor on a runtime document names the missing lane per key — off vs loading', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '')
    const offCols = registry.computeFor({ id: 'x', compute: DEF }, BARS, {}, {})
    expect(Object.keys(offCols)).toEqual([])
    expect(registry.columnErrors(offCols).value.guard).toBe('runtime-door:off')
    expect(loadedPineRuntimeLane()).toBe(null)   // off does not start a load
  })
})

describe('⭐⭐ the member reads a wait, then the pane', () => {
  it('MemberPane shows the LOADING status (not the refusal), loads the lane, then attaches', async () => {
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
    expect(runtimeLaneDoorLoaded()).toBe(false)
    const { default: MemberPane } = await import('./MemberPane.jsx')
    render(<MemberPane sym="SPY" tf="D" source={ADX} />)
    // the wait, in words — and NOT the refusal testid
    expect(screen.getByTestId('pine-member-pane-loading').textContent)
      .toBe(RUNTIME_LANE_LOADING_REASON)
    expect(screen.queryByTestId('pine-member-pane-refusal')).toBe(null)
    // …then the second engine lands and the same source draws
    await waitFor(() => expect(screen.getByTestId('pine-member-pane')).toBeTruthy())
    expect(screen.queryByTestId('pine-member-pane-loading')).toBe(null)
    expect(runtimeLaneDoorLoaded()).toBe(true)
    // ⭐ loading the door filled the compute slot too — one chunk, both halves
    expect(loadedPineRuntimeLane()).not.toBe(null)
  })

  it('once loaded, the door answers at once with the runtime lane', async () => {
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
    await loadRuntimeLaneDoor()
    const d = memberPaneDefinition({ source: ADX, id: 'u_member-pane-lazy-2' })
    expect(d.ok).toBe(true)
    expect(d.lane).toBe('runtime')
    expect(d.pending).toBeUndefined()
  })
})
