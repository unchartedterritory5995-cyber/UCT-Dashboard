// app/src/hooks/useUserDefinitions.pendingPoll.test.jsx
//
// ⭐ A row "still being checked" (runtime capability admission, `meta.runtimePending`) must be READ
// AGAIN every PENDING_REFRESH_MS until the check lands, starting from a COLD load.
//
// ⚰️ 2026-11-16: the hook handed SWR the FUNCTION `pendingRefreshInterval`. SWR 2.4.0 calls a
// function-form `refreshInterval` once, when its polling effect starts, against the cache as it is
// THEN; on a cold load that is `undefined`, the function answers 0 and no timer is ever set. The
// only rail was a read of the source text for that very wiring, so it stayed green. This file
// measures the reads instead.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { AuthContext } from '../context/AuthContext'
import { useUserDefinitions, PENDING_REFRESH_MS } from './useUserDefinitions'

const PENDING = { def_id: 'u_aaaaaaaaaaaa', definition: { meta: { runtimePending: true, runtimeNotGraded: 'still being checked' } } }
const CHECKED = { def_id: 'u_aaaaaaaaaaaa', definition: { meta: {} } }

let rows = []
const reads = () => globalThis.fetch.mock.calls.filter(([u]) => String(u).includes('/api/user-definitions')).length
const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map() }}>
    <AuthContext.Provider value={{ user: { id: 'm1' } }}>{children}</AuthContext.Provider>
  </SWRConfig>
)
const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
    ok: true, status: 200, json: async () => ({ definitions: rows }),
  }))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('useUserDefinitions: the pending poll', () => {
  it('a COLD mount whose rows are still being checked reads the list again, and stops once checked', async () => {
    rows = [PENDING]
    const h = renderHook(() => useUserDefinitions(), { wrapper })
    await tick(50)
    expect(h.result.current.rows).toHaveLength(1)
    const first = reads()
    expect(first).toBeGreaterThanOrEqual(1)

    await tick(PENDING_REFRESH_MS + 50)
    expect(reads()).toBeGreaterThan(first)             // the poll STARTED from a cold key

    rows = [CHECKED]                                    // the server's check lands
    await tick(PENDING_REFRESH_MS + 50)
    const settled = reads()
    await tick(3 * PENDING_REFRESH_MS)
    expect(reads()).toBe(settled)                       // ...and the poll stopped
  })

  it('control: a list with nothing pending is read once and never polled', async () => {
    rows = [CHECKED]
    renderHook(() => useUserDefinitions(), { wrapper })
    await tick(50)
    const first = reads()
    expect(first).toBeGreaterThanOrEqual(1)
    await tick(3 * PENDING_REFRESH_MS)
    expect(reads()).toBe(first)
  })
})
