// Pushed list prices reach BOTH stores every list row reads: livePriceStore (useLivePrices) and
// priceStreamManager (useRealtimePrices / liveQuote). The REST poll stays, slow while the push is healthy.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('./realtimeCandle', () => ({ applyTick: vi.fn(), applyBarClose: vi.fn(), applyCorrection: vi.fn() }))

import * as qp from './quotePush'
import * as store from '../hooks/livePriceStore'
import * as mgr from './priceStreamManager'

class FakeEventSource {
  static instances = []
  constructor(url) { this.url = url; this.listeners = {}; this.closed = false; FakeEventSource.instances.push(this) }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) }
  close() { this.closed = true }
  emitOpen() { this.onopen?.() }
  frame(arr) { this.onmessage?.({ data: JSON.stringify(arr) }) }
  message(obj) { this.onmessage?.({ data: JSON.stringify(obj) }) }
  emitEvent(type, obj) { for (const fn of this.listeners[type] || []) fn({ data: JSON.stringify(obj) }) }
}
const quoteEs = () => FakeEventSource.instances.filter((e) => !e.closed && e.url.startsWith('/api/stream/quotes'))
const pricesEs = () => FakeEventSource.instances.filter((e) => !e.closed && e.url.startsWith('/api/stream/prices'))

let rafQueue = []
const runFrame = () => { const q = rafQueue; rafQueue = []; for (const cb of q) cb(0) }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

let restBody
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-24T15:00:00Z'))   // a Tuesday, 10:00 ET: the regular session
  FakeEventSource.instances = []
  globalThis.EventSource = FakeEventSource
  rafQueue = []
  globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length }
  globalThis.cancelAnimationFrame = () => {}
  localStorage.clear()
  localStorage.setItem('uct.quotePush', '1')
  restBody = { AAPL: { price: 100, prev_close: 99, change_pct: 1.0101, change: 1, volume: 500, ext_session: null } }
  globalThis.fetch = vi.fn(() => Promise.resolve({
    ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve(restBody),
  }))
  qp._resetForTests()
  store.__resetForTest()
  mgr._resetForTests()
})

afterEach(() => {
  store.__resetForTest()
  mgr._resetForTests()
  qp._resetForTests()
  vi.useRealTimers()
})

async function healthyPush(tickers = ['AAPL']) {
  store.registerTickers(tickers)
  await flush()                                            // the first REST poll lands
  vi.advanceTimersByTime(qp.SET_DEBOUNCE_MS + 5)
  const es = quoteEs()[0]
  expect(es, 'the store did not open the quotes push').toBeTruthy()
  es.emitOpen()
  es.emitEvent('status', { live: true })
  return es
}

describe('livePriceStore', () => {
  it('a pushed trade reaches the list row on the next frame: price, volume and the day % recomputed', async () => {
    const es = await healthyPush()
    es.frame(['AAPL', 101.98, 900, Date.now(), Date.now()])
    expect(store.getSnapshot().AAPL.price).toBe(100)       // not before the frame
    runFrame()
    const row = store.getSnapshot().AAPL
    expect(row.price).toBe(101.98)
    expect(row.volume).toBe(900)
    expect(row.change_pct).toBeCloseTo(3.0101, 3)
  })

  it('while the push is healthy the REST poll slows to the push cadence', async () => {
    await healthyPush()
    vi.advanceTimersByTime(2100)                           // the poll scheduled before the push came up
    await flush()
    const n = fetch.mock.calls.length
    vi.advanceTimersByTime(qp.PUSH_HEALTHY_POLL_MS - 500)
    await flush()
    expect(fetch.mock.calls.length).toBe(n)
    vi.advanceTimersByTime(1000)
    await flush()
    expect(fetch.mock.calls.length).toBe(n + 1)
  })

  it('the push going unhealthy polls at once and returns to the fast cadence', async () => {
    const es = await healthyPush()
    vi.advanceTimersByTime(2100)
    await flush()
    const n = fetch.mock.calls.length
    es.emitEvent('status', { live: false })
    await flush()
    expect(fetch.mock.calls.length).toBe(n + 1)
    vi.advanceTimersByTime(2100)
    await flush()
    expect(fetch.mock.calls.length).toBe(n + 2)
  })

  it('a slower REST answer never drags a pushed price back while the push is healthy', async () => {
    const es = await healthyPush()
    es.frame(['AAPL', 101.5, 900, Date.now(), Date.now()])
    runFrame()
    restBody = { AAPL: { ...restBody.AAPL, price: 100.2 } }   // 15 s cached server snapshot
    store.pollNow()
    await flush()
    expect(store.getSnapshot().AAPL.price).toBe(101.5)
  })

  it('with the flag off nothing changes: no push connection, the 2 s poll', async () => {
    localStorage.removeItem('uct.quotePush')
    store.registerTickers(['AAPL'])
    await flush()
    vi.advanceTimersByTime(qp.SET_DEBOUNCE_MS + 5)
    expect(quoteEs()).toHaveLength(0)
    const n = fetch.mock.calls.length
    vi.advanceTimersByTime(2100)
    await flush()
    expect(fetch.mock.calls.length).toBe(n + 1)
  })
})

describe('priceStreamManager', () => {
  it('a pushed trade overlays the stream snapshot on the next frame; an OLDER stream frame cannot undo it', async () => {
    mgr.subscribe(['AAPL'], () => {})
    vi.advanceTimersByTime(mgr.REBUILD_DEBOUNCE_MS + 10)
    const es = await healthyPush()
    const t = Date.now()
    es.frame(['AAPL', 101.5, 900, t, t])
    runFrame()
    expect(mgr.getSnapshot().prices.AAPL.price).toBe(101.5)
    const old = pricesEs()[0]
    old.message({ AAPL: { price: 100.9, volume: 880, trade_ts: t - 800, updated_at: Math.floor((t - 800) / 1000) } })
    expect(mgr.getSnapshot().prices.AAPL.price).toBe(101.5)
    old.message({ AAPL: { price: 101.7, volume: 950, trade_ts: t + 500, updated_at: Math.floor((t + 500) / 1000) } })
    expect(mgr.getSnapshot().prices.AAPL.price).toBe(101.7)
  })

  it('the push going unhealthy drops its quotes from the stream snapshot (no frozen push price)', async () => {
    mgr.subscribe(['AAPL'], () => {})
    vi.advanceTimersByTime(mgr.REBUILD_DEBOUNCE_MS + 10)
    const es = await healthyPush()
    es.frame(['AAPL', 101.5, 900, Date.now(), Date.now()])
    runFrame()
    es.emitEvent('status', { live: false })
    expect(mgr.getSnapshot().prices.AAPL).toBeUndefined()
  })

  it('a stream subscriber alone also puts its tickers on the push', async () => {
    mgr.subscribe(['NVDA'], () => {})
    vi.advanceTimersByTime(mgr.REBUILD_DEBOUNCE_MS + 10)
    vi.advanceTimersByTime(qp.SET_DEBOUNCE_MS + 5)
    expect(quoteEs()[0]?.url).toBe('/api/stream/quotes?tickers=NVDA')
  })
})
