// The Time & Sales shared pool (TAS under TERM-024): one EventSource per ticker however many panels
// hold it; named events merged into one state; CLOSED-vs-CONNECTING errors told apart; a hidden tab
// holds no stream; Retry reopens; the last one out closes it. The stream is the only thing faked.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { subscribe, retry, getSnapshot, tasStreamUrl, EMPTY_TAPE, _resetForTests } from './timeSalesStreamManager'

class FakeES {
  static all = []
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.listeners = {}
    this.closed = false
    this.onmessage = null
    this.onerror = null
    FakeES.all.push(this)
  }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn) }
  close() { this.closed = true; this.readyState = 2 }
  emit(name, data) {
    const e = { data: JSON.stringify(data) }
    this.readyState = 1
    if (name === 'message') this.onmessage?.(e)
    else (this.listeners[name] || []).forEach((fn) => fn(e))
  }
  fail(readyState) { this.readyState = readyState; this.onerror?.({}) }
}

const P = (seq, p = 10, s = 100) => ({ seq, t: Date.UTC(2026, 9, 12, 14, 30, seq), p, s, d: 'up', b: 0, o: 0, c: [] })
const last = () => FakeES.all[FakeES.all.length - 1]
const latest = (fn) => fn.mock.calls[fn.mock.calls.length - 1][0]

let visibility = 'visible'
const setVisibility = (v) => { visibility = v; document.dispatchEvent(new Event('visibilitychange')) }

beforeEach(() => {
  FakeES.all = []
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  vi.stubGlobal('EventSource', FakeES)
})
afterEach(() => {
  _resetForTests()
  vi.unstubAllGlobals()
  delete document.visibilityState
})

describe('timeSalesStreamManager', () => {
  it('opens ONE stream on the ticker URL and starts connecting with an empty tape', () => {
    const fn = vi.fn()
    subscribe('NVDA', fn)
    expect(FakeES.all).toHaveLength(1)
    expect(last().url).toBe('/api/stream/time-and-sales/NVDA')
    expect(tasStreamUrl('BRK-B')).toBe('/api/stream/time-and-sales/BRK-B')
    expect(latest(fn)).toMatchObject({ status: 'connecting', prints: [], sym: 'NVDA' })
  })

  it('snapshot replaces, a pushed batch merges on top deduplicated, heartbeat keeps it live', () => {
    const fn = vi.fn()
    subscribe('NVDA', fn)
    last().emit('snapshot', { session: 'regular', prints: [P(1)] })
    expect(latest(fn)).toMatchObject({ status: 'live', session: 'regular' })
    expect(latest(fn).lastAt).toBeTruthy()
    last().emit('message', { prints: [P(1), P(2), P(3)] })
    expect(latest(fn).prints.map((r) => r.seq)).toEqual([3, 2, 1])
    expect(latest(fn).session).toBe('regular')   // a batch without a session keeps the last one
    last().emit('heartbeat', { session: 'closed' })
    expect(latest(fn)).toMatchObject({ status: 'live', session: 'closed' })
    expect(getSnapshot('NVDA').prints).toHaveLength(3)
  })

  it('an unparseable message is ignored, not a crash or a wipe', () => {
    const fn = vi.fn()
    subscribe('NVDA', fn)
    last().emit('snapshot', { prints: [P(1)] })
    const before = latest(fn)
    last().onmessage({ data: 'not json' })
    expect(latest(fn)).toBe(before)
  })

  it('two subscribers to one ticker share ONE stream and see the same state; the last one out closes it', () => {
    const a = vi.fn(); const b = vi.fn()
    const offA = subscribe('NVDA', a)
    last().emit('snapshot', { session: 'regular', prints: [P(1)] })
    const offB = subscribe('NVDA', b)
    expect(FakeES.all).toHaveLength(1)
    expect(latest(b)).toBe(latest(a))   // the late joiner gets the current tape at once
    last().emit('message', { prints: [P(2)] })
    expect(latest(a).prints.map((r) => r.seq)).toEqual([2, 1])
    expect(latest(b).prints.map((r) => r.seq)).toEqual([2, 1])
    offA()
    expect(last().closed).toBe(false)
    offB()
    expect(last().closed).toBe(true)
    expect(getSnapshot('NVDA')).toBe(EMPTY_TAPE)
    // Coming back after everyone left opens a fresh stream, not the dead one.
    subscribe('NVDA', vi.fn())
    expect(FakeES.all).toHaveLength(2)
  })

  it('different tickers get different streams', () => {
    subscribe('NVDA', vi.fn())
    subscribe('AMD', vi.fn())
    expect(FakeES.all.map((e) => e.url)).toEqual(['/api/stream/time-and-sales/NVDA', '/api/stream/time-and-sales/AMD'])
  })

  it('a refusal (readyState 2) before hearing anything is FAILED; after hearing, DROPPED; and never retried by itself', () => {
    const fn = vi.fn()
    subscribe('NVDA', fn)
    last().fail(2)
    expect(latest(fn).status).toBe('failed')
    expect(FakeES.all).toHaveLength(1)
    retry('NVDA')
    expect(FakeES.all).toHaveLength(2)
    last().emit('snapshot', { prints: [P(1)] })
    last().fail(2)
    expect(latest(fn).status).toBe('dropped')
    expect(latest(fn).prints).toHaveLength(1)
  })

  it('an error while CONNECTING is the browser reopening: reconnecting, rows kept', () => {
    const fn = vi.fn()
    subscribe('NVDA', fn)
    last().emit('snapshot', { prints: [P(1)] })
    last().fail(0)
    expect(latest(fn).status).toBe('reconnecting')
    expect(latest(fn).prints).toHaveLength(1)
    last().emit('message', { prints: [P(2)] })
    expect(latest(fn).status).toBe('live')
  })

  it('Retry reopens for every subscriber, keeps the rows, and the old stream goes inert', () => {
    const a = vi.fn(); const b = vi.fn()
    subscribe('NVDA', a); subscribe('NVDA', b)
    const first = last()
    first.emit('snapshot', { prints: [P(1)] })
    first.fail(2)
    retry('NVDA')
    expect(first.closed).toBe(true)
    expect(FakeES.all).toHaveLength(2)
    expect(latest(a)).toMatchObject({ status: 'reconnecting' })
    expect(latest(b).prints).toHaveLength(1)
    // A late event from the replaced stream must not touch the state.
    const before = latest(a)
    first.emit('message', { prints: [P(9)] })
    expect(latest(a)).toBe(before)
    retry('NOBODY')   // a no-op when nobody holds the ticker
    expect(FakeES.all).toHaveLength(2)
  })

  it('unavailable is said with its reason, closes the stream, and does not reconnect', () => {
    const fn = vi.fn()
    subscribe('NVDA', fn)
    const es = last()
    es.emit('unavailable', { reason: 'off' })
    expect(latest(fn)).toMatchObject({ status: 'unavailable', reason: 'off' })
    expect(es.closed).toBe(true)
    es.fail(2)   // the close's own error must not overwrite the refusal
    expect(latest(fn).status).toBe('unavailable')
    expect(FakeES.all).toHaveLength(1)
  })

  it('holds no stream while the tab is hidden and reopens on return; unavailable survives a pause', () => {
    const fn = vi.fn()
    subscribe('NVDA', fn)
    last().emit('snapshot', { prints: [P(1)] })
    const first = last()
    setVisibility('hidden')
    expect(first.closed).toBe(true)
    expect(latest(fn)).toMatchObject({ status: 'paused' })
    expect(latest(fn).prints).toHaveLength(1)
    setVisibility('hidden')   // not a transition: nothing happens
    expect(FakeES.all).toHaveLength(1)
    setVisibility('visible')
    expect(FakeES.all).toHaveLength(2)
    expect(latest(fn)).toMatchObject({ status: 'reconnecting' })
    setVisibility('visible')   // not a transition: no second reopen
    expect(FakeES.all).toHaveLength(2)

    last().emit('unavailable', { reason: 'symbol_cap' })
    setVisibility('hidden')
    expect(latest(fn).status).toBe('unavailable')
  })

  it('subscribing while the tab is hidden opens nothing until it is shown', () => {
    visibility = 'hidden'
    const fn = vi.fn()
    subscribe('NVDA', fn)
    expect(FakeES.all).toHaveLength(0)
    expect(latest(fn)).toMatchObject({ status: 'paused', prints: [] })
    setVisibility('visible')
    expect(FakeES.all).toHaveLength(1)
    expect(latest(fn)).toMatchObject({ status: 'connecting' })
  })

  it('the visibility listener lives only while some ticker is held', () => {
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const offA = subscribe('NVDA', vi.fn())
    const offB = subscribe('AMD', vi.fn())
    expect(add.mock.calls.filter(([n]) => n === 'visibilitychange')).toHaveLength(1)
    offA()
    expect(remove.mock.calls.filter(([n]) => n === 'visibilitychange')).toHaveLength(0)
    offB()
    expect(remove.mock.calls.filter(([n]) => n === 'visibilitychange')).toHaveLength(1)
    add.mockRestore(); remove.mockRestore()
  })

  it('without EventSource the tape is failed, not connecting forever', () => {
    vi.stubGlobal('EventSource', undefined)
    const fn = vi.fn()
    subscribe('NVDA', fn)
    expect(latest(fn).status).toBe('failed')
  })
})
