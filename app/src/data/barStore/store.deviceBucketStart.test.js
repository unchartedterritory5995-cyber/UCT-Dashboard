// P3-M1 (review of #2554): MID-SESSION, A DEVICE COPY MUST REACH THE START OF ITS TIMEFRAME'S CURRENT BUCKET. A 1m device
// copy never carries a forming row, so in the first ~7-12 s of every minute (until the frame of the minute that just
// closed lands; up to 2 minutes when a frame is late) it simply LACKS the just-closed minute. Nothing caught it: 'stale'
// allowed 120 s, the status one bucket of tolerance, and 'rolling' looked only at rows that exist. Through the real
// store (registry + reducer + persist) and the real prefetch facade, with a device that says how far it is complete:
//   BS1 1m, in the first seconds of a minute, the copy short of the minute that just closed: no door paints it
//   BS2 every intraday timeframe (1 5 15 30 60, the regular-session grid the device serves), at a bucket start: refused
//       while the device is short of the bucket that just ended, painted once it has caught up
//   BS3 the open (09:30): refused until the 09:29 frame lands, then yesterday's whole session paints
//   BS4 a half day: refused at the 12:55 roll; after the 13:00 close the close rule decides, as before
//   BS5 outside the session the rule is unchanged (pre-market, after the close)
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createBarStore } from './index'
import { createPrefetch } from './prefetch'
import { keyOf } from './types'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { memClear } from '../../utils/barsMemCache'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const DAY = 86400
/** ET wall clock on 2026-11-`d` (EST) → unix s. Wed 18 is a regular day, Fri 27 a half day (13:00 close). */
const et = (d, hh, mm, ss = 0) => Date.UTC(2026, 10, d, hh + 5, mm, ss) / 1000
const px = (t) => { const i = (t / 60) % 37; const o = 50 + i / 8; return { o, h: o + 0.4, l: o - 0.4, c: o + 0.1, v: 100 + i } }
/** The device's `tf` rows of day `d` (regular-session grid: 60m buckets start 09:30, 10:30, ... and the last one ends at
 *  the close): every bucket that starts at or after 09:30 and ENDS at or before `upto` (unix s), closed. */
function rows(d, tf, upto, close = et(d, 16, 0)) {
  const out = []
  for (let t = et(d, 9, 30); t < close && Math.min(t + tf * 60, close) <= upto; t += tf * 60) out.push({ t, ...px(t) })
  return out
}
const yesterday = (tf) => rows(17, tf, et(17, 16, 0))

function fakeDevice(tf, hit) {
  return { peek: vi.fn((s, t) => (s === 'NEWB' && t === String(tf) ? hit : null)), read: vi.fn(async (s, t) => (s === 'NEWB' && t === String(tf) ? hit : null)) }
}
const copy = (r, through) => ({ rows: r, through, savedAt: through * 1000, formingT: null })

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

function boot(device) {
  const store = createBarStore({
    request: vi.fn(() => new Promise(() => {})), device, history: null,
    io: { idbGet: async () => null, idbGetHistoryEntry: async () => null, idbPutMonotonic: async () => {}, memPutMonotonic: () => {} },
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  return { store, pf: createPrefetch({ store, tickerMeta: () => {}, extended: () => false }) }
}
/** Every door's answer for (NEWB, tf) at `nowSec`, the device's copy complete through `through`. */
async function doors(tf, nowSec, r, through) {
  vi.setSystemTime(nowSec * 1000)
  const { store, pf } = boot(fakeDevice(tf, copy(r, through)))
  const peek = pf.peekDisplayable('NEWB', String(tf))
  const verdict = pf.deviceVerdict('NEWB', String(tf), { showExtended: false })
  const o = { v: 'pending' }
  pf.prepareForDisplay('NEWB', String(tf), { showExtended: false }).then((x) => { o.v = x })
  await vi.advanceTimersByTimeAsync(1500)
  const held = store.peek(keyOf({ sym: 'NEWB', tf: String(tf) }))
  store.dispose()
  return { peek, paints: verdict.paints, reason: verdict.reason, prepare: o.v, held: held?.source }
}

describe('P3-M1 mid-session, the device copy must reach the start of its current bucket', () => {
  it('BS1 1m at 10:05:05, the 10:04 minute not yet in (complete through 10:04:00): no door paints it', async () => {
    const r = [...yesterday(1), ...rows(18, 1, et(18, 10, 4))]
    expect(r.at(-1).t).toBe(et(18, 10, 3))
    const d = await doors(1, et(18, 10, 5, 5), r, et(18, 10, 4))
    expect(d).toMatchObject({ held: 'device', peek: false, paints: false, reason: 'stale', prepare: 'pending' })
  })

  it('BS1 ...once the 10:04 frame has landed (complete through 10:05:00), it paints', async () => {
    const r = [...yesterday(1), ...rows(18, 1, et(18, 10, 5))]
    const d = await doors(1, et(18, 10, 5, 12), r, et(18, 10, 5))
    expect(d).toMatchObject({ peek: true, paints: true, reason: 'paints', prepare: 'current' })
  })

  // the bucket that starts at `start` (ET hh:mm of 2026-11-18) per timeframe: 5 s in, the device has the minutes before
  // the bucket's last one; 12 s in, it has them all
  for (const [tf, hh, mm] of [[1, 11, 41], [5, 11, 45], [15, 11, 45], [30, 12, 0], [60, 11, 30]]) {
    it(`BS2 ${tf}m at the ${hh}:${String(mm).padStart(2, '0')} bucket start: refused while short of the bucket that ended, painted once caught up`, async () => {
      const start = et(18, hh, mm)
      const short = await doors(tf, start + 5, [...yesterday(tf), ...rows(18, tf, start - 60)], start - 60)
      expect(short, `${tf}m short`).toMatchObject({ peek: false, paints: false, reason: 'stale' })
      const whole = await doors(tf, start + 12, [...yesterday(tf), ...rows(18, tf, start)], start)
      expect(whole, `${tf}m whole`).toMatchObject({ peek: true, paints: true, reason: 'paints' })
    })
  }

  it('BS3 the open: refused until the 09:29 frame lands (complete through 09:30:00), then yesterday\'s session paints', async () => {
    for (const tf of [1, 5, 60]) {
      const early = await doors(tf, et(18, 9, 30, 5), yesterday(tf), et(18, 9, 29))
      expect(early, `${tf}m 09:30:05`).toMatchObject({ peek: false, paints: false, reason: 'stale' })
      const landed = await doors(tf, et(18, 9, 30, 10), yesterday(tf), et(18, 9, 30))
      expect(landed, `${tf}m 09:30:10`).toMatchObject({ peek: true, paints: true, reason: 'paints' })
    }
  })

  it('BS4 a half day (Fri 2026-11-27): refused at the 12:55 roll; after the 13:00 close the close rule decides', async () => {
    const half = (tf, upto) => rows(27, tf, upto, et(27, 13, 0))
    const y5 = rows(25, 5, et(25, 16, 0))                             // the session before (Thanksgiving is a holiday)
    const atRoll = await doors(5, et(27, 12, 55, 5), [...y5, ...half(5, et(27, 12, 54))], et(27, 12, 54))
    expect(atRoll).toMatchObject({ peek: false, paints: false, reason: 'stale' })
    const shortAtClose = await doors(5, et(27, 13, 0, 5), [...y5, ...half(5, et(27, 12, 59))], et(27, 12, 59))
    expect(shortAtClose).toMatchObject({ paints: false })                // (the close rule: complete through 13:00, it is not)
    const whole = await doors(5, et(27, 13, 0, 12), [...y5, ...half(5, et(27, 13, 0))], et(27, 13, 0))
    expect(whole).toMatchObject({ peek: true, paints: true, reason: 'paints' })
  })

  it('BS5 outside the session the rule is unchanged: pre-market and after the close paint a whole copy', async () => {
    const pre = await doors(5, et(18, 8, 0), yesterday(5), et(18, 8, 0))
    expect(pre).toMatchObject({ peek: true, paints: true, reason: 'paints' })
    const after = await doors(5, et(18, 17, 0), [...yesterday(5), ...rows(18, 5, et(18, 16, 0))], et(18, 16, 0))
    expect(after).toMatchObject({ peek: true, paints: true, reason: 'paints' })
    expect(DAY).toBe(86400)
  })
})
