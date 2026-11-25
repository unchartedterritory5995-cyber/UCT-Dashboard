// ⭐ THE LIST'S FIRST SELECTION OPENS THE HOLD'S WINDOW (2026-11-25). Live session 2026-11-24 (production 2575075701, 1m +
// 15m, S&P 500): the first press of both runs (RDDT) waited 76-97 ms. The member's first selection (a click on the first
// row) opened nothing (`selSeen`), so the next row kept the copy the list warm read 60-100 s earlier, two buckets behind,
// and the first arrow press asked for it. Now the first selection opens the window like a change does.
//   F3  the first selection asks at once a tail row behind the clock (and keeps the tail current from there)
//   F3b (control) a `set` with no selection (the list's rows only) opens nothing
//   F3c (control) a live re-sort with the SAME selection asks nothing more (one ask per row per bucket, as before)
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const at = (h, m, s = 0) => (OPEN + ((h * 60 + m) - (9 * 60 + 30)) * 60 + s) * 1000   // ET wall clock on Tue 2026-11-10
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  fakeDb._clear()
  vi.useFakeTimers()
  localStorage.setItem('barspack.version', 'test')
})
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version') })

async function boot(mode) {
  vi.resetModules()
  const server = installFakeBarsServer({ modeFor: () => mode })
  const { createBarStore } = await import('./index')
  const P = await import('./prefetch')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const pf = P.createPrefetch({ store, tickerMeta: () => {}, extended: () => false, visible: () => true, random: () => 0, deepNeighbors: () => false })
  return { server, store, P, pf }
}
const tick = (ms) => vi.advanceTimersByTimeAsync(ms)
async function warmAll(w, syms) {
  const p = w.pf.prefetch(syms.map((s) => w.pf.keyFor(s, '1')), { priority: 'urgent' })
  await tick(130)
  await w.server.drain()
  await p
}
const asksOf = (w, sym, from) => w.server.calls.slice(from).filter((c) => c.q.sym === sym && c.q.tf === '1').length

describe('the list\'s first selection opens the hold\'s window', () => {
  it('F3 the first selection asks at once a tail row behind the clock', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('closed')                          // answers end at the last CLOSED minute
    await warmAll(w, ['AAA', 'BBB'])
    vi.setSystemTime(at(10, 1, 1))                          // the list warm's copies are one bucket behind now
    const hold = w.pf.createNeighborHold()
    const n0 = w.server.calls.length
    hold.set(['X', 'AAA', 'BBB'], '1', { tail: ['AAA', 'BBB'], selected: 'X' })   // the member's first selection
    await tick(20)
    await w.server.drain()
    expect(asksOf(w, 'AAA', n0), 'the first selection left the next row behind until the first press').toBe(1)
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(true)
    hold.clear()
    w.store.dispose()
  })

  it('F3b (control) a set with no selection opens nothing', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('closed')
    await warmAll(w, ['AAA'])
    vi.setSystemTime(at(10, 1, 1))
    const hold = w.pf.createNeighborHold()
    const n0 = w.server.calls.length
    hold.set(['X', 'AAA'], '1', { tail: ['AAA'] })
    await tick(15_000)
    await w.server.drain()
    expect(asksOf(w, 'AAA', n0)).toBe(0)
    hold.clear()
    w.store.dispose()
  })

  it('F3c (control) a re-sort with the same selection asks nothing more', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('closed')
    await warmAll(w, ['AAA'])
    vi.setSystemTime(at(10, 1, 1))
    const hold = w.pf.createNeighborHold()
    const n0 = w.server.calls.length
    hold.set(['X', 'AAA'], '1', { tail: ['AAA'], selected: 'X' })
    await tick(20)
    await w.server.drain()
    hold.set(['AAA', 'X'], '1', { tail: ['AAA'], selected: 'X' })                // a live re-sort
    await tick(20)
    await w.server.drain()
    expect(asksOf(w, 'AAA', n0)).toBe(1)
    hold.clear()
    w.store.dispose()
  })
})
