// ⭐ A SWITCH'S FIRST FRAME NEVER SHOWS A COPY MISSING A CLOSED BAR (live session 2026-11-24, production 2575075701, 1m + 15m,
// S&P 500, a press every 2.5 s: 9 of 146 presses showed the 1m chart one or two closed bars short for 34 ms to ~1 s).
// Each class is replayed here with its exact sequence:
//   B   the urgent next-row warm answered the row ~5 s before the press, BEFORE a minute roll: its developing bar is the
//       bucket that has since closed. _bucketsBehind counted that developing bar as the frontier, so the press painted the
//       copy in the key task and the closed minute came 34-250 ms later (ORCL, GEV, PLTR, WDC, KLAC, MO).
//       B1  such a copy is not shown in the key task; the press asks its tail (own) and paints the closed minute
//       B1b (control) an answer read AFTER the roll whose developing bar is the bucket that just closed (its seal not
//           landed) still holds the frontier: shown in the key task, as before
//       B2  the urgent next-row warm asks again a next row whose answer predates the current bucket, so the press after
//           it is in the key task again; B3 once per row per bucket (a re-ask still behind is not repeated)
//   C   the switch's OWN answer was still behind and the "not printing" grace painted it (AMD, AMAT ~3-5 s after a roll;
//       RDDT, two closed bars short, its since= answer racing the server's heal):
//       C1  one bucket behind inside TAIL_LAG_WINDOW_MS of a roll is the server's write lag: no grace;
//           C1b (control) one bucket behind long after the roll is still the name not printing: the grace stands
//       C2  two or more buckets behind: never a grace
//       C3  the own answer still behind: ONE more ask, WITHOUT since=, inside the BEHIND_HOLD_MAX_MS hold (the held copy)
//       C4  ...and on the path with no paintable copy (RDDT's)
//       C5  an own answer the server marked `unverified` lends no grace either (the client half of the server's fix)
// ...and from the review of #2708:
//       C6  MEDIUM-1: a name that did not trade, its answer N buckets behind WITH the server's proof, is the name not
//           printing at any N: the grace, one ask (C6); WITHOUT that proof it waits (C6c)
// ...and from its round 2: the server can stamp a proof AT or past the roll while the just-closed bucket is not stored (a
// provider heal at roll+1 s; the live stream's market-wide watermark). (Round 3: the roll and the proof floor are the
// current and the newest closed bucket's STARTS: on the 60m session grid the last bar is 15:30-16:00, so "end minus 60
// min" put the roll at 15:00: G60a, G60b, G60c.) So the proof lends the grace only when it covers
// every bucket BEFORE the newest closed one AND TAIL_LAG_WINDOW_MS has passed since the roll (never more than C1b's
// accepted fallback): C6b (inside the window: no grace), C6d (a thin name 5 behind: no grace in the first 8 s, the grace
// from roll+8 s on), C6e (a proof through the middle of the newest closed bucket suffices after the window), C7 (path 1:
// a proof stamped at roll+1 s, the bucket absent), C7b (path 2: a watermark at the roll, the minute absent).
// (2026-11-25, review of #2733: the proof must now reach the ROLL itself, the newest closed bucket's end, so C6e reads NO
// grace for a proof through that bucket's middle, C6f is its control through the roll, and G60c's control reaches 15:30.)
//       C4  LOW (a): a first ask that was already a full read is not asked again in full; C4b the RDDT path (a held local
//           copy, its first ask a since= delta) is
//       B1c LOW (b): a developing bar written exactly at its bucket's end holds the frontier (the comparison is >=, in ms)
//       B1d LOW (c): what the real server sends after a roll (B1b cannot happen: the contract never sends a closed bucket
//           as developing): the just-closed bucket as a stored ROW not final yet. It is the frontier (the key task), its
//           close is the provisional one, and the next answer replaces it with the final close
// Real store, real network, real facade, a held fake server.
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

async function boot(modeFor, { maxKeys = null } = {}) {
  vi.resetModules()
  const server = installFakeBarsServer({ modeFor: typeof modeFor === 'function' ? modeFor : () => modeFor })
  const { createBarStore } = await import('./index')
  const P = await import('./prefetch')
  const R = await import('./registry')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
    ...(maxKeys ? { registry: R.createRegistry({ maxKeys, ctx: () => ({ nowMs: Date.now() }) }) } : {}),
  })
  const pf = P.createPrefetch({ store, tickerMeta: () => {}, extended: () => false, visible: () => true, random: () => 0, deepNeighbors: () => false })
  return { server, store, P, pf, k: (sym) => pf.keyFor(sym, '1') }
}
const tick = (ms) => vi.advanceTimersByTimeAsync(ms)
/** Answer every open request as it comes, `ms` of fake time, 10 ms at a time. */
async function serve(w, ms) {
  for (let t = 0; t < ms; t += 10) {
    await tick(10)
    for (const c of w.server.open()) c.respond()
    await w.server.flush()
  }
}
/** The urgent next-row warm of `syms`, answered. */
async function warmNext(w, syms) {
  w.pf.prefetchBars(syms, '1', { urgent: true })
  await serve(w, 200)
}
const callsOf = (w, sym, from = 0) => w.server.calls.slice(from).filter((c) => c.q.sym === sym && c.q.tf === '1')
const tailOf = (w, sym) => {
  const s = w.store.peek(w.k(sym))
  return Math.max(s?.bars?.at(-1)?.t ?? -Infinity, s?.developing?.t ?? -Infinity)
}
const holds = (w, sym, t) => !!w.store.peek(w.k(sym))?.bars?.some((b) => b.t === t) || w.store.peek(w.k(sym))?.developing?.t > t

describe('B: a copy read before a minute roll is not the frontier', () => {
  it('B1 the next row answered 5 s before the roll is not shown in the key task; the press asks and paints the closed minute', async () => {
    vi.setSystemTime(at(10, 0, 55))
    const w = await boot('ok')
    await warmNext(w, ['AAA'])
    expect(w.store.peek(w.k('AAA')).developing?.t).toBe(T(10, 0))     // the forming 10:00 bar, read at 10:00:55
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(true)               // (control) current before the roll
    vi.setSystemTime(at(10, 1, 0) + 500)                              // the press, 0.5 s after the 10:01 roll
    expect(w.pf.peekDisplayable('AAA', '1'), 'a copy missing the closed 10:00 bar was shown in the key task').toBe(false)
    const n0 = w.server.calls.length
    let out = 'pending'
    w.pf.prepareForDisplay('AAA', '1').then((o) => { out = o })
    await serve(w, 120)
    expect(callsOf(w, 'AAA', n0).length).toBe(1)                      // the switch's own tail ask
    expect(out).toBe('current')
    expect(holds(w, 'AAA', T(10, 0)), 'the first frame lacks the closed 10:00 bar').toBe(true)
    w.store.dispose()
  })

  it('B1b (control) an answer read after the roll whose developing bar is the bucket that just closed holds the frontier', async () => {
    vi.setSystemTime(at(10, 1, 1))
    const w = await boot('pending-seal')                              // 10:00 sent as developing, its seal not landed
    await warmNext(w, ['AAA'])
    expect(w.store.peek(w.k('AAA')).developing?.t).toBe(T(10, 0))
    vi.setSystemTime(at(10, 1, 2))
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(true)
    w.store.dispose()
  })

  it("B1c a developing bar written EXACTLY at its bucket's end holds the frontier (>=, ms)", async () => {
    vi.setSystemTime(at(10, 1, 0))                                    // the answer lands at the close, to the ms
    const w = await boot('pending-seal')
    w.pf.prefetchBars(['AAA'], '1', { urgent: true })
    for (let i = 0; i < 6; i++) { await tick(0); for (const c of w.server.open()) c.respond(); await w.server.flush() }
    const dev = w.store.peek(w.k('AAA')).developing
    expect(dev?.t).toBe(T(10, 0))
    expect(dev?.rev).toBe(at(10, 1, 0))                               // (precondition) written at the bucket's end
    vi.setSystemTime(at(10, 1, 0) + 500)
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(true)
    w.store.dispose()
  })

  it('B1d the real counterpart: the just-closed bucket as a stored row not final yet is the frontier; the next answer finalises its close', async () => {
    vi.setSystemTime(at(10, 1, 1))
    let mode = 'unsealed-row'
    const w = await boot(() => mode)
    await warmNext(w, ['AAA'])
    const row = () => w.store.peek(w.k('AAA')).bars.find((b) => b.t === T(10, 0))
    expect(row()?.c).toBe(10.4)                                       // the 10:00 row as stored before its final write
    vi.setSystemTime(at(10, 1, 2))
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(true)               // the key task: no closed bar is missing
    mode = 'ok'
    const sub = w.store.subscribe(w.k('AAA'), () => {})               // the chart, shown: its own request
    await serve(w, 300)
    expect(row()?.c).toBe(10.5)                                       // ...brings the final close
    sub()
    w.store.dispose()
  })

  it('B2 the urgent next-row warm asks again a next row whose answer predates the current bucket', async () => {
    vi.setSystemTime(at(10, 0, 55))
    const w = await boot('ok')
    await warmNext(w, ['AAA', 'BBB'])
    vi.setSystemTime(at(10, 1, 1))                                    // a press after the roll warms the same next rows
    const n0 = w.server.calls.length
    await warmNext(w, ['AAA', 'BBB'])
    expect(callsOf(w, 'AAA', n0).length + callsOf(w, 'BBB', n0).length, 'the next rows were not asked again after the roll').toBe(2)
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(true)               // the press on it is in the key task
    expect(holds(w, 'AAA', T(10, 0))).toBe(true)
    w.store.dispose()
  })

  it('B3 ...once per row per bucket: a re-ask the server answered still behind is not repeated by the next press', async () => {
    vi.setSystemTime(at(10, 0, 55))
    let mode = 'ok'
    const w = await boot(() => mode)
    await warmNext(w, ['AAA', 'BBB'])
    mode = 'lag:5'                                                    // the server stores 10:00 at 10:01:05
    vi.setSystemTime(at(10, 1, 1))
    const n0 = w.server.calls.length
    await warmNext(w, ['AAA', 'BBB'])
    expect(callsOf(w, 'AAA', n0).length).toBe(1)
    vi.setSystemTime(at(10, 1, 3))                                    // the next press, same bucket
    const n1 = w.server.calls.length
    await warmNext(w, ['AAA', 'BBB'])
    expect(callsOf(w, 'AAA', n1).length + callsOf(w, 'BBB', n1).length).toBe(0)
    w.store.dispose()
  })

  it('B3b ...and a re-ask that FAILED is not repeated in the bucket either', async () => {
    vi.setSystemTime(at(10, 0, 55))
    let mode = 'ok'
    const w = await boot(() => mode)
    await warmNext(w, ['AAA'])
    mode = 'fail'
    vi.setSystemTime(at(10, 1, 1))
    const n0 = w.server.calls.length
    await warmNext(w, ['AAA'])
    expect(callsOf(w, 'AAA', n0).length).toBe(1)                      // asked again after the roll, and it failed
    mode = 'ok'
    vi.setSystemTime(at(10, 1, 3))
    const n1 = w.server.calls.length
    await warmNext(w, ['AAA'])
    expect(callsOf(w, 'AAA', n1).length, 'a next row was asked again twice in one bucket').toBe(0)
    w.store.dispose()
  })

  it('B4 a next row answered after the roll (still behind: the server lags) is not asked again by the next-row warm', async () => {
    vi.setSystemTime(at(10, 1, 1))
    const w = await boot('lag:5')
    await warmNext(w, ['AAA'])                                        // the row enters `next`: asked, answered behind
    expect(tailOf(w, 'AAA')).toBe(T(9, 59))
    vi.setSystemTime(at(10, 1, 3))
    const n0 = w.server.calls.length
    await warmNext(w, ['AAA'])
    expect(callsOf(w, 'AAA', n0).length, 'a row answered in this bucket was asked again').toBe(0)
    w.store.dispose()
  })
})

describe("C: the switch's own answer still behind", () => {
  it('C1 one bucket behind inside TAIL_LAG_WINDOW_MS of the roll is the server lagging: no grace', async () => {
    vi.setSystemTime(at(10, 0, 55))
    const w = await boot('lag:5')                                     // every bucket stored 5 s after it ends
    await warmNext(w, ['AAA'])
    vi.setSystemTime(at(10, 1, 2))
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(false)
    let out = 'pending'
    w.pf.prepareForDisplay('AAA', '1').then((o) => { out = o })
    await serve(w, w.P.BEHIND_HOLD_MAX_MS + 50)
    expect(out).toBe('current')                                       // (the hold is bounded: it paints after it)
    expect(tailOf(w, 'AAA')).toBe(T(9, 59))                           // its own answer came back still behind
    expect(w.pf.peekDisplayable('AAA', '1'), 'the next press would paint the short copy at once').toBe(false)
    w.store.dispose()
  })

  // ⛔ CHANGED 2026-11-25 (review of #2733): the grace needs the server's proof THROUGH THE ROLL. `lag:65` proved only through
  // 10:00:25 (nothing about the rest of the 10:00 bucket), so this control now uses a thin name verified through now.
  it('C1b (control) one bucket behind long after the roll: the name did not print (proved through the roll), the own answer lends its grace', async () => {
    vi.setSystemTime(at(10, 1, 25))
    const w = await boot('thin:1')                                    // no trade since 09:59, verified through now
    await warmNext(w, ['AAA'])
    vi.setSystemTime(at(10, 1, 30))
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(false)
    const n0 = w.server.calls.length
    w.pf.prepareForDisplay('AAA', '1').catch(() => {})
    await serve(w, w.P.BEHIND_HOLD_MAX_MS + 50)
    expect(tailOf(w, 'AAA')).toBe(T(9, 59))
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(true)
    expect(callsOf(w, 'AAA', n0).length).toBe(1)                      // a grace answer is not asked again in full
    w.store.dispose()
  })

  it('C2 two or more buckets behind is never a grace', async () => {
    vi.setSystemTime(at(10, 1, 10))
    const w = await boot('behind')                                    // every answer ends at 09:40
    await warmNext(w, ['AAA'])
    vi.setSystemTime(at(10, 1, 20))
    w.pf.prepareForDisplay('AAA', '1').catch(() => {})
    await serve(w, w.P.BEHIND_HOLD_MAX_MS + 50)
    expect(w.pf.peekDisplayable('AAA', '1'), 'an answer 20 buckets behind was shown as the name not printing').toBe(false)
    w.store.dispose()
  })

  it('C3 the own since= answer still behind: one more ask WITHOUT since= inside the hold, and the first frame is whole', async () => {
    vi.setSystemTime(at(10, 0, 55))
    const w = await boot((q) => (q.since != null ? 'lag:5' : 'ok'))  // the delta path lags; a full read has the minute
    await warmNext(w, ['AAA'])
    vi.setSystemTime(at(10, 1, 2))
    const n0 = w.server.calls.length
    let out = { o: 'pending' }
    const t0 = Date.now()
    w.pf.prepareForDisplay('AAA', '1').then((o) => { out = { o, ms: Date.now() - t0 } })
    await serve(w, w.P.BEHIND_HOLD_MAX_MS + 50)
    const asks = callsOf(w, 'AAA', n0)
    expect(asks.map((c) => c.q.since != null), 'the own since= answer behind was not asked again in full').toEqual([true, false])
    expect(out.o).toBe('current')
    expect(out.ms).toBeLessThan(w.P.BEHIND_HOLD_MAX_MS)
    expect(holds(w, 'AAA', T(10, 0))).toBe(true)
    w.store.dispose()
  })

  it('C4 a cold key: its first ask was already a full read, so it is NOT asked again in full (review of #2708, LOW a)', async () => {
    vi.setSystemTime(at(10, 1, 12))
    const w = await boot('lag:180')                                   // three minutes behind, no proof
    const n0 = w.server.calls.length
    let out = 'pending'
    w.pf.prepareForDisplay('RRR', '1').then((o) => { out = o })
    await serve(w, w.P.BEHIND_HOLD_MAX_MS + 50)
    const asks = callsOf(w, 'RRR', n0)
    expect(asks.map((c) => c.q.since)).toEqual([null])                // one full read; a second would hit the same path
    expect(out).toBe('authoritative')                                 // the server's own tail: painted as it is
    w.store.dispose()
  })

  it('C4b the RDDT path: a held LOCAL copy (no paintable copy), its first ask a since= delta still behind: asked once more, in full', async () => {
    vi.setSystemTime(at(9, 45, 10))
    const w = await boot((q) => (q.since != null ? 'lag:180' : 'ok'), { maxKeys: 4 })
    await warmNext(w, ['RRR'])                                        // answered at 09:45, written to the caches
    await w.store.persist.flush()
    const R = w.store.registry
    for (let i = 0; i < 8; i++) R.getSnapshot(w.pf.keyFor(`PAD${i}`, '1'))
    R.acquire(w.pf.keyFor('PAD0', '1')); R.release(w.pf.keyFor('PAD0', '1'))
    expect(R.has(w.k('RRR'))).toBe(false)                             // (precondition) the registry let it go
    vi.setSystemTime(at(10, 1, 12))
    const n0 = w.server.calls.length
    let out = 'pending'
    w.pf.prepareForDisplay('RRR', '1').then((o) => { out = o })
    await serve(w, w.P.BEHIND_HOLD_MAX_MS + 50)
    const asks = callsOf(w, 'RRR', n0)
    expect(asks[0]?.q.since, '(precondition) the first ask was a since= delta from the local copy').not.toBe(null)
    expect(asks.map((c) => c.q.since == null), 'the since= answer behind was not asked again in full').toEqual([false, true])
    expect(out).toBe('current')
    expect(holds(w, 'RRR', T(10, 0))).toBe(true)
    w.store.dispose()
  })

  it("C6 MEDIUM-1: a name that did not trade, 5 buckets behind WITH the server's proof: the grace, one ask", async () => {
    vi.setSystemTime(at(10, 5, 15))
    const w = await boot('thin:5')                                    // no trade since 09:59, verified through now
    await warmNext(w, ['THN'])
    vi.setSystemTime(at(10, 5, 20))
    const n0 = w.server.calls.length
    w.pf.prepareForDisplay('THN', '1').catch(() => {})
    await serve(w, w.P.BEHIND_HOLD_MAX_MS + 50)
    expect(tailOf(w, 'THN')).toBe(T(9, 59))
    expect(w.pf.peekDisplayable('THN', '1'), 'a name proven not to have traded waits on every press').toBe(true)
    expect(callsOf(w, 'THN', n0).length).toBe(1)
    w.store.dispose()
  })

  // ⛔ CHANGED (review of #2708, round 2): inside the lag window a proof lends no grace (it may be stamped before the
  // provider published the bucket that just closed)
  it('C6b ...one bucket behind INSIDE the lag window, even with a proof: no grace', async () => {
    vi.setSystemTime(at(10, 0, 55))
    const w = await boot('thin:1')
    await warmNext(w, ['THN'])
    vi.setSystemTime(at(10, 1, 2))
    w.pf.prepareForDisplay('THN', '1').catch(() => {})
    await serve(w, w.P.BEHIND_HOLD_MAX_MS + 50)
    expect(tailOf(w, 'THN')).toBe(T(9, 59))
    expect(w.pf.peekDisplayable('THN', '1'), 'a proof inside the lag window lent the grace').toBe(false)
    w.store.dispose()
  })

  it('C6d a thin name 5 buckets behind with a proof: no grace in the first 8 s after the roll, the grace from roll+8 s on', async () => {
    vi.setSystemTime(at(10, 5, 1))
    const w = await boot('thin:5')
    await warmNext(w, ['THN'])
    vi.setSystemTime(at(10, 5, 3))
    w.pf.prepareForDisplay('THN', '1').catch(() => {})
    await serve(w, w.P.BEHIND_HOLD_MAX_MS + 50)
    expect(w.pf.peekDisplayable('THN', '1'), 'a proof lent the grace 3 s after the roll').toBe(false)
    vi.setSystemTime(at(10, 5, 9))
    w.pf.prepareForDisplay('THN', '1').catch(() => {})
    await serve(w, w.P.BEHIND_HOLD_MAX_MS + 50)
    expect(w.pf.peekDisplayable('THN', '1')).toBe(true)
    w.store.dispose()
  })

  // ⛔ CHANGED 2026-11-25 (review of #2733): the proof must reach the ROLL, the newest closed bucket's end. One through its
  // middle proves every bucket before it and nothing about that bucket, so no grace (the client proves the newest closed
  // bucket itself, in either deploy order with the server's #2732).
  it('C6e after the window a proof through the MIDDLE of the newest closed bucket is NOT enough (it says nothing about that bucket)', async () => {
    vi.setSystemTime(at(10, 5, 15))
    const w = await boot('proof:5:-30')                               // verified through 10:04:30
    await warmNext(w, ['THN'])
    vi.setSystemTime(at(10, 5, 20))
    w.pf.prepareForDisplay('THN', '1').catch(() => {})
    await serve(w, w.P.BEHIND_HOLD_MAX_MS + 50)
    expect(tailOf(w, 'THN')).toBe(T(9, 59))
    expect(w.pf.peekDisplayable('THN', '1'), 'a proof through 10:04:30 lent the grace for the 10:04 bucket').toBe(false)
    w.store.dispose()
  })

  it('C6f (control) the same with the proof through the roll (10:05:00): the grace', async () => {
    vi.setSystemTime(at(10, 5, 15))
    const w = await boot('proof:5:0')                                 // verified through 10:05:00
    await warmNext(w, ['THN'])
    vi.setSystemTime(at(10, 5, 20))
    w.pf.prepareForDisplay('THN', '1').catch(() => {})
    await serve(w, w.P.BEHIND_HOLD_MAX_MS + 50)
    expect(tailOf(w, 'THN')).toBe(T(9, 59))
    expect(w.pf.peekDisplayable('THN', '1')).toBe(true)
    w.store.dispose()
  })

  it('G60a 60m, 15:30:03: the 15:30 bar just opened (the session grid\'s last, to 16:00): inside the window, no grace', async () => {
    vi.setSystemTime(at(15, 29, 50))
    const w = await boot('proof:1:3')                                 // the 14:30 bar absent, verified 3 s after its roll
    w.pf.prefetchBars(['HHH'], '60', { urgent: true })
    await serve(w, 200)
    vi.setSystemTime(at(15, 30, 3))
    w.pf.prepareForDisplay('HHH', '60').catch(() => {})
    await serve(w, w.P.BEHIND_HOLD_MAX_MS + 50)
    const s = w.store.peek(w.pf.keyFor('HHH', '60'))
    expect(Math.max(s.bars.at(-1).t, s.developing?.t ?? -Infinity)).toBe(T(13, 30))   // (precondition) 14:30 absent
    expect(w.pf.peekDisplayable('HHH', '60'), 'the 60m roll was read as 15:00: a proof lent the grace 3 s after 15:30').toBe(false)
    w.store.dispose()
  })

  it('G60b 60m, after the window: the proof floor is the newest closed bar\'s START (14:30), so a proof through 14:15 is not enough', async () => {
    vi.setSystemTime(at(15, 30, 15))
    const w = await boot('proof:2:-4500')                             // 13:30 and 14:30 absent, verified through 14:15
    w.pf.prefetchBars(['HHH'], '60', { urgent: true })
    await serve(w, 200)
    vi.setSystemTime(at(15, 30, 20))
    w.pf.prepareForDisplay('HHH', '60').catch(() => {})
    await serve(w, w.P.BEHIND_HOLD_MAX_MS + 50)
    expect(w.pf.peekDisplayable('HHH', '60'), 'the proof floor was 14:00').toBe(false)
    w.store.dispose()
  })

  // ⛔ CHANGED 2026-11-25 (review of #2733): the control's proof now reaches the roll (15:30), not 14:45
  it('G60c (control) the same with a proof through the roll (15:30:05): the grace', async () => {
    vi.setSystemTime(at(15, 30, 15))
    const w = await boot('proof:2:5')                                 // verified through 15:30:05
    w.pf.prefetchBars(['HHH'], '60', { urgent: true })
    await serve(w, 200)
    vi.setSystemTime(at(15, 30, 20))
    w.pf.prepareForDisplay('HHH', '60').catch(() => {})
    await serve(w, w.P.BEHIND_HOLD_MAX_MS + 50)
    expect(w.pf.peekDisplayable('HHH', '60')).toBe(true)
    w.store.dispose()
  })

  it('C7 path 1: a provider heal stamped its proof at roll+1 s, the closed bucket not stored: no grace inside the window', async () => {
    vi.setSystemTime(at(10, 0, 55))
    const w = await boot('proof:1:1')                                 // 10:00 absent, verified through 10:01:01
    await warmNext(w, ['AAA'])
    vi.setSystemTime(at(10, 1, 3))
    w.pf.prepareForDisplay('AAA', '1').catch(() => {})
    await serve(w, w.P.BEHIND_HOLD_MAX_MS + 50)
    expect(w.store.peek(w.k('AAA')).verifiedThrough).toBeGreaterThanOrEqual(T(10, 1))   // (precondition) the proof
    expect(tailOf(w, 'AAA')).toBe(T(9, 59))
    expect(w.pf.peekDisplayable('AAA', '1'), 'a proof stamped at roll+1 s lent the grace to a short copy').toBe(false)
    w.store.dispose()
  })

  it('C7b path 2: the live stream proves through the roll (its market-wide watermark), the minute not written: no grace', async () => {
    vi.setSystemTime(at(10, 0, 55))
    const w = await boot('proof:1:0')                                 // 10:00 absent, verified through 10:01:00
    await warmNext(w, ['AAA'])
    vi.setSystemTime(at(10, 1, 3))
    w.pf.prepareForDisplay('AAA', '1').catch(() => {})
    await serve(w, w.P.BEHIND_HOLD_MAX_MS + 50)
    expect(tailOf(w, 'AAA')).toBe(T(9, 59))
    expect(w.pf.peekDisplayable('AAA', '1')).toBe(false)
    w.store.dispose()
  })

  it('C6c (control) the same gap WITHOUT the proof (a store five minutes behind) lends no grace', async () => {
    vi.setSystemTime(at(10, 5, 15))
    const w = await boot('lag:300')
    await warmNext(w, ['THN'])
    vi.setSystemTime(at(10, 5, 20))
    w.pf.prepareForDisplay('THN', '1').catch(() => {})
    await serve(w, w.P.BEHIND_HOLD_MAX_MS + 50)
    expect(w.pf.peekDisplayable('THN', '1')).toBe(false)
    w.store.dispose()
  })

  it('C5 an own answer one bucket behind that the server marked unverified lends no grace', async () => {
    vi.setSystemTime(at(10, 1, 25))
    const w = await boot('lag-unverified:65')
    await warmNext(w, ['AAA'])
    vi.setSystemTime(at(10, 1, 30))
    w.pf.prepareForDisplay('AAA', '1').catch(() => {})
    await serve(w, w.P.BEHIND_HOLD_MAX_MS + 50)
    expect(tailOf(w, 'AAA')).toBe(T(9, 59))
    expect(w.pf.peekDisplayable('AAA', '1'), 'an unverified tail was shown as the name not printing').toBe(false)
    w.store.dispose()
  })
})
