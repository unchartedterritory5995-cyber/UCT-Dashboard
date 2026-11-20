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

async function boot({ modeFor } = {}) {
  vi.resetModules()
  const server = installFakeBarsServer({ modeFor })
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

describe('the handoff (Enter) · a copy behind the clock waits for its tail', () => {
  async function heldThenLater(w, sym, ms = 2 * 60_000) {
    await w.known(sym)
    w.pf.warmTypedSymbol(sym, '1'); await w.server.drain()
    vi.setSystemTime(Date.now() + ms)
  }

  it('a held 1m answer two minutes old does not commit at once: Enter asks the tail and paints the answer', async () => {
    const w = await boot()
    await heldThenLater(w, 'SPYH')
    expect(w.pf.peekDisplayable('SPYH', '1')).toBe(false)          // not painted as it is
    const enter = w.pf.prepareForDisplay('SPYH', '1')
    await w.server.flush(80)
    expect(ofTf(w.server.open(), '1')).toEqual(['SPYH'])            // the tail is asked
    await w.server.drain()
    await expect(enter).resolves.toBe('current')
    expect(w.pf.peekDisplayable('SPYH', '1')).toBe(true)           // the answer is current
  })

  it('a server that does not answer never pins the member: the copy paints after BEHIND_HOLD_MAX_MS', async () => {
    const w = await boot()
    const { BEHIND_HOLD_MAX_MS } = await import('./prefetch')
    await heldThenLater(w, 'QQQH')
    let done = null
    w.pf.prepareForDisplay('QQQH', '1').then((o) => { done = o })
    await vi.advanceTimersByTimeAsync(BEHIND_HOLD_MAX_MS - 20)
    expect(done).toBe(null)
    await vi.advanceTimersByTimeAsync(40)
    expect(done).toBe('current')
  })

  it('a name that did not print (its answer is still behind) paints as it is and is not asked on every keystroke', async () => {
    const w = await boot({ modeFor: (q) => (q.sym === 'THIN' ? 'behind' : 'ok') })
    const { BEHIND_RECHECK_MS } = await import('./prefetch')
    await w.known('THIN')
    w.pf.warmTypedSymbol('THIN', '1'); await w.server.drain()
    const n = w.server.calls.length
    expect(w.pf.peekDisplayable('THIN', '1')).toBe(true)           // just answered: the name did not print
    expect(w.pf.warmTypedSymbol('THIN', '1')).toBe(null)
    await w.server.drain()
    expect(w.server.calls.length).toBe(n)
    vi.setSystemTime(Date.now() + BEHIND_RECHECK_MS + 1000)
    expect(w.pf.peekDisplayable('THIN', '1')).toBe(false)          // later it is asked again
  })
})
