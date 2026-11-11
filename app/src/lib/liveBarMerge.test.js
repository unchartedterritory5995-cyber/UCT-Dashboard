import { describe, it, expect } from 'vitest'
import {
  mergePushBar, reconcileWithServerTail, foldPrice, mergeRegistryMinute, bucketEndTime, isCompleteOhlc,
} from './liveBarMerge'

// Chart time encodes ET wall clock as UTC seconds. All prices are synthetic.
const DAY = 1_800_000_000 - (1_800_000_000 % 86400)
const at = (h, m = 0, s = 0) => DAY + h * 3600 + m * 60 + s
const bar = (time, o, h, l, c, volume = 0, extra = {}) => ({ time, open: o, high: h, low: l, close: c, volume, ...extra })

/** Drive a sequence of push frames through mergePushBar exactly as Writer B does and
 *  record what would be painted for the developing bucket. */
function runPush(seed, frames, opts = {}) {
  let held = seed
  const painted = []
  for (const f of frames) {
    const r = mergePushBar(held, f.bar, { sym: 'SYN', tf: '5', ...opts, ...f.opts })
    if (r.kind === 'new' || r.kind === 'update') { held = r.bar; painted.push({ kind: r.kind, ...r.bar }) }
    else painted.push({ kind: r.kind })
  }
  return { held, painted }
}

describe('bucketEndTime', () => {
  it('fixed-length buckets for 1/5/15/30', () => {
    expect(bucketEndTime(at(10, 5), '5')).toBe(at(10, 10))
    expect(bucketEndTime(at(10, 0), '30')).toBe(at(10, 30))
    expect(bucketEndTime(at(10, 0), '1')).toBe(at(10, 1))
  })
  it('60m is TradingView-aligned: 15:30 is a half bar, pre-market 9:00 ends at the 9:30 open', () => {
    expect(bucketEndTime(at(9, 30), '60')).toBe(at(10, 30))
    expect(bucketEndTime(at(15, 30), '60')).toBe(at(16, 0))
    expect(bucketEndTime(at(9, 0), '60')).toBe(at(9, 30))
    expect(bucketEndTime(at(16, 0), '60')).toBe(at(17, 0))
  })
})

describe('mergePushBar (Writer B) — H/L never shrink within a bucket', () => {
  it('a later partial push frame with a NARROWER range does not shrink H/L (previously painted verbatim when liveBarRef was the source)', () => {
    const seed = bar(at(10, 5), 20.0, 20.8, 19.6, 20.1, 5000, { sym: 'SYN' })   // fetched partial
    const { painted } = runPush(seed, [
      { bar: bar(at(10, 5), 20.3, 20.5, 20.0, 20.4, 1200) },   // WS rollup since subscribe only
      { bar: bar(at(10, 5), 20.3, 20.6, 20.1, 20.2, 1800) },
    ])
    for (const p of painted) {
      expect(p.high).toBe(20.8)
      expect(p.low).toBe(19.6)
      expect(p.open).toBe(20.0)
    }
    expect(painted.map(p => p.close)).toEqual([20.4, 20.2])
  })

  it('H only rises, L only falls across a tick sequence', () => {
    const frames = [
      [20.0, 20.2, 19.9, 20.1], [20.0, 20.1, 20.0, 20.05], [20.0, 20.5, 20.0, 20.45], [20.0, 20.3, 19.7, 19.8],
    ].map(([o, h, l, c], i) => ({ bar: bar(at(10, 5), o, h, l, c, 100 * (i + 1)) }))
    const { painted } = runPush(null, frames)
    for (let i = 1; i < painted.length; i++) {
      expect(painted[i].high).toBeGreaterThanOrEqual(painted[i - 1].high)
      expect(painted[i].low).toBeLessThanOrEqual(painted[i - 1].low)
    }
    expect(painted.at(-1)).toMatchObject({ high: 20.5, low: 19.7, close: 19.8 })
  })

  it('volume never decreases within the bucket (D8)', () => {
    const seed = bar(at(10, 5), 20, 20.2, 19.9, 20.1, 9000, { sym: 'SYN' })
    const { painted } = runPush(seed, [{ bar: bar(at(10, 5), 20, 20.2, 19.9, 20.1, 400) }])
    expect(painted[0].volume).toBe(9000)
  })

  it('bucket roll at the boundary: new bucket opens clean, a late prior-bucket frame is ignored', () => {
    const seed = bar(at(10, 5), 20.0, 20.8, 19.6, 20.1, 5000, { sym: 'SYN' })
    const { painted, held } = runPush(seed, [
      { bar: bar(at(10, 10), 20.2, 20.25, 20.15, 20.2, 50) },    // new bucket
      { bar: bar(at(10, 5), 20.0, 21.5, 19.0, 21.4, 6000) },     // late, prior bucket
      { bar: bar(at(10, 10), 20.2, 20.3, 20.1, 20.28, 90) },
    ])
    expect(painted[0]).toMatchObject({ kind: 'new', time: at(10, 10), open: 20.2, high: 20.25, low: 20.15, volume: 50 })
    expect(painted[1]).toEqual({ kind: 'stale' })
    // no fusion: the prior bucket's wide range never leaks into the new candle
    expect(held).toMatchObject({ time: at(10, 10), open: 20.2, high: 20.3, low: 20.1, close: 20.28, volume: 90 })
  })

  it('a FINAL closed bar is the truth even if narrower than what live showed', () => {
    const seed = bar(at(10, 5), 20.0, 20.9, 19.5, 20.1, 5000, { sym: 'SYN' })
    const { held } = runPush(seed, [
      { bar: bar(at(10, 5), 20.0, 20.7, 19.6, 20.15, 5200), opts: { final: true } },
      { bar: bar(at(10, 5), 20.0, 20.95, 19.4, 20.5, 5300) },   // straggler after final
    ])
    expect(held).toMatchObject({ high: 20.7, low: 19.6, close: 20.15, volume: 5200, final: true })
  })

  it('trade_ts: an older out-of-order frame widens the range but cannot move the close back', () => {
    const t0 = (at(10, 5) + 30) * 1000
    const { held } = runPush(null, [
      { bar: bar(at(10, 5), 20, 20.2, 19.9, 20.15, 100), opts: { tradeTs: t0 + 5000 } },
      { bar: bar(at(10, 5), 20, 20.4, 19.9, 20.0, 120), opts: { tradeTs: t0 } },
    ])
    expect(held).toMatchObject({ close: 20.15, high: 20.4, volume: 120 })
  })

  it('trade_ts outside the frame\'s own bucket is dropped (mis-bucketed partial)', () => {
    const r = mergePushBar(null, bar(at(10, 5), 20, 20.2, 19.9, 20.1, 1), { tf: '5', tradeTs: at(10, 10, 2) * 1000 })
    expect(r.kind).toBe('drop')
  })

  it('absent optional fields behave like the legacy contract', () => {
    const r = mergePushBar(null, bar(at(10, 5), 20, 20.2, 19.9, 20.1, 1), { tf: '5' })
    expect(r.kind).toBe('new')
  })

  it('symbol switch mid-bucket: never merges into the previous symbol\'s same-time bar', () => {
    const prev = bar(at(10, 5), 300, 310, 290, 305, 9e6, { sym: 'OLD' })
    const r = mergePushBar(prev, bar(at(10, 5), 20, 20.2, 19.9, 20.1, 10), { sym: 'NEW', tf: '5' })
    expect(r.kind).toBe('new')
    expect(r.bar).toMatchObject({ open: 20, high: 20.2, low: 19.9, volume: 10, sym: 'NEW' })
  })

  it('malformed frames are dropped', () => {
    expect(mergePushBar(null, bar(at(10, 5), undefined, 1, 1, 1)).kind).toBe('drop')
    expect(mergePushBar(null, bar(at(10, 5), 1, 1, 2, 1)).kind).toBe('drop')
  })
})

describe('reconcileWithServerTail (Writer D, after the 30s poll / refetch)', () => {
  it('poll lands mid-bucket with a LOWER server high: live H/L, close and volume stand', () => {
    const live = bar(at(10, 5), 20.0, 20.8, 19.6, 20.5, 7000, { sym: 'SYN' })
    const server = bar(at(10, 5), 20.0, 20.4, 19.8, 20.2, 6000)
    const { bar: b, ahead } = reconcileWithServerTail(live, server, { sym: 'SYN', periodSec: 300 })
    expect(ahead).toBe(false)
    expect(b).toMatchObject({ open: 20.0, high: 20.8, low: 19.6, close: 20.5, volume: 7000 })
  })

  it('server correction that is WIDER is respected; server volume ahead of live wins', () => {
    const live = bar(at(10, 5), 20.1, 20.5, 19.9, 20.3, 100, { sym: 'SYN' })
    const server = bar(at(10, 5), 20.0, 20.6, 19.7, 20.2, 9000)
    const { bar: b } = reconcileWithServerTail(live, server, { sym: 'SYN', periodSec: 300 })
    expect(b).toMatchObject({ open: 20.0, high: 20.6, low: 19.7, close: 20.3, volume: 9000 })
  })

  it('live bar ONE bucket ahead of the fetched tail is kept (not blanked / collapsed)', () => {
    const live = bar(at(10, 10), 20.2, 20.6, 20.0, 20.4, 300, { sym: 'SYN' })
    const server = bar(at(10, 5), 20.0, 20.8, 19.6, 20.2, 8000)
    const r = reconcileWithServerTail(live, server, { sym: 'SYN', periodSec: 300 })
    expect(r.ahead).toBe(true)
    expect(r.bar).toMatchObject({ time: at(10, 10), open: 20.2, high: 20.6, low: 20.0, close: 20.4, volume: 300 })
  })

  it('server newer than the live bar, or a detached live bar, → server wins', () => {
    const server = bar(at(10, 10), 20.2, 20.3, 20.1, 20.2, 50)
    expect(reconcileWithServerTail(bar(at(10, 5), 1, 2, 1, 1, 0), server, { sym: 'SYN', periodSec: 300 }).bar.time).toBe(at(10, 10))
    const r = reconcileWithServerTail(bar(at(10, 30), 1, 2, 1, 1, 0), server, { sym: 'SYN', periodSec: 300 })
    expect(r.ahead).toBe(false)
    expect(r.bar.time).toBe(at(10, 10))
  })

  it('symbol switch mid-bucket: a held bar from another symbol is discarded', () => {
    const live = bar(at(10, 5), 300, 310, 290, 305, 9e6, { sym: 'OLD' })
    const server = bar(at(10, 5), 20, 20.2, 19.9, 20.1, 10)
    const r = reconcileWithServerTail(live, server, { sym: 'NEW', periodSec: 300 })
    expect(r.bar).toMatchObject({ open: 20, high: 20.2, low: 19.9, close: 20.1, volume: 10, sym: 'NEW' })
  })
})

describe('foldPrice (fallback writers A/C) — D3: bucket by the trade\'s own time', () => {
  const lb = bar(at(10, 5), 20.0, 20.5, 19.8, 20.1, 0)
  it('same-bucket print extends monotonically', () => {
    expect(foldPrice(lb, 20.7, at(10, 7), '5').bar).toMatchObject({ high: 20.7, low: 19.8, close: 20.7, open: 20.0 })
    expect(foldPrice(lb, 20.2, at(10, 7), '5').bar).toMatchObject({ high: 20.5, low: 19.8, close: 20.2 })
  })
  it('a print from the NEXT bucket is not fused into the current candle', () => {
    expect(foldPrice(lb, 25, at(10, 10), '5').kind).toBe('later')
  })
  it('a late print from the PREVIOUS bucket does not stretch the new candle', () => {
    expect(foldPrice(lb, 15, at(10, 4, 59), '5').kind).toBe('earlier')
  })
  it('60m half bar: a 16:00 print is not fused into the 15:30 bar', () => {
    expect(foldPrice(bar(at(15, 30), 20, 20, 20, 20), 21, at(16, 0), '60').kind).toBe('later')
    expect(foldPrice(bar(at(15, 30), 20, 20, 20, 20), 21, at(15, 59), '60').kind).toBe('update')
  })
  it('unknown tick time = current bucket; bad price dropped', () => {
    expect(foldPrice(lb, 20.3, null, '5').kind).toBe('update')
    expect(foldPrice(lb, 0, null, '5').kind).toBe('drop')
  })
})

describe('mergeRegistryMinute (Writer C, 1m)', () => {
  it('a since-subscribe registry slice never shrinks the fetched minute', () => {
    const known = bar(at(10, 5), 20.0, 20.8, 19.6, 20.1, 5000)
    const m = mergeRegistryMinute(known, { time: at(10, 5), o: 20.3, h: 20.4, l: 20.2, c: 20.35, v: 300 })
    expect(m).toMatchObject({ open: 20.0, high: 20.8, low: 19.6, close: 20.35, volume: 5000 })
  })
  it('bar_close-shaped candle without o/h/l is refused (never series.update(undefined))', () => {
    expect(mergeRegistryMinute(null, { time: at(10, 5), c: 20.1, v: 10 })).toBeNull()
  })
  it('a fresh minute with nothing known paints the registry candle as is', () => {
    const m = mergeRegistryMinute(bar(at(10, 4), 1, 2, 1, 1), { time: at(10, 5), o: 20, h: 20.2, l: 19.9, c: 20.1, v: 7 })
    expect(m).toMatchObject({ time: at(10, 5), open: 20, high: 20.2, low: 19.9, close: 20.1, volume: 7 })
    expect(isCompleteOhlc(m)).toBe(true)
  })
})

describe('W-B contract additions', () => {
  it('a FINAL frame with an older t is a correction of that closed bucket, a non-final one is stale', () => {
    const prev = bar(at(10, 10), 20.2, 20.3, 20.1, 20.2, 50, { sym: 'SYN' })
    const fin = mergePushBar(prev, bar(at(10, 5), 20, 20.9, 19.5, 20.1, 5000), { sym: 'SYN', tf: '5', final: true })
    expect(fin.kind).toBe('correct')
    expect(fin.bar).toMatchObject({ time: at(10, 5), high: 20.9, low: 19.5, final: true })
    expect(mergePushBar(prev, bar(at(10, 5), 20, 20.9, 19.5, 20.1, 5000), { sym: 'SYN', tf: '5' }).kind).toBe('stale')
  })
  it('ETH 60m buckets are clock hours (no 9:30 cut); RTH keeps the anchors', () => {
    expect(bucketEndTime(at(9, 0), '60', 'eth')).toBe(at(10, 0))
    expect(bucketEndTime(at(9, 0), '60', 'rth')).toBe(at(9, 30))
    expect(foldPrice(bar(at(9, 0), 20, 20, 20, 20), 21, at(9, 45), '60', 'eth').kind).toBe('update')
    expect(foldPrice(bar(at(9, 0), 20, 20, 20, 20), 21, at(9, 45), '60', 'rth').kind).toBe('later')
  })
})

describe('F3: reconcile keeps a CURRENT live bucket even when it is >1 period past the tail', () => {
  it('first bucket of the session / thin name with skipped buckets', () => {
    const live = bar(at(10, 20), 20.2, 20.6, 20.0, 20.4, 300, { sym: 'SYN' })
    const server = bar(at(10, 5), 20.0, 20.8, 19.6, 20.2, 8000)
    const nowChart = at(10, 22)
    expect(reconcileWithServerTail(live, server, { sym: 'SYN', periodSec: 300 }).ahead).toBe(false)
    const r = reconcileWithServerTail(live, server, { sym: 'SYN', periodSec: 300, nowChart, tf: '5' })
    expect(r.ahead).toBe(true)
    expect(r.bar).toMatchObject({ open: 20.2, high: 20.6, low: 20.0 })
    // not current any more (wall clock moved past it) and detached → server wins
    expect(reconcileWithServerTail(live, server, { sym: 'SYN', periodSec: 300, nowChart: at(10, 40), tf: '5' }).ahead).toBe(false)
  })
})

describe('N1: "next bucket ahead" expires after the bucket ends + grace', () => {
  it('held during the bucket and the grace, dropped after', () => {
    const live = bar(at(10, 10), 20.2, 20.6, 20.0, 20.4, 300, { sym: 'SYN' })
    const server = bar(at(10, 5), 20.0, 20.8, 19.6, 20.2, 8000)
    const o = (now) => reconcileWithServerTail(live, server, { sym: 'SYN', periodSec: 300, nowChart: now, tf: '5' }).ahead
    expect(o(at(10, 12))).toBe(true)          // in the bucket
    expect(o(at(10, 15, 30))).toBe(true)      // ended, within grace
    expect(o(at(10, 16, 0))).toBe(false)      // past grace: server tail wins
  })
})

describe('bucketEndTime delegates to barTime (half-day + per-instant offset) — W-E', () => {
  it('a 13:00 half-day: the 12:30 RTH bar ends at 13:00, the 13:00 post bar at 14:00', async () => {
    const { bucketEndTime: end } = await import('./liveBarMerge')
    const { toChartTime } = await import('../components/chart/barTime')
    const at = (h, m) => toChartTime(Date.UTC(2026, 10, 27, h + 5, m) / 1000)   // Nov 27: EST
    expect(end(at(12, 30), '60', 'rth')).toBe(at(13, 0))
    expect(end(at(13, 0), '60', 'rth')).toBe(at(14, 0))
    expect(end(at(12, 0), '60', 'eth')).toBe(at(13, 0))
  })
  it('mergePushBar compares trade time through toChart, not a constant offset', async () => {
    const { mergePushBar } = await import('./liveBarMerge')
    const { toChartTime } = await import('../components/chart/barTime')
    const u = Date.UTC(2026, 9, 30, 14, 30) / 1000             // 10:30 EDT (pre-DST-change bar)
    const inc = { time: toChartTime(u), open: 1, high: 2, low: 1, close: 1.5, volume: 1 }
    const tradeTs = (u + 120) * 1000
    expect(mergePushBar(null, inc, { tf: '60', tradeTs, toChart: toChartTime }).kind).toBe('new')
    // a constant EST offset puts that trade an hour early → outside its own bucket
    expect(mergePushBar(null, inc, { tf: '60', tradeTs, timeOffsetSec: -18000 }).kind).toBe('drop')
  })
})
