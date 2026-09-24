// app/src/testing/pinnedWallClock.test.js — the helper's own rail.
import { describe, it, expect, afterEach } from 'vitest'
import { pinWallClock, wallClockET } from './pinnedWallClock'

const TARGET = '2026-09-22T18:26:00Z'   // Tue 14:26 ET
let clock = null
afterEach(() => { if (clock) { clock.restore(); clock = null } })

describe('pinWallClock', () => {
  it('shifts BOTH reads of "now" to the target, in test code and in a consumer that reads the global', () => {
    const before = Date.now()
    clock = pinWallClock(TARGET)
    const t = new Date(TARGET).getTime()
    expect(Math.abs(Date.now() - t)).toBeLessThan(1000)
    expect(Math.abs(new Date().getTime() - t)).toBeLessThan(1000)
    // a consumer holding the GLOBAL (not a captured reference) sees the pin too
    expect(Math.abs(globalThis.Date.now() - t)).toBeLessThan(1000)
    expect(Math.abs(before - t)).toBeGreaterThan(60_000)   // non-vacuity: the pin moved something
  })

  it('keeps ADVANCING at real speed — a polling loop on Date.now() still terminates', async () => {
    clock = pinWallClock(TARGET)
    const a = Date.now()
    await new Promise((r) => setTimeout(r, 30))
    expect(Date.now() - a).toBeGreaterThanOrEqual(25)
  })

  it('leaves explicit constructions, parse and UTC alone; instances are real Dates', () => {
    clock = pinWallClock(TARGET)
    expect(new Date('2020-01-02T03:04:05Z').toISOString()).toBe('2020-01-02T03:04:05.000Z')
    expect(new Date(0).getTime()).toBe(0)
    expect(Date.UTC(2020, 0, 1)).toBe(1577836800000)
    expect(Date.parse('2020-01-01T00:00:00Z')).toBe(1577836800000)
    expect(new Date() instanceof Date).toBe(true)
    expect(new Date(0) instanceof Date).toBe(true)
    expect(typeof new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).toBe('string')
  })

  it('retarget() moves the pin without a restore, and restore() returns the real clock', () => {
    const real = Date.now()
    clock = pinWallClock(TARGET)
    clock.retarget('2026-09-22T22:12:00Z')   // Tue 18:12 ET, same day
    expect(Math.abs(Date.now() - new Date('2026-09-22T22:12:00Z').getTime())).toBeLessThan(1000)
    expect(wallClockET()).toMatch(/^Tue 09\/22 18:12/)
    clock.restore(); clock = null
    expect(Math.abs(Date.now() - real)).toBeLessThan(5000)
    expect(Date.__uctPinnedWallClock).toBeUndefined()
  })

  it('refuses a double pin and a non-instant', () => {
    clock = pinWallClock(TARGET)
    expect(() => pinWallClock(TARGET)).toThrow(/already pinned/)
    expect(() => clock.retarget('not a date')).toThrow(/not an instant/)
    clock.restore(); clock = null
    expect(() => pinWallClock('nope')).toThrow(/not an instant/)
  })
})
