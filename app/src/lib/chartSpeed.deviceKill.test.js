// @vitest-environment jsdom
// M9 (review of #2537): A KILL FOR THE DEVICE STORE ALONE, through the chart speed kill's own channel. The server writes
// `uct_device_store=0` beside every auth payload while DEVICE_STORE_ENABLED is off (api/routers/auth.py;
// tests/test_device_store_kill.py is its half). Here: read exactly, once per page load like the chart speed kill, the
// device store goes off over a member's own '1', and NOTHING ELSE goes off with it (neighbor frames keep the member's
// own choice). `deviceStoreKilledNow` reads the jar FRESH, for a page left open (client.js, on a visible beat).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as speed from './chartSpeed'
import { neighborFramesOn, __setNeighborFramesForTests, NEIGHBOR_FRAMES_KEY } from '../components/chart/neighborFrames'
import { deviceStoreEnabled, DEVICE_STORE_KEY, __resetDeviceStoreSwitchForTests } from '../data/deviceStore/switch'

const DEVICE = 'uct_device_store'
const SPEED = 'uct_chart_speed'
const set = (name) => { document.cookie = `${name}=0; path=/` }
const clear = (name) => { document.cookie = `${name}=; max-age=0; path=/` }
const newPageLoad = () => { speed.__resetChartSpeedForTests(); __setNeighborFramesForTests(null); __resetDeviceStoreSwitchForTests() }

beforeEach(() => { clear(DEVICE); clear(SPEED); localStorage.clear(); newPageLoad() })
afterEach(() => { clear(DEVICE); clear(SPEED); localStorage.clear(); newPageLoad() })

describe("the device store's own kill", () => {
  it('off over a local 1, and neighbor frames untouched; cleared: back to the member\'s own choice', () => {
    localStorage.setItem(DEVICE_STORE_KEY, '1')
    newPageLoad()
    expect(deviceStoreEnabled()).toBe(true)
    set(DEVICE); newPageLoad()
    expect(deviceStoreEnabled()).toBe(false)
    expect(neighborFramesOn()).toBe(true)
    localStorage.setItem(NEIGHBOR_FRAMES_KEY, '1')
    newPageLoad()
    expect([deviceStoreEnabled(), neighborFramesOn()]).toEqual([false, true])
    clear(DEVICE); newPageLoad()
    expect(deviceStoreEnabled()).toBe(true)
  })

  it('CONTROL: the chart speed kill still turns BOTH off', () => {
    localStorage.setItem(DEVICE_STORE_KEY, '1')
    set(SPEED); newPageLoad()
    expect([deviceStoreEnabled(), neighborFramesOn()]).toEqual([false, false])
  })

  it('the cookie is read exactly; its name is the one the server writes', () => {
    expect(speed.DEVICE_STORE_COOKIE).toBe(DEVICE)
    for (const [jar, killed] of [
      ['uct_device_store=0', true], ['a=1; uct_device_store=0; b=2', true], [' uct_device_store = 0 ', true],
      ['uct_device_store=1', false], ['uct_device_store=', false], ['uct_device_store=00', false],
      ['xuct_device_store=0', false], ['uct_device_store_x=0', false], ['uct_chart_speed=0', false], ['', false], [null, false],
    ]) expect(speed.cookieKillsDeviceStore(jar), JSON.stringify(jar)).toBe(killed)
  })

  it('latched once per page load (the switch and the handoff agree within one load)', () => {
    expect(speed.deviceStoreKilled()).toBe(false)
    set(DEVICE)
    expect(speed.deviceStoreKilled()).toBe(false)
    newPageLoad()
    expect(speed.deviceStoreKilled()).toBe(true)
  })

  it('deviceStoreKilledNow reads the jar FRESH, either kill (a page left open)', () => {
    expect(speed.deviceStoreKilledNow()).toBe(false)
    set(DEVICE)
    expect(speed.deviceStoreKilledNow()).toBe(true)
    clear(DEVICE)
    expect(speed.deviceStoreKilledNow()).toBe(false)
    set(SPEED)
    expect(speed.deviceStoreKilledNow()).toBe(true)
  })
})
