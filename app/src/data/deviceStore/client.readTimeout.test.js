// @vitest-environment node
// A DEVICE READ THE WORKER NEVER ANSWERS (review of #2438, round 1 L1). A read is one worker message; the page
// waited for its answer for ever. A worker that hangs (its storage open never settling, a leader tab frozen in the
// background) left every asker of that key waiting for the page's life, and two such reads held both of the
// background lane's places, so no warm was read again until a reload. The switch itself was not hung (it falls to
// the server on its own timers), but nothing ever painted from the device again.
//
// Over a worker that answers only when the test says so, with fake timers:
//   T1 a background read not answered within READ_TIMEOUT_MS answers null and gives its place back: the next
//      waiting read is sent
//   T2 an urgent read times out the same way
//   T3 an answer that arrives AFTER the timeout is ignored (nothing cached from it), and the key is read afresh
//      the next time it is asked for
//   T4 an answered read leaves no timer behind: nothing is counted as timed out later
//   T5 dispose and a dead worker leave no timer behind either
//   T6 only reads time out: the ingest and visibility messages do not (an ingest downloads for minutes)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDeviceClient, READ_TIMEOUT_MS } from './client'

const COLS = (c = 1) => ({ t: new Float64Array([1, 2, 3]), o: new Float64Array([c, c, c]), h: new Float64Array([c, c, c]),
  l: new Float64Array([c, c, c]), c: new Float64Array([c, c, c]), v: new Float64Array([9, 9, 9]), build: 'b' })

function manualWorker() {
  const w = { onmessage: null, onerror: null, posted: [], terminate: vi.fn() }
  w.postMessage = (m) => { w.posted.push(m) }
  w.reads = () => w.posted.filter((m) => m.op === 'read').map((m) => `${m.sym}|${m.tf}`)
  w.answer = (sym, tf = 'D', res = COLS()) => {
    const m = w.posted.find((x) => x.op === 'read' && x.sym === sym && x.tf === tf && !x.answered)
    if (!m) throw new Error(`no unanswered read of ${sym}|${tf}`)
    m.answered = true
    w.onmessage({ data: { id: m.id, ok: true, res } })
  }
  return w
}
const boot = (opts = {}) => {
  const w = manualWorker()
  return { w, c: createDeviceClient({ makeWorker: () => w, afterPaint: (fn) => fn(), idle: (fn) => fn(), ...opts }) }
}
const turn = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('a device read the worker never answers', () => {
  it('the bound the cases below are written against', () => {
    expect(READ_TIMEOUT_MS).toBeGreaterThanOrEqual(2000)      // far above a real read (1 to 20 ms, a cold open a few hundred)
    expect(READ_TIMEOUT_MS).toBeLessThanOrEqual(30000)
  })

  it('T1 a background read not answered in time answers null and gives its place back', async () => {
    const { w, c } = boot()
    const ps = ['A', 'B', 'W1', 'W2'].map((s) => c.getBars(s, 'D'))
    expect(w.reads()).toEqual(['A|D', 'B|D'])
    let aDone = false
    ps[0].then(() => { aDone = true })
    await turn(READ_TIMEOUT_MS - 1)
    expect(aDone).toBe(false)
    expect(w.reads()).toEqual(['A|D', 'B|D'])
    await turn(2)
    expect(await ps[0]).toBeNull()
    expect(await ps[1]).toBeNull()
    expect(w.reads()).toEqual(['A|D', 'B|D', 'W1|D', 'W2|D'])   // the lane moved on
    expect(c.readTimeouts()).toBe(2)
    w.answer('W1'); w.answer('W2')
    expect((await ps[2]).t.length).toBe(3)
    expect(c.inFlight()).toBe(0)
  })

  it('T2 an urgent read times out the same way', async () => {
    const { c } = boot()
    const p = c.getBars('MINE', 'D', { urgent: true })
    await turn(READ_TIMEOUT_MS + 1)
    expect(await p).toBeNull()
    expect(c.readTimeouts()).toBe(1)
    expect(c.inFlight()).toBe(0)
  })

  it('T3 an answer after the timeout is ignored, and the key is read afresh when it is asked for again', async () => {
    const { w, c } = boot()
    const p = c.getBars('LATE', 'D')
    await turn(READ_TIMEOUT_MS + 1)
    expect(await p).toBeNull()
    w.answer('LATE', 'D', COLS(7))                             // the worker wakes up
    await turn()
    expect(c.peekBars('LATE', 'D')).toBeNull()                 // nothing was cached from the late answer
    const again = c.getBars('LATE', 'D')
    expect(w.reads().filter((k) => k === 'LATE|D')).toHaveLength(2)
    w.answer('LATE', 'D', COLS(8))
    expect((await again).c[0]).toBe(8)
  })

  it('T4 an answered read leaves no timer behind', async () => {
    const { w, c } = boot()
    const p = c.getBars('A', 'D')
    w.answer('A')
    expect((await p).t.length).toBe(3)
    expect(vi.getTimerCount()).toBe(0)
    await turn(READ_TIMEOUT_MS * 3)
    expect(c.readTimeouts()).toBe(0)
  })

  it('T5 dispose and a dead worker leave no timer behind', async () => {
    const a = boot()
    const ps = ['A', 'B', 'W1'].map((s) => a.c.getBars(s, 'D'))
    a.c.dispose()
    expect(await Promise.all(ps)).toEqual([null, null, null])
    expect(vi.getTimerCount()).toBe(0)
    expect(a.c.readTimeouts()).toBe(0)

    const b = boot()
    const qs = ['A', 'B'].map((s) => b.c.getBars(s, 'D'))
    b.w.onerror(new Error('boom'))
    expect(await Promise.all(qs)).toEqual([null, null])
    expect(vi.getTimerCount()).toBe(0)
    expect(b.c.readTimeouts()).toBe(0)
  })

  it('T6 only reads time out: the ingest and visibility messages wait as long as they take', async () => {
    const { w, c } = boot({ setIntervalFn: () => {} })
    c.start()                                                  // posts ingest + live (this test's afterPaint / idle run at once)
    await turn()
    const ops = w.posted.map((m) => m.op)
    expect(ops).toContain('ingest')
    expect(ops).toContain('live')
    const info = c.info()
    let infoDone = false
    info.then(() => { infoDone = true })
    await turn(READ_TIMEOUT_MS * 4)
    expect(infoDone).toBe(false)                               // still waiting, not timed out
    expect(c.readTimeouts()).toBe(0)
    c.dispose()
  })
})
