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
  // one write = one message: [server write ms, quote, quote, ...] (api/services/quote_hub.py)
  frame(...quotes) { this.onmessage?.({ data: JSON.stringify([1_700_000_000_090, ...quotes]) }) }
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
    expect(open()[0].url).toBe('/api/stream/quotes?tickers=AAPL,MSFT,NVDA&v=2')
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
    const n = open().map((e) => e.url.split('tickers=')[1].split('&')[0].split(',').length)
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
    es.emitEvent('hello', { v: 2, symbols: 1 })
    es.frame(['AAPL', 100.5, 1000, 1_700_000_000_000])
    es.frame(['MSFT', 400.25, 2000, 1_700_000_000_010])
    es.frame(['AAPL', 100.75, 1100, 1_700_000_000_020])
    vi.advanceTimersByTime(1000)             // no timer publishes it: only a frame does
    expect(seen).toHaveLength(0)
    runFrame()
    expect(seen).toHaveLength(1)
    expect(seen[0].AAPL).toMatchObject({ price: 100.75, volume: 1100, trade_ts: 1_700_000_000_020 })
    expect(seen[0].MSFT).toMatchObject({ price: 400.25 })
    expect(qp.getPushedQuote('AAPL').price).toBe(100.75)
  })

  it('parseMessage reads [write ms, quote...] and drops anything that is not a priced quote', () => {
    const m = qp.parseMessage('[1700000000090,["AAPL",1.5,10,1700000000000],["MSFT",0,1,2],["NVDA",2.5,20,1700000000001]]')
    expect(m.sentMs).toBe(1700000000090)
    expect(m.quotes.map((q) => q.sym)).toEqual(['AAPL', 'NVDA'])
    expect(m.quotes[0]).toMatchObject({ sym: 'AAPL', price: 1.5, volume: 10, trade_ts: 1700000000000 })
    for (const bad of ['{}', '[]', 'nope', '["AAPL",1,2,3]', '["x"]']) {
      expect(qp.parseMessage(bad)).toBeNull()
    }
  })

  it('one message carrying several quotes lands them all in the same frame batch', () => {
    localStorage.setItem('uct.quotePush', '1')
    const seen = []
    qp.onQuotes((batch) => seen.push(batch))
    qp.setTickers('rest', ['AAPL', 'MSFT'])
    settle()
    const es = open()[0]
    es.emitOpen()
    es.emitEvent('hello', { v: 2, symbols: 1 })
    es.frame(['AAPL', 101, 10, 1_700_000_000_000], ['MSFT', 401, 20, 1_700_000_000_001])
    runFrame()
    expect(seen).toHaveLength(1)
    expect(Object.keys(seen[0]).sort()).toEqual(['AAPL', 'MSFT'])
  })
})

describe('health', () => {
  function live() {
    localStorage.setItem('uct.quotePush', '1')
    qp.setTickers('rest', ['AAPL'])
    settle()
    const es = open()[0]
    es.emitOpen()
    es.emitEvent('hello', { v: 2, symbols: 1 })
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

describe('a resubscribe does not drop the push (review D)', () => {
  it('adding a ticker keeps health and pushed quotes, and keeps the old connection until the new one opens', () => {
    localStorage.setItem('uct.quotePush', '1')
    const health = []
    qp.onHealth((h) => health.push(h))
    qp.setTickers('rest', ['AAPL'])
    settle()
    const first = open()[0]
    first.emitOpen()
    first.emitEvent('hello', { v: 2, symbols: 1 })
    first.emitEvent('status', { live: true })
    first.frame(['AAPL', 100.5, 1000, 1_700_000_000_000])
    runFrame()
    qp.setTickers('rest', ['AAPL', 'MSFT'])
    settle()
    expect(qp.isHealthy()).toBe(true)
    expect(health).not.toContain(false)
    expect(qp.getPushedQuote('AAPL')?.price).toBe(100.5)
    expect(first.closed).toBe(false)                    // make before break
    const second = open().find((e) => e !== first)
    expect(second.url).toBe('/api/stream/quotes?tickers=AAPL,MSFT&v=2')
    second.emitOpen()
    second.emitEvent('hello', { v: 2, symbols: 1 })
    second.emitEvent('status', { live: true })
    expect(first.closed).toBe(true)
    expect(qp.isHealthy()).toBe(true)
    expect(health).not.toContain(false)
  })

  it('a replacement that never opens stops counting as healthy once its grace ends', () => {
    localStorage.setItem('uct.quotePush', '1')
    qp.setTickers('rest', ['AAPL'])
    settle()
    const first = open()[0]
    first.emitOpen()
    first.emitEvent('hello', { v: 2, symbols: 1 })
    first.emitEvent('status', { live: true })
    qp.setTickers('rest', ['AAPL', 'MSFT'])
    settle()
    expect(qp.isHealthy()).toBe(true)
    vi.advanceTimersByTime(qp.RESUBSCRIBE_GRACE_MS + 50)
    expect(qp.isHealthy()).toBe(false)
  })
})

describe('before arming (review of #2751, round 2)', () => {
  function up(tickers = ['AAPL']) {
    localStorage.setItem('uct.quotePush', '1')
    qp.setTickers('rest', tickers)
    settle()
    const es = open()[0]
    es.emitOpen()
    es.emitEvent('status', { live: true })
    return es
  }

  it('a connection is healthy only after the server says hello on THIS wire version', () => {
    const es = up()
    expect(qp.isHealthy()).toBe(false)                      // open + live, but no hello yet
    es.emitEvent('hello', { v: 1, symbols: 1 })
    expect(qp.isHealthy()).toBe(false)                      // another version: unhealthy, so REST polls
    es.emitEvent('hello', { v: qp.WIRE_VERSION, symbols: 1 })
    expect(qp.isHealthy()).toBe(true)
    expect(es.url).toContain('&v=2')
  })

  it('a pushed quote OLDER than the one held is dropped (two connections overlapping)', () => {
    const es = up(['AAPL'])
    es.emitEvent('hello', { v: 2, symbols: 1 })
    const seen = []
    qp.onQuotes((b) => seen.push(b))
    es.frame(['AAPL', 101, 10, 1_700_000_000_020])
    es.frame(['AAPL', 100, 9, 1_700_000_000_010])           // the other connection's slower copy
    runFrame()
    expect(seen.at(-1).AAPL.price).toBe(101)
    es.frame(['AAPL', 99, 8, 1_700_000_000_005])            // older than what is held: no batch at all
    runFrame()
    expect(qp.getPushedQuote('AAPL').price).toBe(101)
    expect(seen).toHaveLength(1)
  })

  it('long frames back the commits off toward ~4 Hz, and quiet frames bring them back to every frame', () => {
    const es = up(['AAPL'])
    es.emitEvent('hello', { v: 2, symbols: 1 })
    const seen = []
    qp.onQuotes((b) => seen.push(b))
    for (let i = 0; i < 20; i++) {
      es.frame(['AAPL', 100 + i, 10 + i, 1_700_000_000_000 + i])
      vi.advanceTimersByTime(80)                            // the frame came 80 ms late: a long frame
      runFrame()
      vi.advanceTimersByTime(20)
    }
    expect(seen.length).toBeLessThanOrEqual(10)             // coalesced, not one commit per frame
    expect(qp.getCommitGapMs()).toBeGreaterThan(0)
    expect(qp.getCommitGapMs()).toBeLessThanOrEqual(qp.COMMIT_GAP_CAP_MS)
    expect(qp.COMMIT_GAP_CAP_MS).toBe(250)
    for (let i = 0; i < 10; i++) { vi.advanceTimersByTime(qp.LONG_FRAME_RECOVER_MS); runFrame() }
    expect(qp.getCommitGapMs()).toBe(0)
    const n = seen.length
    es.frame(['AAPL', 200, 99, 1_700_000_001_000])
    runFrame()                                              // quiet again: committed in the very next frame
    expect(seen.length).toBe(n + 1)
    expect(seen.at(-1).AAPL.price).toBe(200)
  })
})

describe('late sinks (review of #2775)', () => {
  function upReady(tickers = ['AAPL']) {
    localStorage.setItem('uct.quotePush', '1')
    qp.setTickers('rest', tickers)
    settle()
    const es = open()[0]
    es.emitOpen()
    es.emitEvent('hello', { v: 2, symbols: 1 })
    es.emitEvent('status', { live: true })
    return es
  }

  it('a sink that subscribes while the push is running gets the held quotes on the next frame', () => {
    const es = upReady(['AAPL', 'MSFT'])
    es.frame(['AAPL', 101, 10, 1_700_000_000_000], ['MSFT', 401, 20, 1_700_000_000_001])
    runFrame()
    const late = []
    qp.onQuotes((b) => late.push(b))
    expect(late).toHaveLength(0)                            // never inside the subscribe call (it may be an effect)
    runFrame()
    expect(late).toHaveLength(1)
    expect(late[0].AAPL.price).toBe(101)
    expect(late[0].MSFT.price).toBe(401)
  })

  it('nothing is replayed when the push holds nothing', () => {
    upReady(['AAPL'])
    const late = []
    qp.onQuotes((b) => late.push(b))
    runFrame()
    expect(late).toHaveLength(0)
  })

  it('a keyed sink registered again (a dev hot reload of its store) replaces the old one, never doubles', () => {
    const es = upReady(['AAPL'])
    const a = []
    const b = []
    qp.onQuotes((x) => a.push(x), 'store')
    qp.onQuotes((x) => b.push(x), 'store')
    const h1 = []
    const h2 = []
    qp.onHealth((x) => h1.push(x), 'store')
    qp.onHealth((x) => h2.push(x), 'store')
    es.frame(['AAPL', 101, 10, 1_700_000_000_000])
    runFrame()
    expect(a).toHaveLength(0)
    expect(b).toHaveLength(1)
    es.emitEvent('status', { live: false })
    expect(h1).toHaveLength(0)
    expect(h2).toEqual([false])
  })
})

describe('the stats a live measurement reads (window.__uctQuotePush)', () => {
  it('getPushStats carries the commit gap in force (0 when calm, the backed-off gap under long frames)', () => {
    localStorage.setItem('uct.quotePush', '1')
    qp.setTickers('rest', ['AAPL'])
    settle()
    const es = open()[0]
    es.emitOpen()
    es.emitEvent('hello', { v: 2, symbols: 1 })
    es.emitEvent('status', { live: true })
    expect(qp.getPushStats().commitGapMs).toBe(0)
    for (let i = 0; i < 4; i++) {
      es.frame(['AAPL', 100 + i, 10 + i, 1_700_000_000_000 + i])
      vi.advanceTimersByTime(80)                            // a long frame
      runFrame()
      vi.advanceTimersByTime(20)
    }
    const gap = qp.getPushStats().commitGapMs
    expect(gap).toBeGreaterThan(0)
    expect(gap).toBe(qp.getCommitGapMs())
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

  it('a REST row NEWER than the pushed trade keeps its own price (review A)', () => {
    const t = 1_700_000_000_000
    const byObs = { ...rest, price: 100.4, observed_at: (t + 5000) / 1000 }
    expect(qp.overlayPushed(byObs, { price: 101, volume: 900, trade_ts: t })).toBe(byObs)
    const byTrade = { ...rest, price: 100.4, last_trade_ms: t + 1, observed_at: (t - 9000) / 1000 }
    expect(qp.overlayPushed(byTrade, { price: 101, volume: 900, trade_ts: t })).toBe(byTrade)
    const older = { ...rest, price: 100.4, last_trade_ms: t - 1, observed_at: (t + 5000) / 1000 }
    expect(qp.overlayPushed(older, { price: 101, volume: 900, trade_ts: t }).price).toBe(101)
  })

  it('a push that changes nothing returns the same entry (no render)', () => {
    const same = qp.overlayPushed(rest, { price: 100, volume: 500, trade_ts: 1 })
    expect(same).toBe(rest)
  })
})
