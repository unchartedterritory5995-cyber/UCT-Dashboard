// app/src/components/chart/engine/ast/intradayHtfReads.test.js
//
// ─── ⭐⭐ E101 INTRADAY-HTF (NUMBER PENDING) — A HIGHER INTRADAY TIMEFRAME, RESAMPLED FROM THE CHART'S OWN BARS ───────
//
// `request.security(syminfo.tickerid, "60", x)` on a 15 minute chart: `tf_merge` / `tf_live` of an intraday code. One
// keying rule (`periodStamps` over `intradayBucketStart`) for the host evaluator and the run's request
// (`requestAlignment`). Expected values are written out by hand; nothing is derived from the evaluator.
//   * the grid is the chart's own (`barTime.js::bucketStartUnix`, measured `vw-time-session-spy-60-{rth,ext}`):
//     regular hours from the 09:30 open, the last bucket short; extended hours on New York clock hours;
//   * look-ahead off (the merge): a bar that CLOSES its bucket reads that bucket, every other bar the last closed one;
//   * look-ahead on: every bar reads the bucket it is inside;
//   * a target that is not a whole multiple above the chart, an unstated chart, and formula `tf` are refused;
//   * a chart on neither grid is withheld whole, by name; a chart starting mid-bucket withholds its first bucket.
import { describe, it, expect } from 'vitest'
import {
  interpret, withheldReadMask, requestAlignment, TF_MERGE, TF_MERGE_FIRST_CODE, INTRADAY_HTF_SESSION_CODE,
  CHART_CLOCK_WITHHELD, intradayBucketStart, intradayHtfRefusal, periodStamps, tfBucket, maxLookback,
} from './interpret'
import { bucketStartUnix } from '../../barTime.js'

// New York wall clock -> unix seconds (EST, -5 h, in the weeks used below unless named)
const ny = (iso, hhmm, offsetH = 5) => {
  const [h, m] = hhmm.split(':').map(Number)
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)), h + offsetH, m) / 1000
}
const at = (iso, hhmm) => ny(iso, hhmm)
const slots = (iso, from, to, step) => {
  const out = []
  for (let t = at(iso, from); t < at(iso, to); t += step * 60) out.push(t)
  return out
}
// two regular-hours sessions of 15 minute bars: Monday 2026-01-12 and Tuesday 2026-01-13 (26 bars each)
const RTH = [...slots('2026-01-12', '09:30', '16:00', 15), ...slots('2026-01-13', '09:30', '16:00', 15)]
const bar = (t, i) => ({ t, o: i + 1, h: i + 1.5, l: i + 0.5, c: i + 1, v: 10 })
const BARS = RTH.map(bar)
const N = BARS.length
const fin = (a) => Array.from(a).map((v) => (Number.isFinite(v) ? v : null))
const OPTS = { tf: '15', historyFromListing: true, newestBarIsForming: false }
const col = (tree, bars = BARS, opts = OPTS) => fin(interpret(tree, bars, {}, undefined, undefined, opts))
const node = (type, code, child = { type: 'series', name: 'close' }) => ({ type, value: code, args: [child] })
const H = (hhmm) => RTH.indexOf(at('2026-01-12', hhmm))

describe('⭐⭐ the grid — the integer rule IS the chart\'s measured grid (barTime.js), for 30 and 60, both views', () => {
  it('every 15 minutes, 04:00-20:00 New York, every weekday 2024-2027 (DST changes, half days): equal', () => {
    let checked = 0
    for (let day = Date.UTC(2024, 0, 1) / 1000; day < Date.UTC(2028, 0, 1) / 1000; day += 86400) {
      const dow = new Date(day * 1000).getUTCDay()
      if (dow === 0 || dow === 6) continue
      for (let s = day + 8 * 3600; s < day + 26 * 3600; s += 900) {          // 03:00-21:00 EST / 04:00-22:00 EDT
        for (const [grid, alias] of [['session', 'session'], ['clock', 'clock']]) {
          for (const m of [30, 60]) {
            const ours = intradayBucketStart(s, m, grid)
            const chart = bucketStartUnix(s, m, { grid: alias })
            if (ours !== chart) throw new Error(`${new Date(s * 1000).toISOString()} ${m} ${grid}: ${ours} vs ${chart}`)
            checked += 1
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(290000)
  })
  it('the session grid at 120 / 240 is anchored at the open, its last bucket short (UNMEASURED: served only once Q-IHTF-1 agrees)', () => {
    const d = '2026-01-12'
    expect(intradayBucketStart(at(d, '11:15'), 120, 'session')).toBe(at(d, '09:30'))
    expect(intradayBucketStart(at(d, '11:30'), 120, 'session')).toBe(at(d, '11:30'))
    expect(intradayBucketStart(at(d, '15:45'), 120, 'session')).toBe(at(d, '15:30'))
    expect(intradayBucketStart(at(d, '13:15'), 240, 'session')).toBe(at(d, '09:30'))
    expect(intradayBucketStart(at(d, '15:45'), 240, 'session')).toBe(at(d, '13:30'))
    expect(intradayBucketStart(at(d, '09:45'), 240, 'clock')).toBe(at(d, '08:00'))
    expect(intradayBucketStart(at(d, '19:45'), 240, 'clock')).toBe(at(d, '16:00'))
  })
  it('a 13:00 half day ends its last 60 minute bucket at the close (2025-11-28: 12:30-13:00)', () => {
    const d = '2025-11-28'
    expect(intradayBucketStart(at(d, '12:45'), 60, 'session')).toBe(at(d, '12:30'))
    expect(intradayBucketStart(at(d, '13:15'), 60, 'session')).toBe(at(d, '13:00'))
  })
})

describe('⭐ the one decision — whole multiples above a stated intraday chart only', () => {
  it('15 -> 60 and 5 -> 240 may; 45 -> 60, 60 -> 60, 60 -> 30, a daily or unstated chart may not', () => {
    expect(intradayHtfRefusal('60', '15')).toBe(null)
    expect(intradayHtfRefusal('240', '5')).toBe(null)
    expect(intradayHtfRefusal('60', '45')).toMatch(/whole number/)
    expect(intradayHtfRefusal('60', '60')).toMatch(/not above/)
    expect(intradayHtfRefusal('30', '60')).toMatch(/not above/)
    expect(intradayHtfRefusal('60', 'D')).toMatch(/intraday chart/)
    expect(intradayHtfRefusal('60', null)).toMatch(/no stated timeframe/)
  })
  it('the evaluator refuses each by name, and formula `tf` keeps its own codes', () => {
    expect(() => col(node(TF_MERGE, '60'), BARS, { ...OPTS, tf: '45' })).toThrow(/whole number/)
    expect(() => col(node(TF_MERGE, '60'), BARS, { ...OPTS, tf: undefined })).toThrow(/no stated timeframe/)
    expect(() => col(node('tf', '60'))).toThrow(/interpret:timeframe|resamples W, M/)
  })
})

describe('⭐⭐ look-ahead off (the merge) on a 15 minute regular-hours chart', () => {
  // closes are 1..52 in bar order; 60 minute buckets of Monday: 09:30 {1-4}, 10:30 {5-8}, ... 14:30 {21-24}, 15:30 {25,26}
  it('the bar that closes its bucket reads it; the others read the last closed bucket; the short 15:30 bucket closes at 15:45', () => {
    const c = col(node(TF_MERGE, '60'))
    expect(c.slice(0, 4)).toEqual([null, null, null, 4])               // 10:15 closes 09:30-10:30
    expect(c.slice(4, 8)).toEqual([4, 4, 4, 8])
    expect(c[H('15:30')]).toBe(24)
    expect(c[H('15:45')]).toBe(26)                                      // the short last bucket: two bars
    expect(c[26]).toBe(26)                                              // Tuesday 09:30 reads Monday's last bucket
    expect(c[29]).toBe(30)                                              // Tuesday 10:15 closes its own
  })
  it('the child runs on the 60 minute bars: sma(close, 2) of the hourly closes', () => {
    const c = col(node(TF_MERGE, '60', { type: 'call', name: 'sma', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 2 }] }))
    expect(c[3]).toBe(null)                                             // one hourly close only
    expect(c[7]).toBe(6)                                                // (4 + 8) / 2
    expect(c[H('15:45')]).toBe(25)                                      // (24 + 26) / 2
  })
  it('the 60 minute bar is the bucket: open of its first bar, high and low across it, volume summed, `t` its start', () => {
    const k = periodStamps(BARS, '60')
    expect(tfBucket(k[1], '60')).toBe(tfBucket(k[3], '60'))
    expect(tfBucket(k[3], '60')).not.toBe(tfBucket(k[4], '60'))
    expect(c3(node(TF_MERGE, '60', { type: 'series', name: 'open' }))).toBe(1)
    expect(c3(node(TF_MERGE, '60', { type: 'series', name: 'high' }))).toBe(4.5)
    expect(c3(node(TF_MERGE, '60', { type: 'series', name: 'low' }))).toBe(0.5)
    expect(c3(node(TF_MERGE, '60', { type: 'series', name: 'volume' }))).toBe(40)
  })
  it('the run\'s request reads the same bars (`requestAlignment`)', () => {
    const r = requestAlignment({ chartBars: BARS, srcBars: BARS, code: '60', opts: OPTS })
    expect(r.runBars.map((b) => b.c).slice(0, 7)).toEqual([4, 8, 12, 16, 20, 24, 26])
    expect(r.runBars[0].t).toBe(at('2026-01-12', '09:30'))
    expect(r.runBars[6].t).toBe(at('2026-01-12', '15:30'))
    expect(r.index.slice(0, 8)).toEqual([-1, -1, -1, 0, 0, 0, 0, 1])
  })
})
const c3 = (tree) => col(tree)[3]

describe('⭐ look-ahead on (`tf_live`): every bar reads the bucket it is inside', () => {
  it('09:30-10:15 read the 09:30 bucket\'s close; 15:30 and 15:45 the short one\'s', () => {
    const c = col(node('tf_live', '60'))
    expect(c.slice(0, 5)).toEqual([4, 4, 4, 4, 8])
    expect(c[H('15:30')]).toBe(26)
  })
})

describe('⭐ extended hours: the clock grid', () => {
  it('04:00-19:45 bars: the 09:00 bucket holds 09:00-09:45 (it spans the open), the next starts at 10:00', () => {
    const ext = slots('2026-01-12', '04:00', '20:00', 15).map(bar)
    const k = periodStamps(ext, '60')
    const i0900 = ext.findIndex((b) => b.t === at('2026-01-12', '09:00'))
    expect(new Set(k.slice(i0900, i0900 + 4)).size).toBe(1)
    expect(k[i0900 + 4]).not.toBe(k[i0900 + 3])
    expect(Number(k[i0900 + 4].split('@')[1])).toBe(at('2026-01-12', '10:00'))
  })
})

describe('⭐⭐ withheld by name, never a blank read as na', () => {
  it('a chart on neither grid (bars on a Saturday): every bar, `request:htf-intraday-session`', () => {
    const sat = slots('2026-01-17', '09:30', '12:00', 15).map(bar)
    const named = new Map()
    const m = withheldReadMask(node(TF_MERGE, '60'), sat, {}, undefined, undefined, { ...OPTS, chartClockSink: named })
    expect(Array.from(m).every((v) => v === 1)).toBe(true)
    expect(named.has(INTRADAY_HTF_SESSION_CODE)).toBe(true)
    expect(CHART_CLOCK_WITHHELD[INTRADAY_HTF_SESSION_CODE]('15')).toMatch(/higher intraday timeframe/)
  })
  it('off the listing, a chart starting mid-bucket (09:45) withholds what reads that partial bucket; one starting at 09:30 does not', () => {
    const off = { ...OPTS, historyFromListing: false }
    const late = BARS.slice(1)
    const named = new Map()
    const m = withheldReadMask(node(TF_MERGE, '60', { type: 'series', name: 'high' }), late, {}, undefined, undefined,
      { ...off, chartClockSink: named })
    expect(named.has(TF_MERGE_FIRST_CODE)).toBe(true)
    // 09:45 / 10:00 read no closed bucket yet (blank already); 10:15 closes the partial 09:30 bucket and 10:30-11:00
    // read it: withheld; 11:15 closes the whole 10:30 bucket and reads it: drawn
    expect(Array.from(m).slice(0, 7)).toEqual([0, 0, 1, 1, 1, 1, 0])
    const whole = new Map()
    withheldReadMask(node(TF_MERGE, '60', { type: 'series', name: 'high' }), BARS, {}, undefined, undefined,
      { ...off, chartClockSink: whole })
    expect(whole.has(TF_MERGE_FIRST_CODE)).toBe(false)
  })
})

describe('the lookback sum', () => {
  it('a merge of an intraday code counts its child in buckets of at least two chart bars (the low claim the 2026-08-30 ruling keeps)', () => {
    const t = node(TF_MERGE, '60', { type: 'call', name: 'sma', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 20 }] })
    expect(maxLookback(t)).toBe(2 * (maxLookback(t.args[0]) + 1))
  })
})
