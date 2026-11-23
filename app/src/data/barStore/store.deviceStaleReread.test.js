// P4-L2 (review of #2558), through the real store, the real prefetch facade and the REAL device client
// (deviceStore/client.js + source.js) over a worker that answers each read with the copy it holds now. The device rule
// refuses a copy short of its current bucket ('stale') and re-reads it. Read through the client's recently-read cache
// (SYNC_CACHE_TTL_MS, 20 s), the re-read answered with the very copy it had just refused, so a key read just before a
// minute boundary stayed refused for up to 20 s after the device had applied that minute.
//   R1 the minute's frame has landed in the worker: the refused copy's re-read asks for one NEWER than it holds, and the
//      newer copy paints 5 s after the boundary, well inside the cache's 20 s
//   R2 the frame has not landed yet: the re-read finds nothing newer and the copy stays refused (no newer copy invented)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createBarStore } from './index'
import { createPrefetch } from './prefetch'
import { keyOf } from './types'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { createDeviceClient } from '../deviceStore/client'
import { createDeviceSource } from '../deviceStore/source'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const OPEN = Date.UTC(2026, 10, 18, 14, 30) / 1000             // Wed 2026-11-18 09:30 ET
const T = (etMin) => OPEN + (etMin - 570) * 60                  // ET minute of day -> unix s
const NO_IO = {
  memPeekEntry: () => null, idbGet: async () => null, idbGetHistoryEntry: async () => null,
  memPutMonotonic: () => {}, idbPutMonotonic: async () => {}, idbPutHistory: async () => {},
}
/** The worker's 1m columns: 09:30 ... `lastMin` closed, complete through `through`. */
function cols(lastMin, through) {
  const n = lastMin - 570 + 1
  const f = (fn) => Float64Array.from({ length: n }, (_, i) => fn(i))
  return { t: f((i) => T(570 + i)), o: f((i) => 50 + i / 100), h: f((i) => 50.4 + i / 100), l: f((i) => 49.6 + i / 100),
    c: f((i) => 50.1 + i / 100), v: f(() => 100), build: '20261118T0000Z', through }
}
/** A worker that answers every read, a moment later, with the copy it holds at that moment. */
function liveWorker(state) {
  const w = { onmessage: null, onerror: null, terminate: () => {}, reads: 0 }
  w.postMessage = (m) => {
    if (m.op !== 'read') return
    w.reads++
    Promise.resolve().then(() => w.onmessage({ data: { id: m.id, ok: true, res: state.cols } }))
  }
  return w
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

function boot(state) {
  const worker = liveWorker(state)
  const client = createDeviceClient({ makeWorker: () => worker, afterPaint: () => {} })
  const device = createDeviceSource({ load: async () => client, current: () => client })
  const store = createBarStore({
    request: vi.fn(() => new Promise(() => {})), device, history: null, io: NO_IO,
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const pf = createPrefetch({ store, tickerMeta: () => {}, extended: () => false })
  return { worker, store, pf, key: keyOf({ sym: 'NEWB', tf: '1' }) }
}

describe('P4-L2 a refused device copy is re-read newer, not from the copy it holds', () => {
  it('R1 the minute\'s frame has landed in the worker: the newer copy paints 5 s after the boundary, not 20 s', async () => {
    vi.setSystemTime((T(604) + 58) * 1000)                           // 10:04:58
    const state = { cols: cols(603, T(604)) }                        // complete through 10:04:00
    const { worker, store, pf, key } = boot(state)
    pf.peekDisplayable('NEWB', '1')                                  // the key is read: the client keeps the copy 20 s
    await vi.advanceTimersByTimeAsync(5)
    expect(store.persist.deviceThroughOf(key)).toBe(T(604))
    expect(pf.deviceVerdict('NEWB', '1', { showExtended: false })).toMatchObject({ paints: true })
    vi.setSystemTime((T(605) + 5) * 1000)                            // 10:05:05: the device has applied the 10:04 minute
    state.cols = cols(604, T(605))
    const reads = worker.reads
    expect(pf.deviceVerdict('NEWB', '1', { showExtended: false })).toMatchObject({ paints: false, reason: 'stale' })
    await vi.advanceTimersByTimeAsync(5)
    expect(worker.reads).toBeGreaterThan(reads)                      // the worker was asked, inside the cache's 20 s
    expect(store.persist.deviceThroughOf(key)).toBe(T(605))
    expect(pf.deviceVerdict('NEWB', '1', { showExtended: false })).toMatchObject({ paints: true })
    store.dispose()
  })

  it('R2 the frame has not landed: the re-read finds nothing newer, and the copy stays refused', async () => {
    vi.setSystemTime((T(604) + 58) * 1000)
    const state = { cols: cols(603, T(604)) }
    const { store, pf, key } = boot(state)
    pf.peekDisplayable('NEWB', '1')
    await vi.advanceTimersByTimeAsync(5)
    vi.setSystemTime((T(605) + 3) * 1000)                            // 10:05:03: the 10:04 frame not yet applied
    expect(pf.deviceVerdict('NEWB', '1', { showExtended: false })).toMatchObject({ paints: false, reason: 'stale' })
    await vi.advanceTimersByTimeAsync(5)
    expect(store.persist.deviceThroughOf(key)).toBe(T(604))
    expect(pf.deviceVerdict('NEWB', '1', { showExtended: false })).toMatchObject({ paints: false, reason: 'stale' })
    store.dispose()
  })
})
