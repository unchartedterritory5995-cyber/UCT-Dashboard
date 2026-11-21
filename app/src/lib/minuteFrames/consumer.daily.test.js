// @vitest-environment node
// THE SERVER'S DAILY ROWS AND REFUSED FRAMES in the consumer, against a day the REAL publisher wrote with a daily
// feed (tests/fixtures/minute_frames/day_daily.today.bin, 2026-11-19: the section from the 16:00 close, a
// publisher restart 17:00-17:03, so a second epoch whose first post-close frame carries every row again).
// The sink must hear every section, which one is an epoch's FULL set, and with every frame whether the device
// now holds the server's rows (`dailyOk`); a frame that could have carried rows and was not applied ends that
// until the next full set. A frame the decoder refuses for good is a gap and the stream goes on.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { Buffer } from 'node:buffer'
import { crc32, hhmmOfSeq, decodeFrame } from './codec'
import { createMinuteFrameConsumer, DEFAULT_BASE } from './consumer'

const fixture = (name) => new Uint8Array(fs.readFileSync(new URL(`../../../../tests/fixtures/minute_frames/${name}`, import.meta.url)))
const RAW = fixture('day_daily.today.bin')
const D = JSON.parse(Buffer.from(fixture('day_daily.json')).toString('utf8'))
const u32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)) + b[p + 3] * 16777216
const putU32 = (b, p, v) => { b[p] = v & 255; b[p + 1] = (v >>> 8) & 255; b[p + 2] = (v >>> 16) & 255; b[p + 3] = (v >>> 24) & 255 }

/** The day's frames as published, raw: [{ seq, bytes }]. */
const FRAMES = (() => {
  const out = []
  let pos = 16
  while (pos < RAW.length - 12) {
    const len = u32(RAW, pos)
    const bytes = RAW.slice(pos + 4, pos + 4 + len)
    out.push({ seq: u32(bytes, 12), bytes })
    pos += 4 + len
  }
  return out
})()
const SECTION_SEQS = D.daily_sections.map((s) => s[0])
const FIRST_FULL = SECTION_SEQS[0]                                                            // 16:00, epoch 1
const SECOND_EPOCH_FULL = D.daily_sections.find((s) => s[1] !== D.daily_sections[0][1])[0]   // after the restart

/** A frame whose flags gain a bit no decoder knows (CRC recomputed): what a NEWER publisher writes. */
function future(bytes) {
  const f = bytes.slice()
  f[5] |= 0x20
  putU32(f, f.length - 4, crc32(f, 0, f.length - 4))
  return f
}

function recorder() {
  const ev = { daily: [], done: [], gaps: [] }
  const sink = {
    upsert() {}, stale() {}, reset() {},
    gap: (info) => ev.gaps.push(info),
    daily: (info) => ev.daily.push(info),
    frameDone: (info) => ev.done.push(info),
  }
  return { sink, ev }
}

/** A consumer that applied the day's frames, minus `drop` seqs, with `refuse` seqs made unreadable. */
function replay({ drop = [], refuse = [] } = {}) {
  const { sink, ev } = recorder()
  const c = createMinuteFrameConsumer({ sink, fetchImpl: async () => new Response('', { status: 404 }), setTimer: () => 0, clearTimer: () => {} })
  for (const { seq, bytes } of FRAMES) {
    if (drop.includes(seq)) continue
    let f
    try { f = decodeFrame(refuse.includes(seq) ? future(bytes) : bytes) } catch (e) { f = { refused: true, error: e.message, ...e.frame } }
    c.applyFrame(f)
  }
  return { c, ev }
}
const okAt = (ev, seq) => ev.done.find((d) => d.seq === seq)?.dailyOk

describe('the consumer and the server\'s DAILY rows', () => {
  it('a device live all day: every section reaches the sink, an epoch\'s first one as the FULL set, and the rows are vouched for from it', () => {
    const { ev } = replay()
    expect(ev.daily.map((d) => d.seq)).toEqual(SECTION_SEQS)
    expect(ev.daily.filter((d) => d.full).map((d) => d.seq)).toEqual([FIRST_FULL, SECOND_EPOCH_FULL])
    // the rows as Python decoded them
    ev.daily.forEach((d, i) => expect(Object.fromEntries(d.rows.map((r) => [r.sym, [r.o, r.h, r.l, r.c, r.v]]))).toEqual(D.daily_sections[i][3]))
    expect(okAt(ev, FIRST_FULL - 1)).toBe(false)                     // before the close: nothing to vouch for
    expect(ev.done.filter((d) => d.seq >= FIRST_FULL).every((d) => d.dailyOk === true)).toBe(true)
    // the restart left a hole the PUBLISHER has (not-published) and an incomplete minute (the new socket): no row lost
    expect(ev.gaps.map((g) => g.reason).sort()).toEqual(['incomplete', 'not-published'])
  })

  it('a missed frame that carried rows: no trust until the next epoch\'s full set (and a device that missed the full set itself: none either)', () => {
    const changes = SECTION_SEQS.find((s) => s > FIRST_FULL)
    const { ev } = replay({ drop: [changes] })
    expect(okAt(ev, changes - 1)).toBe(true)
    expect(ev.done.filter((d) => d.seq > changes && d.seq < SECOND_EPOCH_FULL).every((d) => d.dailyOk === false)).toBe(true)
    expect(okAt(ev, SECOND_EPOCH_FULL)).toBe(true)
    const missedFull = replay({ drop: [FIRST_FULL] }).ev
    expect(missedFull.daily.find((d) => d.seq > FIRST_FULL).full).toBe(false)      // the next section is NOT taken for a full set
    expect(missedFull.done.filter((d) => d.seq > FIRST_FULL && d.seq < SECOND_EPOCH_FULL).every((d) => d.dailyOk === false)).toBe(true)
    expect(okAt(missedFull, SECOND_EPOCH_FULL)).toBe(true)
  })

  it('a device that joined mid-epoch (its first frame follows frames it never had) never takes a section for the full set', () => {
    const { sink, ev } = recorder()
    const c = createMinuteFrameConsumer({ sink, fetchImpl: async () => new Response('', { status: 404 }), setTimer: () => 0, clearTimer: () => {} })
    for (const { seq, bytes } of FRAMES) if (seq >= FIRST_FULL - 5 && seq < SECOND_EPOCH_FULL) c.applyFrame(decodeFrame(bytes))
    expect(ev.gaps[0].reason).toBe('not-received')
    expect(ev.daily.every((d) => d.full === false)).toBe(true)
    expect(ev.done.every((d) => d.dailyOk === false)).toBe(true)
  })

  it('a new day starts the trust over, even under the same epoch id (the full set is that day\'s first section)', () => {
    const { sink, ev } = recorder()
    const c = createMinuteFrameConsumer({ sink, fetchImpl: async () => new Response('', { status: 404 }), setTimer: () => 0, clearTimer: () => {} })
    for (const { bytes } of FRAMES) c.applyFrame(decodeFrame(bytes))
    // the next day's frames, all under the epoch id the day ended with (day + minute moved, CRC recomputed)
    const lastEpoch = u32(FRAMES[FRAMES.length - 1].bytes, 20)
    const next = (bytes) => {
      const f = bytes.slice()
      putU32(f, 8, u32(f, 8) + 1)
      putU32(f, 20, lastEpoch)
      putU32(f, 24, u32(f, 24) + 1440)
      putU32(f, f.length - 4, crc32(f, 0, f.length - 4))
      return f
    }
    const before = ev.daily.length
    for (const { bytes } of FRAMES) c.applyFrame(decodeFrame(next(bytes)))
    const day2 = ev.daily.slice(before)
    expect(day2.filter((d) => d.full).map((d) => d.seq)).toEqual([FIRST_FULL])            // one epoch id all day
    expect(ev.done.at(-1)).toMatchObject({ day: '2026-11-20', dailyOk: true })
  })

  it('a frame linked to another than the one applied (link-mismatch) ends the trust too', () => {
    const victim = SECTION_SEQS.find((s) => s > FIRST_FULL)
    const { sink, ev } = recorder()
    const c = createMinuteFrameConsumer({ sink, fetchImpl: async () => new Response('', { status: 404 }), setTimer: () => 0, clearTimer: () => {} })
    for (const { seq, bytes } of FRAMES) {
      let f = bytes
      if (seq === victim) { f = bytes.slice(); putU32(f, 16, victim - 2); putU32(f, f.length - 4, crc32(f, 0, f.length - 4)) }
      c.applyFrame(decodeFrame(f))
    }
    expect(ev.gaps.some((g) => g.reason === 'link-mismatch')).toBe(true)
    expect(okAt(ev, victim)).toBe(false)
    expect(okAt(ev, SECOND_EPOCH_FULL)).toBe(true)
  })

  it('a refused frame is a gap for its minute and the stream goes on; the rows it may have carried are not vouched for', () => {
    const victim = SECTION_SEQS.find((s) => s > FIRST_FULL)
    const { c, ev } = replay({ refuse: [victim] })
    expect(ev.gaps.filter((g) => g.reason === 'refused').map((g) => [g.fromSeq, g.toSeq])).toEqual([[victim, victim]])
    expect(c.status()).toMatchObject({ refused: 1, lastSeq: FRAMES[FRAMES.length - 1].seq })
    expect(okAt(ev, victim)).toBe(false)
    expect(okAt(ev, SECOND_EPOCH_FULL)).toBe(true)
    expect(ev.done.find((d) => d.seq === victim).withAv).toBe(false)
  })
})

describe('a refused frame on the wire is asked for once, never again', () => {
  const DAY = D.day
  const ymd = Number(DAY.replace(/-/g, ''))
  /** ms of an ET wall-clock time on DAY (EST: UTC-5). */
  const at = (hh, mm, ss = 0) => Date.UTC(+DAY.slice(0, 4), +DAY.slice(5, 7) - 1, +DAY.slice(8, 10), hh + 5, mm, ss)

  it('minute files: the refused one becomes a gap and the next minute is applied', async () => {
    const victim = FIRST_FULL + 2
    const asked = []
    const bySeq = new Map(FRAMES.map((f) => [f.seq, f.seq === victim ? future(f.bytes) : f.bytes]))
    const fetchImpl = async (url) => {
      asked.push(url)
      const [d, file] = url.slice(DEFAULT_BASE.length + 1).split('/')
      if (d !== DAY) return new Response('', { status: 404 })
      if (file === 'head.json') return new Response(JSON.stringify({ day: ymd, seq: FIRST_FULL + 4, today_seq: null }))
      const seq = [...bySeq.keys()].find((s) => `${hhmmOfSeq(s)}.bin` === file)
      return seq == null || seq > FIRST_FULL + 4 ? new Response('', { status: 404 }) : new Response(bySeq.get(seq))
    }
    const { sink, ev } = recorder()
    const clock = { ms: at(16, 5, 9) }
    const c = createMinuteFrameConsumer({ sink, fetchImpl, now: () => clock.ms, isVisible: () => true, setTimer: () => 0, clearTimer: () => {},
      random: () => 0, maxMinuteFetches: 1000 })
    await c.syncNow()
    expect(c.status().lastSeq).toBe(FIRST_FULL + 4)
    expect(ev.gaps.filter((g) => g.reason === 'refused').map((g) => g.fromSeq)).toEqual([victim])
    await c.syncNow()                                                       // current: nothing asked again
    expect(asked.filter((u) => u.endsWith(`${hhmmOfSeq(victim)}.bin`)).length).toBe(1)
  })

  it('a DAMAGED minute file (its CRC fails: the bytes broke on the way) is not a refusal: it is asked for again', async () => {
    const victim = FIRST_FULL + 2
    const asked = []
    let damaged = true
    const fetchImpl = async (url) => {
      asked.push(url)
      const [d, file] = url.slice(DEFAULT_BASE.length + 1).split('/')
      if (d !== DAY) return new Response('', { status: 404 })
      if (file === 'head.json') return new Response(JSON.stringify({ day: ymd, seq: FIRST_FULL + 4, today_seq: null }))
      const f = FRAMES.find((x) => `${hhmmOfSeq(x.seq)}.bin` === file && x.seq <= FIRST_FULL + 4)
      if (!f) return new Response('', { status: 404 })
      if (f.seq === victim && damaged) { const b = f.bytes.slice(); b[40] ^= 1; return new Response(b) }
      return new Response(f.bytes)
    }
    const { sink, ev } = recorder()
    const c = createMinuteFrameConsumer({ sink, fetchImpl, now: () => at(16, 5, 9), isVisible: () => true, setTimer: () => 0, clearTimer: () => {},
      random: () => 0, maxMinuteFetches: 1000 })
    await expect(c.syncNow()).rejects.toThrow(/crc/)
    expect(c.status().lastSeq).toBe(victim - 1)
    expect(ev.gaps.some((g) => g.reason === 'refused')).toBe(false)
    damaged = false
    await c.syncNow()
    expect(c.status().lastSeq).toBe(FIRST_FULL + 4)
    expect(asked.filter((u) => u.endsWith(`${hhmmOfSeq(victim)}.bin`)).length).toBe(2)
  })

  it('the day file: a refused frame inside it no longer ends the catch-up (it used to: the file was downloaded again every 2 s)', async () => {
    const victim = FIRST_FULL + 2
    const out = RAW.slice()
    let pos = 16
    while (pos < out.length - 12) {
      const len = u32(out, pos)
      if (u32(out, pos + 4 + 12) === victim) {
        out[pos + 4 + 5] |= 0x20
        putU32(out, pos + 4 + len - 4, crc32(out, pos + 4, pos + 4 + len - 4))
      }
      pos += 4 + len
    }
    putU32(out, out.length - 4, crc32(out, 0, out.length - 4))
    const last = FRAMES[FRAMES.length - 1].seq
    let todayLoads = 0
    const fetchImpl = async (url) => {
      const [d, file] = url.slice(DEFAULT_BASE.length + 1).split('/')
      if (d !== DAY) return new Response('', { status: 404 })
      if (file === 'head.json') return new Response(JSON.stringify({ day: ymd, seq: last, today_seq: last }))
      if (file === 'today.bin') { todayLoads++; return new Response(out) }
      return new Response('', { status: 404 })
    }
    const { sink, ev } = recorder()
    const c = createMinuteFrameConsumer({ sink, fetchImpl, now: () => at(19, 59, 30), isVisible: () => true, setTimer: () => 0, clearTimer: () => {}, random: () => 0 })
    await c.syncNow()
    expect(c.status()).toMatchObject({ lastSeq: last, refused: 1, todayLoads: 1 })
    expect(ev.gaps.some((g) => g.reason === 'refused' && g.fromSeq === victim)).toBe(true)
    await c.syncNow()
    expect(todayLoads).toBe(1)
    expect(okAt(ev, last)).toBe(true)                                         // the second epoch's full set re-vouched
  })
})
