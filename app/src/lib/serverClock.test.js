// ⭐ THE SERVER'S CLOCK (2026-11-25, lib/serverClock.js): learned from the bars answers' Date headers, the median of recent
// samples, bounded, and never backwards while the member's clock runs forward.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { noteServerDate, serverNow, serverClockOffset, __resetServerClockForTests, SAMPLES_KEPT, OFFSET_MAX_MS } from './serverClock'

let wall = 1_795_617_474_400
beforeEach(() => { wall = 1_795_617_474_400; __resetServerClockForTests({ wall: () => wall }) })
const sample = (serverMs, rtt = 40) => noteServerDate(new Date(serverMs).toUTCString(), { sentAt: wall - rtt, receivedAt: wall })

describe('serverNow', () => {
  it('with no sample it is the member clock, exactly', () => {
    expect(serverNow()).toBe(wall)
    wall += 1234
    expect(serverNow()).toBe(wall)
  })

  it('learns a 6.2 s slow member clock from Date headers (whole seconds, taken at their middle)', () => {
    for (let i = 0; i < 3; i++) expect(sample(wall + 6200)).toBe(true)
    expect(Math.abs(serverClockOffset() - 6200)).toBeLessThanOrEqual(520)
    expect(Math.abs(serverNow() - (wall + 6200))).toBeLessThanOrEqual(520)
  })

  it('the median: one late or wild answer does not move it', () => {
    for (let i = 0; i < 4; i++) sample(wall + 6200)
    sample(wall + 90_000)
    expect(Math.abs(serverClockOffset() - 6200)).toBeLessThanOrEqual(520)
    expect(SAMPLES_KEPT).toBeGreaterThanOrEqual(5)
  })

  it('a long round trip, a broken header, or an offset past the bound is not a sample', () => {
    expect(noteServerDate(new Date(wall + 6000).toUTCString(), { sentAt: wall - 5000, receivedAt: wall })).toBe(false)
    expect(noteServerDate('not a date', { sentAt: wall - 10, receivedAt: wall })).toBe(false)
    expect(noteServerDate(null, { sentAt: wall - 10, receivedAt: wall })).toBe(false)
    expect(sample(wall + OFFSET_MAX_MS + 60_000)).toBe(false)
    expect(serverClockOffset()).toBe(0)
  })

  it('never backwards while the member clock runs forward: a smaller offset holds until the clock catches up', () => {
    for (let i = 0; i < 3; i++) sample(wall + 6200)
    const a = serverNow()
    // the next samples say the server is only 1 s ahead (the median moves once they are the majority)
    for (let i = 0; i < 5; i++) sample(wall + 1000)
    expect(serverNow()).toBe(a)               // held, not moved back mid-bucket
    wall += 2000
    expect(serverNow()).toBe(a)               // still held: the member clock + the new offset is earlier
    wall += 4000
    expect(serverNow()).toBeGreaterThan(a)    // caught up: it runs on
  })

  it('the member clock itself going back moves it back (no frozen clock after a correction or in a test)', () => {
    const a = serverNow()
    wall -= 60_000
    expect(serverNow()).toBe(a - 60_000)
  })
})

describe('the bars lane samples every answer', () => {
  it('_chartLaneFetch notes the answer\'s Date header', async () => {
    vi.resetModules()
    const clock = await import('./serverClock')
    clock.__resetServerClockForTests()
    const server = Date.now() + 6200
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, headers: { get: (h) => (String(h).toLowerCase() === 'date' ? new Date(server).toUTCString() : null) },
      json: async () => ({ bars: [] }),
    })))
    const { _chartLaneFetch } = await import('../utils/prefetchBars')
    await _chartLaneFetch('/api/bars/AAA?tf=1')
    expect(Math.abs(clock.serverClockOffset() - 6200)).toBeLessThanOrEqual(600)
    vi.unstubAllGlobals()
  })
})
