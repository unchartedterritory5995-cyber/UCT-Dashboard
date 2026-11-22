// app/src/components/chart/engine/__tests__/serverLaneProvisional.test.js
//
// ─── THE FIRST CHART OF A PAGE LOAD DRAWS WHAT THIS BROWSER LAST HAD ─────────
//
// Measured on production 2026-11-13: within a page load the RS suite draws with its
// candles (the rows ahead are asked for early), but the first chart of a page load, every
// pop-out window and a jump to a symbol nothing pre-loaded waited a server round trip.
// Landed envelopes are now also kept in this browser (`serverColumnsDisk.js`) and read
// back when a chart shows the symbol.
//
// ⛔ What is read back is PROVISIONAL: drawn, and asked for from the server exactly as if
// it were absent. These rails pin every way that ask can end.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  DEGRADED_RETRY_MS, DISK_IDLE_READ_MS, RAPID_MS,
  clearServerColumns, ensureColumns, cachedColumns, fetchColumns, fetchColumnsBatch, primeServerColumns,
  serverColumnsKey, serverColumnsFor, scalarsFor, serverColumnsCacheStats, subscribe, chartShows, chartGone, hasColumns,
  __setServerBatchFetcherForTests,
} from '../serverCompute'
import { DISK_OFF_KEY, flushDiskNow, memoryDiskBackend, __setDiskBackendForTests } from '../serverColumnsDisk'

const SYM = 'NVDA'
const TF = 'D'
const wire = (v, extra = {}) => ({ times: [20260102, 20260105, 20260106], columns: { a: [null, v, v + 1] }, payload: { state: 'ok', asOf: '2026-01-06' }, rev: 2, ...extra })
const DEGRADED = { times: [], columns: {}, payload: { state: 'no-bars' }, rev: 2 }
const ASKS = [{ defId: 'defA', inputs: { benchmark: 'SPY' } }, { defId: 'defB', inputs: null }]
const keyA = serverColumnsKey('defA', SYM, TF, { benchmark: 'SPY' })
const keyB = serverColumnsKey('defB', SYM, TF, null)
const asksOf = (url) => JSON.parse(new URL(url, 'http://x').searchParams.get('asks'))
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status })
/** let every pending promise chain and every due timer run */
const settle = async () => { for (let i = 0; i < 3; i++) { for (let k = 0; k < 12; k++) await Promise.resolve(); await vi.advanceTimersByTimeAsync(0) } }

let store, batchCalls, singleCalls, seen, unsub
/** arm the SINGLE route (a chart with one server definition uses it): respond(url) -> envelope, an Error, or a promise */
const armSingle = (respond) => vi.stubGlobal('fetch', vi.fn(async (url) => {
  singleCalls.push(String(url))
  const out = await respond(String(url))
  if (out instanceof Error) return { ok: false, status: out.status || 500, json: async () => ({}) }
  return { ok: true, status: 200, json: async () => out }
}))
/** arm the batch door: respond(asks) -> body, or an Error to fail the whole request */
const armBatch = (respond) => __setServerBatchFetcherForTests((url) => {
  batchCalls.push(asksOf(url).map((a) => a.defId))
  const out = respond(asksOf(url))
  return out instanceof Error ? Promise.reject(out) : Promise.resolve(out)
})
const answers = (v) => (asks) => ({ results: asks.map(() => ({ status: 200, envelope: wire(v) })) })

/** One page load that sees the symbol with value `v` on the server, then goes away. */
async function earlierPageLoad(v = 5) {
  armBatch(answers(v))
  for (const a of ASKS) ensureColumns(a.defId, SYM, TF, a.inputs)
  await settle()
  await flushDiskNow()
  await settle()
  expect(store.rows.size, 'the earlier page load wrote both entries').toBe(2)
  newPageLoad()
}
/** A new page load: nothing in memory, the same browser store. */
function newPageLoad() {
  clearServerColumns()
  batchCalls.length = 0
  singleCalls.length = 0
  seen.length = 0
}

beforeEach(() => {
  vi.useFakeTimers()
  clearServerColumns()
  store = memoryDiskBackend()
  __setDiskBackendForTests(store)
  batchCalls = []
  singleCalls = []
  seen = []
  unsub = subscribe((k) => seen.push(k))
  armSingle(() => new Promise(() => {}))                 // unless a test says otherwise, the single route never answers
  try { localStorage.removeItem(DISK_OFF_KEY) } catch { /* no storage */ }
})
afterEach(() => {
  unsub()
  __setServerBatchFetcherForTests(null)
  __setDiskBackendForTests(null)
  clearServerColumns()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  try { localStorage.removeItem(DISK_OFF_KEY) } catch { /* no storage */ }
})

describe('what lands is kept for the next page load', () => {
  it('a chart\'s own answers, a single ask and a quiet pre-load are all written; a failure and a "cannot compute yet" are not', async () => {
    armBatch(answers(5))
    for (const a of ASKS) ensureColumns(a.defId, SYM, TF, a.inputs)                 // a chart's own batch
    await fetchColumns('defC', SYM, TF, null, async () => wire(7))                  // a single ask
    await fetchColumnsBatch('AAPL', TF, [{ defId: 'defA', inputs: null }], { quiet: true })   // a pre-load
    await fetchColumns('defD', SYM, TF, null, async () => { throw httpError(500) })
    await fetchColumns('defE', SYM, TF, null, async () => DEGRADED)
    // "cannot compute yet" is not kept even when the envelope carries columns
    await fetchColumns('defF', SYM, TF, null, async () => wire(3, { payload: { state: 'no-benchmark-bars' } }))
    await fetchColumns('defG', SYM, TF, null, async () => wire(3, { error: 'compute failed' }))
    await settle()
    expect(store.rows.size, 'written when idle, never inside the landing').toBe(0)
    await flushDiskNow()
    expect([...store.rows.keys()].sort()).toEqual([keyA, keyB, serverColumnsKey('defC', SYM, TF, null), serverColumnsKey('defA', 'AAPL', TF, null)].sort())
  })
})

describe('⭐ a chart that shows a symbol draws what this browser last had, at once', () => {
  it('the entries are readable before any server answer, and a paint is told', async () => {
    await earlierPageLoad(5)
    armBatch(() => new Promise(() => {}))                                           // a server that has not answered yet
    chartShows({}, SYM, TF)
    await settle()
    expect(cachedColumns('defA', SYM, TF, { benchmark: 'SPY' }).columns.a[1]).toBe(5)
    expect(cachedColumns('defB', SYM, TF, null).columns.a[2]).toBe(6)
    expect(serverColumnsCacheStats().provisional).toBe(2)
    expect(seen.sort()).toEqual([keyA, keyB].sort())
    expect(batchCalls, 'reading the store asks the server for nothing by itself').toEqual([])
  })

  it('a paint that misses reads the store too (a host that never says what it shows)', async () => {
    await earlierPageLoad(5)
    armBatch(() => new Promise(() => {}))
    expect(ensureColumns('defA', SYM, TF, { benchmark: 'SPY' })).toBeNull()
    await settle()
    expect(cachedColumns('defA', SYM, TF, { benchmark: 'SPY' }).columns.a[1]).toBe(5)
    expect(serverColumnsCacheStats().provisional).toBe(2)
  })

  it('the store is read once per symbol and timeframe per page load', async () => {
    await earlierPageLoad(5)
    const read = vi.spyOn(store, 'read')
    armBatch(() => new Promise(() => {}))
    const slot = {}
    chartShows(slot, SYM, TF)
    ensureColumns('defA', SYM, TF, { benchmark: 'SPY' })
    ensureColumns('defZ', SYM, TF, null)
    await settle()
    chartShows(slot, 'AAPL', TF)
    await vi.advanceTimersByTimeAsync(RAPID_MS + 1)
    chartShows(slot, SYM, TF)
    await vi.advanceTimersByTimeAsync(RAPID_MS + 1)
    await settle()
    expect(read.mock.calls.map((c) => c[0])).toEqual([`${SYM}|${TF}`, `AAPL|${TF}`])
  })

  it('an answer the server already gave is never replaced by the store', async () => {
    await earlierPageLoad(5)
    let release
    store.read = () => new Promise((r) => { release = r })                           // a slow disk
    armBatch(answers(8))
    for (const a of ASKS) ensureColumns(a.defId, SYM, TF, a.inputs)
    await settle()
    expect(cachedColumns('defA', SYM, TF, { benchmark: 'SPY' }).columns.a[1]).toBe(8)
    release([{ key: keyA, symtf: `${SYM}|${TF}`, savedAt: Date.now(), cells: 6, logic: 1, rev: 2, times: Float64Array.from([20260102, 20260105, 20260106]), columns: { a: Float64Array.from([NaN, 5, 6]) } }])
    await settle()
    expect(cachedColumns('defA', SYM, TF, { benchmark: 'SPY' }).columns.a[1]).toBe(8)
    expect(serverColumnsCacheStats().provisional).toBe(0)
  })
})

describe('⛔ what the store gave is asked for exactly as if it were absent', () => {
  const hydrate = async () => { chartShows({}, SYM, TF); await settle(); seen.length = 0 }

  it('a paint is handed the entry AND the ask goes out, once', async () => {
    await earlierPageLoad(5)
    armBatch(() => new Promise(() => {}))
    await hydrate()
    expect(ensureColumns('defA', SYM, TF, { benchmark: 'SPY' }).columns.a[1]).toBe(5)
    expect(ensureColumns('defB', SYM, TF, null).columns.a[1]).toBe(5)
    await settle()
    expect(batchCalls).toEqual([['defA', 'defB']])
    ensureColumns('defA', SYM, TF, { benchmark: 'SPY' })                            // a second paint while it is on its way
    await settle()
    expect(batchCalls.length).toBe(1)
  })

  it('⭐ the server gives the same answer: nothing repaints, the entry is the same object, and it is asked for no more', async () => {
    await earlierPageLoad(5)
    armBatch(answers(5))
    await hydrate()
    const drawn = ensureColumns('defA', SYM, TF, { benchmark: 'SPY' })
    ensureColumns('defB', SYM, TF, null)
    await settle()
    expect(seen, 'a confirmed entry is not a reason to repaint').toEqual([])
    expect(serverColumnsCacheStats().provisional).toBe(0)
    expect(ensureColumns('defA', SYM, TF, { benchmark: 'SPY' })).toBe(drawn)
    await settle()
    expect(batchCalls.length, 'confirmed: an ordinary cached entry now').toBe(1)
  })

  it('⭐ the server gives a different answer: it replaces the entry, repaints, and is what the next page load reads', async () => {
    await earlierPageLoad(5)
    armBatch(answers(6))
    await hydrate()
    ensureColumns('defA', SYM, TF, { benchmark: 'SPY' })
    ensureColumns('defB', SYM, TF, null)
    await settle()
    expect(seen.sort()).toEqual([keyA, keyB].sort())
    expect(cachedColumns('defA', SYM, TF, { benchmark: 'SPY' }).columns.a[1]).toBe(6)
    expect(serverColumnsCacheStats().provisional).toBe(0)
    await flushDiskNow()
    expect(store.rows.get(keyA).columns.a[1]).toBe(6)
  })

  it('any one difference is a different answer: a cell, a gap, a time, a scalar, the revision, a column', async () => {
    const variants = [
      { columns: { a: [null, 5, 6.0000001] } },
      { columns: { a: [1, 5, 6] } },                                                // a gap that became a value
      { columns: { a: [null, null, 6] } },                                          // a value that became a gap
      { times: [20260102, 20260105, 20260107] },
      { payload: { state: 'ok', asOf: '2026-01-07' } },
      { rev: 3 },
      { columns: { a: [null, 5, 6], b: [1, 2, 3] } },
      { times: [20260102, 20260105], columns: { a: [null, 5] } },
    ]
    for (const v of variants) {
      store.rows.clear()
      await earlierPageLoad(5)
      armBatch((asks) => ({ results: asks.map(() => ({ status: 200, envelope: wire(5, v) })) }))
      await hydrate()
      ensureColumns('defA', SYM, TF, { benchmark: 'SPY' })
      ensureColumns('defB', SYM, TF, null)
      await settle()
      expect(seen, JSON.stringify(v)).toContain(keyA)
      newPageLoad()
    }
  })

  it('a single ask (no batch door) confirms and replaces the same way', async () => {
    await earlierPageLoad(5)
    __setServerBatchFetcherForTests(null)
    await hydrate()
    const drawn = cachedColumns('defA', SYM, TF, { benchmark: 'SPY' })
    expect(await fetchColumns('defA', SYM, TF, { benchmark: 'SPY' }, async () => wire(5))).toBe(drawn)
    expect(seen).toEqual([])
    expect(await fetchColumns('defB', SYM, TF, null, async () => wire(7))).not.toBe(drawn)
    expect(seen).toEqual([keyB])
    expect(serverColumnsCacheStats().provisional).toBe(0)
  })

  it('⛔ the server REFUSES the ask: the entry is gone from the chart and from the store', async () => {
    for (const status of [401, 403, 404, 422]) {
      store.rows.clear()
      await earlierPageLoad(5)
      armBatch((asks) => ({ results: asks.map((a) => (a.defId === 'defA' ? { status, detail: 'no' } : { status: 200, envelope: wire(5) })) }))
      await hydrate()
      ensureColumns('defA', SYM, TF, { benchmark: 'SPY' })
      ensureColumns('defB', SYM, TF, null)
      await settle()
      expect(cachedColumns('defA', SYM, TF, { benchmark: 'SPY' }), `status ${status}`).toBeNull()
      expect(seen, 'the chart is told, so it stops drawing it').toContain(keyA)
      expect(store.rows.has(keyA)).toBe(false)
      expect(store.rows.has(keyB), 'the ask beside it is untouched').toBe(true)
      newPageLoad()
    }
  })

  it('⛔ a refused single ask does the same, and so does a batch refused as a whole', async () => {
    await earlierPageLoad(5)
    await hydrate()
    await fetchColumns('defA', SYM, TF, { benchmark: 'SPY' }, async () => { throw httpError(403) })
    expect(cachedColumns('defA', SYM, TF, { benchmark: 'SPY' })).toBeNull()
    expect(store.rows.has(keyA)).toBe(false)
    expect(seen).toEqual([keyA])
    // the whole batch refused -> the single route is asked, and it refuses too
    primeServerColumns('defA', SYM, TF, { benchmark: 'SPY' }, wire(1))               // so two asks go out together
    store.rows.set(keyA, { ...store.rows.get(keyB), key: keyA })
    newPageLoad()
    await hydrate()
    armSingle(() => httpError(403))
    armBatch(() => httpError(403))
    ensureColumns('defA', SYM, TF, { benchmark: 'SPY' })
    ensureColumns('defB', SYM, TF, null)
    await settle()
    expect(batchCalls.length, 'the batch was tried first').toBe(1)
    expect(singleCalls.length, 'then each ask on the single route').toBe(2)
    expect(cachedColumns('defA', SYM, TF, { benchmark: 'SPY' })).toBeNull()
    expect(cachedColumns('defB', SYM, TF, null)).toBeNull()
    expect(store.rows.has(keyB)).toBe(false)
  })

  it('a server that does not answer leaves the entry drawn and unconfirmed; the next paint asks again', async () => {
    for (const failure of [httpError(500), httpError(502), httpError(429), httpError(408), new Error('network')]) {
      store.rows.clear()
      await earlierPageLoad(5)
      __setServerBatchFetcherForTests(null)
      await hydrate()
      const got = await fetchColumns('defA', SYM, TF, { benchmark: 'SPY' }, async () => { throw failure })
      expect(got && got.columns.a[1], String(failure.message)).toBe(5)
      expect(seen, 'nothing changed on screen').toEqual([])
      expect(serverColumnsCacheStats().provisional).toBe(2)
      expect(store.rows.has(keyA)).toBe(true)
      let asked = 0
      ensureColumns('defA', SYM, TF, { benchmark: 'SPY' }, async () => { asked += 1; return wire(5) })
      await settle()
      expect(asked).toBe(1)
      newPageLoad()
    }
  })

  it('a slot that failed without refusing, and one that is malformed, leave the entry drawn', async () => {
    await earlierPageLoad(5)
    armBatch((asks) => ({ results: asks.map((a) => (a.defId === 'defA' ? { status: 500 } : { status: 200, envelope: { columns: { a: [{ time: 1, value: 2 }] } } })) }))
    await hydrate()
    ensureColumns('defA', SYM, TF, { benchmark: 'SPY' })
    ensureColumns('defB', SYM, TF, null)
    await settle()
    expect(cachedColumns('defA', SYM, TF, { benchmark: 'SPY' }).columns.a[1]).toBe(5)
    expect(cachedColumns('defB', SYM, TF, null).columns.a[1]).toBe(5)
    expect(seen).toEqual([])
    expect(serverColumnsCacheStats().provisional).toBe(2)
  })
})

describe('the server cannot compute it yet', () => {
  it('⭐ the entry stays drawn through the lane\'s own back-off, is re-asked when each is due, then the server\'s answer stands', async () => {
    await earlierPageLoad(5)
    let degraded = 0
    armSingle(() => { degraded += 1; return DEGRADED })   // one definition on the chart: the single route
    chartShows({}, SYM, TF)
    await settle()
    seen.length = 0
    const paint = () => ensureColumns('defA', SYM, TF, { benchmark: 'SPY' })
    for (let i = 0; i < DEGRADED_RETRY_MS.length; i++) {
      expect(paint().columns.a[1], `try ${i}: still drawn`).toBe(5)
      await settle()
      expect(degraded).toBe(i + 1)
      expect(seen, 'kept on screen: nothing to repaint').toEqual([])
      paint(); paint()                                                              // paints during the back-off ask for nothing
      await settle()
      expect(degraded).toBe(i + 1)
      await vi.advanceTimersByTimeAsync(DEGRADED_RETRY_MS[i] - 1)
      expect(seen).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      expect(seen, 'a paint is forced when the next try is due').toEqual([keyA])
      seen.length = 0
    }
    expect(paint().columns.a[1]).toBe(5)                                            // the last try
    await settle()
    expect(degraded).toBe(DEGRADED_RETRY_MS.length + 1)
    expect(seen).toEqual([keyA])
    expect(cachedColumns('defA', SYM, TF, { benchmark: 'SPY' }).columns, 'the server\'s blank answer now stands').toEqual({})
    expect(serverColumnsCacheStats().provisional).toBe(1)                           // defB was never asked for here
    await flushDiskNow()
    expect(store.rows.has(keyA), 'and what the browser had is not kept').toBe(false)
  })

  it('a real answer during the back-off ends it', async () => {
    await earlierPageLoad(5)
    let n = 0
    armSingle(() => { n += 1; return n === 1 ? DEGRADED : wire(6) })
    chartShows({}, SYM, TF)
    await settle()
    ensureColumns('defA', SYM, TF, { benchmark: 'SPY' })
    await settle()
    await vi.advanceTimersByTimeAsync(DEGRADED_RETRY_MS[0])
    ensureColumns('defA', SYM, TF, { benchmark: 'SPY' })
    await settle()
    expect(cachedColumns('defA', SYM, TF, { benchmark: 'SPY' }).columns.a[1]).toBe(6)
    seen.length = 0
    await vi.advanceTimersByTimeAsync(DEGRADED_RETRY_MS[2] * 2)
    expect(seen, 'no back-off timer is left behind').toEqual([])
  })
})

describe('⛔ a record from another server revision is never drawn', () => {
  const def = (rev) => ({ id: 'defA', kind: 'overlay', compute: { kind: 'server', rev }, plots: [{ key: 'a', type: 'line' }], meta: {} })
  const bars = [{ t: '2026-01-02' }, { t: '2026-01-05' }, { t: '2026-01-06' }]
  const ctx = { sym: SYM, tf: TF }

  it('the columns and the scalars of a provisional entry on another rev are withheld, and the ask still goes', async () => {
    await earlierPageLoad(5)                                                        // written at rev 2
    armBatch(() => new Promise(() => {}))
    chartShows({}, SYM, TF)
    await settle()
    expect(serverColumnsFor(def(3), bars, { benchmark: 'SPY' }, ctx), 'rev 3 client, rev 2 record').toEqual({})
    expect(scalarsFor(def(3), { benchmark: 'SPY' }, ctx)).toBeNull()
    await settle()
    expect(singleCalls.length, 'asked for, although nothing of it is drawn').toBe(1)
    // the same record under the revision it was written for is drawn
    expect(Array.from(serverColumnsFor(def(2), bars, { benchmark: 'SPY' }, ctx).a).slice(1)).toEqual([5, 6])
    expect(scalarsFor(def(2), { benchmark: 'SPY' }, ctx)).toEqual({ state: 'ok', asOf: '2026-01-06' })
  })

  it('CONTROL: a SERVER answer on another rev is still drawn (the rule the lane already had)', async () => {
    armSingle(() => wire(5))
    serverColumnsFor(def(3), bars, { benchmark: 'SPY' }, ctx)
    await settle()
    expect(Array.from(serverColumnsFor(def(3), bars, { benchmark: 'SPY' }, ctx).a).slice(1)).toEqual([5, 6])
  })
})

describe('restraint', () => {
  it('⭐ a chart racing through symbols reads nothing until it stops', async () => {
    await earlierPageLoad(5)
    const read = vi.spyOn(store, 'read')
    armBatch(() => new Promise(() => {}))
    const slot = {}
    chartShows(slot, 'AAA', TF)
    await settle()
    read.mockClear()
    for (const s of ['BBB', 'CCC', 'DDD', SYM]) { await vi.advanceTimersByTimeAsync(60); chartShows(slot, s, TF) }
    await settle()
    expect(read.mock.calls.length, 'nothing while it is racing').toBe(0)
    await vi.advanceTimersByTimeAsync(RAPID_MS)
    await settle()
    expect(read.mock.calls.map((c) => c[0]), 'only the one it stopped on').toEqual([`${SYM}|${TF}`])
    expect(serverColumnsCacheStats().provisional).toBe(2)
  })

  it('a chart that went away before the hold ended reads nothing', async () => {
    await earlierPageLoad(5)
    const read = vi.spyOn(store, 'read')
    const slot = {}
    chartShows(slot, 'AAA', TF)
    await settle()
    read.mockClear()
    await vi.advanceTimersByTimeAsync(60)
    chartShows(slot, SYM, TF)
    chartGone(slot)
    await vi.advanceTimersByTimeAsync(RAPID_MS * 2)
    await settle()
    expect(read.mock.calls.length).toBe(0)
  })

  it('a page that draws no server-lane definition stops reading the store on a symbol change', async () => {
    const read = vi.spyOn(store, 'read')
    const slot = {}
    chartShows(slot, 'AAA', TF)
    await settle()
    expect(read.mock.calls.length, 'early in a page load it looks: the first chart may need it').toBe(1)
    await vi.advanceTimersByTimeAsync(DISK_IDLE_READ_MS + 1)
    chartShows(slot, 'BBB', TF)
    await settle()
    expect(read.mock.calls.length).toBe(1)
    // once any paint has asked the lane for something, every shown symbol is looked up
    ensureColumns('defA', 'CCC', TF, null, () => new Promise(() => {}))
    await settle()
    expect(read.mock.calls.length).toBe(2)
    serverColumnsFor({ id: 'defA', compute: { kind: 'server' }, plots: [], meta: {} }, [{ t: '2026-01-02' }], {}, { sym: 'CCC', tf: TF, fetcher: () => new Promise(() => {}) })
    await vi.advanceTimersByTimeAsync(RAPID_MS + 1)        // a resting chart, not a racing one
    chartShows(slot, 'DDD', TF)
    await settle()
    expect(read.mock.calls.map((c) => c[0]).pop()).toBe(`DDD|${TF}`)
  })

  it('switched off in this browser: nothing is read, nothing is written', async () => {
    await earlierPageLoad(5)
    localStorage.setItem(DISK_OFF_KEY, '1')
    armBatch(answers(8))
    chartShows({}, SYM, TF)
    await settle()
    expect(serverColumnsCacheStats().provisional).toBe(0)
    expect(cachedColumns('defA', SYM, TF, { benchmark: 'SPY' })).toBeNull()
    await fetchColumnsBatch('AAPL', TF, [{ defId: 'defA', inputs: null }])
    await flushDiskNow()
    expect(store.rows.size).toBe(2)
  })
})

describe('the other doors', () => {
  const hydrate = async () => { chartShows({}, SYM, TF); await settle(); seen.length = 0 }

  it('a quiet pre-load answer replaces a provisional entry, and repaints only if a paint was shown it', async () => {
    await earlierPageLoad(5)
    armBatch(answers(6))
    await hydrate()
    ensureColumns('defA', SYM, TF, { benchmark: 'SPY' }, () => new Promise(() => {}))   // a paint was handed defA (its own ask never lands)
    expect(hasColumns('defB', SYM, TF, null), 'to a pre-load a provisional entry is "already here"').toBe(true)
    await fetchColumnsBatch(SYM, TF, [{ defId: 'defB', inputs: null }], { quiet: true })
    expect(cachedColumns('defB', SYM, TF, null).columns.a[1]).toBe(6)
    expect(seen, 'no paint asked for defB').toEqual([])
    expect(serverColumnsCacheStats().provisional).toBe(1)
  })

  it('a quiet pre-load still never replaces an answer the server already gave', async () => {
    armBatch(answers(5))
    await fetchColumnsBatch(SYM, TF, ASKS)
    armBatch(answers(6))
    await fetchColumnsBatch(SYM, TF, ASKS, { quiet: true })
    expect(batchCalls.length, 'nothing left to ask for').toBe(1)
    expect(cachedColumns('defA', SYM, TF, { benchmark: 'SPY' }).columns.a[1]).toBe(5)
  })

  it('a primed answer over a provisional entry is final', async () => {
    await earlierPageLoad(5)
    armBatch(answers(6))
    await hydrate()
    primeServerColumns('defA', SYM, TF, { benchmark: 'SPY' }, wire(7))
    expect(serverColumnsCacheStats().provisional).toBe(1)
    ensureColumns('defA', SYM, TF, { benchmark: 'SPY' })
    await settle()
    expect(batchCalls, 'a primed entry is not asked for').toEqual([])
    expect(cachedColumns('defA', SYM, TF, { benchmark: 'SPY' }).columns.a[1]).toBe(7)
  })

  it('a store that fails is the lane without a store', async () => {
    __setDiskBackendForTests({ read: () => Promise.reject(new Error('x')), write: () => Promise.reject(new Error('x')), remove: () => Promise.reject(new Error('x')), sizes: () => Promise.reject(new Error('x')) })
    armBatch(answers(5))
    chartShows({}, SYM, TF)
    for (const a of ASKS) ensureColumns(a.defId, SYM, TF, a.inputs)
    await settle()
    await flushDiskNow()
    expect(cachedColumns('defA', SYM, TF, { benchmark: 'SPY' }).columns.a[1]).toBe(5)
    expect(seen.sort()).toEqual([keyA, keyB].sort())
    expect(serverColumnsCacheStats().provisional).toBe(0)
  })
})
