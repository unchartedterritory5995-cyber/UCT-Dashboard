// ⭐ LEADING EDGE, THEN ONE ANIMATION FRAME (2026-11-25, objective 2). A developing bar used to wait for a
// trailing 250 ms timer; the first frame of a burst now dispatches at once, the rest coalesce to one
// dispatch per pair per animation frame, and a long main-thread task backs the gap off toward the cap.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as bars from './barsStreamManager'

class MockES {
  static instances = []
  constructor(url) { this.url = url; this.listeners = {}; this.onopen = null; this.onerror = null; this.closed = false; MockES.instances.push(this) }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) }
  close() { this.closed = true }
  _open() { if (this.onopen) this.onopen() }
  _emit(type, data) { (this.listeners[type] || []).forEach((fn) => fn({ data: JSON.stringify(data) })) }
}

// a hand-driven animation-frame queue: `frame()` runs what is queued, at the clock it is given
let rafQ = []
const frame = () => { const q = rafQ; rafQ = []; q.forEach(({ cb }) => cb(performance.now())) }
const KEY = 'uct.liveCadenceMs'
let hidden = false

beforeEach(() => {
  MockES.instances = []
  global.EventSource = MockES
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] })
  rafQ = []
  let id = 0
  global.requestAnimationFrame = (cb) => { id += 1; rafQ.push({ id, cb }); return id }
  global.cancelAnimationFrame = (n) => { rafQ = rafQ.filter((x) => x.id !== n) }
  hidden = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  localStorage.removeItem(KEY)
  bars._resetForTests()
})
afterEach(() => {
  bars._resetForTests()
  vi.useRealTimers()
  delete global.requestAnimationFrame
  delete global.cancelAnimationFrame
  localStorage.removeItem(KEY)
  delete document.hidden
})

const open = (sym = 'AAPL', tf = '1') => {
  const got = []
  bars.subscribe(sym, tf, { onBar: (d) => got.push(d.bar.c) })
  bars._flushRebuild()
  const es = MockES.instances[MockES.instances.length - 1]
  es._open()
  return { got, es, dev: (c, t = 1, s = sym) => es._emit('bar', { sym: s, tf, bar: { t, o: 1, h: 1, l: 1, c, v: 1 } }) }
}

describe('developing bars: leading edge, then one dispatch per animation frame', () => {
  it('an isolated developing frame is dispatched at once, not after a hold', () => {
    const { got, dev } = open()
    dev(1.1)
    expect(got).toEqual([1.1])
  })

  it('a burst: the first at once, the rest coalesced to the newest on the next frame', () => {
    const { got, dev } = open()
    dev(1.1); dev(1.2); dev(1.3)
    expect(got).toEqual([1.1])
    vi.advanceTimersByTime(17)
    frame()
    expect(got).toEqual([1.1, 1.3])
    frame()
    expect(got).toEqual([1.1, 1.3])          // nothing left: no duplicate, no further frames asked for
    expect(rafQ.length).toBe(0)
  })

  it('at most one dispatch per pair per frame: a frame inside the gap waits for the next one', () => {
    const { got, dev } = open()
    dev(1.1)
    dev(1.2)
    frame()                                  // the same instant: the 16 ms gap has not passed
    expect(got).toEqual([1.1])
    vi.advanceTimersByTime(16)
    frame()
    expect(got).toEqual([1.1, 1.2])
  })

  it('each pair has its own leading edge', () => {
    const a = []; const b = []
    bars.subscribe('AAPL', '1', { onBar: (d) => a.push(d.bar.c) })
    bars.subscribe('MSFT', '1', { onBar: (d) => b.push(d.bar.c) })
    bars._flushRebuild()
    const es = MockES.instances[MockES.instances.length - 1]
    es._open()
    es._emit('bar', { sym: 'AAPL', tf: '1', bar: { t: 1, o: 1, h: 1, l: 1, c: 1.1, v: 1 } })
    es._emit('bar', { sym: 'MSFT', tf: '1', bar: { t: 1, o: 2, h: 2, l: 2, c: 2.1, v: 1 } })
    expect(a).toEqual([1.1])
    expect(b).toEqual([2.1])
  })

  it('a pair quiet for longer than the gap dispatches its next frame at once', () => {
    const { got, dev } = open()
    dev(1.1)
    vi.advanceTimersByTime(40)
    dev(1.2)
    expect(got).toEqual([1.1, 1.2])
  })

  it('a final bar still goes at once, and replaces what was pending for its bucket', () => {
    const { got, es, dev } = open()
    dev(1.1); dev(1.2)
    es._emit('bar', { sym: 'AAPL', tf: '1', bar: { t: 1, o: 1, h: 1, l: 1, c: 1.25, v: 2, final: true } })
    expect(got).toEqual([1.1, 1.25])
    vi.advanceTimersByTime(20); frame()
    expect(got).toEqual([1.1, 1.25])
  })

  it('a hidden page (no animation frames) flushes what is pending on a timer at the cap', () => {
    const { got, dev } = open()
    hidden = true
    dev(1.1); dev(1.2)
    expect(got).toEqual([1.1])
    expect(rafQ.length).toBe(0)
    vi.advanceTimersByTime(249)
    expect(got).toEqual([1.1])
    vi.advanceTimersByTime(1)
    expect(got).toEqual([1.1, 1.2])
  })
})

describe('the draw-cost guard: a long main-thread task backs the gap off toward the cap', () => {
  it('after long tasks the gap reaches the cap (250 ms) and a burst is held that long', () => {
    const { got, dev } = open()
    for (let i = 0; i < 5; i++) bars._noteLongTask(80, performance.now())
    dev(1.1); dev(1.2)
    expect(got).toEqual([1.1])
    vi.advanceTimersByTime(200); frame()
    expect(got).toEqual([1.1])                 // 200 ms < the 250 ms gap
    vi.advanceTimersByTime(50); frame()
    expect(got).toEqual([1.1, 1.2])
  })

  it('a task under 50 ms is not a long task', () => {
    const { got, dev } = open()
    bars._noteLongTask(30, performance.now())
    dev(1.1); dev(1.2)
    vi.advanceTimersByTime(17); frame()
    expect(got).toEqual([1.1, 1.2])
  })

  it('the gap recovers after quiet time: halved every 2 s without a long task', () => {
    const { got, dev } = open()
    for (let i = 0; i < 5; i++) bars._noteLongTask(80, performance.now())
    vi.advanceTimersByTime(bars.LONG_TASK_RECOVER_MS * 5)   // 250 -> 125 -> 62.5 -> 31 -> 16
    dev(1.1); dev(1.2)
    vi.advanceTimersByTime(17); frame()
    expect(got).toEqual([1.1, 1.2])
  })

  it('the per-browser cap (uct.liveCadenceMs) bounds the backoff', () => {
    localStorage.setItem(KEY, '100')
    const { got, dev } = open()
    for (let i = 0; i < 5; i++) bars._noteLongTask(80, performance.now())
    dev(1.1); dev(1.2)
    vi.advanceTimersByTime(99); frame()
    expect(got).toEqual([1.1])
    vi.advanceTimersByTime(1); frame()
    expect(got).toEqual([1.1, 1.2])
  })
})
