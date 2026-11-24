// @vitest-environment node
// THE PAGE'S HALF OF A LONG-LIVED PAGE (review of #2537, M2 and M9). A tab or the desktop app left open for days:
//   M2  re-asks the leader to bring the seed up to date every 30 minutes WHILE VISIBLE, on the beat it already has
//       (no timer of its own), at idle (never ahead of a paint), one ask queued at a time, nothing while hidden
//   M9  a kill that reaches an open page (the cookie, refreshed by any auth answer; read fresh on a visible beat)
//       stops its worker for good: no read, no feed report, no ingest after it
import { describe, it, expect, vi } from 'vitest'
import * as C from './client'

const { createDeviceClient } = C
const MIN = 60_000
const URL_ = 'https://x.test/seed/latest.json'

function fakeWorker() {
  const w = { posted: [], onmessage: null, onerror: null, terminate: vi.fn() }
  w.postMessage = (m) => { w.posted.push(m) }
  return w
}
const ops = (w, op) => w.posted.filter((m) => m.op === op)

function harness(extra = {}) {
  const w = fakeWorker()
  const clock = { t: 1_800_000_000_000 }
  const env = { vis: true, ticks: [], change: null, idles: [], periods: [], cleared: [] }
  const c = createDeviceClient({
    makeWorker: () => w, afterPaint: (fn) => fn(), idle: (fn) => { env.idles.push(fn) },
    manifestUrl: () => URL_, now: () => clock.t,
    visible: () => env.vis, onVisibilityChange: (cb) => { env.change = cb },
    setIntervalFn: (fn, ms) => { env.ticks.push(fn); env.periods.push(ms); return 77 },
    clearIntervalFn: (h) => { env.cleared.push(h) },
    ...extra,
  })
  const idleNow = () => { for (const fn of env.idles.splice(0)) fn() }
  const tick = () => { for (const fn of env.ticks) fn() }
  return { w, c, clock, env, idleNow, tick }
}

describe('M2 a page left open re-checks the seed', () => {
  it('the number: every 30 minutes while visible', () => {
    expect(C.RECHECK_MS).toBe(30 * MIN)
  })

  it('every 30 minutes while visible, at idle, one ask queued at a time, never while hidden', () => {
    const h = harness()
    h.c.start()
    h.idleNow()
    expect(ops(h.w, 'ingest')).toEqual([expect.objectContaining({ manifestUrl: URL_ })])
    expect(ops(h.w, 'ingest')[0].recheck).toBeUndefined()                // the page load's own ingest
    expect(h.env.periods).toEqual([60_000])                              // the beat it already had: no new timer

    h.clock.t += 29 * MIN
    h.tick(); h.idleNow()
    expect(ops(h.w, 'ingest')).toHaveLength(1)

    h.clock.t += MIN
    h.tick()
    expect(h.env.idles).toHaveLength(1)                                   // due: waits for idle
    expect(ops(h.w, 'ingest')).toHaveLength(1)
    h.tick()
    expect(h.env.idles).toHaveLength(1)                                   // one ask queued at a time
    h.idleNow()
    expect(ops(h.w, 'ingest')).toHaveLength(2)
    expect(ops(h.w, 'ingest')[1]).toMatchObject({ op: 'ingest', manifestUrl: URL_, recheck: true })
    h.tick(); h.idleNow()
    expect(ops(h.w, 'ingest')).toHaveLength(2)                            // just asked

    // hidden: nothing, however long
    h.env.vis = false
    h.clock.t += 120 * MIN
    h.env.change(); h.tick(); h.idleNow()
    expect(ops(h.w, 'ingest')).toHaveLength(2)

    // looked at again: the re-check that is due goes at once (at idle)
    h.env.vis = true
    h.env.change()
    h.idleNow()
    expect(ops(h.w, 'ingest')).toHaveLength(3)
    expect(ops(h.w, 'ingest')[2].recheck).toBe(true)

    // hidden again between the beat and the idle callback: nothing is asked, and the next visible beat asks
    h.clock.t += 31 * MIN
    h.tick()
    h.env.vis = false
    h.idleNow()
    expect(ops(h.w, 'ingest')).toHaveLength(3)
    h.env.vis = true
    h.tick(); h.idleNow()
    expect(ops(h.w, 'ingest')).toHaveLength(4)
  })
})

describe('(review of #2563 round 2) a page left ON for days keeps its run stamp fresh, on beats it already has', () => {
  it('the 30-minute re-check and every committed generation (or held-seed status) stamp the run; no timer of its own', () => {
    const noteFiles = vi.fn()
    const h = harness({ noteFiles })
    h.c.start()
    expect(noteFiles).toHaveBeenLastCalledWith(h.clock.t)               // start stamps
    h.idleNow()
    const t0 = h.clock.t
    h.clock.t += 30 * MIN
    h.tick(); h.idleNow()                                                // the re-check goes...
    expect(ops(h.w, 'ingest')).toHaveLength(2)
    expect(noteFiles).toHaveBeenLastCalledWith(t0 + 30 * MIN)           // ...and stamps
    h.clock.t += 5 * MIN
    h.w.onmessage({ data: { type: 'event', event: { type: 'gen', tf: 'D', build: 'b' } } })
    expect(noteFiles).toHaveBeenLastCalledWith(t0 + 35 * MIN)           // a generation committed: stamped
    h.clock.t += 1 * MIN
    h.w.onmessage({ data: { type: 'status', role: 'leader', supported: true, info: { tfs: { D: { build: 'b' } } } } })
    expect(noteFiles).toHaveBeenLastCalledWith(t0 + 36 * MIN)           // a held seed reported: stamped
    expect(h.env.periods).toEqual([60_000])                              // still only the beat it already had
  })
})

describe('M9 a kill that reaches an open page', () => {
  it('on the next visible beat the worker is stopped for good, and nothing starts it again', async () => {
    let killed = false
    const h = harness({ killed: () => killed })
    h.c.start()
    h.idleNow()
    h.tick()
    expect(h.w.terminate).not.toHaveBeenCalled()
    killed = true
    h.tick()
    expect(h.w.terminate).toHaveBeenCalledTimes(1)
    expect(h.env.cleared).toEqual([77])                                   // the beat itself is cleared
    const n = h.w.posted.length
    expect(await h.c.getBars('AAA', 'D')).toBeNull()
    expect(h.c.peekBars('AAA', 'D')).toBeNull()
    h.clock.t += 60 * MIN
    h.tick(); h.env.change(); h.idleNow()
    expect(h.w.posted.length).toBe(n)                                     // no read, no live report, no ingest
    expect(h.w.terminate).toHaveBeenCalledTimes(1)
  })

  it('CONTROL: hidden, the kill is not read (nothing runs while hidden); the next visible beat reads it', () => {
    const killed = vi.fn(() => true)
    const h = harness({ killed })
    h.c.start()
    h.idleNow()
    h.env.vis = false
    h.tick()
    expect(killed).not.toHaveBeenCalled()
    expect(h.w.terminate).not.toHaveBeenCalled()
    h.env.vis = true
    h.tick()
    expect(h.w.terminate).toHaveBeenCalledTimes(1)
  })
})

// (review of #2537 head 24fe13dc8f, Z-1) A MEMBER'S OFF IN THE SAME PAGE LOAD. The switch decides once per load, so a
// member on the default who picked Off (Settings -> Faster charts on this device: the key becomes '0') and then opened a
// chart still started the store, and its first paint began the ~80 MB download the next load deletes. The client reads
// the key FRESH (switch.deviceStoreKeyNow) where it already looks: before its first start (Off: it never starts), at the
// first paint's idle before the ingest, and on the visible beat that reads the kills. Off stops it exactly as a kill
// does, and the page is told (lib/chartSpeed.noteDeviceStoreStopped: #2580's latch, so device rows stop painting).
// Only '0' stops it: Automatic (no key), a tester's '1' or any other value change nothing until the next load.
describe("Z-1 a member's Off reaching this page load", () => {
  /** The harness, plus the key as stored NOW (`h.env.key`, switch.deviceStoreKeyNow's names) and the page's latch. */
  function offHarness(key0 = 'absent') {
    let env = null
    const keyNow = vi.fn(() => env.key)
    const onStop = vi.fn()
    const noteFiles = vi.fn()
    let made = null                                                      // the harness's own fake worker, counted
    const makeWorker = vi.fn(() => made)
    const h = harness({ keyNow, onStop, noteFiles, makeWorker })
    env = h.env
    env.key = key0
    made = h.w
    return { ...h, keyNow, onStop, makeWorker, noteFiles }
  }

  it('Off picked before the first start: the client never starts: no worker, no message, no marker, no beat; the page is told once', async () => {
    const h = offHarness('off')
    h.c.start()
    h.idleNow()
    expect(h.makeWorker).not.toHaveBeenCalled()
    expect(h.w.posted).toEqual([])
    expect(h.noteFiles).not.toHaveBeenCalled()
    expect(h.env.periods).toEqual([])
    expect(h.onStop).toHaveBeenCalledTimes(1)
    expect(await h.c.getBars('AAA', 'D')).toBeNull()
    h.c.start()                                                          // asked again: still nothing
    expect(h.makeWorker).not.toHaveBeenCalled()
  })

  it('Off picked after the start, before the first paint\'s idle: the ingest is never asked, the worker stops, no beat', () => {
    const h = offHarness()
    h.c.start()
    expect(h.makeWorker).toHaveBeenCalledTimes(1)
    h.env.key = 'off'
    h.idleNow()
    expect(ops(h.w, 'ingest')).toEqual([])
    expect(ops(h.w, 'live')).toEqual([])
    expect(h.w.terminate).toHaveBeenCalledTimes(1)
    expect(h.env.periods).toEqual([])
    expect(h.onStop).toHaveBeenCalledTimes(1)
  })

  it('Off picked while the store runs: stopped on the next visible beat, exactly as for a kill', async () => {
    const h = offHarness()
    h.c.start()
    h.idleNow()
    expect(ops(h.w, 'ingest')).toHaveLength(1)
    h.tick()
    expect(h.w.terminate).not.toHaveBeenCalled()
    h.env.key = 'off'
    h.tick()
    expect(h.w.terminate).toHaveBeenCalledTimes(1)
    expect(h.env.cleared).toEqual([77])
    expect(h.onStop).toHaveBeenCalledTimes(1)
    const n = h.w.posted.length
    expect(await h.c.getBars('AAA', 'D')).toBeNull()
    h.clock.t += 60 * MIN
    h.tick(); h.env.change(); h.idleNow()
    expect(h.w.posted.length).toBe(n)
    expect(h.onStop).toHaveBeenCalledTimes(1)
  })

  it('the reverse changes nothing in this load: no key, a tester\'s 1 or any other value never stop it; stopped by Off, Automatic does not restart it', () => {
    const h = offHarness()
    h.c.start()
    h.idleNow()
    for (const k of ['absent', 'on', 'not-a-choice', 'unreadable']) { h.env.key = k; h.tick(); h.env.change() }
    expect(h.w.terminate).not.toHaveBeenCalled()
    expect(h.onStop).not.toHaveBeenCalled()
    h.env.key = 'off'
    h.tick()
    expect(h.w.terminate).toHaveBeenCalledTimes(1)
    const n = h.w.posted.length
    h.env.key = 'absent'                                                 // Automatic, picked after the Off
    h.clock.t += 60 * MIN
    h.tick(); h.env.change(); h.idleNow(); h.c.start()
    expect(h.w.posted.length).toBe(n)
    expect(h.makeWorker).toHaveBeenCalledTimes(1)
  })

  it('CONTROL: hidden, the key is not read (nothing runs while hidden); the next visible beat reads it', () => {
    const h = offHarness()
    h.c.start()
    h.idleNow()
    const before = h.keyNow.mock.calls.length
    expect(before).toBeGreaterThan(0)                                    // read before the start and before the ingest
    h.env.vis = false
    h.env.key = 'off'
    h.tick()
    expect(h.keyNow.mock.calls.length).toBe(before)
    expect(h.w.terminate).not.toHaveBeenCalled()
    h.env.vis = true
    h.tick()
    expect(h.keyNow.mock.calls.length).toBe(before + 1)
    expect(h.w.terminate).toHaveBeenCalledTimes(1)
  })
})
