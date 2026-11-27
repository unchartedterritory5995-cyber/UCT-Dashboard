/**
 * SMOOTHNESS PART 2, ITEM (2b): A LAKE LOAD A PAINT WAITS ON NEVER YIELDS (2026-11-26).
 *
 * The lake's pieces now decode one per task (historyLake/source `yieldTask`), which leaves room for frames when a join
 * lands after the chart painted. A load the handoff WAITS on to paint (prefetch `_lakeLoad`, `lakeSeed(key, { awaited })`)
 * must not finish any later: from the moment a caller waits on it, its pieces decode at once, as before.
 *   A1 an unawaited load (the chart's subscribe, a warm, the join after an answer) asks a later task before each piece
 *   A2 an awaited load never does
 *   A3 a caller that starts waiting on a load already running stops its yields for the pieces still to come
 *   A4 the key is unmarked when its load settles: the next unawaited load yields again
 *   A5 the handoff's lake wait (prefetch `_lakeLoad`) is the awaited caller
 *   A6 (review of #2786) a chart subscribing to a key with nothing saved paints the lake's newest bars first: that load
 *      is awaited (index.js _start) (red before: it yielded)
 *   A7 a chart subscribing over a saved copy only deepens it: that load still yields
 *   A8 (review of #2786 delta) an entry holding only a developing bar, no bars, is not a chart yet: its load is awaited
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createBarStore } from './index'
import { keyOf } from './types'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { memClear, memPutMonotonic } from '../../utils/barsMemCache'

const OPEN = Date.UTC(2026, 10, 10, 14, 30) / 1000     // Tue 09:30 ET
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime(OPEN * 1000 + 10 * 60_000) })
afterEach(() => { vi.useRealTimers() })

// a lake that holds each load until the test lets it go, keeping the options each load was asked with
function heldLake() {
  const loads = []
  const olderBars = vi.fn((key, beforeT, opts) => new Promise((resolve) => {
    loads.push({ key, opts, done: () => resolve({ bars: [], exhausted: true }) })
  }))
  return { loads, olderBars }
}
const makeStore = (history) => createBarStore({
  request: vi.fn(() => new Promise(() => {})), stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
  isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), history,
})
// what a load's per-piece wait answers right now: a promise (decode in a later task) or nothing (decode at once)
const waits = (load) => { const w = load.opts.yieldTask(); return w && typeof w.then === 'function' ? 'yields' : 'at once' }

describe('a lake load a paint waits on never yields', () => {
  it('A1 an unawaited load yields before each piece; A2 an awaited one never does', async () => {
    const lake = heldLake()
    const store = makeStore(lake)
    const a = keyOf({ sym: 'AAA', tf: '5' }), b = keyOf({ sym: 'BBB', tf: '5' })
    store.lakeSeed(a)
    store.lakeSeed(b, { awaited: true })
    await vi.advanceTimersByTimeAsync(0)
    const la = lake.loads.find((l) => l.key === a), lb = lake.loads.find((l) => l.key === b)
    expect(typeof la.opts.yieldTask).toBe('function')
    expect(waits(la)).toBe('yields')
    expect(waits(lb)).toBe('at once')
  })

  it('A3 a caller that starts waiting on a running load stops its yields; A4 unmarked when it settles', async () => {
    const lake = heldLake()
    const store = makeStore(lake)
    const k = keyOf({ sym: 'CCC', tf: '5' })
    const first = store.lakeSeed(k)                      // the chart's subscribe: nobody waits
    await vi.advanceTimersByTimeAsync(0)
    expect(lake.loads).toHaveLength(1)
    expect(waits(lake.loads[0])).toBe('yields')
    const again = store.lakeSeed(k, { awaited: true })   // the handoff joins it and waits
    expect(again).toBe(first)                            // one load, shared
    expect(lake.loads).toHaveLength(1)
    expect(waits(lake.loads[0])).toBe('at once')         // the pieces still to come decode at once
    lake.loads[0].done()
    await first
    await vi.advanceTimersByTimeAsync(0)
    // settled: a later unawaited load of the same key yields again (the depth is due again: nothing was added)
    store.lakeSeed(k)
    await vi.advanceTimersByTimeAsync(0)
    expect(lake.loads).toHaveLength(2)
    expect(waits(lake.loads[1])).toBe('yields')
  })

  it('A6 a chart subscribing with nothing saved: its lake load (the first frame) is awaited', async () => {
    const lake = heldLake()
    const store = makeStore(lake)
    const k = keyOf({ sym: 'NEW', tf: '5' })
    store.subscribe(k, () => {})
    await vi.advanceTimersByTimeAsync(50)
    const load = lake.loads.find((l) => l.key === k)
    expect(load).toBeTruthy()
    expect(waits(load)).toBe('at once')
  })

  it('A8 an entry holding only a developing bar (no bars) still paints the lake first: its load is awaited', async () => {
    const lake = heldLake()
    const store = makeStore(lake)
    const k = keyOf({ sym: 'DEV', tf: '5' })
    store.subscribe(k, () => {})
    store.applyLive(k, { t: OPEN + 600, o: 100, h: 101, l: 99, c: 100.5, v: 10 })   // the 09:40 bucket, forming
    await vi.advanceTimersByTimeAsync(50)
    expect(store.peek(k)?.developing).toBeTruthy()           // a developing bar ...
    expect(store.peek(k)?.bars.length ?? 0).toBe(0)          // ... and no bars: not a chart yet
    const load = lake.loads.find((l) => l.key === k)
    expect(load).toBeTruthy()
    expect(waits(load)).toBe('at once')
  })

  it('A7 a chart subscribing over a saved copy: its lake load only deepens, and yields', async () => {
    const rows = []
    for (let t = OPEN; t < OPEN + 9 * 300; t += 300) rows.push({ t, o: 100, h: 101, l: 99, c: 100.5, v: 10 })
    memPutMonotonic('HELD', '5', rows, { savedAt: Date.now() - 60_000 })
    const lake = heldLake()
    const store = makeStore(lake)
    const k = keyOf({ sym: 'HELD', tf: '5' })
    store.subscribe(k, () => {})
    await vi.advanceTimersByTimeAsync(50)
    expect(store.peek(k)?.bars.length).toBeGreaterThan(0)    // the saved copy is held
    const load = lake.loads.find((l) => l.key === k)
    expect(load).toBeTruthy()
    expect(waits(load)).toBe('yields')
  })

  it('A5 the handoff\'s lake wait (prefetch _lakeLoad) is the awaited caller', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/data/barStore/prefetch.js'), 'utf8')
    const body = src.slice(src.indexOf('function _lakeLoad('), src.indexOf('function _joinLake('))
    expect(body).toMatch(/S\(\)\.lakeSeed\?\.\(key, \{ awaited: true \}\)/)
  })
})
