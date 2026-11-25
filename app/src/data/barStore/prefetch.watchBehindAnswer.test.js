// ⭐ THE WAITER IS WOKEN ONCE THE ANSWER IS NOTED, FOR THE BEHIND-THE-CLOCK RULE TOO (2026-11-23, the live-session read of
// the device store, item 2). With the device store on, the symbol handoff's waiter is the entry watcher (prefetch.watch,
// useSymbolHandoff watchEntry), not the 25 ms poll. In a live session a held intraday copy goes behind the clock at a bucket
// roll, and the switch takes the intraday prepare's "ask for the tail first" branch. The rule that then decides whether
// the copy paints, `_behindClock`, says "not behind" for an answer that landed within BEHIND_RECHECK_MS (the name is not
// printing: it paints as it is), and it reads that off `asked` (ensure: `answered`), which is set only AFTER the await that
// lands the answer, so after the dispatch that wakes the watcher and after the network's own `answered` signal (which a
// key's later answers do not even send: it is the key's FIRST answer of its life). An answer whose tail is still one
// bucket behind therefore woke the waiter while it still read "behind", and nothing woke it again: the switch waited for
// the prepare's end, which waits for the lake's join (LAKE_JOIN_WAIT_MS). The poll the watcher replaced read it on its
// next tick. Real store, real network, real facade, a held fake server, a lake that never settles.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

// 09:50:20 ET: the 09:45 5m bucket has closed. The server's answer ('behind': its newest row is 09:40) is ONE bucket behind.
const NOW = (OPEN + 20 * 60 + 20) * 1000
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  fakeDb._clear()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  localStorage.setItem('barspack.version', 'test')
})
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version') })

async function boot() {
  vi.resetModules()
  // a thin name, one bucket behind WITH the server's proof (verified_through now): since 2026-11-25 the switch's own answer
  // lends the "not printing" grace on that proof only (prefetch _ownGrace; the bucket-count fallback is gone)
  const server = installFakeBarsServer({ modeFor: () => 'thin:1' })
  const { createBarStore } = await import('./index')
  const { createPrefetch, LAKE_JOIN_WAIT_MS } = await import('./prefetch')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  // the lake carries the key and its join never settles: the prepare's end is then LAKE_JOIN_WAIT_MS after the answer
  const lakeStore = { ...store, lakeCarries: () => true, lakeSeed: () => new Promise(() => {}), lakePending: () => false }
  return { server, store, LAKE_JOIN_WAIT_MS, pf: createPrefetch({ store: lakeStore, tickerMeta: () => {}, extended: () => false }) }
}
const tick = (ms) => vi.advanceTimersByTimeAsync(ms)

describe('prefetch.watch wakes the waiter once the answer is noted (behind-the-clock rule)', () => {
  it('W1 an answer one bucket behind: the waiter wakes reading the key DISPLAYABLE, long before the prepare ends', async () => {
    const w = await boot()
    const key = w.pf.keyFor('SPY', '5')
    // the key holds the server's answer (the neighbour warm's), one bucket behind the clock
    const first = w.pf.ensure(key, { priority: 'urgent' })
    await tick(130)
    await w.server.drain()
    await first
    // (#2619 (A): the grace is the switch's OWN answer's, never a warm's: this one lends none. The prepare's own answer
    // below is what starts it, and what the waiter must read.)
    expect(w.pf.peekDisplayable('SPY', '5')).toBe(false)
    await tick(6000)                                            // past BEHIND_RECHECK_MS
    expect(w.pf.peekDisplayable('SPY', '5')).toBe(false)       // (precondition: the switch prepares it)

    const seen = []
    const off = w.pf.watch('SPY', '5', {}, () => { seen.push(w.pf.peekDisplayable('SPY', '5')) })
    const out = { v: 'pending' }
    w.pf.prepareForDisplay('SPY', '5').then((x) => { out.v = x })
    await w.server.flush(40)
    const open = w.server.open()
    expect(open).toHaveLength(1)                               // the prepare asks for the tail first
    open[0].respond()                                          // ...and the answer is still one bucket behind
    await w.server.flush(40)
    expect(w.pf.peekDisplayable('SPY', '5')).toBe(true)        // what a 25 ms poll reads now
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[seen.length - 1]).toBe(true)                   // ...and what the waiter's last wake read
    expect(out.v).toBe('pending')                              // the prepare still waits for the lake's join
    await tick(w.LAKE_JOIN_WAIT_MS + 10)
    expect(out.v).toBe('current')                              // (the moment the switch committed before this fix)
    off()
    w.store.dispose()
  })

  it('W2 the unsubscribe stops the new wake too', async () => {
    const w = await boot()
    const key = w.pf.keyFor('SPY', '5')
    const first = w.pf.ensure(key, { priority: 'urgent' })
    await tick(130)
    await w.server.drain()
    await first
    await tick(6000)
    let n = 0
    const off = w.pf.watch('SPY', '5', {}, () => { n++ })
    off()
    w.pf.prepareForDisplay('SPY', '5')
    await w.server.flush(40)
    for (const c of w.server.open()) c.respond()
    await w.server.flush(40)
    expect(n).toBe(0)
    await tick(w.LAKE_JOIN_WAIT_MS + 10)
    w.store.dispose()
  })
})
