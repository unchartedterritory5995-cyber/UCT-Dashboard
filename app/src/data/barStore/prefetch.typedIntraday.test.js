// Typed intraday (2026-11-17): the text a member types into the chart's search warms the chart's
// INTRADAY key once it settles, so Enter paints from memory like a list flip. Was D/W/M only: on 5m /
// 60m / 1m the chart waited on its own request after Enter (~70-110 ms cold, production).
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
  localStorage.setItem('barspack.version', 'test')   // the daily pack is held: uncached text is a prefix
})
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version') })

async function boot({ modeFor } = {}) {
  vi.resetModules()
  const server = installFakeBarsServer({ modeFor })
  const { createBarStore } = await import('./index')
  const { createPrefetch } = await import('./prefetch')
  const { keyOf, STATUS } = await import('./types')
  const idb = await import('../../utils/barsIDB')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const pf = createPrefetch({ store, tickerMeta: () => {} })
  const k = (sym, tf) => keyOf({ sym, tf })
  // A symbol the daily pack holds (so typed text naming it IS a ticker).
  const known = (sym) => idb.idbPutMonotonic(sym, 'D', [{ t: '2026-11-09', o: 1, h: 1, l: 1, c: 1, v: 1 }])
  return { server, store, pf, k, idb, known, STATUS }
}
const ofTf = (calls, tf) => calls.filter((c) => c.q.tf === tf).map((c) => c.q.sym)

describe('typed intraday warm', () => {
  it('a typed ticker is fetched at the chart\'s intraday tf before Enter; the handoff joins it (one request)', async () => {
    const w = await boot()
    await w.known('TYI')
    const typed = w.pf.warmTypedSymbol('tyi', '5')
    await w.server.flush(80)
    expect(ofTf(w.server.open(), '5')).toEqual(['TYI'])
    const enter = w.pf.prepareForDisplay('TYI', '5')      // Enter
    await w.server.drain()
    await expect(enter).resolves.toBe('current')
    await expect(typed).resolves.toBe('network')
    expect(ofTf(w.server.calls, '5')).toEqual(['TYI'])
  })

  it('a PREFIX (no daily set while the pack is held) costs nothing', async () => {
    const w = await boot()
    const typed = w.pf.warmTypedSymbol('TY', '5')
    await w.server.drain()
    await expect(typed).resolves.toBe('unknown')
    expect(w.server.calls.length).toBe(0)
  })

  it('while the pack is still ingesting, unknown text is asked (the pack cannot vouch yet)', async () => {
    localStorage.removeItem('barspack.version')
    const w = await boot()
    const typed = w.pf.warmTypedSymbol('NEWX', '60')
    await w.server.drain()
    // (at 10:02 the 60m answer is the forming 09:30 bucket alone: still the server's answer)
    await expect(typed).resolves.toBe('network')
    expect(ofTf(w.server.calls, '60')).toEqual(['NEWX'])
  })

  it('a key already held and painting is not asked again', async () => {
    const w = await boot()
    await w.known('HLD')
    w.pf.warmTypedSymbol('HLD', '5'); await w.server.drain()
    const before = w.server.calls.length
    expect(w.pf.warmTypedSymbol('HLD', '5')).toBe(null)
    await w.server.drain()
    expect(w.server.calls.length).toBe(before)
  })

  it('a local copy that paints answers "cache" with no request', async () => {
    const w = await boot()
    await w.known('LOC')
    await w.idb.idbPutMonotonic('LOC', '5', intradayRows(5, Math.floor(NOW / 1000) - 300))
    const typed = w.pf.warmTypedSymbol('LOC', '5')
    await w.server.drain()
    await expect(typed).resolves.toBe('cache')
    expect(ofTf(w.server.calls, '5')).toEqual([])
  })

  it('new text aborts the previous typed warm that nothing joined', async () => {
    const w = await boot()
    await w.known('AAA'); await w.known('BBB')
    const first = w.pf.warmTypedSymbol('AAA', '5')
    await w.server.flush(80)
    expect(ofTf(w.server.open(), '5')).toEqual(['AAA'])
    w.pf.warmTypedSymbol('BBB', '5')
    await w.server.flush(80)
    expect(w.server.calls.find((c) => c.q.sym === 'AAA').aborted).toBe(true)
    await w.server.drain()
    await expect(first).resolves.toBe(false)
  })

  it('a typed intraday warm joined by the handoff is never aborted by the next keystroke', async () => {
    const w = await boot()
    await w.known('KEEP'); await w.known('KEEPX')
    const typed = w.pf.warmTypedSymbol('KEEP', '5')
    await w.server.flush(80)
    const enter = w.pf.prepareForDisplay('KEEP', '5')     // Enter: the handoff joins it
    await w.server.flush(20)
    w.pf.warmTypedSymbol('KEEPX', '5')                     // a stray keystroke afterwards
    await w.server.flush(40)
    expect(w.server.calls.find((c) => c.q.sym === 'KEEP').aborted).toBeFalsy()
    await w.server.drain()
    await expect(enter).resolves.toBe('current')
    await expect(typed).resolves.toBe('network')
  })

  it('a cache that is slow to read never holds the request up (pack ingesting: no daily read at all)', async () => {
    localStorage.removeItem('barspack.version')                    // the pack still ingests: IDB busy
    const w = await boot()
    const { INTENT_HYDRATE_RACE_MS } = await import('./prefetch')
    w.store.persist.hydrate = () => new Promise(() => {})          // every cache read stalls
    const typed = w.pf.warmTypedSymbol('SLOW', '5')
    await vi.advanceTimersByTimeAsync(INTENT_HYDRATE_RACE_MS - 10)
    expect(ofTf(w.server.calls, '5')).toEqual([])                  // (it does wait for the race, no longer)
    await vi.advanceTimersByTimeAsync(20)
    expect(ofTf(w.server.calls, '5')).toEqual(['SLOW'])           // asked anyway
    await w.server.drain()
    await expect(typed).resolves.toBe('network')
  })

  it('with the pack held, a daily read that does not answer in time does not block a real ticker', async () => {
    const w = await boot()
    const { INTENT_HYDRATE_RACE_MS } = await import('./prefetch')
    w.store.persist.hydrate = () => new Promise(() => {})
    const typed = w.pf.warmTypedSymbol('SLOWD', '5')
    await vi.advanceTimersByTimeAsync(2 * INTENT_HYDRATE_RACE_MS + 20)   // the daily read's race, then the key's
    expect(ofTf(w.server.calls, '5')).toEqual(['SLOWD'])
    await w.server.drain()
    await expect(typed).resolves.toBe('network')
  })

  it('a replay (windowed) or a non-ticker text is never warmed', async () => {
    const w = await boot()
    expect(w.pf.warmTypedSymbol('$$$', '5')).toBe(null)
    expect(w.pf.warmTypedSymbol('', '5')).toBe(null)
    await w.server.drain()
    expect(w.server.calls.length).toBe(0)
  })
})
