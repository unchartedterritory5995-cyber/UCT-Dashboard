// WHO ASKS THE DEVICE URGENTLY, AND WHO WAITS THEIR TURN (2026-11-22, the 70-row jump; deviceStore/client.js, TWO LANES).
// Through the real store (registry + reducer + persist + network) and the real prefetch facade, with a device source
// that records each read's arguments, a fake IndexedDB and a server that never answers.
//
// URGENT (`{ urgent: true }` as the read's third argument): the member's own ask
//   U1 the key press (prefetch.deviceWarm, called by handoffGroups.primeGroup), for a key nothing holds
//   U2 the key press for a key that already holds an older device copy (the refresh)
//   U3 the intraday prepare of the switch (prepareForDisplay)
//   U4 the D/W/M prepare of the switch (prepareDailyForDisplay)
//   U5 a chart on screen subscribing to its key (the store's start)
//   U6 the D/W/M prepare of a key that already holds rows that make no claim (the pack's): a host with no linked
//      group never primes at the key press (the screener's focus chart, the breadth drill), and the hydrate
//      returns such an entry without reading the device (review of #2438, M2)
//   U7 the same for the intraday prepare
//   U8 the device rule bringing a held device copy forward (deviceVerdict, the switch's own question)
// BACKGROUND (no third argument): every warm
//   B1 the rows around the selection (createNeighborHold().set)
//   B2 the promote of the rows around (warmMemFromIDB)
//   B3 the rows on screen (prewarmVisibleList) and the queued warms (prefetchBarsToIDB, prefetchBars), the next
//      rows' `urgent` NETWORK rank included: that rank is the request's, not the device read's
//   B4 a first look at an unseen key (peekBars / holdsBars / peekDisplayable): the look itself is background, the
//      switch's own read is the prepare's or the key press's
//   B5 a warm of a key that holds a device copy (the refresh) stays background
// And the two meet:
//   M1 a warm's read of a key, then the key press for the same key: the device is asked again, urgently (the
//      client sends a waiting read at that moment: client.lanes.test.js L3)
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createBarStore } from './index'
import { createPrefetch } from './prefetch'
import { keyOf } from './types'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { memClear } from '../../utils/barsMemCache'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const SAT = Date.UTC(2026, 10, 21, 20, 50)             // Sat 2026-11-21 15:50 ET: the market is shut
const FRI = Date.UTC(2026, 10, 20) / 1000
const THROUGH = FRI + 86400
/** The 40 weekdays ending Friday 2026-11-20 (no NYSE holiday falls in the ten weeks before it), unix seconds. */
function sessions(n) {
  const out = []
  const d = new Date(FRI * 1000)
  while (out.length < n) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) out.unshift(d.getTime() / 1000)
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}
const ROWS = sessions(40).map((t, i) => { const o = 40 + (i % 7); return { t, o, h: o + 1, l: o - 1, c: o + 0.5, v: 1000 + i } })

/** A device source whose reads never answer unless `answers` is set; every call's arguments are kept. */
function recordingDevice({ answers = false, through = THROUGH } = {}) {
  return {
    peek: vi.fn(() => null),
    read: vi.fn((...args) => (answers
      ? Promise.resolve({ rows: ROWS, through, savedAt: through * 1000 })
      : new Promise(() => {}))),
  }
}
/** A saved copy that makes no claim (the universe pack's rows in IndexedDB: no stamp), in the cache's row shape. */
const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10)
const PACK_D = { bars: ROWS.slice(-25).map((r) => ({ ...r, t: iso(r.t) })), savedAt: SAT - 6 * 3600 * 1000 }
const etOpen = (t) => t + 14 * 3600 + 30 * 60            // November: 09:30 ET = 14:30 UTC
const rth30 = (day, n = 13) => Array.from({ length: n }, (_, i) => { const t = etOpen(day) + i * 1800; const o = 50 + (i % 5); return { t, o, h: o + 0.5, l: o - 0.5, c: o + 0.25, v: 1000 + i } })
const PACK_30 = { bars: [...rth30(FRI - 86400), ...rth30(FRI)], savedAt: SAT - 6 * 3600 * 1000 }
/** The lanes the device was asked on for `sym`: 'urgent' or 'background' per read, in order. */
const lanesOf = (device, sym) => device.read.mock.calls
  .filter((a) => a[0] === sym)
  .map((a) => (a.length >= 3 && a[2]?.urgent === true ? 'urgent' : (a.length === 2 ? 'background' : `odd:${JSON.stringify(a[2])}`)))

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime(SAT) })
afterEach(() => { vi.useRealTimers() })

function boot({ device = recordingDevice(), saved = null } = {}) {
  const request = vi.fn(() => new Promise(() => {}))    // the server never answers
  const io = {
    idbGet: vi.fn(async (sym) => (sym === 'MINE' ? saved : null)), idbGetHistoryEntry: async () => null,
    idbPutMonotonic: async () => {}, memPutMonotonic: () => {},
  }
  const store = createBarStore({
    request, device, io, stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), history: null,
  })
  return { store, device, pf: createPrefetch({ store, tickerMeta: () => {}, extended: () => false }) }
}
const settle = () => vi.advanceTimersByTimeAsync(20)

describe('urgent: the member\'s own ask', () => {
  it('U1 the key press, for a key nothing holds', async () => {
    const { store, device, pf } = boot()
    pf.deviceWarm('MINE', 'D')
    await settle()
    const lanes = lanesOf(device, 'MINE')
    expect(lanes.length).toBeGreaterThan(0)
    expect(lanes.every((l) => l === 'urgent')).toBe(true)
    store.dispose()
  })

  it('U2 the key press for a key that holds an older device copy', async () => {
    const device = recordingDevice({ answers: true })
    const { store, pf } = boot({ device })
    pf.warmMemFromIDB(['MINE'], ['D'])                    // a warm lands the device copy
    await settle()
    expect(store.peek(keyOf({ sym: 'MINE', tf: 'D' }))?.source).toBe('device')
    device.read.mockClear()
    pf.deviceWarm('MINE', 'D')                            // the key press brings it forward
    await settle()
    const lanes = lanesOf(device, 'MINE')
    expect(lanes.length).toBeGreaterThan(0)
    expect(lanes.every((l) => l === 'urgent')).toBe(true)
    store.dispose()
  })

  it('U3 the intraday prepare of the switch', async () => {
    const { store, device, pf } = boot()
    pf.prepareForDisplay('MINE', '30').catch(() => {})
    await settle()
    const lanes = lanesOf(device, 'MINE')
    expect(lanes.length).toBeGreaterThan(0)
    expect(lanes.every((l) => l === 'urgent')).toBe(true)
    store.dispose()
  })

  it('U4 the D/W/M prepare of the switch', async () => {
    const { store, device, pf } = boot()
    pf.prepareDailyForDisplay('MINE', 'D').catch(() => {})
    await settle()
    const lanes = lanesOf(device, 'MINE')
    expect(lanes.length).toBeGreaterThan(0)
    expect(lanes.every((l) => l === 'urgent')).toBe(true)
    store.dispose()
  })

  it('U5 a chart on screen subscribing to its key', async () => {
    const { store, device } = boot()
    const off = store.subscribe(keyOf({ sym: 'MINE', tf: 'D' }), () => {})
    await settle()
    const lanes = lanesOf(device, 'MINE')
    expect(lanes.length).toBeGreaterThan(0)
    expect(lanes.every((l) => l === 'urgent')).toBe(true)
    if (typeof off === 'function') off()
    store.dispose()
  })
})

describe('urgent: a key the switch finds already holding rows', () => {
  it('U6 the D/W/M prepare of a key that holds the pack\'s rows asks the device, urgently', async () => {
    const { store, device, pf } = boot({ saved: PACK_D })
    const key = keyOf({ sym: 'MINE', tf: 'D' })
    pf.holdsBars('MINE', 'D')                             // a first look lands the saved copy (its device read: background)
    await settle()
    expect(store.peek(key)?.bars?.length).toBeGreaterThan(0)
    expect(store.peek(key)?.source).not.toBe('device')
    device.read.mockClear()
    pf.prepareDailyForDisplay('MINE', 'D').catch(() => {})
    await settle()
    const lanes = lanesOf(device, 'MINE')
    expect(lanes.length).toBeGreaterThan(0)
    expect(lanes.every((l) => l === 'urgent')).toBe(true)
    store.dispose()
  })

  it('U7 the intraday prepare of a key that holds the pack\'s rows asks the device, urgently', async () => {
    const { store, device, pf } = boot({ saved: PACK_30 })
    pf.peekDisplayable('MINE', '30')
    await settle()
    expect(store.peek(pf.keyFor('MINE', '30'))?.bars?.length).toBeGreaterThan(0)
    device.read.mockClear()
    pf.prepareForDisplay('MINE', '30').catch(() => {})
    await settle()
    const lanes = lanesOf(device, 'MINE')
    expect(lanes.length).toBeGreaterThan(0)
    expect(lanes.every((l) => l === 'urgent')).toBe(true)
    store.dispose()
  })

  it('U8 the device rule bringing a held device copy that is behind forward', async () => {
    const device = recordingDevice({ answers: true, through: FRI - 6 * 86400 })   // a copy a week behind: not fresh
    const { store, pf } = boot({ device })
    pf.warmMemFromIDB(['MINE'], ['D'])
    await settle()
    expect(store.peek(keyOf({ sym: 'MINE', tf: 'D' }))?.source).toBe('device')
    device.read.mockClear()
    expect(pf.deviceVerdict('MINE', 'D').paints).toBe(false)
    await settle()
    const lanes = lanesOf(device, 'MINE')
    expect(lanes.length).toBeGreaterThan(0)
    expect(lanes.every((l) => l === 'urgent')).toBe(true)
    store.dispose()
  })
})

describe('background: every warm', () => {
  it('B1 the rows around the selection', async () => {
    const { store, device, pf } = boot()
    const hold = pf.createNeighborHold()
    hold.set(['N1', 'N2', 'N3'], 'D')
    await settle()
    for (const s of ['N1', 'N2', 'N3']) {
      const lanes = lanesOf(device, s)
      expect(lanes.length, s).toBeGreaterThan(0)
      expect(lanes.every((l) => l === 'background'), `${s}: ${lanes}`).toBe(true)
    }
    hold.clear()
    store.dispose()
  })

  it('B2 the promote of the rows around', async () => {
    const { store, device, pf } = boot()
    pf.warmMemFromIDB(['N1', 'N2'], ['D', '30'])
    await settle()
    for (const s of ['N1', 'N2']) {
      const tfs = device.read.mock.calls.filter((a) => a[0] === s).map((a) => String(a[1]))
      expect(tfs, s).toContain('D')
      expect(tfs, s).toContain('30')
      expect(lanesOf(device, s).every((l) => l === 'background'), `${s}: ${lanesOf(device, s)}`).toBe(true)
    }
    store.dispose()
  })

  it('B3 the rows on screen and the queued warms, the next rows\' urgent network rank included', async () => {
    const { store, device, pf } = boot()
    pf.prewarmVisibleList(['V1', 'V2', 'V3'], { chartTf: 'D' })
    pf.prefetchBarsToIDB(['Q1'], 'D', { priority: true })
    pf.prefetchBars(['NEXT'], 'D', { urgent: true })
    await settle()
    for (const s of ['V1', 'V2', 'V3', 'Q1', 'NEXT']) {
      const lanes = lanesOf(device, s)
      expect(lanes.length, s).toBeGreaterThan(0)
      expect(lanes.every((l) => l === 'background'), `${s}: ${lanes}`).toBe(true)
    }
    store.dispose()
  })

  it('B4 a first look that is not the switch\'s own', async () => {
    const { store, device, pf } = boot()
    pf.peekBars('P1', 'D'); pf.holdsBars('P2', 'D'); pf.peekDisplayable('P3', '30')
    await settle()
    for (const s of ['P1', 'P2', 'P3']) {
      const lanes = lanesOf(device, s)
      expect(lanes.length, s).toBeGreaterThan(0)
      expect(lanes.every((l) => l === 'background'), `${s}: ${lanes}`).toBe(true)
    }
    store.dispose()
  })
})

describe('background: a warm of a key the device already answered', () => {
  it('B5 the refresh of a held device copy by a warm', async () => {
    const device = recordingDevice({ answers: true })
    const { store, pf } = boot({ device })
    pf.warmMemFromIDB(['MINE'], ['D'])
    await settle()
    expect(store.peek(keyOf({ sym: 'MINE', tf: 'D' }))?.source).toBe('device')
    device.read.mockClear()
    pf.warmMemFromIDB(['MINE'], ['D'])
    const hold = pf.createNeighborHold()
    hold.set(['MINE'], 'D')
    await settle()
    const lanes = lanesOf(device, 'MINE')
    expect(lanes.length).toBeGreaterThan(0)
    expect(lanes.every((l) => l === 'background'), `${lanes}`).toBe(true)
    hold.clear()
    store.dispose()
  })
})

describe('a held device copy asked for again', () => {
  it('N1 a copy that is no newer than the one the key holds is dropped without building its rows', async () => {
    // every warm of a device-held key asks the device again (the rows around the selection, on every press)
    let built = 0
    let cached = false
    const hit = () => ({ n: ROWS.length, through: THROUGH, savedAt: THROUGH * 1000, get rows() { built++; return ROWS } })
    const device = { peek: vi.fn(() => (cached ? hit() : null)), read: vi.fn(async () => { cached = true; return hit() }) }
    const { store, pf } = boot({ device })
    pf.warmMemFromIDB(['MINE'], ['D'])
    await settle()
    expect(store.peek(keyOf({ sym: 'MINE', tf: 'D' }))?.source).toBe('device')
    expect(built).toBeGreaterThan(0)                         // the copy that landed was built
    const b0 = built
    device.peek.mockClear()
    const hold = pf.createNeighborHold()
    for (let i = 0; i < 5; i++) {
      pf.warmMemFromIDB(['MINE'], ['D'])
      hold.set(['MINE'], 'D')
      pf.prefetchBarsToIDB(['MINE'], 'D', { priority: true })
      pf.deviceVerdict('MINE', 'D')
      pf.deviceWarm('MINE', 'D')
      await settle()
    }
    expect(device.peek.mock.calls.length).toBeGreaterThan(4)  // the device WAS asked again (the control)
    expect(built).toBe(b0)                                   // ...and not one row was built for it
    hold.clear()
    store.dispose()
  })

  it('N2 a NEWER copy is still taken, rows and all', async () => {
    let through = THROUGH - 86400
    let cached = false
    const hit = () => ({ n: ROWS.length, through, savedAt: through * 1000, get rows() { return ROWS } })
    const device = { peek: vi.fn(() => (cached ? hit() : null)), read: vi.fn(async () => { cached = true; return hit() }) }
    const { store, pf } = boot({ device })
    const key = keyOf({ sym: 'MINE', tf: 'D' })
    pf.warmMemFromIDB(['MINE'], ['D'])
    await settle()
    expect(store.persist.deviceThroughOf(key)).toBe(THROUGH - 86400)
    through = THROUGH
    pf.deviceWarm('MINE', 'D')
    await settle()
    expect(store.persist.deviceThroughOf(key)).toBe(THROUGH)
    store.dispose()
  })
})

describe('the two meet', () => {
  it('M1 a warm asked for the key, then the key press: the device is asked again, urgently', async () => {
    const { store, device, pf } = boot()
    pf.warmMemFromIDB(['MINE'], ['D'])                    // its read is still out (this device never answers)
    await settle()
    const warm = lanesOf(device, 'MINE')
    expect(warm.length).toBeGreaterThan(0)
    expect(warm.every((l) => l === 'background')).toBe(true)
    pf.deviceWarm('MINE', 'D')                            // the key press
    await settle()
    const after = lanesOf(device, 'MINE').slice(warm.length)
    expect(after.length).toBeGreaterThan(0)
    expect(after.every((l) => l === 'urgent')).toBe(true)
    store.dispose()
  })
})
