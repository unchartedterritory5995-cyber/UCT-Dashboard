// @vitest-environment node
// TODAY's overlay (live.js), fed by the REAL rollup (lib/minuteFrames) replaying a whole session the
// real publisher wrote (tests/fixtures/minute_frames/day_regular.today.bin, 2026-11-18). Its bars must
// be exactly the SERVER's buckets for the same minutes (day_regular.json, written from the server's
// own bar_rollup), restricted to the regular session the seed holds; and it must refuse to vouch for
// anything a gap, a partial or a stale bucket touched.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { Buffer } from 'node:buffer'
import { todayFrames } from '../../lib/minuteFrames/codec'
import { createMinuteRollup } from '../../lib/minuteFrames/rollup'
import { isRthBar } from '../../components/chart/barTime'
import { createLiveOverlay, prevSessionISO, nextSessionISO, LIVE_INITIAL_CAP } from './live'
import { STORED_TFS } from './tfs'

const fixture = (name) => new Uint8Array(fs.readFileSync(new URL(`../../../../tests/fixtures/minute_frames/${name}`, import.meta.url)))
const DAY = JSON.parse(Buffer.from(fixture('day_regular.json')).toString('utf8'))
const PREV = prevSessionISO(DAY.day)

function replay({ nameOf = (s) => s, upto = Infinity, frames = null } = {}) {
  const overlay = createLiveOverlay({ nameOf })
  const r = createMinuteRollup({ sink: overlay.sink, tfs: [...STORED_TFS] })
  overlay.sink.reset({ day: DAY.day })
  for (const f of frames ?? todayFrames(fixture('day_regular.today.bin'))) {
    if (f.seq > upto) break
    r.applyFrame(f)
    overlay.sink.frameDone({ day: DAY.day, seq: f.seq, minute: f.minute })
  }
  return { overlay, r }
}
const rows = (c) => Array.from(c.t, (t, i) => [t, c.o[i], c.h[i], c.l[i], c.c[i], c.v[i]])

describe('the live overlay', () => {
  it('prevSessionISO skips weekends and NYSE holidays', () => {
    expect(prevSessionISO('2026-11-18')).toBe('2026-11-17')
    expect(prevSessionISO('2026-11-16')).toBe('2026-11-13')          // Monday -> Friday
    expect(prevSessionISO('2026-11-27')).toBe('2026-11-25')          // after Thanksgiving
    expect(nextSessionISO('2026-11-25')).toBe('2026-11-27')
    expect(nextSessionISO('2026-11-20')).toBe('2026-11-23')          // Friday -> Monday
  })

  it('a whole day replayed: every seed timeframe equals the SERVER\'s buckets, regular session only', () => {
    const { overlay } = replay()
    for (const sym of Object.keys(DAY.expected)) {
      for (const tf of STORED_TFS) {
        const want = (DAY.expected[sym][tf] || []).filter((b) => tf === 'D' || isRthBar(b[0]))
        const got = overlay.read(sym, tf, PREV)
        // the 20:00 frame was the last: everything is complete through then, the day's D bar included
        expect(got.through).toBe(Math.floor(Date.UTC(2026, 10, 19, 1, 0) / 1000))
        if (!want.length) { expect(got.cols).toBeNull(); continue }
        expect(rows(got.cols)).toEqual(want)
      }
    }
    expect(overlay.state().series).toBeGreaterThan(0)
  })

  it('a series starts small and grows (a symbol that trades a few minutes costs a few bars)', () => {
    const o = createLiveOverlay()
    o.sink.reset({ day: DAY.day })
    const t0 = Math.floor(Date.UTC(2026, 10, 18, 14, 30) / 1000)
    for (let i = 0; i < 20; i++) o.sink.upsert('AAA', '1', { t: t0 + i * 60, o: 1, h: 1, l: 1, c: 1, v: i }, true)
    o.sink.frameDone({ day: DAY.day, minute: t0 / 60 + 19 })
    const got = o.read('AAA', '1', PREV)
    expect(Array.from(got.cols.v)).toEqual(Array.from({ length: 20 }, (_, i) => i))
    expect(LIVE_INITIAL_CAP).toBeLessThan(20)
  })

  it("mid-session: only COMPLETE buckets (whose last minute has landed), each the server's; and `through`", () => {
    // frames up to the 10:11 ET minute (seq = minutes since 04:00): complete through 10:12:00
    const seq = 10 * 60 + 11 - 240
    const { overlay } = replay({ upto: seq })
    const sym = Object.keys(DAY.expected)[0]
    const got = overlay.read(sym, '5', PREV)
    expect(got.through).toBe(Math.floor(Date.UTC(2026, 10, 18, 15, 12) / 1000))
    const lastT = got.cols.t.at(-1)
    expect(new Date(lastT * 1000).toISOString().slice(11, 16)).toBe('15:05')   // 10:05 ET: the 10:10 bucket is not over
    const want = DAY.expected[sym]['5'].filter((b) => isRthBar(b[0]) && b[0] <= lastT)
    expect(rows(got.cols)).toEqual(want)
    expect(overlay.read(sym, '1', PREV).cols.t.at(-1)).toBe(Math.floor(Date.UTC(2026, 10, 18, 15, 11) / 1000))
    expect(overlay.read(sym, 'D', PREV).cols).toBeNull()               // today's D ends with the day
  })

  it('only the seed\'s symbols, under the seed\'s spelling; never the 60e grid', () => {
    const syms = Object.keys(DAY.expected)
    const keep = syms[0]
    const { overlay } = replay({ nameOf: (s) => (s === keep ? `${s}-B` : null) })
    expect(overlay.read(`${keep}-B`, '5', PREV).cols).not.toBeNull()
    expect(overlay.read(keep, '5', PREV).cols).toBeNull()
    expect(overlay.read(syms[1], '5', PREV).cols).toBeNull()
    expect(overlay.read(`${keep}-B`, '60e', PREV)).toBeNull()
  })

  it('joined only across ONE night: a seed ending at another session gets nothing', () => {
    const { overlay } = replay()
    const sym = Object.keys(DAY.expected)[0]
    expect(overlay.read(sym, 'D', PREV).cols).not.toBeNull()
    expect(overlay.read(sym, 'D', '2026-11-16')).toBeNull()           // a session would be missing between
    expect(overlay.read(sym, 'D', DAY.day)).toBeNull()                 // the seed already holds today
  })

  it('a gap inside the session: nothing is vouched for; outside it: only D is refused', () => {
    const sym = Object.keys(DAY.expected)[0]
    const a = replay().overlay
    a.sink.gap({ fromMinute: Math.floor(Date.UTC(2026, 10, 18, 15, 0) / 60000), toMinute: Math.floor(Date.UTC(2026, 10, 18, 15, 2) / 60000), reason: 'not-published' })
    for (const tf of STORED_TFS) expect(a.read(sym, tf, PREV)).toBeNull()
    const b = replay().overlay
    b.sink.gap({ fromMinute: Math.floor(Date.UTC(2026, 10, 18, 10, 0) / 60000), toMinute: Math.floor(Date.UTC(2026, 10, 18, 10, 5) / 60000), reason: 'not-received' })
    expect(b.read(sym, '5', PREV).cols).not.toBeNull()                 // 05:00 ET: pre-market only
    expect(b.read(sym, 'D', PREV)).toBeNull()                          // the day's volume counts it
  })

  it('a partial or stale bucket makes that series unusable; a new day starts clean', () => {
    const sym = Object.keys(DAY.expected)[0]
    const { overlay } = replay()
    overlay.sink.stale(sym, '15', 0)
    expect(overlay.read(sym, '15', PREV)).toBeNull()
    expect(overlay.read(sym, '5', PREV).cols).not.toBeNull()
    overlay.sink.upsert(sym, '30', { t: Math.floor(Date.UTC(2026, 10, 18, 15, 0) / 1000), o: 1, h: 1, l: 1, c: 1, v: 1, partial: true }, false)
    expect(overlay.read(sym, '30', PREV)).toBeNull()
    overlay.sink.reset({ day: '2026-11-19' })
    expect(overlay.read(sym, '5', '2026-11-18')).toBeNull()            // nothing held for the new day yet
    expect(overlay.state().series).toBe(0)
  })
  it('the rollup filtered to the seed\u2019s symbols holds state for those alone', () => {
    const keep = Object.keys(DAY.expected)[0]
    const overlay = createLiveOverlay({ nameOf: (x) => (x === keep ? x : null) })
    const r = createMinuteRollup({ sink: overlay.sink, tfs: [...STORED_TFS], accept: (x) => x === keep })
    overlay.sink.reset({ day: DAY.day })
    for (const f of todayFrames(fixture('day_regular.today.bin'))) r.applyFrame(f)
    expect(r.stats().symbols).toBe(1)
    const all = createMinuteRollup({ sink: createLiveOverlay().sink, tfs: [...STORED_TFS] })
    for (const f of todayFrames(fixture('day_regular.today.bin'))) all.applyFrame(f)
    expect(all.stats().symbols).toBe(Object.keys(DAY.expected).length)
  })
})
