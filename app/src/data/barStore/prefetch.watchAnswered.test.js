// THE WAITER IS WOKEN WHEN WHAT IT READS IS TRUE, NOT ONLY WHEN THE ENTRY CHANGES (review of #2407, finding 3).
// The D/W/M hold commits when "the tail ANSWER's rows cover the view" (useSymbolHandoff `covers(..., { answered })`
// -> prefetch.heldRows -> network.answered(key)). The network notes `answered` AFTER the dispatch that lands the
// answer, and the registry wakes the waiter INSIDE that dispatch: the waiter read "not answered", and nothing woke
// it again until the deep history joined (or DEEP_JOIN_WAIT_MS ran out). The 25 ms poll it replaced caught it on
// its next tick. Same defect class as the device copy's stamps (store.deviceFirstPaint W1), on a second value.
// Real store, real network, real facade, a held fake server: the mocked facade of useSymbolHandoff.coldGates
// cannot model "the value the waiter reads is written after the wake".
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const NOW = (OPEN + 32 * 60 + 20) * 1000          // Tue 2026-11-10 10:02:20 ET
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  fakeDb._clear()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  localStorage.setItem('barspack.version', 'test')
  localStorage.removeItem('uct.barsHistory.enabled')
  localStorage.setItem('uct.barsHistory.bucket', '5')   // inside the D/W/M split's rollout: the deep history is a second request
})
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version'); localStorage.removeItem('uct.barsHistory.bucket') })

async function boot(serverOpts = {}) {
  vi.resetModules()
  const server = installFakeBarsServer(serverOpts)
  const { createBarStore } = await import('./index')
  const { createPrefetch } = await import('./prefetch')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  return { server, store, pf: createPrefetch({ store, tickerMeta: () => {} }) }
}
const tick = (ms) => vi.advanceTimersByTimeAsync(ms)

describe('prefetch.watch wakes the waiter on the answer being noted', () => {
  it('the tail answer has landed and the deep history is still out: a wake reads the rows as ANSWERED', async () => {
    const w = await boot()
    const seen = []
    const off = w.pf.watch('DPS', 'D', {}, () => { seen.push(w.pf.heldRows('DPS', 'D', { answered: true })) })
    const p = w.pf.prepareDailyForDisplay('DPS', 'D')
    await tick(130)                                         // past the cache-read race
    await w.server.flush(40)
    expect(w.server.open().some((c) => !c.q.history)).toBe(true)
    for (const c of w.server.open()) if (!c.q.history) c.respond()   // the TAIL answers; the history does not
    await w.server.flush(40)
    expect(w.server.open().some((c) => c.q.history)).toBe(true)      // the deep history is still on the wire
    expect(w.pf.heldRows('DPS', 'D', { answered: true })).toBe(3)    // what a poll would read now
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[seen.length - 1]).toBe(3)                   // ...and what the waiter's last wake read
    off()
    await w.server.drain()
    await p
    w.store.dispose()
  })

  it('the unsubscribe stops both wakes', async () => {
    const w = await boot()
    let n = 0
    const off = w.pf.watch('DPS', 'D', {}, () => { n++ })
    off()
    const p = w.pf.prepareDailyForDisplay('DPS', 'D')
    await tick(130)
    await w.server.drain()
    await p
    expect(n).toBe(0)
    w.store.dispose()
  })

  // ⭐⭐ (2026-11-28, the cold-coverage run: W + M, the previous chart held ~4 s on 4 of 6 typed presses) A DEEP JOIN THAT
  // ADDS NOTHING MOVES NO ENTRY. The hold of a set shorter than the view waits for "nothing more is coming" (deepPending
  // false); woken only by the entry and the answer, it never saw the settle and waited out the hang guard.
  it('the deep history settles adding nothing older: the waiter is woken, and its wake reads the depth as no longer due', async () => {
    const w = await boot({ modeFor: (q) => (q.history ? 'history-none' : 'ok') })
    const seen = []
    const off = w.pf.watch('NOO', 'D', {}, () => { seen.push(w.pf.deepPending('NOO', 'D')) })
    const p = w.pf.prepareDailyForDisplay('NOO', 'D')
    await tick(130)
    await w.server.flush(40)
    for (const c of w.server.open()) if (!c.q.history) c.respond()   // the tail answers; the history is still out
    await w.server.flush(40)
    expect(w.pf.deepPending('NOO', 'D')).toBe(true)
    const before = seen.length
    const rowsBefore = w.store.peek(w.pf.keyFor('NOO', 'D')).bars.length
    await w.server.drain()                                            // the history lands: nothing older than the tail
    expect(w.store.peek(w.pf.keyFor('NOO', 'D')).bars.length).toBe(rowsBefore)   // the entry did not move
    expect(w.pf.deepPending('NOO', 'D')).toBe(false)
    expect(seen.length).toBeGreaterThan(before)                       // ...and the waiter heard the settle
    expect(seen[seen.length - 1]).toBe(false)
    off()
    await p
    w.store.dispose()
  })
})
