// @vitest-environment node
// P4-L2 (review of #2558): A RE-READ THAT ASKS FOR A NEWER COPY IS NOT ANSWERED BY THE COPY IT ALREADY HAS. The switch
// refuses a device copy that is short of its current bucket ('stale') and re-reads it. That re-read went through the
// client's recently-read cache (SYNC_CACHE_TTL_MS, 20 s), which answered with the very copy just refused, so a key read just
// before a minute boundary stayed refused for up to 20 s after the device had the minute. A read may now say what it
// already holds (`newerThan`, the refused copy's `through`):
//   N1 a cached copy no newer than that is not the answer: the worker is asked, and its newer copy is returned (and kept)
//   N2 a cached copy that IS newer answers at once, as before (no worker message)
//   N3 a read that does not say (every other read) is answered by the cache exactly as before
//   N4 one read per key in flight: a second ask for a newer copy while one is out joins it (one worker message)
//   N5 the lanes are kept: a background read asking for a newer copy takes a background place (BACKGROUND_READS_MAX at
//      a time), an urgent one goes at once and takes none
import { describe, it, expect, vi } from 'vitest'
import { createDeviceClient, BACKGROUND_READS_MAX } from './client'

const COLS = (through, c = 1) => ({ t: new Float64Array([1, 2, 3]), o: new Float64Array([c, c, c]), h: new Float64Array([c, c, c]),
  l: new Float64Array([c, c, c]), c: new Float64Array([c, c, c]), v: new Float64Array([9, 9, 9]), build: 'b', through })

/** A worker that records what it is sent and answers a read only when told to. */
function manualWorker() {
  const w = { onmessage: null, onerror: null, posted: [], terminate: vi.fn() }
  w.postMessage = (m) => { w.posted.push(m) }
  w.reads = () => w.posted.filter((m) => m.op === 'read').map((m) => `${m.sym}|${m.tf}`)
  w.answer = (sym, tf, res) => {
    const m = w.posted.find((x) => x.op === 'read' && x.sym === sym && x.tf === tf && !x.answered)
    if (!m) throw new Error(`no unanswered read of ${sym}|${tf}`)
    m.answered = true
    w.onmessage({ data: { id: m.id, ok: true, res } })
  }
  return w
}
const tick = () => new Promise((r) => setTimeout(r, 0))
const boot = () => {
  const w = manualWorker()
  return { w, c: createDeviceClient({ makeWorker: () => w, afterPaint: () => {} }) }
}
/** Read `sym` once and let the cache keep it (through `through`). */
async function cached(w, c, sym, through) {
  const p = c.getBars(sym, '1', { urgent: true })
  w.answer(sym, '1', COLS(through))
  expect((await p).through).toBe(through)
  expect(c.peekBars(sym, '1').through).toBe(through)
}

describe('a re-read that asks for a newer copy', () => {
  it('N1 a cached copy no newer than asked is not the answer: the worker is asked, its newer copy returned and kept', async () => {
    const { w, c } = boot()
    await cached(w, c, 'AAA', 100)
    const p = c.getBars('AAA', '1', { urgent: true, newerThan: 100 })
    expect(w.reads()).toEqual(['AAA|1', 'AAA|1'])                      // a second worker read, well inside the TTL
    w.answer('AAA', '1', COLS(160))
    expect((await p).through).toBe(160)
    expect(c.peekBars('AAA', '1').through).toBe(160)
  })

  it('N2 a cached copy that is newer than asked answers at once', async () => {
    const { w, c } = boot()
    await cached(w, c, 'AAA', 160)
    const got = await c.getBars('AAA', '1', { urgent: true, newerThan: 100 })
    expect(got.through).toBe(160)
    expect(w.reads()).toEqual(['AAA|1'])
  })

  it('N3 a read that does not ask for a newer copy is answered by the cache, as before', async () => {
    const { w, c } = boot()
    await cached(w, c, 'AAA', 100)
    expect((await c.getBars('AAA', '1', { urgent: true })).through).toBe(100)
    expect((await c.getBars('AAA', '1')).through).toBe(100)
    expect(w.reads()).toEqual(['AAA|1'])
  })

  it('N4 a second ask for a newer copy while one is out joins it: one worker message', async () => {
    const { w, c } = boot()
    await cached(w, c, 'AAA', 100)
    const p1 = c.getBars('AAA', '1', { urgent: true, newerThan: 100 })
    const p2 = c.getBars('AAA', '1', { urgent: true, newerThan: 100 })
    const p3 = c.getBars('AAA', '1', { newerThan: 100 })
    expect(w.reads()).toEqual(['AAA|1', 'AAA|1'])
    w.answer('AAA', '1', COLS(160))
    expect([(await p1).through, (await p2).through, (await p3).through]).toEqual([160, 160, 160])
  })

  it('N5 the lanes are kept: a background newer read takes a background place; an urgent one goes at once', async () => {
    const { w, c } = boot()
    await cached(w, c, 'AAA', 100)
    await cached(w, c, 'BBB', 100)
    await cached(w, c, 'CCC', 100)
    for (const s of ['AAA', 'BBB', 'CCC']) c.getBars(s, '1', { newerThan: 100 })   // background
    await tick()
    expect(w.reads().slice(3)).toHaveLength(BACKGROUND_READS_MAX)        // two in the worker, the third waits
    expect(c.inFlight()).toBe(3)
    c.getBars('DDD', '1', { urgent: true, newerThan: 0 })               // urgent: at once, whatever waits
    expect(w.reads().slice(3)).toHaveLength(BACKGROUND_READS_MAX + 1)
    w.answer('AAA', '1', COLS(160))
    await tick(); await tick()
    expect(w.reads().slice(3)).toHaveLength(BACKGROUND_READS_MAX + 2)    // an answer sends the waiting one
  })
})
