// app/src/hooks/useUserDefinitions.bootRequest.test.jsx
//
// ─── (e101 S5, 2026-11-27, chart speed) THE DEFINITIONS LIST LEAVES AS THE CHART CHUNK LOADS ─────────────────────────
// Production (608bd20bf1, AGL 1D, cold): the StockChart chunk was in at 751 ms, and the list was asked only at 1797, by
// the first render's SWR hook. It answered at 2303, 370 ms after the candles. Now `StockChart.jsx` starts it when its
// module evaluates (`startUserDefinitionsBootRequest`), and the hook's fetcher takes that request:
//   B1 started only when this browser was signed in last time; once; with the session cookie; the SAME request the
//      hook would send (capability flag and engine)
//   B2 the hook's first read takes it for the member the boot /me named: no second request, the same rows
//   B3 another member's (or no named member's) boot answer is dropped unread, and the hook fetches its own
//   B4 a failed boot request is no answer: the hook fetches as before
//   B5 one use: a later read (a save's revalidation) fetches its own
//   B6 StockChart starts it at module scope, outside tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { AuthContext } from '../context/AuthContext'
import STOCKCHART_SRC from '../components/StockChart.jsx?raw'
import { useUserDefinitions, startUserDefinitionsBootRequest } from './useUserDefinitions'
import { SCRIPT_ENGINE_VERSION } from '../components/chart/engine/scriptEngineVersion'
import { DEFS_CACHE_KEY } from '../lib/userDefsCache'
import { SIGNED_IN_HINT, __resetBootFetchForTests, noteBootUser } from '../lib/bootFetch'

const LIST_URL = `/api/user-definitions?graph=1&engine=${SCRIPT_ENGINE_VERSION}`
const BOOT_ROW = { def_id: 'u_boot0000000', version: 1, definition: { id: 'u_boot0000000', meta: { name: 'Boot' } } }
const OWN_ROW = { def_id: 'u_own00000000', version: 1, definition: { id: 'u_own00000000', meta: { name: 'Own' } } }
const reply = (row) => ({ ok: true, status: 200, json: async () => ({ definitions: [row] }) })
const signedIn = () => ({ getItem: (k) => (k === SIGNED_IN_HINT ? '1' : null), setItem() {}, removeItem() {} })
const signedOut = () => ({ getItem: () => null, setItem() {}, removeItem() {} })
const wrapperFor = (user) => function Wrapper({ children }) {
  return (
    <SWRConfig value={{ provider: () => new Map() }}>
      <AuthContext.Provider value={{ user }}>{children}</AuthContext.Provider>
    </SWRConfig>
  )
}
const listReads = () => globalThis.fetch.mock.calls.filter(([u]) => String(u).includes('/api/user-definitions')).length
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 60)); for (let i = 0; i < 10; i++) await Promise.resolve() }) }

beforeEach(() => {
  window.localStorage.removeItem(DEFS_CACHE_KEY)
  __resetBootFetchForTests()
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(reply(OWN_ROW)))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); __resetBootFetchForTests(); window.localStorage.removeItem(DEFS_CACHE_KEY) })

describe('the definitions list starts as the chart chunk loads', () => {
  it('B1 only when signed in last time, once, with the session cookie, the same request the hook sends', async () => {
    const off = vi.fn(() => Promise.resolve(reply(BOOT_ROW)))
    expect(startUserDefinitionsBootRequest({ fetchImpl: off, storage: signedOut() })).toBe(false)
    await Promise.resolve()
    expect(off).not.toHaveBeenCalled()
    const on = vi.fn(() => Promise.resolve(reply(BOOT_ROW)))
    expect(startUserDefinitionsBootRequest({ fetchImpl: on, storage: signedIn() })).toBe(true)
    expect(startUserDefinitionsBootRequest({ fetchImpl: on, storage: signedIn() })).toBe(false)
    await Promise.resolve(); await Promise.resolve()
    expect(on.mock.calls).toEqual([[LIST_URL, { credentials: 'include' }]])
  })

  it('B2 the first read takes it for the member the boot /me named: no second request, the boot rows', async () => {
    startUserDefinitionsBootRequest({ fetchImpl: () => Promise.resolve(reply(BOOT_ROW)), storage: signedIn() })
    noteBootUser('m1')
    const h = renderHook(() => useUserDefinitions(), { wrapper: wrapperFor({ id: 'm1' }) })
    await settle()
    expect(listReads()).toBe(0)
    expect(h.result.current.rows.map((r) => r.def_id)).toEqual(['u_boot0000000'])
  })

  it('B3 another member\'s boot answer (or one no /me named) is dropped unread: the hook fetches its own', async () => {
    for (const named of ['m2', null]) {
      __resetBootFetchForTests()
      cleanup()
      globalThis.fetch.mockClear()
      startUserDefinitionsBootRequest({ fetchImpl: () => Promise.resolve(reply(BOOT_ROW)), storage: signedIn() })
      noteBootUser(named)
      const h = renderHook(() => useUserDefinitions(), { wrapper: wrapperFor({ id: 'm1' }) })
      await settle()
      expect(listReads(), String(named)).toBe(1)
      expect(h.result.current.rows.map((r) => r.def_id), String(named)).toEqual(['u_own00000000'])
    }
  })

  it('B4 a failed boot request is no answer: the hook fetches as before', async () => {
    startUserDefinitionsBootRequest({ fetchImpl: () => Promise.reject(new Error('net')), storage: signedIn() })
    noteBootUser('m1')
    const h = renderHook(() => useUserDefinitions(), { wrapper: wrapperFor({ id: 'm1' }) })
    await settle()
    expect(listReads()).toBe(1)
    expect(h.result.current.rows.map((r) => r.def_id)).toEqual(['u_own00000000'])
  })

  it('B5 one use: a later read fetches its own', async () => {
    startUserDefinitionsBootRequest({ fetchImpl: () => Promise.resolve(reply(BOOT_ROW)), storage: signedIn() })
    noteBootUser('m1')
    const h = renderHook(() => useUserDefinitions(), { wrapper: wrapperFor({ id: 'm1' }) })
    await settle()
    expect(listReads()).toBe(0)
    await act(async () => { await h.result.current.refresh() })
    await settle()
    expect(listReads()).toBe(1)
    expect(h.result.current.rows.map((r) => r.def_id)).toEqual(['u_own00000000'])
  })

  it('B6 StockChart starts it at module scope, outside tests', () => {
    expect(STOCKCHART_SRC).toMatch(/^if \(import\.meta\.env\.MODE !== 'test'\) startUserDefinitionsBootRequest\(\)$/m)
  })
})
