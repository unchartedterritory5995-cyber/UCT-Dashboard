// ⭐ A DEVICE COPY JOINING THE LAKE'S ROWS ON A CHART ALREADY SHOWING THEM, WITH THE KEY'S ANSWER ON ITS WAY, WAITS FOR
// IDLE (2026-11-23, the live-session read of the device store, item 3). The key press asks the device for the new symbol
// at once (prefetch.deviceWarm, from handoffGroups.primeGroup), and the chart's own subscribe asks again
// (index.js _start -> persist.hydrate). For a key holding only the history lake's rows the copy lands 1-20 ms later and
// JOINS them (columnsToRows, a DEVICE_HIT merge over thousands of lake rows), and when the switch has already committed
// on the lake's rows that work re-renders the chart inside the press-to-frame window, moments before the server's answer
// (in flight: the chart's own request) refuses or replaces the device's rows anyway. So that one case waits for idle:
//   J1 a lake-held key ON SCREEN with its answer on the way: the join is dispatched at idle, not in the read's own task
//   J2 ...and an answer that lands first is the entry: the deferred join is refused ('answered'), nothing repainted
// and nothing else moves (the paint the device store exists for):
//   J3 a key NOT on screen (the switch still waiting on it): joined at once, and the device copy paints
//   J4 a COLD key, OFF-HOURS, on screen with its answer on the way: the device copy seeds it at once and is the first
//      frame (a seed is never a join)
//   J5 a lake-held key on screen with NO answer on the way: joined at once (it is the newest the chart will get)
// review of #2615:
//   J1 (also) the two deferred reads (the key press's and the subscribe's) make ONE device transition at idle
//   J6 the request FAILS before idle (a real REST_ERROR): the deferred copy still joins at idle, the error kept
//   J7 the kill is seen before idle: the deferred copy never joins (#2580: a kill marks only the entries holding device
//      rows at that moment, so a copy joining after it would be unmarked)
//   J8 an answer that LAGS the device copy lands before idle: the deferred join is flushed right before the answer, so
//      the answer keeps the device's vouched newer complete candle (#2558 P4-L3), in the same task as the answer
//   J9 an IndexedDB-held key (not the lake's) on screen with its answer on the way: joined at once (`source !== 'lake'`)
//   J0 with the store off (no device source) the answer path never reaches a flush: persist has no `flushJoins` at all,
//      so the network's call before each answer reads one missing property and stops
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createBarStore } from './index'
import { createPrefetch } from './prefetch'
import { keyOf, ACTION } from './types'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { memClear } from '../../utils/barsMemCache'
import { deviceStoreKilledNow, __resetChartSpeedForTests } from '../../lib/chartSpeed'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const OPEN = Date.UTC(2026, 10, 18, 14, 30) / 1000        // Wed 2026-11-18 09:30 ET
const DAY = 86400
const T = (etMin) => OPEN + (etMin - 570) * 60              // ET minute of day, today
const bar = (t, k, i) => { const o = Math.round((50 + ((i * 7) % 13) / 4) * 100) / 100 * k; return { t, o, h: o + 0.5 * k, l: o - 0.5 * k, c: o + 0.25 * k, v: 1000 + i } }
const session = (open, upto, k = 1) => { const out = []; for (let i = 0; i < 78 && open + i * 300 <= upto; i++) out.push(bar(open + i * 300, k, i)); return out }
const YESTERDAY = session(OPEN - DAY, Infinity)
/** The device copy at 11:31: yesterday's session + today's regular session to the 11:25 bucket, all complete. */
const DEVICE = [...YESTERDAY, ...session(OPEN, T(685))]
const THROUGH = T(691)                                       // 11:31:00
/** The lake: the two sessions before today (during the session the lake never holds today's bars). */
const LAKE = [...session(OPEN - 2 * DAY, Infinity), ...YESTERDAY]

function answer() {
  return {
    ticker: 'NEWB', tf: '5', bars: [...YESTERDAY, ...session(OPEN, T(685))], contract: 1, grid: 'eth-clock', session: 'rth',
    cache_key: 'b1:NEWB:5:eth-clock', series_rev: 9000, history_rev: 1, verified_through: THROUGH, complete_through: T(690),
    tail_status: 'verified', developing: { ...bar(T(690), 1, 24), rev: 9001 },
  }
}

/** A device source whose recently-read cache is empty (peek: null) and whose reads land when the test says. */
function fakeDevice(rows, through) {
  const pending = []
  const hit = { n: rows.length, rows, through, savedAt: through * 1000, formingT: null }
  return {
    pending,
    land: () => { for (const r of pending.splice(0)) r(hit) },
    peek: vi.fn(() => null),
    read: vi.fn((s, t) => (s === 'NEWB' && t === '5' ? new Promise((r) => { pending.push(r) }) : Promise.resolve(null))),
  }
}

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime(THROUGH * 1000) })
afterEach(() => {
  vi.useRealTimers()
  document.cookie = 'uct_device_store=; Max-Age=0; Path=/'
  __resetChartSpeedForTests()
})

function boot({ device, reply = answer }) {
  let release = () => {}
  let fail = () => {}
  const request = vi.fn(() => new Promise((r, j) => { release = () => r(reply()); fail = () => j(Object.assign(new Error('boom'), { status: 503 })) }))
  const idleQ = []
  const store = createBarStore({
    request, device, history: null,
    io: { idbGet: async () => null, idbGetHistoryEntry: async () => null, idbPutMonotonic: async () => {}, memPutMonotonic: () => {} },
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {},
    idle: (fn) => { idleQ.push(fn) },
  })
  const pf = createPrefetch({ store, tickerMeta: () => {}, extended: () => false })
  const runIdle = () => { for (const fn of idleQ.splice(0)) fn() }
  return { store, pf, request, idleQ, runIdle, key: keyOf({ sym: 'NEWB', tf: '5' }), release: () => release(), fail: () => fail() }
}
const lakeHeld = (w) => {
  w.store.registry.dispatch(w.key, { type: ACTION.LAKE_HIT, key: w.key, payload: { sym: 'NEWB', bars: LAKE } })
  expect(w.store.peek(w.key).source).toBe('lake')
}
/** An answer that LAGS the device copy: complete only to the 11:15 bucket, the 11:20 bucket still forming. The device's
 *  11:25 bucket ends 11:30, before its stamp (11:31): complete, and vouched for. */
function laggingAnswer() {
  return {
    ...answer(), bars: [...YESTERDAY, ...session(OPEN, T(675))], verified_through: T(680), complete_through: T(680),
    developing: { ...bar(T(680), 1, 22), rev: 9001 },
  }
}
/** The chart on screen: a subscriber (index.js _start), whose request goes out. */
async function onScreen(w) {
  const seen = []
  const off = w.store.subscribe(w.key, (s) => { seen.push(s?.source) })
  await vi.advanceTimersByTimeAsync(10)
  expect(w.store.network.inflight(w.key)).toBe(1)            // the chart's own request is on its way
  return { seen, off }
}

describe("a device copy joining the lake's rows on a chart already showing them, with its answer on the way, waits for idle", () => {
  it('J1 lake-held, ON SCREEN, answer on the way: the join is dispatched at idle, not in the read\'s own task', async () => {
    const dev = fakeDevice(DEVICE, THROUGH)
    const w = boot({ device: dev })
    lakeHeld(w)
    const chart = await onScreen(w)
    w.pf.deviceWarm('NEWB', '5')                              // the key press's read too
    expect(dev.pending.length).toBeGreaterThan(0)
    dev.land()
    await vi.advanceTimersByTimeAsync(5)
    expect(w.store.peek(w.key).source).toBe('lake')          // nothing joined in the read's task...
    expect(chart.seen).not.toContain('device')               // ...and the chart was not re-rendered by it
    expect(w.idleQ.length).toBeGreaterThan(0)
    w.runIdle()
    expect(w.store.peek(w.key).source).toBe('device')        // ...it joins at idle (the answer is still out)
    expect(dev.read.mock.calls.length).toBeGreaterThanOrEqual(2)   // the subscribe's read and the key press's
    expect(chart.seen.filter((src) => src === 'device')).toHaveLength(1)   // ...ONE device render for both
    chart.off()
    w.store.dispose()
  })

  it('J2 ...and an answer that lands before that idle is the entry: the deferred join is refused, nothing repainted', async () => {
    const dev = fakeDevice(DEVICE, THROUGH)
    const w = boot({ device: dev })
    lakeHeld(w)
    const chart = await onScreen(w)
    w.pf.deviceWarm('NEWB', '5')
    dev.land()
    await vi.advanceTimersByTimeAsync(5)
    w.release()                                               // the server answers first
    await vi.advanceTimersByTimeAsync(5)
    expect(w.store.peek(w.key).restSeen).toBe(true)
    const src = w.store.peek(w.key).source
    w.runIdle()
    expect(w.store.peek(w.key).source).toBe(src)             // the deferred join was refused ('answered')
    expect(w.store.peek(w.key).restSeen).toBe(true)
    expect(chart.seen).not.toContain('device')
    chart.off()
    w.store.dispose()
  })

  it('J3 a key NOT on screen (the switch still waiting): joined at once, and the device copy paints', async () => {
    const dev = fakeDevice(DEVICE, THROUGH)
    const w = boot({ device: dev })
    lakeHeld(w)
    w.pf.prepareForDisplay('NEWB', '5')                       // the switch waits on it; its own request goes out
    await vi.advanceTimersByTimeAsync(10)
    expect(w.store.network.inflight(w.key)).toBe(1)
    expect(dev.pending.length).toBeGreaterThan(0)
    dev.land()
    await vi.advanceTimersByTimeAsync(1)
    expect(w.store.peek(w.key).source).toBe('device')        // at once, no idle needed
    expect(w.pf.devicePaints('NEWB', '5')).toBe(true)
    w.store.dispose()
  })

  it('J4 a COLD key, OFF-HOURS, on screen with its answer on the way: the device copy seeds it at once (the first frame)', async () => {
    vi.setSystemTime(Date.UTC(2026, 10, 19, 2, 0))             // Wed 21:00 ET: after the session
    const FULL = [...YESTERDAY, ...session(OPEN, Infinity)]     // the device: through today's close
    const dev = fakeDevice(FULL, T(960))                       // complete through 16:00 ET: fresh after the session
    const w = boot({ device: dev })
    w.pf.deviceWarm('NEWB', '5')                              // the key press, on a key nothing holds
    const chart = await onScreen(w)
    expect(dev.pending.length).toBeGreaterThan(0)
    dev.land()
    await vi.advanceTimersByTimeAsync(1)
    expect(w.store.peek(w.key).source).toBe('device')        // a seed, never a join: no idle in between
    expect(chart.seen).toContain('device')
    expect(w.pf.devicePaints('NEWB', '5')).toBe(true)         // the device copy is the first frame, as before
    chart.off()
    w.store.dispose()
  })

  it('J5 lake-held, on screen, with NO answer on the way: joined at once', async () => {
    const dev = fakeDevice(DEVICE, THROUGH)
    const w = boot({ device: dev })
    lakeHeld(w)
    const chart = await onScreen(w)
    w.store.network.inflight = () => 0                          // (the chart's request already settled without an answer)
    w.pf.deviceWarm('NEWB', '5')
    dev.land()
    await vi.advanceTimersByTimeAsync(1)
    expect(w.store.peek(w.key).source).toBe('device')
    chart.off()
    w.store.dispose()
  })

  it('J0 with the store off, persist has no flushJoins, and an answer lands as always', async () => {
    const off = boot({ device: null })
    expect(off.store.persist.flushJoins).toBeUndefined()
    const chart = await onScreen(off)
    off.release()
    await vi.advanceTimersByTimeAsync(5)
    expect(off.store.peek(off.key).restSeen).toBe(true)
    chart.off()
    off.store.dispose()
    const on = boot({ device: fakeDevice(DEVICE, THROUGH) })   // control: with a device source it is there
    expect(typeof on.store.persist.flushJoins).toBe('function')
    on.store.dispose()
  })

  it('J6 the request FAILS before idle (a real REST_ERROR): the deferred copy still joins at idle, the error kept', async () => {
    const dev = fakeDevice(DEVICE, THROUGH)
    const w = boot({ device: dev })
    lakeHeld(w)
    const chart = await onScreen(w)
    w.pf.deviceWarm('NEWB', '5')
    dev.land()
    await vi.advanceTimersByTimeAsync(5)
    expect(w.store.peek(w.key).source).toBe('lake')          // deferred
    w.fail()                                                  // the server request fails
    await vi.advanceTimersByTimeAsync(5)
    expect(w.store.peek(w.key).error).toBeTruthy()
    expect(w.store.peek(w.key).restSeen).toBe(false)
    w.runIdle()
    expect(w.store.peek(w.key).source).toBe('device')        // joined at idle: no answer refused it
    expect(w.store.peek(w.key).error).toBeTruthy()
    chart.off()
    w.store.dispose()
  })

  it('J7 the kill is seen before idle: the deferred copy never joins', async () => {
    const dev = fakeDevice(DEVICE, THROUGH)
    const w = boot({ device: dev })
    lakeHeld(w)
    const chart = await onScreen(w)
    w.pf.deviceWarm('NEWB', '5')
    dev.land()
    await vi.advanceTimersByTimeAsync(5)
    expect(w.idleQ.length).toBeGreaterThan(0)                 // deferred (or this proves nothing)
    document.cookie = 'uct_device_store=0; Path=/'
    expect(deviceStoreKilledNow()).toBe(true)                 // the page sees the kill (the client's beat)
    w.runIdle()
    expect(w.store.peek(w.key).source).toBe('lake')          // the copy read before the kill never joins
    expect(chart.seen).not.toContain('device')
    chart.off()
    w.store.dispose()
  })

  it('J8 a LAGGING answer before idle: the deferred join goes first, so the device\'s vouched newer candle stays', async () => {
    const dev = fakeDevice(DEVICE, THROUGH)
    const w = boot({ device: dev, reply: laggingAnswer })
    lakeHeld(w)
    const chart = await onScreen(w)
    w.pf.deviceWarm('NEWB', '5')
    dev.land()
    await vi.advanceTimersByTimeAsync(5)
    expect(w.store.peek(w.key).source).toBe('lake')          // deferred: nothing joined yet
    expect(chart.seen).not.toContain('device')
    const before = chart.seen.length
    w.release()                                               // the lagging answer lands, before idle
    await vi.advanceTimersByTimeAsync(5)
    const s = w.store.peek(w.key)
    expect(s.restSeen).toBe(true)
    expect(s.bars.some((b) => b.t === T(685))).toBe(true)    // the device's complete 11:25 candle, vouched, kept
    expect(s.bars.some((b) => b.t === T(675))).toBe(true)    // and the answer's own rows
    expect(chart.seen.length).toBeGreaterThan(before)        // the chart heard it (the join and the answer, one task)
    w.runIdle()                                               // nothing is left to join at idle
    expect(w.store.peek(w.key)).toBe(s)
    chart.off()
    w.store.dispose()
  })

  it('J9 an IndexedDB-held key (not the lake\'s), on screen, its answer on the way: joined at once', async () => {
    const dev = fakeDevice(DEVICE, THROUGH)
    const w = boot({ device: dev })
    w.store.registry.dispatch(w.key, { type: ACTION.IDB_HIT, key: w.key, payload: { sym: 'NEWB', bars: LAKE } })
    expect(w.store.peek(w.key).source).toBe('idb')
    const chart = await onScreen(w)
    w.pf.deviceWarm('NEWB', '5')
    dev.land()
    await vi.advanceTimersByTimeAsync(1)
    expect(w.store.peek(w.key).source).toBe('device')        // at once: only the lake's rows wait
    chart.off()
    w.store.dispose()
  })
})
