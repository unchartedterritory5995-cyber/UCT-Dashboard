// @vitest-environment jsdom
// P6-L2 (review of #2565): A KILL SEEN ON AN OPEN PAGE IS REMEMBERED AS A PLAIN BOOLEAN. The device client reads the kill
// cookies FRESH on its visible beat (deviceStoreKilledNow, #2563) and stops its worker; the bar store's device rule must
// stop painting the device rows it already holds from that moment on, and it runs on every switch, so it may not parse
// document.cookie each time. The fresh read latches what it saw (deviceStoreKillSeen) and tells the store once
// (onDeviceStoreKill): the same read, no second parser, no second authority.
//   KS1 nothing seen before a fresh read finds a kill; a read without one changes nothing; once seen it stays seen for
//       the page (the client is shut down for good), even after the cookie goes
//   KS2 every kill counts: the device kill (0 and purge) and the chart speed kill
//   KS3 the watchers hear it ONCE, at the first fresh read that sees it; one that throws does not stop the others; an
//       unsubscribed one is not called
//   KS4 the latch reads no cookie: asking it costs no document.cookie parse
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as speed from './chartSpeed'

const DEVICE = 'uct_device_store'
const SPEED = 'uct_chart_speed'
const set = (name, v = '0') => { document.cookie = `${name}=${v}; path=/` }
const clear = (name) => { document.cookie = `${name}=; max-age=0; path=/` }

beforeEach(() => { clear(DEVICE); clear(SPEED); speed.__resetChartSpeedForTests() })
afterEach(() => { clear(DEVICE); clear(SPEED); speed.__resetChartSpeedForTests() })

describe('a kill seen by the fresh read is latched for the page', () => {
  it('KS1 seen only once a fresh read finds it; then it stays seen, the cookie gone or not', () => {
    expect(speed.deviceStoreKillSeen()).toBe(false)
    expect(speed.deviceStoreKilledNow()).toBe(false)
    expect(speed.deviceStoreKillSeen()).toBe(false)
    set(DEVICE)
    expect(speed.deviceStoreKillSeen()).toBe(false)               // not until a fresh read looks
    expect(speed.deviceStoreKilledNow()).toBe(true)
    expect(speed.deviceStoreKillSeen()).toBe(true)
    clear(DEVICE)
    expect(speed.deviceStoreKilledNow()).toBe(false)
    expect(speed.deviceStoreKillSeen()).toBe(true)                // the page's client stopped for good
  })

  it('KS2 the device kill (0, purge) and the chart speed kill all count', () => {
    for (const [name, v] of [[DEVICE, '0'], [DEVICE, 'purge'], [SPEED, '0']]) {
      speed.__resetChartSpeedForTests(); clear(DEVICE); clear(SPEED)
      set(name, v)
      expect(speed.deviceStoreKilledNow(), `${name}=${v}`).toBe(true)
      expect(speed.deviceStoreKillSeen(), `${name}=${v}`).toBe(true)
    }
  })

  it('KS3 the watchers hear it once; a throwing one does not stop the rest; an unsubscribed one is not called', () => {
    const a = vi.fn(), b = vi.fn(() => { throw new Error('x') }), c = vi.fn(), gone = vi.fn()
    speed.onDeviceStoreKill(a); speed.onDeviceStoreKill(b); speed.onDeviceStoreKill(c)
    const off = speed.onDeviceStoreKill(gone); off()
    speed.deviceStoreKilledNow()
    expect([a, b, c].map((f) => f.mock.calls.length)).toEqual([0, 0, 0])   // no kill yet
    set(DEVICE)
    speed.deviceStoreKilledNow()
    speed.deviceStoreKilledNow()
    expect([a, b, c].map((f) => f.mock.calls.length)).toEqual([1, 1, 1])
    expect(gone).not.toHaveBeenCalled()
  })

  it('KS4 asking the latch reads no cookie', () => {
    set(DEVICE)
    speed.deviceStoreKilledNow()
    const get = vi.spyOn(Document.prototype, 'cookie', 'get')
    try {
      for (let i = 0; i < 1000; i++) expect(speed.deviceStoreKillSeen()).toBe(true)
      expect(get).not.toHaveBeenCalled()
    } finally { get.mockRestore() }
  })
})
