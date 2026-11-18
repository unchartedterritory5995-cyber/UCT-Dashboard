// The lake in the /charts handoff race (2026-11-17). The handoff keeps the old chart until
// prepareForDisplay reports; the lake paint used to start only when the new chart subscribed (after
// the commit), so a slow first answer (FROG: a 1,523 ms cold bar-server read) was waited out with the
// lake's copy of the same history in the browser. And a typed real ticker the daily pack lacks sent
// nothing before Enter (4 of 10 never-opened tickers).
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const NOW = (OPEN + 32 * 60 + 20) * 1000          // Tue 10:02:20 ET, mid-session
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  fakeDb._clear()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  localStorage.setItem('barspack.version', 'test')   // the daily pack is held
})
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version') })

const rows = (end, n) => Array.from({ length: n }, (_, i) => ({ t: end - 300 * (n - 1 - i), o: 100, h: 101, l: 99, c: 100.5, v: 10 }))
function lakeOf(lakeRows, { known = ['COLD', 'REAL'] } = {}) {
  return {
    olderBars: vi.fn(async (key, beforeT) => ({ bars: lakeRows.filter((b) => b.t < beforeT) })),
    prime: vi.fn(),
    hasSymbol: vi.fn(async (s) => known.includes(String(s).toUpperCase())),
  }
}

async function boot({ lake } = {}) {
  vi.resetModules()
  const server = installFakeBarsServer()
  const { createBarStore } = await import('./index')
  const { createPrefetch } = await import('./prefetch')
  const { keyOf } = await import('./types')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), history: lake ?? null,
  })
  const pf = createPrefetch({ store, tickerMeta: () => {} })
  return { server, store, pf, k: (sym, tf) => keyOf({ sym, tf }) }
}
const settled = (p) => { let v = 'PENDING'; p.then((x) => { v = x }, () => { v = 'REJECTED' }); return () => v }
const ofTf = (calls, tf) => calls.filter((c) => c.q.tf === tf).map((c) => c.q.sym)

describe('the lake in the handoff race', () => {
  it('Enter on a cold symbol whose first answer is slow commits on the lake copy; the answer completes it', async () => {
    const w = await boot({ lake: lakeOf(rows(OPEN - 300, 50)) })            // the lake ends yesterday
    const enter = w.pf.prepareForDisplay('COLD', '5')
    const state = settled(enter)
    await vi.advanceTimersByTimeAsync(400)                                   // the server has NOT answered
    expect(w.server.open().length).toBeGreaterThan(0)
    expect(state()).toBe('lake')
    const s = w.store.peek(w.k('COLD', '5'))
    expect(s.restSeen).toBe(false)
    expect(s.bars.length).toBe(50)
    await w.server.drain()
    expect(w.store.peek(w.k('COLD', '5')).restSeen).toBe(true)
  })

  it('a slow cache read (past HYDRATE_WAIT_MS) and a slow answer: the lake still commits first, after the read', async () => {
    const w = await boot({ lake: lakeOf(rows(OPEN - 300, 40)) })
    const realHydrate = w.store.persist.hydrate
    w.store.persist.hydrate = (key) => new Promise((resolve) => setTimeout(resolve, 600)).then(() => realHydrate(key))
    const state = settled(w.pf.prepareForDisplay('COLD', '5'))
    await vi.advanceTimersByTimeAsync(300)
    expect(state()).toBe('PENDING')                                          // the saved-copy read goes first
    await vi.advanceTimersByTimeAsync(500)
    expect(state()).toBe('lake')
    expect(w.store.peek(w.k('COLD', '5')).bars.length).toBe(40)
    await w.server.drain()
  })

  it('with nothing in the lake the handoff waits for the server, as before', async () => {
    const w = await boot({ lake: lakeOf([]) })
    const enter = w.pf.prepareForDisplay('COLD', '5')
    const state = settled(enter)
    await vi.advanceTimersByTimeAsync(400)
    expect(state()).toBe('PENDING')
    await w.server.drain()
    await vi.advanceTimersByTimeAsync(10)
    expect(state()).toBe('current')
  })

  it('a daily chart never takes the lake path', async () => {
    const lake = lakeOf(rows(OPEN - 300, 50))
    const w = await boot({ lake })
    const enter = w.pf.prepareForDisplay('COLD', 'D')
    const state = settled(enter)
    await vi.advanceTimersByTimeAsync(400)
    expect(state()).not.toBe('lake')
    expect(lake.olderBars).not.toHaveBeenCalled()
    await w.server.drain()
  })
})

describe('typed warm: the lake vouches for a real ticker the daily pack lacks', () => {
  it('a real ticker the pack lacks is warmed before Enter when the lake knows it, its lake primed first', async () => {
    const lake = lakeOf(rows(OPEN - 300, 50))
    const w = await boot({ lake })
    const typed = w.pf.warmTypedSymbol('REAL', '5')
    await vi.advanceTimersByTimeAsync(100)
    expect(lake.prime).toHaveBeenCalledWith(w.k('REAL', '5'))
    expect(ofTf(w.server.open(), '5')).toEqual(['REAL'])
    await w.server.drain()
    await expect(typed).resolves.toBe('network')
  })

  it('a prefix the lake does not know costs no bar request', async () => {
    const lake = lakeOf(rows(OPEN - 300, 50))
    const w = await boot({ lake })
    const typed = w.pf.warmTypedSymbol('RE', '5')
    await vi.advanceTimersByTimeAsync(600)
    await expect(typed).resolves.toBe('unknown')
    expect(w.server.calls.length).toBe(0)
  })
})
