// P0 rail — PROPERTY suite for the client bucket math (chart/barTime.js + chart/liveBuckets.js
// + liveBarMerge.bucketEndTime / foldPrice), over random instants of 2025-2027.
//
//   B1  start <= u < end for the bucket containing u; start and end are both ON the grid
//       (bucketStartUnix(start) === start, bucketStartUnix(end) === end: buckets tile time)
//   B2  1/5/15/30 (and 60 on the clock grid) are fixed-period; 60 on the session grid
//       never spans the 09:30 open or the regular close (16:00 / 13:00 half-day), and its
//       RTH buckets sit on the 09:30 anchor
//   B3  chart time is per-instant DST correct: fromChartTime(toChartTime(u)) === u and
//       toChartTime is strictly increasing over every US equity session window
//   B4  computeBarTime / bucketEndChartTime / liveBarMerge.bucketEndTime agree with the
//       unix-space bucket for the same session
//   B5  foldPrice buckets a tick by its own trade time: later -> 'later', earlier ->
//       'earlier', inside -> folded (never fused across a boundary)
// Server parity for every bucket of 2026 lives in bucketGridParity.test.js.
import { describe, it, expect } from 'vitest'
import {
  bucketStartUnix, toChartTime, fromChartTime, etMinuteOfDay, rthCloseMinuteOf, computeBarTime,
  PERIOD_SECONDS, RTH_OPEN_MIN,
} from '../barTime'
import { bucketEndUnix, bucketEndChartTime } from '../liveBuckets'
import { bucketEndTime, foldPrice, LIVE_PERIOD_SECONDS } from '../../../lib/liveBarMerge'
import { forSeeds, check } from './railSupport'

const TFS = [1, 5, 15, 30, 60]
const GRIDS = ['session', 'clock']
const SESSION_OF = { session: 'rth', clock: 'eth' }
const T0 = Date.UTC(2025, 0, 1) / 1000
const T1 = Date.UTC(2028, 0, 1) / 1000
// Instants biased toward the risky days: DST Sundays/Mondays and half-days.
const HOT = ['2025-03-09', '2025-03-10', '2025-11-02', '2025-11-03', '2026-03-08', '2026-03-09',
  '2026-11-01', '2026-11-02', '2026-11-27', '2026-12-24', '2027-03-14', '2027-11-07', '2025-07-03', '2025-12-24']
const N = 20000

// Chart time is only invertible outside the repeated 01:00-02:00 fall-back hour (no US
// equity bar ever prints there — barTime.js header). Chart-space checks skip it.
const invertible = (u) => fromChartTime(toChartTime(u)) === u

function randomInstant(r) {
  if (r.chance(0.4)) {
    const [y, m, d] = r.pick(HOT).split('-').map(Number)
    return Date.UTC(y, m - 1, d) / 1000 + r.int(0, 86400 + 6 * 3600)
  }
  return r.int(T0, T1)
}

describe('bucket math — properties over random instants 2025-2027', () => {
  it(`B1/B2 hold for ${N} instants x 5 tfs x 2 grids`, () => {
    forSeeds(1, 7, (r) => {
      for (let i = 0; i < N; i++) {
        const u = randomInstant(r)
        const tf = r.pick(TFS)
        const grid = r.pick(GRIDS)
        const s = bucketStartUnix(u, tf, { grid })
        const e = bucketEndUnix(u, tf, { grid })
        const ctx = () => `u=${u} tf=${tf} grid=${grid} start=${s} end=${e}`
        check(s <= u && u < e, () => `B1: instant outside its bucket ${ctx()}`)
        check(bucketStartUnix(s, tf, { grid }) === s, () => `B1: start off-grid ${ctx()}`)
        check(bucketEndUnix(s, tf, { grid }) === e, () => `B1: end depends on the probe ${ctx()}`)
        check(bucketStartUnix(e, tf, { grid }) === e, () => `B1: buckets do not tile (gap/overlap at end) ${ctx()}`)
        check(s % 60 === 0 && e % 60 === 0, () => `B1: bucket not minute-aligned ${ctx()}`)
        if (tf !== 60 || grid === 'clock') {
          check(e - s === tf * 60, () => `B2: fixed-period bucket has wrong length ${ctx()}`)
          continue
        }
        const m0 = etMinuteOfDay(s)
        const close = rthCloseMinuteOf(s)
        const len = (e - s) / 60
        check(len > 0 && len <= 60, () => `B2: 60m session bucket length ${len} ${ctx()}`)
        check(!(m0 < RTH_OPEN_MIN && m0 + len > RTH_OPEN_MIN), () => `B2: 60m bucket spans the 09:30 open ${ctx()}`)
        check(!(m0 < close && m0 + len > close), () => `B2: 60m bucket spans the close ${ctx()}`)
        if (m0 >= RTH_OPEN_MIN && m0 < close) {
          check((m0 - RTH_OPEN_MIN) % 60 === 0, () => `B2: RTH 60m bucket off the 09:30 anchor ${ctx()}`)
          check(len === 60 || m0 + len === close, () => `B2: short RTH bucket not the close half-bar ${ctx()}`)
        }
      }
    })
  })

  it('B3: chart time round-trips and is strictly increasing over every session window', () => {
    forSeeds(200, 100, (r) => {
      const [y, m, d] = (r.chance(0.5) ? r.pick(HOT) : new Date(r.int(T0, T1) * 1000).toISOString().slice(0, 10)).split('-').map(Number)
      const midnightish = Date.UTC(y, m - 1, d) / 1000 + 4 * 3600 + 4 * 3600   // ~04:00 ET either offset
      let prev = -Infinity
      for (let k = 0; k < 16 * 60; k += r.int(1, 7)) {
        const u = midnightish + k * 60 + r.int(0, 59)
        const c = toChartTime(u)
        check(fromChartTime(c) === u, `B3: fromChartTime(toChartTime(${u})) !== u`)
        check(c > prev, `B3: chart time not increasing at ${u}`)
        prev = c
      }
    })
  })

  it('B4: computeBarTime / bucketEndChartTime / liveBarMerge.bucketEndTime agree with unix buckets', () => {
    expect(LIVE_PERIOD_SECONDS).toEqual(PERIOD_SECONDS)
    forSeeds(1, 11, (r) => {
      for (let i = 0; i < N / 2; i++) {
        const u = randomInstant(r)
        const tf = r.pick(TFS)
        const grid = r.pick(GRIDS)
        const sess = SESSION_OF[grid]
        const s = bucketStartUnix(u, tf, { grid })
        const e = bucketEndUnix(u, tf, { grid })
        if (!invertible(s) || !invertible(e)) continue
        const ct = computeBarTime(String(tf), u, { session: sess })
        check(ct === toChartTime(s), `B4: computeBarTime(${tf}, ${u}, ${sess}) != toChartTime(start)`)
        check(bucketEndChartTime(ct, String(tf), sess) === toChartTime(e), `B4: bucketEndChartTime mismatch u=${u} tf=${tf} ${sess}`)
        check(bucketEndTime(ct, String(tf), sess) === toChartTime(e), `B4: liveBarMerge.bucketEndTime mismatch u=${u} tf=${tf} ${sess}`)
      }
    })
  })

  it('B5: foldPrice buckets every tick by its own trade time', () => {
    forSeeds(1, 13, (r) => {
      for (let i = 0; i < N / 4; i++) {
        const u = randomInstant(r)
        const tf = r.pick(TFS)
        const grid = r.pick(GRIDS)
        const sess = SESSION_OF[grid]
        const s = bucketStartUnix(u, tf, { grid })
        const e = bucketEndUnix(u, tf, { grid })
        const bar = { time: toChartTime(s), open: 10, high: 11, low: 9, close: 10, volume: 1 }
        const tickU = r.int(s - 3 * 3600, e + 3 * 3600)
        if (!invertible(s) || !invertible(e) || !invertible(tickU)) continue
        const res = foldPrice(bar, 10.5, toChartTime(tickU), String(tf), sess)
        const want = tickU >= e ? 'later' : tickU < s ? 'earlier' : 'update'
        check(res.kind === want, `B5: tick at ${tickU - s}s from bucket start (len ${e - s}s, tf ${tf} ${sess}) -> ${res.kind}, want ${want}`)
      }
    })
  })
})
