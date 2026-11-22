// @vitest-environment node
// CATCH-UP AND GAPS. A fake edge serves the publisher's real frames for one session (the regular
// day fixture): head.json, the minute files and a today.bin rolled at a chosen seq. A device that
// opens mid-session, or comes back after a sleep, must end in EXACTLY the state of a device that
// was live all day; minutes that cannot be had (never published, never received, or published
// INCOMPLETE) must reach the sink as gaps, with every bucket spanning them marked partial.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import zlib from 'node:zlib'
import { crc32, hhmmOfSeq, decodeFrame, FLAG_INCOMPLETE } from './codec'
import { createMinuteFrameConsumer, DEFAULT_BASE } from './consumer'
import { createMemorySink } from './memorySink'

const DAY = '2026-11-18'
const raw = new Uint8Array(fs.readFileSync(new URL('../../../../tests/fixtures/minute_frames/day_regular.today.bin', import.meta.url)))
const u32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)) + b[p + 3] * 16777216
const putU32 = (b, p, v) => { b[p] = v & 255; b[p + 1] = (v >>> 8) & 255; b[p + 2] = (v >>> 16) & 255; b[p + 3] = (v >>> 24) & 255 }

/** The day's frames as published: seq -> raw bytes. */
const FRAMES = (() => {
  const out = []
  let pos = 16
  while (pos < raw.length - 12) {
    const len = u32(raw, pos)
    out.push(raw.slice(pos + 4, pos + 4 + len))
    pos += 4 + len
  }
  return out
})()

/** A frame with its prevSeq / flags rewritten (and its CRC recomputed): what a publisher with a
 *  hole, or with a socket outage, would have written. */
function rewrite(frame, { prevSeq, incomplete } = {}) {
  const f = frame.slice()
  if (prevSeq != null) putU32(f, 16, prevSeq)
  if (incomplete) f[5] |= FLAG_INCOMPLETE
  putU32(f, f.length - 4, crc32(f, 0, f.length - 4))
  return f
}

/** today.bin holding exactly `frames` (the publisher's container, trailer last). */
function todayOf(frames) {
  const body = frames.reduce((n, f) => n + 4 + f.length, 0)
  const out = new Uint8Array(16 + body + 12)
  out.set(raw.subarray(0, 16))
  let pos = 16
  for (const f of frames) { putU32(out, pos, f.length); out.set(f, pos + 4); pos += 4 + f.length }
  putU32(out, pos, frames.length)
  putU32(out, pos + 4, decodeFrame(frames[frames.length - 1]).seq)
  putU32(out, pos + 8, crc32(out, 0, pos + 8))
  return out
}

/** ms of an ET wall-clock time on DAY (EST in November: UTC-5). */
const at = (hh, mm, ss = 0) => Date.UTC(2026, 10, 18, hh + 5, mm, ss)

function edge({ through, rolled, frames = FRAMES, missing = [], gzip = false } = {}) {
  const asked = []
  const fetchImpl = async (url) => {
    asked.push(url)
    const path = url.slice(DEFAULT_BASE.length + 1)
    const [d, file] = path.split('/')
    const no = () => new Response('{"error":"not_published"}', { status: 404 })
    if (d !== DAY) return no()
    if (file === 'head.json') return new Response(JSON.stringify({ day: 20261118, seq: through, today_seq: rolled }))
    if (file === 'today.bin') {
      if (rolled == null) return no()
      return new Response(todayOf(frames.slice(0, rolled + 1).filter((_, s) => !missing.includes(s))))
    }
    const seq = frames.findIndex((_, s) => `${hhmmOfSeq(s)}.bin` === file)
    if (seq < 0 || seq > through || missing.includes(seq)) return no()
    const body = gzip ? new Uint8Array(zlib.gzipSync(frames[seq])) : frames[seq]
    return new Response(body)
  }
  return { fetchImpl, asked }
}

function device(fetchImpl, nowMs, extra = {}) {
  const sink = createMemorySink()
  const clock = { ms: nowMs }
  const c = createMinuteFrameConsumer({
    sink, fetchImpl, now: () => clock.ms, isVisible: () => true,
    setTimer: () => 0, clearTimer: () => {}, random: () => 0, ...extra,
  })
  return { sink, c, clock }
}

/** A device that applied frames 0..upTo live, one by one. */
function liveDevice(upTo) {
  const d = device(edge({ through: upTo }).fetchImpl, at(14, 0, 8))
  d.c.status()                                  // nothing applied yet
  for (let s = 0; s <= upTo; s++) d.c.applyFrame(decodeFrame(FRAMES[s]))
  return d
}

const snapshot = (sink) => Object.fromEntries(sink.keys().sort().map((k) => {
  const [sym, tf] = k.split('|')
  return [k, sink.series(sym, tf)]
}))

describe('catch-up ends where a device that was live all day is', () => {
  const LIVE = liveDevice(599)                   // 04:00 .. 13:59

  it('cold open at 14:00: today.bin (rolled 13:54) + the five minute files after it', async () => {
    const e = edge({ through: 599, rolled: 594, gzip: true })
    const d = device(e.fetchImpl, at(14, 0, 8))
    expect(await d.c.syncNow()).toEqual({ current: true })
    expect(snapshot(d.sink)).toEqual(snapshot(LIVE.sink))
    expect(d.c.status().lastSeq).toBe(599)
    expect(d.c.status().gaps).toEqual([])
    expect(e.asked.filter((u) => u.endsWith('.bin')).map((u) => u.split('/').pop()))
      .toEqual(['today.bin', '1355.bin', '1356.bin', '1357.bin', '1358.bin', '1359.bin'])
  })

  it('⭐ (2026-11-21) the today.bin replay gives the thread back every sliceMs of work, and ends in the same state', async () => {
    const e = edge({ through: 599, rolled: 594 })
    let ms = 0
    let yields = 0
    let appliedAtYield = []
    const d = device(e.fetchImpl, at(14, 0, 8), {
      sliceMs: 5, elapsed: () => (ms += 1),
      yieldTo: () => { yields++; appliedAtYield.push(d.c.status().lastSeq); return Promise.resolve() },
    })
    expect(await d.c.syncNow()).toEqual({ current: true })
    expect(snapshot(d.sink)).toEqual(snapshot(LIVE.sink))
    expect(yields).toBeGreaterThan(50)                       // ~595 frames, a slice every few
    expect(yields).toBeLessThan(200)                         // ...never a yield per frame (a slice is sliceMs of work)
    expect(new Set(appliedAtYield).size).toBe(appliedAtYield.length)   // each yield is at a new minute
    expect(Math.max(...appliedAtYield)).toBeLessThanOrEqual(594)   // all inside the replay (rolled at 594)
    expect(Math.min(...appliedAtYield)).toBeLessThan(20)           // from its first slices on
  })

  it('back after a long sleep (09:00 -> 14:00): one today.bin, then minute files, same state', async () => {
    const e = edge({ through: 599, rolled: 594 })
    const d = device(e.fetchImpl, at(9, 1, 8))
    for (let s = 0; s <= 300; s++) d.c.applyFrame(decodeFrame(FRAMES[s]))
    d.clock.ms = at(14, 0, 8)
    await d.c.syncNow()
    expect(snapshot(d.sink)).toEqual(snapshot(LIVE.sink))
    expect(e.asked.filter((u) => u.endsWith('today.bin')).length).toBe(1)
    expect(d.c.status().gaps).toEqual([])
  })

  it('a short absence fetches only the minutes it missed (no today.bin)', async () => {
    const e = edge({ through: 599, rolled: 594 })
    const d = device(e.fetchImpl, at(14, 0, 8))
    for (let s = 0; s <= 590; s++) d.c.applyFrame(decodeFrame(FRAMES[s]))
    await d.c.syncNow()
    expect(snapshot(d.sink)).toEqual(snapshot(LIVE.sink))
    expect(e.asked.some((u) => u.endsWith('today.bin'))).toBe(false)
    expect(e.asked.filter((u) => u.endsWith('.bin')).length).toBe(9)
  })

  it('steady state asks for the next minute only, once it is due, with no head read', async () => {
    const e = edge({ through: 600, rolled: 594 })
    const d = device(e.fetchImpl, at(14, 0, 8))
    for (let s = 0; s <= 599; s++) d.c.applyFrame(decodeFrame(FRAMES[s]))
    d.clock.ms = at(14, 1, 6)                    // 14:00's frame is not due yet (end + 7 s)
    expect(await d.c._step()).toEqual({ current: true })
    expect(e.asked).toEqual([])
    d.clock.ms = at(14, 1, 8)
    await d.c._step()
    expect(e.asked).toEqual([`${DEFAULT_BASE}/${DAY}/1400.bin`])
    expect(d.c.status().lastSeq).toBe(600)
  })
})

describe('sequence gaps are detected and reach the sink', () => {
  it('minutes the publisher never wrote (its next frame links past them): not-published', async () => {
    const frames = FRAMES.slice()
    frames[597] = rewrite(FRAMES[597], { prevSeq: 594 })
    const e = edge({ through: 599, frames, missing: [595, 596] })
    const d = device(e.fetchImpl, at(14, 0, 8))
    for (let s = 0; s <= 594; s++) d.c.applyFrame(decodeFrame(FRAMES[s]))
    await d.c.syncNow()
    const g = d.c.status().gaps
    expect(g).toEqual([{ day: DAY, fromSeq: 595, toSeq: 596, reason: 'not-published' }])
    expect(d.sink.gaps.map((x) => [x.fromSeq, x.toSeq, x.reason])).toEqual([[595, 596, 'not-published']])
    expect(d.c.status().lastSeq).toBe(599)
    // the session-grid 60m bucket holding 13:55-13:56 (13:30-14:30) is partial
    const h = d.sink.series('DENSE', '60').at(-1)
    expect(h.partial).toBe(true)
  })

  it('a frame that was published but never arrived: not-received', async () => {
    const e = edge({ through: 599, missing: [596] })            // 597 still links to 596
    const d = device(e.fetchImpl, at(14, 0, 8))
    for (let s = 0; s <= 594; s++) d.c.applyFrame(decodeFrame(FRAMES[s]))
    await d.c.syncNow()
    expect(d.c.status().gaps.map((x) => [x.fromSeq, x.toSeq, x.reason])).toEqual([[596, 596, 'not-received']])
  })

  it('a frame the publisher marked INCOMPLETE (socket down) is a gap too', async () => {
    const frames = FRAMES.slice()
    frames[598] = rewrite(FRAMES[598], { incomplete: true })
    const e = edge({ through: 599, frames })
    const d = device(e.fetchImpl, at(14, 0, 8))
    for (let s = 0; s <= 594; s++) d.c.applyFrame(decodeFrame(FRAMES[s]))
    await d.c.syncNow()
    expect(d.c.status().gaps.map((x) => [x.fromSeq, x.toSeq, x.reason])).toEqual([[598, 598, 'incomplete']])
  })

  it('a frame whose prevSeq disagrees with what this device holds: link-mismatch', () => {
    const d = device(edge({ through: 599 }).fetchImpl, at(14, 0, 8))
    for (let s = 0; s <= 594; s++) d.c.applyFrame(decodeFrame(FRAMES[s]))
    d.c.applyFrame(decodeFrame(rewrite(FRAMES[595], { prevSeq: 590 })))
    expect(d.c.status().gaps.map((x) => [x.fromSeq, x.toSeq, x.reason])).toEqual([[591, 594, 'link-mismatch']])
  })

  it('each frame tells the sink whether it carried the day volume (withAv), for the device\'s forming D bar', () => {
    const d = liveDevice(3)
    expect(d.sink.frames.length).toBe(4)
    expect(d.sink.frames.every((f) => f.withAv === false)).toBe(true)          // the regular day: no av
    const av = decodeFrame(new Uint8Array(fs.readFileSync(new URL('../../../../tests/fixtures/minute_frames/codec_with_av.bin', import.meta.url))))
    expect(av.withAv).toBe(true)
    const e = device(edge({ through: 0 }).fetchImpl, at(14, 0, 8))
    e.c.applyFrame(av)
    expect(e.sink.frames.at(-1).withAv).toBe(true)
  })

  it('a device that starts after the day\'s first frame records what came before as a gap', async () => {
    const e = edge({ through: 599 })                                 // no today.bin yet
    const d = device(e.fetchImpl, at(14, 0, 8), { maxMinuteFetches: 5 })
    await d.c.syncNow()
    expect(d.c.status().gaps.map((x) => [x.fromSeq, x.toSeq, x.reason])).toEqual([[0, 594, 'not-received']])
    expect(d.c.status().lastSeq).toBe(599)
  })

  it('the steady state retries a minute that is not out yet, and never applies out of order', async () => {
    const e = edge({ through: 599 })
    const d = device(e.fetchImpl, at(14, 0, 8))
    for (let s = 0; s <= 599; s++) d.c.applyFrame(decodeFrame(FRAMES[s]))
    d.clock.ms = at(14, 1, 8)
    expect(await d.c._step()).toEqual({ retry: true })
    expect(d.c.status().lastSeq).toBe(599)
    expect(d.c.status().gaps).toEqual([])
  })
})

describe('polls respect visibility', () => {
  it('a hidden app fetches nothing', async () => {
    const e = edge({ through: 599, rolled: 594 })
    let fire = null
    const d = device(e.fetchImpl, at(14, 0, 8), { isVisible: () => false, setTimer: (fn) => { fire = fn; return 1 } })
    d.c.start()
    await fire()
    expect(e.asked).toEqual([])
    d.c.stop()
  })
})

describe('scheduling', () => {
  it('the next poll is the next minute\'s frame time; overnight it sleeps until the session', async () => {
    let delay = null
    const e = edge({ through: 599, rolled: 594 })
    const d = device(e.fetchImpl, at(14, 0, 8), { setTimer: (fn, ms) => { delay = ms; return 1 } })
    d.c.start()                                   // schedules the first tick at once
    expect(delay).toBe(0)
    d.c.stop()
    let fire = null
    let wait = null
    const n2 = createMinuteFrameConsumer({
      sink: createMemorySink(), fetchImpl: edge({ through: 959 }).fetchImpl, now: () => at(21, 30, 0),
      isVisible: () => true, setTimer: (fn, ms) => { fire = fn; wait = ms; return 1 }, clearTimer: () => {}, random: () => 0,
    })
    n2.start()
    await fire()                                  // 21:30: after the session
    expect(wait).toBe(3_600_000 + 7000)           // re-checked hourly, never every minute all night
    n2.stop()
  })
})
