// @vitest-environment jsdom
// app/src/lib/chartSpeed.test.js — the server's kill switch over the two chart speed switches.
//
// The server writes `uct_chart_speed=0` beside every auth payload while CHART_SPEED_ENABLED is off
// (api/routers/auth.py; tests/test_chart_speed_kill.py is its half). Here: the cookie is read exactly,
// once per page load, and BOTH switches go off over a member's own local '1', and come back to the
// member's own choice once the kill is cleared.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { CHART_SPEED_COOKIE, chartSpeedKilled, cookieKillsChartSpeed, __resetChartSpeedForTests } from './chartSpeed'
import { neighborFramesOn, __setNeighborFramesForTests, NEIGHBOR_FRAMES_KEY } from '../components/chart/neighborFrames'
import { deviceStoreEnabled, DEVICE_STORE_KEY } from '../data/deviceStore/switch'

const kill = () => { document.cookie = `${CHART_SPEED_COOKIE}=0; path=/` }
const clear = () => { document.cookie = `${CHART_SPEED_COOKIE}=; max-age=0; path=/` }
const newPageLoad = () => { __resetChartSpeedForTests(); __setNeighborFramesForTests(null) }

beforeEach(() => { clear(); localStorage.clear(); newPageLoad() })
afterEach(() => { clear(); localStorage.clear(); newPageLoad() })

describe('cookieKillsChartSpeed — the exact cookie, nothing like it', () => {
  it.each([
    ['uct_chart_speed=0', true],
    ['a=1; uct_chart_speed=0; b=2', true],
    ['a=1;uct_chart_speed=0', true],
    [' uct_chart_speed = 0 ', true],
    ['uct_chart_speed=1', false],
    ['uct_chart_speed=', false],
    ['uct_chart_speed=00', false],
    ['xuct_chart_speed=0', false],
    ['uct_chart_speed_x=0', false],
    ['a=uct_chart_speed=0', false],
    ['', false],
    [null, false],
    [undefined, false],
  ])("%j -> %s", (jar, killed) => {
    expect(cookieKillsChartSpeed(jar)).toBe(killed)
  })
})

describe('chartSpeedKilled — the jar, read once per page load', () => {
  it('reads the kill from document.cookie', () => {
    kill(); newPageLoad()
    expect(chartSpeedKilled()).toBe(true)
  })

  it('no cookie: not killed (fail open)', () => {
    expect(chartSpeedKilled()).toBe(false)
  })

  it('latched: a kill arriving mid-load waits for the next load, so both switches agree within one', () => {
    expect(chartSpeedKilled()).toBe(false)
    kill()
    expect(chartSpeedKilled()).toBe(false)
    newPageLoad()
    expect(chartSpeedKilled()).toBe(true)
  })
})

describe('⛔ both speed switches: the server kill wins over a local 1', () => {
  it('neighbor frames: on by default, off when killed, even with a local 1', () => {
    expect(neighborFramesOn()).toBe(true)
    localStorage.setItem(NEIGHBOR_FRAMES_KEY, '1')
    newPageLoad()
    expect(neighborFramesOn()).toBe(true)
    kill(); newPageLoad()
    expect(neighborFramesOn()).toBe(false)
    localStorage.removeItem(NEIGHBOR_FRAMES_KEY)
    newPageLoad()
    expect(neighborFramesOn()).toBe(false)
  })

  it('device store: a local 1 turns it on, the kill turns it off over that 1', () => {
    localStorage.setItem(DEVICE_STORE_KEY, '1')
    newPageLoad()
    expect(deviceStoreEnabled()).toBe(true)
    kill(); newPageLoad()
    expect(deviceStoreEnabled()).toBe(false)
  })

  it('cleared kill: each switch is back on the member\'s OWN choice', () => {
    localStorage.setItem(DEVICE_STORE_KEY, '1')
    localStorage.setItem(NEIGHBOR_FRAMES_KEY, '0')
    kill(); newPageLoad()
    expect([deviceStoreEnabled(), neighborFramesOn()]).toEqual([false, false])
    clear(); newPageLoad()
    expect([deviceStoreEnabled(), neighborFramesOn()]).toEqual([true, false])
  })
})
