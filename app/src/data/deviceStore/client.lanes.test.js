// @vitest-environment node
// THE TWO LANES OF A DEVICE READ (2026-11-22, the 70-row jump).
// Measured on a D + 30m board with the device store on: a list scrolled into view asked the device for ~80 keys
// (the rows around the selection and the rows on screen, on both timeframes), and the chart the member then clicked
// waited behind them: its copy landed 100 to 830 ms after the click against 18 ms with nothing else asked, the
// D/W/M hold ran out, and the switch was slower than with the store off (pixels 350 ms against 115).
//
// Over a worker that answers only when the test says so:
//   L1 background reads (the default) reach the worker BACKGROUND_READS_MAX at a time, oldest first, the next
//      one sent by an answer
//   L2 an urgent read is sent at once, whatever is waiting
//   L3 an urgent ask for a key that is WAITING sends it at that moment, once, and both askers get the one answer;
//      it does not let a third background read into the worker
//   L4 an urgent ask for a key already sent posts nothing more
//   L5 with nothing else asked, two reads leave at once without `urgent` (a typed ticker's two charts)
//   L6 past WAITING_READS_MAX the least wanted read is dropped (answers null): the TAIL of the OLDEST ask. One ask
//      larger than the bound keeps the rows it asked first (a); across asks the older one loses its tail (b)
//   L9 asks are served newest first (each in its own order): the rows around a new selection do not wait behind
//      the whole list warm that came before them
//   L10 urgent reads take none of the background lane's places
//   L11 a key dropped at the bound and asked for urgently in the same task is read
//   L7 a worker that dies answers every read null, waiting ones included; dispose does the same and posts nothing
//   L8 inFlight() counts what is sent and what waits
import { describe, it, expect, vi } from 'vitest'
import { createDeviceClient, BACKGROUND_READS_MAX, WAITING_READS_MAX } from './client'

const COLS = (c = 1) => ({ t: new Float64Array([1, 2, 3]), o: new Float64Array([c, c, c]), h: new Float64Array([c, c, c]),
  l: new Float64Array([c, c, c]), c: new Float64Array([c, c, c]), v: new Float64Array([9, 9, 9]), build: 'b' })

/** A worker that records what it is sent and answers a read only when told to. */
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
const tick = () => new Promise((r) => setTimeout(r, 0))
const boot = (opts = {}) => {
  const w = manualWorker()
  return { w, c: createDeviceClient({ makeWorker: () => w, afterPaint: () => {}, ...opts }) }
}
const SYMS = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5']

describe('the two lanes of a device read', () => {
  it('the constants the cases below are written against', () => {
    expect(BACKGROUND_READS_MAX).toBe(2)
    expect(WAITING_READS_MAX).toBeGreaterThanOrEqual(128)
  })

  it('L1 background reads reach the worker two at a time, oldest first; each answer sends the next', async () => {
    const { w, c } = boot()
    const ps = SYMS.map((s) => c.getBars(s, 'D'))
    expect(w.reads()).toEqual(['S0|D', 'S1|D'])
    w.answer('S0')
    await tick()
    expect(w.reads()).toEqual(['S0|D', 'S1|D', 'S2|D'])
    w.answer('S2')
    await tick()
    expect(w.reads()).toEqual(['S0|D', 'S1|D', 'S2|D', 'S3|D'])
    w.answer('S1'); w.answer('S3')
    await tick()
    expect(w.reads()).toEqual(['S0|D', 'S1|D', 'S2|D', 'S3|D', 'S4|D', 'S5|D'])
    w.answer('S4'); w.answer('S5')
    const got = await Promise.all(ps)
    expect(got.every((x) => x && x.t.length === 3)).toBe(true)
    expect(c.inFlight()).toBe(0)
  })

  it('L2 an urgent read is sent at once, whatever is waiting', async () => {
    const { w, c } = boot()
    SYMS.forEach((s) => c.getBars(s, 'D'))
    expect(w.reads()).toHaveLength(2)
    const p = c.getBars('MINE', 'D', { urgent: true })
    expect(w.reads()).toEqual(['S0|D', 'S1|D', 'MINE|D'])      // in the same task as the ask
    w.answer('MINE', 'D', COLS(7))
    expect((await p).c[0]).toBe(7)
    // its answer let no extra background read in: two are still out
    expect(w.reads()).toEqual(['S0|D', 'S1|D', 'MINE|D'])
  })

  it('L3 an urgent ask for a WAITING key sends it now, once; both askers get the one answer', async () => {
    const { w, c } = boot()
    const ps = SYMS.map((s) => c.getBars(s, 'D'))
    expect(w.reads()).toEqual(['S0|D', 'S1|D'])
    const mine = c.getBars('S5', 'D', { urgent: true })
    expect(mine).toBe(ps[5])                                  // the one read of the key
    expect(w.reads()).toEqual(['S0|D', 'S1|D', 'S5|D'])
    w.answer('S5', 'D', COLS(5))
    const [a, b] = await Promise.all([mine, ps[5]])
    expect(a).toBe(b)
    expect(a.c[0]).toBe(5)
    await tick()
    // the hurried read was not a background one: its answer does not send S2 past the two still out
    expect(w.reads()).toEqual(['S0|D', 'S1|D', 'S5|D'])
    w.answer('S0')
    await tick()
    expect(w.reads()).toEqual(['S0|D', 'S1|D', 'S5|D', 'S2|D'])
    // ...and S5 is never sent a second time when its turn would have come
    w.answer('S1'); w.answer('S2')
    await tick()
    w.answer('S3'); w.answer('S4')
    await tick()
    expect(w.reads().filter((k) => k === 'S5|D')).toHaveLength(1)
    expect(w.reads()).toHaveLength(6)
  })

  it('L4 an urgent ask for a key already sent posts nothing more', async () => {
    const { w, c } = boot()
    const first = c.getBars('S0', 'D')
    expect(c.getBars('S0', 'D', { urgent: true })).toBe(first)
    expect(w.reads()).toEqual(['S0|D'])
  })

  it('L5 with nothing else asked, two reads leave at once without `urgent` (a typed ticker, D + 30m)', () => {
    const { w, c } = boot()
    c.getBars('TYPED', 'D'); c.getBars('TYPED', '30')
    expect(w.reads()).toEqual(['TYPED|D', 'TYPED|30'])
  })

  it('L6a one ask larger than the bound loses its TAIL: the rows asked first are the ones read', async () => {
    // a list warm asks top row first; under a head drop the rows on screen were the ones thrown away (review M1)
    const { w, c } = boot({ waitingMax: 3 })
    const ps = ['A', 'B', 'W1', 'W2', 'W3', 'W4', 'W5'].map((s) => c.getBars(s, 'D'))
    expect(w.reads()).toEqual(['A|D', 'B|D'])
    expect(await ps[5]).toBeNull()                            // W4 and W5: past the bound, the tail
    expect(await ps[6]).toBeNull()
    expect(c.inFlight()).toBe(5)                              // A, B out; W1, W2, W3 waiting
    w.answer('A'); w.answer('B')
    await tick()
    expect(w.reads()).toEqual(['A|D', 'B|D', 'W1|D', 'W2|D'])
    w.answer('W1'); w.answer('W2')
    await tick()
    w.answer('W3')
    expect((await ps[4]).t.length).toBe(3)
    // a dropped key is read when it is asked for again
    const again = c.getBars('W5', 'D')
    expect(w.reads().filter((k) => k === 'W5|D')).toHaveLength(1)
    w.answer('W5')
    expect((await again).t.length).toBe(3)
  })

  it('L6b past the bound across asks, the OLDER ask loses its tail; the newer ask is whole', async () => {
    const { w, c } = boot({ waitingMax: 3 })
    const old = ['A', 'B', 'X1', 'X2', 'X3'].map((s) => c.getBars(s, 'D'))
    await tick()                                              // a later task: the list scrolled on, a new ask
    const newer = ['Y1', 'Y2'].map((s) => c.getBars(s, 'D'))
    expect(await old[4]).toBeNull()                           // X3, then X2: the older ask's tail
    expect(await old[3]).toBeNull()
    expect(c.inFlight()).toBe(5)                              // A, B out; X1, Y1, Y2 waiting
    w.answer('A'); w.answer('B')
    await tick()
    expect(w.reads()).toEqual(['A|D', 'B|D', 'Y1|D', 'Y2|D'])
    w.answer('Y1'); w.answer('Y2')
    await tick()
    expect(w.reads()).toEqual(['A|D', 'B|D', 'Y1|D', 'Y2|D', 'X1|D'])
    w.answer('X1')
    expect((await Promise.all([...newer, old[2]])).every((x) => x && x.t.length === 3)).toBe(true)
  })

  it('L9 the newest ask is served first, in its own order; an older ask keeps its order behind it', async () => {
    // the rows around a new selection are asked AFTER the list warm, and must not sit behind all of it (review M3)
    const { w, c } = boot()
    ;['A', 'B', 'X1', 'X2', 'X3'].forEach((s) => c.getBars(s, 'D'))
    await tick()
    ;['Y1', 'Y2'].forEach((s) => c.getBars(s, 'D'))
    await tick()
    c.getBars('Z1', 'D')
    expect(w.reads()).toEqual(['A|D', 'B|D'])
    const order = ['A', 'B']
    for (let n = 0; n < 6; n++) { w.answer(order[n]); await tick(); order.push(w.reads()[w.reads().length - 1].split('|')[0]) }
    expect(w.reads()).toEqual(['A|D', 'B|D', 'Z1|D', 'Y1|D', 'Y2|D', 'X1|D', 'X2|D', 'X3|D'])
  })

  it('L10 urgent reads take none of the background lane\'s places', async () => {
    const { w, c } = boot()
    c.getBars('U1', 'D', { urgent: true }); c.getBars('U2', 'D', { urgent: true }); c.getBars('U3', 'D', { urgent: true })
    c.getBars('B1', 'D'); c.getBars('B2', 'D'); c.getBars('B3', 'D')
    expect(w.reads()).toEqual(['U1|D', 'U2|D', 'U3|D', 'B1|D', 'B2|D'])   // both places still free after three urgent reads
    w.answer('U1'); w.answer('U2'); w.answer('U3')
    await tick()
    expect(w.reads()).toHaveLength(5)                          // an urgent answer frees no background place
    w.answer('B1')
    await tick()
    expect(w.reads()).toEqual(['U1|D', 'U2|D', 'U3|D', 'B1|D', 'B2|D', 'B3|D'])
  })

  it('L11 a key dropped at the bound and asked for urgently in the same task is read, not answered null', async () => {
    const { w, c } = boot({ waitingMax: 3 })
    const ps = ['A', 'B', 'W1', 'W2', 'W3', 'W4'].map((s) => c.getBars(s, 'D'))
    const mine = c.getBars('W4', 'D', { urgent: true })       // same task: the dropped promise has not unwound yet
    expect(w.reads()).toEqual(['A|D', 'B|D', 'W4|D'])
    w.answer('W4', 'D', COLS(4))
    expect((await mine).c[0]).toBe(4)
    expect(await ps[5]).toBeNull()                            // the dropped ask itself still answers null
  })

  it('L7 a worker that dies answers every read null, waiting ones included; so does dispose, posting nothing', async () => {
    const a = boot()
    const ps = SYMS.map((s) => a.c.getBars(s, 'D'))
    a.w.onerror(new Error('boom'))
    expect(await Promise.all(ps)).toEqual([null, null, null, null, null, null])
    expect(a.w.reads()).toHaveLength(2)                        // nothing was posted to the dead worker
    expect(a.c.inFlight()).toBe(0)

    const b = boot()
    const qs = SYMS.map((s) => b.c.getBars(s, 'D'))
    b.c.dispose()
    expect(await Promise.all(qs)).toEqual([null, null, null, null, null, null])
    expect(b.w.reads()).toHaveLength(2)
    expect(b.c.inFlight()).toBe(0)
  })

  it('L8 inFlight() counts what is sent and what waits', async () => {
    const { w, c } = boot()
    SYMS.forEach((s) => c.getBars(s, 'D'))
    expect(c.inFlight()).toBe(6)
    w.answer('S0')
    await tick()
    expect(c.inFlight()).toBe(5)
  })
})
