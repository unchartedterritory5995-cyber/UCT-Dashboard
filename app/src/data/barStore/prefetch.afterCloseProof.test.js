// B9, the cause (2026-11-28 cold-coverage run, COV-zo-m1-typed, after the 2026-11-27 half day): CRAI typed on a 1m + 15m
// board. Both charts' rows were in (the 15m device copy joined by the lake, 18,862 rows; the 1m answer joined by the lake,
// 19,330 rows), and the switch still held the previous chart to the 4 s hang guard. CRAI is illiquid: its newest 1m bar
// was 12:56, three buckets short of the 13:00 close. The server answered that tail `verified` (its proof, the live
// stream's watermark, reached 20:00 ET), but the client's grace asked the proof to reach the CLOCK's newest roll (20:49,
// the minute of the press), which after the close no proof can: the copy read behind all evening, peekDisplayable said no,
// and the linked group never painted. The proof must reach the VIEW's newest closed bucket: the session's close.
// Through the real store and prefetch facade, the real NYSE calendar (early close 13:00 on 11-27).
// ⛔ The clock is 16:49 ET (21:49Z), not the run's 20:49: before 19:00 ET the ET and UTC dates agree, so the rail reads the
// same in any runner time zone. (utils/marketSession expectedLatestCompletedBar reads the LOCAL weekday: on a UTC runner
// 20:49 ET is Saturday, the frontier reads null and no copy is behind at all. A separate defect, not this one's.)
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createBarStore } from './index'
import { createPrefetch } from './prefetch'
import { keyOf } from './types'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { memClear } from '../../utils/barsMemCache'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

/** Unix s of ET wall time (EDT from 2026-03-08 through 2026-10-31, EST otherwise). */
const et = (iso, hh, mm, ss = 0) => {
  const [y, m, d] = iso.split('-').map(Number)
  const off = iso >= '2026-03-08' && iso < '2026-11-01' ? 4 : 5
  return Date.UTC(y, m - 1, d, hh + off, mm, ss) / 1000
}
const bar = (t) => { const i = Math.floor(t / 60) % 997; const o = Math.round((150 + ((i * 7) % 13) / 4) * 100) / 100; return { t, o, h: o + 0.5, l: o - 0.5, c: o + 0.25, v: 30 + i } }
/** An illiquid name's 1m rows: a print every third minute from `from` to `last` (ET minutes, inclusive) of each day. */
function thinRows(days) {
  const out = []
  for (const { iso, from, last } of days) for (let m = from; m <= last; m += 3) out.push(bar(et(iso, Math.floor(m / 60), m % 60)))
  return out
}
// the B9 case: 11-25 whole, then the 11-27 half day to 12:56 (three buckets short of the 13:00 close)
const HALF_DAY = [{ iso: '2026-11-25', from: 570, last: 957 }, { iso: '2026-11-27', from: 572, last: 12 * 60 + 56 }]

function answer({ rows, verifiedThrough, tailStatus }) {
  return {
    ticker: 'ILQ', tf: '1', bars: rows, contract: 1, grid: 'eth-clock', session: 'rth',
    cache_key: 'b1:ILQ:1:eth-clock', series_rev: 9000, history_rev: 1, verified_through: verifiedThrough,
    complete_through: rows[rows.length - 1].t + 60, tail_status: tailStatus, developing: null,
  }
}

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

async function switched({ nowSec, verifiedThrough, tailStatus = 'verified', days = HALF_DAY, ext = false }) {
  vi.setSystemTime(nowSec * 1000)
  const rows = thinRows(days)
  const request = vi.fn(async () => answer({ rows, verifiedThrough, tailStatus }))
  const store = createBarStore({
    request,
    io: { idbGet: async () => null, idbGetHistoryEntry: async () => null, idbPutMonotonic: async () => {}, memPutMonotonic: () => {} },
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const pf = createPrefetch({ store, tickerMeta: () => {}, extended: () => ext })
  let outcome = 'PENDING'
  pf.prepareForDisplay('ILQ', '1').then((v) => { outcome = v })
  await vi.advanceTimersByTimeAsync(600)
  // (the answer landed whole, the tail as served: a rail whose fixture failed would read 'not painted' for the wrong reason)
  const key = keyOf({ sym: 'ILQ', tf: '1' })
  const held = store.peek(key)
  expect(held.restSeen).toBe(true)
  expect(held.error ?? null).toBe(null)
  expect(held.bars[held.bars.length - 1].t).toBe(rows[rows.length - 1].t)
  return { pf, store, request, key, outcome: () => outcome }
}

describe('B9: after the close, a thin tail the server proved paints at once', () => {
  it('11-27 16:49 ET, tail 12:56, proof through 16:00: the switch may paint it', async () => {
    const w = await switched({ nowSec: et('2026-11-27', 16, 49, 30), verifiedThrough: et('2026-11-27', 16, 0) })
    expect(w.request).toHaveBeenCalledTimes(1)
    expect(w.outcome()).not.toBe('PENDING')
    expect(w.pf.peekDisplayable('ILQ', '1')).toBe(true)
  })

  it('...and a proof stamped exactly at the close (13:00) is enough', async () => {
    const w = await switched({ nowSec: et('2026-11-27', 16, 49, 30), verifiedThrough: et('2026-11-27', 13, 0) })
    expect(w.pf.peekDisplayable('ILQ', '1')).toBe(true)
  })

  it('control: a proof short of the close (12:58) never paints the tail as current', async () => {
    const w = await switched({ nowSec: et('2026-11-27', 16, 49, 30), verifiedThrough: et('2026-11-27', 12, 58) })
    expect(w.pf.peekDisplayable('ILQ', '1')).toBe(false)
  })

  it('control: a tail the server marked unverified never paints as current, whatever the proof', async () => {
    const w = await switched({ nowSec: et('2026-11-27', 16, 49, 30), verifiedThrough: et('2026-11-27', 16, 0), tailStatus: 'unverified' })
    expect(w.pf.peekDisplayable('ILQ', '1')).toBe(false)
  })
})

describe('B9 follow-up: every out-of-session clock, and the copy marked short', () => {
  it('the evening after 19:00 ET (20:49; any runner zone since the ET-calendar fix): a proof through the live stream (20:00) paints', async () => {
    const w = await switched({ nowSec: et('2026-11-27', 20, 49, 30), verifiedThrough: et('2026-11-27', 20, 0) })
    expect(w.pf.peekDisplayable('ILQ', '1')).toBe(true)
  })

  it('...and a proof short of the close still does not', async () => {
    const w = await switched({ nowSec: et('2026-11-27', 20, 49, 30), verifiedThrough: et('2026-11-27', 12, 58) })
    expect(w.pf.peekDisplayable('ILQ', '1')).toBe(false)
  })

  it('the weekend (Saturday 11-28 10:00 ET): the Friday tail paints at once, no hold (nothing is expected on a closed day)', async () => {
    const w = await switched({ nowSec: et('2026-11-28', 10, 0), verifiedThrough: null, tailStatus: 'current' })
    expect(w.pf.peekDisplayable('ILQ', '1')).toBe(true)
  })

  it('pre-market (Monday 11-30 07:00 ET, a regular-hours view): the Friday tail paints at once', async () => {
    const w = await switched({ nowSec: et('2026-11-30', 7, 0), verifiedThrough: null, tailStatus: 'current' })
    expect(w.pf.peekDisplayable('ILQ', '1')).toBe(true)
  })

  const EXT_DAYS = [{ iso: '2026-11-25', from: 240, last: 1197 }, { iso: '2026-11-27', from: 242, last: 16 * 60 + 56 }]
  it('an EXTENDED view after the half day (17:30 ET): its session ended at 17:00, so a proof through 17:00 paints a 16:56 tail', async () => {
    const w = await switched({ nowSec: et('2026-11-27', 17, 30, 30), verifiedThrough: et('2026-11-27', 17, 0), days: EXT_DAYS, ext: true })
    expect(w.pf.peekDisplayable('ILQ', '1', { showExtended: true })).toBe(true)
  })

  it('...and on that view a proof short of 17:00 does not', async () => {
    const w = await switched({ nowSec: et('2026-11-27', 17, 30, 30), verifiedThrough: et('2026-11-27', 16, 58), days: EXT_DAYS, ext: true })
    expect(w.pf.peekDisplayable('ILQ', '1', { showExtended: true })).toBe(false)
  })

  const DST_DAYS = [{ iso: '2026-10-29', from: 570, last: 957 }, { iso: '2026-10-30', from: 572, last: 15 * 60 + 56 }]
  it('the DST weekend (Friday 10-30 EDT, 20:49): a 15:56 tail with a proof through the 16:00 close paints', async () => {
    const w = await switched({ nowSec: et('2026-10-30', 20, 49, 30), verifiedThrough: et('2026-10-30', 16, 0), days: DST_DAYS })
    expect(w.pf.peekDisplayable('ILQ', '1')).toBe(true)
  })

  it('...and one through 15:58 does not', async () => {
    const w = await switched({ nowSec: et('2026-10-30', 20, 49, 30), verifiedThrough: et('2026-10-30', 15, 58), days: DST_DAYS })
    expect(w.pf.peekDisplayable('ILQ', '1')).toBe(false)
  })

  it('hardening: an answer that landed within TAIL_LAG_WINDOW_MS of the close never counts, even when read after it', async () => {
    const { TAIL_LAG_WINDOW_MS } = await import('./prefetch')
    const w = await switched({ nowSec: et('2026-11-27', 13, 0, 4), verifiedThrough: et('2026-11-27', 13, 0) })   // landed 13:00:04
    await vi.advanceTimersByTimeAsync(TAIL_LAG_WINDOW_MS - 3000)                                               // read at ~13:00:09
    expect(w.pf.peekDisplayable('ILQ', '1')).toBe(false)
  })

  it("an unproven copy is marked short of the SESSION's last bucket (12:59), never the clock's previous minute", async () => {
    const w = await switched({ nowSec: et('2026-11-27', 16, 49, 30), verifiedThrough: null, tailStatus: 'unverified' })
    await vi.advanceTimersByTimeAsync(1000)                   // past the roll hold: the copy is painted, marked short
    expect(w.store.peek(w.key).awaitingClosed).toBe(et('2026-11-27', 12, 59))
  })
})
