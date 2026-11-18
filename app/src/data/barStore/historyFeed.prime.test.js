// Primed at open (2026-11-17): a chart's first lake window was asked only after its first server answer,
// so on a symbol the page had not opened the deep history came a whole edge round trip after the first
// paint. `prime` starts that round trip at the open: the index and the series' newest pieces into the
// browser's HTTP cache, at the very URLs the window then reads.
import { describe, it, expect, vi } from 'vitest'
import { createHistoryFeed, PRIME_PIECES } from './historyFeed'
import { createHistorySource } from '../historyLake/source'
import { createRegistry } from './registry'
import { createNetwork } from './network'
import { keyOf } from './types'

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const index = (symbol) => ({
  symbol, v: 1, series: {
    5: {
      '2026Q2': { bars: 6000, bytes: 100, crc: 1, first: 1, last: 2, off: 0 },
      '2026Q3': { bars: 6100, bytes: 110, crc: 2, first: 3, last: 4, off: 100 },
      '2026Q4': { bars: 4000, bytes: 90, crc: 3, first: 5, last: 6, off: 210 },
    },
  },
})

describe('historyFeed.prime', () => {
  it('warms the index and the newest pieces holding the whole first-paint depth, once per key', async () => {
    const source = { loadIndex: vi.fn(async (sym) => index(sym)), warmPieces: vi.fn(async () => {}) }
    const feed = createHistoryFeed({ source })
    const key = keyOf({ sym: 'AAA', tf: '5' })
    feed.prime(key)
    feed.prime(key)                                                     // a second open: nothing more
    await flush()
    expect(source.loadIndex).toHaveBeenCalledTimes(1)
    expect(source.warmPieces).toHaveBeenCalledTimes(1)
    const [sym, series, entries] = source.warmPieces.mock.calls[0]
    expect(sym).toBe('AAA')
    expect(series).toBe('5')
    // 4,000 + 6,100 + 6,000 bars: every piece is needed for LAKE_PREFETCH_TARGET_BARS (20,000)
    expect(entries.map((e) => e.period)).toEqual(['2026Q2', '2026Q3', '2026Q4'])
  })

  it('stops at the pieces that hold the depth asked, never fewer than PRIME_PIECES', async () => {
    const source = { loadIndex: vi.fn(async (sym) => index(sym)), warmPieces: vi.fn(async () => {}) }
    const feed = createHistoryFeed({ source })
    feed.prime(keyOf({ sym: 'BBB', tf: '5' }), { bars: 9000 })          // 4,000 + 6,100 reach it
    feed.prime(keyOf({ sym: 'CCC', tf: '5' }), { bars: 1 })             // the newest piece would: still two
    await flush()
    expect(source.warmPieces.mock.calls[0][2].map((e) => e.period)).toEqual(['2026Q3', '2026Q4'])
    expect(source.warmPieces.mock.calls[1][2].length).toBe(PRIME_PIECES)
  })

  it('daily keys, symbols the lake lacks and failures cost nothing and throw nothing', async () => {
    const source = { loadIndex: vi.fn(async () => null), warmPieces: vi.fn() }
    const feed = createHistoryFeed({ source })
    feed.prime(keyOf({ sym: 'AAA', tf: 'D' }))
    feed.prime(keyOf({ sym: 'NONE', tf: '5' }))
    const bad = createHistoryFeed({ source: { loadIndex: vi.fn(async () => { throw new Error('boom') }), warmPieces: vi.fn() } })
    bad.prime(keyOf({ sym: 'BAD', tf: '5' }))
    await flush()
    expect(source.loadIndex).toHaveBeenCalledTimes(1)                   // only NONE (D is not a lake key)
    expect(source.warmPieces).not.toHaveBeenCalled()
  })
})

describe('historyLake source.warmPieces', () => {
  it('fetches exactly the URL loadPiece reads (one cache key), reads the body, never rejects', async () => {
    const urls = []
    const fetch = vi.fn(async (url) => {
      urls.push(String(url))
      if (String(url).includes('/index/')) return { ok: true, status: 200, json: async () => index('AAA') }
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4), headers: { get: () => null } }
    })
    const src = createHistorySource({ fetch })
    const e = index('AAA').series[5]['2026Q4']
    const PIECE = '/api/hist/v1/5/s-AAA/2026Q4.ubh?c=3&o=210&n=90'
    await src.warmPieces('AAA', '5', [{ ...e, period: '2026Q4' }, { period: 'X', bytes: 0, crc: 1, off: 0 }])  // the second has no place
    expect(urls).toEqual([PIECE])
    // the real read of that piece asks the SAME URL (it then fails on the fake body; the URL is the point)
    await src.loadBars('AAA', '5', { from: 5 }).catch(() => {})
    expect(urls.filter((u) => u === PIECE).length).toBe(2)
    const failing = createHistorySource({ fetch: vi.fn(async () => { throw new Error('offline') }) })
    await expect(failing.warmPieces('AAA', '5', [e])).resolves.toBeUndefined()
  })
})

describe('primeLake: ahead of the open (a typed ticker, a row the pointer rests on)', () => {
  it('network.primeLake primes intraday lake keys only, and only with a lake', () => {
    const prime = vi.fn()
    const net = createNetwork({ registry: createRegistry(), history: { olderBars: vi.fn(), prime }, request: vi.fn(() => new Promise(() => {})), isHidden: () => false, onVisible: () => () => {} })
    net.primeLake(keyOf({ sym: 'AAA', tf: '5' }))
    net.primeLake(keyOf({ sym: 'AAA', tf: 'D' }))
    expect(prime.mock.calls.map((c) => c[0])).toEqual([keyOf({ sym: 'AAA', tf: '5' })])
    const none = createNetwork({ registry: createRegistry(), history: null, request: vi.fn(), isHidden: () => false, onVisible: () => () => {} })
    expect(() => none.primeLake(keyOf({ sym: 'AAA', tf: '5' }))).not.toThrow()
  })

  it('the typed warm and the pointer intent prime the key they warm', async () => {
    const { createPrefetch } = await import('./prefetch')
    const primed = []
    const snaps = new Map()
    const store = {
      registry: { acquire() {}, release() {} },
      persist: { hydrate: () => Promise.resolve(), hydrateMem() {} },
      peek: (k) => snaps.get(k) || null,
      ensure: vi.fn(async (k) => { const s = { key: k, restSeen: true, status: 'current', bars: [{ t: 1 }], depth: 500 }; snaps.set(k, s); return s }),
      primeLake: (k) => primed.push(k),
    }
    const timers = []
    const pf = createPrefetch({ store, tickerMeta: () => {}, packIngesting: () => true, extended: () => false,
      setTimer: (fn, ms) => { timers.push(fn); return timers.length }, clearTimer: () => {} })
    const typed = pf.warmTypedSymbol('TYP', '5')
    for (let i = 0; i < 5; i++) { await Promise.resolve(); timers.splice(0).forEach((f) => f()) }
    await typed
    pf.prefetchBarOnIntent('HOV', '5')
    timers.splice(0).forEach((f) => f())
    expect(primed).toEqual([pf.keyFor('TYP', '5'), pf.keyFor('HOV', '5')])
  })
})

describe('network.start primes the lake at the open', () => {
  const make = (history) => createNetwork({
    registry: createRegistry(), history, request: vi.fn(() => new Promise(() => {})),
    isHidden: () => false, onVisible: () => () => {},
  })
  it('the first subscription of an intraday key primes it once; never a daily or replay key; never without a lake', () => {
    const prime = vi.fn()
    const net = make({ olderBars: vi.fn(), prime })
    const k = keyOf({ sym: 'AAA', tf: '5' })
    const stop1 = net.start(k); const stop2 = net.start(k)
    expect(prime).toHaveBeenCalledTimes(1)
    expect(prime).toHaveBeenCalledWith(k)
    net.start(keyOf({ sym: 'AAA', tf: 'D' }))
    net.start(keyOf({ sym: 'AAA', tf: '5', window: { to: 1_700_000_000 } }))
    expect(prime).toHaveBeenCalledTimes(1)
    stop1(); stop2()
    expect(() => make(null).start(k)).not.toThrow()
  })
})
