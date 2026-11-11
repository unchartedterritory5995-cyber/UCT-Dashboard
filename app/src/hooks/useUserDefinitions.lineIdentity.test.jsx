// app/src/hooks/useUserDefinitions.lineIdentity.test.jsx
//
// ⭐ LINE IDENTITY — the store serves a definition byte for byte as stored and its lines'
// identities BESIDE it (`plot_identities`). The copy this browser holds after a LIST LOAD
// (the real fetcher, the real SWR, the real install door) wears them, so
// `lineIdentity(plot)` answers the served identity.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'

import { AuthContext } from '../context/AuthContext'
import { useInstalledUserDefinitions, readUserDefinition, fetchDefinitionHistory } from './useUserDefinitions'
import * as registry from '../components/chart/engine/nativeRegistry'
import { lineIdentity } from '../components/chart/engine/lineIdentity'

const FIX = JSON.parse(fs.readFileSync(path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/authoring/batch2_definitions.json'), 'utf8'))
const ID = 'u_aaaaaaaaab01'
const UID = 'p_0123456789ab'
const definition = () => ({ ...FIX.styled_markers, id: ID, version: 4 })
const served = (identities) => ({ def_id: ID, version: 4, rev: 1, definition: definition(), plot_identities: identities })
const wrapper = ({ children }) => (
  <AuthContext.Provider value={{ user: { id: 'm1' } }}>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>{children}</SWRConfig>
  </AuthContext.Provider>
)
const stub = (body) => {
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }))
}

afterEach(() => { cleanup(); registry.clearUserDefinitions(); vi.restoreAllMocks(); delete global.fetch })

describe('a list load attaches the served identities to the held copy', () => {
  it('a served uid is what lineIdentity answers for the held plot', async () => {
    stub({ definitions: [served({ buy: UID })] })
    const h = renderHook(() => useInstalledUserDefinitions(), { wrapper })
    await waitFor(() => expect(registry.getDefinition(ID)).toBeTruthy())
    const held = registry.getDefinition(ID)
    expect(lineIdentity(held.plots.find((p) => p.key === 'buy'))).toBe(UID)
    h.unmount()
  })

  it('CONTROL — a pre-identity line (`k:<key>`) gets no field and still answers k:<key>', async () => {
    stub({ definitions: [served({ buy: 'k:buy' })] })
    const h = renderHook(() => useInstalledUserDefinitions(), { wrapper })
    await waitFor(() => expect(registry.getDefinition(ID)).toBeTruthy())
    const plot = registry.getDefinition(ID).plots.find((p) => p.key === 'buy')
    expect('uid' in plot).toBe(false)
    expect(lineIdentity(plot)).toBe('k:buy')
    h.unmount()
  })

  it('the single read and the history read attach them too', async () => {
    stub(served({ buy: UID }))
    const one = await readUserDefinition(ID)
    expect(lineIdentity(one.row.definition.plots[0])).toBe(UID)
    stub({ versions: [served({ buy: UID })] })
    const hist = await fetchDefinitionHistory(ID)
    expect(lineIdentity(hist.versions[0].definition.plots[0])).toBe(UID)
  })
})
