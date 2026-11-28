// ⛔ (review of #3024) TWO LISTS, ONE STORE: a list's urgent next rows are its own. Six embedded <Watchlists> share the
// store's one urgent map; list A changing its timeframe (a key family it no longer reads) or moving on (rows it passed)
// aborted list B's in-flight urgent rows on the same keys. Driven here through the very functions Watchlists' warm calls
// (listUrgentWarm), over a real store and its facade (createPrefetch), the requests' own abort signals read:
//   U1 list A drops the 5m family: A's rows abort, list B's rows on the same 5m keys keep going
//   U2 the key both lists asked is aborted only when the LAST of them gives it up
//   U3 a list moving on (its next urgent call) gives up only its own passed rows
//   U4 CONTROL: one list alone drops its family: every row it sent aborts (the #3024 behaviour)
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from '../data/barStore/testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from '../data/barStore/testing/fakeFeeds'
import { installFakeBarsServer, OPEN } from '../data/barStore/testing/fakeBarsServer'
import { createListUrgentWarm, dropUrgentFamilies, sendUrgentNext } from './listUrgentWarm'

vi.mock('../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime((OPEN + 1800) * 1000); localStorage.setItem('barspack.version', 'test') })
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version') })

async function boot() {
  vi.resetModules()
  const server = installFakeBarsServer()
  const { createBarStore } = await import('../data/barStore/index')
  const { createPrefetch } = await import('../data/barStore/prefetch')
  const store = createBarStore({ stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), history: null })
  const pf = createPrefetch({ store, tickerMeta: () => {}, extended: () => false })
  return { server, store, pf, warm: { prefetchBars: pf.prefetchBars, abortUrgentFamily: pf.abortUrgentFamily } }
}
const v5 = [{ id: 'p5', tf: '5', viewWindow: null }]
const v15 = [{ id: 'p15', tf: '15', viewWindow: null }]
/** every request sent on `sym` at `tf` (the fake server marks one whose signal aborted: `aborted`) */
const callsOf = (w, sym, tf) => w.server.calls.filter((c) => c.q.sym === sym && c.q.tf === tf)
const anyAborted = (w, sym, tf) => callsOf(w, sym, tf).some((c) => c.aborted)

describe('two lists over one store: each list gives up its own urgent rows only', () => {
  it('U1 list A drops the 5m family (its tf changed): list B keeps its 5m rows in flight', async () => {
    const w = await boot()
    const A = createListUrgentWarm(); const B = createListUrgentWarm()
    dropUrgentFamilies(A, v5, w.warm); sendUrgentNext(A, v5, ['AAA', 'BBB'], w.warm)
    dropUrgentFamilies(B, v5, w.warm); sendUrgentNext(B, v5, ['CCC', 'DDD'], w.warm)
    await vi.advanceTimersByTimeAsync(10)
    expect(w.pf._stats().urgent, 'non-vacuity: four urgent rows').toBe(4)
    dropUrgentFamilies(A, v15, w.warm)                             // list A: 5m -> 15m
    sendUrgentNext(A, v15, ['AAA', 'BBB'], w.warm)
    await vi.advanceTimersByTimeAsync(10)
    expect(w.pf._stats().urgent, "A's two 5m rows gone, B's two kept, A's two 15m sent").toBe(4)
    for (const sym of ['CCC', 'DDD']) expect(anyAborted(w, sym, '5'), `${sym}: list B's row aborted by list A`).toBe(false)
  })

  it('U2 a key both lists asked stays until the LAST of them gives it up', async () => {
    const w = await boot()
    const A = createListUrgentWarm(); const B = createListUrgentWarm()
    sendUrgentNext(A, v5, ['AAA'], w.warm); dropUrgentFamilies(A, v5, w.warm)
    sendUrgentNext(B, v5, ['AAA'], w.warm); dropUrgentFamilies(B, v5, w.warm)
    await vi.advanceTimersByTimeAsync(10)
    expect(w.pf._stats().urgent).toBe(1)
    dropUrgentFamilies(A, v15, w.warm)
    expect(w.pf._stats().urgent, 'B still wants AAA 5m').toBe(1)
    dropUrgentFamilies(B, v15, w.warm)
    expect(w.pf._stats().urgent, 'nobody wants it now').toBe(0)
  })

  it("U3 a list moving on gives up its own passed rows, never the other list's", async () => {
    const w = await boot()
    const A = createListUrgentWarm(); const B = createListUrgentWarm()
    sendUrgentNext(A, v5, ['AAA', 'BBB'], w.warm)
    sendUrgentNext(B, v5, ['CCC'], w.warm)
    await vi.advanceTimersByTimeAsync(10)
    sendUrgentNext(A, v5, ['EEE', 'FFF'], w.warm)                  // list A's next press
    await vi.advanceTimersByTimeAsync(10)
    expect(anyAborted(w, 'CCC', '5'), "list B's row aborted by list A's press").toBe(false)
    expect(w.pf._stats().urgent, "A's passed rows gone, B's kept").toBe(3)
  })

  it('U4 CONTROL: one list alone dropping its family aborts every row it sent', async () => {
    const w = await boot()
    const A = createListUrgentWarm()
    dropUrgentFamilies(A, v5, w.warm); sendUrgentNext(A, v5, ['AAA', 'BBB'], w.warm)
    await vi.advanceTimersByTimeAsync(10)
    expect(w.pf._stats().urgent).toBe(2)
    dropUrgentFamilies(A, v15, w.warm)
    expect(w.pf._stats().urgent).toBe(0)
  })
})
