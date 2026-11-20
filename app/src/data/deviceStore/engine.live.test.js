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

async function engineWithToday({ asof = '2026-11-17' } = {}) {
  const { m5, D } = seedRows()
  const disk = new Map()
  const packs = { '5': seedPackOf({ [SYM]: m5 }, { tf: '5', asof, build: 'b1' }), D: seedPackOf({ [SYM]: D }, { tf: 'D', asof, build: 'b1' }) }
  const eng = createDeviceEngine({ io: memoryIO(disk), fetchFn: async (u) => new Response(packs[u]) })
  for (const tf of ['5', 'D']) await eng.ingest({ tf, url: tf, bytes: packs[tf].length, sha256: sha(packs[tf]), build: 'b1' })
  const overlay = createLiveOverlay({ nameOf: (s) => eng.seedName(s) })
  eng.attachLive(overlay)
  const r = createMinuteRollup({ sink: overlay.sink, tfs: [...STORED_TFS] })
  overlay.sink.reset({ day: DAY.day })
  for (const f of todayFrames(fixture('day_regular.today.bin'))) r.applyFrame(f)
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

  it('D ends with today; W derived from it ends with this week', async () => {
    const { eng, D } = await engineWithToday()
    const d = eng.read(SYM, 'D')
    expect(d.t.length).toBe(D.length + 1)
    expect(new Date(d.t.at(-1) * 1000).toISOString().slice(0, 10)).toBe(DAY.day)
    expect(d.c.at(-1)).toBe(DAY.expected[SYM].D[0][4])
    const w = eng.read(SYM, 'W')
    expect(new Date(w.t.at(-1) * 1000).toISOString().slice(0, 10)).toBe('2026-11-20')   // the week's Friday
    expect(w.c.at(-1)).toBe(DAY.expected[SYM].D[0][4])
  })

  it('a seed that does not end the session before today gets no overlay (never a missing session)', async () => {
    const { eng, m5 } = await engineWithToday({ asof: '2026-11-16' })
    expect(eng.read(SYM, '5').t.length).toBe(m5.length)
  })

  it("an overlay bar at or before the seed's last one is never appended twice", async () => {
    const { eng, m5 } = await engineWithToday()
    const lastT = m5.at(-1).t
    const col = (xs) => Float64Array.from(xs)
    eng.attachLive({ read: () => ({ t: col([lastT, lastT + 86400]), o: col([1, 2]), h: col([1, 2]), l: col([1, 2]), c: col([1, 2]), v: col([1, 2]) }) })
    const got = eng.read(SYM, '5')
    expect(got.t.length).toBe(m5.length + 1)
    expect(got.c.at(-2)).toBe(m5.at(-1).c)                                // the seed's own last bar kept
    expect(got.t.at(-1)).toBe(lastT + 86400)
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
})
