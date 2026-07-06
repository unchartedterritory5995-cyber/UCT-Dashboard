import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as bars from './barsStreamManager'

// Controllable EventSource mock — we fire open/bar/heartbeat/error by hand.
class MockES {
  static instances = []
  constructor(url) {
    this.url = url; this.listeners = {}; this.onopen = null; this.onerror = null
    this.closed = false; MockES.instances.push(this)
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) }
  close() { this.closed = true }
  _open() { if (this.onopen) this.onopen() }
  _emit(type, data) { (this.listeners[type] || []).forEach(fn => fn({ data: JSON.stringify(data) })) }
  _error() { if (this.onerror) this.onerror() }
}

beforeEach(() => {
  MockES.instances = []
  global.EventSource = MockES
  try { localStorage.removeItem('uct.barsPool.disabled') } catch { /* ignore */ }
  bars._resetForTests()
})
afterEach(() => bars._resetForTests())

const flush = () => bars._flushRebuild()

describe('barsStreamManager', () => {
  it('pools multiple (sym,tf) pairs onto ONE connection', () => {
    bars.subscribe('AAPL', '5', {})
    bars.subscribe('MSFT', '5', {})
    flush()
    expect(MockES.instances.length).toBe(1)
    expect(MockES.instances[0].url).toContain('AAPL:5')
    expect(MockES.instances[0].url).toContain('MSFT:5')
  })

  it('KEYED dispatch: an AAPL:5 chart never receives the MSFT:5 bar (the blocker)', () => {
    const aapl = []; const msft = []
    bars.subscribe('AAPL', '5', { onBar: d => aapl.push(d) })
    bars.subscribe('MSFT', '5', { onBar: d => msft.push(d) })
    flush()
    const es = MockES.instances[0]
    es._open()
    es._emit('bar', { sym: 'MSFT', tf: '5', bar: { t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 } })
    expect(msft.length).toBe(1)
    expect(aapl.length).toBe(0)   // <-- AAPL must NOT get MSFT's OHLC
    es._emit('bar', { sym: 'AAPL', tf: '5', bar: { t: 2, o: 2, h: 2, l: 2, c: 2, v: 2 } })
    expect(aapl.length).toBe(1)
    expect(msft.length).toBe(1)
  })

  it('same-symbol different-tf are also isolated (AAPL:1 vs AAPL:5)', () => {
    const one = []; const five = []
    bars.subscribe('AAPL', '1', { onBar: d => one.push(d) })
    bars.subscribe('AAPL', '5', { onBar: d => five.push(d) })
    flush()
    MockES.instances[0]._open()
    MockES.instances[0]._emit('bar', { sym: 'AAPL', tf: '5', bar: { t: 1, c: 1 } })
    expect(five.length).toBe(1)
    expect(one.length).toBe(0)
  })

  it('getStatus: connected → healthy → delivering only after a REAL bar', () => {
    bars.subscribe('AAPL', '1', {})
    flush()
    expect(bars.getStatus('AAPL', '1')).toMatchObject({ connected: false, delivering: false })
    const es = MockES.instances[0]
    es._open()
    let s = bars.getStatus('AAPL', '1')
    expect(s.connected).toBe(true)
    expect(s.healthy).toBe(true)
    expect(s.delivering).toBe(false)  // connected but no bar yet → must NOT suppress Finnhub
    es._emit('bar', { sym: 'AAPL', tf: '1', bar: { t: 1, c: 1 } })
    expect(bars.getStatus('AAPL', '1').delivering).toBe(true)
  })

  it('kill-switch: localStorage disable opens NO connection and reports not-delivering', () => {
    localStorage.setItem('uct.barsPool.disabled', '1')
    bars.subscribe('AAPL', '1', {})
    flush()
    expect(MockES.instances.length).toBe(0)
    expect(bars.getStatus('AAPL', '1')).toMatchObject({ connected: false, healthy: false, delivering: false })
  })

  it('onStatus fires on connect and on the first bar', () => {
    const status = vi.fn()
    bars.subscribe('AAPL', '1', { onStatus: status })
    flush()
    const es = MockES.instances[0]
    es._open()
    const afterConnect = status.mock.calls.length
    expect(afterConnect).toBeGreaterThan(0)
    es._emit('bar', { sym: 'AAPL', tf: '1', bar: { t: 1, c: 1 } })
    expect(status.mock.calls.length).toBeGreaterThan(afterConnect)  // first-bar status flip
  })

  it('onReconnect gap-backfill receives the last seen bar time', () => {
    const recon = vi.fn()
    bars.subscribe('AAPL', '1', { onReconnect: recon })
    flush()
    const es = MockES.instances[0]
    es._open()                                                   // first connect → null
    expect(recon).toHaveBeenLastCalledWith(null)
    es._emit('bar', { sym: 'AAPL', tf: '1', bar: { t: 123, c: 1 } })
    es._open()                                                   // reconnect → last bar t
    expect(recon).toHaveBeenLastCalledWith(123)
  })

  it('unsubscribe tears down the connection when no pairs remain', () => {
    const unsub = bars.subscribe('AAPL', '1', {})
    flush()
    const es = MockES.instances[0]
    es._open()
    unsub()
    flush()
    expect(es.closed).toBe(true)
    expect(bars._getBuckets().length).toBe(0)
  })

  it('delivering goes FALSE once bars go stale, even while connected + heartbeating (review #2)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-06T14:00:00Z'))
    try {
      bars.subscribe('AAPL', '1', {})
      bars._flushRebuild()
      const es = MockES.instances[0]
      es._open()
      es._emit('bar', { sym: 'AAPL', tf: '1', bar: { t: 1, c: 1 } })
      expect(bars.getStatus('AAPL', '1').delivering).toBe(true)
      // No new bar for > BARS_LIVE_STALE_MS (feed dead but SSE would keep heartbeating).
      vi.setSystemTime(Date.now() + bars.BARS_LIVE_STALE_MS + 5000)
      expect(bars.getStatus('AAPL', '1').delivering).toBe(false)  // must fall back to Finnhub
    } finally { vi.useRealTimers() }
  })

  it('watchdog re-notifies each sweep so a stale delivering is OBSERVED, not dead code (re-review)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-06T14:00:00Z'))
    try {
      const status = vi.fn()
      bars.subscribe('AAPL', '1', { onStatus: status })
      bars._flushRebuild()
      const es = MockES.instances[0]
      es._open()
      es._emit('bar', { sym: 'AAPL', tf: '1', bar: { t: 1, c: 1 } })
      expect(bars.getStatus('AAPL', '1').delivering).toBe(true)
      const before = status.mock.calls.length
      // Connection stays alive via heartbeats (no reconnect), but no BARS arrive past the
      // recency window — the sweep must still re-notify so the consumer sees delivering flip.
      for (let i = 0; i < 12; i++) { es._emit('heartbeat'); vi.advanceTimersByTime(12000) }
      expect(status.mock.calls.length).toBeGreaterThan(before)     // sweeps re-notified
      expect(bars.getStatus('AAPL', '1').delivering).toBe(false)    // recency gate observed
    } finally { vi.useRealTimers() }
  })

  it('prunes per-key liveness on last-unsubscribe → resubscribe is NOT instantly delivering (review #3)', () => {
    const unsub = bars.subscribe('AAPL', '1', {})
    flush()
    MockES.instances[0]._open()
    MockES.instances[0]._emit('bar', { sym: 'AAPL', tf: '1', bar: { t: 1, c: 1 } })
    expect(bars.getStatus('AAPL', '1').delivering).toBe(true)
    unsub(); flush()
    // Resubscribe (switch away + back): must start fresh, NOT report delivering on stale
    // everDelivered — else it would suppress Finnhub through the pre-first-bar gap.
    bars.subscribe('AAPL', '1', {})
    flush()
    MockES.instances[MockES.instances.length - 1]._open()
    expect(bars.getStatus('AAPL', '1').delivering).toBe(false)
  })

  it('error drops healthy: getStatus reports not-connected after onerror', () => {
    bars.subscribe('AAPL', '1', {})
    flush()
    const es = MockES.instances[0]
    es._open()
    es._emit('bar', { sym: 'AAPL', tf: '1', bar: { t: 1, c: 1 } })
    expect(bars.getStatus('AAPL', '1').delivering).toBe(true)
    es._error()
    const s = bars.getStatus('AAPL', '1')
    expect(s.connected).toBe(false)
    expect(s.delivering).toBe(false)  // a dropped feed must not read as delivering
  })
})
