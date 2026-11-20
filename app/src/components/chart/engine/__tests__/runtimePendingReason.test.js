// @vitest-environment node
// app/src/components/chart/engine/__tests__/runtimePendingReason.test.js
//
// ─── (2026-11-19) WHY A VERDICT IS STILL PENDING, KEPT FOR THE WINDOW ─────────────
//
// The server half is `tests/test_admission_gate_reshape.py`: a pending `POST /runtime-admission` answer
// carries `pending_reason` = busy | starting | paused. `runtimeKill.js::requestRuntimeAdmission` keeps the
// LAST one per source hash and `runtimePendingReasonOf({source})` hands it to the dock and the editor panel
// (which word the three states, and stop re-checking early on "paused"). Railed here:
//   * each of the three reasons is kept, under the answer's own hash only;
//   * a verdict that lands clears it (and the reason never outlives the verdict);
//   * a malformed reason (unknown word, wrong type, missing) is ignored, and replaces an older one;
//   * switching admission off forgets it.
// ⛔ Node environment on purpose: `window` is absent unless a test installs it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  setRuntimeKillList, __resetRuntimeAllowList, __resetRuntimeListsRecheck, setRuntimeCapabilityAdmission,
  requestRuntimeAdmission, __resetRuntimeAdmission, runtimeSourceHash, runtimePendingReasonOf,
  runtimeAdmissionOf, latchRuntimeAdmission, RUNTIME_PENDING_REASONS, RUNTIME_ADMISSION_PATH,
  RUNTIME_KILL_PATH, RUNTIME_ADMISSION_PENDING_RETRY_MS,
} from '../runtimeKill'

const SRC = '//@version=5\nindicator("mine")\nplot(close)\n'
const OTHER = '//@version=5\nindicator("theirs")\nplot(open)\n'
const H = runtimeSourceHash(SRC)
const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve() }
const okJson = (body) => ({ ok: true, json: async () => body })
const LISTS_ON = { kill: [], allow: [], capability_admission: true }
const pending = (reason, sha = H) => ({ sha256: sha, admitted: false, missing: ['pending'],
  ...(reason === undefined ? {} : { pending_reason: reason }) })

let fetchMock
const answer = (...bodies) => {
  const q = [...bodies]
  fetchMock.mockImplementation(async (url) => (url === RUNTIME_KILL_PATH ? okJson(LISTS_ON)
    : okJson(q.length > 1 ? q.shift() : q[0])))
}
const asks = () => fetchMock.mock.calls.filter((c) => c[0] === RUNTIME_ADMISSION_PATH).length

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-19T15:00:00Z'))
  __resetRuntimeAllowList()
  __resetRuntimeAdmission()
  setRuntimeKillList([])
  __resetRuntimeListsRecheck()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('window', {})
  setRuntimeCapabilityAdmission(true)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  __resetRuntimeAdmission()
  setRuntimeKillList([])
  __resetRuntimeListsRecheck()
})

describe('the server says why a verdict is still pending', () => {
  it('names exactly the three reasons the server sends', () => {
    expect(RUNTIME_PENDING_REASONS).toEqual(['busy', 'starting', 'paused'])
  })

  it.each(['busy', 'starting', 'paused'])('⭐ a "%s" answer is kept for that script', async (reason) => {
    answer(pending(reason))
    requestRuntimeAdmission(SRC)
    await flush()
    expect(asks()).toBe(1)
    expect(runtimePendingReasonOf({ source: SRC })).toBe(reason)
    expect(runtimePendingReasonOf({ hash: H.toUpperCase() })).toBe(reason)
    expect(runtimePendingReasonOf({ source: OTHER })).toBeNull()       // only under the answer's own hash
    expect(runtimeAdmissionOf({ hash: H })).toBeNull()                  // and it is still not a verdict
  })

  it('⛔ an answer for ANOTHER script keeps nothing under this one', async () => {
    answer(pending('paused', runtimeSourceHash(OTHER)))
    requestRuntimeAdmission(SRC)
    await flush()
    expect(runtimePendingReasonOf({ source: SRC })).toBeNull()
    expect(runtimePendingReasonOf({ source: OTHER })).toBeNull()
  })

  it('⭐ the verdict that lands clears it', async () => {
    answer(pending('busy'), { sha256: H, admitted: true, missing: [] })
    const p = requestRuntimeAdmission(SRC)
    await flush()
    expect(runtimePendingReasonOf({ source: SRC })).toBe('busy')
    await vi.advanceTimersByTimeAsync(RUNTIME_ADMISSION_PENDING_RETRY_MS)
    expect((await p).admitted).toBe(true)
    expect(runtimePendingReasonOf({ source: SRC })).toBeNull()
  })

  it('⭐ a verdict latched any other way clears it too (a refusal is a verdict, not pending)', async () => {
    answer(pending('starting'))
    requestRuntimeAdmission(SRC)
    await flush()
    latchRuntimeAdmission(H, { admitted: false })
    expect(runtimePendingReasonOf({ source: SRC })).toBeNull()
  })

  it.each([['an unknown word', 'later'], ['the wrong type', 3], ['an object', { reason: 'busy' }],
    ['upper case', 'BUSY'], ['no reason at all (an older server)', undefined]])(
    '⛔ %s is ignored, and replaces the older reason rather than leaving it standing', async (_label, bad) => {
      answer(pending('paused'), pending(bad))
      requestRuntimeAdmission(SRC)
      await flush()
      expect(runtimePendingReasonOf({ source: SRC })).toBe('paused')
      await vi.advanceTimersByTimeAsync(RUNTIME_ADMISSION_PENDING_RETRY_MS)
      await flush()
      expect(asks()).toBe(2)
      expect(runtimePendingReasonOf({ source: SRC })).toBeNull()
    })

  it('⛔ switching admission off forgets it', async () => {
    answer(pending('paused'))
    requestRuntimeAdmission(SRC)
    await flush()
    setRuntimeCapabilityAdmission(false)
    setRuntimeCapabilityAdmission(true)
    expect(runtimePendingReasonOf({ source: SRC })).toBeNull()
  })

  it('reads nothing for nothing', () => {
    expect(runtimePendingReasonOf()).toBeNull()
    expect(runtimePendingReasonOf({ source: '' })).toBeNull()
  })
})
