// @vitest-environment node
// ⭐ A READ NEVER WAITS FOR THE WHOLE REPLAY (2026-11-23, the live-session read of the device store, item 1c). A mid-session
// page load makes the leader's minute feed download today.bin and replay the whole day into the overlay (consumer.js
// loadToday), seconds of work for the full universe. The replay gives the thread back every `sliceMs` of work with its
// DEFAULT yield, a 0 ms timer: a new task, so the worker's event loop runs whatever task is waiting, a READ message
// included, before the next slice. (A worker has no frames to render: the yield is for its messages.) Proved here in the
// order it must happen, through the real worker core, the real feed, the real consumer and its production yield: a read
// posted while the replay is under way is answered while the replay is still under way, from the minutes applied so far.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { createWorkerCore } from './workerCore'
import { memoryIO } from './io'
import { seedPackOf, synthBars } from './testing/fixtures'
import { crc32, hhmmOfSeq, decodeFrame } from '../../lib/minuteFrames/codec'
import { DEFAULT_BASE } from '../../lib/minuteFrames/consumer'

const sha = (b) => createHash('sha256').update(b).digest('hex')
const MANIFEST = 'https://x.test/seed/latest.json'

// ── the seed: 5m rows for AAA and BBB, as of the fixture day ──
const fiveMinThrough = (day, n, seed) => {
  const [y, m, d] = day.split('-').map(Number)
  const last = Date.UTC(y, m - 1, d, 20, 55) / 1000
  return synthBars(n, { step: 300, seed, t0: last - (n - 1) * 300 })
}
const PACK = seedPackOf({ AAA: fiveMinThrough('2026-11-18', 400, 3), BBB: fiveMinThrough('2026-11-18', 300, 4) }, { tf: '5', build: '20261119T0131Z', asof: '2026-11-18' })
const seedEdge = vi.fn(async (url) => (String(url) === MANIFEST
  ? new Response(JSON.stringify({ v: 1, kind: 'ffseed', build: '20261119T0131Z', tfs: { '5': { url: '20261119T0131Z/5.ffs', bytes: PACK.length, sha256: sha(PACK) } } }))
  : new Response(PACK)))

// ── the live edge: the publisher's real frames of 2026-11-18 (consumer.test's day) ──
const DAY = '2026-11-18'
const raw = new Uint8Array(fs.readFileSync(new URL('../../../../tests/fixtures/minute_frames/day_regular.today.bin', import.meta.url)))
const u32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)) + b[p + 3] * 16777216
const putU32 = (b, p, v) => { b[p] = v & 255; b[p + 1] = (v >>> 8) & 255; b[p + 2] = (v >>> 16) & 255; b[p + 3] = (v >>> 24) & 255 }
const FRAMES = (() => {
  const out = []
  let pos = 16
  while (pos < raw.length - 12) { const len = u32(raw, pos); out.push(raw.slice(pos + 4, pos + 4 + len)); pos += 4 + len }
  return out
})()
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
const THROUGH = 599   // 13:59
const ROLLED = 594    // today.bin holds 04:00 .. 13:54: the replay; the five minute files after it are fetched one by one
const liveFetch = async (url) => {
  const [d, file] = String(url).slice(DEFAULT_BASE.length + 1).split('/')
  const no = () => new Response('{"error":"not_published"}', { status: 404 })
  if (d !== DAY) return no()
  if (file === 'head.json') return new Response(JSON.stringify({ day: 20261118, seq: THROUGH, today_seq: ROLLED }))
  if (file === 'today.bin') return new Response(todayOf(FRAMES.slice(0, ROLLED + 1)))
  const seq = FRAMES.findIndex((_, s) => `${hhmmOfSeq(s)}.bin` === file)
  return seq < 0 || seq > THROUGH ? no() : new Response(FRAMES[seq])
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

describe('a device read posted during the today.bin replay is answered before the replay ends', () => {
  it("R1 the replay's own yield (a 0 ms timer, a new task) lets the worker answer the read between slices", async () => {
    const clock = { t: Date.UTC(2026, 10, 18, 19, 0, 8) }          // Wed 14:00:08 ET: a mid-session page load
    const posted = []
    const disk = new Map()
    let calls = 0
    let askedAt = null
    let answeredAt = null
    let answer
    let core = null
    const seq = () => core.feed()?.status().consumer?.lastSeq ?? null
    const ask = async (msg) => {
      const id = Math.random()
      await core.onMessage({ ...msg, id })
      return posted.find((m) => m.id === id)?.res
    }
    core = createWorkerCore({
      tabId: 'A', locks: null, makeChannel: null, makeIO: async () => memoryIO(disk), fetchFn: seedEdge,
      post: (m) => posted.push(m), now: () => clock.t, engineOpts: { now: () => clock.t },
      liveOpts: {
        now: () => clock.t,
        consumerOpts: {
          fetchImpl: liveFetch, now: () => clock.t, sliceMs: 5,
          // a slice is 5 calls of this clock; the 30th call is well inside the replay: the page posts a read THEN, as a
          // message would arrive (a task of its own, not a continuation of the replay's)
          elapsed: () => {
            calls++
            if (calls === 30) {
              setTimeout(() => {
                askedAt = seq()
                ask({ op: 'read', sym: 'AAA', tf: '5' }).then((res) => { answeredAt = seq(); answer = res })
              }, 0)
            }
            return calls
          },
          // (no yieldTo: the production yield is what is under test)
        },
      },
    })
    await ask({ op: 'ingest', manifestUrl: MANIFEST })
    await core.ingesting()
    await ask({ op: 'live', visible: true })
    for (let i = 0; i < 400 && !(seq() >= THROUGH); i++) await wait(5)
    expect(seq()).toBe(THROUGH)                                      // the catch-up ran to the end
    expect(askedAt).not.toBeNull()
    expect(askedAt).toBeLessThan(ROLLED)                             // posted while the replay was under way...
    expect(answer?.t?.length).toBeGreaterThan(0)                    // ...answered with the seed's columns...
    expect(answeredAt).not.toBeNull()
    expect(answeredAt).toBeLessThan(ROLLED)                          // ...and BEFORE the replay ended
    core.close()
  })
})
