// ⭐ THE NEXT ROWS RIDE THE LIVE STREAM, SO THE FIRST PRESS AFTER A MINUTE ROLL IS IN THE KEY TASK (2026-11-25).
// Replay of #2708 (S&P 500, 1m + 15m, a press every 2.5 s): every remaining wait was the first press after a roll (6 of 152,
// ~105 ms). The row's copy was read ~5 s before, BEFORE the roll, so it lacks the closed minute and the switch asks for it.
// The owner's standard for that first frame (2026-11-25): "as current as the chart on screen". Bar M present with the
// server's own PUSH values (provisional until the push final) is correct; a copy without bar M is not, unless the stream
// proves no trade printed in M. And "no lag, proper instant feeling": the switch never holds the previous chart for long.
//   L1  a next row whose push stream has delivered since BEFORE the roll: the press 0.5 s after the roll paints it in the
//       key task, bar M as the stream left it, no request
//   L1b the same copy, its stream delivering only since AFTER the roll: not shown (the #2708 rule: the switch asks)
//   L1d no push stream for the row: the #2708 rule, unchanged
//   A1  (rule a) a stream delivering since BEFORE the first bucket the copy lacks opened, with NO frame for that bucket or
//       later: no trade printed there, the copy is complete, shown at once (a thin minute)
//   A1b the stream DID deliver a frame for that bucket but the copy lacks it: not shown
//   A1c a stream delivering only since AFTER that bucket opened proves nothing about it: not shown
//   L2  the hold subscribes the travel-direction rows it is given (`live`), at most NEIGHBOR_LIVE_ROWS per hold, as
//       AHEAD pairs; a row leaving is released; clear() releases all; a hidden page subscribes none
//   L2b ...only while the member navigates: TAIL_ACTIVE_MS after the last selection change they are released
//   L3  the page cap: at most NEIGHBOR_LIVE_MAX_KEYS keys ride the stream as a neighbour (the store's watchLive)
//   L4  (review of #2721) a live re-sort (the same selection) never changes the rows on the stream (it would reconnect the
//       chart's own stream); a press does
//   L5  (review, LOW) the page turning hidden, or the session ending, mid-window releases them within LIVE_RECHECK_MS
//   L6  (review, LOW) a key the page cap refused is asked again once, LIVE_RECHECK_MS later, while still in the window
// ...and the roll hold (rule b): at most ROLL_HOLD_MAX_MS (400 ms) for the switch's own ask or a push frame, then what the
// server answered paints, under its honest status (UPDATING when it still lacks the closed bar, never 'current'):
//   H1  the own ask held: nothing at 300 ms, the copy as it is at 400 ms, its status UPDATING; the answer replaces it
//   H2  an answer holding the closed bar within the bound: 'current' at once
//   H3  the server's answer still lacks the closed bar (its write lag): painted at once (no wait to the bound), UPDATING,
//       and no third ask
//   H4  a push frame bringing the closed bar inside the bound ends the hold at once
//   H5  the next press (abort) ends the hold at once, and nothing more is asked
// Real store, real network, real facade, a held fake server, a fake push stream.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const at = (h, m, s = 0) => (OPEN + ((h * 60 + m) - (9 * 60 + 30)) * 60 + s) * 1000   // ET wall clock on Tue 2026-11-10
const T = (h, m) => OPEN + ((h * 60 + m) - (9 * 60 + 30)) * 60                       // a bucket's start (unix s)
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  fakeDb._clear()
  vi.useFakeTimers()
  localStorage.setItem('barspack.version', 'test')
})
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version') })

async function boot(modeFor) {
  vi.resetModules()
  const server = installFakeBarsServer({ modeFor: typeof modeFor === 'function' ? modeFor : () => modeFor })
  const { createBarStore } = await import('./index')
  const P = await import('./prefetch')
  const stream = fakeStream()
  const store = createBarStore({
    stream, candle: fakeCandle(), prices: fakePrices(), pushEnabled: () => true,
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const vis = { v: true }
  const pf = P.createPrefetch({ store, tickerMeta: () => {}, extended: () => false, visible: () => vis.v, random: () => 0, deepNeighbors: () => false })
  return { server, store, stream, P, pf, vis, k: (sym) => pf.keyFor(sym, '1') }
}
const tick = (ms) => vi.advanceTimersByTimeAsync(ms)
async function serve(w, ms) {
  for (let t = 0; t < ms; t += 10) {
    await tick(10)
    for (const c of w.server.open()) c.respond()
    await w.server.flush()
  }
}
async function warmNext(w, syms) {
  w.pf.prefetchBars(syms, '1', { urgent: true })
  await serve(w, 200)
}
const callsOf = (w, sym, from = 0) => w.server.calls.slice(from).filter((c) => c.q.sym === sym && c.q.tf === '1')
/** The copy holds bar `t`: a row, or the developing bar of `t` or later (L1: bar M as the stream left it). */
const holdsM = (w, sym, t) => !!w.store.peek(w.k(sym))?.bars?.some((b) => b.t === t) || w.store.peek(w.k(sym))?.developing?.t >= t
/** The copy holds the CLOSED bar `t`: a row, or a developing bar of a later bucket (the #2708 file's `holds`). */
const holdsClosed = (w, sym, t) => !!w.store.peek(w.k(sym))?.bars?.some((b) => b.t === t) || w.store.peek(w.k(sym))?.developing?.t > t
/** A push frame of the 1m bar starting at `t` (unix s), as /api/stream/bars v2 sends it. */
const frame = (sym, t, c, revMs, final = false) => ({
  sym, tf: '1', t_s: t, rev: revMs, final, cache_key: `b1:${sym}:1:eth-clock`,
  bar: { t: t * 1000, o: 10, h: Math.max(11, c), l: 9, c, v: 100, final },
})
/** The member navigates (a CHANGE of the selection opens the hold's window), the rows ahead given as `live`. */
let sel = 0
function navigate(hold, syms, opts) {
  hold.set(syms, '1', { ...opts, selected: `S${++sel}` })
  hold.set(syms, '1', { ...opts, selected: `S${++sel}` })
}
async function liveRow(w, liveSince) {
  await warmNext(w, ['AAA'])                                           // the urgent next-row warm, at 10:00:50
  const hold = w.pf.createNeighborHold()
  navigate(hold, ['ZZZ', 'AAA'], { tail: ['AAA'], live: ['AAA'] })
  expect(w.stream.ahead(), 'the next row does not ride the stream').toEqual(['AAA:1'])
  if (liveSince != null) w.stream.st.live.set('AAA:1', liveSince)
  w.stream.emit('AAA', '1', frame('AAA', T(10, 0), 10.7, at(10, 0, 59)))   // the minute's last trades, pushed
  w.stream.st.lastBar.set('AAA:1', T(10, 0) * 1000)
  return hold
}

describe('L: a next row the push stream has kept current through the roll is shown in the key task', () => {
  it('L1 the press 0.5 s after the roll paints bar M as the stream left it, in the key task, with no request', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('ok')
    const hold = await liveRow(w, at(10, 0, 51))
    expect(w.store.peek(w.k('AAA')).developing?.c).toBe(10.7)       // the push frame landed on the row's copy
    vi.setSystemTime(at(10, 1, 0) + 500)
    expect(w.pf.peekDisplayable('AAA', '1'), 'a row the stream kept current through the roll waited').toBe(true)
    const n0 = w.server.calls.length
    let out = 'pending'
    w.pf.prepareForDisplay('AAA', '1').then((o) => { out = o })
    await tick(20)
    await w.server.flush()
    expect(out).toBe('current')
    expect(callsOf(w, 'AAA', n0).length).toBe(0)
    expect(holdsM(w, 'AAA', T(10, 0))).toBe(true)                     // bar M present (provisional)
    hold.clear()
    w.store.dispose()
  })

  it('L1b (control) a stream delivering only since AFTER the roll: not shown in the key task (the switch asks)', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('ok')
    const hold = await liveRow(w, at(10, 1, 0) + 200)
    vi.setSystemTime(at(10, 1, 0) + 500)
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(false)
    hold.clear()
    w.store.dispose()
  })

  it('L1d (control) no push stream for the row: the #2708 rule, unchanged', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('ok')
    const hold = await liveRow(w, null)
    vi.setSystemTime(at(10, 1, 0) + 500)
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(false)
    hold.clear()
    w.store.dispose()
  })

  it('A1 (rule a) a stream live since before 10:01 opened, NO frame for 10:01: no trade printed, the copy is complete', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('ok')
    const hold = await liveRow(w, at(10, 0, 51))                      // its newest frame: 10:00
    vi.setSystemTime(at(10, 2, 0) + 500)                               // M = 10:01, the copy ends at 10:00
    expect(w.pf.peekDisplayable('AAA', '1'), 'a thin minute the stream proved empty waited').toBe(true)
    hold.clear()
    w.store.dispose()
  })

  it('A1b the stream DID deliver a frame for 10:01 the copy lacks: not shown', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('ok')
    const hold = await liveRow(w, at(10, 0, 51))
    w.stream.st.lastBar.set('AAA:1', T(10, 1) * 1000)
    vi.setSystemTime(at(10, 2, 0) + 500)
    expect(w.pf.peekDisplayable('AAA', '1'), 'a copy missing a minute the stream delivered was shown').toBe(false)
    hold.clear()
    w.store.dispose()
  })

  it('A1c a stream live only since AFTER 10:01 opened proves nothing about 10:01: not shown', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('ok')
    const hold = await liveRow(w, at(10, 1, 30))
    vi.setSystemTime(at(10, 2, 0) + 500)
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(false)
    hold.clear()
    w.store.dispose()
  })
})

describe('L2: the hold puts the rows ahead on the stream, bounded', () => {
  it('L2 at most NEIGHBOR_LIVE_ROWS rows per hold, as AHEAD pairs; a row leaving is released; clear releases all', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('ok')
    await warmNext(w, ['AAA', 'BBB', 'CCC', 'DDD'])
    expect(w.P.NEIGHBOR_LIVE_ROWS).toBe(2)
    const hold = w.pf.createNeighborHold()
    const rows = ['ZZZ', 'AAA', 'BBB', 'CCC', 'DDD']
    navigate(hold, rows, { tail: ['AAA', 'BBB'], live: ['AAA', 'BBB', 'CCC'] })
    expect(w.stream.ahead()).toEqual(['AAA:1', 'BBB:1'])
    for (const k of ['AAA:1', 'BBB:1']) expect(w.stream.subsOf(k).every((c) => c.ahead === true)).toBe(true)
    hold.set(rows, '1', { tail: ['BBB', 'CCC'], live: ['BBB', 'CCC'], selected: `S${++sel}` })   // the member moves on
    expect(w.stream.ahead()).toEqual(['BBB:1', 'CCC:1'])
    hold.clear()
    expect(w.stream.ahead()).toEqual([])
    w.store.dispose()
  })

  it('L2 a hidden page puts nothing on the stream', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('ok')
    w.vis.v = false
    await warmNext(w, ['AAA'])
    const hold = w.pf.createNeighborHold()
    navigate(hold, ['ZZZ', 'AAA'], { tail: ['AAA'], live: ['AAA'] })
    expect(w.stream.ahead()).toEqual([])
    hold.clear()
    w.store.dispose()
  })

  it('L2b only while the member navigates: TAIL_ACTIVE_MS after the last selection change the rows leave the stream', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('ok')
    await warmNext(w, ['AAA'])
    const hold = w.pf.createNeighborHold()
    navigate(hold, ['ZZZ', 'AAA'], { tail: ['AAA'], live: ['AAA'] })
    expect(w.stream.ahead()).toEqual(['AAA:1'])
    await tick(w.P.TAIL_ACTIVE_MS - 1_000)
    expect(w.stream.ahead()).toEqual(['AAA:1'])
    await tick(2_000)
    expect(w.stream.ahead(), 'a member who stopped navigating kept a row on the stream').toEqual([])
    hold.clear()
    w.store.dispose()
  })

  it('L3 the page cap: at most NEIGHBOR_LIVE_MAX_KEYS keys ride the stream as a neighbour; a release frees a place', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('ok')
    expect(w.store.NEIGHBOR_LIVE_MAX_KEYS).toBe(4)
    const off = ['A1', 'A2', 'A3', 'A4', 'A5'].map((s) => w.store.watchLive(w.k(s)))
    expect(w.stream.ahead()).toEqual(['A1:1', 'A2:1', 'A3:1', 'A4:1'])
    off[0]()
    const again = w.store.watchLive(w.k('A5'))
    expect(w.stream.ahead()).toEqual(['A2:1', 'A3:1', 'A4:1', 'A5:1'])
    for (const f of [...off, again]) f()
    expect(w.stream.ahead()).toEqual([])
    w.store.dispose()
  })

  it('L4 a live re-sort (the same selection) never changes the rows on the stream; a press does', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('ok')
    await warmNext(w, ['AAA', 'BBB', 'CCC'])
    const hold = w.pf.createNeighborHold()
    const rows = ['ZZZ', 'AAA', 'BBB', 'CCC']
    navigate(hold, rows, { tail: ['AAA', 'BBB'], live: ['AAA', 'BBB'] })
    const selNow = `S${sel}`
    expect(w.stream.ahead()).toEqual(['AAA:1', 'BBB:1'])
    hold.set(['ZZZ', 'CCC', 'AAA', 'BBB'], '1', { tail: ['CCC', 'AAA'], live: ['CCC', 'AAA'], selected: selNow })   // re-sort
    expect(w.stream.ahead(), 'a re-sort changed the rows on the stream (the chart\'s stream reconnects)').toEqual(['AAA:1', 'BBB:1'])
    hold.set(rows, '1', { tail: ['BBB', 'CCC'], live: ['BBB', 'CCC'], selected: `S${++sel}` })   // a press
    expect(w.stream.ahead()).toEqual(['BBB:1', 'CCC:1'])
    hold.clear()
    w.store.dispose()
  })

  it('L5 the page turning hidden mid-window releases them within LIVE_RECHECK_MS', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('ok')
    await warmNext(w, ['AAA'])
    const hold = w.pf.createNeighborHold()
    navigate(hold, ['ZZZ', 'AAA'], { tail: ['AAA'], live: ['AAA'] })
    expect(w.stream.ahead()).toEqual(['AAA:1'])
    w.vis.v = false
    await tick(w.P.LIVE_RECHECK_MS + 100)
    expect(w.stream.ahead(), 'a hidden page kept its rows ahead on the stream').toEqual([])
    hold.clear()
    w.store.dispose()
  })

  it('L5b the session ending mid-window releases them within LIVE_RECHECK_MS', async () => {
    vi.setSystemTime(at(15, 59, 50))
    const w = await boot('ok')
    await warmNext(w, ['AAA'])
    const hold = w.pf.createNeighborHold()
    navigate(hold, ['ZZZ', 'AAA'], { tail: ['AAA'], live: ['AAA'] })
    expect(w.stream.ahead()).toEqual(['AAA:1'])
    await tick(10_000 + w.P.LIVE_RECHECK_MS + 100)                    // past 16:00
    expect(w.stream.ahead(), 'the rows ahead outlived the session').toEqual([])
    hold.clear()
    w.store.dispose()
  })

  it('L6 a key the page cap refused is asked again once, LIVE_RECHECK_MS later, inside the window', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('ok')
    await warmNext(w, ['AAA'])
    const others = ['X1', 'X2', 'X3', 'X4'].map((s) => w.store.watchLive(w.k(s)))   // another list holds the 4 places
    const hold = w.pf.createNeighborHold()
    navigate(hold, ['ZZZ', 'AAA'], { tail: ['AAA'], live: ['AAA'] })
    expect(w.stream.ahead()).not.toContain('AAA:1')
    others[0]()
    await tick(w.P.LIVE_RECHECK_MS + 100)
    expect(w.stream.ahead(), 'a refused row was never asked again').toContain('AAA:1')
    hold.clear()
    for (const f of others) f()
    w.store.dispose()
  })
})

describe('H: the roll hold is at most ROLL_HOLD_MAX_MS, then the server\'s answer paints under its honest status', () => {
  async function behind(mode) {
    vi.setSystemTime(at(10, 0, 55))
    const w = await boot(mode)
    await warmNext(w, ['AAA'])                                         // read 5 s before the 10:01 roll
    vi.setSystemTime(at(10, 1, 0) + 500)
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(false)
    return w
  }

  it('H1 the own ask held: nothing at 300 ms; the copy as it is at 400 ms, UPDATING; the answer then replaces it', async () => {
    const w = await behind('ok')
    expect(w.P.ROLL_HOLD_MAX_MS).toBe(400)
    let out = 'pending'
    w.pf.prepareForDisplay('AAA', '1').then((o) => { out = o })
    await tick(300)                                                    // nobody answers
    expect(out).toBe('pending')
    await tick(150)
    expect(out, 'the hold ran past ROLL_HOLD_MAX_MS').toBe('updating')
    expect(holdsClosed(w, 'AAA', T(10, 0))).toBe(false)               // what the store holds: the copy as it is...
    expect(w.store.peek(w.k('AAA')).status, '...painted as current').toBe('updating')
    await serve(w, 100)                                                // the answer lands
    expect(holdsClosed(w, 'AAA', T(10, 0))).toBe(true)
    expect(w.store.peek(w.k('AAA')).status).toBe('current')
    w.store.dispose()
  })

  it('H2 an answer holding the closed bar inside the bound: current at once', async () => {
    const w = await behind('ok')
    let out = 'pending'
    w.pf.prepareForDisplay('AAA', '1').then((o) => { out = o })
    await serve(w, 60)
    expect(out).toBe('current')
    expect(holdsClosed(w, 'AAA', T(10, 0))).toBe(true)
    w.store.dispose()
  })

  it('H3 the server\'s answer still lacks the closed bar: painted at once, UPDATING, and no third ask', async () => {
    const lagFrom = at(10, 0, 58)
    const w = await behind((q) => (Date.now() >= lagFrom ? 'lag:3' : 'ok'))
    const n0 = w.server.calls.length
    let out = 'pending'
    w.pf.prepareForDisplay('AAA', '1').then((o) => { out = o })
    await serve(w, 120)
    expect(out, 'a non-streamed row waited for a push frame that cannot come').toBe('updating')
    expect(holdsClosed(w, 'AAA', T(10, 0))).toBe(false)
    expect(w.store.peek(w.k('AAA')).status).toBe('updating')
    await serve(w, 3_000)
    expect(callsOf(w, 'AAA', n0).length).toBeLessThanOrEqual(2)       // the own since= ask and its one full re-ask
    w.store.dispose()
  })

  it('H4 a push frame bringing the closed bar inside the bound ends the hold at once', async () => {
    vi.setSystemTime(at(10, 0, 55))
    const w = await boot('ok')
    await warmNext(w, ['AAA'])
    const off = w.store.watchLive(w.k('AAA'))
    w.stream.st.live.set('AAA:1', at(10, 1, 0) + 100)                 // live only since just after the roll
    vi.setSystemTime(at(10, 1, 0) + 500)
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(false)
    let out = 'pending'
    w.pf.prepareForDisplay('AAA', '1').then((o) => { out = o })
    await tick(150)                                                    // the own ask is held
    expect(out).toBe('pending')
    w.stream.emit('AAA', '1', frame('AAA', T(10, 0), 10.8, at(10, 1, 0) + 650, true))
    w.stream.emit('AAA', '1', frame('AAA', T(10, 1), 10.9, at(10, 1, 0) + 651))
    await tick(20)
    expect(out, 'the push frame with the closed bar did not end the hold').toBe('current')
    expect(holdsClosed(w, 'AAA', T(10, 0))).toBe(true)
    off()
    w.store.dispose()
  })

  it('H5 the next press (abort) ends the hold at once, and nothing more is asked', async () => {
    const w = await behind('ok')
    const ctl = new AbortController()
    let settled = false
    w.pf.prepareForDisplay('AAA', '1', { signal: ctl.signal }).then(() => { settled = true }, () => { settled = true })
    await tick(100)                                                    // nobody answers
    expect(settled).toBe(false)
    ctl.abort()
    await tick(10)
    expect(settled).toBe(true)
    const n1 = w.server.calls.length
    await tick(3_000)
    expect(callsOf(w, 'AAA', n1).length).toBe(0)
    w.store.dispose()
  })
})
