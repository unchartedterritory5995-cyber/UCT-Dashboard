// The deep daily history is asked ONCE PER PAGE while the entry still holds it (2026-11-27, chart speed). The history
// job was queued from a tail answer whenever the key's depth stayed under `fullBarsFor('D')` (12,500, about 50 years):
// almost no name has that much daily history, so after a join the only stop was `histAsked`, which lives on the
// network record, and the record goes when the last chart leaves the key. Every return to a board (and every press
// back to a symbol) re-asked /api/bars-history, re-parsed it, and joined nothing older. The page's `deepSettled` (the
// depth each join settled at) is now the one authority for "is the deep history due": the trigger and `deepPending`
// read it through one helper.
//   D1 (red first) a chart that leaves the key and comes back on this page: no second history request, and the
//      entry holds exactly the bars it held before
//   D2 an entry reset since the join (invalidated: a basis, cache_key or history change resets the same way) asks again
//   D3 an entry rebuilt deeper than first paint but shallower than the join (a saved copy) asks again
//   D4 a page with no join of its own (a new network on a registry still holding the deep copy) asks, as today
//   D5 a failed join (settled at the tail's depth) whose entry is rebuilt shallow asks again
//   D6 (red first, review of #2869) a join that ended in an error records no depth: an entry deeper than first paint
//      (a saved copy) whose history and full-read recovery both failed asks again in the next key life
//   D7 a display waiting on the join is released on a failed join too (not after its timeout)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRegistry } from './registry'
import { createNetwork } from './network'
import { keyOf, ACTION } from './types'
import { fullBarsFor, dateFirstPageFor } from '../../utils/barsBackfill'
// (2026-11-27, #2934) the D tail's first page is a covering page (DATE_FIRST_PAGE): a saved copy DEEPER than it is the
// case these rails are about, and the full-read recovery is any ask past it
const FIRST = dateFirstPageFor('D')
const SAVED = FIRST + 400

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
const bar = (t, c = 100) => ({ t, o: c, h: c + 1, l: c - 1, c, v: 10 })

function world({ history = 'ok', full = 'ok' } = {}) {
  const calls = []
  const request = vi.fn(async (url) => {
    calls.push(url)
    if (url.startsWith('/api/bars-history/')) {
      if (history === 'throw') throw Object.assign(new Error('edge down'), { status: 502 })
      return { ticker: 'SIM', tf: 'D', sealed: true, last_sealed: '2026-11-09', bars: weekdays(3000, '2026-11-09').map((t) => bar(t)) }
    }
    const n = Number(/[?&]bars=(\d+)/.exec(url)[1])
    if (full === 'throw' && n > FIRST) throw Object.assign(new Error('origin down'), { status: 502 })
    return { ticker: 'SIM', tf: 'D', bars: weekdays(Math.min(n, 3001), '2026-11-10').map((t) => bar(t)) }
  })
  const registry = createRegistry({ ctx: () => ({ nowMs: Date.now() }) })
  const net = createNetwork({ registry, request, isHidden: () => false, onVisible: () => () => {} })
  const key = keyOf({ sym: 'SIM', tf: 'D' })
  return { calls, request, registry, net, key, depth: fullBarsFor('D') }
}
const histCalls = (w) => w.calls.filter((u) => u.startsWith('/api/bars-history/'))

/** A chart on the key for `ms`, then gone (its record goes with it). */
async function visit(w, net = w.net, ms = 50) {
  const stop = net.start(w.key, { depth: w.depth })
  await vi.advanceTimersByTimeAsync(ms)
  stop()
  await vi.advanceTimersByTimeAsync(1)
}

describe('BarStore deep daily history: once per page while held', () => {
  it('D1 (red first) leaving the key and coming back asks no second history; the bars are the same', async () => {
    const w = world()
    await visit(w)
    expect(histCalls(w).length).toBe(1)
    const before = w.registry.getSnapshot(w.key)
    expect(before.depth).toBe(3000)
    await visit(w)
    expect(histCalls(w).length, 'the return asked the deep history again').toBe(1)
    const after = w.registry.getSnapshot(w.key)
    expect(after.bars.map((b) => [b.t, b.c])).toEqual(before.bars.map((b) => [b.t, b.c]))
  })

  it('D2 an entry reset since the join asks again', async () => {
    const w = world()
    await visit(w)
    w.registry.invalidate(w.key, 'test-reset')
    await visit(w)
    expect(histCalls(w).length).toBe(2)
    expect(w.registry.getSnapshot(w.key).depth).toBe(3000)
  })

  it('D3 an entry rebuilt deeper than first paint but shallower than the join asks again', async () => {
    const w = world()
    await visit(w)
    w.registry.invalidate(w.key, 'test-reset')
    w.registry.dispatch(w.key, { type: ACTION.IDB_HIT, key: w.key, payload: { bars: weekdays(SAVED, '2026-11-09').map((t) => bar(t)) } })
    await visit(w)
    expect(histCalls(w).length, 'a copy deeper than the first page, under a 3000-bar join, was read as joined').toBe(2)
    expect(w.registry.getSnapshot(w.key).depth).toBe(3000)
  })

  it('D4 a page with no join of its own asks, as today', async () => {
    const w = world()
    await visit(w)
    const net2 = createNetwork({ registry: w.registry, request: w.request, isHidden: () => false, onVisible: () => () => {} })
    await visit(w, net2)
    expect(histCalls(w).length).toBe(2)
  })

  it('D5 a failed join whose entry is rebuilt shallow asks again', async () => {
    const w = world({ history: 'throw' })
    await visit(w, w.net, 200)
    const asked = histCalls(w).length
    expect(asked).toBe(1)
    w.registry.invalidate(w.key, 'test-reset')
    await visit(w, w.net, 200)
    expect(histCalls(w).length, 'a failed join read as joined after a shallow rebuild').toBe(2)
  })

  it('D6 (red first) a join that ended in an error records no depth: the next key life asks again', async () => {
    const w = world({ history: 'throw', full: 'throw' })
    w.registry.dispatch(w.key, { type: ACTION.IDB_HIT, key: w.key, payload: { bars: weekdays(SAVED, '2026-11-09').map((t) => bar(t)) } })
    await visit(w, w.net, 200)
    expect(histCalls(w).length).toBe(1)
    expect(w.registry.getSnapshot(w.key).depth).toBe(SAVED)
    await visit(w, w.net, 200)
    expect(histCalls(w).length, 'the depth of a failed join read as joined in the next key life').toBe(2)
  })

  it('D7 a display waiting on the join is released when the join fails', async () => {
    const w = world({ history: 'throw' })
    const stop = w.net.start(w.key, { depth: w.depth })
    let got = 'waiting'
    w.net.deepJoined(w.key, 5000).then((v) => { got = v })
    await vi.advanceTimersByTimeAsync(200)
    expect(got, 'the waiter was held to its timeout by a failed join').toBe(true)
    stop()
  })
})
