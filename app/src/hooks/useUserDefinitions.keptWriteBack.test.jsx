// app/src/hooks/useUserDefinitions.keptWriteBack.test.jsx
//
// ─── THE KEPT DEFINITIONS LIST NEVER WRITES TO THE STORE, AND A ROW THAT CANNOT BE READ IS NOT A CRASH (2026-11-26) ───
//   W1 a kept row the saved-script upgrade would write back is NOT written back; the store's own answer of the same row
//      is (the upgrade module is stubbed to plan a write-back for every row, so the rail sees the gate itself)
//   W2 a kept row whose hydration throws: nothing kept is installed, nothing throws, the list is fetched
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'

const writeBacks = []
vi.mock('../components/chart/builder/memberPane/savedScriptUpgrade', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    resolveRow: (row) => ({ definition: row.definition, writeBack: { row } }),
    writeBackOnce: (plan) => { writeBacks.push(plan.row.def_id) },
  }
})
vi.mock('../components/chart/engine/lineIdentity', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, withServedRowIdentities: (row) => { if (row && row.def_id === 'u_throwsthrows') throw new Error('unreadable'); return real.withServedRowIdentities(row) } }
})

import { AuthContext } from '../context/AuthContext'
import { useInstalledUserDefinitions } from './useUserDefinitions'
import * as registry from '../components/chart/engine/nativeRegistry'
import { SCRIPT_ENGINE_VERSION } from '../components/chart/engine/scriptEngineVersion'
import { writeCachedDefinitionRows } from '../lib/userDefsCache'

const FIX = JSON.parse(fs.readFileSync(path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/authoring/batch2_definitions.json'), 'utf8'))
const A = 'u_aaaaaaaaaa61'
const row = (id) => ({ def_id: id, version: 4, rev: 1, definition: { ...FIX.styled_markers, id, version: 4 } })
let respond = null
function Wrapper({ children }) {
  return (
    <SWRConfig value={{ provider: () => new Map() }}>
      <AuthContext.Provider value={{ user: { id: 'm1' } }}>{children}</AuthContext.Provider>
    </SWRConfig>
  )
}
const frame = () => act(async () => { await new Promise((r) => setTimeout(r, 60)) })

beforeEach(() => {
  writeBacks.length = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((resolve) => { respond = resolve }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); registry.uninstallUserDefinition(A) })

describe('the kept list never writes to the store; an unreadable kept row is not a crash', () => {
  it('W1 no write-back from a kept row; the store\'s answer of the same row is written back', async () => {
    writeCachedDefinitionRows('m1', SCRIPT_ENGINE_VERSION, [row(A)])
    renderHook(() => useInstalledUserDefinitions(), { wrapper: Wrapper })
    await frame()
    expect(registry.getDefinition(A)).toBeTruthy()
    expect(writeBacks, 'a kept row was written back to the store').toEqual([])
    await act(async () => {
      respond({ ok: true, status: 200, json: async () => ({ definitions: [row(A)] }) })
      for (let i = 0; i < 20; i++) await Promise.resolve()
    })
    expect(writeBacks).toEqual([A])
  })

  it('W2 a kept row whose hydration throws: nothing kept installed, no throw, the list fetched', async () => {
    writeCachedDefinitionRows('m1', SCRIPT_ENGINE_VERSION, [row('u_throwsthrows')])
    const h = renderHook(() => useInstalledUserDefinitions(), { wrapper: Wrapper })
    expect(registry.getDefinition('u_throwsthrows')).toBeFalsy()
    await frame()
    expect(globalThis.fetch.mock.calls.some(([u]) => String(u).includes('/api/user-definitions'))).toBe(true)
    h.unmount()
  })
})
