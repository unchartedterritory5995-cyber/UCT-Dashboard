// A DEVICE COPY THAT IS THE WHOLE SERIES NEEDS NO DEEP JOIN (zero-network PR 3.2). The full-depth daily pack holds every
// symbol's whole served series (deviceStore engine `whole`, source.js `wholeFrom`); persist.deviceWhole says so for an
// entry that still starts at that first bar, and the network's `wholeHistory` reads it:
//   W1 (red first) a recent listing (fewer rows than one tail page): no /api/bars-history request, deepPending false
//   W2 the tail asks only the newest EDGE_TAIL_BARS rows of the view's cover (the entry holds every older one)
//   W3 an entry no longer whole (wholeHistory false: rebuilt on another basis) asks its history as before
//   W4 a wholeHistory that throws reads as "not whole" (the join as before), never an error
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRegistry } from './registry'
import { createNetwork, EDGE_TAIL_BARS } from './network'
import { keyOf, ACTION } from './types'
import { fullBarsFor } from '../../utils/barsBackfill'

const T0 = Date.UTC(2026, 10, 10, 15, 0)   // Tue 2026-11-10 10:00 ET
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); localStorage.removeItem('uct.barsHistory.enabled'); localStorage.setItem('uct.barsHistory.bucket', '5') })
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('uct.barsHistory.enabled'); localStorage.removeItem('uct.barsHistory.bucket') })

function weekdays(n, last) {
  const out = []
  const d = new Date(`${last}T00:00:00Z`)
  while (out.length < n) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out.reverse()
}
const unix = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000
const bar = (t, c = 100) => ({ t, o: c, h: c + 1, l: c - 1, c, v: 10 })

function world({ whole = () => false, rows = 120 } = {}) {
  const calls = []
  const days = weekdays(rows, '2026-11-09')
  const request = vi.fn(async (url) => {
    calls.push(url)
    if (url.startsWith('/api/bars-history/')) {
      return { ticker: 'SIM', tf: 'D', sealed: true, last_sealed: '2026-11-09', bars: days.map((t) => bar(t)) }
    }
    const n = Number(/[?&]bars=(\d+)/.exec(url)[1])
    return { ticker: 'SIM', tf: 'D', bars: [...days, '2026-11-10'].slice(-n).map((t) => bar(t)) }
  })
  const registry = createRegistry({ ctx: () => ({ nowMs: Date.now() }) })
  const key = keyOf({ sym: 'SIM', tf: 'D' })
  // the device copy (the whole series of a recent listing), as persist dispatches it
  registry.dispatch(key, { type: ACTION.DEVICE_HIT, key, gen: registry.getSnapshot(key).gen,
    payload: { sym: 'SIM', bars: days.map((d) => bar(unix(d))), saved_at: T0, through: unix('2026-11-10') } })
  const net = createNetwork({ registry, request, isHidden: () => false, onVisible: () => () => {}, wholeHistory: (k) => whole(k, registry) })
  return { calls, request, registry, net, key, first: unix(days[0]) }
}
const histCalls = (w) => w.calls.filter((u) => u.startsWith('/api/bars-history/'))
const startsAtFirst = (first) => (k, reg) => reg.peek(k)?.bars?.[0]?.t <= first

describe('BarStore: a whole device copy needs no deep history join', () => {
  it('W1 (red first) no /api/bars-history request; deepPending false; the entry keeps every row', async () => {
    const w = world()
    const ww = world({ whole: startsAtFirst(unix(weekdays(120, '2026-11-09')[0])) })
    expect(ww.net.deepPending(ww.key)).toBe(false)
    const stop = ww.net.start(ww.key, { depth: fullBarsFor('D') })
    await vi.advanceTimersByTimeAsync(80)
    stop()
    expect(histCalls(ww), 'a whole copy asked its deep history').toEqual([])
    expect(ww.registry.getSnapshot(ww.key).bars[0].t).toBe(ww.first)
    // the control: the same copy not known whole asks it (the join as before)
    expect(w.net.deepPending(w.key)).toBe(true)
    const stop2 = w.net.start(w.key, { depth: fullBarsFor('D') })
    await vi.advanceTimersByTimeAsync(80)
    stop2()
    expect(histCalls(w).length).toBe(1)
  })

  it('W2 a view\'s cover asks only the newest EDGE_TAIL_BARS rows of the origin', async () => {
    const w = world({ whole: startsAtFirst(unix(weekdays(120, '2026-11-09')[0])) })
    await w.net.fetchOnce(w.key, { priority: 'urgent', depth: fullBarsFor('D'), cover: 900 })
    const tail = w.calls.filter((u) => !u.startsWith('/api/bars-history/'))
    expect(tail.length).toBe(1)
    expect(Number(/[?&]bars=(\d+)/.exec(tail[0])[1])).toBe(EDGE_TAIL_BARS)
    expect(histCalls(w)).toEqual([])
    const s = w.registry.getSnapshot(w.key)
    expect(s.bars.length).toBe(120)                              // every device row kept (today's is the developing bar)
    expect(s.bars[0].t).toBe(w.first)
  })

  it('W3 an entry that no longer starts at the series first bar asks its history as before', async () => {
    const w = world({ whole: () => false })
    const stop = w.net.start(w.key, { depth: fullBarsFor('D') })
    await vi.advanceTimersByTimeAsync(80)
    stop()
    expect(histCalls(w).length).toBe(1)
  })

  it('W4 a wholeHistory that throws reads as not whole, never an error', async () => {
    const w = world({ whole: () => { throw new Error('boom') } })
    expect(w.net.deepPending(w.key)).toBe(true)
    const stop = w.net.start(w.key, { depth: fullBarsFor('D') })
    await vi.advanceTimersByTimeAsync(80)
    stop()
    expect(histCalls(w).length).toBe(1)
  })
})
