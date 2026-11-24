// ⭐ THE NEIGHBOUR HOLD'S TAIL WITH THE DEVICE STORE ON (now the desktop default, #2537). What the tail does with a row the
// DEVICE holds (a device copy, no server answer), read from the code and pinned here:
//   * `keepTailCurrent` asks only a row `_behindClock` calls behind, and `_bucketsBehind` answers 0 for a device-held copy
//     (`_deviceHeld`: the device's copy is judged by its own complete-through stamp, deviceRefusalOf, never by the clock).
//     So the tail NEVER asks a device-held row: not when it is fresh, and not when it is stale.
//   * The switch refuses a stale one (peekDisplayable / deviceHold: `_deviceRefusal` 'stale', then a device re-read and
//     its own server ask) and accepts a fresh one. The tail never paints anything, so the two never disagree on what is
//     shown: a stale device copy is refused by the switch exactly as on master; the tail only does not get it ahead.
//   * The tail reads the device for nothing: its asks go to the server with the snapshot it holds (`_s0`, no hydrate).
//   T1 a FRESH device copy (complete through the last closed minute): the tail asks nothing; the switch's device rule
//      accepts it; the tail made no device read
//   T2 a STALE device copy (a minute short after the boundary): the tail asks nothing (it leaves it to the switch, which
//      refuses it: deviceHold 'stale'); the tail made no device read, also across the next boundary's pass
// Real store, real network, real facade, a fake device source, a held fake server.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, intradayRows, OPEN } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const at = (h, m, s = 0) => (OPEN + ((h * 60 + m) - (9 * 60 + 30)) * 60 + s) * 1000   // ET wall clock on Tue 2026-11-10
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  fakeDb._clear()
  vi.useFakeTimers()
  localStorage.setItem('barspack.version', 'test')
})
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version') })

/** A device copy of DEV on 1m: today's minutes from the open, the newest starting at `lastStart` (unix s); complete
 *  through the end of that minute. */
function deviceHit(lastStart) {
  const rows = intradayRows(1, lastStart)
  return { n: rows.length, rows, through: lastStart + 60, savedAt: (lastStart + 60) * 1000, formingT: null }
}

async function boot(hit) {
  vi.resetModules()
  const server = installFakeBarsServer({ modeFor: () => 'closed' })
  const { createBarStore } = await import('./index')
  const P = await import('./prefetch')
  const device = { peek: vi.fn((s, t) => (s === 'DEV' && String(t) === '1' ? hit : null)), read: vi.fn(async (s, t) => (s === 'DEV' && String(t) === '1' ? hit : null)) }
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), device,
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const pf = P.createPrefetch({ store, tickerMeta: () => {}, extended: () => false, visible: () => true, random: () => 0 })
  return { server, store, P, pf, device }
}
const tick = (ms) => vi.advanceTimersByTimeAsync(ms)
const devCalls = (w) => w.device.read.mock.calls.length + w.device.peek.mock.calls.length

describe('the tail with the device store on', () => {
  it('T1 a fresh device copy: the tail asks nothing, the switch accepts it, the tail reads the device for nothing', async () => {
    vi.setSystemTime(at(10, 1, 1))
    const w = await boot(deviceHit(OPEN + 30 * 60))               // the 10:00 minute, complete through 10:01: fresh
    const k = w.pf.keyFor('DEV', '1')
    await w.store.persist.refreshDevice(k)
    expect(w.store.peek(k)?.source).toBe('device')               // (precondition: the device holds the key)
    const hold = w.pf.createNeighborHold()
    hold.set(['DEV', 'OTH'], '1', { tail: ['DEV'], selected: 'X' })
    await w.server.drain()
    const calls0 = w.server.calls.filter((c) => c.q.sym === 'DEV').length
    const dev0 = devCalls(w)
    hold.set(['DEV', 'OTH'], '1', { tail: ['DEV'], selected: 'Y' })   // a press: the window opens, the tail is judged
    await w.server.drain()
    await tick(62_000)                                            // past the next boundary's pass (10:02 + its lag)
    await w.server.drain()
    expect(w.server.calls.filter((c) => c.q.sym === 'DEV').length - calls0).toBe(0)
    expect(devCalls(w) - dev0).toBe(0)
    vi.setSystemTime(at(10, 1, 30))                               // (back inside the minute the copy is fresh for)
    expect(w.pf.deviceHold('DEV', '1')).toBe(null)               // the switch's device rule accepts it
    hold.clear()
    w.store.dispose()
  })

  it('T2 a stale device copy: the tail leaves it to the switch (which refuses it), and reads the device for nothing', async () => {
    vi.setSystemTime(at(10, 1, 1))
    const w = await boot(deviceHit(OPEN + 29 * 60))               // the 09:59 minute: a minute short of 10:01
    const k = w.pf.keyFor('DEV', '1')
    await w.store.persist.refreshDevice(k)
    expect(w.store.peek(k)?.source).toBe('device')
    const hold = w.pf.createNeighborHold()
    hold.set(['DEV', 'OTH'], '1', { tail: ['DEV'], selected: 'X' })
    await w.server.drain()
    const calls0 = w.server.calls.filter((c) => c.q.sym === 'DEV').length
    const dev0 = devCalls(w)
    hold.set(['DEV', 'OTH'], '1', { tail: ['DEV'], selected: 'Y' })
    await w.server.drain()
    await tick(62_000)                                            // (still a minute short at 10:02:03)
    await w.server.drain()
    expect(w.server.calls.filter((c) => c.q.sym === 'DEV').length - calls0).toBe(0)
    expect(devCalls(w) - dev0).toBe(0)
    expect(w.pf.deviceHold('DEV', '1')).toBe('stale')            // the switch refuses it (and re-reads, then asks itself)
    hold.clear()
    w.store.dispose()
  })
})
