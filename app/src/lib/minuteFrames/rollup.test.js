// @vitest-environment node
// ROLLUP EQUALITY WITH THE SERVER. tests/fixtures/minute_frames/day_<name>.today.bin is a whole
// session as the real publisher wrote it, and day_<name>.json holds, for every symbol and
// timeframe, the bars the SERVER's own bucketing (bar_rollup.tv_bucket_bounds + aggregate; D by
// the documented daily rule) makes of the minutes those frames carry. Replaying the frames
// through the browser's rollup must produce exactly those bars, closed, on a regular day and on
// a 13:00 half-day (where the session 60m grid ends with a 12:30-13:00 bar).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { todayFrames, KIND_REPLACE } from './codec'
import { createMinuteRollup, bucketOf, ROLLUP_TFS } from './rollup'
import { createMemorySink } from './memorySink'

const fixture = (name) => new Uint8Array(fs.readFileSync(new URL(`../../../../tests/fixtures/minute_frames/${name}`, import.meta.url)))
const json = (name) => JSON.parse(Buffer.from(fixture(name)).toString('utf8'))

function replayDay(name, opts = {}) {
  const sink = createMemorySink()
  const r = createMinuteRollup({ sink, ...opts })
  for (const f of todayFrames(fixture(`day_${name}.today.bin`))) r.applyFrame(f)
  return { sink, r }
}

describe.each(['regular', 'halfday'])('rollup of the %s day equals the server\'s buckets', (name) => {
  const exp = json(`day_${name}.json`)
  const { sink, r } = replayDay(name)

  for (const sym of Object.keys(exp.expected)) {
    for (const tf of ROLLUP_TFS) {
      it(`${sym} ${tf}`, () => {
        const want = exp.expected[sym][tf] || []
        const got = sink.series(sym, tf).map((b) => [b.t, b.o, b.h, b.l, b.c, b.v])
        expect(got).toEqual(want)
        // every bar is closed by the end of the session (20:00 frame), none partial or stale
        expect(sink.series(sym, tf).every((b) => b.final && !b.partial)).toBe(true)
      })
    }
  }

  it('no bucket was reported stale (the day\'s one correction is exact)', () => {
    expect(sink.stale_).toEqual([])
    expect(r.stats().replaced).toBe(name === 'regular' ? 1 : 0)
    expect(r.stats().late).toBe(name === 'regular' ? 1 : 0)
  })
})

describe('rollup rules', () => {
  const T = Date.UTC(2026, 10, 18, 14, 30) / 1000          // 09:30 ET, a Wednesday
  const min = (hh, mm) => (T + ((hh - 9) * 60 + (mm - 30)) * 60) / 60

  it('the session 60m grid and the clock grid differ exactly where the server\'s do', () => {
    const t = min(9, 15) * 60
    expect(bucketOf(t, '60')).toEqual([min(9, 0) * 60, min(9, 30) * 60])       // the pre-market stub
    expect(bucketOf(t, '60e')).toEqual([min(9, 0) * 60, min(10, 0) * 60])
    expect(bucketOf(min(15, 45) * 60, '60')).toEqual([min(15, 30) * 60, min(16, 0) * 60])
    expect(bucketOf(min(12, 0) * 60, 'D')).toEqual([Date.UTC(2026, 10, 18) / 1000, min(20, 0) * 60])
  })

  it('D: open/high/low/close from regular-session minutes, volume from every minute or from av', () => {
    const sink = createMemorySink()
    const r = createMinuteRollup({ sink, tfs: ['D'] })
    r.applyMinute('X', min(8, 0), 9, 20, 1, 9, 100)        // pre-market: volume only
    expect(sink.series('X', 'D')).toEqual([])              // no D bar before the open
    r.applyMinute('X', min(9, 30), 10, 11, 9.5, 10.5, 50)
    r.applyMinute('X', min(16, 30), 12, 30, 2, 12, 25)      // post-market: volume only
    expect(sink.series('X', 'D')[0]).toMatchObject({ o: 10, h: 11, l: 9.5, c: 10.5, v: 175 })
    const s2 = createMemorySink()
    const r2 = createMinuteRollup({ sink: s2, tfs: ['D'] })
    r2.applyMinute('X', min(9, 30), 10, 11, 9.5, 10.5, 50, 5000)
    r2.applyMinute('X', min(9, 31), 10.5, 10.6, 10.4, 10.6, 70, 5070)
    expect(s2.series('X', 'D')[0].v).toBe(5070)            // the vendor's accumulated day volume
  })

  it('a late minute merges exactly into a closed bucket and re-emits it final', () => {
    const sink = createMemorySink()
    const r = createMinuteRollup({ sink, tfs: ['5'] })
    r.applyMinute('X', min(9, 30), 10, 10.2, 9.9, 10.1, 100)
    r.applyMinute('X', min(9, 32), 10.1, 10.3, 10, 10.2, 100)
    r.advanceTo(min(9, 35) * 60)
    r.applyMinute('X', min(9, 31), 10.1, 10.9, 9.5, 10.1, 7)        // arrived late
    expect(sink.series('X', '5')).toEqual([{ t: min(9, 30) * 60, o: 10, h: 10.9, l: 9.5, c: 10.2, v: 207, final: true }])
  })

  it('a correction is exact when it can be, and STALE when the old minute held the extreme', () => {
    const sink = createMemorySink()
    const r = createMinuteRollup({ sink, tfs: ['1', '5'] })
    r.applyMinute('X', min(9, 30), 10, 10.2, 9.9, 10.1, 100)
    r.applyMinute('X', min(9, 31), 10.1, 10.5, 10, 10.2, 100)      // holds the high
    r.applyMinute('X', min(9, 31), 10.1, 10.5, 10, 10.3, 150, null, KIND_REPLACE)   // close + volume: exact
    expect(sink.series('X', '5')[0]).toMatchObject({ h: 10.5, c: 10.3, v: 250 })
    expect(sink.stale_).toEqual([])
    r.applyMinute('X', min(9, 31), 10.1, 10.25, 10, 10.3, 150, null, KIND_REPLACE)  // lowers the high
    expect(sink.stale_).toEqual([{ sym: 'X', tf: '5', t: min(9, 30) * 60 }])
    expect(sink.series('X', '1')[1]).toMatchObject({ h: 10.25 })      // the 1m bar itself is exact
    r.applyMinute('X', min(9, 31), 10.1, 10.25, 10, 10.3, 150)        // an identical repeat: nothing
    expect(r.stats().repeats).toBe(1)
  })

  it('a gap marks every bucket spanning it partial', () => {
    const sink = createMemorySink()
    const r = createMinuteRollup({ sink, tfs: ['5', '60'] })
    r.applyMinute('X', min(9, 30), 10, 10, 10, 10, 1)
    r.markGap(min(9, 31), min(9, 33), { reason: 'test' })
    r.applyMinute('X', min(9, 34), 10, 10, 10, 10, 1)
    r.applyMinute('X', min(9, 35), 10, 10, 10, 10, 1)
    expect(sink.series('X', '5').map((b) => !!b.partial)).toEqual([true, false])
    expect(sink.series('X', '60')[0].partial).toBe(true)
    expect(sink.gaps).toEqual([{ fromMinute: min(9, 31), toMinute: min(9, 33), reason: 'test' }])
  })
})
