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
// ...and, from the review of #2619:
//   M1  a tail answer that is STILL BEHIND (the server stores the closed minute LAGGING_S after the boundary) starts no
//       grace: a press right after it does not paint the short copy (it prepares, as on master); the spaced retry inside
//       the bucket comes back current and the next press can show the row in the key task. M1b: the switch's OWN answer
//       still starts the grace exactly as before
//   M2a hidden: the timer is not ARMED (asserted on the timer), and a boundary that finds the app hidden does not re-arm it
//   M2b the timer runs only in a window after the list's FIRST selection or a selection CHANGE (2026-11-25: the first
//       selection used to arm nothing); a re-sort does not extend it; past TAIL_ACTIVE_MS it stops
//   M2c the boundary lag is drawn per hold (two holds never ask in the same instant), in [TAIL_LAG_MIN_MS, TAIL_LAG_MAX_MS];
//       a row's second ask in a bucket is at least TAIL_REASK_SPACING_MS after its first
// ...and, from the re-review of #2619 (head 0f9b5e3769):
//   A1-A4 the grace is the switch's OWN: an answer still behind from the list's warm, the urgent next-row warm, the typed
//       warm or the hover-intent warm, then a press 1 s later: not displayable, the press prepares and asks (M1b: the
//       switch's own answer keeps it). (The edge warm sends HEADs to the CDN and never asks the bars route: no grace path.)
//   B1  a held arrow (30 rows at 16 a second) right after a boundary: while it is held the tail sends nothing; at most 3 at
//       the press that starts it and 3 where it stops; never more than 3 in flight; the row it stops on is asked, answered
//   B2  a tail ask for a row the member passed is ABORTED: never answered, no cooldown, not "asked" for its bucket (asked
//       again when the member comes back), no error
//   B3  at most 3 tail asks in flight per hold, whatever the tail it is given
//   B4  a row's count in its bucket survives a long sweep (the bound is the bucket, not the last 64 rows)
//   B5  (review of fb6fed4328) deliberate tapping, 150 ms between presses, is NOT a sweep: each press asks its rows
//   B6  (review of fb6fed4328) the lag retry is for the server's write lag only: a name not printing (its answer more than
//       one bucket behind) is never lag-retried
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

/** `random`: the lag draw (0: the shortest lag, deterministic); `timers`: every delay the facade schedules; `live`: the
 *  background warm asks (the tail's) the store is serving, now and at most (`maxBg`). */
async function boot(mode, { visible = () => true, random = () => 0, packIngesting = undefined } = {}) {
  vi.resetModules()
  const server = installFakeBarsServer({ modeFor: () => mode })
  const { createBarStore } = await import('./index')
  const P = await import('./prefetch')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const live = { bg: 0, maxBg: 0 }
  const realEnsure = store.ensure.bind(store)
  store.ensure = (key, opts) => {
    const bg = opts?.priority === 'background' && !!opts?.warm
    let left = !bg
    const leave = () => { if (!left) { left = true; live.bg-- } }
    if (bg) {
      live.bg++; live.maxBg = Math.max(live.maxBg, live.bg)
      opts?.signal?.addEventListener?.('abort', leave, { once: true })   // an aborted ask leaves flight at its abort
    }
    const p = realEnsure(key, opts)
    Promise.resolve(p).finally(leave).catch(() => {})
    return p
  }
  const timers = []
  const setTimer = (fn, ms) => { timers.push(ms); return setTimeout(fn, ms) }
  return {
    server, store, P, timers, live,
    pf: P.createPrefetch({ store, tickerMeta: () => {}, extended: () => false, visible, random, setTimer, ...(packIngesting ? { packIngesting } : {}) }),
  }
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
/** The member navigates the list: its first selection, then a press (a CHANGE of the selection opens the window). */
let sel = 0
function navigate(hold, syms, tf, tail) {
  hold.set(syms, tf, { tail, selected: `S${++sel}` })
  hold.set(syms, tf, { tail, selected: `S${++sel}` })
}
const press = (hold, syms, tf, tail) => hold.set(syms, tf, { tail, selected: `S${++sel}` })

describe('the hold keeps the next, the one after and the previous row current across a bucket boundary', () => {
  it('TC1 a row warmed before a minute boundary is asked again after it, and reads displayable at the next press', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('closed')                             // answers end at the last CLOSED minute, no forming row
    await warmAll(w, ['AAA', 'BBB', 'CCC', 'DDD'], '1')
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(true)        // current when warmed (newest row 09:59)
    const hold = w.pf.createNeighborHold()
    navigate(hold, ['AAA', 'BBB', 'CCC', 'DDD'], '1', ['AAA', 'BBB', 'DDD'])
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

  // ⛔ CHANGED 2026-11-24 (prefetch.firstFrameClosedBar.test.js B2): the next-row warm now asks again, once per bucket, a
  // next row whose answer predates the current bucket; the press's tail then asks only the row it did not cover.
  it('TC2 a row that fell behind while it waited in the window is asked again at the next press', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('closed')
    await warmAll(w, ['AAA', 'BBB', 'DDD'], '1')
    await tick(14_000)                                         // 10:01:04: one bucket behind, inside its cooldown
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(false)
    const n0 = w.server.calls.length
    w.pf.prefetchBars(['AAA', 'BBB'], '1', { urgent: true })   // the next-row warm asks its two rows again (once a bucket)
    await w.server.drain()
    expect(w.server.calls.length - n0).toBe(2)
    const before = w.server.calls.length
    const hold = w.pf.createNeighborHold()
    navigate(hold, ['AAA', 'BBB', 'DDD'], '1', ['AAA', 'BBB', 'DDD'])   // the press, after its paint
    await w.server.drain()
    expect(w.server.calls.slice(before).map((c) => c.q.sym)).toEqual(['DDD'])
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
    navigate(hold, ['AAA', 'BBB'], '1', ['AAA', 'BBB'])
    const before = w.server.calls.length
    await tick(20_000)                                         // 16:00:10: the boundary was the close
    press(hold, ['AAA', 'BBB'], '1', ['AAA', 'BBB'])           // a press after the close
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
    navigate(hold, ['AAA', 'BBB'], '1', ['AAA', 'BBB'])
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
    navigate(hold, ['AAA', 'BBB'], 'D', ['AAA', 'BBB'])
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
    await warmAll(w, ['AAA'], '1')
    const hold = w.pf.createNeighborHold()
    hold.set(['AAA'], '1', { tail: ['AAA'], selected: `S${++sel}` })
    const before = w.server.calls.length
    for (let i = 0; i < 6; i++) {                              // a press every 6 s inside the 10:00 bucket
      await tick(6_000)
      press(hold, ['AAA'], '1', ['AAA'])
      await w.server.drain()
    }
    expect(w.P.TAIL_REASKS_PER_BUCKET).toBe(2)
    expect(w.server.calls.length - before).toBe(w.P.TAIL_REASKS_PER_BUCKET)
    await tick(21_000)                                         // 10:01:02: the 10:01 boundary's ask...
    await w.server.drain()
    await tick(6_000)                                          // ...and its one spaced retry (still behind), 5 s later
    await w.server.drain()
    expect(w.server.calls.length - before).toBe(2 * w.P.TAIL_REASKS_PER_BUCKET)
    hold.clear()
    w.store.dispose()
  })

  it('TC5 clear() (unmount) cancels the boundary timer', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('closed')
    await warmAll(w, ['AAA', 'BBB'], '1')
    const hold = w.pf.createNeighborHold()
    navigate(hold, ['AAA', 'BBB'], '1', ['AAA', 'BBB'])
    await tick(5_000)
    hold.clear()
    const before = w.server.calls.length
    await tick(10_000)                                         // past the boundary and its lag
    await w.server.drain()
    expect(w.server.calls.length - before).toBe(0)
    w.store.dispose()
  })
})

describe('review of #2619, MEDIUM-1: a tail answer still behind never lets a press paint a short copy', () => {
  it('M1 the server stores the closed minute 5 s after the boundary: the press right after the tail answer prepares; the retry makes it current', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('lagging')                            // a bucket is stored LAGGING_S (5 s) after it ends
    await warmAll(w, ['AAA', 'BBB'], '1')
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(true)
    const hold = w.pf.createNeighborHold()
    navigate(hold, ['AAA', 'BBB'], '1', ['AAA', 'BBB'])
    const before = w.server.calls.length
    await tick(12_000)                                         // 10:01:02: the boundary ask (lag 2 s)...
    await w.server.drain()
    expect(w.server.calls.length - before).toBe(2)
    expect(w.store.peek(w.pf.keyFor('AAA', '1')).bars.at(-1).t).toBe(OPEN + 29 * 60)   // ...came back still ending 09:59
    await tick(1_000)                                          // a press at 10:01:03, 1 s after that answer
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(false)       // NOT painted short: the switch asks for itself, as on master
    await tick(5_000)                                          // 10:01:07: the spaced retry, after the server stored 10:00
    await w.server.drain()
    expect(w.server.calls.length - before).toBe(4)
    expect(w.store.peek(w.pf.keyFor('AAA', '1')).bars.at(-1).t).toBe(OPEN + 30 * 60)  // the closed minute is in
    await tick(1_000)
    expect(w.server.open()).toHaveLength(0)
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(true)        // the next press shows it in the key task
    hold.clear()
    w.store.dispose()
  })

  // ⛔ CHANGED 2026-11-24 (prefetch.firstFrameClosedBar.test.js C2): an own answer TWO OR MORE buckets behind no longer lends
  // the grace (it read as "not printing" while the server lagged); one bucket behind long after the roll still does (C1b).
  it("M1b the switch's OWN answer 20 buckets behind lends no grace now; the press still paints after its bounded hold", async () => {
    vi.setSystemTime(at(10, 1, 10))
    const w = await boot('behind')                             // every answer ends at 09:40
    await warmAll(w, ['AAA'], '1')
    await tick(6_000)
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(false)
    const out = { v: 'pending' }
    w.pf.prepareForDisplay('AAA', '1').then((x) => { out.v = x })   // the switch's own ask
    await w.server.flush(40)
    await w.server.drain()
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(false)       // no grace for an answer this far behind
    await tick(1_000)
    expect(out.v).not.toBe('pending')                          // the hold is bounded: it painted as it is
    w.store.dispose()
  })
})

describe('review of #2619, MEDIUM-2: the timer runs only while the member navigates, visibly, never in a herd', () => {
  it('M2a hidden: the timer is not ARMED; a boundary that finds the app hidden does not re-arm it', async () => {
    vi.setSystemTime(at(10, 0, 50))
    let vis = false
    const w = await boot('closed', { visible: () => vis })
    await warmAll(w, ['AAA', 'BBB'], '1')
    const hold = w.pf.createNeighborHold()
    let n0 = w.timers.length
    navigate(hold, ['AAA', 'BBB'], '1', ['AAA', 'BBB'])
    expect(w.timers.length - n0).toBe(0)                       // hidden: nothing armed
    vis = true
    n0 = w.timers.length
    press(hold, ['AAA', 'BBB'], '1', ['AAA', 'BBB'])
    expect(w.timers.length - n0).toBe(1)                       // (control) visible: one timer, the boundary
    vis = false                                                // hidden before that boundary
    n0 = w.timers.length
    const before = w.server.calls.length
    await tick(13_000)                                         // the boundary fires into a hidden app
    await w.server.drain()
    expect(w.server.calls.length - before).toBe(0)
    expect(w.timers.length - n0).toBe(0)                       // ...and arms nothing after it
    hold.clear()
    w.store.dispose()
  })

  // ⛔ CHANGED (2026-11-25): the list's first selection opens the window (prefetch.firstSelection.test.js)
  it('M2b the list\'s first selection opens the window; a re-sort does not extend it; past TAIL_ACTIVE_MS it stops', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('closed')
    await warmAll(w, ['AAA', 'BBB', 'CCC'], '1')
    const hold = w.pf.createNeighborHold()
    let n0 = w.timers.length
    hold.set(['AAA', 'BBB', 'CCC'], '1', { tail: ['AAA', 'BBB'], selected: 'X' })   // the list opens on X
    expect(w.timers.length - n0).toBeGreaterThan(0)            // armed by the first selection
    let before = w.server.calls.length
    await tick(13_000)
    await w.server.drain()
    expect(w.server.calls.length - before).toBeGreaterThan(0)  // the 10:01 boundary asked the rows behind
    // live re-sorts (the same selection) inside the window never extend it: it ends 3 minutes after the first selection
    expect(w.P.TAIL_ACTIVE_MS).toBe(3 * 60_000)
    for (let i = 0; i < 3; i++) {
      await tick(55_000)
      hold.set(['BBB', 'AAA', 'CCC'], '1', { tail: ['AAA', 'BBB'], selected: 'X' })
      await w.server.drain()
    }
    await tick(3_000)                                          // 10:03:51: past the window opened at 10:00:50
    await w.server.drain()
    n0 = w.timers.length
    before = w.server.calls.length
    await tick(120_000)
    await w.server.drain()
    expect(w.server.calls.length - before).toBe(0)
    expect(w.timers.length - n0).toBe(0)
    hold.clear()
    w.store.dispose()
  })

  it('M2c two holds never ask in the same instant (a lag drawn per hold, inside its bounds); a second ask is spaced', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const draws = [0.1, 0.9]
    const w = await boot('closed', { random: () => draws.shift() ?? 0.5 })
    expect([w.P.TAIL_LAG_MIN_MS, w.P.TAIL_LAG_MAX_MS]).toEqual([2_000, 8_000])
    await warmAll(w, ['AAA', 'BBB'], '1')
    const A = w.pf.createNeighborHold()
    const B = w.pf.createNeighborHold()
    navigate(A, ['AAA'], '1', ['AAA'])                          // lag 2.6 s
    navigate(B, ['BBB'], '1', ['BBB'])                          // lag 7.4 s
    const before = w.server.calls.length
    await tick(9_100)                                          // 10:00:59.2
    await tick(3_900)                                          // 10:01:03.1: A has asked, B has not
    expect(asksOf(w, 'AAA', before)).toBe(1)
    expect(asksOf(w, 'BBB', before)).toBe(0)
    await tick(5_000)                                          // 10:01:08.1: B too
    expect(asksOf(w, 'BBB', before)).toBe(1)
    A.clear(); B.clear()
    w.store.dispose()
  })

  it('M2c a row\'s second ask in a bucket waits TAIL_REASK_SPACING_MS after its first', async () => {
    vi.setSystemTime(at(10, 0, 5))
    const w = await boot('behind')                             // every answer ends at 09:40: it stays behind
    await warmAll(w, ['AAA'], '1')
    const hold = w.pf.createNeighborHold()
    hold.set(['AAA'], '1', { tail: ['AAA'], selected: `S${++sel}` })
    await tick(6_000)
    const before = w.server.calls.length
    press(hold, ['AAA'], '1', ['AAA'])                         // 10:00:11: the first ask
    await w.server.drain()
    expect(w.server.calls.length - before).toBe(1)
    await tick(1_000)
    press(hold, ['AAA'], '1', ['AAA'])                         // 1 s later: not yet
    await w.server.drain()
    expect(w.server.calls.length - before).toBe(1)
    expect(w.P.TAIL_REASK_SPACING_MS).toBe(4_000)
    await tick(4_000)
    press(hold, ['AAA'], '1', ['AAA'])                         // 5 s after the first: the second
    await w.server.drain()
    expect(w.server.calls.length - before).toBe(2)
    hold.clear()
    w.store.dispose()
  })
})

describe('re-review of #2619 (A): the grace is the switch\'s own; no other warm lends it', () => {
  // 10:01:01, the server stores a closed minute LAGGING_S (5 s) after it ends: an answer now still ends at 09:59
  async function behindAfter(warm, opts = {}) {
    vi.setSystemTime(at(10, 1, 1))
    const w = await boot('lagging', opts)
    await warm(w)
    await tick(130)
    await w.server.drain()
    const k = w.pf.keyFor('AAA', '1')
    expect(w.store.peek(k)?.restSeen).toBe(true)                // the warm's answer is held...
    expect(w.store.peek(k).bars.at(-1).t).toBe(OPEN + 29 * 60)  // ...still ending 09:59 (one bucket behind)
    await tick(1_000)                                           // a press 1 s later
    const shown = w.pf.peekDisplayable('AAA', '1')
    const before = w.server.calls.length
    const out = { v: 'pending' }
    w.pf.prepareForDisplay('AAA', '1').then((x) => { out.v = x })
    await w.server.flush(40)
    const asked = w.server.calls.slice(before).filter((c) => c.q.sym === 'AAA').length
    await w.server.drain()
    await tick(1_000)
    w.store.dispose()
    return { shown, asked, out }
  }
  it("A1 the list's background warm (prefetchBarsToIDB)", async () => {
    const r = await behindAfter(async (w) => { w.pf.prefetchBarsToIDB(['AAA'], '1') })
    expect(r.shown).toBe(false)
    expect(r.asked).toBe(1)                                     // the press prepares: it asks for itself
  })
  it('A2 the urgent next-row warm (prefetchBars, urgent)', async () => {
    const r = await behindAfter(async (w) => { w.pf.prefetchBars(['AAA'], '1', { urgent: true }) })
    expect(r.shown).toBe(false)
    expect(r.asked).toBe(1)
  })
  it('A3 the typed warm (warmTypedSymbol, intraday)', async () => {
    const r = await behindAfter(async (w) => { w.pf.warmTypedSymbol('AAA', '1') }, { packIngesting: () => true })
    expect(r.shown).toBe(false)
    expect(r.asked).toBe(1)
  })
  it('A4 the hover-intent warm (prefetchBarOnIntent)', async () => {
    const r = await behindAfter(async (w) => { w.pf.prefetchBarOnIntent('AAA', '1', { delay: 0 }) })
    expect(r.shown).toBe(false)
    expect(r.asked).toBe(1)
  })
})

describe("re-review of #2619 (B): the tail's asks are bounded per hold, and a passed row's ask is aborted", () => {
  it('B1 a held arrow through 30 rows at 16 a second right after a boundary: the tail sends nothing while it is held', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('closed')
    const R = Array.from({ length: 34 }, (_, i) => `R${String(i).padStart(2, '0')}`)
    await warmAll(w, R, '1')                                    // every row answered at 10:00:50, before the boundary
    const hold = w.pf.createNeighborHold()
    hold.set(R, '1', { tail: [R[1], R[2]], selected: R[0] })    // the list opens on R00
    await tick(11_000)                                          // 10:01:01: every row one bucket behind (and cooling)
    const before = w.server.calls.length
    const tailCalls = () => w.server.calls.slice(before).filter((c) => c.q.warm)
    let ctl = null
    let maxOpen = 0
    let atSweep = null
    for (let i = 1; i <= 30; i++) {
      for (const c of w.server.open()) c.respond()             // the server answers within one press (~60 ms)
      await w.server.flush()
      if (i === 3) atSweep = tailCalls().length                 // (the press that started the sweep, and the next, are done)
      ctl?.abort()
      ctl = new AbortController()
      w.pf.prepareForDisplay(R[i], '1', { signal: ctl.signal }).catch(() => {})   // the switch (useSymbolHandoff)
      w.pf.prefetchBars([R[i + 1], R[i + 2]], '1', { urgent: true })             // the next-row warm (cooling: nothing)
      hold.set(R, '1', { tail: [R[i + 1], R[i + 2], R[i - 1]], selected: R[i] })
      await w.server.flush()
      maxOpen = Math.max(maxOpen, tailCalls().filter((c) => !c.done).length)
      await tick(62)
    }
    const inSweep = tailCalls().length - atSweep
    await tick(1_000)                                           // the member rests on R30
    await w.server.drain()
    expect(inSweep).toBe(0)                                     // held: the tail asked nothing (the switch asked its rows)
    expect(tailCalls().length).toBeLessThanOrEqual(6)           // 3 where it started, 3 where it stopped (not 1 per row)
    expect(maxOpen).toBeLessThanOrEqual(3)
    expect(w.live.maxBg).toBeLessThanOrEqual(3)
    const stop = w.server.calls.slice(before).filter((c) => c.q.sym === 'R30')
    expect(stop.some((c) => c.done && !c.aborted)).toBe(true)  // the row it stops on: asked and answered...
    expect(w.store.peek(w.pf.keyFor('R30', '1')).bars.at(-1).t).toBe(OPEN + 30 * 60)   // ...with the closed minute
    expect(w.pf.peekDisplayable('R31', '1')).toBe(true)        // and the next row is current for the next press
    hold.clear()
    w.store.dispose()
  })

  it('B2 a tail ask for a row the member passed is aborted: never answered, cooldown kept, asked again on return, no error', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('closed')
    const L = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    await warmAll(w, L, '1')
    const hold = w.pf.createNeighborHold()
    hold.set(L, '1', { tail: ['B', 'C'], selected: 'A' })       // the list opens on A
    await tick(11_000)                                          // 10:01:01: every row one bucket behind
    const before = w.server.calls.length
    const tailOf = (sym) => w.server.calls.slice(before).filter((c) => c.q.warm && c.q.sym === sym)
    // a slow server: nothing is answered while the member moves on, 0.4 s a press (not a held arrow)
    hold.set(L, '1', { tail: ['C', 'D', 'A'], selected: 'B' })
    await w.server.flush()
    await tick(400)
    hold.set(L, '1', { tail: ['D', 'E', 'B'], selected: 'C' })  // C (selected) and A leave the tail
    await w.server.flush()
    await tick(400)
    hold.set(L, '1', { tail: ['E', 'F', 'C'], selected: 'D' })  // D (selected) and B leave
    await w.server.flush()
    expect(w.live.maxBg).toBeLessThanOrEqual(3)
    await w.server.drain()                                      // the server answers whatever is still asked
    for (const sym of ['A', 'B', 'D']) {
      for (const c of tailOf(sym)) expect(c.aborted).toBe(true) // sent and cancelled, or never sent: never answered
    }
    const kB = w.pf.keyFor('B', '1')
    expect(w.store.peek(kB)?.error ?? null).toBe(null)           // not an error
    // not an answer (review of fb6fed4328, LOW): B keeps the cooldown of its last ANSWER, the warm's at 10:00:50 (cooling to
    // 10:01:50), neither lost nor restarted by the aborted ask. (A warm never re-asks a held server answer it would flip
    // to, so the probe is a warm wanting more depth than B holds: it asks unless B is cooling, prefetch `_cooling`.)
    const probeB = async () => {
      const b0 = w.server.calls.length
      w.pf.prefetch([kB], { priority: 'urgent', depth: 1_000_000 })
      await w.server.flush(40)
      const n = w.server.calls.slice(b0).filter((c) => c.q.sym === 'B').length
      await w.server.drain()
      return n
    }
    expect(await probeB()).toBe(0)                              // 10:01:01.8: still cooling from its answer
    await tick(400)
    const a0 = tailOf('A').length
    hold.set(L, '1', { tail: ['C', 'D', 'A'], selected: 'B' })  // the member comes back, 1.2 s after A's first ask
    await w.server.flush()
    await w.server.drain()
    expect(tailOf('A').length - a0).toBe(1)                     // A is asked again: its aborted ask was not counted
    await tick(50_000)                                          // 10:01:52: past the ANSWER's cooldown (not an abort's)
    expect(await probeB()).toBe(1)
    hold.clear()
    w.store.dispose()
  })

  it('B5 deliberate tapping, 150 ms between presses, right after a boundary: each press asks its rows (not a sweep)', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('closed')
    const R = Array.from({ length: 16 }, (_, i) => `T${String(i).padStart(2, '0')}`)
    await warmAll(w, R, '1')
    const hold = w.pf.createNeighborHold()
    hold.set(R, '1', { tail: [R[1], R[2]], selected: R[0] })
    await tick(11_000)                                          // 10:01:01: every row one bucket behind
    const before = w.server.calls.length
    const tailCalls = () => w.server.calls.slice(before).filter((c) => c.q.warm)
    let ctl = null
    for (let i = 1; i <= 10; i++) {
      for (const c of w.server.open()) c.respond()
      await w.server.flush()
      ctl?.abort()
      ctl = new AbortController()
      w.pf.prepareForDisplay(R[i], '1', { signal: ctl.signal }).catch(() => {})
      hold.set(R, '1', { tail: [R[i + 1], R[i + 2], R[i - 1]], selected: R[i] })
      await w.server.flush()
      await tick(150)
    }
    expect(tailCalls().length).toBeGreaterThanOrEqual(10)       // the row entering as next+1 at each press, at least
    expect(w.P.TAIL_SWEEP_MS).toBeLessThan(150)
    hold.clear()
    w.store.dispose()
  })

  it('B6 a name not printing (more than one bucket behind) is never lag-retried', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('behind')                              // every answer ends at 09:40
    await warmAll(w, ['AAA', 'BBB'], '1')
    const hold = w.pf.createNeighborHold()
    hold.set(['AAA', 'BBB'], '1', { tail: ['BBB'], selected: 'X' })
    await tick(11_000)                                          // 10:01:01, inside the boundary's lag window
    const before = w.server.calls.length
    hold.set(['AAA', 'BBB'], '1', { tail: ['BBB'], selected: 'Y' })   // a press: BBB asked, still far behind
    await w.server.drain()
    expect(w.server.calls.length - before).toBe(1)
    await tick(7_000)
    await w.server.drain()
    expect(w.server.calls.length - before).toBe(1)              // no lag retry
    hold.clear()
    w.store.dispose()
  })

  it('B3 at most 3 tail asks in flight per hold, whatever the tail it is given', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('closed')
    const L = ['A', 'B', 'C', 'D', 'E', 'F']
    await warmAll(w, L, '1')
    const hold = w.pf.createNeighborHold()
    hold.set(L, '1', { tail: [], selected: 'A' })
    await tick(11_000)
    const before = w.server.calls.length
    hold.set(L, '1', { tail: ['B', 'C', 'D', 'E', 'F'], selected: 'X' })   // five rows behind
    await w.server.flush()
    expect(w.live.maxBg).toBe(3)
    await w.server.drain()
    expect(w.server.calls.slice(before).filter((c) => c.q.warm).length).toBe(3)
    hold.clear()
    w.store.dispose()
  })

  it("B4 a row's count in its bucket survives a long sweep (the bound is the bucket, not the last 64 rows)", async () => {
    vi.setSystemTime(at(10, 0, 1))
    const w = await boot('behind')                              // every answer ends at 09:40: every row stays behind
    const R = Array.from({ length: 70 }, (_, i) => `Q${String(i).padStart(2, '0')}`)
    const ALL = ['X', ...R]
    await warmAll(w, ALL, '1')
    const hold = w.pf.createNeighborHold()
    hold.set(ALL, '1', { tail: [], selected: 'open' })          // the list opens
    await tick(7_000)                                           // 10:00:08, past every warm answer's grace
    const before = w.server.calls.length
    let n = 0
    const step = async (tail) => { hold.set(ALL, '1', { tail, selected: `s${++n}` }); await w.server.drain(); await tick(300) }
    await step(['X'])                                           // X asked (1)
    await tick(5_000)
    await step(['X'])                                           // and once more, spaced (2): its last in this bucket
    expect(asksOf(w, 'X', before)).toBe(2)
    for (const q of R) await step([q])                          // 70 other rows pass through the tail, 0.3 s apart
    await step(['X'])                                           // 10:00:35: X is back, same bucket
    expect(asksOf(w, 'X', before)).toBe(2)                      // not a third time
    hold.clear()
    w.store.dispose()
  })
})
