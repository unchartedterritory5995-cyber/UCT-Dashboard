// app/src/hooks/useUserDefinitions.keptGuards.test.jsx
//
// ─── THE KEPT DEFINITIONS LIST: THE MEMBER-DATA GUARDS (2026-11-26, coordinator review of the Fred RS load fix) ───────
//   G1 another member never sees it: a kept list is read for its own member only, and when the member changes (an
//      account switch, a sign-out) nothing installed for the previous member stays in the registry
//   G2 the store's answer REPLACES it: a definition deleted elsewhere is uninstalled, an edited one is installed as
//      edited; a kept row is never written back to the store
//   G3 a revoke still applies: a 401/402/403 answer clears the registry and forgets the kept list; the runtime kill and
//      admission gates read the definition the kept row installs, and the record carries no verdict of either
//   G4 a corrupt or oversized record is "nothing kept": no throw, the list is fetched as before
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { AuthContext } from '../context/AuthContext'
import { useInstalledUserDefinitions } from './useUserDefinitions'
import * as registry from '../components/chart/engine/nativeRegistry'
import { SCRIPT_ENGINE_VERSION } from '../components/chart/engine/scriptEngineVersion'
import { setRuntimeKillList, runtimeKillOf, setRuntimeCapabilityAdmission, runtimeAdmissionOf, __resetRuntimeAdmission } from '../components/chart/engine/runtimeKill'
import {
  DEFS_CACHE_KEY, DEFS_CACHE_MAX_CHARS, writeCachedDefinitionRows, readCachedDefinitionRows,
} from '../lib/userDefsCache'

const FIX = JSON.parse(fs.readFileSync(path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/authoring/batch2_definitions.json'), 'utf8'))
const A = 'u_aaaaaaaaaa51'
const B = 'u_aaaaaaaaaa52'
const row = (id, version = 4, name = null) => ({ def_id: id, version, rev: 1,
  definition: { ...FIX.styled_markers, id, version, meta: { ...(FIX.styled_markers.meta || {}), ...(name ? { name } : {}) } } })
const has = (id) => !!registry.getDefinition(id)

let respond = null
let user = { id: 'm1' }
function Wrapper({ children }) {
  return (
    <SWRConfig value={{ provider: () => new Map() }}>
      <AuthContext.Provider value={{ user }}>{children}</AuthContext.Provider>
    </SWRConfig>
  )
}
const frame = () => act(async () => { await new Promise((r) => setTimeout(r, 60)) })
const land = (status, definitions = []) => act(async () => {
  respond({ ok: status === 200, status, json: async () => ({ definitions }) })
  for (let i = 0; i < 20; i++) await Promise.resolve()
})

beforeEach(() => {
  user = { id: 'm1' }
  respond = null
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((resolve) => { respond = resolve }))
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks()
  for (const id of [A, B]) registry.uninstallUserDefinition(id)
  setRuntimeKillList([]); setRuntimeCapabilityAdmission(false); __resetRuntimeAdmission()
})

describe('the kept definitions list: member-data guards', () => {
  it('G1 a member switch: nothing kept or installed for m1 draws for m2', async () => {
    writeCachedDefinitionRows('m1', SCRIPT_ENGINE_VERSION, [row(A)])
    const h = renderHook(() => useInstalledUserDefinitions(), { wrapper: Wrapper })
    expect(has(A)).toBe(true)                       // m1's kept list, on the first render
    user = { id: 'm2' }
    h.rerender()
    expect(has(A), 'm1\'s definition still installed for m2').toBe(false)
    expect([...h.result.current.storeDefIds]).toEqual([])
  })

  it('G2 the store\'s answer replaces the kept list: deleted uninstalled, edited installed as edited, no write-back from a kept row', async () => {
    writeCachedDefinitionRows('m1', SCRIPT_ENGINE_VERSION, [row(A, 4, 'old name'), row(B)])
    const h = renderHook(() => useInstalledUserDefinitions(), { wrapper: Wrapper })
    expect(has(A) && has(B)).toBe(true)
    expect(registry.getDefinition(A).meta.name).toBe('old name')
    await frame()
    const puts = () => globalThis.fetch.mock.calls.filter(([, o]) => o && (o.method === 'PUT' || o.method === 'POST')).length
    expect(puts()).toBe(0)
    await land(200, [row(A, 5, 'new name')])
    expect(has(B), 'a definition deleted elsewhere kept drawing from the kept list').toBe(false)
    expect(registry.getDefinition(A).meta.name).toBe('new name')
    expect(registry.getDefinition(A).version).toBe(5)
    expect(readCachedDefinitionRows('m1', SCRIPT_ENGINE_VERSION).map((r) => r.version)).toEqual([5])
    h.unmount()
  })

  it('G3 a revoke: a 402 clears what the kept list installed and forgets the list', async () => {
    writeCachedDefinitionRows('m1', SCRIPT_ENGINE_VERSION, [row(A)])
    renderHook(() => useInstalledUserDefinitions(), { wrapper: Wrapper })
    expect(has(A)).toBe(true)
    await frame()
    await land(402)
    expect(has(A), 'a lapsed plan kept drawing from the kept list').toBe(false)
    expect(window.localStorage.getItem(DEFS_CACHE_KEY)).toBe(null)
  })

  it('G3b the kill and admission gates still answer for a kept definition; the record holds rows only', async () => {
    writeCachedDefinitionRows('m1', SCRIPT_ENGINE_VERSION, [row(A)])
    renderHook(() => useInstalledUserDefinitions(), { wrapper: Wrapper })
    const def = registry.getDefinition(A)
    setRuntimeKillList([A])
    expect(runtimeKillOf({ defId: def.id })).toMatch(/kill list/)
    setRuntimeCapabilityAdmission(true)
    expect(runtimeAdmissionOf({ source: 'indicator("kept")' }), 'a verdict came from the kept record').toBe(null)
    expect(Object.keys(JSON.parse(window.localStorage.getItem(DEFS_CACHE_KEY))).sort()).toEqual(['engine', 'owner', 'rows'])
  })

  it.each([
    ['not JSON', '{not json'],
    ['rows not a list', JSON.stringify({ owner: 'm1', engine: SCRIPT_ENGINE_VERSION, rows: { a: 1 } })],
    ['a row that cannot hydrate', JSON.stringify({ owner: 'm1', engine: SCRIPT_ENGINE_VERSION, rows: [{ def_id: A, definition: { compute: { graph: 42 } } }] })],
  ])('G4 a corrupt record (%s): nothing kept, no throw, the list is fetched', async (_n, text) => {
    window.localStorage.setItem(DEFS_CACHE_KEY, text)
    const h = renderHook(() => useInstalledUserDefinitions(), { wrapper: Wrapper })
    expect(has(A)).toBe(false)
    await frame()
    expect(globalThis.fetch.mock.calls.some(([u]) => String(u).includes('/api/user-definitions'))).toBe(true)
    h.unmount()
  })

  it('G4b a list over the size cap is not kept (and replaces nothing stale)', () => {
    writeCachedDefinitionRows('m1', SCRIPT_ENGINE_VERSION, [row(A)])
    const huge = [{ def_id: B, definition: { meta: { note: 'x'.repeat(DEFS_CACHE_MAX_CHARS) } } }]
    expect(writeCachedDefinitionRows('m1', SCRIPT_ENGINE_VERSION, huge)).toBe(false)
    expect(window.localStorage.getItem(DEFS_CACHE_KEY)).toBe(null)
  })
})
