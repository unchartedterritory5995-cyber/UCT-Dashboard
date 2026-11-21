// @vitest-environment node
// TODAY'S D BAR FROM THE SERVER'S OWN ROW (live.js + forming.js DEVICE_DAILY_SERVER_ROW), fed through the REAL
// consumer and rollup by a day the real publisher wrote with a daily feed (tests/fixtures/minute_frames/
// day_daily.today.bin, 2026-11-19: the DAILY section from the 16:00 close, a publisher restart after it). The D
// answer must be that row exactly while the consumer vouches for the rows, and, whenever it does not, exactly the
// answer of an overlay that never saw a DAILY section (the rollup path, untouched).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { Buffer } from 'node:buffer'
import { todayFrames } from '../../lib/minuteFrames/codec'
import { createMinuteFrameConsumer } from '../../lib/minuteFrames/consumer'
import { createHash } from 'node:crypto'
import { createLiveOverlay, prevSessionISO, bucketEndOf } from './live'
import { createDeviceEngine } from './engine'
import { memoryIO } from './io'
import { seedPackOf } from './testing/fixtures'
import { createLiveFeed } from './liveFeed'
import { DEVICE_DAILY_SERVER_ROW, DEVICE_FORMING_DAILY } from './forming'
import { STORED_TFS } from './tfs'

const fixture = (name) => new Uint8Array(fs.readFileSync(new URL(`../../../../tests/fixtures/minute_frames/${name}`, import.meta.url)))
const D = JSON.parse(Buffer.from(fixture('day_daily.json')).toString('utf8'))
const PREV = prevSessionISO(D.day)
const FRAMES = [...todayFrames(fixture('day_daily.today.bin'))]
const DAY_T = Date.UTC(2026, 10, 19) / 1000
const FIRST_FULL = D.daily_sections[0][0]
const SECOND_EPOCH_FULL = D.daily_sections.find((s) => s[1] !== D.daily_sections[0][1])[0]
const SYMS = ['DENSE', 'THIN', 'RTHONLY', 'BRK.B', 'SUBPENNY', 'LATECOMER']
// the seed spells the class share 'BRK.B' here; the feed (and the DAILY rows) say 'BRK-B'
const nameOf = (s) => (s === 'BRK-B' ? 'BRK.B' : s)

/** An overlay fed the day's frames (up to `upto`, minus `drop`) by the real consumer. `strip`: the frames lose
 *  their DAILY section first (what an overlay that never heard of it sees). */
function replay({ upto = Infinity, drop = [], incomplete = [], strip = false, overlayOpts = {} } = {}) {
  const overlay = createLiveOverlay({ nameOf, ...overlayOpts })
  const c = createMinuteFrameConsumer({
    sink: overlay.sink, rollup: { tfs: [...STORED_TFS] },
    fetchImpl: async () => new Response('', { status: 404 }), setTimer: () => 0, clearTimer: () => {},
  })
  for (const f of FRAMES) {
    if (f.seq > upto) break
    if (drop.includes(f.seq)) continue
    const g = incomplete.includes(f.seq) ? { ...f, complete: false } : f
    c.applyFrame(strip ? { ...g, daily: null } : g)
  }
  return overlay
}
/** The newest row per symbol of every section up to `upto` (what the server held then), seed spelling. */
function serverRowsAt(upto) {
  const out = {}
  for (const [seq, , , rows] of D.daily_sections) if (seq <= upto) for (const [s, r] of Object.entries(rows)) out[nameOf(s)] = r
  return out
}
const rowOf = (c) => [c.t[0], c.o[0], c.h[0], c.l[0], c.c[0], c.v[0]]
const answers = (o) => Object.fromEntries(SYMS.flatMap((s) => STORED_TFS.map((tf) => [`${s}|${tf}`, { res: o.read(s, tf, PREV), why: o.why(s, tf, PREV) }])))

describe('today\'s D bar from the server\'s own row', () => {
  it('the switches: the server row ON (the server flag is the gate), the minute-rollup D bar still OFF', () => {
    expect([DEVICE_DAILY_SERVER_ROW, DEVICE_FORMING_DAILY]).toEqual([true, false])
  })

  it('after the close: the D answer IS the server\'s row, exactly, FORMING until 20:00', () => {
    const upto = FIRST_FULL + 40                                     // 16:40 ET: after LATECOMER's first row
    const o = replay({ upto })
    const want = serverRowsAt(upto)
    expect(Object.keys(want).sort()).toEqual([...SYMS].sort())
    const minute = FRAMES.find((f) => f.seq === upto).minute
    for (const sym of SYMS) {
      const got = o.read(sym, 'D', PREV)
      expect(got.forming).toBe('D')
      expect(got.through).toBe((minute + 1) * 60)
      expect(got.through).toBeLessThan(bucketEndOf(DAY_T, 'D'))
      expect(rowOf(got.cols)).toEqual([DAY_T, ...want[sym]])        // toEqual on numbers: Object.is, bit for bit
    }
    expect(o.state()).toMatchObject({ dailyOk: true, dailyRows: SYMS.length })
  })

  it('the whole day: the newest row (the restart\'s full set and every change after it), complete at 20:00', () => {
    const o = replay()
    for (const sym of SYMS) {
      const got = o.read(sym, 'D', PREV)
      expect(got.forming).toBeUndefined()
      expect(got.through).toBe(bucketEndOf(DAY_T, 'D'))
      expect(rowOf(got.cols)).toEqual([DAY_T, ...D.daily_final[sym === 'BRK.B' ? 'BRK-B' : sym]])
    }
  })

  it('a gap the PUBLISHER has in the minutes does not touch it (it is not built from minutes); intraday still refuses', () => {
    const socketDown = FIRST_FULL - 120                              // 14:00: published INCOMPLETE (the vendor socket was down)
    const o = replay({ upto: FIRST_FULL + 10, incomplete: [socketDown] })
    expect(o.why('DENSE', '5', PREV)).toBe('gap')
    expect(rowOf(o.read('DENSE', 'D', PREV).cols)).toEqual([DAY_T, ...serverRowsAt(FIRST_FULL + 10).DENSE])
  })

  it('a frame THIS device missed, even before the close, ends the trust (fail closed: the re-sync of the day file repairs it)', () => {
    const o = replay({ upto: FIRST_FULL + 10, drop: [FIRST_FULL - 120] })
    expect(o.state().dailyOk).toBe(false)
    expect(answers(o)).toEqual(answers(replay({ upto: FIRST_FULL + 10, drop: [FIRST_FULL - 120], strip: true })))
  })

  it('before the close there is no row: the D answer is the rollup\'s, byte for byte', () => {
    expect(answers(replay({ upto: FIRST_FULL - 1 }))).toEqual(answers(replay({ upto: FIRST_FULL - 1, strip: true })))
  })

  it('dailyOk false -> the old path, byte-identical answer (a missed full set, a missed change, the switch off)', () => {
    // the epoch's full set never arrived: nothing is vouched for until the restart's
    const missedFull = replay({ upto: SECOND_EPOCH_FULL - 1, drop: [FIRST_FULL] })
    expect(missedFull.state().dailyOk).toBe(false)
    expect(answers(missedFull)).toEqual(answers(replay({ upto: SECOND_EPOCH_FULL - 1, drop: [FIRST_FULL], strip: true })))
    // a change frame missed (LATECOMER's first row rode it): the same
    const change = D.daily_sections[1][0]
    const missedChange = replay({ upto: SECOND_EPOCH_FULL - 1, drop: [change] })
    expect(missedChange.state().dailyOk).toBe(false)
    expect(answers(missedChange)).toEqual(answers(replay({ upto: SECOND_EPOCH_FULL - 1, drop: [change], strip: true })))
    // ...and the restart's full set vouches again
    expect(rowOf(replay({ drop: [FIRST_FULL] }).read('LATECOMER', 'D', PREV).cols)).toEqual([DAY_T, ...D.daily_final.LATECOMER])
    // the switch off: never, whatever the frames carry
    expect(answers(replay({ overlayOpts: { dailyServerRow: false } }))).toEqual(answers(replay({ strip: true })))
  })

  it('through the engine: D ends with the server row and W / M carry the period in progress, formed from it', async () => {
    // a seed whose D window ends on the session before (2026-11-18), 30 sessions of it
    const days = []
    for (let d = new Date(Date.UTC(2026, 10, 18)); days.length < 30; d.setUTCDate(d.getUTCDate() - 1)) {
      const wd = d.getUTCDay()
      if (wd !== 0 && wd !== 6 && d.toISOString().slice(0, 10) !== '2026-11-11') days.unshift(d.getTime() / 1000)
    }
    const seed = days.map((t, i) => ({ t, o: 90 + i * 0.25, h: 91 + i * 0.25, l: 89 + i * 0.25, c: 90.5 + i * 0.25, v: 5e6 + i }))
    const pack = seedPackOf({ DENSE: seed }, { tf: 'D', asof: PREV, build: 'b1' })
    const at1640 = Date.UTC(2026, 10, 19, 21, 40)                    // 16:40 ET
    const eng = createDeviceEngine({ io: memoryIO(), fetchFn: async () => new Response(pack), now: () => at1640 })
    await eng.ingest({ tf: 'D', url: 'D', bytes: pack.length, sha256: createHash('sha256').update(pack).digest('hex'), build: 'b1' })
    await eng.setSplits({ splits: { session: D.day, symbols: {} } })
    const overlay = createLiveOverlay({ nameOf: (s) => eng.seedName(s) })
    eng.attachLive(overlay)
    const c = createMinuteFrameConsumer({ sink: overlay.sink, rollup: { tfs: [...STORED_TFS] },
      fetchImpl: async () => new Response('', { status: 404 }), setTimer: () => 0, clearTimer: () => {} })
    for (const f of FRAMES) { if (f.seq > FIRST_FULL + 40) break; c.applyFrame(f) }
    const row = serverRowsAt(FIRST_FULL + 40).DENSE
    const d = eng.read('DENSE', 'D')
    expect(d.t.length).toBe(seed.length + 1)
    expect([d.t.at(-1), d.o.at(-1), d.h.at(-1), d.l.at(-1), d.c.at(-1), d.v.at(-1)]).toEqual([DAY_T, ...row])
    expect(d.forming).toBe('D')
    const w = eng.read('DENSE', 'W')
    expect(new Date(w.t.at(-1) * 1000).toISOString().slice(0, 10)).toBe('2026-11-20')   // this week, in progress
    expect(w.c.at(-1)).toBe(row[3])
    expect(w.h.at(-1)).toBe(Math.max(row[1], ...seed.filter((b) => b.t >= Date.UTC(2026, 10, 16) / 1000).map((b) => b.h)))
    expect(w.forming).toBe('D')
    const m = eng.read('DENSE', 'M')
    expect(m.c.at(-1)).toBe(row[3])
    // and without the trust (the full set missed), the engine is back to the seed alone for D: no today bar
    const o2 = createLiveOverlay({ nameOf: (s) => eng.seedName(s) })
    eng.attachLive(o2)
    const c2 = createMinuteFrameConsumer({ sink: o2.sink, rollup: { tfs: [...STORED_TFS] },
      fetchImpl: async () => new Response('', { status: 404 }), setTimer: () => 0, clearTimer: () => {} })
    for (const f of FRAMES) { if (f.seq > FIRST_FULL + 40) break; if (f.seq !== FIRST_FULL) c2.applyFrame(f) }
    expect(eng.read('DENSE', 'D').t.length).toBe(seed.length)
  })

  it('a full set REPLACES what the overlay held (a row the server no longer has is not painted); changes merge', () => {
    const o = createLiveOverlay()
    o.sink.reset({ day: D.day })
    const r = (sym, c) => ({ sym, o: 10, h: 11, l: 9, c, v: 100 })
    const at = (minute) => o.sink.frameDone({ day: D.day, seq: 800, minute, dailyOk: true })
    const m = FRAMES.find((f) => f.seq === FIRST_FULL).minute
    o.sink.daily({ day: D.day, full: true, rows: [r('AAA', 10.5), r('BBB', 10.25)] }); at(m)
    o.sink.daily({ day: D.day, full: false, rows: [r('AAA', 10.75)] }); at(m + 1)
    expect(o.read('AAA', 'D', PREV).cols.c[0]).toBe(10.75)
    expect(o.read('BBB', 'D', PREV).cols.c[0]).toBe(10.25)
    o.sink.daily({ day: D.day, full: true, rows: [r('AAA', 10.5)] }); at(m + 2)
    expect(o.read('BBB', 'D', PREV)?.cols ?? null).toBeNull()                  // the rollup's answer: nothing today
    expect(o.state().dailyRows).toBe(1)
  })

  it('the live feed hands the consumer DAILY sections to the overlay (and drops a replaced consumer\'s)', async () => {
    const made = []
    const load = async () => ({ createMinuteFrameConsumer: (opts) => { const c = { opts, start() {}, stop() {}, syncNow: async () => ({}), status: () => ({}) }; made.push(c); return c } })
    const overlay = createLiveOverlay()
    const feed = createLiveFeed({ overlay, load, now: () => Date.UTC(2026, 10, 19, 21, 5) })
    await feed.start()
    const sink = made[0].opts.sink
    sink.reset({ day: D.day })
    sink.daily({ day: D.day, full: true, rows: [{ sym: 'AAA', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }] })
    expect(overlay.state().dailyRows).toBe(1)
    feed.resync('manual', { force: true })
    await Promise.resolve(); await Promise.resolve()
    sink.daily({ day: D.day, full: false, rows: [{ sym: 'BBB', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }] })   // the old consumer's
    expect(overlay.state().dailyRows).toBe(0)
    feed.stop()
  })

  it('a re-sync (clear) forgets the rows and the trust until the frames say so again', () => {
    const o = replay({ upto: FIRST_FULL + 5 })
    o.clear()
    expect(o.state()).toMatchObject({ dailyOk: false, dailyRows: 0 })
    o.sink.reset({ day: D.day })
    expect(o.read('DENSE', 'D', PREV)).toBeNull()
  })
})
