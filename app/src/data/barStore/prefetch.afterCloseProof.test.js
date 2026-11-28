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

const et = (iso, hh, mm, ss = 0) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + 5, mm, ss) / 1000 }   // EST
const bar = (t) => { const i = Math.floor(t / 60) % 997; const o = Math.round((150 + ((i * 7) % 13) / 4) * 100) / 100; return { t, o, h: o + 0.5, l: o - 0.5, c: o + 0.25, v: 30 + i } }
/** An illiquid name's regular-session 1m rows: a print every third minute, the last one at `lastHm` on 11-27. */
function thinRows() {
  const out = []
  for (let m = 570; m < 960; m += 3) out.push(bar(et('2026-11-25', Math.floor(m / 60), m % 60)))
  for (let m = 572; m <= 12 * 60 + 56; m += 3) out.push(bar(et('2026-11-27', Math.floor(m / 60), m % 60)))
  return out
}
const LAST = et('2026-11-27', 12, 56)

function answer({ verifiedThrough, tailStatus }) {
  const bars = thinRows()
  expect(bars[bars.length - 1].t).toBe(LAST)
  return {
    ticker: 'ILQ', tf: '1', bars, contract: 1, grid: 'eth-clock', session: 'rth',
    cache_key: 'b1:ILQ:1:eth-clock', series_rev: 9000, history_rev: 1, verified_through: verifiedThrough,
    complete_through: LAST + 60, tail_status: tailStatus, developing: null,
  }
}

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

async function switched({ nowSec, verifiedThrough, tailStatus = 'verified' }) {
  vi.setSystemTime(nowSec * 1000)
  const request = vi.fn(async () => answer({ verifiedThrough, tailStatus }))
  const store = createBarStore({
    request,
    io: { idbGet: async () => null, idbGetHistoryEntry: async () => null, idbPutMonotonic: async () => {}, memPutMonotonic: () => {} },
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const pf = createPrefetch({ store, tickerMeta: () => {}, extended: () => false })
  let outcome = 'PENDING'
  pf.prepareForDisplay('ILQ', '1').then((v) => { outcome = v })
  await vi.advanceTimersByTimeAsync(600)
  // (the answer landed whole, the tail as served: a rail whose fixture failed would read 'not painted' for the wrong reason)
  const held = store.peek(keyOf({ sym: 'ILQ', tf: '1' }))
  expect(held.restSeen).toBe(true)
  expect(held.error ?? null).toBe(null)
  expect(held.bars[held.bars.length - 1].t).toBe(LAST)
  return { pf, store, request, outcome: () => outcome }
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
