// M1 (review of #2537): THE INTRADAY BUCKET ROLL, through the real store (registry + reducer + persist) and the real
// prefetch facade, with a device source that says which bar of its copy is the bucket in progress (`formingT`,
// deviceStore/source.js; live.js hands it out relative to the newest minute the device applied).
//   B1 read just AFTER a bucket's end, before the frame of its last minute has landed, the copy's forming bucket is
//      the entry's developing bar (the forming candle), never a closed row one minute short, AND it is no first frame
//      (review of #2549: the rolling refusal; the switch waits for the server's answer, as with the store off)
//   B1c the device catches up (its `through` reaches the bucket's end): then it paints, with the bucket complete
//   B1p the stream's first push for the next bucket closes the short bucket into a row before the answer: still no
//      first frame (a closed row the device's stamp does not cover, in a bucket that has ended)
//   B2 a copy warmed while the bucket formed and re-read after it ended: the device's newer copy brings that bucket
//      COMPLETE, and the complete values are the closed row (the earlier forming bar is not merged over them)
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createBarStore } from './index'
import { createPrefetch } from './prefetch'
import { keyOf, ACTION } from './types'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { memClear } from '../../utils/barsMemCache'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const OPEN = Date.UTC(2026, 10, 18, 14, 30) / 1000             // Wed 2026-11-18 09:30 ET
const T = (etMin) => OPEN + (etMin - 570) * 60                  // ET minute of day → unix s (that session)
const bar = (m, k = 1) => ({ t: T(m), o: 50 * k, h: 50.5 * k, l: 49.5 * k, c: 50.25 * k, v: 1000 })
const closedTo = (lastM) => { const o = []; for (let m = 570; m <= lastM; m += 5) o.push(bar(m)); return o }
const ohlcv = (b) => b && [b.o, b.h, b.l, b.c, b.v]

/** A device source holding one copy (`swap` replaces it): peek answers from its recently-read cache once read. */
function fakeDevice(hit0) {
  let hit = hit0
  return {
    swap(h) { hit = h },
    peek: vi.fn((s, t) => (s === 'NEWB' && t === '5' ? hit : null)),
    read: vi.fn(async (s, t) => (s === 'NEWB' && t === '5' ? hit : null)),
  }
}
const copy = (rows, { through, formingT = null }) => ({ rows, through, savedAt: through * 1000, formingT })

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

function boot(device) {
  const store = createBarStore({
    request: vi.fn(() => new Promise(() => {})), device,
    io: { idbGet: async () => null, idbGetHistoryEntry: async () => null, idbPutMonotonic: async () => {}, memPutMonotonic: () => {} },
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
    history: null,
  })
  return { store, pf: createPrefetch({ store, tickerMeta: () => {}, extended: () => false }), key: keyOf({ sym: 'NEWB', tf: '5' }) }
}

describe('M1 the bucket roll', () => {
  it('B1 after the bucket\'s end, before its last minute landed: the forming candle, never a closed row', () => {
    vi.setSystemTime((T(605) + 5) * 1000)                           // 10:05:05: the 10:00 bucket ended 5 s ago
    const SHORT = { ...bar(600, 1.01), c: 50.9 }                     // minutes 10:00-10:03: the 10:04 frame not yet in
    const { store, pf, key } = boot(fakeDevice(copy([...closedTo(595), SHORT], { through: T(604), formingT: T(600) })))
    pf.peekDisplayable('NEWB', '5')
    const s = store.peek(key)
    expect(s.source).toBe('device')
    expect(s.bars.at(-1).t).toBe(T(595))                             // the closed rows stop before it
    expect(s.bars.some((b) => b.t === T(600))).toBe(false)
    expect(s.developing?.t).toBe(T(600))                            // ...it is the forming candle
    expect(ohlcv(s.developing)).toEqual(ohlcv(SHORT))
    // (review of #2554, P3-M1: the rolled bucket is the device's stamp short of the current bucket's START: 'stale')
    expect(pf.deviceVerdict('NEWB', '5', { showExtended: false })).toMatchObject({ paints: false, reason: 'stale', held: 'device' })
    expect(pf.peekDisplayable('NEWB', '5')).toBe(false)
    store.dispose()
  })

  it("B1c the device catches up (through covers the bucket's end): then it paints, the bucket complete", () => {
    vi.setSystemTime((T(605) + 5) * 1000)
    const SHORT = { ...bar(600, 1.01), c: 50.9 }
    const dev = fakeDevice(copy([...closedTo(595), SHORT], { through: T(604), formingT: T(600) }))
    const { store, pf, key } = boot(dev)
    pf.peekDisplayable('NEWB', '5')
    expect(pf.devicePaints('NEWB', '5')).toBe(false)
    vi.setSystemTime((T(605) + 12) * 1000)                          // 10:05:12: the 10:04 frame has landed
    const WHOLE = { ...bar(600, 1.01), c: 51.1, v: 1300 }
    dev.swap(copy([...closedTo(595), WHOLE], { through: T(605) }))  // complete through 10:05:00, nothing forming yet
    expect(pf.peekDisplayable('NEWB', '5')).toBe(true)              // (the waiter's look re-reads the device)
    expect(pf.deviceVerdict('NEWB', '5', { showExtended: false })).toMatchObject({ paints: true, reason: 'paints' })
    const s = store.peek(key)
    expect(ohlcv(s.bars.find((b) => b.t === T(600)))).toEqual(ohlcv(WHOLE))
    store.dispose()
  })

  it("B1p the stream's push for the next bucket closes the short bucket before the answer: still no first frame", () => {
    vi.setSystemTime((T(605) + 5) * 1000)
    const SHORT = { ...bar(600, 1.01), c: 50.9 }
    const { store, pf, key } = boot(fakeDevice(copy([...closedTo(595), SHORT], { through: T(604), formingT: T(600) })))
    pf.peekDisplayable('NEWB', '5')
    store.registry.dispatch(key, { type: ACTION.PUSH_BAR, key, event: { sym: 'NEWB', t: T(605), o: 51, h: 51.2, l: 50.9, c: 51.1, v: 40, rev: 1 } })
    const s = store.peek(key)
    expect(s.developing?.t).toBe(T(605))                            // the push opened the next bucket...
    expect(ohlcv(s.bars.find((b) => b.t === T(600)))).toEqual(ohlcv(SHORT))   // ...and closed the short one
    expect(pf.deviceVerdict('NEWB', '5', { showExtended: false })).toMatchObject({ paints: false, reason: 'stale' })
    expect(pf.peekDisplayable('NEWB', '5')).toBe(false)
    store.dispose()
  })

  it('B2 warmed while the bucket formed, re-read after it ended: the device\'s complete bucket is the closed row', () => {
    vi.setSystemTime((T(602) + 10) * 1000)                          // 10:02:10
    const A = { ...bar(600, 1.02), c: 51.3, v: 400 }                  // the 10:00 bucket two minutes in
    const dev = fakeDevice(copy([...closedTo(595), A], { through: T(602), formingT: T(600) }))
    const { store, pf, key } = boot(dev)
    pf.peekDisplayable('NEWB', '5')                                  // a warm: the key holds the device copy
    expect(store.peek(key).developing?.t).toBe(T(600))
    vi.setSystemTime((T(607) + 10) * 1000)                          // 10:07:10: the member switches to it
    const B = { ...bar(600, 1.03), h: 53, c: 52.4, v: 1100 }         // the 10:00 bucket COMPLETE
    const NEXT = bar(605, 1.04)
    dev.swap(copy([...closedTo(595), B, NEXT], { through: T(607), formingT: T(605) }))
    expect(pf.deviceVerdict('NEWB', '5', { showExtended: false }).paints).toBe(true)   // (re-read in the same call)
    const s = store.peek(key)
    expect(ohlcv(s.bars.find((b) => b.t === T(600)))).toEqual(ohlcv(B))
    expect(s.developing?.t).toBe(T(605))
    store.dispose()
  })
})
