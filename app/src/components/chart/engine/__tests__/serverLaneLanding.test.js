// app/src/components/chart/engine/__tests__/serverLaneLanding.test.js
//
// ─── THE CHART A MEMBER STOPS ON ─────────────────────────────────────────────
//
// Measured on production 2026-11-13 with a candidate build (the arrow key held through 40
// charts of an unopened list, released; the browser store off): with the readers' rest gate
// on, only ONE request was still open when the key was released (33 without it), and the
// landing chart still drew its RS lines 3.5 s after its candles. Its own request left
// 720 ms after the key and took 3.0 s, because three others had left 100 ms BEFORE it:
//
//     ARM@W   620..2284   the weekly pre-load for the symbol on screen
//     APP@D   621..3664   a row ahead
//     MRNA@D  621..3676   a row ahead
//     ARM@D   720..3679   the chart's own ask, last and slowest
//
// The pre-load yields while a chart is flying and while a chart's own ask is OUT. Between
// the two there was a gap: the chart had stopped flying (0.35 s at that server speed) and
// its own ask was still HELD (0.49 s, 1.3 x its slower step). The pre-load resumed in it.
//
// And for a symbol this browser has seen before, nothing needs the server at all: the rows
// ahead are read from the browser's store when they are announced, so the first paint has
// them. They used to be read when the chart arrived (0.1 to 0.2 s after its candles), and
// after the hold on a landing.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  SETTLE_FACTOR, SETTLE_MAX_MS,
  clearServerColumns, ensureColumns, cachedColumns, fetchColumnsBatch, serverColumnsFor,
  chartShows, chartsNeedTheLane, flyingMs, readAhead, serverColumnsCacheStats, __setServerBatchFetcherForTests,
} from '../serverCompute'
import { warmSymbols, __resetServerWarm, YIELD_MS } from '../serverWarm'
import { DISK_OFF_KEY, flushDiskNow, memoryDiskBackend, __setDiskBackendForTests } from '../serverColumnsDisk'

const TF = 'D'
const wire = (v) => ({ times: [20260102, 20260105], columns: { a: [v, v + 1] }, payload: { state: 'ok' } })
const symOf = (url) => new URL(url, 'http://x').searchParams.get('sym')
const tfOf = (url) => new URL(url, 'http://x').searchParams.get('tf')
const tick = async (ms = 0) => { for (let k = 0; k < 8; k++) await Promise.resolve(); await vi.advanceTimersByTimeAsync(ms); for (let k = 0; k < 8; k++) await Promise.resolve() }
const settle = async () => { for (let i = 0; i < 3; i++) await tick(0) }
const never = () => new Promise(() => {})
const def = (id) => ({ id, compute: { kind: 'server' }, plots: [], meta: {} })

let sent, store
/** the batch route answers every request after `ms` (a number, or (sym) => number | null for "never") */
const server = (ms) => __setServerBatchFetcherForTests((url) => {
  const sym = symOf(url)
  sent.push(tfOf(url) === TF ? sym : `${sym}@${tfOf(url)}`)
  const took = typeof ms === 'function' ? ms(sym) : ms
  if (took === null) return never()
  return new Promise((resolve) => setTimeout(() => {
    resolve({ results: JSON.parse(new URL(url, 'http://x').searchParams.get('asks')).map(() => ({ status: 200, envelope: wire(1) })) })
  }, took))
})
/** the chart on `slot` paints `sym`: two definitions, so its ask goes through the batch door */
const paint = (slot, sym, tf = TF) => {
  chartShows(slot, sym, tf)
  ensureColumns('defA', sym, tf, { benchmark: 'SPY' })
  ensureColumns('defB', sym, tf, null)
}
/** a chart somewhere is drawing these two definitions at `tf` (what a pre-load replays) */
const drawing = (tf = TF) => {
  serverColumnsFor(def('defA'), [{ t: '2026-01-02' }], { benchmark: 'SPY' }, { sym: 'SPY', tf, fetcher: never })
  serverColumnsFor(def('defB'), [{ t: '2026-01-02' }], null, { sym: 'SPY', tf, fetcher: never })
}
/** one answered request that took `ms`, so the lane knows how long the server is taking */
const timeTheLane = async (ms) => {
  server(ms)
  const p = fetchColumnsBatch(`T${ms}`, TF, [{ defId: 'defA', inputs: null }], { quiet: true })
  await tick(ms)
  await p
}
const rows = () => sent.filter((s) => s[0] === 'R')

beforeEach(() => {
  vi.useFakeTimers()
  clearServerColumns()
  __resetServerWarm({ painted: true })
  store = memoryDiskBackend()
  __setDiskBackendForTests(store)
  sent = []
  try { localStorage.removeItem('uct.indwarm.off'); localStorage.removeItem('uct.rslane.tfs'); localStorage.removeItem(DISK_OFF_KEY); localStorage.setItem('barspack.version', 'x') } catch { /* */ }
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in this suite') }))
})
afterEach(() => {
  __setServerBatchFetcherForTests(null)
  __setDiskBackendForTests(null)
  clearServerColumns()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('⭐ a chart whose own ask is being HELD still comes first', () => {
  /** the production landing: a server taking 1.4 s (flying under 350 ms a step), steps of 300 then 380 ms */
  const land = async (slot) => {
    drawing()
    await timeTheLane(1400)
    expect(flyingMs()).toBe(350)
    sent.length = 0
    chartShows(slot, 'S0', TF)
    await tick(300); chartShows(slot, 'S1', TF)
    await tick(380); paint(slot, 'S2')                 // racing (pace 300 is under 350): its ask is held 1.3 x 380 ms
    await tick()
    expect(380 * SETTLE_FACTOR).toBeLessThan(SETTLE_MAX_MS)
    expect(sent, 'held, not sent').toEqual([])
  }

  it('the pre-load starts nothing between "no longer flying" and the held ask leaving', async () => {
    const slot = {}
    await land(slot)
    server((sym) => (sym === 'S2' ? 200 : null))
    await tick(400)                                    // past the 350 ms the chart counted as flying; the hold ends at 494
    expect(chartsNeedTheLane(), 'an ask is waiting to leave').toBe(true)
    warmSymbols(['R1', 'R2'], TF, { priority: true })  // the rows ahead, announced at the landing
    await tick()
    expect(rows(), 'nothing for the rows ahead yet').toEqual([])
    await tick(100)
    expect(sent, 'the hold ended: the chart\'s own ask left, alone').toEqual(['S2'])
    await tick(200 + YIELD_MS + 20)                    // it landed, and the pre-load looked again
    expect(rows().sort()).toEqual(['R1', 'R2'])
    expect(sent[0]).toBe('S2')
  })

  it('a held ask that is dropped (the chart moved on) does not keep the pre-load waiting', async () => {
    const slot = {}
    await land(slot)
    server(null)
    await tick(100)
    chartShows(slot, 'S3', TF)                         // the member moved on; S3 draws nothing from the server yet
    await tick(SETTLE_MAX_MS + 400)                    // S2's hold ended with nobody on it, and S3 has rested
    expect(sent, 'S2 was never asked for').toEqual([])
    expect(chartsNeedTheLane()).toBe(false)
    warmSymbols(['R1'], TF, { priority: true })
    await tick()
    expect(rows()).toEqual(['R1'])
  })

  it('CONTROL: with nothing held and nothing out, the rows ahead are asked for at once', async () => {
    drawing()
    server(null)
    expect(chartsNeedTheLane()).toBe(false)
    warmSymbols(['R1', 'R2'], TF, { priority: true })
    await tick()
    expect(rows().sort()).toEqual(['R1', 'R2'])
  })
})

describe('⭐ the rows ahead are read from this browser\'s store before the member arrives', () => {
  /** what memory holds for defA on `sym` (no request, no use) */
  const held = (sym, tf = TF) => cachedColumns('defA', sym, tf, { benchmark: 'SPY' })

  /** an earlier page load saw these symbols; this page load has nothing in memory */
  const seenBefore = async (syms, tf = TF) => {
    server(0)
    for (const sym of syms) { ensureColumns('defA', sym, tf, { benchmark: 'SPY' }); ensureColumns('defB', sym, tf, null) }
    await settle()
    await flushDiskNow()
    await settle()
    expect(store.rows.size).toBe(syms.length * 2)
    clearServerColumns()
    __resetServerWarm({ painted: true })
    sent.length = 0
  }

  it('a row announced as near is in memory before any chart shows it: the first paint has it', async () => {
    await seenBefore(['NVDA', 'AAPL'])
    drawing()
    server(null)                                       // the server never answers: only the store can
    warmSymbols(['NVDA', 'AAPL'], TF, { priority: true })
    await settle()
    expect(held('NVDA'), 'read ahead, with no chart on it').toBeTruthy()
    expect(held('AAPL')).toBeTruthy()
    expect(serverColumnsCacheStats().provisional, 'and held as this browser\'s copy, to be checked').toBe(4)
    const slot = {}
    chartShows(slot, 'NVDA', TF)
    expect(ensureColumns('defA', 'NVDA', TF, { benchmark: 'SPY' }), 'the first paint draws it').toBeTruthy()
  })

  it('it is read while the member is racing, too: the store costs the server nothing', async () => {
    await seenBefore(['NVDA'])
    drawing()
    server(null)
    const slot = {}
    chartShows(slot, 'X0', TF)
    await tick(60); chartShows(slot, 'X1', TF)
    await tick(60); chartShows(slot, 'X2', TF)
    expect(chartsNeedTheLane(), 'flying').toBe(true)
    warmSymbols(['NVDA'], TF, { priority: true })
    await settle()
    expect(rows().length + sent.filter((s) => s === 'NVDA').length, 'no request while flying').toBe(0)
    expect(held('NVDA')).toBeTruthy()
  })

  it('the symbol on screen has a timeframe it uses read ahead the same way', async () => {
    await seenBefore(['NVDA'], 'W')
    localStorage.setItem('uct.rslane.tfs', JSON.stringify({ W: Date.now() }))
    clearServerColumns()
    drawing('D')
    server(null)
    warmSymbols(['NVDA'], 'W', {})                     // the watchlist's own announcement once a selection rests
    await settle()
    expect(held('NVDA', 'W')).toBeTruthy()
  })

  it('⛔ a whole list opening reads nothing ahead: only the rows a member is about to reach', async () => {
    const syms = Array.from({ length: 40 }, (_, i) => `L${i}`)
    await seenBefore(syms.slice(0, 3))
    drawing()
    server(null)
    warmSymbols(syms, TF, {})
    warmSymbols(syms, TF, { visible: true })
    await settle()
    expect(held('L0')).toBeFalsy()
    expect(serverColumnsCacheStats().provisional).toBe(0)
  })

  it('⛔ a page that draws no server definition reads nothing', async () => {
    await seenBefore(['NVDA'])
    readAhead('NVDA', TF)
    warmSymbols(['NVDA'], TF, { priority: true })
    await settle()
    expect(serverColumnsCacheStats().provisional).toBe(0)
  })

  it('⛔ the pre-load\'s switch turns the read-ahead off with the rest of it', async () => {
    await seenBefore(['NVDA'])
    drawing()
    localStorage.setItem('uct.indwarm.off', '1')
    warmSymbols(['NVDA'], TF, { priority: true })
    await settle()
    expect(serverColumnsCacheStats().provisional).toBe(0)
  })

  it('a symbol is read once per page load, however often it is announced', async () => {
    await seenBefore(['NVDA'])
    drawing()
    server(null)
    const reads = vi.spyOn(store, 'read')
    for (let i = 0; i < 5; i++) warmSymbols(['NVDA'], TF, { priority: true })
    await settle()
    expect(reads.mock.calls.filter(([group]) => String(group).includes('NVDA')).length).toBe(1)
  })
})
