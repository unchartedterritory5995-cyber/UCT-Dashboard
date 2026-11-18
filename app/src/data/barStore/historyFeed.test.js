// @vitest-environment node
// historyFeed.js over the real history source and the Python-built synthetic fixture
// (data/historyLake/__fixtures__/source.json): the newest N bars strictly older than a time, plus
// the bar AT that time for the seam rule, split-adjusted, and only the pieces that needs.
import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import fixture from '../historyLake/__fixtures__/source.json'
import { parsePrefix } from '../historyLake/piece'
import { createHistorySource, HEADER_NAME } from '../historyLake/source'
import { createHistoryFeed, lakeSeriesOfKey, historyLakeEnabled, lakeOnByDefault, appHistoryFeed, HISTORY_LAKE_KEY } from './historyFeed'
import { keyOf } from './types'

const INDEX = fixture.index
const SYM = 'MU-LT'                    // the app's spelling of the fixture's MU.LT
const W5 = fixture.expected['5']

function edge() {
  const pieces = new Map(fixture.pieces.map((p) => [`/api/hist/${p.relpath}`, Buffer.from(p.b64, 'base64')]))
  const asked = []
  const fetch = async (url) => {
    asked.push(url)
    const path = url.split('?')[0]
    if (path === `/api/hist/${fixture.index_relpath}`) return new Response(JSON.stringify(INDEX))
    const data = pieces.get(path)
    if (!data) return new Response('{}', { status: 404 })
    const q = new URLSearchParams(url.split('?')[1] || '')
    if (q.get('o') !== '0' || q.get('n') !== String(data.length)) return new Response('{}', { status: 409 })
    const { header, offset } = parsePrefix(new Uint8Array(data))
    return new Response(zlib.brotliDecompressSync(data.subarray(offset)), { headers: { [HEADER_NAME]: JSON.stringify(header) } })
  }
  return { fetch, asked, pieceAsks: () => asked.filter((u) => u.includes('.ubh')).map((u) => u.split('/').pop().split('?')[0]) }
}
const feedOver = (e) => createHistoryFeed({ source: createHistorySource({ fetch: e.fetch }) })
const at = (t) => W5.raw.t.indexOf(t)

describe('historyFeed', () => {
  it('returns the newest N bars older than the time, plus the seam bar, adjusted like the reference', async () => {
    const e = edge()
    const feed = feedOver(e)
    const key = keyOf({ sym: SYM, tf: '5' })
    const q4first = INDEX.series['5']['2026Q4'].first
    const got = await feed.olderBars(key, q4first, { bars: 10 })
    expect(got.exhausted).toBe(false)
    expect(got.bars.length).toBe(11)                       // 10 older + the bar at q4first
    const i = at(q4first)
    expect(got.bars.map((b) => b.t)).toEqual(W5.raw.t.slice(i - 10, i + 1))
    expect(got.bars.map((b) => b.c)).toEqual(W5.adjusted.c.slice(i - 10, i + 1))
    expect(got.bars.map((b) => b.v)).toEqual(W5.adjusted.v.slice(i - 10, i + 1))
    expect(e.pieceAsks()).toEqual(['2026Q3.ubh', '2026Q4.ubh'])   // the piece holding the seam, and the one before
  })

  it('a piece that reaches the time counts as half, so a short count asks one more piece', async () => {
    const e = edge()
    const key = keyOf({ sym: SYM, tf: '5' })
    const q4 = INDEX.series['5']['2026Q4']
    const i0 = at(q4.first)
    const beforeT = W5.raw.t[i0 + 30]                                    // 30 older bars inside Q4 (of ${q4.bars})
    const got = await feedOver(e).olderBars(key, beforeT, { bars: 50 })
    expect(got.bars.length).toBe(51)                                    // 50 older + the seam bar: Q3 was needed
    expect(got.bars[0].t).toBe(W5.raw.t[i0 + 30 - 50])
    expect(e.pieceAsks()).toEqual(['2026Q3.ubh', '2026Q4.ubh'])
  })

  it('asks only the pieces it needs, newest first, until it has enough', async () => {
    const e = edge()
    const feed = feedOver(e)
    const key = keyOf({ sym: SYM, tf: '5' })
    const q3last = INDEX.series['5']['2026Q3'].last
    const small = await feed.olderBars(key, q3last + 1, { bars: 5 })     // between two pieces: no seam bar
    expect(small.bars.map((b) => b.t)).toEqual(W5.raw.t.slice(at(q3last) - 4, at(q3last) + 1))
    expect(e.pieceAsks()).toEqual(['2026Q3.ubh'])
    const e2 = edge()
    const all = await feedOver(e2).olderBars(key, q3last + 1, { bars: 100000 })
    expect(all.bars.length).toBe(at(q3last) + 1)                        // everything older, oldest first
    expect(all.bars[0].t).toBe(W5.raw.t[0])
    expect(e2.pieceAsks()).toEqual(['2026Q2.ubh', '2026Q3.ubh'])
  })

  it('says exhausted when nothing is older, and for keys the lake does not carry', async () => {
    const feed = feedOver(edge())
    const first = INDEX.series['5']['2026Q2'].first
    const none = await feed.olderBars(keyOf({ sym: SYM, tf: '5' }), first, { bars: 10 })
    expect(none.exhausted).toBe(true)
    expect(none.bars).toEqual([])                                       // a join bar alone is no window
    expect((await feed.olderBars(keyOf({ sym: SYM, tf: '5' }), first - 1)).exhausted).toBe(true)
    expect((await feed.olderBars(keyOf({ sym: SYM, tf: '15' }), first + 1e7)).exhausted).toBe(true)   // no 15m series
    expect((await feed.olderBars(keyOf({ sym: SYM, tf: 'D' }), first + 1e7)).exhausted).toBe(true)
    expect((await feed.olderBars(keyOf({ sym: 'NOPE', tf: '5' }), first + 1e7)).exhausted).toBe(true)
  })

  it('maps 60m on the session grid and on the clock grid to their own series', async () => {
    const feed = feedOver(edge())
    const rth = keyOf({ sym: SYM, tf: '60' })
    const eth = keyOf({ sym: SYM, tf: '60', session: 'eth' })
    expect(lakeSeriesOfKey(rth)).toMatchObject({ series: '60', extended: false })
    expect(lakeSeriesOfKey(eth)).toMatchObject({ series: '60e', extended: true })
    expect(lakeSeriesOfKey(keyOf({ sym: SYM, tf: 'W' }))).toBe(null)
    expect(lakeSeriesOfKey(`${keyOf({ sym: SYM, tf: '5' })}@to=1794000000`)).toBe(null)
    const last60 = fixture.expected['60'].raw.t.at(-1)
    const last60e = fixture.expected['60e'].raw.t.at(-1)
    const a = await feed.olderBars(rth, last60 + 1, { bars: 3 })
    const b = await feed.olderBars(eth, last60e + 1, { bars: 3 })
    expect(a.bars.map((x) => x.c)).toEqual(fixture.expected['60'].adjusted.c.slice(-3))
    expect(b.bars.map((x) => x.c)).toEqual(fixture.expected['60e'].adjusted.c.slice(-3))
  })

  it('is off unless the per-browser switch says 1, and off when storage is missing or throws', () => {
    expect(globalThis.localStorage).toBeUndefined()          // node: no storage at all
    expect(historyLakeEnabled()).toBe(false)
    const store = {}
    globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v) }, removeItem: (k) => { delete store[k] } }
    try {
      expect(historyLakeEnabled()).toBe(false)
      store[HISTORY_LAKE_KEY] = 'true'; expect(historyLakeEnabled()).toBe(false)
      store[HISTORY_LAKE_KEY] = '1'; expect(historyLakeEnabled()).toBe(true)
      globalThis.localStorage = { getItem: () => { throw new Error('blocked') } }
      expect(historyLakeEnabled()).toBe(false)
    } finally { delete globalThis.localStorage }
  })

  it('the app\'s default (byDefault): ON unless this browser says 0; 1 still forces on; unreadable = the default', () => {
    expect(historyLakeEnabled({ byDefault: true })).toBe(true)          // node: no storage at all
    const store = {}
    globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null) }
    try {
      expect(historyLakeEnabled({ byDefault: true })).toBe(true)
      store[HISTORY_LAKE_KEY] = '0'; expect(historyLakeEnabled({ byDefault: true })).toBe(false)
      store[HISTORY_LAKE_KEY] = '1'; expect(historyLakeEnabled({ byDefault: true })).toBe(true)
      store[HISTORY_LAKE_KEY] = 'off'; expect(historyLakeEnabled({ byDefault: true })).toBe(true)   // only '0' turns it off
      globalThis.localStorage = { getItem: () => { throw new Error('blocked') } }
      expect(historyLakeEnabled({ byDefault: true })).toBe(true)
    } finally { delete globalThis.localStorage }
  })

  it('the default is ON for the app (any build mode) and OFF only in the test runner', () => {
    expect(lakeOnByDefault('production')).toBe(true)
    expect(lakeOnByDefault('development')).toBe(true)
    expect(lakeOnByDefault('test')).toBe(false)
    expect(lakeOnByDefault()).toBe(false)                                // this suite runs in mode 'test'
  })

  it('the app store\'s feed: built in production unless this browser says 0; never by default in the test runner', () => {
    const make = () => ({ feed: true })
    expect(appHistoryFeed('production', make)).toEqual({ feed: true })   // node: no storage, the default
    const store = {}
    globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null) }
    try {
      expect(appHistoryFeed('production', make)).toEqual({ feed: true })
      store[HISTORY_LAKE_KEY] = '0'; expect(appHistoryFeed('production', make)).toBe(null)
      delete store[HISTORY_LAKE_KEY]
      expect(appHistoryFeed('test', make)).toBe(null)
      store[HISTORY_LAKE_KEY] = '1'; expect(appHistoryFeed('test', make)).toEqual({ feed: true })
    } finally { delete globalThis.localStorage }
  })

  it('getBarStore builds the app store with appHistoryFeed (read from the source: one wiring, one place)', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
    const body = src.slice(src.indexOf('export function getBarStore'), src.indexOf('export function _resetBarStoreForTests'))
    expect(body).toMatch(/createBarStore\(\{\s*history:\s*appHistoryFeed\(\)\s*\}\)/)
  })
})
