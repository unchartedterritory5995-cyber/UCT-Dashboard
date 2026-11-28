// B9, the deeper half (2026-11-28 cold-coverage run, COV-zo-m1-typed: a 1m + 15m board zoomed out to ~791 bars, CRAI typed
// after the 2026-11-27 half day). The 15m key held the device's copy (the server's own rows: ffseed), the lake's whole depth
// loaded beside it (its pieces landed by +425 ms), and yet the switch held the previous chart to the hang guard. The lake's
// rows of the same series agree with the server's on every shared bar (measured on CRAI: 1,137 of 1,137, one basis), so the
// join itself is sound. This rail walks the real store and prefetch facade through exactly that state, with the real NYSE
// calendar, and asks what the switch asks before it paints (useSymbolHandoff paintsWholeNow): does the key hold the rows the
// view draws, and does the copy paint (peekDisplayable)? Synthetic prices, the real session grid.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createBarStore } from './index'
import { createPrefetch } from './prefetch'
import { keyOf } from './types'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { memClear } from '../../utils/barsMemCache'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

/** Unix s of ET wall time on an ISO date (EDT through 2026-10-31, EST from 2026-11-01). */
const et = (iso, hh, mm) => {
  const [y, m, d] = iso.split('-').map(Number)
  const off = iso < '2026-11-01' ? 4 : 5
  return Date.UTC(y, m - 1, d, hh + off, mm) / 1000
}
/** Session days 2026-09-01 .. `last` (weekdays; Labor Day 09-07 and Thanksgiving 11-26 shut; 11-27 closes 13:00). */
function sessionDays(last) {
  const out = []
  for (let t = Date.UTC(2026, 8, 1); ; t += 86400000) {
    const iso = new Date(t).toISOString().slice(0, 10)
    if (iso > last) break
    const dow = new Date(t).getUTCDay()
    if (dow === 0 || dow === 6 || iso === '2026-09-07' || iso === '2026-11-26') continue
    out.push(iso)
  }
  return out
}
const closeMin = (iso) => (iso === '2026-11-27' ? 13 * 60 : 16 * 60)
/** One bar, its prices a function of its time only: every copy of a bar is the same bar. */
const bar = (t) => { const i = Math.floor(t / 900) % 997; const o = Math.round((150 + ((i * 7) % 13) / 4) * 100) / 100; return { t, o, h: o + 0.5, l: o - 0.5, c: o + 0.25, v: 300 + i } }
/** Regular-session 15m rows of every session day through `last` (and, `post`, the 16:00 post-market bucket the lake carries). */
function rows(last, { post = false } = {}) {
  const out = []
  for (const iso of sessionDays(last)) {
    for (let m = 570; m < closeMin(iso); m += 15) out.push(bar(et(iso, Math.floor(m / 60), m % 60)))
    if (post && closeMin(iso) === 960) out.push(bar(et(iso, 16, 0)))
  }
  return out
}

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

/** The switch's state after Enter: the device copy (its newest 300 RTH rows, complete through `through`), the lake ending
 *  `lakeLast`, the clock at `nowSec`. */
async function prepared({ deviceLast, through, lakeLast, nowSec, need }) {
  vi.setSystemTime(nowSec * 1000)
  const dev = rows(deviceLast).slice(-300)
  const hit = { rows: dev, through, savedAt: through * 1000, formingT: null }
  const device = { peek: (s, t) => (s === 'ILQ' && t === '15' ? hit : null), read: async (s, t) => (s === 'ILQ' && t === '15' ? hit : null) }
  const lakeRows = rows(lakeLast, { post: true })
  const history = { olderBars: vi.fn(async (key, beforeT) => ({ bars: lakeRows.filter((b) => b.t < beforeT) })), prime: vi.fn(), hasSymbol: vi.fn(async () => true) }
  const request = vi.fn(() => new Promise(() => {}))     // the server never answers: the copy must paint on its own
  const store = createBarStore({
    request, device, history,
    io: { idbGet: async () => null, idbGetHistoryEntry: async () => null, idbPutMonotonic: async () => {}, memPutMonotonic: () => {} },
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const pf = createPrefetch({ store, tickerMeta: () => {}, extended: () => false })
  await pf.deviceWarm('ILQ', '15')
  let outcome = 'PENDING'
  pf.prepareForDisplay('ILQ', '15', { need }).then((v) => { outcome = v })
  await vi.advanceTimersByTimeAsync(1500)
  return { pf, store, request, outcome: () => outcome, key: keyOf({ sym: 'ILQ', tf: '15' }) }
}

describe('B9: a device copy joined by the lake paints the whole zoomed-out view, with no server round trip', () => {
  const NEED = 1192                                           // 792 bars across + the averages' lookback (viewNeed)

  it('after the 2026-11-27 half day (13:00 close, the newest bar 12:45): the joined copy covers the view AND paints', async () => {
    const w = await prepared({
      deviceLast: '2026-11-27', through: et('2026-11-27', 13, 0), lakeLast: '2026-11-25', nowSec: et('2026-11-27', 20, 49), need: NEED,
    })
    expect(w.pf.heldRows('ILQ', '15', { upTo: NEED })).toBeGreaterThanOrEqual(NEED)   // the lake joined the device rows
    expect(w.pf.lakePending('ILQ', '15')).toBe(false)
    expect(w.pf.peekDisplayable('ILQ', '15')).toBe(true)      // ...and the switch may paint it (useSymbolHandoff paintsWholeNow)
    expect(w.outcome()).toBe('current')
    expect(w.request).not.toHaveBeenCalled()                  // no server round trip
  })

  it('control, an ordinary day (16:00 close, the newest bar 15:45): the same', async () => {
    const w = await prepared({
      deviceLast: '2026-11-25', through: et('2026-11-25', 16, 0), lakeLast: '2026-11-24', nowSec: et('2026-11-25', 18, 0), need: NEED,
    })
    expect(w.pf.heldRows('ILQ', '15', { upTo: NEED })).toBeGreaterThanOrEqual(NEED)
    expect(w.pf.peekDisplayable('ILQ', '15')).toBe(true)
    expect(w.outcome()).toBe('current')
    expect(w.request).not.toHaveBeenCalled()
  })
})
