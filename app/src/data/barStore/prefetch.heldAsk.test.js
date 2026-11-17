// A request still waiting in the lane is not an answer (2026-11-17).
// Debug build, flip proof 60m, first visit (daily pack still ingesting): the rows ahead held a
// short copy hours behind (`provisional`). The list's background warm had asked for them — noted
// as "asked" when the request was QUEUED — and the lane held that request (`_holdBackgroundWarm`).
// Every later warm of the key, the URGENT next-row warm included, read the queued ask as a
// recent answer and skipped; the flip fetched the row itself (129 ms).
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, intradayRows, OPEN } from './testing/fakeBarsServer'
import { memClear } from '../../utils/barsMemCache'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const NOW = (OPEN + 32 * 60 + 20) * 1000
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  fakeDb._clear(); memClear(); vi.useFakeTimers(); vi.setSystemTime(NOW)
  localStorage.removeItem('barspack.version')   // a first visit: background warms are held
})
afterEach(() => { vi.useRealTimers() })

async function boot() {
  const server = installFakeBarsServer()
  const { createBarStore } = await import('./index')
  const { createPrefetch } = await import('./prefetch')
  const idb = await import('../../utils/barsIDB')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  return { server, store, idb, pf: createPrefetch({ store, tickerMeta: () => {} }) }
}

describe('a held background warm never blocks the urgent warm of the same row', () => {
  it('the urgent next-row warm reaches the server while the background ask is still queued', async () => {
    const w = await boot()
    const now = Math.floor(NOW / 1000)
    // a deep local copy whose tail is two hours behind: held, but not current (provisional)
    await w.idb.idbPutMonotonic('HLD', '5', intradayRows(5, now - 2 * 3600, { from: OPEN - 20 * 86400 }))
    w.pf.prefetchBarsToIDB(['HLD'], '5', { priority: true })          // background: held in the lane
    await vi.advanceTimersByTimeAsync(50)
    expect(w.server.calls.length).toBe(0)                               // CONTROL: the hold is real
    w.pf.prefetchBars(['HLD'], '5', { urgent: true })                  // the row the member reaches next
    await vi.advanceTimersByTimeAsync(50)
    expect(w.server.calls.length).toBe(1)
  })

  it('an ANSWERED ask still cools: a second warm right after the answer costs nothing', async () => {
    localStorage.setItem('barspack.version', 'test')
    try {
      const w = await boot()
      const now = Math.floor(NOW / 1000)
      await w.idb.idbPutMonotonic('ANS', '5', intradayRows(5, now - 2 * 3600, { from: OPEN - 20 * 86400 }))
      w.pf.prefetchBars(['ANS'], '5', { urgent: true })
      await vi.advanceTimersByTimeAsync(50)
      await w.server.drain()
      const after = w.server.calls.length
      expect(after).toBe(1)
      w.pf.prefetchBars(['ANS'], '5', { urgent: true })
      await vi.advanceTimersByTimeAsync(50)
      expect(w.server.calls.length).toBe(after)                          // answered → cooling / held
    } finally {
      localStorage.removeItem('barspack.version')
    }
  })
})
