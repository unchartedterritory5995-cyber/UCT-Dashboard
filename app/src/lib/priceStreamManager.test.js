import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('./realtimeCandle', () => ({
  applyTick: vi.fn(),
  applyBarClose: vi.fn(),
  applyCorrection: vi.fn(),
}))

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
    const first50 = Array.from({ length: 50 }, (_, i) => `B${String(i).padStart(2, '0')}`)
    // 'ZZZZ' sorts AFTER the B-block, so bucket 0 = the B-block, bucket 1 = [ZZZZ]
    const un = mgr.subscribe(['ZZZZ'], () => {})
    mgr.subscribe(first50, () => {})
    flushRebuild()
    expect(openInstances()).toHaveLength(2)
    const bBucketEs = openInstances().find(es => es.url.includes('B00'))
    // Dropping ZZZZ leaves the B-block bucket identical in content
    un()
    flushRebuild()
    expect(openInstances()).toHaveLength(1)
    expect(openInstances()[0]).toBe(bBucketEs)
  })
})
