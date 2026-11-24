// @vitest-environment jsdom
// A MEMBER'S OFF IN THE SAME PAGE LOAD, end to end (review of #2537 head 24fe13dc8f, Z-1). Settings -> Faster charts on
// this device -> Off writes 'uct.deviceStore' = '0'. The switch has already decided this load (once per load), so before
// this a member on the default who picked Off and then opened a chart still started the store, and the first chart
// paint began the ~80 MB download that the next load deletes. Through the real doors: the switch deciding from a desktop
// screen, source.deviceSource, the real client over a stand-in Worker, the real localStorage and the real kill latch
// (lib/chartSpeed), nothing injected but the worker, the paint and idle hooks and the beat's timer:
//   E1 Off picked before any chart: the first device read starts nothing (no Worker, no request), answers null, writes
//      no marker, and the page counts it as a kill seen (#2580's latch: no device row paints)
//   E2 Off picked while the store runs: stopped on the next visible beat; the bar store's kill watcher is told once
//   E3 the reverse, Automatic, changes nothing until the next load (a load that decided OFF stays off; the next is ON)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const KEY = 'uct.deviceStore'
const FILES_KEY = 'uct.deviceStore.files'
const realMatchMedia = window.matchMedia
const realWorker = globalThis.Worker

function mouseDesktop() {
  const feature = (f) => {
    const m = /^\(\s*([a-z-]+)\s*:\s*([a-z0-9-]+)\s*\)$/.exec(f.trim())
    if (m && m[1] === 'min-width') return 1440 >= Number(m[2].replace(/px$/, ''))
    if (m && m[1] === 'pointer') return m[2] === 'fine'
    if (m && m[1] === 'hover') return m[2] === 'hover'
    throw new Error(`cannot evaluate ${f}`)
  }
  window.matchMedia = (q) => ({ matches: String(q).split(/\band\b/).map(feature).every(Boolean), media: q, addEventListener() {}, removeEventListener() {} })
}

let workers = []
class StandInWorker {
  constructor(url, opts) { this.url = String(url); this.opts = opts; this.posted = []; this.terminated = false; workers.push(this) }
  postMessage(m) { this.posted.push(m) }
  terminate() { this.terminated = true }
}
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)) }

/** A fresh page load: the switch, the kills, the latch, source.js and the client, all evaluated afresh. */
async function pageLoad() {
  vi.resetModules()
  workers = []
  const sw = await import('./switch')
  const speed = await import('../../lib/chartSpeed')
  const src = await import('./source')
  return { sw, speed, src }
}

beforeEach(() => {
  localStorage.clear(); mouseDesktop(); globalThis.Worker = StandInWorker
  document.cookie = 'uct_chart_speed=; max-age=0; path=/'; document.cookie = 'uct_device_store=; max-age=0; path=/'
})
afterEach(() => { window.matchMedia = realMatchMedia; globalThis.Worker = realWorker; localStorage.clear() })

describe("Z-1 a member's Off reaches the page load it was picked in", () => {
  it('E1 Off picked before any chart: the first device read starts nothing, answers null, writes no marker; the page counts it as a kill seen', async () => {
    const { sw, speed, src } = await pageLoad()
    expect(sw.deviceStoreEnabled()).toBe(true)                          // decided ON for this load (a desktop, no key)
    localStorage.setItem(KEY, '0')                                      // the member picks Off in Settings
    const ds = src.deviceSource()
    expect(ds).not.toBeNull()                                           // the bar store still has its device source...
    expect(ds.peek('AAPL', 'D')).toBeNull()
    const read = ds.read('AAPL', 'D')
    await settle()
    // ...and it answers nothing, at once (a read sent to a worker would wait for its answer: 'pending')
    expect(await Promise.race([read, new Promise((r) => setTimeout(() => r('pending'), 50))])).toBeNull()
    expect(workers).toHaveLength(0)                                     // no worker: no request, no pack download
    expect(localStorage.getItem(FILES_KEY)).toBeNull()                  // nothing to clean up later either
    expect(speed.deviceStoreKillSeen()).toBe(true)                      // device rows refuse to paint (#2580)
    expect(sw.deviceStoreEnabled()).toBe(true)                          // the per-load latch itself is untouched
  })

  it('E2 Off picked while the store runs: stopped on the next visible beat, and the bar store\'s kill watcher is told once', async () => {
    const { speed } = await pageLoad()
    const { createDeviceClient } = await import('./client')
    const watcher = vi.fn()
    speed.onDeviceStoreKill(watcher)
    const env = { ticks: [], idles: [] }
    const c = createDeviceClient({
      afterPaint: (fn) => fn(), idle: (fn) => env.idles.push(fn), manifestUrl: () => 'https://x.test/latest.json',
      visible: () => true, onVisibilityChange: () => {}, setIntervalFn: (fn) => { env.ticks.push(fn); return 1 }, clearIntervalFn: () => {},
    })
    c.start()
    for (const fn of env.idles.splice(0)) fn()
    expect(workers).toHaveLength(1)
    expect(workers[0].posted.map((m) => m.op)).toContain('ingest')
    for (const fn of env.ticks) fn()                                     // a beat with no key: runs on
    expect(workers[0].terminated).toBe(false)
    localStorage.setItem(KEY, '0')
    for (const fn of env.ticks) fn()                                     // the next visible beat
    expect(workers[0].terminated).toBe(true)
    expect(watcher).toHaveBeenCalledTimes(1)
    expect(speed.deviceStoreKillSeen()).toBe(true)
    for (const fn of env.ticks) fn()
    expect(watcher).toHaveBeenCalledTimes(1)
    expect(await c.getBars('AAPL', 'D')).toBeNull()
  })

  it('E3 the reverse: a load that decided OFF on the member\'s 0 stays off after Automatic (no client, no worker); the next load is ON', async () => {
    localStorage.setItem(KEY, '0')
    let { sw, speed, src } = await pageLoad()
    expect([sw.deviceStoreEnabled(), sw.deviceStoreOffReason()]).toEqual([false, 'member-off'])
    localStorage.removeItem(KEY)                                        // the member picks Automatic
    expect(src.deviceSource({ afterPaint: () => {}, idle: () => {} })).toBeNull()
    await settle()
    expect(workers).toHaveLength(0)
    expect(sw.deviceStoreEnabled()).toBe(false)
    expect(speed.deviceStoreKillSeen()).toBe(false)
    ;({ sw, src } = await pageLoad())                                   // the next page load
    expect(sw.deviceStoreEnabled()).toBe(true)
    expect(src.deviceSource()).not.toBeNull()
  })
})
