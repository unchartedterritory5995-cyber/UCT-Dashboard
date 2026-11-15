// app/src/components/chart/engine/__tests__/serverLaneRelease.test.js
//
// ─── A HELD KEY'S RELEASE IS A STOP (2026-11-15) ─────────────────────────────
//
// Measured on production (hourly charts, the key held through a list never opened): the landing
// chart's own ask left 409 ms after its key and was answered in 154 ms. The lane's hold GUESSES
// that the member stopped (1.3 x the slower step); holding ArrowDown sends auto-repeated
// key-downs and ONE key-up on release, which says it for certain. Rules (serverCompute):
//   1. at the release, a held ask whose chart arrived after the last key-down (the landing
//      chart) is sent at once;
//   2. a held ask whose chart arrived BEFORE the last key-down is not (that key-down is still
//      replacing it): it keeps its timer and is dropped when the chart moves on;
//   3. after the release (RELEASE_MS, until the next walk key-down) a new ask is not held;
//   4. CONTROLS: a tap (key-down + key-up, no repeat) is not a release; a key-down after the
//      release ends it; other keys never count.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The browser store's read, recorded (it finds nothing): a racing chart's read is held like its ask.
const disk = vi.hoisted(() => ({ reads: [] }))
vi.mock('../serverColumnsDisk', async (orig) => ({
  ...(await orig()),
  readDisk: vi.fn(async (sym) => { disk.reads.push(sym); return [] }),
  writeDisk: vi.fn(async () => {}),
}))

import {
  SETTLE_MAX_MS, RELEASE_MS, clearServerColumns, ensureColumns, chartShows, __setServerBatchFetcherForTests,
} from '../serverCompute'
import { __resetServerWarm } from '../serverWarm'

const TF = 'D'
const wire = (v) => ({ times: [20260102, 20260105], columns: { a: [v, v + 1] }, payload: { state: 'ok' } })
const symOf = (url) => new URL(url, 'http://x').searchParams.get('sym')
const tick = async (ms = 0) => { for (let k = 0; k < 8; k++) await Promise.resolve(); await vi.advanceTimersByTimeAsync(ms); for (let k = 0; k < 8; k++) await Promise.resolve() }

let sent
const server = () => __setServerBatchFetcherForTests((url) => {
  sent.push(symOf(url))
  return Promise.resolve({ results: JSON.parse(new URL(url, 'http://x').searchParams.get('asks')).map(() => ({ status: 200, envelope: wire(1) })) })
})
/** the chart on `slot` paints `sym`: two definitions, so its ask goes through the batch door */
const paint = (slot, sym) => {
  chartShows(slot, sym, TF)
  ensureColumns('defA', sym, TF, { benchmark: 'SPY' })
  ensureColumns('defB', sym, TF, null)
}
const key = (type, k = 'ArrowDown', repeat = false) => window.dispatchEvent(new KeyboardEvent(type, { key: k, repeat }))

/** A member holding the key: a first key-down, then repeats, the chart following each 100 ms. */
async function holdThrough(slot, syms) {
  for (let i = 0; i < syms.length; i++) {
    key('keydown', 'ArrowDown', i > 0)
    await tick(100)
    paint(slot, syms[i])
  }
  await tick()
}

beforeEach(() => {
  vi.useFakeTimers()
  clearServerColumns()
  __resetServerWarm({ painted: true })
  sent = []
  disk.reads.length = 0
  try { localStorage.removeItem('uct.indwarm.off'); localStorage.removeItem('uct.rslane.tfs'); localStorage.setItem('barspack.version', 'x') } catch { /* */ }
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in this suite') }))
  server()
})
afterEach(() => {
  __setServerBatchFetcherForTests(null)
  clearServerColumns()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('a held key\'s release is a stop', () => {
  it('CONTROL: while the key is held the landing chart\'s ask is held, as before', async () => {
    const slot = {}
    paint(slot, 'S0'); await tick()                      // resting: asks at once
    await holdThrough(slot, ['S1', 'S2', 'S3'])
    expect(sent).toEqual(['S0'])                         // S1, S2 dropped; S3 held
    await tick(SETTLE_MAX_MS)
    expect(sent).toEqual(['S0', 'S3'])                   // the guess: sent when the hold runs out
  })

  it('at the release, the landing chart\'s held ask goes at once', async () => {
    const slot = {}
    paint(slot, 'S0'); await tick()
    await holdThrough(slot, ['S1', 'S2', 'S3'])
    expect(sent).toEqual(['S0'])
    key('keyup')                                         // the member lets go
    await tick()
    expect(sent).toEqual(['S0', 'S3'])                   // no wait
    await tick(SETTLE_MAX_MS)
    expect(sent).toEqual(['S0', 'S3'])                   // and only once
  })

  it('a held ask from before the last key-down is not sent at the release; it is dropped when the chart moves on', async () => {
    const slot = {}
    paint(slot, 'S0'); await tick()
    await holdThrough(slot, ['S1', 'S2'])                // S2 shown, its ask held
    await tick(30)                                       // the next auto-repeat, ~33 ms on
    key('keydown', 'ArrowDown', true)                    // one more repeat: its row is not drawn yet
    key('keyup')
    await tick()
    expect(sent).toEqual(['S0'])                         // S2 is being replaced: not asked
    paint(slot, 'S3')                                    // the landing chart draws after the key-up
    await tick()
    expect(sent).toEqual(['S0', 'S3'])                   // ...and asks at once (rule 3)
    await tick(SETTLE_MAX_MS)
    expect(sent).toEqual(['S0', 'S3'])                   // S2's timer found its chart gone
  })

  it('after the release, a chart that arrives is not held; RELEASE_MS later the pace rule is back', async () => {
    const slot = {}
    paint(slot, 'S0'); await tick()
    await holdThrough(slot, ['S1', 'S2'])
    key('keyup'); await tick()
    expect(sent).toEqual(['S0', 'S2'])
    await tick(RELEASE_MS + 10)
    paint(slot, 'S3'); await tick(100); paint(slot, 'S4'); await tick(100); paint(slot, 'S5'); await tick()
    // (S3 came after a long rest: sent; S4/S5 race again and are held, by the pace rule)
    expect(sent).toEqual(['S0', 'S2', 'S3'])
  })

  it('CONTROL: a tap is not a release (fast tapping keeps the pace rule)', async () => {
    const slot = {}
    paint(slot, 'S0'); await tick()
    for (const s of ['S1', 'S2', 'S3']) { key('keydown'); key('keyup'); await tick(100); paint(slot, s) }
    await tick()
    expect(sent).toEqual(['S0'])                         // held, as before
  })

  it('CONTROL: a walk key-down after the release ends it', async () => {
    const slot = {}
    paint(slot, 'S0'); await tick()
    await holdThrough(slot, ['S1', 'S2'])
    key('keyup'); await tick()
    expect(sent).toEqual(['S0', 'S2'])
    key('keydown'); await tick(100); paint(slot, 'S3'); await tick()
    expect(sent).toEqual(['S0', 'S2'])                   // racing again: S3 is held
  })

  it('the landing chart\'s read of the browser store goes at the release too', async () => {
    const slot = {}
    paint(slot, 'S0'); await tick()
    await holdThrough(slot, ['S1', 'S2', 'S3'])
    expect(disk.reads).not.toContain('S3')               // CONTROL: held while racing
    key('keyup'); await tick()
    expect(disk.reads).toContain('S3')
    expect(disk.reads).not.toContain('S1')               // a passed row is never read
  })

  it('CONTROL: another key never counts', async () => {
    const slot = {}
    paint(slot, 'S0'); await tick()
    for (let i = 0; i < 3; i++) { key('keydown', 'ArrowDown', i > 0); await tick(100); paint(slot, `S${i + 1}`) }
    key('keyup', 'Shift')                                // not the key being held
    await tick()
    expect(sent).toEqual(['S0'])
  })
})
