// H2 (review of #2537): WHEN DOES A DAILY CHART PAINT FROM THE DEVICE, window by window. The whole chain except the
// worker: the device engine (a D seed pack on a memory disk, the split guard), today's overlay (live.js) fed as the
// minute frames feed it, the BarStore's real device source (source.js), the real store (registry + reducer + persist)
// and the real prefetch facade's device rule (deviceVerdict, what the switch commits on). The server never answers.
// A daily bar built from MINUTES is never a complete row: from 20:00 ET (the end of the minute day) a D copy holds no
// today bar until the seed carries it or the server's own day row does, so the daily switch waits for the server
// exactly as it does with the store off. The publisher's flags change nothing here:
//   MINUTE_FRAMES_WITH_AV   only reaches the D bar through DEVICE_FORMING_DAILY (OFF), and even then only as a
//                           FORMING bar during the regular session (the `flag on` rows below)
//   MINUTE_FRAMES_WITH_DAILY the server's own day row (the `server row` rows): exact by construction, unchanged
// November is EST (UTC-5): 19:00 ET is 00:00 UTC, where the daily rows' UTC-midnight labels roll.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createBarStore } from './index'
import { createPrefetch } from './prefetch'
import { keyOf } from './types'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { memClear } from '../../utils/barsMemCache'
import { createDeviceEngine } from '../deviceStore/engine'
import { memoryIO } from '../deviceStore/io'
import { createLiveOverlay } from '../deviceStore/live'
import { createDeviceSource } from '../deviceStore/source'
import { nextSessionISO } from '../deviceStore/sessions'
import { seedPackOf } from '../deviceStore/testing/fixtures'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const dayUnix = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000
/** ET wall clock on `iso` (EST) → epoch ms. */
const et = (iso, hh, mm, ss = 0) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), hh + 5, mm, ss)
/** 40 weekday D rows ending at `asof` (the seed's window: the last closed session's official rows). */
function seedRows(asof) {
  const out = []
  for (let d = new Date(`${asof}T00:00:00Z`); out.length < 40; d.setUTCDate(d.getUTCDate() - 1)) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6 && d.toISOString().slice(0, 10) !== '2026-11-26') out.unshift(d.getTime() / 1000)
  }
  return out.map((t, i) => ({ t, o: 50 + i * 0.25, h: 51 + i * 0.25, l: 49 + i * 0.25, c: 50.5 + i * 0.25, v: 2e6 + i }))
}

/** The engine with a committed D generation written straight onto its memory disk (no download). */
async function engineAt(asof, nowMs) {
  const pack = seedPackOf({ AAA: seedRows(asof) }, { tf: 'D', asof, build: 'b1' })
  const files = new Map()
  const put = (name, bytes) => files.set(name, { buf: bytes, size: bytes.length, open: false })
  put('D.1.pack', pack)
  put('D.1.ok', new TextEncoder().encode(JSON.stringify({ v: 1, tf: 'D', gen: 1, build: 'b1', sha256: '0'.repeat(64), bytes: pack.length })))
  const eng = createDeviceEngine({ io: memoryIO(files), now: () => nowMs })
  await eng.open()
  await eng.setSplits({ splits: { session: nextSessionISO(asof), symbols: {} } })
  return eng
}

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

/**
 * One window: the clock at `now`, a seed as of `asof`, and (with `day`) today's overlay after the frame of the ET
 * minute `last` ([hh, mm]): the rollup's D bar for today (`rollupBar`), the server's own day row (`serverRow`, with
 * the consumer's dailyOk), `formingDaily` / `withAv` as forming.js and the publisher would set them.
 */
async function windowVerdict({ now, asof, day = null, last = null, rollupBar = true, serverRow = null, formingDaily = false, withAv = false }) {
  vi.setSystemTime(now)
  const eng = await engineAt(asof, now)
  if (day) {
    const overlay = createLiveOverlay({ nameOf: (s) => eng.seedName(s), formingDaily })
    eng.attachLive(overlay)
    overlay.sink.reset({ day })
    if (rollupBar) overlay.sink.upsert('AAA', 'D', { t: dayUnix(day), o: 60, h: 61.5, l: 59.5, c: 61, v: 3e6 }, false)
    if (serverRow) overlay.sink.daily({ day, full: true, rows: [{ sym: 'AAA', o: 60.1, h: 61.6, l: 59.4, c: 61.2, v: 3.3e6 }] })
    overlay.sink.frameDone({ day, seq: 1, minute: Math.floor(et(day, last[0], last[1]) / 60000),
      ...(withAv ? { withAv: true } : {}), ...(serverRow ? { dailyOk: true } : {}) })
  }
  const client = { peekBars: (s, tf) => eng.read(s, tf), getBars: async (s, tf) => eng.read(s, tf) }
  const device = createDeviceSource({ load: async () => client, current: () => client })
  const store = createBarStore({
    request: vi.fn(() => new Promise(() => {})), device,
    io: { idbGet: async () => null, idbGetHistoryEntry: async () => null, idbPutMonotonic: async () => {}, memPutMonotonic: () => {} },
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
    history: null,
  })
  const pf = createPrefetch({ store, tickerMeta: () => {}, extended: () => false })
  pf.peekBars('AAA', 'D')
  await vi.advanceTimersByTimeAsync(5)
  const v = pf.deviceVerdict('AAA', 'D')
  const s = store.peek(keyOf({ sym: 'AAA', tf: 'D' }))
  const tail = s ? [...s.bars, ...(s.developing ? [s.developing] : [])].at(-1) : null
  store.dispose()
  return { paints: v.paints, reason: v.reason, tail: tail ? new Date(tail.t * 1000).toISOString().slice(0, 10) : null }
}

const WED = '2026-11-18', TUE = '2026-11-17'
const FRI = '2026-11-20', THU = '2026-11-19', SAT = '2026-11-21'
const HALF = '2026-11-27', HALF_PREV = '2026-11-25'           // Friday after Thanksgiving: the 13:00 close

describe('H2 the daily chart from the device, window by window', () => {
  // [window, the case, what the first frame may be built from]
  const CASES = [
    ['pre-market 08:00', { now: et(WED, 8, 0, 20), asof: TUE, day: WED, last: [7, 59], rollupBar: false }, { paints: true, tail: TUE }],
    ['regular session 11:31', { now: et(WED, 11, 31, 20), asof: TUE, day: WED, last: [11, 30] }, { paints: false, reason: 'status:provisional', tail: TUE }],
    ['after the close 16:30', { now: et(WED, 16, 30, 20), asof: TUE, day: WED, last: [16, 29] }, { paints: false, reason: 'status:provisional', tail: TUE }],
    ['19:30 (past 00:00 UTC)', { now: et(WED, 19, 30, 20), asof: TUE, day: WED, last: [19, 29] }, { paints: false, reason: 'status:provisional', tail: TUE }],
    ['after 20:00 (H2)', { now: et(WED, 20, 30), asof: TUE, day: WED, last: [19, 59] }, { paints: false, reason: 'status:provisional', tail: TUE }],
    ['Saturday, the Friday seed', { now: et(SAT, 12, 0), asof: FRI }, { paints: true, tail: FRI }],
    ['Saturday, a page open since Friday (Thursday seed)', { now: et(SAT, 12, 0), asof: THU, day: FRI, last: [19, 59] }, { paints: false, tail: null }],
    ['half day 12:00', { now: et(HALF, 12, 0, 20), asof: HALF_PREV, day: HALF, last: [11, 59] }, { paints: false, reason: 'status:provisional', tail: HALF_PREV }],
    ['half day 13:30', { now: et(HALF, 13, 30, 20), asof: HALF_PREV, day: HALF, last: [13, 29] }, { paints: false, reason: 'status:provisional', tail: HALF_PREV }],
    ['half day after 20:00 (H2)', { now: et(HALF, 20, 30), asof: HALF_PREV, day: HALF, last: [19, 59] }, { paints: false, reason: 'status:provisional', tail: HALF_PREV }],
    ['server row 16:40', { now: et(WED, 16, 40, 20), asof: TUE, day: WED, last: [16, 39], serverRow: true }, { paints: false, reason: 'stale', tail: WED }],
    ['server row after 20:00', { now: et(WED, 20, 30), asof: TUE, day: WED, last: [19, 59], serverRow: true }, { paints: true, tail: WED }],
    ['flag on, regular session 11:31', { now: et(WED, 11, 31, 20), asof: TUE, day: WED, last: [11, 30], formingDaily: true, withAv: true }, { paints: true, tail: WED }],
    ['flag on, after the close 16:30', { now: et(WED, 16, 30, 20), asof: TUE, day: WED, last: [16, 29], formingDaily: true, withAv: true }, { paints: false, reason: 'status:provisional', tail: TUE }],
    ['flag on, 19:30 (H2)', { now: et(WED, 19, 30, 20), asof: TUE, day: WED, last: [19, 29], formingDaily: true, withAv: true }, { paints: false, reason: 'status:provisional', tail: TUE }],
    ['flag on, after 20:00 (H2)', { now: et(WED, 20, 30), asof: TUE, day: WED, last: [19, 59], formingDaily: true, withAv: true }, { paints: false, reason: 'status:provisional', tail: TUE }],
  ]
  for (const [label, c, want] of CASES) {
    it(label, async () => {
      expect(await windowVerdict(c)).toMatchObject(want)
    })
  }
})
