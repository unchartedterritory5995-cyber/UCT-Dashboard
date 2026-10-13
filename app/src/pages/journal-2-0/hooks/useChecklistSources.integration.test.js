// R-T7-2 / I-3 point 4: the half of the seam rail no static check can see. The REAL hooks behind
// useChecklistSources (useJ2Settings, useJ2SelectedAccount, useJournalRules), nothing mocked but
// `fetch`, an SWR cache emptied by test-setup. Everything the seam can make happen on the wire,
// including `retrySettings()`, must be a GET: if `useJ2Settings().refresh` (or anything else the seam
// reaches) ever becomes a write, this goes red where blockDoors.test.js cannot look.
// ⚠️ BLIND SPOTS, stated rather than chased (R-T7-3 N-5): the method is read only from fetch's `init`,
// so a `fetch(new Request(url, { method: 'PUT' }))` inside one of the hooks would pass here; and an
// XHR or `navigator.sendBeacon` added inside a hook bypasses `fetch` entirely. blockDoors.test.js ⑤
// sees all three only in the seam's OWN file, never inside the hooks it composes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import useChecklistSources from './useChecklistSources'

const KEY = 'uct.j2.selectedAccountId'
let calls = []

function respond(url) {
  if (url.endsWith('/api/j2/accounts')) return { accounts: [{ id: 'a1', name: 'Main' }] }
  if (url.includes('/api/j2/accounts/a1/settings')) return { setups: ['VCP'], setupRules: { VCP: [{ id: 's1', label: 'Volume dry-up' }] } }
  if (url.includes('/api/j2/accounts/a1/rules')) return [{ id: 'r1', label: 'Rule one', beforeEntry: true }]
  return {}
}

beforeEach(() => {
  calls = []
  localStorage.setItem(KEY, 'a1')
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    calls.push({ url: String(url), method: String(init?.method ?? 'GET').toUpperCase() })
    return { ok: true, status: 200, json: async () => respond(String(url)) }
  }))
})
afterEach(() => { vi.unstubAllGlobals(); localStorage.removeItem(KEY) })

const settingsReads = () => calls.filter((c) => c.url.includes('/api/j2/accounts/a1/settings')).length

describe('useChecklistSources over the real hooks: every request is a GET', () => {
  it('reads settings and rules, and retrySettings() re-reads with GETs only', async () => {
    const { result } = renderHook(() => useChecklistSources({ wantRules: true }))
    await waitFor(() => expect(result.current.settingsState).toBe('ready'))
    await waitFor(() => expect(result.current.rulesState).toBe('ready'))
    // non-vacuity: the real hooks really fetched, through this stub
    expect(calls.map((c) => c.url)).toEqual(expect.arrayContaining([
      '/api/j2/accounts', '/api/j2/accounts/a1/settings', '/api/j2/accounts/a1/rules?status=active',
    ]))
    expect(result.current.rules).toEqual([{ id: 'r1', label: 'Rule one', beforeEntry: true }])
    const before = settingsReads()
    act(() => { result.current.retrySettings() })
    await waitFor(() => expect(settingsReads()).toBeGreaterThan(before))
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([])
  })
})
