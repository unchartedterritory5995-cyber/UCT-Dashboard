// @vitest-environment node
// TODAY'S FORMING BAR ON THE DEVICE (forming.js, both paths OFF by default). With a path on, the overlay hands
// out the bucket in progress, built from today's minutes by the same rollup the server's bar_rollup mirrors:
//   intraday 5/15/30/60: open of its first minute, high / low the max / min, close of its last minute, volume
//     summed (never 1m: a frame carries only closed minutes);
//   D: only when EVERY frame of the day carried the accumulated day volume (its volume is then the vendor's);
//     W / M keep the period in progress only when that forming D bar is in the copy.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { todayFrames } from '../../lib/minuteFrames/codec'
import { createMinuteRollup, bucketOf } from '../../lib/minuteFrames/rollup'
import { createLiveOverlay, prevSessionISO } from './live'
import { createDeviceEngine } from './engine'
import { memoryIO } from './io'
import { deriveFromDaily } from './resample'
import { seedPackOf } from './testing/fixtures'
import { STORED_TFS } from './tfs'
import { DEVICE_FORMING_INTRADAY, DEVICE_FORMING_DAILY } from './forming'

const FORMING_INTRADAY_TFS = ['5', '15', '30', '60']

const fixture = (name) => new Uint8Array(fs.readFileSync(new URL(`../../../../tests/fixtures/minute_frames/${name}`, import.meta.url)))
const DAYFX = JSON.parse(Buffer.from(fixture('day_regular.json')).toString('utf8'))   // 2026-11-18
const PREV = prevSessionISO(DAYFX.day)
const FRAMES = [...todayFrames(fixture('day_regular.today.bin'))]
const SEQ_1132 = (11 * 60 + 32) - 4 * 60                   // the frame of the 11:32 ET minute (seq counts from 04:00)

/** The regular day replayed through the real rollup up to `upto` (the fixture's frames carry no day volume). */
function replay(opts, upto) {
  const overlay = createLiveOverlay(opts)
  const r = createMinuteRollup({ sink: overlay.sink, tfs: [...STORED_TFS] })
  overlay.sink.reset({ day: DAYFX.day })
  for (const f of FRAMES) {
    if (f.seq > upto) break
    r.applyFrame(f)
    overlay.sink.frameDone({ day: DAYFX.day, seq: f.seq, minute: f.minute, withAv: !!f.withAv })
  }
  return overlay
}
const lastRow = (c) => { const i = c.t.length - 1; return [c.t[i], c.o[i], c.h[i], c.l[i], c.c[i], c.v[i]] }

describe('the forming bar, path by path', () => {
  it('ships as the evidence says: INTRADAY on (the default overlay ends 5m with the bucket in progress), DAILY off', () => {
    expect(DEVICE_FORMING_INTRADAY).toBe(true)
    expect(DEVICE_FORMING_DAILY).toBe(false)
    const sym0 = Object.keys(DAYFX.expected)[0]
    expect(replay(undefined, SEQ_1132).read(sym0, '5', PREV).forming).toBe('intraday')
    expect(replay(undefined, SEQ_1132).read(sym0, 'D', PREV).cols).toBeNull()
  })

  it('with the intraday path off, an overlay hands out complete buckets only', () => {
    const sym = Object.keys(DAYFX.expected)[0]
    const r = replay({ formingIntraday: false }, SEQ_1132).read(sym, '5', PREV)
    const through = r.through
    expect(r.forming).toBeUndefined()
    expect(r.cols.t.every((t, i) => bucketOf(t, '5')[1] <= through || i < 0)).toBe(true)
  })

  it('intraday ON: 5/15/30/60 end with the bucket in progress, exactly the rollup of its minutes so far', () => {
    const on = replay({ formingIntraday: true }, SEQ_1132)
    const off = replay({ formingIntraday: false }, SEQ_1132)
    let checked = 0
    for (const sym of Object.keys(DAYFX.expected)) {
      const m1 = off.read(sym, '1', PREV)
      if (!m1?.cols) continue
      for (const tf of FORMING_INTRADAY_TFS) {
        const a = on.read(sym, tf, PREV)
        const b = off.read(sym, tf, PREV)
        const [start] = bucketOf(a.cols.t[a.cols.t.length - 1], tf)
        if (start + 60 > a.through) continue                     // no minute of it closed yet
        expect(a.forming, `${sym} ${tf}`).toBe('intraday')
        expect(a.through).toBe(b.through)
        expect(a.cols.t.length, `${sym} ${tf}: one bar more than the complete ones`).toBe((b.cols?.t.length || 0) + 1)
        // the forming bucket from the 1m bars inside it, up to `through`
        const idx = []
        for (let i = 0; i < m1.cols.t.length; i++) if (m1.cols.t[i] >= start && m1.cols.t[i] < a.through) idx.push(i)
        if (!idx.length) continue
        const want = [start, m1.cols.o[idx[0]], Math.max(...idx.map((i) => m1.cols.h[i])), Math.min(...idx.map((i) => m1.cols.l[i])),
          m1.cols.c[idx[idx.length - 1]], idx.reduce((s, i) => s + m1.cols.v[i], 0)]
        expect(lastRow(a.cols), `${sym} ${tf}`).toEqual(want)
        checked++
      }
    }
    expect(checked, 'the test checked nothing').toBeGreaterThan(8)
  })

  it('never a 1m forming bar: a frame carries only closed minutes', () => {
    const sym = Object.keys(DAYFX.expected)[0]
    const a = replay({ formingIntraday: true }, SEQ_1132).read(sym, '1', PREV)
    const b = replay({ formingIntraday: false }, SEQ_1132).read(sym, '1', PREV)
    expect(a.forming).toBeUndefined()
    expect(Array.from(a.cols.t)).toEqual(Array.from(b.cols.t))
  })

  it('a partial or stale series stays refused, forming or not', () => {
    const o = replay({ formingIntraday: true }, SEQ_1132)
    const sym = Object.keys(DAYFX.expected)[0]
    o.sink.stale(sym, '5')
    expect(o.read(sym, '5', PREV)).toBeNull()
  })

  it('D ON, but the day\'s frames carry no day volume: NOT handed out (fail closed)', () => {
    const o = replay({ formingDaily: true }, SEQ_1132)
    for (const sym of Object.keys(DAYFX.expected)) {
      const r = o.read(sym, 'D', PREV)
      expect(r.forming, sym).toBeUndefined()
      expect(r.cols, sym).toBeNull()                            // mid-session: no complete D bar either
    }
  })

  const dT = Date.UTC(2026, 10, 18) / 1000
  const minute = (hh, mm) => Math.floor(Date.UTC(2026, 10, 18, hh + 5, mm) / 60000)
  const dOverlay = (opts) => {
    const o = createLiveOverlay({ formingDaily: true, ...opts })
    o.sink.reset({ day: '2026-11-18' })
    o.sink.upsert('AAA', 'D', { t: dT, o: 10, h: 11, l: 9.5, c: 10.5, v: 1234567 }, false)
    return o
  }

  it('D ON with the day volume in every frame: today\'s bar, its volume the vendor\'s accumulated one', () => {
    const o = dOverlay()
    o.sink.frameDone({ day: '2026-11-18', seq: 450, minute: minute(11, 30), withAv: true })
    const r = o.read('AAA', 'D', '2026-11-17')
    expect(r.forming).toBe('D')
    expect(lastRow(r.cols)).toEqual([dT, 10, 11, 9.5, 10.5, 1234567])
  })

  it('D: one frame of the day without the day volume refuses it for the rest of the day; a new day starts clean', () => {
    const o = dOverlay()
    o.sink.frameDone({ day: '2026-11-18', seq: 450, minute: minute(11, 30), withAv: true })
    o.sink.frameDone({ day: '2026-11-18', seq: 451, minute: minute(11, 31) })              // says nothing: no av
    o.sink.frameDone({ day: '2026-11-18', seq: 452, minute: minute(11, 32), withAv: true })
    expect(o.read('AAA', 'D', '2026-11-17').cols).toBeNull()
    o.sink.reset({ day: '2026-11-18' })
    o.sink.upsert('AAA', 'D', { t: dT, o: 10, h: 11, l: 9.5, c: 10.5, v: 99 }, false)
    o.sink.frameDone({ day: '2026-11-18', seq: 453, minute: minute(11, 33), withAv: true })
    expect(o.read('AAA', 'D', '2026-11-17').forming).toBe('D')
  })

  it('D: a forming bar with no volume yet is not handed out', () => {
    const o = createLiveOverlay({ formingDaily: true })
    o.sink.reset({ day: '2026-11-18' })
    o.sink.upsert('AAA', 'D', { t: dT, o: 10, h: 11, l: 9.5, c: 10.5, v: 0 }, false)
    o.sink.frameDone({ day: '2026-11-18', seq: 450, minute: minute(11, 30), withAv: true })
    expect(o.read('AAA', 'D', '2026-11-17').cols).toBeNull()
  })

  it('D OFF (the default) with the day volume present: not handed out', () => {
    const o = dOverlay({ formingDaily: false })
    o.sink.frameDone({ day: '2026-11-18', seq: 450, minute: minute(11, 30), withAv: true })
    expect(o.read('AAA', 'D', '2026-11-17').cols).toBeNull()
  })
})

describe('W / M: the period in progress, only beside today\'s forming D bar', () => {
  const days = (labels) => {
    const t = labels.map((s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 1000)
    const n = t.length
    const col = (f) => Float64Array.from({ length: n }, (_, i) => f(i))
    return { t: Float64Array.from(t), o: col((i) => 10 + i), h: col((i) => 12 + i), l: col((i) => 9 + i), c: col((i) => 11 + i), v: col((i) => 100 + i) }
  }
  // Mon 11-02 .. Wed 11-18 (sessions): the last week (Mon 11-16 .. Wed 11-18) is in progress on 11-18
  const D = days(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11',
    '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18'])
  const MID = Date.UTC(2026, 10, 18, 17, 0) / 1000           // 12:00 ET on Wednesday

  it('without it, the week in progress is dropped (as before)', () => {
    const w = deriveFromDaily(D, 'W', { through: MID })
    expect(new Date(w.t[w.t.length - 1] * 1000).toISOString().slice(0, 10)).toBe('2026-11-13')
  })

  it('with it, the week in progress is kept, built from every day of it so far', () => {
    const w = deriveFromDaily(D, 'W', { through: MID, forming: true })
    const i = w.t.length - 1
    expect(new Date(w.t[i] * 1000).toISOString().slice(0, 10)).toBe('2026-11-20')   // the ISO-Friday label
    expect([w.o[i], w.h[i], w.l[i], w.c[i], w.v[i]]).toEqual([20, 24, 19, 23, 110 + 111 + 112])
  })
})

describe('the engine: a forming bar joins the seed, and W follows D', () => {
  const SYM = 'AAA'
  const sha = (b) => createHash('sha256').update(b).digest('hex')
  const seedRows = () => {
    const days = []
    for (let d = new Date(Date.UTC(2026, 10, 17)); days.length < 40; d.setUTCDate(d.getUTCDate() - 1)) {
      const wd = d.getUTCDay()
      if (wd !== 0 && wd !== 6 && d.toISOString().slice(0, 10) !== '2026-11-11') days.unshift(d.getTime() / 1000)
    }
    return days.map((t, i) => ({ t, o: 90 + i, h: 91 + i, l: 89 + i, c: 90.5 + i, v: 5e6 + i }))
  }
  async function engineAt({ withAv }) {
    const disk = new Map()
    const pack = seedPackOf({ [SYM]: seedRows() }, { tf: 'D', asof: '2026-11-17', build: 'b1' })
    const eng = createDeviceEngine({ io: memoryIO(disk), fetchFn: async () => new Response(pack), now: () => Date.UTC(2026, 10, 18, 17, 0) })
    await eng.ingest({ tf: 'D', url: 'D', bytes: pack.length, sha256: sha(pack), build: 'b1' })
    await eng.setSplits({ splits: { session: '2026-11-18', symbols: {} } })
    const overlay = createLiveOverlay({ formingDaily: true })
    eng.attachLive(overlay)
    overlay.sink.reset({ day: '2026-11-18' })
    overlay.sink.upsert(SYM, 'D', { t: Date.UTC(2026, 10, 18) / 1000, o: 140, h: 142, l: 139, c: 141.5, v: 7777777 }, false)
    overlay.sink.frameDone({ day: '2026-11-18', seq: 480, minute: Math.floor(Date.UTC(2026, 10, 18, 17, 0) / 60000), ...(withAv ? { withAv: true } : {}) })
    return eng
  }

  it('D ends with today\'s forming bar, said so; W ends with the week in progress', async () => {
    const eng = await engineAt({ withAv: true })
    const d = eng.read(SYM, 'D')
    expect(d.forming).toBe('D')
    expect(lastRow(d)).toEqual([Date.UTC(2026, 10, 18) / 1000, 140, 142, 139, 141.5, 7777777])
    const w = eng.read(SYM, 'W')
    expect(w.forming).toBe('D')
    expect(new Date(w.t[w.t.length - 1] * 1000).toISOString().slice(0, 10)).toBe('2026-11-20')
    expect(w.c[w.t.length - 1]).toBe(141.5)                    // the week's close is today's forming close
  })

  it('no day volume in the frames: D without today, and W without the week in progress (fail closed)', async () => {
    const eng = await engineAt({ withAv: false })
    const d = eng.read(SYM, 'D')
    expect(d.forming).toBeUndefined()
    expect(new Date(d.t[d.t.length - 1] * 1000).toISOString().slice(0, 10)).toBe('2026-11-17')
    const w = eng.read(SYM, 'W')
    expect(w.forming).toBeUndefined()
    expect(new Date(w.t[w.t.length - 1] * 1000).toISOString().slice(0, 10)).toBe('2026-11-13')
  })
})
