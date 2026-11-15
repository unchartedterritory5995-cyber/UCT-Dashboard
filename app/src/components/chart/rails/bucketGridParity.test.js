// P0 rail — SERVER <-> CLIENT BUCKET-GRID PARITY.
//
// tests/fixtures/bar_bucket_grid_2026.json is every bucket the SERVER's one bucket
// helper (api/services/bar_rollup.tv_bucket_bounds) draws for tf 1/5/15/30/60 on the
// rth (TradingView session-anchored 60m) and eth (clock-hour 60m) grids, 04:00-20:00 ET,
// every day of 2026 (both DST changes, the NYSE half-days). tests/test_bucket_grid_parity.py
// holds the server to it; THIS file holds the client's bucket math to it:
//   barTime.bucketStartUnix / liveBuckets.bucketEndUnix (unix space)
//   liveBuckets.bucketEndChartTime + barTime.computeBarTime (chart-time space)
//   barTime.etOffsetSec (per-instant DST) and rthCloseMinuteOf (half-day close).
// A divergence on any single bucket of the year fails here, naming date/tf/session.
import { describe, it, expect } from 'vitest'
import {
  bucketStartUnix, computeBarTime, toChartTime, fromChartTime, etOffsetSec, rthCloseMinuteOf,
} from '../barTime'
import { bucketEndUnix, bucketEndChartTime } from '../liveBuckets'
import { readRepo } from './railSupport'

const FIX = JSON.parse(readRepo('tests/fixtures/bar_bucket_grid_2026.json'))
const W0 = FIX.window_min[0]
const GRID = { rth: 'session', eth: 'clock' }

function expand(runs) {
  const out = []
  for (const [s, ln, n] of runs) for (let i = 0; i < n; i++) out.push([s + i * ln, s + (i + 1) * ln])
  return out
}
const unixOf = (day, min) => day.base + (min - W0) * 60

describe('bucket-grid parity fixture (client side)', () => {
  it('covers all 365 days of 2026 and every tf/session', () => {
    expect(FIX.year).toBe(2026)
    expect(FIX.days.length).toBe(365)
    expect(FIX.days.filter((d) => d.half_day).length).toBeGreaterThan(0)
  })

  it('per-day ET offset (DST) and half-day close agree with the server', () => {
    const bad = []
    for (const d of FIX.days) {
      if (etOffsetSec(d.base) !== d.utc_offset_min * 60) bad.push(`${d.date} offset`)
      const close = rthCloseMinuteOf(d.base)
      if ((close === 780) !== d.half_day) bad.push(`${d.date} half_day client=${close}`)
    }
    expect(bad).toEqual([])
  })

  for (const tf of FIX.tfs) {
    for (const sess of FIX.sessions) {
      it(`tf=${tf} ${sess}: client bucket start/end == server for every bucket of 2026`, () => {
        const bad = []
        let checked = 0
        for (const d of FIX.days) {
          for (const [s, e] of expand(d.grids[`${tf}/${sess}`])) {
            const wantS = unixOf(d, s)
            const wantE = unixOf(d, e)
            // probe the first second, a mid-bucket second and the last second
            const probes = [wantS, wantS + Math.floor((wantE - wantS) / 2) + 7, wantE - 1]
            for (const u of probes) {
              const gs = bucketStartUnix(u, Number(tf), { grid: GRID[sess] })
              const ge = bucketEndUnix(u, Number(tf), { grid: GRID[sess] })
              if (gs !== wantS || ge !== wantE) {
                if (bad.length < 20) bad.push(`${d.date} ${tf}/${sess} min ${s}-${e} probe+${u - wantS}s -> start ${(gs - wantS) / 60}m end ${(ge - wantE) / 60}m`)
              }
            }
            // chart-time space: the live writers' bucket end and the bar label
            const ct = computeBarTime(String(tf), wantS + 1, { session: sess })
            if (ct !== toChartTime(wantS)) bad.push(`${d.date} ${tf}/${sess} computeBarTime off at ${s}`)
            if (fromChartTime(ct) !== wantS) bad.push(`${d.date} ${tf}/${sess} fromChartTime not inverse at ${s}`)
            if (bucketEndChartTime(ct, tf, sess) !== toChartTime(wantE)) bad.push(`${d.date} ${tf}/${sess} bucketEndChartTime off at ${s}`)
            checked++
          }
        }
        expect(bad).toEqual([])
        expect(checked).toBeGreaterThan(365 * 15)
      })
    }
  }
})
