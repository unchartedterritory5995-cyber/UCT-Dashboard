// TERM-054 / FB-D3-01 — the pooled stream managers TRACK the server's event ids
// and PRESENT the newest one when the same subscription reconnects.
//
// Both pools close and re-create their EventSource on error (and on a watchdog
// kill), so the browser's own Last-Event-ID header never fires: the id has to
// ride the reconnect URL as `last_event_id`, and nothing else would carry it.
// Every case here drives the real manager through a fake EventSource that
// delivers MessageEvent-shaped frames (with `lastEventId`) and reads what URL
// the manager actually opened next — never a private field.

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('./realtimeCandle', () => ({
  applyTick: vi.fn(),
  applyBarClose: vi.fn(),
  applyCorrection: vi.fn(),
}))

import * as prices from './priceStreamManager'
import * as bars from './barsStreamManager'
import { deliveryOf } from './panelContract'

class FakeES {
  static instances = []
  constructor(url) {
    this.url = url
    this.listeners = {}
    this.onopen = null
    this.onmessage = null
    this.onerror = null
    this.closed = false
    FakeES.instances.push(this)
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) }
  close() { this.closed = true }
  open() { this.onopen?.() }
  // A frame as the browser hands it over: `data` plus the frame's `id:`.
  message(obj, id) { this.onmessage?.({ data: JSON.stringify(obj), lastEventId: id ?? '' }) }
  emit(type, obj, id) {
    for (const fn of this.listeners[type] || []) fn({ data: JSON.stringify(obj), lastEventId: id ?? '' })
  }
  error() { this.onerror?.() }
}

const live = () => FakeES.instances.filter(es => !es.closed)
const lastUrl = () => FakeES.instances[FakeES.instances.length - 1].url
const param = (url, name) => new URL(url, 'http://x').searchParams.get(name)

beforeEach(() => {
  vi.useFakeTimers()
  FakeES.instances = []
  globalThis.EventSource = FakeES
  try { localStorage.removeItem('uct.barsPool.disabled') } catch { /* ignore */ }
  prices._resetForTests()
  bars._resetForTests()
})

afterEach(() => {
  prices._resetForTests()
  bars._resetForTests()
  vi.useRealTimers()
})

const flushPrices = () => vi.advanceTimersByTime(prices.REBUILD_DEBOUNCE_MS + 10)
// First error backoff is 5 s; advancing past it fires the reconnect.
const passBackoff = () => vi.advanceTimersByTime(5000 + 10)

describe('priceStreamManager — event ids', () => {
  it('a FIRST connection presents no last_event_id (it is not a resume)', () => {
    prices.subscribe(['AAPL'], () => {})
    flushPrices()
    expect(FakeES.instances).toHaveLength(1)
    expect(param(lastUrl(), 'last_event_id')).toBeNull()
    expect(lastUrl()).toBe('/api/stream/prices?tickers=AAPL')
  })

  it('an error reconnect presents the NEWEST id seen, from any kind of frame', () => {
    prices.subscribe(['AAPL'], () => {})
    flushPrices()
    const es = FakeES.instances[0]
    es.open()
    es.message({ AAPL: { price: 1 } }, 'b00t-4')
    es.emit('tick', { sym: 'AAPL', price: 1.1 }, 'b00t-5')
    es.emit('heartbeat', {}, 'b00t-9')   // a heartbeat's id counts too
    es.error()
    passBackoff()
    expect(FakeES.instances).toHaveLength(2)
    expect(param(lastUrl(), 'last_event_id')).toBe('b00t-9')
    expect(param(lastUrl(), 'tickers')).toBe('AAPL')
  })

  it('the watchdog reconnect presents it too', () => {
    prices.subscribe(['AAPL'], () => {})
    flushPrices()
    const es = FakeES.instances[0]
    es.open()
    es.message({ AAPL: { price: 1 } }, 'b00t-2')
    // Silence past the watchdog window forces the reconnect.
    vi.advanceTimersByTime(120000)
    const reopened = live()
    expect(reopened).toHaveLength(1)
    expect(reopened[0]).not.toBe(es)
    expect(param(reopened[0].url, 'last_event_id')).toBe('b00t-2')
  })

  it('a CHANGED union is a new subscription and presents no id', () => {
    prices.subscribe(['AAPL'], () => {})
    flushPrices()
    FakeES.instances[0].open()
    FakeES.instances[0].message({ AAPL: { price: 1 } }, 'b00t-3')
    prices.subscribe(['MSFT'], () => {})
    flushPrices()
    const now = live()
    expect(now).toHaveLength(1)
    expect(param(now[0].url, 'tickers')).toBe('AAPL,MSFT')
    expect(param(now[0].url, 'last_event_id')).toBeNull()
  })

  it('an id is URL-encoded, not pasted raw', () => {
    prices.subscribe(['AAPL'], () => {})
    flushPrices()
    const es = FakeES.instances[0]
    es.open()
    es.message({ AAPL: { price: 1 } }, 'a&b=c')
    es.error()
    passBackoff()
    expect(lastUrl()).toContain('last_event_id=a%26b%3Dc')
    expect(param(lastUrl(), 'last_event_id')).toBe('a&b=c')
  })

  it('a frame from a REPLACED connection does not move the tracked id', () => {
    prices.subscribe(['AAPL'], () => {})
    flushPrices()
    const first = FakeES.instances[0]
    first.open()
    first.message({ AAPL: { price: 1 } }, 'b00t-1')
    first.error()
    passBackoff()
    const second = FakeES.instances[1]
    second.open()
    second.message({ AAPL: { price: 2 } }, 'b00t-7')
    first.message({ AAPL: { price: 3 } }, 'b00t-99')   // a straggler from the dead one
    second.error()
    passBackoff()
    expect(param(lastUrl(), 'last_event_id')).toBe('b00t-7')
  })

  it('the resume declaration is RECORDED and changes no prices; the snapshot after it merges', () => {
    prices.subscribe(['AAPL'], () => {})
    flushPrices()
    const es = FakeES.instances[0]
    es.open()
    es.message({ AAPL: { price: 1 } }, 'b00t-1')
    es.error()
    passBackoff()
    const again = FakeES.instances[1]
    again.open()
    const decl = {
      type: 'resume', stream: 'prices', delivery: 'last-value-wins', resume: 'not_applicable',
      replayed: 0, replay_window_events: 0, last_event_id: 'b00t-1', origin: 'this_process',
      served_instead: 'current_snapshot',
    }
    again.emit('resume', decl, 'b00t-2')
    expect(prices.getLastResume()).toMatchObject({ ...decl, bucket: 'AAPL' })
    expect(prices.getSnapshot().prices.AAPL.price).toBe(1)   // untouched by the declaration
    again.message({ AAPL: { price: 5 } }, 'b00t-3')
    expect(prices.getSnapshot().prices.AAPL.price).toBe(5)
    // …and the declaration's own id is tracked like any frame's.
    again.error()
    passBackoff()
    expect(param(lastUrl(), 'last_event_id')).toBe('b00t-3')
  })
})

describe('barsStreamManager — event ids', () => {
  it('first connection presents none; an error reconnect presents the newest id', () => {
    bars.subscribe('AAPL', '5', {})
    bars._flushRebuild()
    expect(param(lastUrl(), 'last_event_id')).toBeNull()
    const es = FakeES.instances[0]
    es.open()
    es.emit('bar', { sym: 'AAPL', tf: '5', bar: { t: 1, c: 1 } }, 'b00t-11')
    es.emit('heartbeat', {}, 'b00t-12')
    es.error()
    passBackoff()
    expect(FakeES.instances).toHaveLength(2)
    expect(param(lastUrl(), 'bars')).toBe('AAPL:5')
    expect(param(lastUrl(), 'last_event_id')).toBe('b00t-12')
  })

  it('the watchdog reconnect presents it too', () => {
    bars.subscribe('AAPL', '5', {})
    bars._flushRebuild()
    const es = FakeES.instances[0]
    es.open()
    es.emit('heartbeat', {}, 'b00t-4')
    vi.advanceTimersByTime(bars.BARS_WATCHDOG_MS + 10000)
    const reopened = live()
    expect(reopened).toHaveLength(1)
    expect(reopened[0]).not.toBe(es)
    expect(param(reopened[0].url, 'last_event_id')).toBe('b00t-4')
  })

  it('a resume declaration is NOT a bar: no onBar, no delivering flip, recorded', () => {
    const got = []
    bars.subscribe('AAPL', '5', { onBar: d => got.push(d) })
    bars._flushRebuild()
    const es = FakeES.instances[0]
    es.open()
    es.emit('resume', {
      type: 'resume', stream: 'bars', delivery: 'last-value-wins', resume: 'not_applicable',
      replayed: 0, replay_window_events: 0, last_event_id: 'b00t-1', origin: 'this_process',
      served_instead: 'next_bar_per_pair',
    }, 'b00t-2')
    bars._flushBars()
    expect(got).toHaveLength(0)
    expect(bars.getStatus('AAPL', '5').delivering).toBe(false)
    expect(bars.getLastResume()).toMatchObject({ stream: 'bars', resume: 'not_applicable', bucket: 'AAPL:5' })
    // Non-vacuity: a real bar on the same connection DOES reach onBar.
    es.emit('bar', { sym: 'AAPL', tf: '5', bar: { t: 1, c: 1 } }, 'b00t-3')
    bars._flushBars()
    expect(got).toHaveLength(1)
  })
})

describe('the server and the panel contract agree on each stream\'s delivery', () => {
  // The server declares `delivery` in its resume frame from STREAM_DELIVERY in
  // api/routers/stream.py; the client's vocabulary is panelContract.DELIVERY.
  // One fact in two files — read the server's, never restate it here.
  const ROOT = (() => {
    let dir = process.cwd()
    for (let i = 0; i < 8; i += 1) {
      if (fs.existsSync(path.join(dir, 'api', 'routers', 'stream.py'))) return dir
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
    throw new Error(`could not find api/routers/stream.py from ${process.cwd()}`)
  })()
  const src = fs.readFileSync(path.join(ROOT, 'api', 'routers', 'stream.py'), 'utf8')

  it('STREAM_DELIVERY matches deliveryOf() for every stream it names', () => {
    const m = src.match(/^STREAM_DELIVERY\s*=\s*\{([^}]*)\}/m)
    expect(m, 'STREAM_DELIVERY not found in stream.py').not.toBeNull()
    const pairs = [...m[1].matchAll(/"(\w+)"\s*:\s*"([\w-]+)"/g)].map(x => [x[1], x[2]])
    // Non-vacuity: the parse found both streams.
    expect(pairs.map(p => p[0]).sort()).toEqual(['bars', 'prices'])
    for (const [kind, delivery] of pairs) expect(delivery).toBe(deliveryOf(kind))
  })
})
