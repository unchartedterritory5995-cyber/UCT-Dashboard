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
    bars._flushBars()   // 500ms dispatch throttle — flush now
    expect(msft.length).toBe(1)
    expect(aapl.length).toBe(0)   // <-- AAPL must NOT get MSFT's OHLC
    es._emit('bar', { sym: 'AAPL', tf: '5', bar: { t: 2, o: 2, h: 2, l: 2, c: 2, v: 2 } })
    bars._flushBars()
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
    bars._flushBars()   // 500ms dispatch throttle — flush now
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

  it('delivering goes FALSE once bars go GENUINELY stale (past the disengage grace) (review #2)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-06T14:00:00Z'))
    try {
      bars.subscribe('AAPL', '1', {})
      bars._flushRebuild()
      const es = MockES.instances[0]
      es._open()
      es._emit('bar', { sym: 'AAPL', tf: '1', bar: { t: 1, c: 1 } })
      expect(bars.getStatus('AAPL', '1').delivering).toBe(true)
      // Feed dead (SSE would keep heartbeating) past the DISENGAGE grace → fall back to Finnhub.
      vi.setSystemTime(Date.now() + bars.BARS_LIVE_DISENGAGE_MS + 5000)
      expect(bars.getStatus('AAPL', '1').delivering).toBe(false)
    } finally { vi.useRealTimers() }
  })

  it('HYSTERESIS: once delivering, stays true through a short gap (STALE<gap<DISENGAGE) — no thrash', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-06T14:00:00Z'))
    try {
      bars.subscribe('AAPL', '1', {})
      bars._flushRebuild()
      const es = MockES.instances[0]
      es._open()
      es._emit('bar', { sym: 'AAPL', tf: '1', bar: { t: 1, c: 1 } })
      expect(bars.getStatus('AAPL', '1').delivering).toBe(true)
      // A thin ticker with no print for > engage but < disengage must NOT flip (would seam).
      vi.setSystemTime(Date.now() + bars.BARS_LIVE_STALE_MS + 10000)  // ~130s: past engage, under disengage
      expect(bars.getStatus('AAPL', '1').delivering).toBe(true)       // held by hysteresis
      es._emit('bar', { sym: 'AAPL', tf: '1', bar: { t: 2, c: 1 } })  // a late print
      expect(bars.getStatus('AAPL', '1').delivering).toBe(true)       // still live, never flapped
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
      // disengage grace (~312s) — the sweep must still re-notify so the consumer sees the flip.
      for (let i = 0; i < 26; i++) { es._emit('heartbeat'); vi.advanceTimersByTime(12000) }
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

describe('barsStreamManager — optional `final` / `trade_ts` bar fields', () => {
  it('a FINAL bar dispatches immediately and is never coalesced away by a straggler', () => {
    const got = []
    bars.subscribe('AAPL', '5', { onBar: d => got.push(d.bar) })
    flush()
    const es = MockES.instances[0]
    es._open()
    es._emit('bar', { sym: 'AAPL', tf: '5', bar: { t: 1, o: 1, h: 2, l: 1, c: 1.5, v: 10 } })
    es._emit('bar', { sym: 'AAPL', tf: '5', bar: { t: 1, o: 1, h: 2, l: 1, c: 1.6, v: 12, final: true, trade_ts: 1500 } })
    expect(got.length).toBe(1)                       // dispatched without waiting for the throttle
    expect(got[0]).toMatchObject({ final: true, trade_ts: 1500, c: 1.6 })
    es._emit('bar', { sym: 'AAPL', tf: '5', bar: { t: 301, o: 1.6, h: 1.6, l: 1.6, c: 1.6, v: 1 } })
    bars._flushBars()
    expect(got.map(b => b.t)).toEqual([1, 301])      // the superseded non-final frame was dropped
  })

  it('absent fields: legacy {t,o,h,l,c,v} frames pass through unchanged', () => {
    const got = []
    bars.subscribe('AAPL', '5', { onBar: d => got.push(d.bar) })
    flush()
    const es = MockES.instances[0]
    es._open()
    es._emit('bar', { sym: 'AAPL', tf: '5', bar: { t: 1, o: 1, h: 2, l: 1, c: 1.5, v: 10 } })
    bars._flushBars()
    expect(got).toEqual([{ t: 1, o: 1, h: 2, l: 1, c: 1.5, v: 10 }])
  })
})

describe('barsStreamManager — session (60m alignment, per connection)', () => {
  it('ETH 60m rides its own ?session=eth connection; 1-30m and RTH share the default one', () => {
    const rth = []; const eth = []
    bars.subscribe('AAPL', '60', { onBar: d => rth.push(d), session: 'rth' })
    bars.subscribe('AAPL', '60', { onBar: d => eth.push(d), session: 'eth' })
    bars.subscribe('MSFT', '5', { session: 'eth' })   // non-60m normalizes to the default connection
    flush()
    expect(MockES.instances.length).toBe(2)
    const [a, b] = MockES.instances
    expect(a.url).toContain('AAPL:60'); expect(a.url).toContain('MSFT:5'); expect(a.url).not.toContain('session=')
    expect(b.url).toContain('bars=AAPL:60'); expect(b.url).toContain('session=eth'); expect(b.url).not.toContain('@')
    a._open(); b._open()
    b._emit('bar', { sym: 'AAPL', tf: '60', bar: { t: 1, o: 1, h: 1, l: 1, c: 1, v: 1, session: 'eth' } })
    bars._flushBars()
    expect(eth.length).toBe(1)
    expect(rth.length).toBe(0)
    expect(bars.getStatus('AAPL', '60', 'eth').delivering).toBe(true)
    expect(bars.getStatus('AAPL', '60', 'rth').delivering).toBe(false)
  })
})

describe('barsStreamManager — protocol v2 per-key t ordering', () => {
  it('opts in with v=2', () => {
    bars.subscribe('AAPL', '1', {})
    flush()
    expect(MockES.instances[0].url).toContain('v=2')
  })
  it('drops a NON-final frame older than the newest seen; dispatches an older-t FINAL correction', () => {
    const got = []
    bars.subscribe('AAPL', '5', { onBar: d => got.push(d.bar) })
    flush()
    const es = MockES.instances[0]
    es._open()
    es._emit('bar', { sym: 'AAPL', tf: '5', bar: { t: 600, o: 1, h: 1, l: 1, c: 1, v: 1 } })
    bars._flushBars()
    es._emit('bar', { sym: 'AAPL', tf: '5', bar: { t: 300, o: 1, h: 2, l: 1, c: 2, v: 9 } })   // straggler
    bars._flushBars()
    es._emit('bar', { sym: 'AAPL', tf: '5', bar: { t: 300, o: 1, h: 2, l: 1, c: 1.5, v: 9, final: true } })
    bars._flushBars()
    expect(got.map(b => [b.t, !!b.final])).toEqual([[600, false], [300, true]])
  })
})

describe('recovery: reconnectNow and isConnected', () => {
  it('reopens every bucket at once and the reopen gap-backfills each chart', () => {
    vi.useFakeTimers()
    const reconnects = []
    bars.subscribe('AAPL', '5', { onReconnect: (t) => reconnects.push(t) })
    flush()
    const first = MockES.instances[0]
    first._open()
    first._error()
    expect(bars.isConnected()).toBe(false)
    bars.reconnectNow()
    const open = MockES.instances.filter((es) => !es.closed)
    expect(open).toHaveLength(1)
    expect(open[0]).not.toBe(first)
    vi.advanceTimersByTime(20000) // past the 20 s backoff cap: the old backoff timer must not open a second connection
    const still = MockES.instances.filter((es) => !es.closed)
    expect(still).toHaveLength(1)
    expect(still[0]).toBe(open[0])
    still[0]._open()
    expect(bars.isConnected()).toBe(true)
    expect(reconnects.length).toBe(2) // first open, then the recovery reopen
    vi.useRealTimers()
  })

  it('with nothing subscribed there is nothing to wait for', () => {
    expect(bars.isConnected()).toBe(true)
  })
})
