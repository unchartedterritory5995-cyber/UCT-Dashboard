// @vitest-environment node
// app/src/lib/runtimePaneRevocation.test.js
//
// ─── ⭐⭐ WS-I (2026-10-31, gap S6) — A SWITCH-OFF REACHES AN OPEN TAB ────────
//
// The server half is `tests/test_pine_runtime_switch_on.py` (WS-I section). This
// file rails the client half:
//   * the per-member permission latch is ONE-WAY: a later `false` REVOKES a `true`
//     (a later `true` over a `false` is still counted, not applied);
//   * a server-latched `true` older than RUNTIME_PERMISSION_RECHECK_MS makes the
//     next consult fire ONE background GET /api/auth/me and apply its answer;
//   * the kill list and allowlist, once read, re-read themselves the same way on
//     a stale consult (RUNTIME_LISTS_RECHECK_MS);
//   * none of it runs under the test grants, outside a page, or within the
//     interval, and a failed read changes nothing.
//
// ⛔ Node environment on purpose: `window` is ABSENT unless a test installs it,
// so the "never outside a page" guard is measured, not assumed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  latchRuntimePanePermission, runtimePanePermitted, runtimePanePermissionDebug,
  __resetRuntimePanePermission, __permitRuntimePaneForTests,
  RUNTIME_PERMISSION_RECHECK_MS, RUNTIME_PERMISSION_RECHECK_PATH,
} from './runtimePanePermission'
import {
  setRuntimeKillList, setRuntimeAllowList, runtimeKillOf, runtimeKillList, runtimeAllowList,
  runtimeNotGradedOf, __resetRuntimeAllowList, __resetRuntimeListsRecheck,
  __allowEveryRuntimeScriptForTests, RUNTIME_KILL_PATH, RUNTIME_LISTS_RECHECK_MS,
} from '../components/chart/engine/runtimeKill'

const H = 'a'.repeat(64)
const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() }
const okJson = (body) => ({ ok: true, json: async () => body })

let fetchMock
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-31T15:00:00Z'))
  __resetRuntimePanePermission()
  __resetRuntimeAllowList()
  __resetRuntimeListsRecheck()
  setRuntimeKillList([])
  __resetRuntimeListsRecheck()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('window', {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  setRuntimeKillList([])
  __resetRuntimeListsRecheck()
})

describe('WS-I S6 — the permission latch is one-way', () => {
  it('⭐ a later FALSE revokes a TRUE (the switch-off is applied, not counted)', () => {
    latchRuntimePanePermission({ pine_runtime_pane_enabled: true })
    expect(runtimePanePermitted()).toBe(true)
    latchRuntimePanePermission({ pine_runtime_pane_enabled: false })
    expect(runtimePanePermitted()).toBe(false)
    expect(runtimePanePermissionDebug().revocations).toBe(1)
    expect(runtimePanePermissionDebug().ignoredDisagreements).toBe(0)
  })

  it('⛔ a later TRUE over a FALSE is still counted, never applied (a grant waits for a reload)', () => {
    latchRuntimePanePermission({ pine_runtime_pane_enabled: false })
    latchRuntimePanePermission({ pine_runtime_pane_enabled: true })
    expect(runtimePanePermitted()).toBe(false)
    expect(runtimePanePermissionDebug().ignoredDisagreements).toBe(1)
  })
})

describe('WS-I S6 — a stale TRUE re-asks the server on its next consult', () => {
  it('within the interval: no request', () => {
    latchRuntimePanePermission({ pine_runtime_pane_enabled: true })
    vi.advanceTimersByTime(RUNTIME_PERMISSION_RECHECK_MS - 1)
    expect(runtimePanePermitted()).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('⭐ past it: ONE GET /api/auth/me, and a `false` there switches this tab off', async () => {
    fetchMock.mockResolvedValue(okJson({ pine_runtime_pane_enabled: false }))
    latchRuntimePanePermission({ pine_runtime_pane_enabled: true })
    vi.advanceTimersByTime(RUNTIME_PERMISSION_RECHECK_MS)
    expect(runtimePanePermitted()).toBe(true)          // this consult never waits
    expect(runtimePanePermitted()).toBe(true)          // nor fires twice
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(RUNTIME_PERMISSION_RECHECK_PATH)
    expect(RUNTIME_PERMISSION_RECHECK_PATH).toBe('/api/auth/me')
    await flush()
    expect(runtimePanePermitted()).toBe(false)
    expect(runtimePanePermissionDebug().revocations).toBe(1)
  })

  it('a `true` answer keeps it on and restarts the interval', async () => {
    fetchMock.mockResolvedValue(okJson({ pine_runtime_pane_enabled: true }))
    latchRuntimePanePermission({ pine_runtime_pane_enabled: true })
    vi.advanceTimersByTime(RUNTIME_PERMISSION_RECHECK_MS)
    runtimePanePermitted()
    await flush()
    expect(runtimePanePermitted()).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('⛔ a failed or non-ok read changes nothing and waits a full interval', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ pine_runtime_pane_enabled: false }) })
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    latchRuntimePanePermission({ pine_runtime_pane_enabled: true })
    vi.advanceTimersByTime(RUNTIME_PERMISSION_RECHECK_MS)
    runtimePanePermitted()
    await flush()
    expect(runtimePanePermitted()).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(RUNTIME_PERMISSION_RECHECK_MS)
    runtimePanePermitted()
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(runtimePanePermitted()).toBe(true)
  })

  it('⛔ never under the test grant, and never outside a page', () => {
    __permitRuntimePaneForTests()
    vi.advanceTimersByTime(RUNTIME_PERMISSION_RECHECK_MS * 5)
    expect(runtimePanePermitted()).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    __resetRuntimePanePermission()
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', fetchMock)            // a worker: fetch, but no window
    latchRuntimePanePermission({ pine_runtime_pane_enabled: true })
    vi.advanceTimersByTime(RUNTIME_PERMISSION_RECHECK_MS * 5)
    expect(runtimePanePermitted()).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('WS-I S6 — the kill list and allowlist re-read themselves once read', () => {
  it('⭐ a kill added after the read reaches the open tab on the next stale consult', async () => {
    setRuntimeKillList([])
    setRuntimeAllowList([H])
    fetchMock.mockResolvedValue(okJson({ kill: [H.slice(0, 12)], allow: [], save_enabled: false }))
    expect(runtimeKillOf({ hash: H })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(RUNTIME_LISTS_RECHECK_MS)
    expect(runtimeKillOf({ hash: H })).toBeNull()   // answers from the lists as they stand
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(RUNTIME_KILL_PATH)
    await flush()
    expect(runtimeKillList()).toEqual([H.slice(0, 12)])
    expect(runtimeKillOf({ hash: H })).toMatch(/kill list/)
    expect(runtimeAllowList()).toEqual([])
    expect(runtimeNotGradedOf({ hash: H })).toMatch(/not yet been graded/)
  })

  it('⛔ never before a first read, never under the test grant, never outside a page', () => {
    __resetRuntimeListsRecheck()                       // nothing read yet in this tab
    vi.advanceTimersByTime(RUNTIME_LISTS_RECHECK_MS * 5)
    runtimeKillOf({ hash: H })
    expect(fetchMock).not.toHaveBeenCalled()
    setRuntimeKillList([])
    __allowEveryRuntimeScriptForTests()
    vi.advanceTimersByTime(RUNTIME_LISTS_RECHECK_MS * 5)
    runtimeKillOf({ hash: H })
    expect(fetchMock).not.toHaveBeenCalled()
    __resetRuntimeAllowList()
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', fetchMock)
    runtimeKillOf({ hash: H })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('⛔ a failed read keeps the lists as they were', async () => {
    setRuntimeKillList([H])
    fetchMock.mockRejectedValue(new Error('offline'))
    vi.advanceTimersByTime(RUNTIME_LISTS_RECHECK_MS)
    runtimeKillOf({ hash: H })
    await flush()
    expect(runtimeKillList()).toEqual([H])
  })
})
