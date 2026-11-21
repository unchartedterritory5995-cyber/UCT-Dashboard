// @vitest-environment node
// The engine's read = the seed's window (last closed session) + TODAY from the live overlay, joined
// across exactly one night; W/M derived from the joined D. And the live feed's life cycle: lazy load,
// re-sync only on gaps this device caused (bounded), visibility from the tabs' reports.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { todayFrames } from '../../lib/minuteFrames/codec'
import { createMinuteRollup } from '../../lib/minuteFrames/rollup'
import { isRthBar } from '../../components/chart/barTime'
import { createDeviceEngine } from './engine'
import { memoryIO } from './io'
import { createLiveOverlay } from './live'
import { createLiveFeed, RESYNC_MIN_MS, VISIBLE_FRESH_MS } from './liveFeed'
import { seedPackOf } from './testing/fixtures'
import { STORED_TFS } from './tfs'

const fixture = (name) => new Uint8Array(fs.readFileSync(new URL(`../../../../tests/fixtures/minute_frames/${name}`, import.meta.url)))
const DAY = JSON.parse(Buffer.from(fixture('day_regular.json')).toString('utf8'))   // 2026-11-18
const SYM = Object.keys(DAY.expected)[0]
const sha = (b) => createHash('sha256').update(b).digest('hex')

/** Yesterday's (2026-11-17) regular session of 5m bars, and 40 sessions of D ending 2026-11-17. */
function seedRows() {
  const open = Date.UTC(2026, 10, 17, 14, 30) / 1000
  const m5 = Array.from({ length: 78 }, (_, i) => ({ t: open + i * 300, o: 99, h: 99.5, l: 98.5, c: 99.25, v: 1000 + i }))
  const days = []
  for (let d = new Date(Date.UTC(2026, 10, 17)); days.length < 40; d.setUTCDate(d.getUTCDate() - 1)) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6 && d.toISOString().slice(0, 10) !== '2026-11-11') days.unshift(d.getTime() / 1000)
  }
  const D = days.map((t, i) => ({ t, o: 90 + i * 0.25, h: 91 + i * 0.25, l: 89 + i * 0.25, c: 90.5 + i * 0.25, v: 5e6 + i }))
  return { m5, D }
}

/** 20:30 ET on 2026-11-18, after the replayed day's last frame. */
const AFTER_DAY = Date.UTC(2026, 10, 19, 1, 30)
async function engineWithToday({ asof = '2026-11-17', nowMs = AFTER_DAY, splits = { session: '2026-11-18', symbols: {} }, seedBars = null } = {}) {
  const { m5: whole, D } = seedRows()
  const m5 = seedBars == null ? whole : whole.slice(0, seedBars)   // (a seed whose rows stop early: seedBars < 78)
  const disk = new Map()
  const packs = { '5': seedPackOf({ [SYM]: m5 }, { tf: '5', asof, build: 'b1' }), D: seedPackOf({ [SYM]: D }, { tf: 'D', asof, build: 'b1' }) }
  const eng = createDeviceEngine({ io: memoryIO(disk), fetchFn: async (u) => new Response(packs[u]), now: () => nowMs })
  for (const tf of ['5', 'D']) await eng.ingest({ tf, url: tf, bytes: packs[tf].length, sha256: sha(packs[tf]), build: 'b1' })
  // the manifest's split list for the session after the seed's as-of day (none split)
  if (splits) await eng.setSplits({ splits })
  const overlay = createLiveOverlay({ nameOf: (s) => eng.seedName(s) })
  eng.attachLive(overlay)
  const r = createMinuteRollup({ sink: overlay.sink, tfs: [...STORED_TFS] })
  overlay.sink.reset({ day: DAY.day })
  for (const f of todayFrames(fixture('day_regular.today.bin'))) {
    r.applyFrame(f)
    overlay.sink.frameDone({ day: DAY.day, seq: f.seq, minute: f.minute })
  }
  return { eng, overlay, m5, D }
}

describe('engine read with today', () => {
  it('5m: the seed window, then today\'s regular-session buckets (the server\'s), in order', async () => {
    const { eng, m5 } = await engineWithToday()
    const got = eng.read(SYM, '5')
    const today = DAY.expected[SYM]['5'].filter((b) => isRthBar(b[0]))
    expect(got.t.length).toBe(m5.length + today.length)
    expect(Array.from(got.t.subarray(0, m5.length))).toEqual(m5.map((b) => b.t))
    const tail = Array.from(got.t.subarray(m5.length), (t, i) => [t, got.o[m5.length + i], got.h[m5.length + i], got.l[m5.length + i], got.c[m5.length + i], got.v[m5.length + i]])
    expect(tail).toEqual(today)
  })

  it('D ends with today (whole after 20:00); W ends with the LAST COMPLETE week, not this one', async () => {
    const { eng, D } = await engineWithToday()
    const d = eng.read(SYM, 'D')
    expect(d.t.length).toBe(D.length + 1)
    expect(new Date(d.t.at(-1) * 1000).toISOString().slice(0, 10)).toBe(DAY.day)
    expect(d.c.at(-1)).toBe(DAY.expected[SYM].D[0][4])
    expect(d.through).toBe(Math.floor(Date.UTC(2026, 10, 19, 1, 0) / 1000))   // the 20:00 frame
    const w = eng.read(SYM, 'W')
    expect(new Date(w.t.at(-1) * 1000).toISOString().slice(0, 10)).toBe('2026-11-13')   // this week is not over
    expect(w.through).toBe(d.through)
  })

  it('the seed alone is complete through the end of its as-of day; a split list is not needed that day', async () => {
    const { eng, m5 } = await engineWithToday({ asof: '2026-11-17', nowMs: Date.UTC(2026, 10, 18, 2, 0), splits: null })
    eng.attachLive(null)                                                  // the evening of the as-of day: no overlay
    const got = eng.read(SYM, '5')                                        // 21:00 ET on the as-of day
    expect(got.t.length).toBe(m5.length)
    expect(got.through).toBe(Date.UTC(2026, 10, 18) / 1000)
  })

  // The published builds of 2026-11-20 and 2026-11-21: 99.8% of the 30m rows (60m, 15m alike) stopped hours before the close of
  // the as-of day. Such a copy is not complete through its as-of day, and today must never be joined to it.
  // ⛔ ...AND ITS LAST ROW IS NEVER HANDED OUT (review of #2407): that row was caught while its bucket was forming
  // (A, 30m 10:00 ET: L 173.76 C 174.29 V 43,567 in the file, 172.23 / 172.34 / 84,444 from its minutes), and in the
  // store an incoming local row replaces a held one, so it would overwrite a complete bucket the lake or the pack holds.
  it("A SEED THAT STOPS BEFORE ITS AS-OF SESSION'S LAST BUCKET: its last row dropped, stamped where that row starts, today never appended", async () => {
    const { eng, m5 } = await engineWithToday({ seedBars: 8 })           // yesterday's 09:30 ... 10:05 only
    expect(eng.why(SYM, '5')).toBe('seed-short')
    const got = eng.read(SYM, '5')
    expect(got.t.length).toBe(7)                                          // the 10:05 row is not handed out; today not joined
    expect(got.t.at(-1)).toBe(m5[6].t)
    expect(got.c.at(-1)).toBe(m5[6].c)
    expect(got.through).toBe(m5[7].t)                                     // complete, at most, to where the dropped row starts
    expect(eng.why(SYM, 'D')).toBe('ok')                                  // D is one bar a day: never short
    // the boundary: the bucket before the session's last (15:50) is short, the last one (15:55) is whole
    const near = await engineWithToday({ seedBars: 77 })
    expect(near.eng.why(SYM, '5')).toBe('seed-short')
    expect(near.eng.read(SYM, '5').t.length).toBe(76)
    const whole = await engineWithToday({ seedBars: 78 })
    expect(whole.eng.why(SYM, '5')).toBe('ok')
    expect(whole.eng.read(SYM, '5').t.length).toBeGreaterThan(78)         // today joined
    // one row only, and it is the short one: nothing to hand out
    const one = await engineWithToday({ seedBars: 1 })
    expect(one.eng.why(SYM, '5')).toBe('seed-short')
    expect(one.eng.read(SYM, '5')).toBeNull()
  })

  it("THE SPLIT GUARD: past its as-of day a copy needs the next session's split list, without the symbol", async () => {
    expect((await engineWithToday()).eng.read(SYM, '5')).not.toBeNull()
    const named = await engineWithToday({ splits: { session: '2026-11-18', symbols: { [SYM]: 4 } } })
    expect(named.eng.read(SYM, '5')).toBeNull()                           // it splits today: no device copy
    expect(named.eng.read(SYM, 'D')).toBeNull()
    const other = await engineWithToday({ splits: { session: '2026-11-19', symbols: {} } })
    expect(other.eng.read(SYM, '5')).toBeNull()                           // a list for another session proves nothing
    const none = await engineWithToday({ splits: null })
    expect(none.eng.read(SYM, '5')).toBeNull()                            // no list: fail closed
  })

  it('a seed two sessions old is not used at all (never a missing session)', async () => {
    const { eng } = await engineWithToday({ asof: '2026-11-16', splits: { session: '2026-11-17', symbols: {} } })
    expect(eng.read(SYM, '5')).toBeNull()
  })

  it("an overlay bar at or before the seed's last one is never appended twice", async () => {
    const { eng, m5 } = await engineWithToday()
    const lastT = m5.at(-1).t
    const col = (xs) => Float64Array.from(xs)
    eng.attachLive({ read: () => ({ through: lastT + 86400 + 300, cols: { t: col([lastT, lastT + 86400]), o: col([1, 2]), h: col([1, 2]), l: col([1, 2]), c: col([1, 2]), v: col([1, 2]) } }) })
    const got = eng.read(SYM, '5')
    expect(got.t.length).toBe(m5.length + 1)
    expect(got.c.at(-2)).toBe(m5.at(-1).c)                                // the seed's own last bar kept
    expect(got.t.at(-1)).toBe(lastT + 86400)
  })

  it('why() names the rule behind every read() answer: ok, missing, no-file, split, seed-only', async () => {
    const { eng, overlay } = await engineWithToday()
    expect(eng.why(SYM, '5')).toBe('ok')
    expect(eng.why(SYM, 'W')).toBe(eng.why(SYM, 'D'))                    // a derived tf answers as its source
    expect(eng.why('NOPE', '5')).toBe('missing')
    expect(eng.read('NOPE', '5')).toBeNull()
    expect(eng.why(SYM, '60')).toBe('no-file')                           // that timeframe is not held
    const t = Math.floor(Date.UTC(2026, 10, 18, 15, 0) / 60000)
    overlay.sink.gap({ fromMinute: t, toMinute: t })
    expect(eng.why(SYM, '5')).toBe('seed-only:gap')                       // the seed alone: today refused
    eng.attachLive(null)
    expect(eng.why(SYM, '5')).toBe('seed-only:no-overlay')
    for (const splits of [{ session: '2026-11-18', symbols: { [SYM]: 4 } }, null]) {
      const g = await engineWithToday({ splits })
      expect(g.eng.why(SYM, '5')).toBe('split')
      expect(g.eng.read(SYM, '5')).toBeNull()
    }
  })

  it('detached (or no overlay): the seed alone, as before', async () => {
    const { eng, m5 } = await engineWithToday()
    eng.attachLive(null)
    expect(eng.read(SYM, '5').t.length).toBe(m5.length)
  })
})

function fakeConsumers() {
  const made = []
  return {
    made,
    load: vi.fn(async () => ({
      createMinuteFrameConsumer: (opts) => {
        const c = { opts, start: vi.fn(), stop: vi.fn(), syncNow: vi.fn(async () => ({})), status: () => ({}) }
        made.push(c)
        return c
      },
    })),
  }
}

describe('the live feed', () => {
  it('loads the consumer lazily, once; re-syncs only on gaps THIS device caused, bounded', async () => {
    let t = Date.UTC(2026, 10, 18, 16, 0)
    const fc = fakeConsumers()
    const overlay = createLiveOverlay()
    const feed = createLiveFeed({ overlay, load: fc.load, now: () => t })
    expect(fc.load).not.toHaveBeenCalled()
    await Promise.all([feed.start(), feed.start()])
    expect(fc.load).toHaveBeenCalledTimes(1)
    expect(fc.made).toHaveLength(1)
    expect(fc.made[0].start).toHaveBeenCalledTimes(1)
    expect(fc.made[0].opts.rollup.tfs).toEqual([...STORED_TFS])
    const sink = fc.made[0].opts.sink
    sink.gap({ fromMinute: 1, toMinute: 2, reason: 'not-published' })   // the publisher's: re-reading cannot help
    await Promise.resolve(); await Promise.resolve()
    expect(fc.made).toHaveLength(1)
    sink.gap({ fromMinute: 1, toMinute: 2, reason: 'not-received' })    // this device missed frames: start over
    await Promise.resolve(); await Promise.resolve()
    expect(fc.made).toHaveLength(2)
    expect(fc.made[0].stop).toHaveBeenCalled()
    expect(fc.made[1].start).toHaveBeenCalled()
    fc.made[1].opts.sink.gap({ fromMinute: 3, toMinute: 3, reason: 'link-mismatch' })
    await Promise.resolve(); await Promise.resolve()
    expect(fc.made).toHaveLength(2)                                       // too soon after the last one
    t += RESYNC_MIN_MS
    expect(feed.resync('again')).toBe(true)
    expect(fc.made).toHaveLength(3)
    expect(feed.resync('soon')).toBe(false)                              // inside the bound...
    expect(feed.resync('seed', { force: true })).toBe(true)              // ...but a new seed always replays
    expect(fc.made).toHaveLength(4)
  })

  it('visible while a tab reported visible recently; coming back catches up at once', async () => {
    let t = 1_000_000
    const fc = fakeConsumers()
    const feed = createLiveFeed({ overlay: createLiveOverlay(), load: fc.load, now: () => t })
    await feed.start()
    const isVisible = fc.made[0].opts.isVisible
    expect(isVisible()).toBe(false)                                        // no tab has said so
    feed.visible(true)
    expect(isVisible()).toBe(true)
    expect(fc.made[0].syncNow).toHaveBeenCalledTimes(1)                    // hidden -> visible: catch up
    feed.visible(true)
    expect(fc.made[0].syncNow).toHaveBeenCalledTimes(1)                    // a heartbeat while visible: nothing
    t += VISIBLE_FRESH_MS + 1
    expect(isVisible()).toBe(false)                                        // the tabs went quiet
    feed.visible(false)
    expect(isVisible()).toBe(false)
    feed.visible(true)
    expect(fc.made[0].syncNow).toHaveBeenCalledTimes(2)
  })
  it('a replaced (or stopped) consumer writes NOTHING more: its catch-up may still be running', async () => {
    let t = Date.UTC(2026, 10, 18, 16, 0)
    const fc = fakeConsumers()
    const overlay = createLiveOverlay()
    const feed = createLiveFeed({ overlay, load: fc.load, now: () => t, accept: (sym) => sym === 'AAA' })
    await feed.start()
    expect(fc.made[0].opts.rollup.accept('AAA')).toBe(true)              // the rollup holds the seed's symbols only
    expect(fc.made[0].opts.rollup.accept('ZZZ')).toBe(false)
    const oldSink = fc.made[0].opts.sink
    const bar = { t: Math.floor(Date.UTC(2026, 10, 18, 15, 0) / 1000), o: 1, h: 1, l: 1, c: 1, v: 1 }
    feed.resync('test')
    const newSink = fc.made[1].opts.sink
    newSink.reset({ day: '2026-11-18' })
    oldSink.upsert('AAA', '5', bar, true)                                // the old catch-up, still landing
    oldSink.frameDone({ day: '2026-11-18', minute: bar.t / 60 + 10 })
    expect(overlay.state().series).toBe(0)
    expect(overlay.state().lastMinute).toBe(null)
    newSink.upsert('AAA', '5', bar, true)
    expect(overlay.state().series).toBe(1)
    feed.stop()
    newSink.upsert('AAA', '1', bar, true)                                // stopped: nothing either
    expect(overlay.state().series).toBe(1)
  })
})
