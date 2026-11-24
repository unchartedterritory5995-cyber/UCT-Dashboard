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

async function boot(modeFor) {
  vi.resetModules()
  const server = installFakeBarsServer({ modeFor: typeof modeFor === 'function' ? modeFor : () => modeFor })
  const { createBarStore } = await import('./index')
  const P = await import('./prefetch')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
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

  it('C1b (control) one bucket behind long after the roll: the name did not print, the own answer lends its grace', async () => {
    vi.setSystemTime(at(10, 1, 25))
    const w = await boot('lag:65')                                    // nothing newer than 09:59 for over a minute
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

  it('C4 ...and with no paintable copy held (the plain path): an answer behind is asked once more, in full', async () => {
    vi.setSystemTime(at(10, 1, 12))
    let n = 0
    const w = await boot(() => (n++ === 0 ? 'lag:180' : 'ok'))       // the first answer three minutes behind, then healed
    const n0 = w.server.calls.length
    let out = 'pending'
    w.pf.prepareForDisplay('RRR', '1').then((o) => { out = o })
    await serve(w, w.P.BEHIND_HOLD_MAX_MS + 50)
    const asks = callsOf(w, 'RRR', n0)
    expect(asks.length, 'an own answer three buckets behind was painted as it was').toBe(2)
    expect(asks[1].q.since).toBe(null)
    expect(out).toBe('current')
    expect(holds(w, 'RRR', T(10, 0))).toBe(true)
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
