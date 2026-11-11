// The BarStore lane (P2b): `barsLaneRequest` is the SAME gate as the warm queue — visible
// never queued; urgent > grid > [warm queue] > background; shares `_MAX_CONCURRENT`, the 503
// backoff and the pack-ingest hold; joins an in-flight request of the same URL; a waiting
// request honors its abort.
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

beforeEach(async () => {
  vi.useFakeTimers()
  pending.length = 0
  localStorage.setItem('barspack.version', 'test')   // the pack is ingested: no cold-start hold
  mockFetch()
  vi.resetModules()
  lane = await import('./prefetchBars')
})
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version') })

describe('barsLaneRequest — the BarStore uses the existing gate', () => {
  it('visible is never queued (even with every slot taken)', async () => {
    lane.barsLaneRequest('/x/a', { priority: 'urgent' })
    lane.barsLaneRequest('/x/b', { priority: 'urgent' })
    await flush()
    expect(pending.length).toBe(2)                        // _MAX_CONCURRENT slots full
    lane.barsLaneRequest('/x/c', { priority: 'background' })
    lane.barsLaneRequest('/x/v', { priority: 'visible' })
    await flush()
    expect(pending.map((p) => p.url)).toEqual(['/x/a', '/x/b', '/x/v'])
    expect(lane._laneStats().waiting).toBe(1)
  })

  it('urgent > grid > background when slots free up', async () => {
    lane.barsLaneRequest('/x/1', { priority: 'urgent' })
    lane.barsLaneRequest('/x/2', { priority: 'urgent' })
    await flush()
    lane.barsLaneRequest('/x/bg', { priority: 'background' })
    lane.barsLaneRequest('/x/grid', { priority: 'grid' })
    lane.barsLaneRequest('/x/urg', { priority: 'urgent' })
    pending[0].resolve({ bars: [] }); await flush()
    pending[1].resolve({ bars: [] }); await flush()
    expect(pending.slice(2).map((p) => p.url)).toEqual(['/x/urg', '/x/grid'])
    pending[2].resolve({ bars: [] }); await flush()
    expect(pending.at(-1).url).toBe('/x/bg')
  })

  it('the same URL in flight is JOINED (one network request)', async () => {
    const a = lane.barsLaneRequest('/x/same', { priority: 'visible' })
    const b = lane.barsLaneRequest('/x/same', { priority: 'urgent' })
    await flush()
    expect(pending.length).toBe(1)
    pending[0].resolve({ bars: [1] })
    expect(await a).toEqual({ bars: [1] })
    expect(await b).toEqual({ bars: [1] })
  })

  it('a shed (503) holds urgent / grid / background until the backoff lifts; visible still goes', async () => {
    const r = lane.barsLaneRequest('/x/shed', { priority: 'urgent' })
    await flush()
    pending[0].resolve({ error: 'warming' }, 503, { 'Retry-After': '3' })
    await expect(r).rejects.toMatchObject({ status: 503 })
    await flush()
    lane.barsLaneRequest('/x/held', { priority: 'urgent' })
    lane.barsLaneRequest('/x/vis', { priority: 'visible' })
    await flush()
    expect(pending.slice(1).map((p) => p.url)).toEqual(['/x/vis'])
    await vi.advanceTimersByTimeAsync(3500)
    await flush()
    expect(pending.map((p) => p.url)).toContain('/x/held')
  })

  it('a waiting request honors its abort (and never reaches the network)', async () => {
    lane.barsLaneRequest('/x/1', { priority: 'urgent' })
    lane.barsLaneRequest('/x/2', { priority: 'urgent' })
    await flush()
    const ac = new AbortController()
    const w = lane.barsLaneRequest('/x/waiting', { priority: 'grid', signal: ac.signal })
    ac.abort()
    await expect(w).rejects.toMatchObject({ name: 'AbortError' })
    pending[0].resolve({ bars: [] }); pending[1].resolve({ bars: [] }); await flush()
    expect(pending.map((p) => p.url)).not.toContain('/x/waiting')
  })

  it('background waits out the pack-ingest hold; urgent does not', async () => {
    localStorage.removeItem('barspack.version')
    lane.barsLaneRequest('/x/bg', { priority: 'background' })
    lane.barsLaneRequest('/x/u', { priority: 'urgent' })
    await flush()
    expect(pending.map((p) => p.url)).toEqual(['/x/u'])
    localStorage.setItem('barspack.version', 'test')
    await vi.advanceTimersByTimeAsync(1100)
    await flush()
    expect(pending.map((p) => p.url)).toContain('/x/bg')
  })
})
