// Pushed list prices, the client half (lib/quotePush.js): one pooled EventSource on /api/stream/quotes,
// frames batched onto the next animation frame, behind a client flag and a kill switch.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as qp from './quotePush'

class FakeEventSource {
  static instances = []
  constructor(url) {
    this.url = url
    this.listeners = {}
    this.closed = false
    FakeEventSource.instances.push(this)
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) }
  close() { this.closed = true }
  emitOpen() { this.onopen?.() }
  frame(arr) { this.onmessage?.({ data: JSON.stringify(arr) }) }
  emitEvent(type, obj) { for (const fn of this.listeners[type] || []) fn({ data: JSON.stringify(obj) }) }
  emitError() { this.onerror?.() }
}
const open = () => FakeEventSource.instances.filter((e) => !e.closed)

let rafQueue = []
function runFrame() {
  const q = rafQueue
  rafQueue = []
  for (const cb of q) cb(performance.now())
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeEventSource.instances = []
  globalThis.EventSource = FakeEventSource
  rafQueue = []
  globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length }
  globalThis.cancelAnimationFrame = () => {}
  localStorage.clear()
  document.cookie = 'uct_quote_push=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  qp._resetForTests()
})

afterEach(() => {
  qp._resetForTests()
  vi.useRealTimers()
})

const settle = () => vi.advanceTimersByTime(qp.SET_DEBOUNCE_MS + 5)

describe('the flag', () => {
  it('is OFF by default: no connection is opened', () => {
    qp.setTickers('rest', ['AAPL'])
    settle()
    expect(FakeEventSource.instances).toHaveLength(0)
    expect(qp.isHealthy()).toBe(false)
  })

  it('the client key turns it on: one connection on the quotes path carrying the sorted union of every owner', () => {
    localStorage.setItem('uct.quotePush', '1')
    qp.setTickers('rest', ['msft', 'AAPL'])
    qp.setTickers('stream', ['AAPL', 'NVDA'])
    settle()
    expect(open()).toHaveLength(1)
    expect(open()[0].url).toBe('/api/stream/quotes?tickers=AAPL,MSFT,NVDA')
  })

  it('the cookie turns it on too', () => {
    document.cookie = 'uct_quote_push=1'
    qp.setTickers('rest', ['AAPL'])
    settle()
    expect(open()).toHaveLength(1)
  })

  it('the kill switch beats the flag', () => {
    localStorage.setItem('uct.quotePush', '1')
    localStorage.setItem('uct.quotePush.disabled', '1')
    qp.setTickers('rest', ['AAPL'])
    settle()
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('a union over the per-connection cap is split, never truncated', () => {
    localStorage.setItem('uct.quotePush', '1')
    const many = Array.from({ length: qp.MAX_QUOTE_SYMBOLS + 10 }, (_, i) => `T${String(i).padStart(4, '0')}`)
    qp.setTickers('rest', many)
    settle()
    expect(open()).toHaveLength(2)
    const n = open().map((e) => e.url.split('=')[1].split(',').length)
    expect(n[0] + n[1]).toBe(qp.MAX_QUOTE_SYMBOLS + 10)
    expect(Math.max(...n)).toBeLessThanOrEqual(qp.MAX_QUOTE_SYMBOLS)
  })

  it('an emptied union closes the connection', () => {
    localStorage.setItem('uct.quotePush', '1')
    qp.setTickers('rest', ['AAPL'])
    settle()
    qp.setTickers('rest', [])
    settle()
    expect(open()).toHaveLength(0)
  })
})

describe('frames -> the next animation frame', () => {
  it('a frame is held until the next animation frame, then every symbol lands in ONE batch, latest wins', () => {
    localStorage.setItem('uct.quotePush', '1')
    const seen = []
    qp.onQuotes((batch) => seen.push(batch))
    qp.setTickers('rest', ['AAPL', 'MSFT'])
    settle()
    const es = open()[0]
    es.emitOpen()
    es.frame(['AAPL', 100.5, 1000, 1_700_000_000_000, 1_700_000_000_050])
    es.frame(['MSFT', 400.25, 2000, 1_700_000_000_010, 1_700_000_000_050])
    es.frame(['AAPL', 100.75, 1100, 1_700_000_000_020, 1_700_000_000_060])
    vi.advanceTimersByTime(1000)             // no timer publishes it: only a frame does
    expect(seen).toHaveLength(0)
    runFrame()
    expect(seen).toHaveLength(1)
    expect(seen[0].AAPL).toMatchObject({ price: 100.75, volume: 1100, trade_ts: 1_700_000_000_020 })
    expect(seen[0].MSFT).toMatchObject({ price: 400.25 })
    expect(qp.getPushedQuote('AAPL').price).toBe(100.75)
  })

  it('parseFrame refuses anything that is not a priced quote', () => {
    expect(qp.parseFrame('["AAPL",1.5,10,1700000000000,1700000000001]')).toMatchObject({ sym: 'AAPL', price: 1.5 })
    for (const bad of ['{}', '[]', '["AAPL",0,1,2,3]', '["AAPL",-1,1,2,3]', '["AAPL","x",1,2,3]', 'nope', '[1,2,3,4,5]']) {
      expect(qp.parseFrame(bad)).toBeNull()
    }
  })
})

describe('health', () => {
  function live() {
    localStorage.setItem('uct.quotePush', '1')
    qp.setTickers('rest', ['AAPL'])
    settle()
    const es = open()[0]
    es.emitOpen()
    es.emitEvent('status', { live: true })
    return es
  }

  it('an open stream whose feed is live is healthy', () => {
    live()
    expect(qp.isHealthy()).toBe(true)
  })

  it('the server saying live:false is unhealthy at once, and says so', () => {
    const changes = []
    qp.onHealth((h) => changes.push(h))
    const es = live()
    es.emitEvent('status', { live: false })
    expect(qp.isHealthy()).toBe(false)
    expect(changes).toContain(false)
  })

  it('an error is unhealthy at once', () => {
    const es = live()
    es.emitError()
    expect(qp.isHealthy()).toBe(false)
  })

  it('silence past the watchdog is unhealthy and reconnects', () => {
    live()
    vi.advanceTimersByTime(60_000)
    expect(qp.isHealthy()).toBe(false)
    expect(FakeEventSource.instances.length).toBeGreaterThan(1)
  })
})

describe('overlayPushed (what a REST-shaped list row shows)', () => {
  const rest = { price: 100, change_pct: 1, change: 1, prev_close: 99, volume: 500, ext_session: null }

  it('in the regular session: the pushed price and volume, the day % recomputed from the official prev close', () => {
    const out = qp.overlayPushed(rest, { price: 101.98, volume: 900, trade_ts: 1_700_000_000_000 })
    expect(out.price).toBe(101.98)
    expect(out.volume).toBe(900)
    expect(out.change_pct).toBeCloseTo(3.0101, 3)
    expect(out.push_ts).toBe(1_700_000_000_000)
  })

  it('in an extended session: the frozen regular-session price stays, the pushed print becomes ext_price', () => {
    const ext = { ...rest, ext_session: 'post_market', ext_price: 100.1 }
    const out = qp.overlayPushed(ext, { price: 102, volume: 900, trade_ts: 1_700_000_000_000 })
    expect(out.price).toBe(100)
    expect(out.ext_price).toBe(102)
    expect(out.change_pct).toBe(1)
  })

  it('a push that changes nothing returns the same entry (no render)', () => {
    const same = qp.overlayPushed(rest, { price: 100, volume: 500, trade_ts: 1 })
    expect(same).toBe(rest)
  })
})
