// A typed ticker's held or saved copy is judged on the CLOCK, not on the status it was saved with (owner 2026-11-20:
// typing SPY / QQQ / IWM on a 1m chart "loads a candle or two behind"). A copy whose newest closed row is a bucket or
// more behind the session frontier is asked again while the member types, so Enter paints the current tail.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, intradayRows, OPEN } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const NOW = (OPEN + 32 * 60 + 20) * 1000          // Tue 10:02:20 ET, mid-session
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
  const server = installFakeBarsServer({})
  const { createBarStore } = await import('./index')
  const { createPrefetch } = await import('./prefetch')
  const idb = await import('../../utils/barsIDB')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const pf = createPrefetch({ store, tickerMeta: () => {} })
  const known = (sym) => idb.idbPutMonotonic(sym, 'D', [{ t: '2026-11-09', o: 1, h: 1, l: 1, c: 1, v: 1 }])
  return { server, store, pf, idb, known }
}
const ofTf = (calls, tf) => calls.filter((c) => c.q.tf === tf).map((c) => c.q.sym)

describe('typed intraday warm · a copy behind the clock is asked again', () => {
  it('a held 1m answer two minutes old is asked again (its saved status still says current)', async () => {
    const w = await boot()
    await w.known('SPYX')
    w.pf.warmTypedSymbol('SPYX', '1'); await w.server.drain()
    expect(ofTf(w.server.calls, '1')).toEqual(['SPYX'])
    // the same minute: held and current, nothing asked
    expect(w.pf.warmTypedSymbol('SPYX', '1')).toBe(null)
    // two minutes later (the key off screen, never polled): the member types it again
    vi.setSystemTime(NOW + 2 * 60_000)
    const again = w.pf.warmTypedSymbol('SPYX', '1')
    expect(again).not.toBe(null)
    await w.server.drain()
    await expect(again).resolves.toBe('network')
    expect(ofTf(w.server.calls, '1')).toEqual(['SPYX', 'SPYX'])
  })

  it('a saved 1m copy whose newest closed row is behind is not painted as it is: it is asked', async () => {
    const w = await boot()
    await w.known('QQQX')
    // saved through 10:00 at 10:02:20: one bucket behind the 10:01 frontier (inside the old one-bucket tolerance)
    await w.idb.idbPutMonotonic('QQQX', '1', intradayRows(1, Math.floor(NOW / 1000) - 140))
    const typed = w.pf.warmTypedSymbol('QQQX', '1')
    await w.server.drain()
    await expect(typed).resolves.toBe('network')
    expect(ofTf(w.server.calls, '1')).toEqual(['QQQX'])
  })

  it('a saved copy at the frontier still paints from cache with no request', async () => {
    const w = await boot()
    await w.known('IWMX')
    await w.idb.idbPutMonotonic('IWMX', '5', intradayRows(5, Math.floor(NOW / 1000) - 60))
    const typed = w.pf.warmTypedSymbol('IWMX', '5')
    await w.server.drain()
    await expect(typed).resolves.toBe('cache')
    expect(ofTf(w.server.calls, '5')).toEqual([])
  })
})
