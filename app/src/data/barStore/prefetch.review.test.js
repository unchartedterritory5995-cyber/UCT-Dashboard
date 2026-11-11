// P2c review fixes (#1126): the facade as a TRUE drop-in.
//   #1  a warm nobody subscribes to is PERSISTED (mem + IDB, persist.js rules) and survives the
//       registry LRU; the cooldown never blocks a key evicted before anything was persisted;
//   #2a `&warm=1` exactly where legacy sends it; #2b `priority: true` = front of its rank;
//   #2d typed warm: legacy `_typedCachePaints` decides 'cache'; 'stale-answer' pinned as an
//       S1 adapter item; #2f the legacy mem readers see what the facade fetched;
//   #3  a hydrated forming row is LOCAL: the delta window starts at the server's newest row;
//   #4  an abort while QUEUED never reaches the network; #5 cooldown pruned by size;
//   #6  a cold key is read from the caches once.
//   (#2c — the legacy paint rule for a local copy — is in prefetch.paint.test.js: it mocks
//   marketSession.)
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, intradayRows, OPEN } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const NOW = (OPEN + 32 * 60 + 20) * 1000          // Tue 10:02:20 ET
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  fakeDb._clear()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  localStorage.setItem('barspack.version', 'test')
})
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version') })

async function boot({ modeFor, maxKeys, io } = {}) {
  vi.resetModules()
  const server = installFakeBarsServer({ modeFor })
  const legacy = await import('../../utils/prefetchBars')
  const { createBarStore } = await import('./index')
  const { createRegistry } = await import('./registry')
  const { createPrefetch } = await import('./prefetch')
  const { createNetwork, deltaStartFor, MUTABLE_WINDOW_S } = await import('./network')
  const types = await import('./types')
  const idb = await import('../../utils/barsIDB')
  const mem = await import('../../utils/barsMemCache')
  const registry = maxKeys ? createRegistry({ maxKeys, ctx: () => ({ nowMs: Date.now() }) }) : undefined
  const store = createBarStore({
    registry, io, stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const pf = createPrefetch({ store, tickerMeta: () => {} })
  const k = (sym, tf) => types.keyOf({ sym, tf })
  return { server, legacy, store, pf, k, idb, mem, types, createRegistry, createNetwork, deltaStartFor, MUTABLE_WINDOW_S }
}
const tick = (ms) => vi.advanceTimersByTimeAsync(ms)
const settle = async (w) => { await w.server.drain({ rounds: 2000, advance: () => tick(1500) }); await w.server.flush(80) }

describe('#1 a warm is persisted without a subscriber', () => {
  it('prefetchBarsToIDB with nobody subscribed lands the answer in mem and IDB', async () => {
    const w = await boot()
    w.pf.prefetchBarsToIDB(['PER'], '5')
    await settle(w)
    expect(w.server.calls.length).toBe(1)
    expect(w.mem.memPeek('PER', '5')?.length).toBeGreaterThan(0)          // #2f: legacy mem readers
    const disk = await w.idb.idbGet('PER', '5')
    expect(disk?.bars?.length).toBeGreaterThan(0)
  })

  it('a list larger than the LRU: evicted warms come back from what persist wrote — no re-ask in the cooldown', async () => {
    const w = await boot({ maxKeys: 3, modeFor: () => 'behind' })           // answered, never displayable
    const LIST = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6']
    w.pf.prefetchBarsToIDB(LIST, '5'); await settle(w)
    expect(w.server.calls.length).toBe(LIST.length)
    expect(w.store.registry.stats().keys).toBeLessThanOrEqual(3)
    w.pf.prefetchBarsToIDB(LIST, '5'); await settle(w)
    expect(w.server.calls.length).toBe(LIST.length)
  })

  it('…but a key evicted before anything was persisted is re-asked (the cooldown does not strand it)', async () => {
    const noop = { memPutMonotonic: () => null, idbPutMonotonic: async () => null }
    const w = await boot({ maxKeys: 3, modeFor: () => 'behind', io: noop })
    const LIST = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6']
    w.pf.prefetchBarsToIDB(LIST, '5'); await settle(w)
    w.pf.prefetchBarsToIDB(LIST, '5'); await settle(w)
    const asked = w.server.calls.map((c) => c.q.sym)
    expect(asked.length).toBeGreaterThan(LIST.length)                       // the evicted ones again
    for (const sym of asked.slice(LIST.length)) expect(w.store.peek(w.k(sym, '5'))?.restSeen).toBe(true)
  })

  it('#2f an IDB-only daily set prepared for useDayFacts is readable from mem', async () => {
    const w = await boot()
    await w.idb.idbPutMonotonic('DAY', 'D', [{ t: '2026-11-06', o: 1, h: 1, l: 1, c: 1, v: 1 }])
    expect(w.mem.memPeek('DAY', 'D')).toBeFalsy()
    await w.pf.prepareDailyForDisplay('DAY', 'D')
    expect(w.mem.memPeek('DAY', 'D')?.length).toBe(1)
    expect(w.server.calls.length).toBe(0)
  })
})

describe('#2a/#2b the legacy wire shape', () => {
  it('&warm=1 on exactly the requests legacy marks warm', async () => {
    const run = async (api, w) => {
      api.prefetchBars(['NB'], '5')                       // warm
      api.prefetchBars(['UR'], '5', { urgent: true })     // the chart's URL
      api.prefetchBar('PB', '15')                         // warm
      api.prefetchBarsToIDB(['ID'], '30')                 // warm
      api.prefetchBarOnIntent('IN', '5')                  // the chart's URL
      const p = api.prepareForDisplay('PR', '5')          // warm (legacy _url / _sinceUrl)
      await tick(200); await settle(w); await p
      return w.server.calls.map((c) => `${c.q.sym}:${c.q.warm}`).sort()
    }
    const legacy = await (async () => { const w = await boot(); return run(w.legacy, w) })()
    fakeDb._clear(); vi.setSystemTime(NOW)
    const facade = await (async () => { const w = await boot(); return run(w.pf, w) })()
    expect(facade).toEqual(legacy)
    expect(facade).toEqual(['ID:true', 'IN:false', 'NB:true', 'PB:true', 'PR:true', 'UR:false'])
  })

  it('priority: true jumps to the front of its rank (same order as legacy)', async () => {
    const run = async (api, w) => {
      w.legacy.barsLaneRequest('/api/bars/F1?tf=D&bars=1', { priority: 'urgent' }).catch(() => {})
      w.legacy.barsLaneRequest('/api/bars/F2?tf=D&bars=1', { priority: 'urgent' }).catch(() => {})
      await w.server.flush()
      api.prefetchBars(['N1', 'N2'], '5')
      await tick(1000); await w.server.flush(80)
      api.prefetchBars(['P1'], '5', { priority: true })
      await tick(1000); await w.server.flush(80)
      await settle(w)
      return w.server.calls.map((c) => c.q.sym).filter((s) => !s.startsWith('F'))
    }
    const legacy = await (async () => { const w = await boot(); return run(w.legacy, w) })()
    fakeDb._clear(); vi.setSystemTime(NOW)
    const facade = await (async () => { const w = await boot(); return run(w.pf, w) })()
    expect(facade[0]).toBe('P1')
    expect(facade).toEqual(legacy)
  })
})

describe('#2d typed warm', () => {
  it("a cached daily set the paint authority refuses is fetched, like legacy (not 'cache')", async () => {
    const run = async (api, w) => {
      await w.idb.idbPutMonotonic('TYD', 'D', [{ t: '2026-11-03', o: 1, h: 1, l: 1, c: 1, v: 1 }])
      const r = await (async () => { const p = api.warmTypedSymbol('TYD', 'D'); await settle(w); return p })()
      return { r, n: w.server.calls.length }
    }
    const legacy = await (async () => { const w = await boot(); return run(w.legacy, w) })()
    fakeDb._clear(); vi.setSystemTime(NOW)
    const facade = await (async () => { const w = await boot(); return run(w.pf, w) })()
    expect(facade).toEqual(legacy)
    expect(facade).toEqual({ r: 'network', n: 1 })
  })

  it("S1 ADAPTER ITEM (pinned): the facade never answers 'stale-answer' — a chart answer landing mid-request is merged, the warm reports 'network'", async () => {
    localStorage.removeItem('barspack.version')
    const w = await boot()
    const p = w.pf.warmTypedSymbol('TYS', 'D')
    for (let i = 0; i < 50 && !w.server.calls.length; i++) await w.server.flush()
    expect(w.server.calls.length).toBe(1)                                   // the typed request is on the wire
    const off = w.store.subscribe(w.k('TYS', 'D'), () => {}, { priority: 'visible' })
    await tick(0)                                                           // its first poll joins the typed request
    await settle(w)
    await expect(p).resolves.toBe('network')
    expect(w.server.calls.length).toBe(1)
    off()
  })
})

describe('#3 a hydrated forming row is LOCAL, never the server tail', () => {
  it('server behind the hydrated local row: the delta window starts at the server newest row', async () => {
    const now = Math.floor(NOW / 1000)
    const w = await boot({ modeFor: () => 'behind-unsealed' })            // server newest row: 09:40, no seal
    await w.idb.idbPutMonotonic('LOC', '5', intradayRows(5, now))           // local copy incl. the forming 10:00
    const key = w.k('LOC', '5')
    await w.store.persist.hydrate(key)
    expect(w.store.peek(key).developing?.src).toBe('local')
    const p = w.store.ensure(key); await settle(w); await p                // a server answer (behind)
    const s = w.store.peek(key)
    expect(s.restSeen).toBe(true)
    expect(s.sealedSpans.length).toBe(0)
    expect(s.developing?.src).not.toBe('server')
    expect(w.deltaStartFor(s)).toBe(OPEN + 600 - w.MUTABLE_WINDOW_S)
  })
})

describe('#4 an abort while QUEUED leaks nothing', () => {
  it('a fetchOnce queued behind a scroll-back and then aborted never sends its tail request', async () => {
    const w = await boot()
    const registry = w.createRegistry({ ctx: () => ({ nowMs: Date.now() }) })
    const held = []
    const net = w.createNetwork({
      registry, isHidden: () => false, onVisible: () => () => {},
      request: (url) => new Promise((resolve) => held.push({ url, resolve })),
    })
    const key = w.k('QAB', '5')
    const first = net.fetchOnce(key)
    held[0].resolve({ bars: intradayRows(5, Math.floor(NOW / 1000)) }); await first
    const scroll = net.scrollBack(key)                                      // occupies the slot
    expect(held.length).toBe(2)
    const ac = new AbortController()
    const q = net.fetchOnce(key, { signal: ac.signal })                     // queued behind it
    ac.abort()
    await expect(q).resolves.toEqual({ aborted: true })
    held[1].resolve({ bars: [] }); await scroll
    await tick(10)
    expect(held.length).toBe(2)                                             // nothing more went out
  })
})

describe('#5/#6 bookkeeping', () => {
  it('the cooldown table is bounded by size, not only by age', async () => {
    const w = await boot({ modeFor: () => 'behind' })
    const syms = Array.from({ length: 450 }, (_, i) => `C${i}`)
    w.pf.prefetchBarsToIDB(syms, '5'); await settle(w)
    expect(w.server.calls.length).toBe(450)
    expect(w.pf._stats().asked).toBeLessThanOrEqual(400)
  })

  it('a cold key is read from the caches ONCE per ensure', async () => {
    const real = await import('../../utils/barsIDB')
    let reads = 0
    const w = await boot({ io: { idbGet: async (...a) => { reads++; return real.idbGet(...a) } } })
    const p = w.pf.ensure(w.k('ONCE', '5'))
    await settle(w); await p
    expect(w.server.calls.length).toBe(1)
    expect(reads).toBe(1)
  })
})
