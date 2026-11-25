// ⭐ THE 2026-11-25 WIDE SWEEP ON PRODUCTION (07c26efed2; D:/uct-history/session-wide-20261125), each class replayed at the
// prefetch facade (the handoff's door: what a switch paints in its key task, and what its prepare waits for).
//   (1) W2, week + month (presses at 13:39-13:40 ET): the month chart painted the right symbol on the current month's bar
//       with an OLD close for 68-284 ms on 23 of 30 presses (press 1, TXN: 295.86 against 265.02). Each of those copies was
//       the answer of a warm 1.9-6.0 s before the press that the server had served from its stale store
//       (`bars(stale-swr)`); the 7 presses that painted right had a `bars(mem)` answer. The server now marks that answer
//       (`tail_status: 'unverified'`): the copy covers nothing for the hold, and the daily prepare asks first. A copy
//       saved before the latest daily close is stale too (its read time known: its saved time).
//   (2) W3, 1m + 15m (presses at 13:42-13:43 ET): the 15m painted 13:15 at 13:43 with no forming 13:30 (presses 24, 25,
//       28, 29; 13:30 came 19-255 ms later), and the 1m painted 13:41 at 13:42:05-13:42:59 with no forming 13:42 (it came
//       46-820 ms later). The closed-bucket count read those copies as current. During the session a copy with no row at
//       or after the current bucket's start is behind, unless the switch's own answer since that bucket opened is what it
//       still holds.
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

const T_W2 = (OPEN + 249 * 60 + 6) * 1000               // Tue 13:39:06 ET (W2 press 1, TXN)

describe('(1) W2: a week or month copy the server served stale is not painted; the daily prepare asks first', () => {
  it('press 1 (TXN M): the warm 6.0 s before was answered stale; at the press it covers nothing and the prepare asks', async () => {
    const st = { mode: 'date-stale' }
    vi.setSystemTime(T_W2 - 6042)
    const w = await boot({ modeFor: () => st.mode })
    await settle(w, w.pf.prepareDailyForDisplay('TXN', 'M'))          // the warm (and its deep join)
    expect(w.pf.deepPending('TXN', 'M')).toBe(false)                    // as in the record: the history had joined
    expect(lastClose(w, 'TXN', 'M')).toBe(29.5)                         // the stale store's close
    vi.setSystemTime(T_W2)
    st.mode = 'date-current'
    // the hold's "the answer covers the view" (useSymbolHandoff `covers`): before, the stale answer covered it
    expect(w.pf.heldRows('TXN', 'M', { answered: true })).toBe(0)
    const n = asks(w, 'TXN', 'M')
    const out = await settle(w, w.pf.prepareDailyForDisplay('TXN', 'M'))
    expect(asks(w, 'TXN', 'M')).toBe(n + 1)                             // asked first (before: none, the copy painted)
    expect(out).toBe('current')
    expect(w.store.peek(w.pf.keyFor('TXN', 'M')).tailStatus).toBe('current')   // the server's word on what paints
    expect(lastClose(w, 'TXN', 'M')).toBe(26.5)                         // what the chart shows first: the current close
    // (not heldRows here: a one-shot ask's network record is let go once it settles, and `answered` with it; the chart's
    // own subscription keeps it. Green run 45690011955.)
    expect(w.pf.dateCopyStale('TXN', 'M')).toBe(false)                 // the hold lets it paint
  })

  it('CONTROL: a copy the server answered current paints as before (covers the view, no ask)', async () => {
    vi.setSystemTime(T_W2 - 6042)
    const w = await boot({ modeFor: () => 'date-current' })
    await settle(w, w.pf.prepareDailyForDisplay('RDDT', 'M'))
    vi.setSystemTime(T_W2)
    expect(w.pf.heldRows('RDDT', 'M', { answered: true })).toBeGreaterThan(0)
    const n = asks(w, 'RDDT', 'M')
    await settle(w, w.pf.prepareDailyForDisplay('RDDT', 'M'))
    expect(asks(w, 'RDDT', 'M')).toBe(n)
  })

  it('CONTROL: a legacy answer (no tail_status) paints as before', async () => {
    vi.setSystemTime(T_W2 - 6042)
    const w = await boot()
    await settle(w, w.pf.prepareDailyForDisplay('LGCY', 'W'))
    vi.setSystemTime(T_W2)
    expect(w.pf.heldRows('LGCY', 'W', { answered: true })).toBeGreaterThan(0)
    const n = asks(w, 'LGCY', 'W')
    await settle(w, w.pf.prepareDailyForDisplay('LGCY', 'W'))
    expect(asks(w, 'LGCY', 'W')).toBe(n)
  })

  // A deep saved copy (its history joined on an earlier visit: not due) paints from the cache at once; read before the
  // latest daily close, its developing bar misses that session.
  const weeks = (n) => Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 10, 9) - (n - 1 - i) * 7 * 86400_000)
    return { t: d.toISOString().slice(0, 10), o: 10, h: 11, l: 9, c: 10.5, v: 100 }
  })
  const MON_1500 = (OPEN - 86400 + 330 * 60) * 1000        // Mon 2026-11-09 15:00 ET: before Monday's close
  const MON_1630 = (OPEN - 86400 + 420 * 60) * 1000        // Mon 16:30 ET: after it

  it('a week copy SAVED before the latest daily close is asked first', async () => {
    vi.setSystemTime(MON_1500)
    const w = await boot({ modeFor: () => 'date-current' })
    await w.idb.idbPutMonotonic('OLDW', 'W', weeks(650))
    vi.setSystemTime(T_W2)
    const out = await settle(w, w.pf.prepareDailyForDisplay('OLDW', 'W'))
    expect(asks(w, 'OLDW', 'W')).toBe(1)                                // before: none (the saved copy painted)
    expect(out).toBe('current')
  })

  it('CONTROL: one saved after it paints from the cache with no ask, as before', async () => {
    vi.setSystemTime(MON_1630)
    const w = await boot({ modeFor: () => 'date-current' })
    await w.idb.idbPutMonotonic('NEWW', 'W', weeks(650))
    vi.setSystemTime(T_W2)
    await settle(w, w.pf.prepareDailyForDisplay('NEWW', 'W'))
    expect(asks(w, 'NEWW', 'W')).toBe(0)
  })
})
