// app/src/hooks/useInstalledUserDefinitionsLaneHold.test.jsx
//
// ─── ⭐⭐ A STORED RUNTIME-LANE DOCUMENT WAITS FOR ITS ENGINE ─────────────────
//
// The runtime lane is a lazy chunk (`pineRuntimeLaneGate.js`). A page that loads
// a member's saved `compute.kind: 'pine'` document meets that lane UNLOADED, and
// installing the document then would compute as a named "still loading" error
// with nothing to ask it again. `useInstalledUserDefinitions` holds such a
// document back, loads the lane, and installs it on the next pass.
//
// ⛔ NOTHING IN THIS FILE IMPORTS THE LANE OR THE DOOR, so the lane really is
// absent at the start (vitest gives each file its own module graph) — the first
// case asserts exactly that, or every other case would be vacuous.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../components/chart/engine/nativeRegistry'
import { loadedPineRuntimeLane } from '../components/chart/engine/pineRuntimeLaneGate'
import { useInstalledUserDefinitions, USER_DEFINITIONS_KEY } from './useUserDefinitions'
import { AuthContext } from '../context/AuthContext'

const REPO = path.resolve(process.cwd(), '..')
const FX = JSON.parse(fs.readFileSync(
  path.join(REPO, 'tests/fixtures/pine_store/adx_round_trip.json'), 'utf8'))
const STORED_ID = FX.createResponse.def_id

function listFetch() {
  return vi.fn(async (url, init = {}) => {
    const u = String(url)
    const method = (init.method || 'GET').toUpperCase()
    if (method === 'GET' && u.split('?')[0] === USER_DEFINITIONS_KEY) {
      return { ok: true, status: 200, json: async () => FX.listResponse }
    }
    return { ok: false, status: 404, json: async () => ({ detail: `no route ${method} ${u}` }) }
  })
}

const wrapper = ({ children }) => createElement(
  AuthContext.Provider, { value: { user: { id: 'member-1', plan: 'pro' } } },
  createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, children),
)

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  for (const d of registry.listUserDefinitions()) registry.uninstallUserDefinition(d.id)
})

// ⛔ ORDER IS THE POINT: the lane loads once, in the second case, and never unloads.
describe('⭐⭐ a stored runtime-lane document and a lane that has not loaded', () => {
  it('⭐ NON-VACUITY — the lane is absent, and the fixture really is a runtime document', () => {
    expect(loadedPineRuntimeLane()).toBe(null)
    const row = FX.listResponse.definitions.find((r) => r.def_id === STORED_ID)
    expect(row.definition.compute.kind).toBe('pine')
  })

  it('flag ON: it is HELD (named, not installed), the lane loads, then it installs and computes', async () => {
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
    vi.stubGlobal('fetch', listFetch())
    const { result } = renderHook(() => useInstalledUserDefinitions(), { wrapper })
    // held first — said by name, never silently missing
    await waitFor(() => expect(result.current.errors.join('\n'))
      .toMatch(new RegExp(`${STORED_ID}: runs in the chart's second engine, which is still loading`)))
    expect(result.current.installedIds).not.toContain(STORED_ID)
    // …then the lane arrives and the same row installs
    await waitFor(() => expect(result.current.installedIds).toContain(STORED_ID))
    expect(result.current.errors).toEqual([])
    expect(loadedPineRuntimeLane()).not.toBe(null)
    const cols = registry.computeFor(registry.getDefinition(STORED_ID),
      [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }, { t: 2, o: 1, h: 2, l: 1, c: 2, v: 1 }],
      undefined, { tf: 'D', newestBarIsForming: false })
    // ⛔ not the "still loading" answer any more — the lane is what computed it
    const errs = Object.values(registry.columnErrors(cols) || {}).map((e) => e.guard)
    expect(errs).not.toContain('runtime-door:loading')
  })
})

describe('⛔ flag OFF — nothing is held', () => {
  it('the row goes straight to the install door, which refuses it by name', async () => {
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '')
    vi.stubGlobal('fetch', listFetch())
    const { result } = renderHook(() => useInstalledUserDefinitions(), { wrapper })
    await waitFor(() => expect(result.current.errors.length).toBeGreaterThan(0))
    const text = result.current.errors.join('\n')
    expect(text).toMatch(/compute\.kind "pine" is declared but this client cannot run it/)
    expect(text).not.toMatch(/second engine/)
  })
})
