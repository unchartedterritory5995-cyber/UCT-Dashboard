// The opt-in scan-warm trace, the lane's part (2026-11-26): `scanTrace` writes what the lane did with each URGENT request
// (queued: behind how many, slots taken, under the shed backoff or not; started; joined; raised to visible; aborted while it
// waited), only while `globalThis.__uctScanWarmTrace` is an array, and the lane does exactly the same with the trace on.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let lane
const pending = []
function mockFetch() {
  globalThis.fetch = vi.fn((url, opts) => new Promise((resolve, reject) => {
    const p = { url, opts, resolve: (body, status = 200, headers = {}) => resolve({
      ok: status >= 200 && status < 300, status,
      headers: { get: (h) => headers[h] ?? null },
      json: async () => body, clone() { return this },
    }), reject }
    pending.push(p)
    opts?.signal?.addEventListener?.('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e) })
  }))
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
async function fresh() {
  pending.length = 0
  mockFetch()
  vi.resetModules()
  lane = await import('./prefetchBars')
}

beforeEach(async () => {
  vi.useFakeTimers()
  localStorage.setItem('barspack.version', 'test')   // the pack is ingested: no cold-start hold
  delete globalThis.__uctScanWarmTrace
  await fresh()
})
afterEach(() => {
  vi.useRealTimers()
  localStorage.removeItem('barspack.version')
  delete globalThis.__uctScanWarmTrace
})

/** One pass through the lane: two urgent requests take both slots; a third waits and is raised to visible; a fourth waits
 *  and is aborted; a background request waits (never written); a fifth urgent waits and starts when a slot frees; an
 *  urgent ask of a URL in flight joins it. */
async function script() {
  lane.barsLaneRequest('/x/a', { priority: 'urgent' }).catch(() => {})
  lane.barsLaneRequest('/x/b', { priority: 'urgent' }).catch(() => {})
  await flush()
  lane.barsLaneRequest('/x/c', { priority: 'urgent' }).catch(() => {})
  lane.promoteLaneRequest('/x/c', 'visible')
  const ctl = new AbortController()
  lane.barsLaneRequest('/x/d', { priority: 'urgent', signal: ctl.signal }).catch(() => {})
  ctl.abort()
  lane.barsLaneRequest('/x/bg', { priority: 'background' }).catch(() => {})
  lane.barsLaneRequest('/x/e', { priority: 'urgent' }).catch(() => {})
  lane.barsLaneRequest('/x/b', { priority: 'urgent' }).catch(() => {})
  await flush()
  pending[0].resolve({ bars: [] })
  await flush()
  return { fetched: pending.map((p) => p.url), stats: lane._laneStats() }
}

describe('the opt-in scan-warm trace: the lane', () => {
  it('S1 off (no array, or a value that is not one): nothing is written, and the lane does exactly what it does traced', async () => {
    const off = await script()
    expect(globalThis.__uctScanWarmTrace).toBeUndefined()
    expect(off.fetched, 'the script itself').toEqual(['/x/a', '/x/b', '/x/c', '/x/e'])
    const notArray = {}
    for (const v of [notArray, []]) {
      await fresh()
      globalThis.__uctScanWarmTrace = v
      expect(await script(), 'the trace changed what the lane fetched').toEqual(off)
    }
    expect(Object.keys(notArray), 'a value that is not an array was written to').toEqual([])
    expect(globalThis.__uctScanWarmTrace.length).toBeGreaterThan(0)
  })

  it('S2 on: each urgent request reads queued, then started, joined, raised to visible or aborted; background is not written', async () => {
    globalThis.__uctScanWarmTrace = []
    await script()
    const t = globalThis.__uctScanWarmTrace
    const evs = (url) => t.filter((e) => e.url === url).map((e) => e.ev)
    expect(evs('/x/a')).toEqual(['lane-queue', 'lane-start'])
    expect(evs('/x/b')).toEqual(['lane-queue', 'lane-start', 'lane-join'])
    expect(evs('/x/c')).toEqual(['lane-queue', 'lane-promote'])
    expect(evs('/x/d')).toEqual(['lane-queue', 'lane-abort'])
    expect(evs('/x/e')).toEqual(['lane-queue', 'lane-start'])
    expect(evs('/x/bg'), 'a background request was written').toEqual([])
    expect(t.find((e) => e.url === '/x/c' && e.ev === 'lane-queue')).toMatchObject({ ahead: 0, active: 2, backoff: false })
    expect(t.find((e) => e.url === '/x/e' && e.ev === 'lane-queue')).toMatchObject({ ahead: 0, active: 2 })
    expect(t.find((e) => e.ev === 'lane-join')).toMatchObject({ url: '/x/b', own: true })
    expect(t.find((e) => e.ev === 'lane-promote')).toMatchObject({ url: '/x/c', to: 'visible' })
    expect(t.every((e) => Number.isFinite(e.at))).toBe(true)
  })

  it('S3 the trace keeps the newest SCAN_TRACE_MAX entries', () => {
    globalThis.__uctScanWarmTrace = []
    for (let i = 0; i < lane.SCAN_TRACE_MAX + 10; i++) lane.scanTrace({ ev: 'x', i })
    expect(globalThis.__uctScanWarmTrace.length).toBe(lane.SCAN_TRACE_MAX)
    expect(globalThis.__uctScanWarmTrace[0].i).toBe(10)
  })
})
