// A single symbol switch reconnects the live pools at once; a keyboard scan still waits the debounce
// (owner 2026-11-20: a typed 1m switch showed the live candle ~1 s late; the pool waited a flat 400 ms).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { REBUILD_GATHER_MS } from './streamRebuildDelay'
import * as bars from './barsStreamManager'
import * as prices from './priceStreamManager'

class MockES {
  static instances = []
  constructor(url) { this.url = url; this.listeners = {}; this.closed = false; MockES.instances.push(this) }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) }
  close() { this.closed = true }
}

describe.each([
  ['barsStreamManager', bars, (sym) => bars.subscribe(sym, '1', {})],
  ['priceStreamManager', prices, (sym) => prices.subscribe([sym], () => {})],
])('%s reconnect timing', (_name, mgr, sub) => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockES.instances = []
    globalThis.EventSource = MockES
    try { localStorage.removeItem('uct.barsPool.disabled') } catch { /* ignore */ }
    mgr._resetForTests()
  })
  afterEach(() => { mgr._resetForTests(); vi.useRealTimers() })

  it('a switch on an idle pool connects after the gather window, not the debounce', () => {
    const un = sub('SPY')
    vi.advanceTimersByTime(REBUILD_GATHER_MS + 1)
    expect(MockES.instances.length).toBe(1)
    un()
    // the next switch, after the pool has rested: at once again
    vi.advanceTimersByTime(mgr.REBUILD_DEBOUNCE_MS + 10)
    const n = MockES.instances.length
    vi.setSystemTime(Date.now() + 5000)
    sub('QQQ')
    vi.advanceTimersByTime(REBUILD_GATHER_MS + 1)
    expect(MockES.instances.length).toBe(n + 1)
    expect(MockES.instances.at(-1).url).toContain('QQQ')
  })

  it('subscribers of one switch that land within the gather window share ONE connection', () => {
    sub('SPY')
    vi.advanceTimersByTime(REBUILD_GATHER_MS - 10)
    sub('QQQ')
    vi.advanceTimersByTime(REBUILD_GATHER_MS + 1)
    expect(MockES.instances.length).toBe(1)
    expect(MockES.instances[0].url).toContain('SPY')
    expect(MockES.instances[0].url).toContain('QQQ')
  })

  it('a sustained keyboard scan (a row every 200 ms) reconnects ONCE, after it stops', () => {
    sub('AAA')
    vi.advanceTimersByTime(REBUILD_GATHER_MS + 1)
    expect(MockES.instances.length).toBe(1)
    vi.advanceTimersByTime(mgr.REBUILD_DEBOUNCE_MS + 100)   // rested: the scan starts on a quiet pool
    const before = MockES.instances.length
    let un = sub('R0')
    vi.advanceTimersByTime(REBUILD_GATHER_MS + 1)            // the first row of the scan connects at once
    expect(MockES.instances.length).toBe(before + 1)
    for (let i = 1; i <= 12; i++) {                          // 12 more rows, 200 ms apart (2.4 s)
      vi.advanceTimersByTime(200 - REBUILD_GATHER_MS - 1)
      un(); un = sub('R' + i)
      vi.advanceTimersByTime(REBUILD_GATHER_MS + 1)
    }
    expect(MockES.instances.length).toBe(before + 1)         // nothing during the scan
    vi.advanceTimersByTime(mgr.REBUILD_DEBOUNCE_MS)
    expect(MockES.instances.length).toBe(before + 2)         // one reconnect after it stops
    expect(MockES.instances.at(-1).url).toContain('R12')
  })

  it('a scan (a change right after a reconnect) waits the full debounce', () => {
    sub('SPY')
    vi.advanceTimersByTime(REBUILD_GATHER_MS + 1)
    expect(MockES.instances.length).toBe(1)
    sub('QQQ')
    vi.advanceTimersByTime(REBUILD_GATHER_MS + 1)
    expect(MockES.instances.length).toBe(1)             // not yet: the pool just reconnected
    vi.advanceTimersByTime(mgr.REBUILD_DEBOUNCE_MS)
    expect(MockES.instances.length).toBe(2)
  })
})
