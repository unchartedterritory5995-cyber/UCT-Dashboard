// app/src/components/chart/engine/__tests__/serverLaneBatch.test.js
//
// ─── SEVERAL DEFINITIONS FOR ONE SYMBOL LEAVE AS ONE REQUEST (2026-11-12) ────
//
// Measured on production: a member arrowing down a watchlist saw the next symbol's candles
// 40 ms after the key press and its five server definitions 1.2 to 2.0 s later, five
// requests, each waiting on the same server read. The lane now sends a chart's asks for a
// symbol as ONE batch, lands each slot under the key the single ask uses, and can be asked
// quietly ahead of the member (`serverWarm.test.js`). These rails pin the door itself.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  SERVER_COLUMNS_BATCH_PATH, BATCH_RETRY_MS, ASK_TTL_MS, ASK_MAX,
  clearServerColumns, ensureColumns, cachedColumns, hasColumns, fetchColumns, fetchColumnsBatch,
  serverColumnsBatchUrl, serverColumnsKey, serverColumnsFor, primeServerColumns, subscribe,
  batchAvailable, liveAsks, serverColumnsCacheStats,
  __setServerBatchFetcherForTests, __setCacheMaxCellsForTests,
} from '../serverCompute'
import { getDefinition, computeFor } from '../nativeRegistry'

const SYM = 'NVDA'
const TF = 'D'
const wire = (v) => ({ times: [20260102, 20260105], columns: { a: [v, v + 1] }, payload: { state: 'ok' } })
const ok = (v) => ({ status: 200, envelope: wire(v) })
/** the asks a five-definition suite makes for one symbol */
const ASKS = [
  { defId: 'defA', inputs: { benchmark: 'SPY' } },
  { defId: 'defB', inputs: null },
  { defId: 'defC', inputs: { len: 21, type: 'EMA' } },
]
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await vi.advanceTimersByTimeAsync(0) }
const asksOf = (url) => JSON.parse(new URL(url, 'http://x').searchParams.get('asks'))

let batchCalls, singleCalls
/** arm the batch door with a responder: (asks, url) => body */
const armBatch = (respond) => __setServerBatchFetcherForTests((url) => {
  batchCalls.push(url)
  const out = respond(asksOf(url), url)
  return out instanceof Error ? Promise.reject(out) : Promise.resolve(out)
})
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status })

beforeEach(() => {
  vi.useFakeTimers()
  clearServerColumns()
  batchCalls = []
  singleCalls = []
  // the single route, as the browser would answer it
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    singleCalls.push(String(url))
    return { ok: true, status: 200, json: async () => wire(9) }
  }))
})
afterEach(() => {
  __setServerBatchFetcherForTests(null)
  __setCacheMaxCellsForTests()
  clearServerColumns()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('the batch URL', () => {
  it('is ONE path carrying the symbol, the timeframe and every ask with its inputs sorted', () => {
    const url = serverColumnsBatchUrl(SYM, TF, [{ defId: 'defC', inputs: { type: 'EMA', len: 21 } }, { defId: 'defB' }])
    expect(url.startsWith(`${SERVER_COLUMNS_BATCH_PATH}?sym=NVDA&tf=D&asks=`)).toBe(true)
    expect(asksOf(url)).toEqual([{ defId: 'defC', inputs: { len: 21, type: 'EMA' } }, { defId: 'defB' }])
    // one set of asks is one URL whatever order an instance stored its keys in
    expect(serverColumnsBatchUrl(SYM, TF, [{ defId: 'defC', inputs: { len: 21, type: 'EMA' } }, { defId: 'defB' }])).toBe(url)
  })
  it('is null when there is nothing to ask for', () => {
    expect(serverColumnsBatchUrl('', TF, ASKS)).toBeNull()
    expect(serverColumnsBatchUrl(SYM, TF, [])).toBeNull()
    expect(serverColumnsBatchUrl(SYM, TF, [{ inputs: {} }])).toBeNull()
  })
})

describe('a chart\'s asks for one symbol leave together', () => {
  it('⭐ three definitions asked in one paint are ONE batch request, landed under the single keys', async () => {
    armBatch((asks) => ({ results: asks.map((_, i) => ok(i + 1)) }))
    const seen = []
    const off = subscribe((k) => seen.push(k))
    for (const a of ASKS) expect(ensureColumns(a.defId, SYM, TF, a.inputs)).toBeNull()
    await tick()
    expect(batchCalls.length).toBe(1)
    expect(singleCalls.length, 'no single ask rides beside the batch').toBe(0)
    expect(asksOf(batchCalls[0]).map((a) => a.defId)).toEqual(['defA', 'defB', 'defC'])
    // each slot is readable through the key the single route would have used
    ASKS.forEach((a, i) => expect(cachedColumns(a.defId, SYM, TF, a.inputs).columns.a[0]).toBe(i + 1))
    expect(seen.sort()).toEqual(ASKS.map((a) => serverColumnsKey(a.defId, SYM, TF, a.inputs)).sort())
    // a repaint asks for nothing
    for (const a of ASKS) expect(ensureColumns(a.defId, SYM, TF, a.inputs)).not.toBeNull()
    await tick()
    expect(batchCalls.length).toBe(1)
    off()
  })

  it('a paint that asks twice before the request leaves still sends each ask once', async () => {
    armBatch((asks) => ({ results: asks.map(() => ok(1)) }))
    for (let i = 0; i < 3; i++) for (const a of ASKS) ensureColumns(a.defId, SYM, TF, a.inputs)
    await tick()
    expect(batchCalls.length).toBe(1)
    expect(asksOf(batchCalls[0]).length).toBe(3)
    // …and a paint while the batch is in flight starts nothing more
    armBatch(() => new Promise(() => {}))
    ensureColumns('defA', 'AAPL', TF, null); ensureColumns('defB', 'AAPL', TF, null)
    await tick()
    ensureColumns('defA', 'AAPL', TF, null); ensureColumns('defB', 'AAPL', TF, null)
    await tick()
    expect(batchCalls.length).toBe(2)
  })

  it('two symbols asked in one tick are two requests, one each', async () => {
    armBatch((asks) => ({ results: asks.map(() => ok(1)) }))
    for (const s of ['NVDA', 'AAPL']) for (const a of ASKS) ensureColumns(a.defId, s, TF, a.inputs)
    await tick()
    expect(batchCalls.map((u) => new URL(u, 'http://x').searchParams.get('sym')).sort()).toEqual(['AAPL', 'NVDA'])
  })

  it('ONE definition is asked on the single route, exactly as before', async () => {
    armBatch((asks) => ({ results: asks.map(() => ok(1)) }))
    ensureColumns('defA', SYM, TF, { benchmark: 'SPY' })
    await tick()
    expect(batchCalls.length).toBe(0)
    expect(singleCalls).toEqual([serverColumnsKey('defA', SYM, TF, { benchmark: 'SPY' })])
    expect(cachedColumns('defA', SYM, TF, { benchmark: 'SPY' }).columns.a[0]).toBe(9)
  })

  it('an injected fetcher is honoured as a single ask (the door every existing test uses)', async () => {
    armBatch((asks) => ({ results: asks.map(() => ok(1)) }))
    const fetcher = vi.fn().mockResolvedValue(wire(5))
    for (const a of ASKS) ensureColumns(a.defId, SYM, TF, a.inputs, fetcher)
    await tick()
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(batchCalls.length).toBe(0)
  })
})

describe('what a batch does with each slot', () => {
  it('a refused ask is not cached and does not cost its neighbours', async () => {
    armBatch(() => ({ results: [{ status: 404, detail: 'not offered' }, ok(2), { status: 422, detail: 'bad enum' }] }))
    expect(await fetchColumnsBatch(SYM, TF, ASKS)).toBe(1)
    expect(cachedColumns('defA', SYM, TF, ASKS[0].inputs)).toBeNull()
    expect(cachedColumns('defB', SYM, TF, null).columns.a[0]).toBe(2)
    expect(cachedColumns('defC', SYM, TF, ASKS[2].inputs)).toBeNull()
    // a refused one is asked again by the next paint, like a failed single ask
    expect(hasColumns('defA', SYM, TF, ASKS[0].inputs)).toBe(false)
  })

  it('⛔ a body that is not one slot per ask answers NOTHING, and the chart falls back to single asks', async () => {
    for (const body of [{ results: [ok(1)] }, { results: 'nope' }, null, {}]) {
      clearServerColumns(); singleCalls.length = 0
      armBatch(() => body)
      const landed = await fetchColumnsBatch(SYM, TF, ASKS)
      expect(singleCalls.length, JSON.stringify(body)).toBe(3)
      expect(landed).toBe(3)
      expect(cachedColumns('defB', SYM, TF, null).columns.a[0]).toBe(9)
    }
  })

  it('a malformed envelope in one slot is skipped, never remembered', async () => {
    armBatch(() => ({ results: [ok(1), { status: 200, envelope: { times: [1], columns: { a: [{ time: 1, value: 2 }] } } }, ok(3)] }))
    expect(await fetchColumnsBatch(SYM, TF, ASKS)).toBe(2)
    expect(cachedColumns('defB', SYM, TF, null)).toBeNull()
  })

  it('asks already here, or already on their way, are left out; with nothing left there is no request', async () => {
    armBatch((asks) => ({ results: asks.map(() => ok(1)) }))
    primeServerColumns('defA', SYM, TF, ASKS[0].inputs, wire(7))
    const pending = fetchColumns('defB', SYM, TF, null, () => new Promise(() => {}))
    expect(pending).toBeTruthy()
    await fetchColumnsBatch(SYM, TF, ASKS)
    expect(asksOf(batchCalls[0]).map((a) => a.defId)).toEqual(['defC'])
    expect(cachedColumns('defA', SYM, TF, ASKS[0].inputs).columns.a[0]).toBe(7)   // the primed answer stands
    expect(await fetchColumnsBatch(SYM, TF, [ASKS[0], ASKS[2]])).toBe(0)
    expect(batchCalls.length).toBe(1)
  })
})

describe('a server without the route, and a request that fails', () => {
  it('⭐ "no such route" is remembered: single asks until BATCH_RETRY_MS has passed, then the batch is tried again', async () => {
    armBatch(() => httpError(404))
    expect(batchAvailable()).toBe(true)
    expect(await fetchColumnsBatch(SYM, TF, ASKS)).toBe(3)        // the chart still draws, through the single route
    expect(batchCalls.length).toBe(1)
    expect(singleCalls.length).toBe(3)
    expect(batchAvailable()).toBe(false)
    // the next symbol does not pay for a request that can only fail
    for (const a of ASKS) ensureColumns(a.defId, 'AAPL', TF, a.inputs)
    await tick()
    expect(batchCalls.length).toBe(1)
    expect(singleCalls.length).toBe(6)
    await vi.advanceTimersByTimeAsync(BATCH_RETRY_MS)
    expect(batchAvailable()).toBe(true)
    armBatch((asks) => ({ results: asks.map(() => ok(1)) }))
    for (const a of ASKS) ensureColumns(a.defId, 'MSFT', TF, a.inputs)
    await tick()
    expect(batchCalls.length, 'the batch is tried again').toBe(2)
    expect(singleCalls.length).toBe(6)
  })

  it('⭐ a server that answers the route with a PAGE (the catch-all of this app, a 200) is the same "no such route"', async () => {
    // production's own answer for an API path it does not route: 200, text/html, the app shell
    const page = { ok: true, status: 200, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
      json: async () => { throw new SyntaxError('Unexpected token <') } }
    const json = { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => wire(9) }
    const urls = []
    vi.stubGlobal('fetch', vi.fn(async (url) => { urls.push(String(url)); return String(url).includes(SERVER_COLUMNS_BATCH_PATH) ? page : json }))
    __setServerBatchFetcherForTests('default')
    for (const a of ASKS) ensureColumns(a.defId, SYM, TF, a.inputs)
    await tick(); await tick()
    // the chart still draws, through the single route…
    for (const a of ASKS) expect(cachedColumns(a.defId, SYM, TF, a.inputs)).not.toBeNull()
    expect(urls.filter((u) => u.includes(SERVER_COLUMNS_BATCH_PATH)).length).toBe(1)
    // …and the route is remembered as absent: the next symbol does not ask it again
    expect(batchAvailable()).toBe(false)
    for (const a of ASKS) ensureColumns(a.defId, 'AAPL', TF, a.inputs)
    await tick(); await tick()
    expect(urls.filter((u) => u.includes(SERVER_COLUMNS_BATCH_PATH)).length).toBe(1)
    expect(urls.length).toBe(1 + 3 + 3)
  })

  it('a JSON answer with no content-type header at all is still read (a host that sets none)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ results: ASKS.map(() => ok(4)) }) })))
    __setServerBatchFetcherForTests('default')
    expect(await fetchColumnsBatch(SYM, TF, ASKS)).toBe(3)
    expect(batchAvailable()).toBe(true)
  })

  it('any other failure falls back for THIS ask only: the route is not written off', async () => {
    armBatch(() => httpError(503))
    expect(await fetchColumnsBatch(SYM, TF, ASKS)).toBe(3)
    expect(singleCalls.length).toBe(3)
    expect(batchAvailable()).toBe(true)
  })

  it('a failed batch leaves nothing in flight behind it', async () => {
    armBatch(() => new Error('network'))
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await fetchColumnsBatch(SYM, TF, ASKS)).toBe(0)
    expect(serverColumnsCacheStats()).toMatchObject({ entries: 0, inflight: 0 })
    for (const a of ASKS) expect(hasColumns(a.defId, SYM, TF, a.inputs)).toBe(false)
  })
})

describe('a QUIET batch is a warm: nobody is looking at this symbol yet', () => {
  it('lands its entries and repaints NOTHING', async () => {
    armBatch((asks) => ({ results: asks.map((_, i) => ok(i + 1)) }))
    const seen = []
    const off = subscribe((k) => seen.push(k))
    expect(await fetchColumnsBatch(SYM, TF, ASKS, { quiet: true })).toBe(3)
    expect(seen).toEqual([])
    expect(cachedColumns('defC', SYM, TF, ASKS[2].inputs).columns.a[0]).toBe(3)
    off()
  })

  it('⭐ …but a key a paint asked for while the warm was on its way IS repainted when it lands', async () => {
    let release
    armBatch((asks) => new Promise((r) => { release = () => r({ results: asks.map(() => ok(1)) }) }))
    const seen = []
    const off = subscribe((k) => seen.push(k))
    const warm = fetchColumnsBatch(SYM, TF, ASKS, { quiet: true })
    await tick()
    // the member arrives early: the paint finds it in flight, starts nothing, and waits
    expect(ensureColumns('defB', SYM, TF, null)).toBeNull()
    await tick()
    expect(batchCalls.length + singleCalls.length).toBe(1)
    release()
    await warm
    expect(seen).toEqual([serverColumnsKey('defB', SYM, TF, null)])
    off()
  })

  it('⛔ never replaces an entry that landed while it was in flight (a primed answer is somebody else\'s)', async () => {
    let release
    armBatch((asks) => new Promise((r) => { release = () => r({ results: asks.map(() => ok(1)) }) }))
    const warm = fetchColumnsBatch(SYM, TF, ASKS, { quiet: true })
    await tick()
    primeServerColumns('defA', SYM, TF, ASKS[0].inputs, wire(42))
    release()
    expect(await warm).toBe(2)
    expect(cachedColumns('defA', SYM, TF, ASKS[0].inputs).columns.a[0]).toBe(42)
  })

  it('⛔ does not fall back to N single asks, and says the request failed', async () => {
    armBatch(() => httpError(503))
    expect(await fetchColumnsBatch(SYM, TF, ASKS, { quiet: true })).toBe(-1)
    expect(singleCalls.length).toBe(0)
    // …nor when the door is disarmed or the route is written off
    __setServerBatchFetcherForTests(null)
    expect(await fetchColumnsBatch(SYM, TF, ASKS, { quiet: true })).toBe(0)
    expect(singleCalls.length).toBe(0)
  })
})

describe('the asks charts are drawing', () => {
  const def = () => getDefinition('rsLine')
  const bars = (ts) => ts.map((t) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1 }))

  it('⭐ a paint notes its ask (definition, timeframe, inputs as SENT), per timeframe', () => {
    expect(liveAsks('D')).toEqual([])
    computeFor(def(), bars([1, 2]), { benchmark: 'QQQ', color: '#fff' }, { sym: SYM, tf: 'D', fetcher: () => new Promise(() => {}) })
    const asks = liveAsks('D')
    expect(asks.length).toBe(1)
    expect(asks[0].defId).toBe('rsLine')
    expect(asks[0].inputs.benchmark).toBe('QQQ')
    expect('color' in asks[0].inputs, 'a colour is the Style tab\'s and is never sent').toBe(false)
    expect(liveAsks('W')).toEqual([])
    // the SAME ask painted again is still one note; different inputs are a second
    computeFor(def(), bars([1, 2]), { benchmark: 'QQQ', color: '#000' }, { sym: 'AAPL', tf: 'D', fetcher: () => new Promise(() => {}) })
    expect(liveAsks('D').length).toBe(1)
    computeFor(def(), bars([1, 2]), { benchmark: 'SPY' }, { sym: SYM, tf: 'D', fetcher: () => new Promise(() => {}) })
    expect(liveAsks('D').length).toBe(2)
  })

  it('an ask no paint has made for ASK_TTL_MS is forgotten', async () => {
    serverColumnsFor(def(), bars([1]), { benchmark: 'SPY' }, { sym: SYM, tf: 'D', fetcher: () => new Promise(() => {}) })
    await vi.advanceTimersByTimeAsync(ASK_TTL_MS - 1)
    expect(liveAsks('D').length).toBe(1)
    await vi.advanceTimersByTimeAsync(2)
    expect(liveAsks('D')).toEqual([])
  })

  it('the list is capped at ASK_MAX, oldest dropped', () => {
    for (let i = 0; i < ASK_MAX + 5; i++) {
      serverColumnsFor(def(), bars([1]), { benchmark: 'SPY', maLength: 5 + i }, { sym: SYM, tf: 'D', fetcher: () => new Promise(() => {}) })
    }
    const asks = liveAsks('D')
    expect(asks.length).toBe(ASK_MAX)
    expect(asks[0].inputs.maLength).toBe(10)
    expect(asks[asks.length - 1].inputs.maLength).toBe(5 + ASK_MAX + 4)
  })
})

describe('the cache is bounded: the entry unused for longest goes first', () => {
  const big = (v) => ({ times: Array.from({ length: 50 }, (_, i) => i + 1), columns: { a: Array(50).fill(v) } })  // 100 cells

  it('⭐ drops the oldest unused entry once the bound is passed, and a READ counts as a use', () => {
    __setCacheMaxCellsForTests(350)                              // room for three
    for (const s of ['S1', 'S2', 'S3']) primeServerColumns('defA', s, TF, null, big(1))
    expect(serverColumnsCacheStats()).toMatchObject({ entries: 3, cells: 300 })
    expect(cachedColumns('defA', 'S1', TF, null)).not.toBeNull()   // S1 is now the youngest
    primeServerColumns('defA', 'S4', TF, null, big(1))
    expect(hasColumns('defA', 'S2', TF, null), 'the oldest UNUSED entry').toBe(false)
    expect(hasColumns('defA', 'S1', TF, null)).toBe(true)
    expect(hasColumns('defA', 'S3', TF, null)).toBe(true)
    expect(serverColumnsCacheStats()).toMatchObject({ entries: 3, cells: 300 })
  })

  it('`hasColumns` is NOT a use (a warmer asking "is it here" must not keep everything young)', () => {
    __setCacheMaxCellsForTests(350)
    for (const s of ['S1', 'S2', 'S3']) primeServerColumns('defA', s, TF, null, big(1))
    expect(hasColumns('defA', 'S1', TF, null)).toBe(true)
    primeServerColumns('defA', 'S4', TF, null, big(1))
    expect(hasColumns('defA', 'S1', TF, null)).toBe(false)
  })

  it('the entry being written is never the one dropped, however large', () => {
    __setCacheMaxCellsForTests(150)
    primeServerColumns('defA', 'S1', TF, null, big(1))
    primeServerColumns('defA', 'HUGE', TF, null, { times: Array.from({ length: 400 }, (_, i) => i), columns: { a: Array(400).fill(1) } })
    expect(hasColumns('defA', 'HUGE', TF, null)).toBe(true)
    expect(hasColumns('defA', 'S1', TF, null)).toBe(false)
  })

  it('replacing an entry does not count its cells twice', () => {
    __setCacheMaxCellsForTests(1000)
    for (let i = 0; i < 20; i++) primeServerColumns('defA', 'S1', TF, null, big(i))
    expect(serverColumnsCacheStats()).toMatchObject({ entries: 1, cells: 100 })
  })
})
