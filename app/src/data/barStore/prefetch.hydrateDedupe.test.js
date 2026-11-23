// ⭐ ONE HYDRATE IN FLIGHT PER KEY (2026-11-23, live-session CPU profile: the bar cache's IDB result handlers per press).
// A row entering a list's window is hydrated by THREE callers in the same task: the neighbour hold's `set`, the mem
// warm (`warmMemFromIDB`) and the list warm's deferred prefetch. Until its cache read lands the entry holds nothing, so
// each started its own persist.hydrate: the whole tail record and the whole deep-history record read three times.
// `_hydrate` now hands a caller the hydrate already in flight for the key (on the same lane: an URGENT caller, the
// switch, never joins a background one, so the device store's urgent read is unchanged).
//   D1 three concurrent background hydrates of a new key: ONE cache read
//   D2 an urgent hydrate (the switch) does not join a background one: its own read, on its own lane
//   D3 a hydrate after the first has settled (the cache held nothing) reads again
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createBarStore } from './index'
import { createPrefetch } from './prefetch'
import { keyOf } from './types'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { memClear } from '../../utils/barsMemCache'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

beforeEach(() => { memClear() })

function boot() {
  const pending = []
  const io = {
    idbGet: vi.fn(() => new Promise((r) => { pending.push(() => r(null)) })),   // held until the test lands it
    idbGetHistoryEntry: vi.fn(async () => null),
    idbPutMonotonic: vi.fn(async () => null), idbPutHistory: vi.fn(async () => null), memPutMonotonic: vi.fn(() => {}),
  }
  const store = createBarStore({
    request: vi.fn(() => new Promise(() => {})), io, history: null,
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {},
    idle: () => {},
  })
  const lanes = []
  const orig = store.persist.hydrate.bind(store.persist)
  store.persist.hydrate = (k, o) => { lanes.push(o?.urgent === true ? 'urgent' : 'background'); return orig(k, o) }
  const pf = createPrefetch({ store, tickerMeta: () => {}, extended: () => false })
  const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
  return { store, pf, io, lanes, settle, land: () => { for (const r of pending.splice(0)) r() } }
}

describe('one hydrate in flight per key', () => {
  it('D1 three concurrent background hydrates of a new row: ONE cache read', async () => {
    const w = boot()
    const hold = w.pf.createNeighborHold()
    hold.set(['NEW'], '5')                                      // the hold pins and hydrates it
    w.pf.warmMemFromIDB(['NEW'], ['5'])                         // the mem warm
    w.pf.prefetchBarsToIDB(['NEW'], '5', { priority: true })    // the list warm (deferred to a microtask)
    await w.settle()
    expect(w.io.idbGet).toHaveBeenCalledTimes(1)
    expect(w.lanes).toEqual(['background'])
    w.land()
    await w.settle()
    hold.clear()
    w.store.dispose()
  })

  it("D2 an urgent hydrate (the switch's) does not join a background one: its own read, on its own lane", async () => {
    const w = boot()
    w.pf.warmMemFromIDB(['NEW'], ['5'])
    await w.settle()
    w.pf.prepareForDisplay('NEW', '5')
    await w.settle()
    expect(w.lanes).toEqual(['background', 'urgent'])
    expect(w.io.idbGet).toHaveBeenCalledTimes(2)
    w.land()
    await w.settle()
    w.store.dispose()
  })

  it('D3 a hydrate after the first has settled (the cache held nothing) reads again', async () => {
    const w = boot()
    w.pf.warmMemFromIDB(['NEW'], ['5'])
    await w.settle()
    w.land()
    await w.settle()
    expect(w.store.peek(keyOf({ sym: 'NEW', tf: '5' }))?.bars.length ?? 0).toBe(0)
    w.pf.warmMemFromIDB(['NEW'], ['5'])
    await w.settle()
    expect(w.io.idbGet).toHaveBeenCalledTimes(2)
    w.land()
    await w.settle()
    w.store.dispose()
  })
})
