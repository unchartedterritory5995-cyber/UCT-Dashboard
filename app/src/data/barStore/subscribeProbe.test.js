// The opt-in first-subscribe probe (subscribeProbe.js): off, nothing is recorded; on, a chart's first subscribe records
// what its hydrate changed on the entry (fields, a new rows array, rows that differ by value or by provenance only).
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, intradayRows, OPEN } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))
const NOW = (OPEN + 32 * 60 + 20) * 1000
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime(NOW); delete window.__uctSubscribeProbe })
afterEach(() => { vi.useRealTimers(); delete window.__uctSubscribeProbe })

async function boot(on) {
  vi.resetModules()
  installFakeBarsServer()
  const probe = await import('./subscribeProbe')
  probe.__setSubscribeProbeForTests(on)
  const { createBarStore } = await import('./index')
  const { keyOf, ACTION } = await import('./types')
  const mem = await import('../../utils/barsMemCache')
  const store = createBarStore({ stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn() })
  const key = keyOf({ sym: 'PRB', tf: '5' })
  const rows = intradayRows(5, Math.floor(NOW / 1000) - 300, { from: OPEN - 3 * 86400 })
  mem.memPutMonotonic('PRB', '5', rows, { savedAt: NOW - 1000 })
  store.registry.acquire(key)
  store.registry.dispatch(key, { type: ACTION.IDB_HIT, key, gen: store.peek(key)?.gen ?? 0, payload: { bars: rows, saved_at: NOW - 1000 } })
  return { store, key }
}

describe('first-subscribe probe', () => {
  it('off: a first subscribe records nothing', async () => {
    const w = await boot(false)
    const off = w.store.subscribe(w.key, () => {})
    await vi.advanceTimersByTimeAsync(50)
    expect(window.__uctSubscribeProbe).toBeUndefined()
    off()
  })

  it('on: the sync and hydrated phases, the fields that changed, and whether the rows array is new', async () => {
    const w = await boot(true)
    const off = w.store.subscribe(w.key, () => {})
    await vi.advanceTimersByTimeAsync(50)
    const log = window.__uctSubscribeProbe
    expect(log.map((e) => e.phase)).toEqual(['sync', 'hydrated'])
    const sync = log[0]
    expect(sync.key).toBe(w.key)
    expect(sync.changed).toContain('source')                         // idb -> mem: the re-read of the same copy
    expect(sync.sameBars).toBe(true)
    expect(sync.rows).toBe(null)
    expect(sync.before.source).toBe('idb')
    expect(sync.after.source).toBe('mem')
    expect(sync.after.rows).toBe(sync.before.rows)
    const again = w.store.subscribe(w.key, () => {})                 // a second subscriber: not a first subscribe
    await vi.advanceTimersByTimeAsync(50)
    expect(window.__uctSubscribeProbe).toHaveLength(2)
    again()
    off()
  })
})
