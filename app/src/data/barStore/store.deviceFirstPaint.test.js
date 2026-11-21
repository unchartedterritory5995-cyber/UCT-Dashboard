// WHY A NEVER-OPENED DAILY CHART DID NOT PAINT FROM THE DEVICE (devgates 2026-11-21: 3 of 28, then 0 of 28).
// Through the real store (registry + reducer + persist + network) and the real prefetch facade, with a fake
// device source, a fake IndexedDB read and a server that never answers. The clock is a SATURDAY: the seed is
// as of Friday, the market is shut, and the device copy is whole (fresh.js) for the whole test.
//
//   W1 the wake a landing device copy causes already carries the copy's stamps: a waiter that asks the device
//      rule INSIDE that wake (the handoff's watcher, prefetch.watch) is told it paints. The stamps were written
//      after the dispatch, so the one wake a switch gets read `through` as unknown and answered 'stale'.
//   W2 a device copy the reducer refuses leaves the entry's stamps exactly as they were.
//   P1 a saved copy that makes no claim of its own (the universe pack's rows in IndexedDB: closed bars, no
//      server stamp) landing FIRST does not shut the device copy out: the device copy joins it on the proven
//      basis and the device rule paints.
//   P2 ...nor does one landing AFTER the device copy take the key away from it.
// The rules that stay (each one a refusal):
//   S1 a saved copy on ANOTHER price basis (a split between the two) is never joined, in either order
//   S2 a saved SERVER answer (stamped: its own identity and paint rule) is never joined by the device copy
//   S3 a saved copy holding a FORMING bar is never joined (its forming bar is as old as the save)
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createBarStore } from './index'
import { createPrefetch } from './prefetch'
import { keyOf, STATUS } from './types'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { memClear } from '../../utils/barsMemCache'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const SAT = Date.UTC(2026, 10, 21, 20, 50)             // Sat 2026-11-21 15:50 ET
const LAST = '2026-11-20'                               // the last closed session: the seed's as-of day
const dayUnix = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000
const THROUGH = dayUnix(LAST) + 86400                   // deviceStore/engine.js: complete through its as-of day
/** The `n` weekdays ending at `last` (no NYSE holiday falls in the eight weeks before 2026-11-20). */
function sessions(n, last = LAST) {
  const out = []
  const d = new Date(`${last}T12:00:00Z`)
  while (out.length < n) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) out.unshift(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}
const px = (iso, k = 1) => { const i = (dayUnix(iso) / 86400) % 17; const o = (40 + i) * k; return { o, h: o + k, l: o - k, c: o + 0.5 * k, v: 1000 + i } }
/** The device's rows (unix seconds), newest 40 sessions. */
const DEVICE_D = sessions(40).map((iso) => ({ t: dayUnix(iso), ...px(iso) }))
/** A saved copy in the cache's row shape (D: 'YYYY-MM-DD'), the newest `n` sessions up to `last`, prices x `k`. */
const savedRows = (n, { k = 1, last = LAST } = {}) => sessions(n, last).map((iso) => ({ t: iso, ...px(iso, k) }))
const SAVED_AT = SAT - 6 * 3600 * 1000

/** The device source (deviceStore/source.js): `read` answers after `delayMs`, and `peek` answers from then on
 *  (the client's recently-read cache). */
function fakeDevice(rows, { through = THROUGH, delayMs = 0 } = {}) {
  let cached = false
  const hit = () => ({ rows, through, savedAt: through * 1000 })
  return {
    peek: vi.fn((s, t) => (cached && s === 'NEWB' && t === 'D' ? hit() : null)),
    read: vi.fn((s, t) => new Promise((resolve) => setTimeout(() => {
      if (s !== 'NEWB' || t !== 'D') { resolve(null); return }
      cached = true
      resolve(hit())
    }, delayMs))),
  }
}

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime(SAT) })
afterEach(() => { vi.useRealTimers() })

/** `saved`: what IndexedDB holds for the key ({bars, savedAt, meta?} or null), answered after `idbMs`. */
function boot({ device, saved = null, idbMs = 0 }) {
  const request = vi.fn(() => new Promise(() => {}))    // the server never answers: only local copies decide
  const io = {
    idbGet: vi.fn(() => new Promise((r) => setTimeout(() => r(saved), idbMs))),
    idbGetHistoryEntry: async () => null, idbPutMonotonic: async () => {}, memPutMonotonic: () => {},
  }
  const store = createBarStore({
    request, device, io, stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), history: null,
  })
  const key = keyOf({ sym: 'NEWB', tf: 'D' })
  return { store, request, key, pf: createPrefetch({ store, tickerMeta: () => {}, extended: () => false }) }
}
const scales = (s) => [...new Set(s.bars.map((b) => Math.round((b.o / px(new Date(b.t * 1000).toISOString().slice(0, 10)).o) * 1000) / 1000))]

describe('the wake of a landing device copy', () => {
  it('W1 carries the copy\'s stamps: the device rule asked inside it paints', async () => {
    const { store, pf, key } = boot({ device: fakeDevice(DEVICE_D) })
    const seen = []
    const off = pf.watch('NEWB', 'D', {}, () => {
      seen.push({ ...pf.deviceVerdict('NEWB', 'D'), savedAt: store.persist.savedAtOf(key), through: store.persist.deviceThroughOf(key) })
    })
    pf.deviceWarm('NEWB', 'D')                            // the key press starts the read (handoffGroups.primeGroup)
    await vi.advanceTimersByTimeAsync(5)
    expect(seen.length).toBeGreaterThan(0)
    // the FIRST wake: the only one a switch gets before the server answers
    expect(seen[0]).toMatchObject({ paints: true, reason: 'paints', held: 'device', through: THROUGH, savedAt: THROUGH * 1000 })
    off()
    store.dispose()
  })

  it('W2 a device copy the reducer refuses leaves the entry\'s stamps as they were', async () => {
    // a saved copy that shares NO bar with the device's (it ends before the device's window starts): refused
    const old = savedRows(10, { last: '2026-09-25' })
    const { store, pf, key } = boot({ device: fakeDevice(DEVICE_D, { delayMs: 5 }), saved: { bars: old, savedAt: SAVED_AT } })
    pf.holdsBars('NEWB', 'D')                             // the switch's first look: the hydrate (saved copy, device read)
    await vi.advanceTimersByTimeAsync(30)
    const s = store.peek(key)
    expect(s.source).toBe('idb')
    expect(s.bars.length).toBe(old.length)
    expect(store.persist.deviceThroughOf(key)).toBe(null)
    expect(store.persist.savedAtOf(key)).toBe(SAVED_AT)
    expect(pf.devicePaints('NEWB', 'D')).toBe(false)
    store.dispose()
  })
})

describe('a saved copy that makes no claim (the universe pack\'s rows) and the device copy', () => {
  it('P1 the saved copy lands FIRST: the device copy still joins it and the device rule paints', async () => {
    const { store, pf, key, request } = boot({
      device: fakeDevice(DEVICE_D, { delayMs: 5 }), saved: { bars: savedRows(25), savedAt: SAVED_AT },
    })
    pf.holdsBars('NEWB', 'D')
    await vi.advanceTimersByTimeAsync(2)
    expect(store.peek(key).source).toBe('idb')            // the saved copy is in, the device read still out
    await vi.advanceTimersByTimeAsync(30)
    const s = store.peek(key)
    expect(s.source).toBe('device')
    expect(s.restSeen).toBe(false)
    expect(s.status).toBe(STATUS.CONTEXT)
    expect(s.bars.length).toBe(DEVICE_D.length)
    expect(scales(s)).toEqual([1])
    expect(store.persist.deviceThroughOf(key)).toBe(THROUGH)
    expect(pf.deviceVerdict('NEWB', 'D')).toMatchObject({ paints: true, reason: 'paints', held: 'device' })
    expect(request).not.toHaveBeenCalled()
    store.dispose()
  })

  it('P2 the saved copy lands AFTER the device copy: the key is still the device\'s and it paints', async () => {
    const { store, pf, key } = boot({
      device: fakeDevice(DEVICE_D), saved: { bars: savedRows(25), savedAt: SAVED_AT }, idbMs: 20,
    })
    pf.holdsBars('NEWB', 'D')
    await vi.advanceTimersByTimeAsync(5)
    expect(store.peek(key).source).toBe('device')         // the device copy is in, the IndexedDB read still out
    expect(pf.devicePaints('NEWB', 'D')).toBe(true)
    await vi.advanceTimersByTimeAsync(40)
    const s = store.peek(key)
    expect(s.source).toBe('device')
    expect(s.bars.length).toBe(DEVICE_D.length)
    expect(store.persist.deviceThroughOf(key)).toBe(THROUGH)
    expect(store.persist.savedAtOf(key)).toBe(THROUGH * 1000)
    expect(pf.deviceVerdict('NEWB', 'D')).toMatchObject({ paints: true, reason: 'paints', held: 'device' })
    store.dispose()
  })
})

describe('the refusals that stay', () => {
  it('S1 a saved copy on another price basis is never joined, whichever lands first', async () => {
    // saved first: the device copy is refused by the reducer's basis proof
    const a = boot({ device: fakeDevice(DEVICE_D, { delayMs: 5 }), saved: { bars: savedRows(25, { k: 0.5 }), savedAt: SAVED_AT } })
    a.pf.holdsBars('NEWB', 'D')
    await vi.advanceTimersByTimeAsync(30)
    expect(scales(a.store.peek(a.key))).toEqual([0.5])
    expect(a.store.peek(a.key).source).toBe('idb')
    expect(a.pf.devicePaints('NEWB', 'D')).toBe(false)
    a.store.dispose()
    // device first: the saved copy replaces it whole (reducer R3), and the device copy does not come back
    const b = boot({ device: fakeDevice(DEVICE_D), saved: { bars: savedRows(25, { k: 0.5 }), savedAt: SAVED_AT }, idbMs: 20 })
    b.pf.holdsBars('NEWB', 'D')
    await vi.advanceTimersByTimeAsync(60)
    expect(scales(b.store.peek(b.key))).toEqual([0.5])
    expect(b.store.peek(b.key).source).toBe('idb')
    expect(b.pf.devicePaints('NEWB', 'D')).toBe(false)
    b.store.dispose()
  })

  it('S2 a saved SERVER answer (stamped) is never joined by the device copy', async () => {
    const key = keyOf({ sym: 'NEWB', tf: 'D' })
    const meta = { v: 1, key, cacheKey: 'b1:NEWB:D:day', grid: null, historyRev: 3, seriesRev: 9000, adjBasis: null,
      completeThrough: null, verifiedThrough: null, spans: [], gen: 0, sealed: { t: [], h: [] } }
    const { store, pf } = boot({ device: fakeDevice(DEVICE_D, { delayMs: 5 }), saved: { bars: savedRows(25), savedAt: SAVED_AT, meta } })
    pf.holdsBars('NEWB', 'D')
    await vi.advanceTimersByTimeAsync(30)
    const s = store.peek(key)
    expect(s.cacheKey).toBe('b1:NEWB:D:day')
    expect(s.source).toBe('idb')
    expect(s.bars.length).toBe(25)
    expect(pf.deviceVerdict('NEWB', 'D')).toMatchObject({ paints: false, reason: 'held:idb' })
    store.dispose()
  })

  it('S3 a saved copy holding a FORMING bar is never joined (mid-session)', async () => {
    const MID = Date.UTC(2026, 10, 20, 16, 0)             // Fri 2026-11-20 11:00 ET: the session is open
    vi.setSystemTime(MID)
    // the saved copy's last row is today's bar as it stood when it was saved (09:45): a forming bar
    const saved = savedRows(25)
    saved[saved.length - 1] = { ...saved[saved.length - 1], c: 1, l: 1 }
    // the device copy: complete to the last closed minute, today's forming bar as it stands now
    const device = fakeDevice(DEVICE_D, { delayMs: 5, through: Math.floor(MID / 1000) - 30 })
    const { store, pf, key } = boot({ device, saved: { bars: saved, savedAt: MID - 75 * 60 * 1000 } })
    pf.holdsBars('NEWB', 'D')
    await vi.advanceTimersByTimeAsync(30)
    const s = store.peek(key)
    expect(s.developing?.c).toBe(1)                       // the saved copy's forming bar, untouched
    expect(s.source).toBe('idb')
    expect(pf.devicePaints('NEWB', 'D')).toBe(false)
    store.dispose()
  })
})
