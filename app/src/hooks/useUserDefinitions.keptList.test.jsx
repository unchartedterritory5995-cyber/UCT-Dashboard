// app/src/hooks/useUserDefinitions.keptList.test.jsx
//
// ─── THE LIST THIS MEMBER WAS LAST SERVED STARTS THE NEXT LOAD (2026-11-26, Fred RS load time) ──────────────────────
// Production (ecc0bb94, AGL 1D, Fred RS): the chart waited 0.6 s (warm) / 1.9 s (cold) after its candles for
// `GET /api/user-definitions`, because until it lands the registry has no Fred RS. The list as last served is kept and is
// SWR's first answer:
//   K1 a member with a kept list has its rows on the FIRST render, before the list request answers; the request is
//      still made, and its answer replaces the kept rows
//   K2 never another member's list, never another script engine's
//   K3 a served answer is kept (as served, for this member and engine)
//   K4 a definitive sign-out forgets it (AuthContext)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { AuthContext } from '../context/AuthContext'
import AUTH_SRC from '../context/AuthContext.jsx?raw'
import { useUserDefinitions } from './useUserDefinitions'
import { SCRIPT_ENGINE_VERSION } from '../components/chart/engine/scriptEngineVersion'
import { DEFS_CACHE_KEY, writeCachedDefinitionRows, readCachedDefinitionRows, clearCachedDefinitions } from '../lib/userDefsCache'

const KEPT = { def_id: 'u_kept0000000', version: 3, definition: { id: 'u_kept0000000', meta: { name: 'Fred RS' } } }
const SERVED = { def_id: 'u_srvd0000000', version: 1, definition: { id: 'u_srvd0000000', meta: { name: 'Served' } } }
const wrapperFor = (user) => function Wrapper({ children }) {
  return (
    <SWRConfig value={{ provider: () => new Map() }}>
      <AuthContext.Provider value={{ user }}>{children}</AuthContext.Provider>
    </SWRConfig>
  )
}
let answer = null
const reads = () => globalThis.fetch.mock.calls.filter(([u]) => String(u).includes('/api/user-definitions')).length

beforeEach(() => {
  window.localStorage.removeItem(DEFS_CACHE_KEY)
  answer = null
  // the list request answers only when the test releases it
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((resolve) => {
    answer = () => resolve({ ok: true, status: 200, json: async () => ({ definitions: [SERVED] }) })
  }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.removeItem(DEFS_CACHE_KEY) })

describe('useUserDefinitions: the kept list is the first answer', () => {
  it('K1 the member\'s kept rows on the first render, the list still read, its answer replaces them', async () => {
    writeCachedDefinitionRows('m1', SCRIPT_ENGINE_VERSION, [KEPT])
    const h = renderHook(() => useUserDefinitions(), { wrapper: wrapperFor({ id: 'm1' }) })
    expect(h.result.current.rows.map((r) => r.def_id)).toEqual(['u_kept0000000'])
    expect(h.result.current.isLoading).toBe(false)
    // (SWR revalidates a mount that already holds data one animation frame later)
    await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
    expect(reads()).toBe(1)
    await act(async () => { answer(); for (let i = 0; i < 10; i++) await Promise.resolve() })
    expect(h.result.current.rows.map((r) => r.def_id)).toEqual(['u_srvd0000000'])
  })

  it('K2 never another member\'s list, never another engine\'s', () => {
    writeCachedDefinitionRows('m2', SCRIPT_ENGINE_VERSION, [KEPT])
    const a = renderHook(() => useUserDefinitions(), { wrapper: wrapperFor({ id: 'm1' }) })
    expect(a.result.current.rows).toEqual([])
    cleanup()
    writeCachedDefinitionRows('m1', SCRIPT_ENGINE_VERSION - 1, [KEPT])
    const b = renderHook(() => useUserDefinitions(), { wrapper: wrapperFor({ id: 'm1' }) })
    expect(b.result.current.rows).toEqual([])
  })

  it('K3 a served answer is kept for this member and engine, as served', async () => {
    renderHook(() => useUserDefinitions(), { wrapper: wrapperFor({ id: 'm1' }) })
    await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
    await act(async () => { answer(); for (let i = 0; i < 10; i++) await Promise.resolve() })
    expect(readCachedDefinitionRows('m1', SCRIPT_ENGINE_VERSION)).toEqual([SERVED])
    expect(readCachedDefinitionRows('m2', SCRIPT_ENGINE_VERSION)).toBe(undefined)
  })

  it('K4 a definitive sign-out forgets it', () => {
    writeCachedDefinitionRows('m1', SCRIPT_ENGINE_VERSION, [KEPT])
    clearCachedDefinitions()
    expect(readCachedDefinitionRows('m1', SCRIPT_ENGINE_VERSION)).toBe(undefined)
    expect(AUTH_SRC).toMatch(/^import \{ clearCachedDefinitions \} from '\.\.\/lib\/userDefsCache'$/m)
    expect(AUTH_SRC).toMatch(/setSignedInHint\(false\)\s*\n\s*clearCachedDefinitions\(\)/)
  })
})
