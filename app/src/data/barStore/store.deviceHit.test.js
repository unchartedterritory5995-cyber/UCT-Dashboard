// THE ON-DEVICE COPY PAINTS A CHART NOBODY OPENED HERE (data/deviceStore, behind 'uct.deviceStore').
// Contract, through the real store (registry + reducer + persist + network) with a fake device source:
//   D1 a symbol the device store's recently-read cache holds is DISPLAYABLE in the same synchronous call
//      the handoff makes (peekDisplayable), with no request at all
//   D2 a never-seen symbol (cold cache) paints from ONE device read, beside a slow IndexedDB read and
//      before the server's answer; the answer then REPLACES it (its revised row wins, rest status,
//      the device's older rows kept only because the overlap proves the same price basis)
//   D3 a device copy on ANOTHER basis than the answer (a split between the two) is dropped whole
//   D4 the device copy is local data: never written to mem / IndexedDB
//   D5 a device copy that is BEHIND the session (mid-day, built last night) is held but not handed to
//      the switch: the view's paint rule is unchanged
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createBarStore } from './index'
import { createPrefetch } from './prefetch'
import { keyOf, STATUS } from './types'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { memClear, memPeekEntry } from '../../utils/barsMemCache'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const OPEN = Date.UTC(2026, 10, 10, 14, 30) / 1000     // Tue 2026-11-10 09:30 ET
const AFTER_CLOSE = (OPEN + 7.5 * 3600) * 1000          // 17:00 ET
const DAY = 86400
/** One RTH session of 5m rows (09:30 … 15:55 ET), prices scaled by `k`. */
const session = (open, k = 1, seed = 0) => {
  const out = []
  for (let i = 0; i < 78; i++) {
    const o = Math.round((50 + ((i * 7 + seed) % 13) / 4) * 100) / 100
    out.push({ t: open + i * 300, o: o * k, h: (o + 0.5) * k, l: (o - 0.5) * k, c: (o + 0.25) * k, v: 1000 + i })
  }
  return out
}
const DEVICE_ROWS = [...session(OPEN - DAY, 1, 3), ...session(OPEN, 1, 5)]

/** The server's answer: today's last 12 buckets (its values = the device's, one row REVISED), × `k`. */
function answer(k = 1) {
  const bars = DEVICE_ROWS.slice(-12).map((r) => ({ ...r, o: r.o * k, h: r.h * k, l: r.l * k, c: r.c * k }))
  bars[5] = { ...bars[5], c: bars[5].o }                  // the vendor revised this close
  return {
    ticker: 'NEWB', tf: '5', bars, contract: 1, grid: 'eth-clock', session: 'rth', cache_key: 'b1:NEWB:5:eth-clock',
    series_rev: 9000, history_rev: 1, verified_through: OPEN + 390 * 60, complete_through: OPEN + 390 * 60,
    tail_status: 'verified', developing: null,
  }
}

// `through`: the unix second the copy is complete up to (deviceStore/engine.js stamps every copy). Default: the close of
// the session the rows end in. ⛔ A copy with NO stamp is never a first frame (review of #2549, P2-M1: the device rule
// cannot vouch for it), so these fakes carry the stamp the engine would give the rows they hold.
function fakeDevice(rows, { cached = false, sym = 'NEWB', tf = '5', through = OPEN + 390 * 60 } = {}) {
  const hit = () => ({ rows, through, savedAt: through * 1000 })
  return {
    peek: vi.fn((s, t) => (cached && s === sym && t === tf ? hit() : null)),
    read: vi.fn(async (s, t) => (s === sym && t === tf ? hit() : null)),
  }
}

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime(AFTER_CLOSE) })
afterEach(() => { vi.useRealTimers() })

function boot({ device, request, idbMs = 0 }) {
  const idbPutMonotonic = vi.fn(async () => {})
  const memPutMonotonic = vi.fn(() => {})
  const io = {
    idbGet: vi.fn(() => new Promise((r) => setTimeout(() => r(null), idbMs))),
    idbGetHistoryEntry: async () => null,
    idbPutMonotonic, memPutMonotonic,
  }
  const store = createBarStore({
    request, device, io, stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), history: null,
  })
  return { store, io, pf: createPrefetch({ store, tickerMeta: () => {} }), key: keyOf({ sym: 'NEWB', tf: '5' }) }
}

describe('the on-device copy in the BarStore', () => {
  it('D1 a symbol in the device cache is displayable in the SAME call, with no request', () => {
    const request = vi.fn(() => new Promise(() => {}))
    const device = fakeDevice(DEVICE_ROWS, { cached: true })
    const { store, pf, key } = boot({ device, request })
    expect(pf.peekDisplayable('NEWB', '5')).toBe(true)
    const s = store.peek(key)
    expect(s.source).toBe('device')
    expect(s.restSeen).toBe(false)
    expect(s.status).toBe(STATUS.CONTEXT)
    expect(s.bars.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v])).toEqual(DEVICE_ROWS.map((r) => [r.t, r.o, r.h, r.l, r.c, r.v]))
    expect(request).not.toHaveBeenCalled()
    expect(device.peek).toHaveBeenCalledWith('NEWB', '5')
    store.dispose()
  })

  it('D2 a never-seen symbol paints from one device read (a slow IndexedDB does not hold it); the answer replaces it', async () => {
    let release
    const request = vi.fn(() => new Promise((r) => { release = () => r(answer()) }))
    const device = fakeDevice(DEVICE_ROWS)
    const { store, key, io } = boot({ device, request, idbMs: 400 })
    const off = store.subscribe(key, () => {})
    await vi.advanceTimersByTimeAsync(1)
    let s = store.getSnapshot(key)
    expect(device.read).toHaveBeenCalledTimes(1)
    expect(s.source).toBe('device')
    expect(s.bars.length).toBe(DEVICE_ROWS.length)
    expect(s.status).toBe(STATUS.CONTEXT)
    expect(io.idbGet).toHaveBeenCalledTimes(1)              // ...still reading
    expect(request).toHaveBeenCalledTimes(1)                // asked, not answered: the paint did not wait

    release()
    await vi.advanceTimersByTimeAsync(20)
    s = store.getSnapshot(key)
    expect(s.restSeen).toBe(true)
    expect(s.source).toBe('rest')
    const byT = new Map(s.bars.map((b) => [b.t, b]))
    const revised = answer().bars[5]
    expect(byT.get(revised.t).c).toBe(revised.c)            // the server's row wins
    expect(byT.get(revised.t).c).not.toBe(DEVICE_ROWS[DEVICE_ROWS.length - 12 + 5].c)
    expect(s.bars[0].t).toBe(DEVICE_ROWS[0].t)              // the older device rows stay (proven basis)
    expect(s.bars.length).toBe(DEVICE_ROWS.length)
    await vi.advanceTimersByTimeAsync(500)
    expect(device.read).toHaveBeenCalledTimes(1)
    off()
    store.dispose()
  })

  it('D3 a device copy on another price basis than the answer is dropped whole (no join across a split)', async () => {
    let release
    const request = vi.fn(() => new Promise((r) => { release = () => r(answer(0.5)) }))
    const { store, key } = boot({ device: fakeDevice(DEVICE_ROWS), request })
    const off = store.subscribe(key, () => {})
    await vi.advanceTimersByTimeAsync(1)
    expect(store.getSnapshot(key).bars.length).toBe(DEVICE_ROWS.length)
    release()
    await vi.advanceTimersByTimeAsync(20)
    const s = store.getSnapshot(key)
    expect(s.restSeen).toBe(true)
    expect(s.bars.length).toBe(12)
    expect(s.bars[0].t).toBe(DEVICE_ROWS[DEVICE_ROWS.length - 12].t)
    off()
    store.dispose()
  })

  it('D4 the device copy is never written to the caches; the server answer is', async () => {
    let release
    const request = vi.fn(() => new Promise((r) => { release = () => r(answer()) }))
    const { store, key, io } = boot({ device: fakeDevice(DEVICE_ROWS), request })
    const off = store.subscribe(key, () => {})
    await vi.advanceTimersByTimeAsync(3000)                 // past the persist debounce
    expect(io.idbPutMonotonic).not.toHaveBeenCalled()
    expect(io.memPutMonotonic).not.toHaveBeenCalled()
    expect(memPeekEntry('NEWB', '5')).toBeFalsy()
    release()
    await vi.advanceTimersByTimeAsync(3000)
    expect(io.idbPutMonotonic).toHaveBeenCalled()
    off()
    store.dispose()
  })

  it('D5 mid-session, last night\'s device copy is held (provisional) but the switch does not paint it alone', () => {
    vi.setSystemTime((OPEN + 2 * 3600) * 1000)              // 11:30 ET: today's bars are not in the seed
    const request = vi.fn(() => new Promise(() => {}))
    const { store, pf, key } = boot({ device: fakeDevice(session(OPEN - DAY), { cached: true, through: OPEN - DAY + 390 * 60 }), request })
    expect(pf.peekDisplayable('NEWB', '5')).toBe(false)
    const s = store.peek(key)
    expect(s.source).toBe('device')
    expect(s.status).toBe(STATUS.PROVISIONAL)
    store.dispose()
  })
})
