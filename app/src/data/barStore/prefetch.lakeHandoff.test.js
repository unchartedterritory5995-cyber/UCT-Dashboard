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

// The server's own rows (fakeBarsServer intradayRows: o 10, h 11, l 9, c 10.5, v 100), so a lake copy
// that shares bars with an answer proves its basis and joins it.
const likeServer = (from, to) => { const out = []; for (let t = from; t <= to; t += 300) out.push({ t, o: 10, h: 11, l: 9, c: 10.5, v: 100 }); return out }
function slowLake(lakeRows, ms) {
  return { ...lakeOf(lakeRows), olderBars: vi.fn((key, beforeT) => new Promise((r) => setTimeout(() => r({ bars: lakeRows.filter((b) => b.t < beforeT) }), ms))) }
}

describe('ONE paint, the whole chart (owner 2026-11-17: "a good chunk, then the rest a quick blink later")', () => {
  it('a normal answer lands first: the handoff commits ONCE, after the lake\'s depth has joined it', async () => {
    const { LAKE_JOIN_WAIT_MS } = await import('./prefetch')
    const w = await boot({ lake: slowLake(likeServer(OPEN - 300 * 60, OPEN + 600), 150) })
    const state = settled(w.pf.prepareForDisplay('COLD', '5'))
    await vi.advanceTimersByTimeAsync(40)
    await w.server.drain()                                                  // the answer at ~40 ms
    await vi.advanceTimersByTimeAsync(20)
    expect(w.store.peek(w.k('COLD', '5')).restSeen).toBe(true)
    expect(state()).toBe('PENDING')                                         // NOT committed on ~7 bars
    await vi.advanceTimersByTimeAsync(150)
    expect(state()).toBe('current')
    const s = w.store.peek(w.k('COLD', '5'))
    expect(s.bars[0].t).toBe(OPEN - 300 * 60)                               // the first paint holds the depth
    // the cap on how long a ready chart may wait for its depth: 600 ms (2026-11-18: cold lake loads on
    // production landed 441-458 ms after the key; the wait is 550)
    expect(LAKE_JOIN_WAIT_MS).toBeLessThanOrEqual(600)
  })

  it('a lake slower than LAKE_JOIN_WAIT_MS never holds the chart longer than that', async () => {
    const { LAKE_JOIN_WAIT_MS } = await import('./prefetch')
    const w = await boot({ lake: slowLake(likeServer(OPEN - 300 * 60, OPEN + 600), 5000) })
    const state = settled(w.pf.prepareForDisplay('COLD', '5'))
    await vi.advanceTimersByTimeAsync(40)
    await w.server.drain()
    await vi.advanceTimersByTimeAsync(LAKE_JOIN_WAIT_MS - 50)
    expect(state()).toBe('PENDING')
    await vi.advanceTimersByTimeAsync(100)
    expect(state()).toBe('current')                                         // committed on the answer alone
    await vi.advanceTimersByTimeAsync(5000)
    expect(w.store.peek(w.k('COLD', '5')).bars[0].t).toBe(OPEN - 300 * 60) // and the depth still joins
  })

  it('the typed warm joins the lake\'s whole depth to its answer BEFORE Enter; then nothing is due', async () => {
    const w = await boot({ lake: lakeOf(likeServer(OPEN - 300 * 60, OPEN + 600), { known: ['REAL', 'COLD'] }) })
    const key = w.k('REAL', '5')
    w.pf.warmTypedSymbol('REAL', '5')
    await vi.advanceTimersByTimeAsync(100)
    expect(w.store.lakePending(key)).toBe(true)                              // the answer is not in yet
    await w.server.drain()
    await vi.advanceTimersByTimeAsync(50)
    const s = w.store.peek(key)
    expect(s.restSeen).toBe(true)
    expect(s.bars[0].t).toBe(OPEN - 300 * 60)                               // the whole depth, before Enter
    expect(w.store.lakePending(key)).toBe(false)                             // so the handoff paints it at once
  })

  // ⭐ Measured 2026-11-17 at 00:36 ET (flip proof, server at normal speed): first paints ended at
  // 11:05 the day before, and that session's afternoon arrived ~500 ms later in view. Overnight and
  // pre-open, the session-completeness rule (marketSession, ramped to 100% the same night) is what
  // keeps such a copy off the instant path.
  it('overnight, a saved copy that stops mid-way through the last session is not painted at once; one that reaches the close is', async () => {
    vi.setSystemTime((OPEN + 15 * 3600 + 6 * 60) * 1000)                    // the next day, 00:36 ET
    const w = await boot({ lake: null })
    const idb = await import('../../utils/barsIDB')
    const { intradayRows } = await import('./testing/fakeBarsServer')
    await idb.idbPutMonotonic('HALF', '5', intradayRows(5, OPEN + 95 * 60))   // stops at 11:05
    await idb.idbPutMonotonic('WHOLE', '5', intradayRows(5, OPEN + 385 * 60)) // reaches 15:55
    w.pf.peekDisplayable('HALF', '5')
    w.pf.peekDisplayable('WHOLE', '5')                                       // first peeks hydrate
    await vi.advanceTimersByTimeAsync(20)
    expect(w.pf.peekDisplayable('HALF', '5')).toBe(false)
    expect(w.pf.peekDisplayable('WHOLE', '5')).toBe(true)
  })

  it('a saved copy current for the view still takes the instant path with no answer', async () => {
    const w = await boot({ lake: null })
    const idb = await import('../../utils/barsIDB')
    const { intradayRows } = await import('./testing/fakeBarsServer')
    await idb.idbPutMonotonic('SAVED', '5', intradayRows(5, Math.floor(NOW / 1000) - 300))
    w.pf.peekDisplayable('SAVED', '5')                                       // first peek hydrates
    await vi.advanceTimersByTimeAsync(20)
    expect(w.store.peek(w.k('SAVED', '5'))?.restSeen).toBe(false)
    expect(w.pf.peekDisplayable('SAVED', '5')).toBe(true)
  })

  it('a lake load that settles with nothing to add is no longer due (a young listing never waits again)', async () => {
    const w = await boot({ lake: lakeOf(likeServer(OPEN - 2 * 86400 - 3000, OPEN - 2 * 86400)) })   // no bar in common
    const key = w.k('COLD', '5')
    w.store.subscribe(key, () => {})
    await vi.advanceTimersByTimeAsync(20)
    await w.server.drain()
    await vi.advanceTimersByTimeAsync(50)
    expect(await w.store.lakeSeed(key)).toBe(false)
    expect(w.store.lakePending(key)).toBe(false)
  })

  it('a lake load that lands with no entry to join into does not settle: the depth is still due (review of #1795)', async () => {
    const w = await boot({ lake: lakeOf(likeServer(OPEN - 300 * 60, OPEN + 600)) })
    const key = w.k('COLD', '5')
    expect(await w.store.lakeSeed(key)).toBe(false)                          // nothing held yet
    expect(w.store.lakePending(key)).toBe(true)                              // so a later switch still waits for it
  })

  it('a symbol the lake does not carry commits on its answer with no wait at all', async () => {
    const w = await boot({ lake: null })
    const state = settled(w.pf.prepareForDisplay('COLD', '5'))
    await vi.advanceTimersByTimeAsync(40)
    await w.server.drain()
    await vi.advanceTimersByTimeAsync(5)
    expect(state()).toBe('current')
  })
})

describe('the lake in the handoff race', () => {
  // ⭐ 2026-11-18: during the session the lake never holds today's bars. Committed alone at
  // LAKE_ALONE_MS, the chart drew yesterday's close as its edge and the answer added the whole session
  // in view. A lake copy that is behind waits for the answer (one paint); only a slow answer past
  // LAKE_BEHIND_MAX_MS lets it commit alone.
  it("mid-session, a lake copy without today's bars waits for the slow answer: ONE paint, newest bars in place", async () => {
    const { LAKE_ALONE_MS } = await import('./prefetch')
    const w = await boot({ lake: lakeOf(rows(OPEN - 300, 50)) })            // the lake ends before today
    const state = settled(w.pf.prepareForDisplay('COLD', '5'))
    await vi.advanceTimersByTimeAsync(LAKE_ALONE_MS + 100)                   // the server has NOT answered
    expect(w.server.open().length).toBeGreaterThan(0)
    expect(state()).toBe('PENDING')                                          // the old chart stays
    const s = w.store.peek(w.k('COLD', '5'))
    expect(s.restSeen).toBe(false)
    expect(s.bars.length).toBe(50)                                           // the lake is held, joined later
    await w.server.drain()
    await vi.advanceTimersByTimeAsync(10)
    expect(state()).toBe('current')
    expect(w.store.peek(w.k('COLD', '5')).restSeen).toBe(true)
  })

  it('…and an answer slower than LAKE_BEHIND_MAX_MS: the lake copy commits alone, the answer completes it', async () => {
    const { LAKE_BEHIND_MAX_MS } = await import('./prefetch')
    const w = await boot({ lake: lakeOf(rows(OPEN - 300, 50)) })
    const state = settled(w.pf.prepareForDisplay('COLD', '5'))
    await vi.advanceTimersByTimeAsync(LAKE_BEHIND_MAX_MS - 50)
    expect(state()).toBe('PENDING')
    await vi.advanceTimersByTimeAsync(100)
    expect(state()).toBe('lake')
    expect(w.store.peek(w.k('COLD', '5')).bars.length).toBe(50)
    await w.server.drain()
    expect(w.store.peek(w.k('COLD', '5')).restSeen).toBe(true)
  })

  it('a lake copy current for the view (overnight, reaching the close) commits alone at LAKE_ALONE_MS', async () => {
    const { LAKE_ALONE_MS } = await import('./prefetch')
    vi.setSystemTime((OPEN + 15 * 3600 + 6 * 60) * 1000)                    // the next day, 00:36 ET
    const w = await boot({ lake: lakeOf(rows(OPEN + 6 * 3600 + 25 * 60, 50)) })   // through 15:55
    const state = settled(w.pf.prepareForDisplay('COLD', '5'))
    await vi.advanceTimersByTimeAsync(LAKE_ALONE_MS - 50)
    expect(state()).toBe('PENDING')                                          // the server keeps the right of way
    await vi.advanceTimersByTimeAsync(100)
    expect(state()).toBe('lake')
    await w.server.drain()
  })

  // ⭐ Measured 2026-11-17 (instrumented build, never-opened tickers, answer held 1.5 s): 3 of 4 held a
  // 240-row local copy (the universe pack's newest 5m rows, provisional, no server answer) before Enter,
  // and the lake was refused outright because the key held ANY bars: the chart waited ~1.5 s.
  describe('a local copy already held (no server answer)', () => {
    async function withHeldCopy(held, lakeRows) {
      const w = await boot({ lake: lakeOf(lakeRows) })
      const idb = await import('../../utils/barsIDB')
      await idb.idbPutMonotonic('COLD', '5', held)
      return w
    }

    it('on the same basis as the lake: the lake joins it and the handoff commits on the joined history', async () => {
      const lake = rows(OPEN - 300, 50)
      const w = await withHeldCopy(lake.slice(-20), lake)                   // the held 20 are the lake's newest 20
      const state = settled(w.pf.prepareForDisplay('COLD', '5'))
      const { LAKE_BEHIND_MAX_MS } = await import('./prefetch')
      await vi.advanceTimersByTimeAsync(LAKE_BEHIND_MAX_MS + 50)             // mid-session: behind, waited out
      expect(state()).toBe('lake')
      const s = w.store.peek(w.k('COLD', '5'))
      expect(s.restSeen).toBe(false)
      expect(s.bars.length).toBe(50)
      await w.server.drain()
    })

    it('on another price basis (a split between the two): the held copy is kept and the server decides', async () => {
      const lake = rows(OPEN - 300, 50)
      const held = lake.slice(-20).map((b) => ({ ...b, o: b.o * 2, h: b.h * 2, l: b.l * 2, c: b.c * 2 }))
      const w = await withHeldCopy(held, lake)
      const state = settled(w.pf.prepareForDisplay('COLD', '5'))
      await vi.advanceTimersByTimeAsync(400)
      expect(state()).toBe('PENDING')
      expect(w.store.peek(w.k('COLD', '5')).bars.length).toBe(20)
      await w.server.drain()
      expect(state()).toBe('current')
    })

    it('with no bar in common (the two could straddle a hole): the held copy is kept and the server decides', async () => {
      const w = await withHeldCopy(rows(OPEN - 300, 20), rows(OPEN - 300 - 86400, 50))   // the lake ends a day earlier
      const state = settled(w.pf.prepareForDisplay('COLD', '5'))
      await vi.advanceTimersByTimeAsync(400)
      expect(state()).toBe('PENDING')
      expect(w.store.peek(w.k('COLD', '5')).bars.length).toBe(20)
      await w.server.drain()
      expect(state()).toBe('current')
    })
  })

  it('a slow cache read (past HYDRATE_WAIT_MS) and a slow answer: the lake still commits first, after the read', async () => {
    const w = await boot({ lake: lakeOf(rows(OPEN - 300, 40)) })
    const realHydrate = w.store.persist.hydrate
    w.store.persist.hydrate = (key) => new Promise((resolve) => setTimeout(resolve, 600)).then(() => realHydrate(key))
    const state = settled(w.pf.prepareForDisplay('COLD', '5'))
    await vi.advanceTimersByTimeAsync(300)
    expect(state()).toBe('PENDING')                                          // the saved-copy read goes first
    await vi.advanceTimersByTimeAsync(500)
    expect(w.store.peek(w.k('COLD', '5')).bars.length).toBe(40)              // the lake landed after the read
    const { LAKE_BEHIND_MAX_MS } = await import('./prefetch')
    await vi.advanceTimersByTimeAsync(LAKE_BEHIND_MAX_MS)                    // mid-session: behind, waited out
    expect(state()).toBe('lake')
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
