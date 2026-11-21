// ⭐⭐ THE DEVICE STORE IS DEFAULT ON FOR DESKTOP ONLY (owner, 2026-11-21): desktop browsers and the desktop app.
// Phones, touch-tier tablets (≤ 1024 px) and metered connections stay OFF; a member's own '0' / '1' always wins;
// the server's kill switch wins over everything.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DEVICE_STORE_KEY, deviceStoreEnabled, deviceStoreDefaultOn } from './switch'
import { MQ } from '../../styles/breakpoints'
import { cookieKillsChartSpeed, __resetChartSpeedForTests } from '../../lib/chartSpeed'

const realMatchMedia = window.matchMedia
/** A browser whose viewport answers `desktop` to MQ.desktop (and the opposite to the touch tiers). */
function viewport(desktop) {
  window.matchMedia = (q) => ({ matches: q === MQ.desktop ? desktop : !desktop, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
}
function connection(c) { Object.defineProperty(navigator, 'connection', { value: c, configurable: true }) }

beforeEach(() => { localStorage.removeItem(DEVICE_STORE_KEY); connection(undefined); delete window.uctDesktop; __resetChartSpeedForTests?.() })
afterEach(() => { window.matchMedia = realMatchMedia; connection(undefined); delete window.uctDesktop; localStorage.removeItem(DEVICE_STORE_KEY); document.cookie = 'uct_chart_speed=; max-age=0; path=/'; __resetChartSpeedForTests?.() })

describe('default ON for desktop only', () => {
  it('a desktop browser: ON', () => {
    viewport(true)
    expect(deviceStoreDefaultOn()).toBe(true)
    expect(deviceStoreEnabled()).toBe(true)
  })

  it('a phone or a touch-tier tablet (≤ 1024 px): OFF', () => {
    viewport(false)
    expect(deviceStoreDefaultOn()).toBe(false)
    expect(deviceStoreEnabled()).toBe(false)
  })

  it('a browser that cannot say (no matchMedia): OFF', () => {
    window.matchMedia = undefined
    expect(deviceStoreEnabled()).toBe(false)
  })

  it('the desktop app: ON, whatever its window width', () => {
    viewport(false)
    window.uctDesktop = { bridgeVersion: 1, capabilities: [] }
    expect(deviceStoreEnabled()).toBe(true)
  })

  it.each([
    ['saveData', { saveData: true, effectiveType: '4g' }],
    ['cellular', { type: 'cellular', effectiveType: '4g' }],
    ['3g', { effectiveType: '3g' }],
    ['2g', { effectiveType: '2g' }],
    ['slow-2g', { effectiveType: 'slow-2g' }],
  ])('a desktop on a metered connection (%s): OFF', (_name, c) => {
    viewport(true)
    connection(c)
    expect(deviceStoreEnabled()).toBe(false)
  })

  it('a desktop on a fast unmetered connection (4g / wifi): ON', () => {
    viewport(true)
    connection({ effectiveType: '4g', type: 'wifi', saveData: false })
    expect(deviceStoreEnabled()).toBe(true)
  })

  it("the member's own choice wins: '0' on a desktop is OFF, '1' on a phone is ON", () => {
    viewport(true)
    localStorage.setItem(DEVICE_STORE_KEY, '0')
    expect(deviceStoreEnabled()).toBe(false)
    viewport(false)
    localStorage.setItem(DEVICE_STORE_KEY, '1')
    expect(deviceStoreEnabled()).toBe(true)
  })

  it('the kill switch wins over the desktop default and over a local 1', () => {
    expect(cookieKillsChartSpeed).toBeTypeOf('function')
    viewport(true)
    document.cookie = 'uct_chart_speed=0; path=/'
    __resetChartSpeedForTests?.()
    if (!cookieKillsChartSpeed(document.cookie)) return expect.fail('the test cookie does not read as a kill: check lib/chartSpeed')
    expect(deviceStoreEnabled()).toBe(false)
    localStorage.setItem(DEVICE_STORE_KEY, '1')
    expect(deviceStoreEnabled()).toBe(false)
  })
})
