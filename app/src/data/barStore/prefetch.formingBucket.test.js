// ⭐ THE 2026-11-25 WIDE SWEEP ON PRODUCTION (07c26efed2; D:/uct-history/session-wide-20261125), each class replayed at the
// prefetch facade (the handoff's door: what a switch paints in its key task, and what its prepare waits for).
//   (1) W2, week + month (presses at 13:39-13:40 ET): the month chart painted the right symbol on the current month's bar
//       with an OLD close for 68-284 ms on 23 of 30 presses (press 1, TXN: 295.86 against 265.02). Each of those copies was
//       the answer of a warm 1.9-6.0 s before the press that the server had served from its stale store
//       (`bars(stale-swr)`); the 7 presses that painted right had a `bars(mem)` answer. The server now marks that answer
//       (`tail_status: 'unverified'`): the copy covers nothing for the hold, and the daily prepare asks first. A copy
//       saved before the latest daily close is stale too (its read time known: its saved time).
//   (2) W3, 1m + 15m (presses at 13:42-13:43 ET): the 15m painted 13:15 at 13:43 with no forming 13:30 (presses 24, 25,
//       28, 29; 13:30 came 19-255 ms later). Each of those copies had shown 13:30 on the same symbol about a minute before:
//       the copy LOST the forming bucket its last answer left it. Such a copy is behind; one that never held the bucket is
//       judged by the closed buckets, as before.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN, intradayRows } from './testing/fakeBarsServer'
import { ACTION } from './types'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  fakeDb._clear()
  vi.useFakeTimers()
  localStorage.setItem('barspack.version', 'test')
})
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version') })

async function boot({ modeFor } = {}) {
  vi.resetModules()
  const server = installFakeBarsServer({ modeFor })
  const { createBarStore } = await import('./index')
  const { createPrefetch } = await import('./prefetch')
  const idb = await import('../../utils/barsIDB')
  const clock = await import('../../lib/serverClock')
  clock.__resetServerClockForTests()
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const pf = createPrefetch({ store, tickerMeta: () => {} })
  return { server, store, pf, idb }
}
const asks = (w, sym, tf) => w.server.calls.filter((c) => c.q.sym === sym && c.q.tf === tf && !c.q.history).length
const settle = async (w, p, ms = 1000) => { await w.server.drain(); await vi.advanceTimersByTimeAsync(ms); await w.server.drain(); return p }
const lastClose = (w, sym, tf) => { const s = w.store.peek(w.pf.keyFor(sym, tf)); return (s.developing ?? s.bars.at(-1)).c }

describe('(2) W3: in the session a copy with nothing at or after the current bucket\'s start is behind', () => {
  const T25 = (OPEN + 253 * 60 + 13) * 1000              // Tue 13:43:13 ET (W3 press 25, CRWD): the 13:30 15m bucket forms

  it('CONTROL: a copy that never held the forming bucket is judged by the closed buckets, as before (the tail scan)', async () => {
    vi.setSystemTime(T25 - 68_000)                         // a warm at 13:42:05: closed buckets only, no forming 13:30
    const w = await boot({ modeFor: () => 'closed' })
    const key = w.pf.keyFor('CRWC', '15')
    await settle(w, w.pf.ensure(key, { priority: 'urgent' }), 10)
    expect(w.store.peek(key).bars.at(-1).t).toBe(OPEN + 225 * 60)        // 13:15
    vi.setSystemTime(T25)
    expect(w.pf.peekDisplayable('CRWC', '15')).toBe(true)
  })

  it('CONTROL: the switch\'s own answer since the bucket opened, still held, is the server\'s word: it paints', async () => {
    vi.setSystemTime(T25 - 2000)
    const w = await boot({ modeFor: () => 'closed' })
    const out = await settle(w, w.pf.prepareForDisplay('THIN', '15'), 10)
    expect(out).not.toBe('error')
    expect(w.store.peek(w.pf.keyFor('THIN', '15')).bars.at(-1).t).toBe(OPEN + 225 * 60)
    vi.setSystemTime(T25)
    expect(w.pf.peekDisplayable('THIN', '15')).toBe(true)                  // no re-ask loop for a name not printing
  })

  it('press 25 as recorded: the switch\'s own answer HELD 13:30; a copy that lost it since is behind again', async () => {
    vi.setSystemTime(T25 - 68_000)                         // press 0 at 13:42:05: its own answer holds the forming 13:30
    const w = await boot()
    const key = w.pf.keyFor('CRWD', '15')
    await settle(w, w.pf.prepareForDisplay('CRWD', '15'), 10)
    const held = (s) => Math.max(s.bars.at(-1)?.t ?? -Infinity, s.developing?.t ?? -Infinity)
    expect(held(w.store.peek(key))).toBe(OPEN + 240 * 60)               // 13:30
    // ...then the copy loses it: dropped, and read back from a cache record written at 13:29, before 13:30 opened
    w.store.invalidate(key)
    const rows = intradayRows(15, OPEN + 239 * 60).filter((b) => b.t <= OPEN + 225 * 60)
    w.store.registry.dispatch(key, { type: ACTION.MEM_HIT, key, gen: w.store.peek(key).gen, payload: { bars: rows, saved_at: (OPEN + 239 * 60) * 1000 } })
    vi.setSystemTime(T25)
    expect(held(w.store.peek(key))).toBe(OPEN + 225 * 60)               // 13:15: the copy no longer holds 13:30
    expect(w.pf.peekDisplayable('CRWD', '15')).toBe(false)              // before: true (13:15 alone, in the key task)
  })

  it('CONTROL: a copy holding the forming bucket paints at once', async () => {
    vi.setSystemTime(T25 - 10_000)
    const w = await boot()
    await settle(w, w.pf.ensure(w.pf.keyFor('CRWE', '15'), { priority: 'urgent' }), 10)
    vi.setSystemTime(T25)
    expect(w.pf.peekDisplayable('CRWE', '15')).toBe(true)
  })

  it('CONTROL: after the close the session\'s last bar is the frontier (no forming bucket)', async () => {
    vi.setSystemTime((OPEN + 395 * 60) * 1000)            // Tue 16:05 ET
    const w = await boot({ modeFor: () => 'closed' })
    await settle(w, w.pf.ensure(w.pf.keyFor('CRWF', '15'), { priority: 'urgent' }), 10)
    expect(w.pf.peekDisplayable('CRWF', '15')).toBe(true)
  })
})
