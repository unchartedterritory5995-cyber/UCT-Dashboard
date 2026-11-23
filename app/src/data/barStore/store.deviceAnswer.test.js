// P3-L1 (review of #2554), through the real store (registry + reducer + persist + network) with a fake device source:
// what an answer leaves of the device's rows is what persist WRITES, as a server-backed copy that a later page reads
// back unmarked (no device rule then judges it).
//   SA1 a terminal no_data answer on a key holding device rows: nothing is written to mem or IndexedDB
//   SA2 an answer that LAGS the device: what is written holds no row newer than the answer
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createBarStore } from './index'
import { keyOf, ACTION, STATUS } from './types'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { memClear } from '../../utils/barsMemCache'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const OPEN = Date.UTC(2026, 10, 18, 14, 30) / 1000               // Wed 2026-11-18 09:30 ET
const T = (etMin) => OPEN + (etMin - 570) * 60
const NOW = T(691) * 1000                                         // 11:31:00 ET
const bar = (m) => ({ t: T(m), o: 50, h: 50.5, l: 49.5, c: 50.25, v: 1000 })
const closedTo = (lastM, fromM = 570) => { const o = []; for (let m = fromM; m <= lastM; m += 5) o.push(bar(m)); return o }
const DEVICE = { rows: [...closedTo(685), bar(690)], through: T(691), savedAt: T(691) * 1000, formingT: T(690) }

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

function boot(request) {
  const memPutMonotonic = vi.fn(() => {})
  const idbPutMonotonic = vi.fn(async () => {})
  const device = { peek: vi.fn((s, t) => (s === 'NEWB' && t === '5' ? DEVICE : null)), read: vi.fn(async (s, t) => (s === 'NEWB' && t === '5' ? DEVICE : null)) }
  const store = createBarStore({
    request, device, history: null,
    io: { idbGet: async () => null, idbGetHistoryEntry: async () => null, idbPutMonotonic, memPutMonotonic },
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  return { store, memPutMonotonic, idbPutMonotonic, key: keyOf({ sym: 'NEWB', tf: '5' }) }
}

describe('P3-L1 what persist writes after an answer on a device-rows key', () => {
  it('SA1 a terminal no_data answer: nothing written, the key unavailable', async () => {
    const w = boot(vi.fn(() => new Promise(() => {})))
    const off = w.store.subscribe(w.key, () => {})                    // a chart on screen: persist watches the key
    await vi.advanceTimersByTimeAsync(5)
    expect(w.store.peek(w.key).source).toBe('device')
    w.store.registry.dispatch(w.key, { type: ACTION.REST_ERROR, key: w.key, payload: { error: 'no_data' } })
    await vi.advanceTimersByTimeAsync(3000)                            // past the persist debounce
    expect(w.memPutMonotonic).not.toHaveBeenCalled()
    expect(w.idbPutMonotonic).not.toHaveBeenCalled()
    expect(w.store.peek(w.key).status).toBe(STATUS.UNAVAILABLE)
    off()
    w.store.dispose()
  })

  it('SA2 an answer that lags the device (through 11:15): what is written holds no row newer than it', async () => {
    const lagging = {
      ticker: 'NEWB', tf: '5', bars: closedTo(675, 600), contract: 1, grid: 'eth-clock', session: 'rth', cache_key: 'b1:NEWB:5:eth-clock',
      series_rev: 1000, history_rev: 1, verified_through: T(690), tail_status: 'verified', developing: null,
    }
    const w = boot(vi.fn(() => new Promise((r) => setTimeout(() => r(lagging), 20))))
    const off = w.store.subscribe(w.key, () => {})
    await vi.advanceTimersByTimeAsync(3000)
    expect(w.store.peek(w.key).restSeen).toBe(true)
    expect(w.memPutMonotonic).toHaveBeenCalled()
    const written = w.memPutMonotonic.mock.calls.at(-1)[2]
    expect(written.some((r) => r.t > T(675))).toBe(false)
    expect(w.store.peek(w.key).developing?.t ?? null).not.toBe(T(690))
    off()
    w.store.dispose()
  })
})
