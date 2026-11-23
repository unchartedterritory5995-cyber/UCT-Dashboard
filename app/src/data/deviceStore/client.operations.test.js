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
