// THE EDGE WARM (2026-11-18). Owner's standard: a ticker opened on 1h, zoomed all the way out, shows its
// whole history at once. Measured live: a cold ticker's 8 pieces took 300-950 ms because the data center's
// edge had never read them; with the edge's copy all 8 took ~70 ms. The warm HEADs a list's pieces (no
// body) so the edge keeps them, and loads each index into the page.
//   E1 source.warmEdge asks HEAD, at the one piece URL the chart's read uses, `limit` at a time
//   E2 historyFeed.edgeWarm warms the whole depth's pieces (the same ones prime picks), once per key
//   E3 keys the lake lacks, failures and aborts cost nothing and throw nothing
import { describe, it, expect, vi } from 'vitest'
import { createHistoryFeed } from './historyFeed'
import { createHistorySource } from '../historyLake/source'
import { keyOf } from './types'

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const index = (symbol) => ({
  symbol, v: 1, series: {
    5: {
      '2026Q2': { bars: 6000, bytes: 100, crc: 1, first: 1, last: 2, off: 0 },
      '2026Q3': { bars: 6100, bytes: 110, crc: 2, first: 3, last: 4, off: 100 },
      '2026Q4': { bars: 4000, bytes: 90, crc: 3, first: 5, last: 6, off: 210 },
    },
  },
})

describe('the edge warm', () => {
  it('E1 HEADs each placed piece at the URL loadPiece reads, never more than `limit` at once', async () => {
    let inFlight = 0, peak = 0
    const calls = []
    const fetch = vi.fn(async (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET' })
      inFlight++; peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return { ok: true, status: 200 }
    })
    const src = createHistorySource({ fetch, base: '/api/hist' })
    const entries = Object.entries(index('AAA').series[5]).map(([period, e]) => ({ period, ...e }))
    entries.push({ period: '2027Q1', bars: 1, bytes: 0, crc: 9, first: 7, last: 8, off: -1 })   // no place: skipped
    const n = await src.warmEdge('AAA', '5', entries, { limit: 2 })
    expect(n).toBe(3)
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'HEAD', 'HEAD'])
    expect(calls[0].url).toBe('/api/hist/v1/5/s-AAA/2026Q2.ubh?c=1&o=0&n=100')
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('E2 warms the pieces of the whole depth once per key, after loading the index', async () => {
    const source = { loadIndex: vi.fn(async (sym) => index(sym)), warmEdge: vi.fn(async (_s, _r, e) => e.length) }
    const feed = createHistoryFeed({ source })
    const key = keyOf({ sym: 'AAA', tf: '5' })
    const first = await feed.edgeWarm(key)
    const again = await feed.edgeWarm(key)
    expect(first).toBe(3)
    expect(again).toBe(0)
    expect(source.loadIndex).toHaveBeenCalledTimes(1)
    expect(source.warmEdge).toHaveBeenCalledTimes(1)
    const [sym, series, entries] = source.warmEdge.mock.calls[0]
    expect(sym).toBe('AAA')
    expect(series).toBe('5')
    expect(entries.map((e) => e.period)).toEqual(['2026Q2', '2026Q3', '2026Q4'])
  })

  it('E3 daily keys, symbols the lake lacks, failures and aborts resolve 0 and throw nothing', async () => {
    const source = { loadIndex: vi.fn(async () => null), warmEdge: vi.fn(async () => 1) }
    const feed = createHistoryFeed({ source })
    expect(await feed.edgeWarm(keyOf({ sym: 'AAA', tf: 'D' }))).toBe(0)
    expect(await feed.edgeWarm(keyOf({ sym: 'NONE', tf: '5' }))).toBe(0)
    const bad = createHistoryFeed({ source: { loadIndex: vi.fn(async () => { throw new Error('boom') }), warmEdge: vi.fn() } })
    expect(await bad.edgeWarm(keyOf({ sym: 'BAD', tf: '5' }))).toBe(0)
    const ac = new AbortController(); ac.abort()
    const live = { loadIndex: vi.fn(async (sym) => index(sym)), warmEdge: vi.fn(async () => 1) }
    expect(await createHistoryFeed({ source: live }).edgeWarm(keyOf({ sym: 'AAA', tf: '5' }), { signal: ac.signal })).toBe(0)
    await flush()
    expect(source.warmEdge).not.toHaveBeenCalled()
    expect(live.loadIndex).not.toHaveBeenCalled()                       // an aborted warm asks nothing at all
    expect(live.warmEdge).not.toHaveBeenCalled()
  })

  it('E4 an edge that refuses the member (401/403) answers -1, so the list warm stops', async () => {
    const { HistoryError } = await import('../historyLake/source')
    for (const status of [401, 403]) {
      const src = { loadIndex: vi.fn(async () => { throw new HistoryError('no', { status }) }), warmEdge: vi.fn() }
      expect(await createHistoryFeed({ source: src }).edgeWarm(keyOf({ sym: 'AAA', tf: '60' }))).toBe(-1)
    }
    const src = { loadIndex: vi.fn(async () => { throw new HistoryError('down', { status: 503 }) }), warmEdge: vi.fn() }
    expect(await createHistoryFeed({ source: src }).edgeWarm(keyOf({ sym: 'AAA', tf: '60' }))).toBe(0)
  })

  it('E5 the page keeps at most INDEX_CACHE_MAX indexes, the least recently used forgotten first', async () => {
    const { INDEX_CACHE_MAX } = await import('../historyLake/source')
    const fetch = vi.fn(async (url) => {
      const sym = /s-([A-Z0-9]+)\.json/.exec(url)?.[1]
      return { ok: true, status: 200, json: async () => ({ ...index(sym), symbol: sym }) }
    })
    const src = createHistorySource({ fetch })
    const syms = Array.from({ length: INDEX_CACHE_MAX }, (_, i) => `S${i}`)
    for (const s of syms) await src.loadIndex(s)
    await src.loadIndex('S0')                                           // used again: now the newest
    await src.loadIndex('EXTRA')                                        // one more: S1 is forgotten
    const calls = fetch.mock.calls.length
    await src.loadIndex('S0')
    expect(fetch.mock.calls.length).toBe(calls)
    await src.loadIndex('S1')
    expect(fetch.mock.calls.length).toBe(calls + 1)
  })
})
