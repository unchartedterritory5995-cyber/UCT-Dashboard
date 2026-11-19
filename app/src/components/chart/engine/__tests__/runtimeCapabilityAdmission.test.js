// @vitest-environment node
// app/src/components/chart/engine/__tests__/runtimeCapabilityAdmission.test.js
//
// ─── WS-I PART 2 (2026-11-13) — ADMISSION BY CAPABILITY, THE CLIENT HALF ─────────
//
// The server half is `tests/test_pine_capability_admission.py`. This file rails
// `engine/runtimeKill.js`'s per-hash verdicts:
//   * OFF (the kill read carries no `capability_admission`) is the client before
//     Part 2: a latched verdict is ignored and the sentence is the old one;
//   * ON: the allowlist first, then the verdict; NO verdict fails closed, with its
//     own "still being checked" sentence; a refused verdict reads "not graded";
//   * the request: POST, the source in the body, latched only under ITS hash, one
//     in flight per hash, never outside a page; bounded at 64 hashes (LRU); a stale
//     verdict is re-asked once per interval by a consult that has the source;
//   * the lists' own re-read carries the switch, so OFF reaches an open tab;
//   * the kill list is never overridden by a verdict.
// ⛔ Node environment on purpose: `window` is absent unless a test installs it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import {
  setRuntimeKillList, setRuntimeAllowList, runtimeKillOf, runtimeNotGradedOf,
  __resetRuntimeAllowList, __resetRuntimeListsRecheck, __allowEveryRuntimeScriptForTests,
  setRuntimeCapabilityAdmission, runtimeCapabilityAdmissionOn, latchRuntimeAdmission,
  runtimeAdmissionOf, requestRuntimeAdmission, __resetRuntimeAdmission, runtimeSourceHash,
  RUNTIME_ADMISSION_PATH, RUNTIME_ADMISSION_MAX, RUNTIME_LISTS_RECHECK_MS, RUNTIME_KILL_PATH,
  RUNTIME_ADMISSION_PENDING_RETRY_MS, RUNTIME_ADMISSION_PENDING_RETRIES, watchRuntimeAdmission,
  runtimeConsultPendingOf, awaitRuntimeAdmission, RUNTIME_ADMISSION_ATTACH_WAIT_MS,
} from '../runtimeKill'

const SRC = '//@version=5\nindicator("mine")\nvar float x = na\nx := close > open ? close : x\nplot(x)\n'
const H = runtimeSourceHash(SRC)
const NOT_GRADED = /has not yet been graded against TradingView, so it is not drawn bar by bar$/
const CHECKING = /is still being checked against the parts of Pine graded against TradingView/
const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve() }
const okJson = (body) => ({ ok: true, json: async () => body })
const hashN = (n) => n.toString(16).padStart(64, '0')

let fetchMock
// ⭐ 2026-11-17 — a consult in a tab that never read its lists now DOES the first read
// (`runtimeKill.js::ensureRuntimeListsRead`; RS Rating's drawings never drew after a reload
// without it). So the rails below that turn admission ON answer the LISTS path as the server does
// (admission ON, nothing killed or allowlisted) and count the ADMISSION asks they are about; a
// single mock answering every path fed an admission body to the lists read, which latched
// admission OFF — a tab the server never produces.
const LISTS_ON = { kill: [], allow: [], capability_admission: true }
const answerAdmission = (...bodies) => {
  const q = [...bodies]
  fetchMock.mockImplementation(async (url) => (url === RUNTIME_KILL_PATH ? okJson(LISTS_ON)
    : okJson(q.length > 1 ? q.shift() : q[0])))
}
const admissionCalls = () => fetchMock.mock.calls.filter((c) => c[0] === RUNTIME_ADMISSION_PATH)
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-13T15:00:00Z'))
  __resetRuntimeAllowList()
  __resetRuntimeAdmission()
  setRuntimeKillList([])
  __resetRuntimeListsRecheck()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('window', {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  __resetRuntimeAdmission()
  setRuntimeKillList([])
  __resetRuntimeListsRecheck()
})

describe('OFF is the client before Part 2', () => {
  it('⛔ a latched ADMITTED verdict is ignored while admission is off', () => {
    latchRuntimeAdmission(H, { admitted: true })
    expect(runtimeCapabilityAdmissionOn()).toBe(false)
    expect(runtimeNotGradedOf({ source: SRC })).toMatch(NOT_GRADED)
    expect(runtimeNotGradedOf({ source: SRC })).toBe(
      `this script (sha256 ${H.slice(0, 12)}…) has not yet been graded against TradingView, so it is not drawn bar by bar`)
  })

  it('⛔ anything but `true` is OFF, and switching off forgets every verdict', () => {
    for (const v of [undefined, null, 'true', 1, 'on', {}]) {
      setRuntimeCapabilityAdmission(v)
      expect(runtimeCapabilityAdmissionOn()).toBe(false)
    }
    setRuntimeCapabilityAdmission(true)
    latchRuntimeAdmission(H, { admitted: true })
    setRuntimeCapabilityAdmission(undefined)
    setRuntimeCapabilityAdmission(true)
    expect(runtimeAdmissionOf({ hash: H })).toBeNull()
  })

  it('⛔ never asks the server while off', async () => {
    expect(await requestRuntimeAdmission(SRC)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('ON: allowlist first, then the verdict, failing closed', () => {
  beforeEach(() => setRuntimeCapabilityAdmission(true))

  it('⛔ no verdict yet: not drawn, and the sentence says it is still being checked', () => {
    expect(runtimeNotGradedOf({ source: SRC })).toMatch(CHECKING)
  })

  it('⭐ an admitted verdict draws; a refused one reads "not graded"', () => {
    latchRuntimeAdmission(H, { admitted: true })
    expect(runtimeNotGradedOf({ source: SRC })).toBeNull()
    expect(runtimeNotGradedOf({ hash: H.toUpperCase() })).toBeNull()
    latchRuntimeAdmission(H, { admitted: false })
    expect(runtimeNotGradedOf({ source: SRC })).toMatch(NOT_GRADED)
  })

  it('the allowlist is asked first', () => {
    setRuntimeAllowList([H.slice(0, 12)])
    latchRuntimeAdmission(H, { admitted: false })
    expect(runtimeNotGradedOf({ source: SRC })).toBeNull()
  })

  it('⛔ a verdict never overrides the kill list', () => {
    latchRuntimeAdmission(H, { admitted: true })
    setRuntimeKillList([H])
    expect(runtimeKillOf({ source: SRC })).toMatch(/kill list/)
  })

  it('⛔ a malformed verdict or hash latches nothing', () => {
    latchRuntimeAdmission('abc', { admitted: true })
    latchRuntimeAdmission(H, { admitted: 'yes' })
    latchRuntimeAdmission(H, null)
    expect(runtimeAdmissionOf({ hash: H })).toBeNull()
  })

  it('the test grant still allows everything (the lane suites keep measuring the lane)', () => {
    __allowEveryRuntimeScriptForTests()
    expect(runtimeNotGradedOf({ source: SRC })).toBeNull()
  })
})

describe('ON: the request', () => {
  beforeEach(() => setRuntimeCapabilityAdmission(true))

  it('⭐ POSTs the source and latches the answer under the script\'s own hash', async () => {
    fetchMock.mockResolvedValue(okJson({ sha256: H, admitted: true, missing: [] }))
    const v = await requestRuntimeAdmission(SRC)
    expect(v.admitted).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(RUNTIME_ADMISSION_PATH)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ source: SRC })
    expect(runtimeNotGradedOf({ source: SRC })).toBeNull()
  })

  it('⛔ an answer naming ANOTHER hash is never latched', async () => {
    fetchMock.mockResolvedValue(okJson({ sha256: 'f'.repeat(64), admitted: true, missing: [] }))
    expect(await requestRuntimeAdmission(SRC)).toBeNull()
    expect(runtimeNotGradedOf({ source: SRC })).toMatch(CHECKING)
  })

  it('⛔ a failed request, a non-200 and a switch-off mid-flight latch nothing', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect(await requestRuntimeAdmission(SRC)).toBeNull()
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    expect(await requestRuntimeAdmission(SRC)).toBeNull()
    let release
    fetchMock.mockReturnValueOnce(new Promise((r) => { release = r }))
    const p = requestRuntimeAdmission(SRC)
    setRuntimeCapabilityAdmission(false)
    release(okJson({ sha256: H, admitted: true, missing: [] }))
    expect(await p).toBeNull()
    setRuntimeCapabilityAdmission(true)
    expect(runtimeAdmissionOf({ hash: H })).toBeNull()
  })

  it('one request per hash in flight', async () => {
    fetchMock.mockResolvedValue(okJson({ sha256: H, admitted: true, missing: [] }))
    const a = requestRuntimeAdmission(SRC)
    const b = requestRuntimeAdmission(SRC)
    expect(a).toBe(b)
    await a
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('⛔ never outside a page', async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', fetchMock)
    expect(await requestRuntimeAdmission(SRC)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('ON: bounded and re-asked', () => {
  beforeEach(() => setRuntimeCapabilityAdmission(true))

  it(`keeps at most ${RUNTIME_ADMISSION_MAX} verdicts, least recently used dropped`, () => {
    expect(RUNTIME_ADMISSION_MAX).toBe(64)
    for (let i = 0; i < RUNTIME_ADMISSION_MAX; i += 1) latchRuntimeAdmission(hashN(i), { admitted: true })
    expect(runtimeAdmissionOf({ hash: hashN(0) })).not.toBeNull()       // touched: now the newest
    latchRuntimeAdmission(hashN(999), { admitted: true })
    expect(runtimeAdmissionOf({ hash: hashN(1) })).toBeNull()           // the oldest went
    expect(runtimeAdmissionOf({ hash: hashN(0) })).not.toBeNull()
  })

  it('⭐ a stale verdict is re-asked ONCE per interval by a consult with the source', async () => {
    latchRuntimeAdmission(H, { admitted: true })
    answerAdmission({ sha256: H, admitted: false, missing: ['switch'] })
    expect(runtimeNotGradedOf({ source: SRC })).toBeNull()
    expect(admissionCalls()).toHaveLength(0)
    vi.advanceTimersByTime(RUNTIME_LISTS_RECHECK_MS)
    expect(runtimeNotGradedOf({ source: SRC })).toBeNull()              // answers from what it holds
    expect(runtimeNotGradedOf({ source: SRC })).toBeNull()
    expect(admissionCalls()).toHaveLength(1)
    await flush()
    expect(runtimeNotGradedOf({ source: SRC })).toMatch(NOT_GRADED)     // the re-ask landed
  })

  it('⛔ the lists\' own re-read carries the switch, so OFF reaches an open tab', async () => {
    setRuntimeKillList([])                                              // the lists were read once
    latchRuntimeAdmission(H, { admitted: true })
    fetchMock.mockResolvedValue(okJson({ kill: [], allow: [], save_enabled: false }))
    vi.advanceTimersByTime(RUNTIME_LISTS_RECHECK_MS)
    runtimeKillOf({ hash: H })
    expect(fetchMock.mock.calls[0][0]).toBe(RUNTIME_KILL_PATH)
    await flush()
    expect(runtimeCapabilityAdmissionOn()).toBe(false)
    expect(runtimeNotGradedOf({ source: SRC })).toMatch(NOT_GRADED)
  })
})

describe('ON: a "still being checked" answer (the server gate was busy)', () => {
  beforeEach(() => setRuntimeCapabilityAdmission(true))

  it('⛔ is never latched, and is asked again until a verdict lands', async () => {
    answerAdmission({ sha256: H, admitted: false, missing: ['pending'] }, { sha256: H, admitted: true, missing: [] })
    const p = requestRuntimeAdmission(SRC)
    await flush()
    expect(runtimeAdmissionOf({ hash: H })).toBeNull()                  // pending latched nothing
    expect(runtimeNotGradedOf({ hash: H })).toMatch(CHECKING)
    await vi.advanceTimersByTimeAsync(RUNTIME_ADMISSION_PENDING_RETRY_MS)
    const v = await p
    expect(v.admitted).toBe(true)
    expect(admissionCalls()).toHaveLength(2)
    expect(runtimeNotGradedOf({ source: SRC })).toBeNull()
  })

  it('⛔ gives up after RUNTIME_ADMISSION_PENDING_RETRIES asks, still latching nothing', async () => {
    fetchMock.mockResolvedValue(okJson({ sha256: H, admitted: false, missing: ['pending'] }))
    const p = requestRuntimeAdmission(SRC)
    for (let i = 0; i < RUNTIME_ADMISSION_PENDING_RETRIES + 1; i += 1) {
      await flush()
      await vi.advanceTimersByTimeAsync(RUNTIME_ADMISSION_PENDING_RETRY_MS)
    }
    expect(await p).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(RUNTIME_ADMISSION_PENDING_RETRIES)
    expect(runtimeAdmissionOf({ hash: H })).toBeNull()
  })
})

describe('re-review F2: a source with no verdict recovers by itself', () => {
  beforeEach(() => setRuntimeCapabilityAdmission(true))

  it('⭐ a consult with the source re-asks once per recheck interval', async () => {
    answerAdmission({ sha256: H, admitted: false, missing: ['pending'] })
    runtimeNotGradedOf({ source: SRC })
    runtimeNotGradedOf({ source: SRC })
    expect(admissionCalls()).toHaveLength(1)
    await flush()
    vi.advanceTimersByTime(RUNTIME_LISTS_RECHECK_MS)
    answerAdmission({ sha256: H, admitted: true, missing: [] })
    runtimeNotGradedOf({ source: SRC })
    const calls = fetchMock.mock.calls.filter((c) => c[0] === RUNTIME_ADMISSION_PATH).length
    expect(calls).toBeGreaterThanOrEqual(2)
  })

  it('⭐ watchRuntimeAdmission keeps asking on the recheck until a verdict lands, then reports it once', async () => {
    fetchMock.mockResolvedValue(okJson({ sha256: H, admitted: false, missing: ['pending'] }))
    const seen = []
    const cancel = watchRuntimeAdmission(SRC, (v) => seen.push(v), { delayMs: 0, recheckMs: 60000 })
    for (let i = 0; i < RUNTIME_ADMISSION_PENDING_RETRIES + 1; i += 1) {
      await vi.advanceTimersByTimeAsync(RUNTIME_ADMISSION_PENDING_RETRY_MS)
    }
    expect(seen).toEqual([])                                               // pending: nothing latched
    fetchMock.mockResolvedValue(okJson({ sha256: H, admitted: true, missing: [] }))
    await vi.advanceTimersByTimeAsync(60000)
    await flush()
    expect(seen.length).toBe(1)
    expect(seen[0].admitted).toBe(true)
    await vi.advanceTimersByTimeAsync(120000)
    expect(seen.length).toBe(1)                                            // once, then it stops
    cancel()
  })

  it('MemberPane recovers through it (wired, not just defined)', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/components/chart/builder/memberPane/MemberPane.jsx'), 'utf8')
    expect(src).toMatch(/return watchRuntimeAdmission\(source, \(\) => setKillVersion/)
  })
})

// ⭐⭐ (2026-11-18) THE FIRST-PASTE RACE. The rendered rail is `builder/memberPane/firstPasteAdmission.test.jsx`.
describe('the first-paste race: a consult that answered "still being checked"', () => {
  it('⭐ runtimeConsultPendingOf answers exactly when a consult said "still being checked", in every state', () => {
    const states = [
      ['off', () => { setRuntimeCapabilityAdmission(false) }],
      ['every script allowed (tests)', () => { setRuntimeCapabilityAdmission(true); __allowEveryRuntimeScriptForTests() }],
      ['allowlisted', () => { setRuntimeCapabilityAdmission(true); setRuntimeAllowList([H]) }],
      ['admitted', () => { setRuntimeCapabilityAdmission(true); latchRuntimeAdmission(H, { admitted: true }) }],
      ['refused', () => { setRuntimeCapabilityAdmission(true); latchRuntimeAdmission(H, { admitted: false }) }],
      ['no verdict yet', () => { setRuntimeCapabilityAdmission(true) }],
    ]
    const seen = {}
    for (const [name, arrange] of states) {
      __resetRuntimeAllowList()
      __resetRuntimeAdmission()
      fetchMock.mockImplementation(() => new Promise(() => {}))   // an ask never answers here
      arrange()
      expect(runtimeConsultPendingOf({ source: SRC }), `${name}: never consulted`).toBe(false)
      const said = runtimeNotGradedOf({ source: SRC })
      seen[name] = runtimeConsultPendingOf({ source: SRC })
      expect(seen[name], name).toBe(CHECKING.test(said || ''))
    }
    // the table moves: only the state with no verdict waits
    expect(Object.entries(seen).filter(([, v]) => v).map(([k]) => k)).toEqual(['no verdict yet'])
    // and the answer changing ends the wait (a verdict lands)
    latchRuntimeAdmission(H, { admitted: true })
    expect(runtimeConsultPendingOf({ source: SRC })).toBe(false)
  })

  it('⭐ watchRuntimeAdmission re-asks SOON after the request gives up, then less often, up to the recheck', async () => {
    setRuntimeCapabilityAdmission(true)
    fetchMock.mockImplementation(async (url) => (url === RUNTIME_KILL_PATH ? okJson(LISTS_ON)
      : okJson({ sha256: H, admitted: false, missing: ['pending'] })))
    const cancel = watchRuntimeAdmission(SRC, () => {}, { delayMs: 0, recheckMs: 60000 })
    const asksBy = async (ms) => { await vi.advanceTimersByTimeAsync(ms); return admissionCalls().length }
    // the first request: RUNTIME_ADMISSION_PENDING_RETRIES asks, then gives up (null)
    let n = await asksBy(RUNTIME_ADMISSION_PENDING_RETRY_MS * RUNTIME_ADMISSION_PENDING_RETRIES)
    expect(n).toBe(RUNTIME_ADMISSION_PENDING_RETRIES)
    // ⚰️ the next ask waited the full recheck (60 s); now it comes within 2 retry spacings
    n = await asksBy(RUNTIME_ADMISSION_PENDING_RETRY_MS * 2 + 1)
    expect(n).toBeGreaterThan(RUNTIME_ADMISSION_PENDING_RETRIES)
    cancel()
  })

  it('⭐ awaitRuntimeAdmission: at once when no consult waits; the verdict when it lands; null when the wait runs out', async () => {
    setRuntimeCapabilityAdmission(true)
    fetchMock.mockImplementation(() => new Promise(() => {}))
    expect(await awaitRuntimeAdmission(SRC)).toBeNull()                    // nothing consulted: nothing to wait for
    expect(admissionCalls()).toHaveLength(0)
    runtimeNotGradedOf({ source: SRC })                                    // a consult answers "still being checked"
    const late = awaitRuntimeAdmission(SRC, { timeoutMs: 5000 })
    let got = 'unresolved'
    late.then((v) => { got = v })
    await vi.advanceTimersByTimeAsync(4000)
    expect(got).toBe('unresolved')
    await vi.advanceTimersByTimeAsync(1500)
    expect(got).toBeNull()                                                 // the wait ran out
    answerAdmission({ sha256: H, admitted: true, missing: [] })
    __resetRuntimeAdmission()
    setRuntimeCapabilityAdmission(true)
    runtimeNotGradedOf({ source: SRC })
    await flush()
    const v = await awaitRuntimeAdmission(SRC, { timeoutMs: RUNTIME_ADMISSION_ATTACH_WAIT_MS })
    expect(v && v.admitted).toBe(true)
  })
})
