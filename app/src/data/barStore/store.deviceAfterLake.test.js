// P2-M1 (review of #2549): THE DEVICE RULES OUTLIVE THE LAKE. Every device rule (the extended-hours rule, the stamp's
// freshness, the rolling bucket) used to key on `source === 'device'`. On a normal intraday switch the history lake
// loads into the device-held entry (network.lakeSeed) and the entry's source becomes 'lake': from then on the switch
// committed through peekDisplayable / _localPaints / the lake-alone commit on status alone. And for a key the lake does
// not carry, a device copy committed on status alone too (peekDisplayable never read the copy's stamp). Now the rules
// key on "the entry holds a device copy's rows and no server answer" (reducer `deviceRows`), whatever joined it since.
// Through the real store (registry + reducer + persist + network) and the real prefetch facade, with a lake that
// ACTUALLY ANSWERS (the earlier rails used one that never did, so none could see this):
//   DA1 an EXTENDED view after the lake joined: never painted from the device rows, by any door, until the answer
//   DA2 ...with the lake answering WHILE the switch prepares (the lake-alone commit and its fallback included)
//   DA3 a rolling forming bar after the lake joined: never a first frame
//   DA4 a device copy minutes stale after the lake joined: judged by its own stamp, never painted on the clock rule
//   DA5 a key the lake does not carry: a stale device copy is not painted on its status
//   DA6 a saved copy that JOINED the device copy: the device rules still judge the entry
//   DA7 the rules end with the device rows: a saved copy that replaces them (another price basis), an invalidate
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createBarStore } from './index'
import { createPrefetch } from './prefetch'
import { keyOf, STATUS, ACTION } from './types'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { memClear } from '../../utils/barsMemCache'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const OPEN = Date.UTC(2026, 10, 18, 14, 30) / 1000        // Wed 2026-11-18 09:30 ET
const DAY = 86400
const T = (etMin) => OPEN + (etMin - 570) * 60              // ET minute of day, today
const bar = (t, k, i) => { const o = Math.round((50 + ((i * 7) % 13) / 4) * 100) / 100 * k; return { t, o, h: o + 0.5 * k, l: o - 0.5 * k, c: o + 0.25 * k, v: 1000 + i } }
const session = (open, upto, k = 1) => { const out = []; for (let i = 0; i < 78 && open + i * 300 <= upto; i++) out.push(bar(open + i * 300, k, i)); return out }
const YESTERDAY = session(OPEN - DAY, Infinity)
/** The device copy at 11:31: yesterday's session + today's regular session to the 11:25 bucket, all complete. */
const DEVICE = [...YESTERDAY, ...session(OPEN, T(685))]
const THROUGH = T(691)                                       // 11:31:00, the end of the 11:30 minute
/** The lake: the two sessions before today, the newer one equal to the device's (so they join on one basis). */
const LAKE = [...session(OPEN - 2 * DAY, Infinity), ...YESTERDAY]

function answer() {
  const pre = [{ t: OPEN - 3600, o: 49, h: 49.5, l: 48.5, c: 49.25, v: 10 }]
  return {
    ticker: 'NEWB', tf: '5', bars: [...YESTERDAY, ...pre, ...session(OPEN, T(685))], contract: 1, grid: 'eth-clock', session: 'rth',
    cache_key: 'b1:NEWB:5:eth-clock', series_rev: 9000, history_rev: 1, verified_through: THROUGH, complete_through: T(690),
    tail_status: 'verified', developing: { ...bar(T(690), 1, 24), rev: 9001 },
  }
}

/** A device source holding one copy for (NEWB, 5m): `formingT` names its bucket in progress (deviceStore/source.js). */
function fakeDevice(rows, { through = THROUGH, formingT = null } = {}) {
  let hit = { rows, through, savedAt: through * 1000, formingT }
  return {
    swap(r, th, f = null) { hit = { rows: r, through: th, savedAt: th * 1000, formingT: f } },
    peek: vi.fn((s, t) => (s === 'NEWB' && t === '5' ? hit : null)),
    read: vi.fn(async (s, t) => (s === 'NEWB' && t === '5' ? hit : null)),
  }
}
/** A history lake that answers (after `delayMs`, 0: on the next microtask) with every row older than asked. */
const answeringLake = (rows, delayMs = 0) => ({
  olderBars: vi.fn((key, beforeT) => (delayMs
    ? new Promise((r) => setTimeout(() => r({ bars: rows.filter((b) => b.t < beforeT) }), delayMs))
    : Promise.resolve({ bars: rows.filter((b) => b.t < beforeT) }))),
  prime: vi.fn(),
  hasSymbol: vi.fn(async () => true),
})

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime(THROUGH * 1000) })
afterEach(() => { vi.useRealTimers() })

function boot({ device, history = null }) {
  let release = () => {}
  const request = vi.fn(() => new Promise((r) => { release = () => r(answer()) }))
  const store = createBarStore({
    request, device, history,
    io: { idbGet: async () => null, idbGetHistoryEntry: async () => null, idbPutMonotonic: async () => {}, memPutMonotonic: () => {} },
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const pf = createPrefetch({ store, tickerMeta: () => {}, extended: () => false })
  return { store, pf, request, key: keyOf({ sym: 'NEWB', tf: '5' }), release: () => release() }
}
/** The intraday prepare's outcome, read at any time ('pending' until it reports). */
function prepare(pf, opts) {
  const o = { v: 'pending' }
  pf.prepareForDisplay('NEWB', '5', opts).then((x) => { o.v = x }, () => { o.v = 'rejected' })
  return o
}

describe('P2-M1 the device rules outlive the lake', () => {
  it('DA1 an EXTENDED view after the lake joined the device copy: never painted from it, by any door, until the answer', async () => {
    const w = boot({ device: fakeDevice(DEVICE), history: answeringLake(LAKE) })
    w.pf.peekDisplayable('NEWB', '5')                                  // the device copy lands (the RTH view's look)
    expect(w.store.peek(w.key).source).toBe('device')
    await vi.advanceTimersByTimeAsync(20)                               // (its hydrate settles first)
    expect(await w.store.lakeSeed(w.key)).toBe('seed')                // the lake ANSWERS and joins it
    expect(w.store.peek(w.key).source).toBe('lake')
    expect(w.pf.peekDisplayable('NEWB', '5', { showExtended: true })).toBe(false)
    expect(w.pf.peekDisplayable('NEWB', '5', { showExtended: false })).toBe(true)   // the regular-session view still paints
    const ext = prepare(w.pf, { showExtended: true })
    await vi.advanceTimersByTimeAsync(3000)
    expect(ext.v).toBe('pending')                                       // no commit on the device's rows
    w.release()
    await vi.advanceTimersByTimeAsync(1000)
    expect(ext.v).not.toBe('pending')                                   // the answer (with today's pre-market bar) commits
    expect(w.store.peek(w.key).restSeen).toBe(true)
    w.store.dispose()
  })

  it('DA2 ...the lake answering WHILE the extended switch prepares: no lake-alone commit either', async () => {
    const w = boot({ device: fakeDevice(DEVICE), history: answeringLake(LAKE, 100) })
    w.pf.peekDisplayable('NEWB', '5')
    const ext = prepare(w.pf, { showExtended: true })
    await vi.advanceTimersByTimeAsync(3000)                            // past LAKE_ALONE_MS and LAKE_BEHIND_MAX_MS
    expect(w.store.peek(w.key).source).toBe('lake')                    // the lake did join, during the prepare
    expect(ext.v).toBe('pending')
    w.store.dispose()
  })

  it('DA3 a rolling forming bar after the lake joined: never a first frame', async () => {
    vi.setSystemTime((T(605) + 5) * 1000)                              // 10:05:05: the 10:00 bucket ended 5 s ago
    const SHORT = { ...bar(T(600), 1.01, 6), c: 50.9 }                 // minutes 10:00-10:03: the 10:04 frame not yet in
    const rows = [...YESTERDAY, ...session(OPEN, T(595)), SHORT]
    const w = boot({ device: fakeDevice(rows, { through: T(604), formingT: T(600) }), history: answeringLake(LAKE) })
    w.pf.peekDisplayable('NEWB', '5')
    await vi.advanceTimersByTimeAsync(20)
    expect(await w.store.lakeSeed(w.key)).toBe('seed')
    expect(w.store.peek(w.key).source).toBe('lake')
    expect(w.pf.peekDisplayable('NEWB', '5')).toBe(false)
    const rth = prepare(w.pf, { showExtended: false })
    await vi.advanceTimersByTimeAsync(3000)
    expect(rth.v).toBe('pending')
    w.store.dispose()
  })

  it('DA4 a device copy minutes stale after the lake joined: judged by its stamp, never painted on the clock rule', async () => {
    const OLD = [...YESTERDAY, ...session(OPEN, T(680))]               // through the 11:20 bucket
    const w = boot({ device: fakeDevice(OLD, { through: T(686) }), history: answeringLake(LAKE) })   // complete through 11:26
    w.pf.peekDisplayable('NEWB', '5')
    await vi.advanceTimersByTimeAsync(20)
    expect(await w.store.lakeSeed(w.key)).toBe('seed')
    expect(w.store.peek(w.key).status).toBe(STATUS.CONTEXT)            // current by status (one bucket)...
    const rth = prepare(w.pf, { showExtended: false })
    await vi.advanceTimersByTimeAsync(1500)                            // past BEHIND_HOLD_MAX_MS
    expect(rth.v).toBe('pending')                                       // ...but 5 minutes old by its stamp
    w.store.dispose()
  })

  it('DA5 a key the lake does not carry: a stale device copy is not painted on its status', async () => {
    const OLD = [...YESTERDAY, ...session(OPEN, T(680))]
    const w = boot({ device: fakeDevice(OLD, { through: T(686) }) })   // no lake at all
    expect(w.pf.peekDisplayable('NEWB', '5')).toBe(false)
    expect(w.store.peek(w.key).status).toBe(STATUS.CONTEXT)
    expect(w.pf.devicePaints('NEWB', '5')).toBe(false)
    const rth = prepare(w.pf, { showExtended: false })
    await vi.advanceTimersByTimeAsync(1500)
    expect(rth.v).toBe('pending')
    w.store.dispose()
  })

  it('DA6 a saved copy that JOINED the device copy: the device rules still judge the entry', () => {
    const w = boot({ device: fakeDevice(DEVICE) })
    w.pf.peekDisplayable('NEWB', '5')
    w.store.registry.dispatch(w.key, { type: ACTION.IDB_HIT, key: w.key, payload: { bars: DEVICE.slice(0, 80) } })
    expect(w.store.peek(w.key).source).toBe('idb')
    expect(w.pf.peekDisplayable('NEWB', '5', { showExtended: true })).toBe(false)
    expect(w.pf.peekDisplayable('NEWB', '5', { showExtended: false })).toBe(true)
    w.store.dispose()
  })

  it('DA7 the rules end with the device rows: a saved copy that REPLACES them, an invalidate', async () => {
    // the same saved copy on another price basis (a split between the two), held by a store with no device
    const OTHER = DEVICE.map((b) => ({ ...b, o: b.o / 2, h: b.h / 2, l: b.l / 2, c: b.c / 2, v: b.v * 2 }))
    const saved = (key) => ({ type: ACTION.IDB_HIT, key, payload: { bars: OTHER } })
    const ref = boot({ device: null })
    ref.store.registry.acquire(ref.key)
    ref.store.registry.dispatch(ref.key, saved(ref.key))
    const want = [false, true].map((x) => ref.pf.peekDisplayable('NEWB', '5', { showExtended: x }))
    ref.store.dispose()
    const a = boot({ device: fakeDevice(DEVICE) })
    a.pf.peekDisplayable('NEWB', '5')
    a.store.registry.dispatch(a.key, saved(a.key))
    expect(a.store.peek(a.key).bars[0].o).toBe(OTHER[0].o)             // the saved copy replaced the device rows
    expect(a.store.peek(a.key).deviceRows).toBeFalsy()
    expect([false, true].map((x) => a.pf.peekDisplayable('NEWB', '5', { showExtended: x }))).toEqual(want)
    a.store.dispose()
    const b = boot({ device: fakeDevice(DEVICE) })
    b.pf.peekDisplayable('NEWB', '5')
    expect(b.store.peek(b.key).deviceRows).toBe(true)
    b.store.invalidate(b.key)
    expect(b.store.peek(b.key).deviceRows).toBeFalsy()
    b.store.dispose()
  })
})
