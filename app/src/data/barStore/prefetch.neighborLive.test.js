// ⭐ THE NEXT ROWS RIDE THE LIVE STREAM, SO THE FIRST PRESS AFTER A MINUTE ROLL IS IN THE KEY TASK (2026-11-25).
// Replay of #2708 (S&P 500, 1m + 15m, a press every 2.5 s): every remaining wait was the first press after a roll (6 of 152,
// ~105 ms). The row's copy was read ~5 s before, BEFORE the roll, so it lacks the closed minute and the switch asks for it.
// The owner's standard for that first frame (2026-11-25): "as current as the chart on screen". Bar M present with the
// server's own PUSH values (provisional until the push final) is correct; a copy without bar M is not.
//   L1  a next row whose push stream has delivered since BEFORE the roll: the press 0.5 s after the roll paints it in the
//       key task, bar M as the stream left it, no request
//   L1b the same copy, its stream delivering only since AFTER the roll: not shown (the #2708 rule: the switch asks)
//   L1c a live stream but a copy WITHOUT bar M (two rolls later, nothing printed in the newer minute): not shown
//   L1d no push stream for the row: the #2708 rule, unchanged
//   L2  the hold subscribes the travel-direction rows it is given (`live`), at most NEIGHBOR_LIVE_ROWS per hold, as
//       AHEAD pairs; a row leaving is released; clear() releases all; a hidden page subscribes none
//   L2b ...only while the member navigates: TAIL_ACTIVE_MS after the last selection change they are released
//   L3  the page cap: at most NEIGHBOR_LIVE_MAX_KEYS keys ride the stream as a neighbour (the store's watchLive)
// ...and the 250 ms paint-as-is hole, for the roll class (a copy lacking a closed bar is never painted as it is: the
// previous chart stays until the copy holds the closed bar, a re-ask every TAIL_LAG_RETRY_MS inside TAIL_LAG_WINDOW_MS):
//   H1  the own ask held 600 ms: the switch has not committed at 250 ms; it commits with the closed bar
//   H2  the own answer still lacks the closed bar (the server's write lag): no paint as it is; re-asked until it holds it
//   H3  the bound: past TAIL_LAG_WINDOW_MS of the roll the server's answer is what paints (the name not printing)
//   H4  the path with NO copy: an answer lacking the closed bar is not painted either
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

async function boot(modeFor, { visible = () => true } = {}) {
  vi.resetModules()
  const server = installFakeBarsServer({ modeFor: typeof modeFor === 'function' ? modeFor : () => modeFor })
  const { createBarStore } = await import('./index')
  const P = await import('./prefetch')
  const stream = fakeStream()
  const store = createBarStore({
    stream, candle: fakeCandle(), prices: fakePrices(), pushEnabled: () => true,
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const pf = P.createPrefetch({ store, tickerMeta: () => {}, extended: () => false, visible, random: () => 0, deepNeighbors: () => false })
  return { server, store, stream, P, pf, k: (sym) => pf.keyFor(sym, '1') }
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

describe('L: a next row the push stream has kept current through the roll is shown in the key task', () => {
  async function liveRow(w, liveSince) {
    await warmNext(w, ['AAA'])                                         // the urgent next-row warm, at 10:00:50
    const hold = w.pf.createNeighborHold()
    navigate(hold, ['ZZZ', 'AAA'], { tail: ['AAA'], live: ['AAA'] })
    expect(w.stream.ahead(), 'the next row does not ride the stream').toEqual(['AAA:1'])
    if (liveSince != null) w.stream.st.live.set('AAA:1', liveSince)
    w.stream.emit('AAA', '1', frame('AAA', T(10, 0), 10.7, at(10, 0, 59)))   // the minute's last trades, pushed
    return hold
  }

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

  it('L1c a live stream, but a copy WITHOUT bar M (two rolls later, nothing printed in 10:01): not shown', async () => {
    vi.setSystemTime(at(10, 0, 50))
    const w = await boot('ok')
    const hold = await liveRow(w, at(10, 0, 51))
    vi.setSystemTime(at(10, 2, 0) + 500)                               // M = 10:01, the copy ends at 10:00
    expect(w.pf.peekDisplayable('AAA', '1'), 'a copy missing the closed 10:01 bar was shown').toBe(false)
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
    const w = await boot('ok', { visible: () => false })
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
})

describe('H: a copy lacking a closed bar is never painted as it is (the roll class)', () => {
  async function behind(mode) {
    vi.setSystemTime(at(10, 0, 55))
    const w = await boot(mode)
    await warmNext(w, ['AAA'])                                         // read 5 s before the 10:01 roll
    vi.setSystemTime(at(10, 1, 0) + 500)
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(false)
    return w
  }

  it('H1 the own ask held 600 ms: the switch has not committed at 250 ms; it commits with the closed bar', async () => {
    const w = await behind('ok')
    let out = 'pending'
    w.pf.prepareForDisplay('AAA', '1').then((o) => { out = o })
    await tick(600)                                                    // nobody answers (a slow edge)
    expect(out, 'a copy lacking the closed 10:00 bar was painted as it is after 250 ms').toBe('pending')
    await serve(w, 100)
    expect(out).toBe('current')
    expect(holdsClosed(w, 'AAA', T(10, 0))).toBe(true)
    w.store.dispose()
  })

  it('H2 the own answer still lacks the closed bar (the server stores a bucket 3 s late): re-asked until it holds it', async () => {
    const lagFrom = at(10, 0, 58)
    const w = await behind((q) => (Date.now() >= lagFrom ? 'lag:3' : 'ok'))
    const n0 = w.server.calls.length
    let out = 'pending'
    w.pf.prepareForDisplay('AAA', '1').then((o) => { out = o })
    await serve(w, 1_500)                                              // 10:01:02: the server still lacks 10:00
    expect(out, 'the server\'s answer lacking the closed 10:00 bar was painted as it is').toBe('pending')
    await serve(w, 2_500)                                              // 10:01:04.5: it has it since 10:01:03
    expect(out).toBe('current')
    expect(holdsClosed(w, 'AAA', T(10, 0))).toBe(true)
    expect(callsOf(w, 'AAA', n0).length).toBeLessThanOrEqual(6)       // ~one ask a second, never a storm
    w.store.dispose()
  })

  it('H3 the bound: past TAIL_LAG_WINDOW_MS of the roll, the server\'s answer is what paints (the name not printing)', async () => {
    const lagFrom = at(10, 0, 58)
    const w = await behind(() => (Date.now() >= lagFrom ? 'lag:30' : 'ok'))
    let out = 'pending'
    let doneAt = null
    w.pf.prepareForDisplay('AAA', '1').then((o) => { out = o; doneAt = Date.now() })
    await serve(w, 6_000)                                              // 10:01:06.5
    expect(out).toBe('pending')
    await serve(w, 4_000)                                              // 10:01:10.5
    expect(out).toBe('current')
    expect(doneAt).toBeGreaterThanOrEqual(at(10, 1, 0) + w.P.TAIL_LAG_WINDOW_MS)
    expect(doneAt).toBeLessThanOrEqual(at(10, 1, 0) + w.P.TAIL_LAG_WINDOW_MS + 1_500)
    w.store.dispose()
  })

  it('H4 the path with NO copy: an answer lacking the closed bar is not painted either', async () => {
    vi.setSystemTime(at(10, 1, 0) + 500)
    const w = await boot(() => (Date.now() < at(10, 1, 3) ? 'lag:3' : 'ok'))
    let out = 'pending'
    w.pf.prepareForDisplay('AAA', '1').then((o) => { out = o })
    await serve(w, 1_000)                                              // 10:01:01.5: answered, without 10:00
    expect(out, 'a first answer lacking the closed 10:00 bar was painted').toBe('pending')
    await serve(w, 3_000)
    expect(out).toBe('current')
    expect(holdsClosed(w, 'AAA', T(10, 0))).toBe(true)
    w.store.dispose()
  })

  it('H5 the next press (abort) ends the hold at once, and nothing more is asked', async () => {
    const lagFrom = at(10, 0, 58)
    const w = await behind(() => (Date.now() >= lagFrom ? 'lag:30' : 'ok'))
    const ctl = new AbortController()
    let settled = false
    w.pf.prepareForDisplay('AAA', '1', { signal: ctl.signal }).then(() => { settled = true }, () => { settled = true })
    await serve(w, 500)
    expect(settled).toBe(false)
    ctl.abort()
    await serve(w, 50)
    expect(settled).toBe(true)
    const n1 = w.server.calls.length
    await serve(w, 3_000)
    expect(callsOf(w, 'AAA', n1).length).toBe(0)
    w.store.dispose()
  })
})
