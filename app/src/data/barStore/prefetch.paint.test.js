// P2c review #2c: prepareForDisplay never calls a LOCAL copy 'current' on the store's
// verdict alone. Without a server answer it is 'current' only when the legacy paint rule
// (`isCacheCurrentForView` with the view's session — legacy `_paintCurrent`) accepts it;
// otherwise the server is asked. The rule is mocked here to disagree with the store.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, intradayRows, OPEN } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))
const paint = { verdict: true, calls: [] }
vi.mock('../../utils/marketSession', async (orig) => {
  const real = await orig()
  return {
    ...real,
    isCacheCurrentForView: (...a) => { paint.calls.push(a); return paint.verdict },
  }
})

const NOW = (OPEN + 32 * 60 + 20) * 1000
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime(NOW); paint.calls.length = 0 })
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

describe('#2c a local CONTEXT copy is current only by the legacy paint rule', () => {
  it('rule says no → the server is asked (the store alone would have said context)', async () => {
    const w = await boot()
    const now = Math.floor(NOW / 1000)
    await w.idb.idbPutMonotonic('LCX', '5', intradayRows(5, now - 300))
    paint.verdict = false
    const p = w.pf.prepareForDisplay('LCX', '5')
    await w.server.drain()
    await expect(p).resolves.toBe('current')
    expect(w.server.calls.length).toBe(1)
    expect(paint.calls.length).toBeGreaterThan(0)
    expect(paint.calls[0][3]).toMatchObject({ session: 'rth' })
  })

  it('rule says yes → current with no request (legacy behaviour)', async () => {
    const w = await boot()
    const now = Math.floor(NOW / 1000)
    await w.idb.idbPutMonotonic('LCY', '5', intradayRows(5, now - 300))
    paint.verdict = true
    await expect(w.pf.prepareForDisplay('LCY', '5')).resolves.toBe('current')
    expect(w.server.calls.length).toBe(0)
  })
})
