import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('./realtimeCandle', () => ({
  applyTick: vi.fn(),
  applyBarClose: vi.fn(),
  applyCorrection: vi.fn(),
}))

import * as realtimeCandle from './realtimeCandle'
import * as mgr from './priceStreamManager'

class FakeEventSource {
  static instances = []
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.listeners = {}
    this.onopen = null
    this.onmessage = null
    this.onerror = null
    this.closed = false
    FakeEventSource.instances.push(this)
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) }
  close() { this.readyState = 2; this.closed = true }
  emitOpen() { this.readyState = 1; this.onopen?.() }
  emitMessage(obj) { this.onmessage?.({ data: JSON.stringify(obj) }) }
  emitEvent(type, obj) { for (const fn of this.listeners[type] || []) fn({ data: JSON.stringify(obj) }) }
  emitError() { this.onerror?.() }
}

function openInstances() {
  return FakeEventSource.instances.filter(es => !es.closed)
}

function flushRebuild() {
  vi.advanceTimersByTime(mgr.REBUILD_DEBOUNCE_MS + 10)
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeEventSource.instances = []
  globalThis.EventSource = FakeEventSource
  mgr._resetForTests()
})

afterEach(() => {
  mgr._resetForTests()
  vi.useRealTimers()
})

describe('subscriptions → union → buckets', () => {
  it('two subscribers share ONE connection carrying the deduped sorted union', () => {
    mgr.subscribe(['NVDA', 'AAPL'], () => {})
    mgr.subscribe(['AAPL', 'MSFT'], () => {})
    flushRebuild()
    const open = openInstances()
    expect(open).toHaveLength(1)
    expect(open[0].url).toBe('/api/stream/prices?tickers=AAPL,MSFT,NVDA')
  })

  it('unions above 50 tickers split into buckets of at most 50', () => {
    const many = Array.from({ length: 120 }, (_, i) => `T${String(i).padStart(3, '0')}`)
    mgr.subscribe(many, () => {})
    flushRebuild()
    const open = openInstances()
    expect(open).toHaveLength(3)
    for (const es of open) {
      const n = es.url.split('=')[1].split(',').length
      expect(n).toBeLessThanOrEqual(50)
    }
  })

  it('last unsubscribe closes every connection', () => {
    const un1 = mgr.subscribe(['AAPL'], () => {})
    const un2 = mgr.subscribe(['MSFT'], () => {})
    flushRebuild()
    expect(openInstances()).toHaveLength(1)
    un1(); un2()
    flushRebuild()
    expect(openInstances()).toHaveLength(0)
  })

  it('rapid subscribe/unsubscribe inside the debounce window causes ONE rebuild', () => {
    const un = mgr.subscribe(['AAPL'], () => {})
    un()
    mgr.subscribe(['AAPL', 'MSFT'], () => {})
    mgr.subscribe(['NVDA'], () => {})
    flushRebuild()
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0].url).toBe('/api/stream/prices?tickers=AAPL,MSFT,NVDA')
  })

  it('a bucket whose ticker list is unchanged across a rebuild keeps its EventSource', () => {
    mgr.subscribe(['AAPL', 'MSFT'], () => {})
    flushRebuild()
    const first = openInstances()[0]
    // Adding a subscriber with the SAME tickers → union unchanged → no reconnect
    mgr.subscribe(['AAPL'], () => {})
    flushRebuild()
    expect(openInstances()).toHaveLength(1)
    expect(openInstances()[0]).toBe(first)
  })

  it('empty ticker lists never open a connection', () => {
    mgr.subscribe([], () => {})
    flushRebuild()
    expect(openInstances()).toHaveLength(0)
  })

  it('an unchanged bucket is reused even when its index shifts', () => {
    const bBlock = Array.from({ length: 50 }, (_, i) => `B${String(i).padStart(2, '0')}`)
    mgr.subscribe(bBlock, () => {})
    flushRebuild()
    expect(openInstances()).toHaveLength(1)
    const bEs = openInstances()[0]
    // A-block sorts BEFORE the B-block → B-block shifts index 0 → 1, content unchanged
    const aBlock = Array.from({ length: 50 }, (_, i) => `A${String(i).padStart(2, '0')}`)
    mgr.subscribe(aBlock, () => {})
    flushRebuild()
    expect(openInstances()).toHaveLength(2)
    expect(openInstances()).toContain(bEs)   // fails under positional matching
    expect(bEs.closed).toBe(false)
  })
})

describe('event fanout + snapshot', () => {
  it('price messages merge into the snapshot and notify listeners', () => {
    const listener = vi.fn()
    mgr.subscribe(['AAPL', 'MSFT'], listener)
    flushRebuild()
    const es = openInstances()[0]
    es.emitOpen()
    es.emitMessage({ AAPL: { price: 101.5, change_pct: 1.2 } })
    expect(listener).toHaveBeenCalled()
    expect(mgr.getSnapshot().prices.AAPL.price).toBe(101.5)
    es.emitMessage({ MSFT: { price: 402 } })
    // AAPL survives later messages (accumulator, not replacement)
    expect(mgr.getSnapshot().prices.AAPL.price).toBe(101.5)
    expect(mgr.getSnapshot().prices.MSFT.price).toBe(402)
  })

  it('snapshot reference only changes when data changes', () => {
    mgr.subscribe(['AAPL'], () => {})
    flushRebuild()
    const es = openInstances()[0]
    es.emitOpen()
    es.emitMessage({ AAPL: { price: 1 } })
    const snap1 = mgr.getSnapshot()
    expect(mgr.getSnapshot()).toBe(snap1)  // stable between publishes
    es.emitMessage({ AAPL: { price: 2 } })
    expect(mgr.getSnapshot()).not.toBe(snap1)
  })

  it('connected is true only when every bucket is open', () => {
    const many = Array.from({ length: 60 }, (_, i) => `T${String(i).padStart(2, '0')}`)
    mgr.subscribe(many, () => {})
    flushRebuild()
    const [es1, es2] = openInstances()
    es1.emitOpen()
    expect(mgr.getSnapshot().connected).toBe(false)
    es2.emitOpen()
    expect(mgr.getSnapshot().connected).toBe(true)
  })

  it('stale/fresh transitions maintain the global stale set', () => {
    mgr.subscribe(['AAPL'], () => {})
    flushRebuild()
    const es = openInstances()[0]
    es.emitOpen()
    es.emitEvent('stale', { sym: 'AAPL' })
    expect(mgr.getSnapshot().staleSymbols.has('AAPL')).toBe(true)
    es.emitEvent('fresh', { sym: 'AAPL' })
    expect(mgr.getSnapshot().staleSymbols.has('AAPL')).toBe(false)
  })

  it('candle events hit realtimeCandle exactly once each', () => {
    realtimeCandle.applyTick.mockClear()
    realtimeCandle.applyBarClose.mockClear()
    mgr.subscribe(['AAPL'], () => {})
    mgr.subscribe(['AAPL'], () => {})   // second consumer of the SAME ticker
    flushRebuild()
    const es = openInstances()[0]
    es.emitOpen()
    es.emitEvent('tick', { sym: 'AAPL', price: 100, vol: 5, ts: 1 })
    expect(realtimeCandle.applyTick).toHaveBeenCalledTimes(1)
    es.emitEvent('bar_close', { sym: 'AAPL', tf: '1', bar: { t: 0, c: 100, v: 5 } })
    expect(realtimeCandle.applyBarClose).toHaveBeenCalledTimes(1)
  })
})

describe('reconnect + watchdog', () => {
  it('onerror backs off 5s → 10s → 20s (capped) and reconnects the bucket', () => {
    mgr.subscribe(['AAPL'], () => {})
    flushRebuild()
    const es1 = openInstances()[0]
    es1.emitOpen()
    es1.emitError()
    expect(mgr.getSnapshot().connected).toBe(false)
    expect(openInstances()).toHaveLength(0)
    vi.advanceTimersByTime(5000 + 10)
    expect(openInstances()).toHaveLength(1)   // reconnected after 5s
    const es2 = openInstances()[0]
    es2.emitError()
    vi.advanceTimersByTime(5000 + 10)
    expect(openInstances()).toHaveLength(0)   // second retry waits 10s, not 5s
    vi.advanceTimersByTime(5000)
    expect(openInstances()).toHaveLength(1)
  })

  it('prices persist across a reconnect (never cleared)', () => {
    mgr.subscribe(['AAPL'], () => {})
    flushRebuild()
    const es = openInstances()[0]
    es.emitOpen()
    es.emitMessage({ AAPL: { price: 55 } })
    es.emitError()
    expect(mgr.getSnapshot().prices.AAPL.price).toBe(55)
  })

  it('watchdog force-reconnects a silently dead bucket', () => {
    mgr.subscribe(['AAPL'], () => {})
    flushRebuild()
    const es1 = openInstances()[0]
    es1.emitOpen()
    // No events (not even heartbeat) for > STREAM_WATCHDOG_MS (30s) → sweep kills it
    vi.advanceTimersByTime(45000)
    const open = openInstances()
    expect(open).toHaveLength(1)
    expect(open[0]).not.toBe(es1)
    expect(es1.closed).toBe(true)
  })

  it('heartbeats keep the watchdog satisfied', () => {
    mgr.subscribe(['AAPL'], () => {})
    flushRebuild()
    const es1 = openInstances()[0]
    es1.emitOpen()
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(10000)
      es1.emitEvent('heartbeat', {})
    }
    expect(openInstances()[0]).toBe(es1)  // never replaced
    expect(es1.closed).toBe(false)
  })
})
