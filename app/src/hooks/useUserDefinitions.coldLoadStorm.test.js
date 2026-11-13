// ⭐⭐ COLD-LOAD STORM RAILS (2026-11-13).
//
// The first /charts load after a `SCRIPT_ENGINE_VERSION` bump re-translates every
// saved Pine script and writes each one back. Measured in a sandbox (25 stale
// scripts, cold profile): 25 PUTs drove 26 full re-reads of the definition list and
// ~3.2 s of React work (every re-read and every landing re-ran every chart's
// `updateChart` through the registry generation), against ~0.1 s on the next load.
// In production the tab froze for minutes. Two rails keep the burst coalesced:
//
//   A. N engine-upgrade write-backs re-read the list ONCE, after the burst is quiet
//      (`useUserDefinitions.revalidateAfterUpgradeBurst`), while an ordinary save
//      still re-reads at once.
//   B. N translations landing together are announced with ONE `onUpgradeSettled`
//      notify (`savedScriptUpgrade.notifyCoalesced`), and the last one is never lost.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const swrMutate = vi.fn()
vi.mock('swr', async (orig) => {
  const real = await orig()
  return { ...real, mutate: (...a) => swrMutate(...a) }
})

const { saveUserDefinition, USER_DEFINITIONS_KEY, UPGRADE_REVALIDATE_QUIET_MS } = await import('./useUserDefinitions')
const mpd = await import('../components/chart/builder/memberPane/memberPaneDefinition')
const {
  resolveRow, onUpgradeSettled, __resetSavedScriptUpgrade, __setTranslatorForTests,
  UPGRADE_NOTIFY_COALESCE_MS,
} = await import('../components/chart/builder/memberPane/savedScriptUpgrade')

const SCRIPT = '//@version=5\nindicator("Storm Probe")\nplot(ta.sma(close, 14), "avg")\n'
const listReads = () => swrMutate.mock.calls.filter(([k]) => k === USER_DEFINITIONS_KEY).length

beforeEach(() => {
  swrMutate.mockClear()
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ def_id: 'u_x', version: 2 }) }))
})

describe('A — write-backs re-read the list once per burst', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('25 engine-upgrade write-backs ⇒ 0 re-reads during the burst, exactly 1 after it is quiet', async () => {
    for (let i = 0; i < 25; i++) {
      const res = await saveUserDefinition({ id: `u_${i}` }, `u_${i}`, null,
        { baseVersion: 1, pineSource: SCRIPT, reason: 'engine-upgrade' })
      expect(res.ok).toBe(true)
      // the next landing arrives well inside the quiet window
      await vi.advanceTimersByTimeAsync(Math.floor(UPGRADE_REVALIDATE_QUIET_MS / 3))
    }
    expect(listReads(), 'no per-row re-read of the whole list').toBe(0)
    await vi.advanceTimersByTimeAsync(UPGRADE_REVALIDATE_QUIET_MS + 1)
    expect(listReads(), 'one re-read for the whole burst').toBe(1)
  })

  it('an ordinary save (Builder, Formula tab) still re-reads at once', async () => {
    await saveUserDefinition({ id: 'u_a' }, 'u_a', null, { baseVersion: 1, pineSource: SCRIPT })
    expect(listReads()).toBe(1)
    await saveUserDefinition({ id: 'u_b' }, 'u_b')
    expect(listReads()).toBe(2)
  })

  it('a refused write-back re-reads nothing (nothing changed in the store)', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 422, json: async () => ({ detail: 'no' }) }))
    await saveUserDefinition({ id: 'u_c' }, 'u_c', null, { baseVersion: 1, pineSource: SCRIPT, reason: 'engine-upgrade' })
    await vi.advanceTimersByTimeAsync(UPGRADE_REVALIDATE_QUIET_MS * 2)
    expect(listReads()).toBe(0)
  })
})

describe('B — translations landing together are announced once', () => {
  let ric
  beforeEach(() => {
    __resetSavedScriptUpgrade()
    __setTranslatorForTests(mpd)
    ric = globalThis.requestIdleCallback
    // every idle slot runs on the next macrotask, i.e. all rows land back to back
    globalThis.requestIdleCallback = (fn) => setTimeout(fn, 0)
  })
  afterEach(() => {
    if (ric) globalThis.requestIdleCallback = ric; else delete globalThis.requestIdleCallback
    __resetSavedScriptUpgrade()
  })

  it('12 stale rows landing back to back ⇒ at most one notify per window, never one per row', async () => {
    const base = mpd.memberPaneDefinition({ source: SCRIPT, id: 'u_storm00' })
    expect(base.ok, base.reason).toBe(true)
    const rows = Array.from({ length: 12 }, (_, i) => {
      const id = `u_storm${String(i).padStart(2, '0')}`
      const d = JSON.parse(JSON.stringify(base.definition))
      d.id = id
      delete d.meta.engineVersion          // translated by an older engine
      return { def_id: id, version: 3, rev: 1, definition: d, pine_source: SCRIPT }
    })
    const settled = vi.fn()
    const off = onUpgradeSettled(settled)
    const t0 = performance.now()
    for (const r of rows) expect(resolveRow(r).pending).toBe(true)
    // all 12 translations run on back-to-back macrotasks; wait until the LAST one has
    // been announced (a settled row no longer reads as pending)
    const allSettled = () => rows.every((r) => resolveRow(r).pending === false)
    while (!allSettled() && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 5))
    expect(allSettled(), 'every row settles').toBe(true)
    await new Promise((r) => setTimeout(r, UPGRADE_NOTIFY_COALESCE_MS + 20))
    const elapsed = performance.now() - t0
    const calls = settled.mock.calls.length
    expect(calls, 'the last landing is announced').toBeGreaterThanOrEqual(1)
    // one announcement per window at most (the per-row notify this replaced made it 12)
    expect(calls, `notifies in ${Math.round(elapsed)} ms`).toBeLessThanOrEqual(Math.ceil(elapsed / UPGRADE_NOTIFY_COALESCE_MS) + 1)
    expect(calls, 'never one per row').toBeLessThan(rows.length)
    off()
  })
})
