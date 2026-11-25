// ⭐ THE FIRST FRAME CORRECT AT THE OPEN (2026-11-25, the live session-open test: D:/uct-history/session-open-20261125).
// Each class the live record found, replayed at the prefetch facade (the handoff's door: `peekDisplayable` decides whether
// a switch paints in its key task, `prepareForDisplay` what it waits for):
//   (0) THE CLOCK. The test PC's clock ran 6.2 s slow and every roll decision read it: a copy a closed bar short read as
//       current for ~6 s after each real roll and painted in the key task (p-1 11-13, 35-36, 58-60; p-2 4-6, 28-29, 52-53,
//       75-76). The facade's clock is the server's now (lib/serverClock.js, learned from the bars answers' Date headers).
//   (2) THE SESSION'S FIRST BUCKET. Inside 09:30-09:45 a 15m copy ending yesterday counted 0 buckets behind (only CLOSED
//       buckets were counted) and painted yesterday's bar as the newest (p-1 71, GLW: the 'one chart only' frame).
//   (1c) THE GRACE ONLY ON PROOF. The switch's own answer one bucket behind, past the 8 s lag window, with no proof that
//       nothing newer existed, was taken for "the name is not printing" and painted short (p-1 51, NXPI: the REST store
//       lagged the stream 7-42 s at the open).
//   (3) A WARM'S DELTA REFUSED FOR A NEW HISTORY. The warm's since= answer carried a higher history_rev (the open's gap
//       fills): the store refused it (needsFull) and applied nothing; nobody repaired the key, so the press asked in full
//       itself (12 presses, the biggest wait class). The warm now reads it in full at once.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN } from './testing/fakeBarsServer'

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
  const { keyOf } = await import('./types')
  const clock = await import('../../lib/serverClock')
  clock.__resetServerClockForTests()
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const pf = createPrefetch({ store, tickerMeta: () => {} })
  return { server, store, pf, keyOf, clock }
}
const asksOf = (calls, sym, tf) => calls.filter((c) => c.q.sym === sym && c.q.tf === tf)

describe('(0) the server clock decides the roll (the member clock 6.2 s slow; p-1 press 11)', () => {
  it('a copy a closed bar short by the server clock is not painted in the key task', async () => {
    const TRUE = (OPEN + 33 * 60) * 1000 + 600          // 10:03:00.6 ET on the server: 10:02 has just closed
    const SKEW = 6200                                    // the member clock reads 10:02:54.4
    vi.setSystemTime(TRUE - SKEW - 30_000)               // the warm, 30 s before: rows through 10:01 (closed only)
    const w = await boot({ modeFor: () => 'closed' })
    const key = w.keyOf({ sym: 'RDDX', tf: '1' })
    w.pf.prefetch([key], { priority: 'urgent' })
    await w.server.drain()
    expect(w.store.peek(key).bars.at(-1).t).toBe(OPEN + 31 * 60)    // 10:01, no developing bar
    vi.setSystemTime(TRUE - SKEW)
    // the member's clock alone: the 10:02 bucket is still forming, the copy reads current (what painted short)
    expect(w.pf.peekDisplayable('RDDX', '1')).toBe(true)
    // three bars answers' Date headers (the server's whole second): the facade now reads the server's 10:03:00.5
    for (let i = 0; i < 3; i++) {
      expect(w.clock.noteServerDate(new Date(TRUE).toUTCString(), { sentAt: Date.now() - 40, receivedAt: Date.now() })).toBe(true)
    }
    expect(Math.abs(w.clock.serverNow() - (Math.floor(TRUE / 1000) * 1000 + 500))).toBeLessThan(60)
    expect(w.pf.peekDisplayable('RDDX', '1')).toBe(false)
  })
})

describe('(2) the session\'s first bucket (p-1 press 71, GLW 15m at 09:39)', () => {
  /** Yesterday's (2026-11-09) regular-session 15m rows, 09:30-15:45, as a server answer. */
  function yesterday15(sym) {
    const open = OPEN - 86400
    const bars = []
    for (let k = 0; k < 26; k++) {
      const c = 40 + k * 0.1
      bars.push({ t: open + k * 900, o: c - 0.1, h: c + 0.3, l: c - 0.3, c, v: 1000 + k })
    }
    const close = open + 26 * 900
    return { ticker: sym, tf: '15', bars, contract: 1, grid: 'eth-clock', session: 'rth', cache_key: `b1:${sym}:15:eth-clock`,
      series_rev: 1, history_rev: 1, verified_through: close, complete_through: close, tail_status: 'verified', developing: null }
  }

  it('after the open, a 15m copy with nothing of today is not displayable; before the open it is', async () => {
    vi.setSystemTime((OPEN - 60) * 1000)                 // 09:29: the session has not opened
    const w = await boot()
    const key = w.keyOf({ sym: 'GLWX', tf: '15' })
    w.store.registry.dispatch(key, { type: 'rest-full', key, payload: yesterday15('GLWX') })
    expect(w.pf.peekDisplayable('GLWX', '15')).toBe(true)
    vi.setSystemTime((OPEN + 8 * 60) * 1000)             // 09:38: inside today's first 15m bucket
    expect(w.pf.peekDisplayable('GLWX', '15')).toBe(false)
  })

  it('...and a copy holding today\'s forming 09:30 bar is displayable at 09:38', async () => {
    vi.setSystemTime((OPEN + 8 * 60) * 1000)
    const w = await boot()
    const key = w.keyOf({ sym: 'GLWY', tf: '15' })
    const p = yesterday15('GLWY')
    p.developing = { t: OPEN, o: 41, h: 41.5, l: 40.8, c: 41.2, v: 300, rev: Date.now() }
    p.verified_through = OPEN + 8 * 60
    w.store.registry.dispatch(key, { type: 'rest-full', key, payload: p })
    expect(w.pf.peekDisplayable('GLWY', '15')).toBe(true)
  })
})
