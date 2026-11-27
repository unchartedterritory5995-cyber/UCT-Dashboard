// ⚡ (2026-11-26) ONE REBUILD TIMER PER BURST, THE SAME RECONNECT. A symbol switch changes many subscriptions of both live
// pools in one task (the chart's writer, the legend, the header price, the rows ahead): each change cleared and re-armed
// the pool's reconnect timer (~4 ms of the 4h board's key task, production build). Now the first change of a burst arms
// it and later changes move the DEADLINE; the timer re-arms at fire time for what is left.
//   R1 (red first) a burst of changes in one task arms the reconnect once
//   R2 the reconnect opens at EXACTLY the moment it did (the last change + the gather on a quiet pool, + the debounce on a
//      busy one), with every live subscription in it: the first live tick can land no later
//   R3 a wall clock set back (or forward) after a change never delays the reconnect past the old moment
//   R4 a reset / flush before the deadline leaves no stray reconnect behind
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { REBUILD_GATHER_MS } from './streamRebuildDelay'
import * as bars from './barsStreamManager'
import * as prices from './priceStreamManager'

class MockES {
  static instances = []
  constructor(url) { this.url = url; this.listeners = {}; this.closed = false; this.at = Date.now(); MockES.instances.push(this) }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) }
  close() { this.closed = true }
}
const live = () => MockES.instances.filter((es) => !es.closed)

describe.each([
  ['barsStreamManager', bars, (sym) => bars.subscribe(sym, '1', {})],
  ['priceStreamManager', prices, (sym) => prices.subscribe([sym], () => {})],
])('%s: one rebuild timer per burst', (_name, mgr, sub) => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockES.instances = []
    globalThis.EventSource = MockES
    try { localStorage.removeItem('uct.barsPool.disabled') } catch { /* ignore */ }
    mgr._resetForTests()
  })
  afterEach(() => { mgr._resetForTests(); vi.useRealTimers() })

  /** Rest the pool past the debounce, so the next change finds it quiet. */
  const rest = () => { vi.advanceTimersByTime(mgr.REBUILD_DEBOUNCE_MS + 50); vi.setSystemTime(Date.now() + 5000) }

  it('R1 (red first) a burst of 20 changes in one task arms the reconnect once', () => {
    rest()
    const set = vi.spyOn(globalThis, 'setTimeout')
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    const uns = []
    for (let i = 0; i < 10; i++) uns.push(sub(`S${i}`))
    for (let i = 0; i < 10; i++) uns[i]()
    const armed = set.mock.calls.length
    const cleared = clear.mock.calls.length
    set.mockRestore(); clear.mockRestore()
    expect(armed, 'timers armed by one burst').toBeLessThanOrEqual(1)
    expect(cleared, 'timers cleared by one burst').toBe(0)
  })

  it('R2 a quiet pool opens at the last change + the gather, a busy one at the last change + the debounce, with every live subscription', () => {
    rest()
    const t0 = Date.now()
    sub('AAA')
    vi.advanceTimersByTime(5)
    sub('BBB')
    vi.advanceTimersByTime(7)
    const un = sub('CCC')
    un()
    sub('DDD')                                                   // the last change: t0 + 12
    const due = t0 + 12 + REBUILD_GATHER_MS
    vi.advanceTimersByTime(due - Date.now() - 1)
    expect(MockES.instances.length, 'opened before the old moment').toBe(0)
    vi.advanceTimersByTime(1)
    expect(MockES.instances.length, 'not open at the old moment').toBe(1)
    expect(MockES.instances[0].at).toBe(due)
    for (const s of ['AAA', 'BBB', 'DDD']) expect(MockES.instances[0].url).toContain(s)
    expect(MockES.instances[0].url).not.toContain('CCC')
    // busy: the pool reconnected a moment ago, so the next changes wait the full debounce from the LAST one
    const t1 = Date.now()
    sub('EEE')
    vi.advanceTimersByTime(100)
    sub('FFF')
    vi.advanceTimersByTime(150)
    sub('GGG')                                                   // the last change: t1 + 250
    const due2 = t1 + 250 + mgr.REBUILD_DEBOUNCE_MS
    const n = MockES.instances.length
    vi.advanceTimersByTime(due2 - Date.now() - 1)
    expect(MockES.instances.length, 'reconnected before the old moment').toBe(n)
    vi.advanceTimersByTime(1)
    expect(MockES.instances.length, 'not reconnected at the old moment').toBeGreaterThan(n)
    expect(MockES.instances.at(-1).at).toBe(due2)
    for (const s of ['AAA', 'BBB', 'DDD', 'EEE', 'FFF', 'GGG']) expect(live().map((es) => es.url).join(' ')).toContain(s)
  })

  it('R2b a gather kept alive by changes inside it opens at the last change + the gather', () => {
    rest()
    const t0 = Date.now()
    for (let i = 0; i < 8; i++) { sub(`G${i}`); vi.advanceTimersByTime(20) }   // every change lands inside the pending gather
    const last = t0 + 7 * 20
    const due = last + REBUILD_GATHER_MS
    vi.advanceTimersByTime(due - Date.now() - 1)
    expect(MockES.instances.length).toBe(0)
    vi.advanceTimersByTime(1)
    expect(MockES.instances.length).toBe(1)
    expect(MockES.instances[0].at).toBe(due)
  })

  it('R3 a wall clock set back or forward after a change never delays the reconnect past the old moment', () => {
    for (const jump of [-3600e3, +3600e3]) {
      mgr._resetForTests(); MockES.instances = []
      rest()
      sub(`J${jump > 0 ? 'F' : 'B'}`)
      vi.setSystemTime(Date.now() + jump)                          // the wall clock moves; the timers do not
      vi.advanceTimersByTime(REBUILD_GATHER_MS)
      expect(MockES.instances.length, `clock ${jump > 0 ? 'forward' : 'back'}: not open by the old moment`).toBe(1)
    }
  })

  it('R4 a reset before the deadline leaves no reconnect behind', () => {
    rest()
    sub('AAA')
    vi.advanceTimersByTime(10)
    sub('BBB')
    mgr._resetForTests()
    vi.advanceTimersByTime(mgr.REBUILD_DEBOUNCE_MS * 3)
    expect(MockES.instances.length).toBe(0)
  })
})
