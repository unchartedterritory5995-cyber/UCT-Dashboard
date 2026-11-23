// The switch-speed instrument on its own (lib/switchSpeed.js): the buckets, the classes, what a take() holds, and
// every way a switch gives NO sample. The real handoff, real key and click events on real charts, and every
// trigger and route are in hooks/useSymbolHandoff.switchSpeed.test.jsx.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  SWITCH_BUCKET_EDGES_MS, SWITCH_UNDER_MS, SWITCH_TF, SWITCH_TRIGGER, SWITCH_ROUTE, SWITCH_COUNTERS, SWITCH_SPEED_GLOBAL,
  MAX_SWITCH_CELLS, MAX_SWITCH_MS, TRIGGER_LIST_KEY, ROUTE_OTHER,
  switchObserver, chartPainted, noteSwitchRoute, hintSwitchTrigger, setSwitchEnv, takeSwitchCounts, peekSwitchCounts,
  switchBucketOf, switchTfClass, __resetSwitchSpeedForTests, __setSwitchClockForTests,
} from './switchSpeed'

const G = 'charts:A'
const SCOPE = { board: 1 }
let frames
let clock
let clockReads

beforeEach(() => {
  __resetSwitchSpeedForTests()
  frames = []
  clock = 0
  clockReads = 0
  __setSwitchClockForTests(() => { clockReads += 1; return clock })
  vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length })
})
afterEach(() => { vi.unstubAllGlobals(); setSwitchEnv(); __resetSwitchSpeedForTests() })

const member = (tf = '30') => ({ key: {}, tf: () => tf })
const group = (...members) => new Map(members.map((m, i) => [i + 1, m]))
/** Run `fn` inside the dispatch of a real DOM event (so it is "the event in flight"); returns the event. */
function during(type, init, fn, target = document.body) {
  const ev = type.startsWith('key') ? new KeyboardEvent(type, { bubbles: true, ...init }) : new MouseEvent(type, { bubbles: true, ...init })
  const h = () => fn(ev)
  target.addEventListener(type, h, { once: true })
  target.dispatchEvent(ev)
  return ev
}
/** A press of ArrowDown that switches `members` to `sym`; returns the press time. */
function arrow(sym, members, g = G) {
  return during('keydown', { key: 'ArrowDown' }, () => switchObserver.press(SCOPE, g, sym, members)).timeStamp
}
/** The frame: the microtask that asks for it, then every callback asked for, with the clock at `at`. */
async function frame(at) {
  await Promise.resolve()
  await Promise.resolve()
  clock = at
  const run = frames.splice(0)
  run.forEach((cb) => cb(at))
  return run.length
}

describe('the vocabulary', () => {
  it('eleven fixed buckets; an edge belongs to the bucket above it, so "under 40" is exactly the first four', () => {
    expect(SWITCH_BUCKET_EDGES_MS).toEqual([16, 25, 33, 40, 50, 66, 100, 150, 250, 500])
    expect(SWITCH_BUCKET_EDGES_MS[3]).toBe(SWITCH_UNDER_MS)
    const at = (ms) => switchBucketOf(ms)
    expect([0, 15.9, 16, 24.9, 25, 32.9, 33, 39.9].map(at)).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
    expect([40, 49.9, 50, 66, 100, 150, 250, 499.9, 500, 59999].map(at)).toEqual([4, 4, 5, 6, 7, 8, 9, 9, 10, 10])
  })

  it('the timeframe classes: one minute, any other count of minutes, and D/W/M and beyond', () => {
    expect(['1'].map(switchTfClass)).toEqual([0])
    expect(['2', '5', '15', '30', '60', '240'].map(switchTfClass)).toEqual([1, 1, 1, 1, 1, 1])
    expect(['D', 'W', 'M', '2D', '3M', '', undefined].map(switchTfClass)).toEqual([2, 2, 2, 2, 2, 2, 2])
    expect(SWITCH_TF).toEqual(['intraday-1m', 'intraday-other', 'daily-plus'])
  })

  it('leaves {take, peek} where the beacon looks for it', () => {
    expect(SWITCH_SPEED_GLOBAL).toBe('__uctSwitchSpeed')
    expect(window[SWITCH_SPEED_GLOBAL].take).toBe(takeSwitchCounts)
    expect(window[SWITCH_SPEED_GLOBAL].peek).toBe(peekSwitchCounts)
  })
})

describe('one switch, one count', () => {
  it('a completed switch is ONE increment in ONE cell; take() hands it over as whole numbers and forgets it', async () => {
    const m = member('1')
    const t0 = arrow('BBB', group(m))
    chartPainted(m.key, 'BBB', 300, 'full')
    expect(await frame(t0 + 21)).toBe(1)
    const got = takeSwitchCounts()
    expect(got).toEqual({
      v: 1,
      //       tf 1m, store off, list-key, route other (nothing said how), outside the session; 21 ms -> bucket 16-25
      cells: [[0, 0, TRIGGER_LIST_KEY, ROUTE_OTHER, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
      counters: [0, 0, 0, 0, 0, 0],
    })
    const leaves = [got.v, ...got.cells.flat(), ...got.counters]
    expect(leaves.every((n) => Number.isInteger(n) && n >= 0)).toBe(true)
    expect(Object.keys(got).sort()).toEqual(['cells', 'counters', 'v'])
    expect(takeSwitchCounts()).toBeNull()
  })

  it('the cell says what the page is: the device store, the session, the trigger it was told, the slowest route reported', async () => {
    setSwitchEnv({ store: true, rth: () => true })
    const m = member('30')
    hintSwitchTrigger(SWITCH_TRIGGER.indexOf('typed'))
    const t0 = arrow('BBB', group(m))
    hintSwitchTrigger(-1)
    noteSwitchRoute(G, 'BBB', SWITCH_ROUTE.indexOf('now'))
    noteSwitchRoute(G, 'BBB', SWITCH_ROUTE.indexOf('prepare'))
    noteSwitchRoute(G, 'BBB', SWITCH_ROUTE.indexOf('deferred'))       // a faster one after a slower one changes nothing
    noteSwitchRoute(G, 'CCC', SWITCH_ROUTE.indexOf('daily-hold'))     // another symbol's route is not this switch's
    noteSwitchRoute('charts:B', 'BBB', SWITCH_ROUTE.indexOf('daily-hold'))
    chartPainted(m.key, 'BBB', 300, 'full')
    await frame(t0 + 120)
    expect(takeSwitchCounts().cells).toEqual([[1, 1, 2, 5, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]])
  })

  it('peek() reads without forgetting', async () => {
    const m = member()
    const t0 = arrow('BBB', group(m))
    chartPainted(m.key, 'BBB', 300, 'full')
    await frame(t0 + 5)
    expect(peekSwitchCounts()).toEqual(peekSwitchCounts())
    expect(takeSwitchCounts().cells).toHaveLength(1)
  })
})

describe('what is NOT a drawn chart', () => {
  it('a pass with no bars, a pass that re-set nothing, another symbol, or a chart that is not a member', async () => {
    const m = member()
    const t0 = arrow('BBB', group(m))
    chartPainted(m.key, 'BBB', 0, 'full')            // the symbol with no rows: nothing was drawn
    chartPainted(m.key, 'BBB', 300, 'noop')
    chartPainted(m.key, 'BBB', 300, 'incr')
    chartPainted(m.key, 'AAA', 300, 'full')          // the old symbol repainting
    chartPainted({}, 'BBB', 300, 'full')             // some other chart showing the same symbol
    expect(await frame(t0 + 10)).toBe(0)
    expect(peekSwitchCounts()).toBeNull()
    chartPainted(m.key, 'BBB', 300, 'full')
    expect(await frame(t0 + 30)).toBe(1)
    expect(takeSwitchCounts().cells[0].slice(5)).toEqual([0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0])
  })
})

describe('a switch that gives no sample is counted by why, and never in a bucket', () => {
  it('superseded: a newer press on the same group before the frame (another group\'s press does not touch it)', async () => {
    const a = member()
    const b = member()
    arrow('BBB', group(a))
    arrow('XXX', group(b), 'charts:B')
    const t1 = arrow('CCC', group(a))
    chartPainted(a.key, 'BBB', 300, 'full')          // the superseded symbol arriving late is nobody's sample
    expect(await frame(t1 + 10)).toBe(0)
    chartPainted(a.key, 'CCC', 300, 'full')
    await frame(t1 + 20)
    const got = takeSwitchCounts()
    expect(got.cells).toHaveLength(1)
    expect(got.cells[0].slice(5).reduce((x, y) => x + y, 0)).toBe(1)
    expect(got.counters[SWITCH_COUNTERS.indexOf('superseded')]).toBe(1)
  })

  it('unpressed: the symbol changed with no input event in flight, or inside one that is not an input', async () => {
    const m = member()
    switchObserver.press(SCOPE, G, 'BBB', group(m))                                   // no event at all (a link, a restore)
    chartPainted(m.key, 'BBB', 300, 'full')
    const ev = new Event('message')
    window.addEventListener('message', () => switchObserver.press(SCOPE, G, 'CCC', group(m)), { once: true })
    window.dispatchEvent(ev)                                                          // a scheduler task: not a press
    chartPainted(m.key, 'CCC', 300, 'full')
    expect(await frame(50)).toBe(0)
    // on its own it is not worth a report...
    expect(takeSwitchCounts()).toBeNull()
    // ...and rides with the next one
    const t0 = arrow('DDD', group(m))
    chartPainted(m.key, 'DDD', 300, 'full')
    await frame(t0 + 10)
    expect(takeSwitchCounts().counters[SWITCH_COUNTERS.indexOf('unpressed')]).toBe(2)
  })

  it('untracked: a group with a chart that has no paint identity (or no charts) cannot be seen drawing', async () => {
    arrow('BBB', group(member(), { tf: () => '30' }))
    arrow('CCC', new Map())
    arrow('DDD', null)
    expect(await frame(99)).toBe(0)
    expect(takeSwitchCounts()).toEqual({ v: 1, cells: [], counters: [0, 0, 0, 3, 0, 0] })
  })

  it('unclocked: a frame before its press, or longer after it than any switch takes', async () => {
    const m = member()
    const t0 = arrow('BBB', group(m))
    chartPainted(m.key, 'BBB', 300, 'full')
    await frame(t0 - 5)
    const t1 = arrow('CCC', group(m))
    chartPainted(m.key, 'CCC', 300, 'full')
    await frame(t1 + MAX_SWITCH_MS + 1)
    expect(takeSwitchCounts()).toEqual({ v: 1, cells: [], counters: [0, 0, 0, 0, 2, 0] })
  })

  it('abandoned: the page was hidden while it waited; the frame it gets on coming back is not a switch time', async () => {
    const m = member()
    const t0 = arrow('BBB', group(m))
    chartPainted(m.key, 'BBB', 300, 'full')
    await Promise.resolve()
    await Promise.resolve()
    expect(frames).toHaveLength(1)                   // the frame was asked for, and the page went away before it
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    try { document.dispatchEvent(new Event('visibilitychange')) } finally { delete document.visibilityState }
    await frame(t0 + 9000)
    expect(takeSwitchCounts()).toEqual({ v: 1, cells: [], counters: [0, 1, 0, 0, 0, 0] })
  })

  it('overflow: at most MAX_SWITCH_CELLS combinations between two sends', async () => {
    const ms = { 0: member('1'), 1: member('30'), 2: member('D') }
    let n = 0
    for (let tf = 0; tf < SWITCH_TF.length; tf++) {
      for (let trig = 0; trig < SWITCH_TRIGGER.length; trig++) {
        for (let route = 0; route < SWITCH_ROUTE.length; route++) {
          hintSwitchTrigger(trig)
          const t0 = arrow(`S${n}`, group(ms[tf]))
          noteSwitchRoute(G, `S${n}`, route)
          chartPainted(ms[tf].key, `S${n}`, 300, 'full')
          await frame(t0 + 10)
          n += 1
        }
      }
    }
    expect(n).toBe(72)
    const got = takeSwitchCounts()
    expect(got.cells).toHaveLength(MAX_SWITCH_CELLS)
    expect(got.counters[SWITCH_COUNTERS.indexOf('overflow')]).toBe(72 - MAX_SWITCH_CELLS)
    expect(new Set(got.cells.map((c) => c.slice(0, 5).join())).size).toBe(MAX_SWITCH_CELLS)
  })
})

describe('the press does no measuring', () => {
  it('no clock is read and no frame is asked for until the last chart has drawn; the count is made in the frame callback', async () => {
    const a = member('30')
    const b = member('D')
    const t0 = arrow('BBB', group(a, b))
    chartPainted(a.key, 'BBB', 300, 'full')
    await Promise.resolve()
    await Promise.resolve()
    expect([clockReads, frames.length]).toEqual([0, 0])        // one chart of two: nothing yet
    chartPainted(b.key, 'BBB', 900, 'full')
    expect([clockReads, frames.length]).toEqual([0, 0])        // nothing in the pass that drew it either
    await Promise.resolve()
    expect([clockReads, frames.length]).toEqual([0, 1])        // a frame is asked for, after the pass
    expect(peekSwitchCounts()).toBeNull()
    clock = t0 + 38
    frames.splice(0).forEach((cb) => cb(t0 + 38))
    expect(clockReads).toBe(1)
    expect(takeSwitchCounts().cells).toEqual([[1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]])   // the finer chart's class; 33-40
  })
})
