// ⭐ THE CANDLES' TAIL, COMPOSED OUTSIDE A RENDER (imperative switch, stage 3; owner's ruling 2026-11-21).
//
// StockChart's `ohlcData` memo paints `ohlcBase.slice()` plus a load-anchor tail: blank slots for the sessions a
// daily tail is behind (the same list the framing's reserve counts), today's seed in the frontier slot, the
// stale-today repair, the W/M live point. The seed, the repair and the live point ask the symbol's live-price
// sanity, which is the symbol's own hook state. `switchTailFor` composes the tail for the NEXT symbol with the
// memo's own function (`ohlcLoadAnchorTail`) and a probe in place of that sanity:
//   • a resolver that never reaches for it returned what it returns in a render: the tail is used as built;
//   • a resolver that reaches for it needed the symbol's state: the switch is REFUSED, never approximated;
//   • a tail whose length disagrees with the framing's reserve is refused too.
// The cases below are the ones a plain D or intraday switch meets, each named with what decides it.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { pinWallClock } from '../testing/pinnedWallClock'

const S = vi.hoisted(() => ({ prices: {} }))
vi.mock('../hooks/livePriceStore', () => ({
  registerTickers: () => () => {}, subscribe: () => () => {}, getSnapshot: () => S.prices,
  pollNow: () => {}, setUnauthorizedHandler: () => {}, __resetForTest: () => {},
}))

let M
let clock
beforeAll(async () => {
  clock = pinWallClock('2026-09-22T17:17:00Z')   // Tue 13:17 ET, the regular session in progress
  M = await import('./StockChart')
}, 60_000)
afterAll(() => clock.restore())
beforeEach(() => { S.prices = {} })

const adjust = (t) => t
const LIVE = { price: 10.4, day_open: 10, day_high: 11, day_low: 9, ext_session: false, observed_at: Date.now() }
/** Daily bars, one per weekday, ending on `lastISO`. */
const dailyTo = (lastISO, n = 40) => {
  const out = []
  const d = new Date(`${lastISO}T12:00:00Z`)
  while (out.length < n) {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) out.unshift({ t: d.toISOString().slice(0, 10), o: 10, h: 11, l: 9, c: 10.5, v: 1000 })
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}
const fiveMin = () => {
  const out = []
  const open = Date.UTC(2026, 8, 22, 13, 30) / 1000
  for (let i = 0; i < 40; i++) out.push({ t: open + i * 300, o: 10, h: 11, l: 9, c: 10.5, v: 100 })
  return out
}
/** What `switchFrame.buildFrame` hands over, as far as the tail reads it. */
const builtOf = (bars) => ({
  ohlcBase: bars.map((b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c })),
  displayBars: bars,
  filteredBars: bars,
})
const VERIFIED = { restSeen: true }    // a server-answered snapshot
const LOCAL = { restSeen: false }      // a local copy the server has not answered for yet

describe('the clock and the reserve under it (the cases below are not vacuous)', () => {
  it('Friday\'s tail is behind the frontier during Tuesday\'s session, and the frontier is today', () => {
    const slots = M._dailyReserveDates('2026-09-18')
    expect(slots.length).toBeGreaterThanOrEqual(1)
    expect(slots.at(-1)).toBe('2026-09-22')
    expect(M._dailyReserveDates('2026-09-22')).toEqual([])
  })
})

describe('switchTailFor: an intraday switch', () => {
  it('has no tail: the candles are the base, as a COPY (the filed array is never handed to the series)', () => {
    S.prices = { BBB: LIVE }   // a live price changes nothing here
    const built = builtOf(fiveMin())
    const r = M.switchTailFor(built, 'BBB', VERIFIED, '5', adjust)
    expect(r.ok).toBe(true)
    expect(r.kind).toBe('none')
    expect(r.ohlcData).toEqual(built.ohlcBase)
    expect(r.ohlcData).not.toBe(built.ohlcBase)
  })
})

describe('switchTailFor: a daily switch whose bars reach today', () => {
  const bars = () => dailyTo('2026-09-22')
  it('a server-answered snapshot: no tail, whatever the live price (the repair is not asked for)', () => {
    S.prices = { BBB: LIVE }
    const built = builtOf(bars())
    const r = M.switchTailFor(built, 'BBB', VERIFIED, 'D', adjust)
    expect(r).toMatchObject({ ok: true, kind: 'none' })
    expect(r.ohlcData).toEqual(built.ohlcBase)
  })
  it('a local-only snapshot with a live price: the stale-today repair needs the symbol\'s live-price sanity, so the switch is REFUSED', () => {
    S.prices = { BBB: LIVE }
    expect(M.switchTailFor(builtOf(bars()), 'BBB', LOCAL, 'D', adjust)).toEqual({ ok: false })
  })
  it('a local-only snapshot with NO live price: nothing to repair with, no tail', () => {
    const built = builtOf(bars())
    const r = M.switchTailFor(built, 'BBB', LOCAL, 'D', adjust)
    expect(r).toMatchObject({ ok: true, kind: 'none' })
    expect(r.ohlcData).toEqual(built.ohlcBase)
  })
})

describe('switchTailFor: a daily switch whose bars are sessions behind', () => {
  const bars = () => dailyTo('2026-09-18')
  it('NO live price: one blank slot per missing session, the framing\'s reserve exactly', () => {
    const built = builtOf(bars())
    const r = M.switchTailFor(built, 'BBB', VERIFIED, 'D', adjust)
    const slots = M._dailyReserveDates('2026-09-18')
    expect(r).toMatchObject({ ok: true, kind: 'whitespace' })
    expect(r.ohlcData.length - built.ohlcBase.length).toBe(slots.length)
    expect(r.ohlcData.length - built.ohlcBase.length).toBe(M._intradayLoadReserve(built.filteredBars, 'D'))
    expect(r.ohlcData.slice(built.ohlcBase.length)).toEqual(slots.map((iso) => ({ time: iso })))
    expect(r.ohlcData.slice(0, built.ohlcBase.length)).toEqual(built.ohlcBase)
  })
  it('a live price: today\'s seed needs the symbol\'s live-price sanity, so the switch is REFUSED', () => {
    S.prices = { BBB: LIVE }
    expect(M.switchTailFor(builtOf(bars()), 'BBB', VERIFIED, 'D', adjust)).toEqual({ ok: false })
  })
  it('a live price of ANOTHER symbol changes nothing', () => {
    S.prices = { AAA: LIVE }
    expect(M.switchTailFor(builtOf(bars()), 'BBB', VERIFIED, 'D', adjust)).toMatchObject({ ok: true, kind: 'whitespace' })
  })
})

describe('ohlcLoadAnchorTail: the one implementation the memo and the controller share', () => {
  it('with the render\'s own seed (the memo\'s call) the frontier slot is today\'s candle', () => {
    const bars = dailyTo('2026-09-18')
    const arr = builtOf(bars).ohlcBase.slice()
    const seed = { t: '2026-09-22', o: 10, h: 11.2, l: 9.4, c: 10.9 }
    M.ohlcLoadAnchorTail(arr, bars, {
      econ: false, exactDateRange: false, entryDate: null, replayCutoff: null, resolvedTf: 'D', adjustTime: adjust, sym: 'BBB',
      dailySeed: () => seed, repairToday: false, liveSane: () => true,
    })
    expect(arr.at(-1)).toEqual({ time: '2026-09-22', open: 10, high: 11.2, low: 9.4, close: 10.9 })
  })
  it('an exact range, an entry date, a replay or an ECON id: no tail at all (the memo\'s own gate)', () => {
    const bars = dailyTo('2026-09-18')
    for (const off of [{ econ: true }, { exactDateRange: true }, { entryDate: '2026-01-02' }, { replayCutoff: '2026-09-01' }]) {
      const arr = builtOf(bars).ohlcBase.slice()
      M.ohlcLoadAnchorTail(arr, bars, {
        econ: false, exactDateRange: false, entryDate: null, replayCutoff: null, resolvedTf: 'D', adjustTime: adjust, sym: 'BBB',
        dailySeed: () => null, repairToday: false, liveSane: () => true, ...off,
      })
      expect(arr.length, JSON.stringify(off)).toBe(bars.length)
    }
  })
})
