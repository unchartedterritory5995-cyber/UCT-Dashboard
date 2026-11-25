// ⭐ THE SERVER'S CLOCK (2026-11-25, lib/serverClock.js): learned from answers' Date headers, the median of recent samples,
// bounded, on the page's monotonic clock, never from an answer a cache could have served, and never backwards once learned.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  noteServerDate, serverNow, serverClockOffset, cacheableAnswer, __resetServerClockForTests,
  SAMPLES_KEPT, OFFSET_MAX_MS, SAMPLE_RTT_MIN_MS, CLOCK_JUMP_MS,
} from './serverClock'

// two clocks the test moves: the member's wall clock (Date.now) and the page's monotonic one (performance)
let wall = 1_795_617_474_400
let mono = 1_795_617_474_400
beforeEach(() => {
  wall = 1_795_617_474_400
  mono = wall
  __resetServerClockForTests({ wall: () => wall, mono: () => mono })
})
const tick = (ms) => { wall += ms; mono += ms }
const sample = (serverMs, rtt = 40, extra = {}) => noteServerDate(new Date(serverMs).toUTCString(), { sentAt: mono - rtt, receivedAt: mono, ...extra })

describe('serverNow', () => {
  it('with no sample it is the member clock, exactly', () => {
    expect(serverNow()).toBe(wall)
    tick(1234)
    expect(serverNow()).toBe(wall)
    wall -= 60_000                             // (a test moving the member clock back, with nothing learned: it follows)
    expect(serverNow()).toBe(wall)
  })

  it('learns a 6.2 s slow member clock from Date headers (whole seconds, taken at their middle)', () => {
    for (let i = 0; i < 3; i++) expect(sample(wall + 6200)).toBe(true)
    expect(Math.abs(serverClockOffset() - 6200)).toBeLessThanOrEqual(520)
    expect(Math.abs(serverNow() - (wall + 6200))).toBeLessThanOrEqual(520)
  })

  it('the median of samples at varied sub-second phases is good to well under a second', () => {
    const TRUE = 6200
    for (let i = 0; i < SAMPLES_KEPT; i++) { sample(wall + TRUE, 60); tick(1000 + 113 * i) }
    expect(Math.abs(serverClockOffset() - TRUE)).toBeLessThanOrEqual(300)
  })

  it('the median: one late or wild answer does not move it', () => {
    for (let i = 0; i < 4; i++) sample(wall + 6200)
    sample(wall + 90_000)
    expect(Math.abs(serverClockOffset() - 6200)).toBeLessThanOrEqual(520)
    expect(SAMPLES_KEPT).toBeGreaterThanOrEqual(5)
  })

  it('a long round trip, a broken header, or an offset past the bound is not a sample', () => {
    expect(noteServerDate(new Date(wall + 6000).toUTCString(), { sentAt: mono - 5000, receivedAt: mono })).toBe(false)
    expect(noteServerDate('not a date', { sentAt: mono - 10, receivedAt: mono })).toBe(false)
    expect(noteServerDate(null, { sentAt: mono - 10, receivedAt: mono })).toBe(false)
    expect(sample(wall + OFFSET_MAX_MS + 60_000)).toBe(false)
    expect(serverClockOffset()).toBe(0)
  })

  it('never backwards once learned: a smaller offset holds until the clock catches up', () => {
    for (let i = 0; i < 3; i++) sample(wall + 6200)
    const a = serverNow()
    // the next samples say the server is only 1 s ahead (the median moves once they are the majority)
    for (let i = 0; i < 5; i++) sample(wall + 1000)
    expect(serverNow()).toBe(a)               // held, not moved back mid-bucket
    tick(2000)
    expect(serverNow()).toBe(a)               // still held: the clock + the new offset is earlier
    tick(4000)
    expect(serverNow()).toBeGreaterThan(a)    // caught up: it runs on
  })
})

describe('(review of #2733) never a cached answer', () => {
  it('a cache-served answer (its Date 200 s old, a round trip of 0) is not a sample', () => {
    for (let i = 0; i < 3; i++) sample(wall + 6200)
    const before = serverClockOffset()
    // the browser's HTTP cache hands back a daily answer stored 200 s ago: its own Date, no network
    for (let i = 0; i < 6; i++) {
      expect(noteServerDate(new Date(wall + 6200 - 200_000).toUTCString(), { sentAt: mono, receivedAt: mono })).toBe(false)
      expect(sample(wall + 6200 - 200_000, 40, { cacheControl: 'public, max-age=300' })).toBe(false)
      expect(sample(wall + 6200 - 200_000, 40, { age: '200' })).toBe(false)
    }
    expect(serverClockOffset()).toBe(before)
    expect(Math.abs(serverNow() - (wall + 6200))).toBeLessThanOrEqual(520)
  })

  it('which answers a cache could keep', () => {
    expect(cacheableAnswer({})).toBe(false)
    expect(cacheableAnswer({ cacheControl: 'no-store' })).toBe(false)
    expect(cacheableAnswer({ cacheControl: 'no-cache, max-age=0' })).toBe(false)
    expect(cacheableAnswer({ cacheControl: 'private, max-age=0' })).toBe(false)
    expect(cacheableAnswer({ age: '0' })).toBe(false)
    expect(cacheableAnswer({ cacheControl: 'public, max-age=5' })).toBe(true)
    expect(cacheableAnswer({ cacheControl: 'private, max-age=60' })).toBe(true)
    expect(cacheableAnswer({ cacheControl: 'public, max-age=31536000, immutable' })).toBe(true)
    expect(cacheableAnswer({ cacheControl: 'public' })).toBe(true)
    expect(cacheableAnswer({ age: '12' })).toBe(true)
    expect(SAMPLE_RTT_MIN_MS).toBeGreaterThan(0)
  })
})

describe('(review of #2733) the wall clock jumping (an NTP resync) moves nothing', () => {
  it('a backward jump of the member clock after learning leaves serverNow right', () => {
    for (let i = 0; i < 3; i++) sample(wall + 6200)
    const a = serverNow()
    wall -= 6200                               // the resync: the wall steps back, the monotonic clock does not
    tick(1000)
    expect(Math.abs(serverNow() - (a + 1000))).toBeLessThanOrEqual(5)
  })

  it('a forward jump after learning (the PC clock corrected, today's case): the corrected wall answers, never backwards', () => {
    for (let i = 0; i < 3; i++) sample(wall + 6200)
    const a = serverNow()
    wall += 6200                               // the resync: the wall is now the server's time (ambiguous with a sleep: see below)
    tick(500)
    expect(Math.abs(serverNow() - wall)).toBeLessThanOrEqual(5)
    expect(serverNow()).toBeGreaterThanOrEqual(a)
    // and new samples, now against a correct wall, keep the same server time
    for (let i = 0; i < SAMPLES_KEPT; i++) sample(wall)
    expect(Math.abs(serverNow() - wall)).toBeLessThanOrEqual(520)
  })
})

describe('(review of #2733, round 2) a sleep: the monotonic clock paused while the wall ran on', () => {
  it('after an hour asleep serverNow is the wall clock, not an hour behind; new samples take over again', () => {
    for (let i = 0; i < 3; i++) sample(wall + 6200)
    const a = serverNow()
    wall += 3_600_000                          // macOS / Linux: performance.now() stood still for the whole sleep
    expect(Math.abs(serverNow() - wall)).toBeLessThanOrEqual(5)
    expect(serverNow()).toBeGreaterThan(a)
    expect(serverClockOffset()).toBe(0)        // every pre-sleep sample dropped
    expect(sample(wall + 6200)).toBe(true)     // the next answer after the wake re-learns it
    expect(Math.abs(serverNow() - (wall + 6200))).toBeLessThanOrEqual(520)
  })

  it('a pause shorter than the threshold is not a jump (the samples stay)', () => {
    for (let i = 0; i < 3; i++) sample(wall + 6200)
    wall += CLOCK_JUMP_MS - 500
    expect(Math.abs(serverClockOffset() - 6200 - (CLOCK_JUMP_MS - 500) * -1)).toBeLessThanOrEqual(520)
    expect(Math.abs(serverNow() - (mono + 6200))).toBeLessThanOrEqual(520)
  })

  it('(LOW) the first sample never steps serverNow back: a member clock 3 s FAST holds until the server catches up', () => {
    const before = serverNow()                 // nothing learned: the member clock, recorded
    expect(before).toBe(wall)
    expect(sample(wall - 3000)).toBe(true)
    expect(serverNow()).toBe(before)           // held, not stepped back 3 s
    tick(4000)
    expect(serverNow()).toBeGreaterThan(before)
  })
})

describe('the answers that sample it', () => {
  it('_chartLaneFetch notes the answer\'s Date header, and not a cacheable one', async () => {
    vi.resetModules()
    const clock = await import('./serverClock')
    clock.__resetServerClockForTests()
    const server = Date.now() + 6200
    let cc = null
    vi.stubGlobal('fetch', vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 15))            // a network round trip, not a cache's
      return {
        ok: true, status: 200,
        headers: { get: (h) => { const k = String(h).toLowerCase(); return k === 'date' ? new Date(server).toUTCString() : k === 'cache-control' ? cc : null } },
        json: async () => ({ bars: [] }),
      }
    }))
    const { _chartLaneFetch } = await import('../utils/prefetchBars')
    cc = 'public, max-age=300'
    await _chartLaneFetch('/api/bars/AAA?tf=D')
    expect(clock.serverClockOffset()).toBe(0)                 // a cacheable answer: no sample
    cc = null
    await _chartLaneFetch('/api/bars/AAA?tf=1')
    expect(Math.abs(clock.serverClockOffset() - 6200)).toBeLessThanOrEqual(600)
    vi.unstubAllGlobals()
  })
})
