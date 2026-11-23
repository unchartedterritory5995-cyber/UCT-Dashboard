// P6-L1 (review of #2565): A NEWER RE-READ THAT FOUND NOTHING NEWER IS NOT ASKED AGAIN AT ONCE. After a minute closes, a
// held copy reads 'stale' until the device applies that minute's frame, and every look of the switch (a held arrow: every
// press, per intraday chart) re-read it newer, an urgent worker read that could not succeed yet. The frame lands on the
// feed's own schedule: polled at the minute's end + 7 s + up to 3 s of jitter, then every 2 s until it is there
// (lib/minuteFrames/consumer.js), so the device's copy changes at most about every 2 s while a frame is landing. A key
// whose newer read found nothing newer is not asked newer again within NEWER_RETRY_MS (1.5 s) for the same held copy; a
// newer held copy or another key asks at once. Through the real store, facade and device client (a worker that answers
// each read with the copy it holds at that moment):
//   NB1 seven asks inside the window cost ONE worker read; the frame landing after it is picked up on the next ask
//   NB2 another key is not held back by the first key's miss
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createBarStore } from './index'
import { createPrefetch } from './prefetch'
import { keyOf } from './types'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { createDeviceClient } from '../deviceStore/client'
import { createDeviceSource } from '../deviceStore/source'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const OPEN = Date.UTC(2026, 10, 18, 14, 30) / 1000             // Wed 2026-11-18 09:30 ET
const T = (etMin) => OPEN + (etMin - 570) * 60
const NO_IO = {
  memPeekEntry: () => null, idbGet: async () => null, idbGetHistoryEntry: async () => null,
  memPutMonotonic: () => {}, idbPutMonotonic: async () => {}, idbPutHistory: async () => {},
}
function cols(lastMin, through) {
  const n = lastMin - 570 + 1
  const f = (fn) => Float64Array.from({ length: n }, (_, i) => fn(i))
  return { t: f((i) => T(570 + i)), o: f((i) => 50 + i / 100), h: f((i) => 50.4 + i / 100), l: f((i) => 49.6 + i / 100),
    c: f((i) => 50.1 + i / 100), v: f(() => 100), build: '20261118T0000Z', through }
}
/** A worker that answers every read, a moment later, with the copy it holds for that symbol at that moment. */
function liveWorker(state) {
  const w = { onmessage: null, onerror: null, terminate: () => {}, reads: [] }
  w.postMessage = (m) => {
    if (m.op !== 'read') return
    w.reads.push(m.sym)
    Promise.resolve().then(() => w.onmessage({ data: { id: m.id, ok: true, res: state[m.sym] ?? null } }))
  }
  return w
}
function boot(state) {
  const worker = liveWorker(state)
  const client = createDeviceClient({ makeWorker: () => worker, afterPaint: () => {} })
  const device = createDeviceSource({ load: async () => client, current: () => client })
  const store = createBarStore({
    request: vi.fn(() => new Promise(() => {})), device, history: null, io: NO_IO,
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  return { worker, store, pf: createPrefetch({ store, tickerMeta: () => {}, extended: () => false }) }
}
const reads = (w, sym) => w.reads.filter((s) => s === sym).length
const verdict = (pf, sym) => pf.deviceVerdict(sym, '1', { showExtended: false })

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('P6-L1 a newer re-read that found nothing is not asked again at once', () => {
  it('NB1 seven asks inside the window cost one worker read; the frame landing after it is picked up on the next ask', async () => {
    vi.setSystemTime((T(604) + 58) * 1000)                           // 10:04:58
    const state = { NEWB: cols(603, T(604)) }                        // complete through 10:04:00
    const { worker, store, pf } = boot(state)
    pf.peekDisplayable('NEWB', '1')
    await vi.advanceTimersByTimeAsync(5)
    vi.setSystemTime((T(605) + 5) * 1000)                            // 10:05:05: stale; the 10:04 frame not in yet
    const r0 = reads(worker, 'NEWB')
    expect(verdict(pf, 'NEWB')).toMatchObject({ paints: false, reason: 'stale' })
    await vi.advanceTimersByTimeAsync(1)                             // its newer read answers: nothing newer
    expect(reads(worker, 'NEWB') - r0).toBe(1)
    for (let i = 0; i < 6; i++) {                                    // a held arrow: an ask every 200 ms for 1.2 s
      await vi.advanceTimersByTimeAsync(200)
      expect(verdict(pf, 'NEWB').paints).toBe(false)
    }
    await vi.advanceTimersByTimeAsync(1)
    expect(reads(worker, 'NEWB') - r0).toBe(1)                       // one read, not seven
    await vi.advanceTimersByTimeAsync(348)                           // 10:05:06.550: the window is over...
    state.NEWB = cols(604, T(605))                                   // ...and the frame lands
    await vi.advanceTimersByTimeAsync(50)
    verdict(pf, 'NEWB')                                              // the next ask
    await vi.advanceTimersByTimeAsync(5)
    expect(reads(worker, 'NEWB') - r0).toBe(2)
    expect(store.persist.deviceThroughOf(store.peek(keyOf({ sym: 'NEWB', tf: '1' })).key)).toBe(T(605))
    expect(verdict(pf, 'NEWB')).toMatchObject({ paints: true })
    store.dispose()
  })

  it('NB2 another key is not held back by the first key\'s miss', async () => {
    vi.setSystemTime((T(604) + 58) * 1000)
    const state = { NEWB: cols(603, T(604)), OTHR: cols(603, T(604)) }
    const { worker, store, pf } = boot(state)
    pf.peekDisplayable('NEWB', '1')
    pf.peekDisplayable('OTHR', '1')
    await vi.advanceTimersByTimeAsync(5)
    vi.setSystemTime((T(605) + 5) * 1000)
    verdict(pf, 'NEWB')
    await vi.advanceTimersByTimeAsync(200)                           // NEWB's miss is 200 ms old
    const o0 = reads(worker, 'OTHR')
    verdict(pf, 'OTHR')
    await vi.advanceTimersByTimeAsync(1)
    expect(reads(worker, 'OTHR') - o0).toBe(1)
    store.dispose()
  })
})
