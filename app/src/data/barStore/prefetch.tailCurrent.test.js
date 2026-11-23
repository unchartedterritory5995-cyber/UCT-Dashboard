// ⭐ THE ROWS ON EITHER SIDE OF THE SELECTION STAY CURRENT ACROSS A BUCKET BOUNDARY (2026-11-23; owner's bar: under 40 ms
// from the key to pixels, every timeframe). Measured with the device store OFF, in a live session, a 1m + 15m pair, the
// S&P 500 list at one press per 2.5 s: a third to a half of next-row presses committed 80-200 ms after the key instead of in
// it, every one built from a server answer. Why (read, file:line in the PR): the list warms a row once, when it enters
// the window; its answer then COOLS for 60 s on 1m (prefetch cooldownMs / _cooling), so every later warm skips it; the
// server's 1m answer often ends at the last CLOSED minute (no forming row yet: api/services/bar_contract._developing),
// so at the next minute boundary the copy is one bucket behind, the switch refuses it (peekDisplayable: _behindClock)
// and waits for its own `since=` ask. The hold now keeps its `tail` rows (next, the one after, previous) current:
//   TC1 a row warmed before a boundary is asked again after it, and reads DISPLAYABLE at the next press with nothing
//       left to ask (the switch's same-task route); a row outside `tail` is not asked
//   TC2 a row that fell behind while it waited in the window is asked again at the next press's `set` (after the paint)
//   TC3 nothing is asked outside the regular session, on a hidden app, or for D
//   TC4 at most TAIL_REASKS_PER_BUCKET asks per row per bucket (a name that is not printing stays behind)
//   TC5 clear() (unmount) cancels the boundary timer
// Real store, real network, real facade, a held fake server.
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

async function boot(mode, { visible = () => true } = {}) {
  vi.resetModules()
  const server = installFakeBarsServer({ modeFor: () => mode })
  const { createBarStore } = await import('./index')
  const { createPrefetch } = await import('./prefetch')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  return { server, store, pf: createPrefetch({ store, tickerMeta: () => {}, extended: () => false, visible }) }
}
const tick = (ms) => vi.advanceTimersByTimeAsync(ms)
/** The list warm: every row answered once, now. */
async function warmAll(w, syms, tf) {
  const p = w.pf.prefetch(syms.map((s) => w.pf.keyFor(s, tf)), { priority: 'urgent' })
  await tick(130)
  await w.server.drain()
  await p
}
const asksOf = (w, sym, from) => w.server.calls.slice(from).filter((c) => c.q.sym === sym).length

describe('the hold keeps the next, the one after and the previous row current across a bucket boundary', () => {
  it('TC1 a row warmed before a minute boundary is asked again after it, and reads displayable at the next press', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('closed')                             // answers end at the last CLOSED minute, no forming row
    await warmAll(w, ['AAA', 'BBB', 'CCC', 'DDD'], '1')
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(true)        // current when warmed (newest row 09:59)
    const hold = w.pf.createNeighborHold()
    hold.set(['AAA', 'BBB', 'CCC', 'DDD'], '1', { tail: ['AAA', 'BBB', 'DDD'] })
    const before = w.server.calls.length
    await tick(13_000)                                         // past 10:01:00 (+ the lag)
    await w.server.drain()
    expect(w.server.calls.length - before).toBe(3)             // the three tail rows, once each
    expect(asksOf(w, 'CCC', before)).toBe(0)                   // a row outside `tail` is not asked
    await tick(6_000)                                          // the next press, well past the "just answered" grace
    expect(w.server.open()).toHaveLength(0)
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(true)        // the switch can show it in the key task
    expect(w.pf.peekDisplayable('DDD', '1')).toBe(true)
    expect(w.pf.peekDisplayable('CCC', '1')).toBe(false)       // (what every row read before: one bucket behind)
    hold.clear()
    w.store.dispose()
  })

  it('TC2 a row that fell behind while it waited in the window is asked again at the next press', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('closed')
    await warmAll(w, ['AAA', 'BBB', 'DDD'], '1')
    await tick(14_000)                                         // 10:01:04: one bucket behind, inside its cooldown
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(false)
    w.pf.prefetchBars(['AAA', 'BBB'], '1', { urgent: true })   // today's next-row warm asks nothing for it
    await w.server.flush(40)
    expect(w.server.open()).toHaveLength(0)
    const before = w.server.calls.length
    const hold = w.pf.createNeighborHold()
    hold.set(['AAA', 'BBB', 'DDD'], '1', { tail: ['AAA', 'BBB', 'DDD'] })   // the press, after its paint
    await w.server.drain()
    expect(w.server.calls.length - before).toBe(3)
    await tick(6_000)
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(true)
    hold.clear()
    w.store.dispose()
  })

  it('TC3a nothing is asked outside the regular session (the copy IS behind after the close)', async () => {
    vi.setSystemTime(at(15, 59, 50))
    const w = await boot('closed')
    await warmAll(w, ['AAA', 'BBB'], '1')
    const hold = w.pf.createNeighborHold()
    hold.set(['AAA', 'BBB'], '1', { tail: ['AAA', 'BBB'] })
    const before = w.server.calls.length
    await tick(20_000)                                         // 16:00:10: the boundary was the close
    hold.set(['AAA', 'BBB'], '1', { tail: ['AAA', 'BBB'] })    // a press after the close
    await w.server.drain()
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(false)       // behind the close's last bar...
    expect(w.server.calls.length - before).toBe(0)             // ...and still never asked
    hold.clear()
    w.store.dispose()
  })

  it('TC3b nothing is asked while the app is hidden', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('closed', { visible: () => false })
    await warmAll(w, ['AAA', 'BBB'], '1')
    const hold = w.pf.createNeighborHold()
    hold.set(['AAA', 'BBB'], '1', { tail: ['AAA', 'BBB'] })
    const before = w.server.calls.length
    await tick(13_000)
    await w.server.drain()
    expect(w.server.calls.length - before).toBe(0)
    hold.clear()
    w.store.dispose()
  })

  it('TC3c nothing is asked for D', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('closed')
    await warmAll(w, ['AAA', 'BBB'], 'D')
    const hold = w.pf.createNeighborHold()
    hold.set(['AAA', 'BBB'], 'D', { tail: ['AAA', 'BBB'] })
    const before = w.server.calls.length
    await tick(120_000)
    await w.server.drain()
    expect(w.server.calls.length - before).toBe(0)
    hold.clear()
    w.store.dispose()
  })

  it('TC4 at most TAIL_REASKS_PER_BUCKET asks per row per bucket (a name not printing stays behind)', async () => {
    vi.setSystemTime(at(10, 0, 5))
    const w = await boot('behind')                             // every answer ends at 09:40
    const { TAIL_REASKS_PER_BUCKET } = await import('./prefetch')
    await warmAll(w, ['AAA'], '1')
    const hold = w.pf.createNeighborHold()
    const before = w.server.calls.length
    for (let i = 0; i < 6; i++) {                              // a press every 6 s inside the 10:00 bucket
      await tick(6_000)
      hold.set(['AAA'], '1', { tail: ['AAA'] })
      await w.server.drain()
    }
    expect(TAIL_REASKS_PER_BUCKET).toBe(2)
    expect(w.server.calls.length - before).toBe(TAIL_REASKS_PER_BUCKET)
    await tick(30_000)                                         // the 10:01 boundary (+ lag): a new bucket
    await w.server.drain()
    expect(w.server.calls.length - before).toBe(TAIL_REASKS_PER_BUCKET + 1)
    hold.clear()
    w.store.dispose()
  })

  it('TC5 clear() (unmount) cancels the boundary timer', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('closed')
    await warmAll(w, ['AAA', 'BBB'], '1')
    const hold = w.pf.createNeighborHold()
    hold.set(['AAA', 'BBB'], '1', { tail: ['AAA', 'BBB'] })
    await tick(5_000)
    hold.clear()
    const before = w.server.calls.length
    await tick(10_000)                                         // past 10:01:02
    await w.server.drain()
    expect(w.server.calls.length - before).toBe(0)
    w.store.dispose()
  })
})
