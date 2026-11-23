// @vitest-environment node
// ⭐ THE MINUTE FEED NEVER COMPETES WITH THE PAGE (2026-11-23, the live-session read of the device store, item 1a). The feed
// runs in the device store's worker and fetches from the page's own origin: head.json, one {HHMM}.bin a minute, and at a
// mid-session page load today.bin (the whole day so far, then replayed). Those requests share the connection with the
// chart's own (a switch's tail, its panes' columns), so every one of them asks at `priority: 'low'`. Each keeps the cache
// mode it had: head.json `no-store` (always the newest seq), the .bin files the browser's default (a minute file is
// immutable; today.bin is served no-store by the edge). The edge keys its cache on the path alone
// (edge/bars-edge-router/live1m.js: `${origin}${EDGE_KEY_PATH}${key}`, no request header), so the priority cannot split it.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { crc32, hhmmOfSeq, decodeFrame } from './codec'
import { createMinuteFrameConsumer, DEFAULT_BASE } from './consumer'
import { createMemorySink } from './memorySink'

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
const at = (hh, mm, ss = 0) => Date.UTC(2026, 10, 18, hh + 5, mm, ss)

/** An edge that records every request's init. */
function edge({ through, rolled }) {
  const asked = []
  const fetchImpl = async (url, init) => {
    asked.push({ file: url.slice(DEFAULT_BASE.length + 1).split('/')[1], init: { ...(init || {}) } })
    const [d, file] = url.slice(DEFAULT_BASE.length + 1).split('/')
    const no = () => new Response('{"error":"not_published"}', { status: 404 })
    if (d !== DAY) return no()
    if (file === 'head.json') return new Response(JSON.stringify({ day: 20261118, seq: through, today_seq: rolled }))
    if (file === 'today.bin') return new Response(todayOf(FRAMES.slice(0, rolled + 1)))
    const seq = FRAMES.findIndex((_, s) => `${hhmmOfSeq(s)}.bin` === file)
    return seq < 0 || seq > through ? no() : new Response(FRAMES[seq])
  }
  return { fetchImpl, asked }
}

function consumer(fetchImpl, nowMs) {
  return createMinuteFrameConsumer({
    sink: createMemorySink(), fetchImpl, now: () => nowMs, isVisible: () => true,
    setTimer: () => 0, clearTimer: () => {}, random: () => 0, yieldTo: () => Promise.resolve(),
  })
}

describe('the minute feed asks at low priority, keeping its cache modes', () => {
  it('a mid-session catch-up: head.json, today.bin and the minute files after it, every one at priority low', async () => {
    const e = edge({ through: 599, rolled: 594 })
    const c = consumer(e.fetchImpl, at(14, 0, 8))
    expect(await c.syncNow()).toEqual({ current: true })
    expect(e.asked.map((a) => a.file)).toEqual(['head.json', 'today.bin', '1355.bin', '1356.bin', '1357.bin', '1358.bin', '1359.bin'])
    for (const a of e.asked) {
      expect(a.init.priority, a.file).toBe('low')
      expect(a.init.credentials, a.file).toBe('same-origin')
    }
    // the cache modes it had: head.json never from the browser's cache; the .bin files the default
    expect(e.asked.find((a) => a.file === 'head.json').init.cache).toBe('no-store')
    for (const a of e.asked.filter((x) => x.file.endsWith('.bin'))) expect(a.init.cache, a.file).toBeUndefined()
  })

  it('the steady state: the next minute alone, at priority low', async () => {
    const e = edge({ through: 600, rolled: 594 })
    const c = consumer(e.fetchImpl, at(14, 1, 8))
    for (let s = 0; s <= 599; s++) c.applyFrame(decodeFrame(FRAMES[s]))
    e.asked.length = 0
    await c._step()
    expect(e.asked).toEqual([{ file: '1400.bin', init: expect.objectContaining({ priority: 'low', credentials: 'same-origin' }) }])
  })

  it('CONTROL: a fetch that does not know the option ignores it (RequestInit is a dictionary)', () => {
    expect(() => new Request('https://x.test/api/hist/live1m/v1/2026-11-18/head.json', { priority: 'low' })).not.toThrow()
  })
})
