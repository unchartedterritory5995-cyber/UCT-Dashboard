// The neighbor-frames idle queue and scan channel: work happens ONLY in idle callbacks, at most one slice
// of it per callback, nearest rows first across every chart, and a key or a press ends every queued piece.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  scheduleIdle, cancelIdle, cancelIdleFor, __idleQueueLength, IDLE_SLICE_MS,
  publishScanNeighbors, scanNeighborsFor, subscribeScanNeighbors, __resetScanForTests,
  __setNeighborFramesForTests, neighborFramesOn, NEIGHBOR_FRAMES_KEY,
} from './neighborFrames'

let idle = []      // queued idle callbacks: {h, cb}
let nextH = 0
let clock = 0
beforeEach(() => {
  idle = []
  clock = 0
  vi.stubGlobal('requestIdleCallback', (cb) => { nextH += 1; idle.push({ h: nextH, cb }); return nextH })
  vi.stubGlobal('cancelIdleCallback', (h) => { idle = idle.filter((x) => x.h !== h) })
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  __resetScanForTests()
  cancelIdle()
})
afterEach(() => {
  cancelIdle()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  __setNeighborFramesForTests(null)
})
/** Run the next idle callback the browser would, offering `remaining` ms. */
const fireIdle = (remaining = 50) => {
  const x = idle.shift()
  if (x) x.cb({ timeRemaining: () => remaining, didTimeout: false })
  return !!x
}
/** A task of `n` pieces, each costing `ms` on the fake clock, logging `${name}${i}`. */
function* task(log, name, n, ms) {
  for (let i = 0; i < n; i++) { clock += ms; log.push(`${name}${i}`); yield }
}

describe('the idle queue', () => {
  it('nothing runs until the browser is idle', () => {
    const log = []
    scheduleIdle('a', 0, task(log, 'a', 3, 1))
    expect(log).toEqual([])
    expect(idle.length).toBe(1)
  })

  it('one callback does at most a slice of work, however long the browser offers, and asks again', () => {
    const log = []
    scheduleIdle('a', 0, task(log, 'a', 20, 3))
    fireIdle(50)
    // 3 ms pieces in a 10 ms slice: it stops once less than the minimum is left
    expect(log.length).toBeLessThanOrEqual(Math.ceil(IDLE_SLICE_MS / 3))
    expect(log.length).toBeGreaterThan(0)
    expect(idle.length).toBe(1)
    while (fireIdle(50)) { /* drain */ }
    expect(log.length).toBe(20)
    expect(__idleQueueLength()).toBe(0)
  })

  it('a short idle period gets a short slice', () => {
    const log = []
    scheduleIdle('a', 0, task(log, 'a', 20, 1))
    fireIdle(3)
    expect(log.length).toBeLessThanOrEqual(2)
  })

  it('the nearest rank runs first across owners (+1 of both charts before +2 of either)', () => {
    const log = []
    scheduleIdle('daily', 2, task(log, 'D+2.', 1, 1))
    scheduleIdle('daily', 0, task(log, 'D+1.', 1, 1))
    scheduleIdle('hourly', 2, task(log, 'H+2.', 1, 1))
    scheduleIdle('hourly', 0, task(log, 'H+1.', 1, 1))
    while (fireIdle(50)) { /* drain */ }
    expect(log).toEqual(['D+1.0', 'H+1.0', 'D+2.0', 'H+2.0'])
  })

  it('a key press ends every queued piece; nothing queued before it runs after it', () => {
    const log = []
    scheduleIdle('a', 0, task(log, 'a', 50, 4))
    fireIdle(50)
    const done = log.length
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    expect(__idleQueueLength()).toBe(0)
    while (fireIdle(50)) { /* drain */ }
    expect(log.length).toBe(done)
  })

  it('a press (pointer) ends them too, and one owner can drop only its own', () => {
    const log = []
    scheduleIdle('a', 0, task(log, 'a', 5, 1))
    scheduleIdle('b', 0, task(log, 'b', 5, 1))
    cancelIdleFor('a')
    while (fireIdle(50)) { /* drain */ }
    expect(log.every((x) => x.startsWith('b'))).toBe(true)
    scheduleIdle('c', 0, task(log, 'c', 5, 1))
    window.dispatchEvent(new Event('pointerdown'))
    expect(__idleQueueLength()).toBe(0)
  })

  it('an input already waiting starts no piece: the queue is dropped at once', () => {
    const log = []
    scheduleIdle('a', 0, task(log, 'a', 20, 1))
    vi.stubGlobal('navigator', { ...navigator, scheduling: { isInputPending: () => true } })
    fireIdle(50)
    expect(log).toEqual([])
    expect(__idleQueueLength()).toBe(0)
  })

  it('without requestIdleCallback nothing is queued at all (no timer stands in for idleness)', () => {
    vi.stubGlobal('requestIdleCallback', undefined)
    const log = []
    let started = false
    function* t() { started = true; log.push('x'); yield }
    scheduleIdle('a', 0, t())
    expect(__idleQueueLength()).toBe(0)
    expect(started).toBe(false)
  })

  it('a piece that throws ends its task, not the queue', () => {
    const log = []
    function* bad() { yield; throw new Error('x') }
    scheduleIdle('a', 0, bad())
    scheduleIdle('b', 1, task(log, 'b', 2, 1))
    while (fireIdle(50)) { /* drain */ }
    expect(log).toEqual(['b0', 'b1'])
  })
})

describe('the scan channel', () => {
  it('off: nothing is published', () => {
    __setNeighborFramesForTests(false)
    publishScanNeighbors('AAA', ['BBB'], ['ZZZ'])
    expect(scanNeighborsFor('AAA')).toEqual([])
  })

  it('on: ±1 before ±2, ahead first at each distance, the centre and repeats left out', () => {
    __setNeighborFramesForTests(true)
    const seen = []
    const off = subscribeScanNeighbors((c) => seen.push(c))
    publishScanNeighbors('aaa', ['bbb', 'ccc', 'ddd'], ['zzz', 'aaa', 'bbb'])
    expect(scanNeighborsFor('AAA')).toEqual(['BBB', 'ZZZ', 'CCC'])
    expect(seen).toEqual(['AAA'])
    off()
    publishScanNeighbors('BBB', ['CCC'], ['AAA'])
    expect(seen).toEqual(['AAA'])
    expect(scanNeighborsFor('nope')).toEqual([])
  })

  it('the switch is ON by default; only the stored value "0" turns it off', () => {
    __setNeighborFramesForTests(null)
    try { localStorage.setItem(NEIGHBOR_FRAMES_KEY, '0') } catch { /* */ }
    expect(neighborFramesOn()).toBe(false)
    __setNeighborFramesForTests(null)
    try { localStorage.setItem(NEIGHBOR_FRAMES_KEY, '1') } catch { /* */ }
    expect(neighborFramesOn()).toBe(true)
    __setNeighborFramesForTests(null)
    try { localStorage.removeItem(NEIGHBOR_FRAMES_KEY) } catch { /* */ }
    expect(neighborFramesOn()).toBe(true)
    __setNeighborFramesForTests(null)
    try { localStorage.setItem(NEIGHBOR_FRAMES_KEY, 'yes') } catch { /* */ }
    expect(neighborFramesOn()).toBe(true)
    try { localStorage.removeItem(NEIGHBOR_FRAMES_KEY) } catch { /* */ }
  })
})
