// @vitest-environment node
// H2 (review of #2537): A DAILY BAR BUILT FROM MINUTES IS NEVER A COMPLETE DAY. The overlay's D bucket ends at 20:00
// ET (rollup.bucketOf), so after the last frame the minute rollup's D bar read COMPLETE and was appended to the seed
// as an ordinary row: its volume a sum of minutes (MINUTE_FRAMES_WITH_AV off) or the vendor's accumulated volume,
// its O/H/L/C from regular-session minutes, never the official daily row. Stamped complete through 20:00, the copy
// read fresh and the daily switch committed on it. The rule now, whatever the publisher's flags:
//   DM1 the rollup's D bar is never handed out as a complete bar: after 20:00 the D answer holds no today bar
//   DM2 with today's forming D bar switched on (forming.js DEVICE_FORMING_DAILY, OFF in production) it is handed out
//       only as a FORMING bar and only while the regular session is open (the newest minute applied is a regular-
//       session minute): never after the close, half days included (13:00)
//   DM3 the server's own day row (MINUTE_FRAMES_WITH_DAILY, consumer `dailyOk`) is untouched: not built from minutes
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { Buffer } from 'node:buffer'
import { todayFrames } from '../../lib/minuteFrames/codec'
import { createMinuteRollup } from '../../lib/minuteFrames/rollup'
import { createLiveOverlay, prevSessionISO, bucketEndOf } from './live'
import { STORED_TFS } from './tfs'

const fixture = (name) => new Uint8Array(fs.readFileSync(new URL(`../../../../tests/fixtures/minute_frames/${name}`, import.meta.url)))
const DAYFX = JSON.parse(Buffer.from(fixture('day_regular.json')).toString('utf8'))   // 2026-11-18, a whole regular day
const PREV = prevSessionISO(DAYFX.day)

/** The regular day replayed through the real rollup (frames up to `upto`); `withAv` stamps every frame as carrying
 *  the accumulated day volume (what MINUTE_FRAMES_WITH_AV=1 publishes). */
function replay(opts = {}, { upto = Infinity, withAv = false } = {}) {
  const overlay = createLiveOverlay(opts)
  const r = createMinuteRollup({ sink: overlay.sink, tfs: [...STORED_TFS] })
  overlay.sink.reset({ day: DAYFX.day })
  for (const f of todayFrames(fixture('day_regular.today.bin'))) {
    if (f.seq > upto) break
    r.applyFrame(f)
    overlay.sink.frameDone({ day: DAYFX.day, seq: f.seq, minute: f.minute, ...(withAv ? { withAv: true } : {}) })
  }
  return overlay
}

/** A hand-fed overlay for `day`: the rollup's D bar for today, then one frame done at ET `hh:mm` (that minute applied). */
function dayAt(day, hh, mm, { formingDaily = true, withAv = true } = {}) {
  const t = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / 1000
  const o = createLiveOverlay({ formingDaily })
  o.sink.reset({ day })
  o.sink.upsert('AAA', 'D', { t, o: 10, h: 11, l: 9.5, c: 10.5, v: 1234567 }, false)
  // November is EST (UTC-5)
  const minute = Math.floor(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), hh + 5, mm) / 60000)
  o.sink.frameDone({ day, seq: (hh - 4) * 60 + mm, minute, ...(withAv ? { withAv: true } : {}) })
  return { o, t, prev: prevSessionISO(day) }
}

describe('H2 a D bar built from minutes is never a complete day', () => {
  it('DM1 after the last frame (20:00 ET) the D answer holds no today bar, whichever volume the frames carried', () => {
    const dayEnd = bucketEndOf(Date.UTC(2026, 10, 18) / 1000, 'D')
    for (const withAv of [false, true]) {
      const o = replay({}, { withAv })
      for (const sym of Object.keys(DAYFX.expected)) {
        const got = o.read(sym, 'D', PREV)
        expect(got, `${sym} av=${withAv}`).not.toBeNull()
        expect(got.through, sym).toBe(dayEnd)                         // complete through 20:00: the intraday rows are
        expect(got.cols, `${sym} av=${withAv}`).toBeNull()            // ...but no D bar from minutes
        expect(got.forming, sym).toBeUndefined()
      }
    }
  })

  it('DM1 ...the same with today\'s forming D bar switched on: after the close it is not even a forming bar', () => {
    const o = replay({ formingDaily: true }, { withAv: true })
    for (const sym of Object.keys(DAYFX.expected)) {
      const got = o.read(sym, 'D', PREV)
      expect(got.cols, sym).toBeNull()
      expect(got.forming, sym).toBeUndefined()
    }
  })

  it('DM2 forming D on: a forming bar while the session is open, nothing once a minute after the close is applied', () => {
    const at = (hh, mm) => { const { o, prev } = dayAt('2026-11-18', hh, mm); return o.read('AAA', 'D', prev) }
    const mid = at(11, 30)
    expect(mid.forming).toBe('D')                                      // the designed RTH behaviour (flag on): unchanged
    expect(mid.cols.t.length).toBe(1)
    expect(at(15, 59).forming).toBe('D')                               // the last regular minute
    for (const [hh, mm] of [[16, 0], [16, 30], [19, 0], [19, 30], [19, 59]]) {
      const r = at(hh, mm)
      expect(r.cols, `${hh}:${mm}`).toBeNull()
      expect(r.forming, `${hh}:${mm}`).toBeUndefined()
    }
  })

  it('DM2 a half day (Fri 2026-11-27, the 13:00 close): forming until 13:00, nothing after', () => {
    const at = (hh, mm) => { const { o, prev } = dayAt('2026-11-27', hh, mm); return o.read('AAA', 'D', prev) }
    expect(at(12, 30).forming).toBe('D')
    expect(at(12, 59).forming).toBe('D')
    for (const [hh, mm] of [[13, 0], [13, 30], [16, 30], [19, 59]]) {
      const r = at(hh, mm)
      expect(r.cols, `${hh}:${mm}`).toBeNull()
      expect(r.forming, `${hh}:${mm}`).toBeUndefined()
    }
  })

  it('DM2 forming D off (production): no D bar from minutes at any minute of the day', () => {
    for (const [hh, mm] of [[9, 30], [11, 30], [15, 59], [16, 30], [19, 59]]) {
      const { o, prev } = dayAt('2026-11-18', hh, mm, { formingDaily: false })
      expect(o.read('AAA', 'D', prev).cols, `${hh}:${mm}`).toBeNull()
    }
  })

  it('DM3 the server\'s own day row is still today\'s bar after 20:00 (exact by construction, not built from minutes)', () => {
    const { o, t, prev } = dayAt('2026-11-18', 19, 59, { formingDaily: false })
    o.sink.daily({ day: '2026-11-18', full: true, rows: [{ sym: 'AAA', o: 10.1, h: 11.2, l: 9.4, c: 10.6, v: 2345678 }] })
    o.sink.frameDone({ day: '2026-11-18', seq: 959, minute: Math.floor(Date.UTC(2026, 10, 19, 0, 59) / 60000), dailyOk: true })
    const r = o.read('AAA', 'D', prev)
    expect(r.forming).toBeUndefined()
    expect([r.cols.t[0], r.cols.o[0], r.cols.h[0], r.cols.l[0], r.cols.c[0], r.cols.v[0]]).toEqual([t, 10.1, 11.2, 9.4, 10.6, 2345678])
  })
})
