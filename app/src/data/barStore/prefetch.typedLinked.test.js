// ⭐⭐ (2026-11-27, owner: "close to 30MS for everything always") THE TYPED WARM FETCHES THE LINKED CHARTS' KEYS TOO.
// Enter shows the typed ticker on every chart of the linked group; a cold page takes 100-350 ms on production, so a linked
// key not asked before Enter cannot paint in the key's task. The warm used to TELL the column warmers about the linked
// timeframes (prefetch.typedCompanions.test.js) and join a linked key's lake only when it was already held: a linked key
// never opened was asked only after Enter. Now each linked key is asked as soon as the text is known to be a ticker.
// Through the real store and facade, against the fake server (its calls are the requests the page would make).
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
  localStorage.setItem('barspack.version', 'test')
  localStorage.setItem('uct.barsHistory.enabled', '0')   // no deep join (its own rails cover it)
})
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version'); localStorage.removeItem('uct.barsHistory.enabled') })

async function boot() {
  vi.resetModules()
  const srv = installFakeBarsServer({})
  const { createBarStore } = await import('./index')
  const { createPrefetch, LINKED_TYPED_MAX } = await import('./prefetch')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const pf = createPrefetch({ store, tickerMeta: () => {} })
  const mem = await import('../../utils/barsMemCache')
  return { pf, mem, srv, LINKED_TYPED_MAX }
}
const tick = (ms) => vi.advanceTimersByTimeAsync(ms)
const asked = (w, sym) => w.srv.calls.filter((c) => !c.q.history && c.q.sym === sym).map((c) => c.q.tf)
// a current daily set in memory (the session is Tue 2026-11-10): the text is a ticker
const HELD = [
  { t: '2026-11-06', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
  { t: '2026-11-09', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
  { t: '2026-11-10', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
]

describe('the typed warm fetches each linked chart key before Enter', () => {
  it('typed on a DAILY chart linked to 30m and 5m charts: both intraday keys are asked now, before any Enter', async () => {
    const w = await boot()
    w.mem.memPut('AA', 'D', HELD)
    w.pf.warmTypedSymbol('aa', 'D', { alsoTfs: ['D', '30', '5'] })
    await tick(50)
    const tfs = asked(w, 'AA')
    expect(tfs).toContain('30')
    expect(tfs).toContain('5')
  })

  it('⛔ a typed PREFIX asks no linked key', async () => {
    const w = await boot()
    w.pf.warmTypedSymbol('ZZQ', 'D', { alsoTfs: ['30', '5'] })
    await tick(50)
    expect(asked(w, 'ZZQ').filter((t) => t !== 'D')).toEqual([])
  })

  it('at most LINKED_TYPED_MAX linked keys, each once', async () => {
    const w = await boot()
    w.mem.memPut('AA', 'D', HELD)
    w.pf.warmTypedSymbol('aa', 'D', { alsoTfs: ['1', '5', '15', '30', '60', '5'] })
    await tick(50)
    const linked = asked(w, 'AA').filter((t) => t !== 'D')
    expect(new Set(linked).size).toBe(linked.length)
    expect(linked.length).toBe(w.LINKED_TYPED_MAX)
  })

  it('CONTROL: no linked timeframes: no intraday key is asked', async () => {
    const w = await boot()
    w.mem.memPut('AA', 'D', HELD)
    w.pf.warmTypedSymbol('aa', 'D')
    await tick(50)
    expect(asked(w, 'AA').filter((t) => t !== 'D')).toEqual([])
  })

  // ⛔ (review of #2934, B2) the linked fetches of a typed text the store already holds (no warm request of its own) are
  // cancelled by the next text's, like a warm's own request is: the 0 ms highlight warm can fire on every highlight
  it("a held name's linked fetch is aborted when the next text asks its own", async () => {
    const w = await boot()
    w.mem.memPut('AA', 'D', HELD)
    w.pf.warmTypedSymbol('aa', 'D')
    await tick(20)
    await w.srv.drain(); await tick(20)                  // AA's daily answer lands: a known name, its bars current
    w.pf.warmTypedSymbol('aa', 'D', { alsoTfs: ['5'] })
    await tick(20)
    const five = w.srv.calls.find((c) => !c.q.history && c.q.sym === 'AA' && c.q.tf === '5')
    expect(five, 'the linked 5m key was asked').toBeTruthy()
    expect(five.done).toBe(false)
    w.pf.warmTypedSymbol('aa', 'D', { alsoTfs: ['15'] })
    await tick(20)
    expect(five.aborted, "the earlier text's linked fetch kept running").toBe(true)
  })
})

