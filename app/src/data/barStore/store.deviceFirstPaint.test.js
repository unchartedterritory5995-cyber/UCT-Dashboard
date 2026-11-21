// WHY A NEVER-OPENED CHART DID NOT PAINT FROM THE DEVICE (devgates 2026-11-21: 3 of 28, then 0 of 28), AND WHAT THE
// DEVICE COPY MAY AND MAY NOT DO TO A COPY THE KEY ALREADY HOLDS (review of #2407).
// Through the real store (registry + reducer + persist + network) and the real prefetch facade, with a fake
// device source, a fake IndexedDB read and a server that never answers. The clock is a SATURDAY unless a case
// says otherwise: the seed is as of Friday, the market is shut, and a whole device copy is fresh (fresh.js).
//
//   W1 the wake a landing device copy causes already carries the copy's stamps: a waiter that asks the device
//      rule INSIDE that wake (the handoff's watcher, prefetch.watch) is told it paints. The stamps were written
//      after the dispatch, so the one wake a switch gets read `through` as unknown and answered 'stale'.
//   W2 a device copy the reducer refuses leaves the entry's stamps exactly as they were.
//   K1 the key press's device read never stands in for the hydrate: a deep copy in the mem cache is still found
//      by the decision's first look (holdsBars) in the same task.
// A JOIN (the device copy landing on a held copy that is not its own):
//   P1 a saved copy that makes no claim (the universe pack's rows in IndexedDB) landing FIRST does not shut a
//      FRESH device copy out: it joins (the saved copy's deeper rows stay) and its rows win where they differ
//   P2 ...nor does one landing AFTER the device copy take the key away from it
//   M1 mid-session, the device copy ends with today's FORMING bar and lands first: the pack's rows landing after
//      it leave the key, the forming bar and the saved time the device's (the chart's daily gate reads that time)
//   M2 mid-session, the pack's rows first: the device copy joins and its forming bar is the entry's
//   L1 a lake-only entry (the lake ends a session early) and a fresh device copy: joined, the lake's depth kept
// The refusals:
//   F1 a device copy that is NOT fresh never joins a held copy, whichever lands first: a seed that stops short of
//      its as-of close hands a last row nobody vouches for, and joined it would REPLACE the held complete bucket
//   F2 ...nor through the mem door, onto the lake's rows (the chart subscribing: persist.hydrateMem)
//   T1 a held copy whose tail is NEWER than the device copy's last row is never joined, whichever lands first
//      (the merged tail would be judged under the device's stamp)
//   S1 a saved copy on ANOTHER price basis (a split between the two) is never joined, in either order
//   S2 a saved SERVER answer (stamped: its own identity and paint rule) is never joined by the device copy
//   S3 a saved copy holding its OWN forming bar is never joined (that bar is as old as the save)
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createBarStore } from './index'
import { createPrefetch } from './prefetch'
import { keyOf, STATUS, ACTION } from './types'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { memClear, memPutMonotonic } from '../../utils/barsMemCache'
import { dailyCachePaintVerdict } from '../../utils/marketSession'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const SAT = Date.UTC(2026, 10, 21, 20, 50)             // Sat 2026-11-21 15:50 ET
const WED = '2026-11-18', THU = '2026-11-19', FRI = '2026-11-20'
const LAST = FRI                                        // the last closed session: the seed's as-of day
const dayUnix = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000
const THROUGH = dayUnix(LAST) + 86400                   // deviceStore/engine.js: complete through its as-of day
/** The `n` weekdays ending at `last` (no NYSE holiday falls in the ten weeks before 2026-11-20). */
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
/** A row both copies hold whose values DIFFER (a close the pack caught before the vendor revised it). */
const REVISED = '2026-11-10'
const withRevised = (rows) => rows.map((r) => (r.t === REVISED ? { ...r, c: r.c + 3 } : r))

// intraday: regular-session buckets (November: 09:30 ET = 14:30 UTC)
const etOpen = (iso) => dayUnix(iso) + 14 * 3600 + 30 * 60
const pxI = (t) => { const i = (t / 300) % 23; const o = 50 + i / 4; return { o, h: o + 0.5, l: o - 0.5, c: o + 0.25, v: 1000 + i } }
/** The first `n` regular-session buckets of `mins` minutes on `iso` (default: the whole session). */
function rth(iso, mins, n = Math.ceil(390 / mins)) {
  const out = []
  for (let i = 0; i < n; i++) { const t = etOpen(iso) + i * mins * 60; out.push({ t, ...pxI(t) }) }
  return out
}

/** The device source (deviceStore/source.js): `read` answers after `delayMs`, and `peek` answers from then on
 *  (the client's recently-read cache). */
function fakeDevice(rows, { through = THROUGH, delayMs = 0, tf = 'D' } = {}) {
  let cached = false
  const hit = () => ({ rows, through, savedAt: through * 1000 })
  return {
    peek: vi.fn((s, t) => (cached && s === 'NEWB' && t === tf ? hit() : null)),
    read: vi.fn((s, t) => new Promise((resolve) => setTimeout(() => {
      if (s !== 'NEWB' || t !== tf) { resolve(null); return }
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
function boot({ device, saved = null, idbMs = 0, tf = 'D' }) {
  const request = vi.fn(() => new Promise(() => {}))    // the server never answers: only local copies decide
  const io = {
    idbGet: vi.fn(() => new Promise((r) => setTimeout(() => r(saved), idbMs))),
    idbGetHistoryEntry: async () => null, idbPutMonotonic: async () => {}, memPutMonotonic: () => {},
  }
  const store = createBarStore({
    request, device, io, stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), history: null,
  })
  const key = keyOf({ sym: 'NEWB', tf })
  return { store, request, key, pf: createPrefetch({ store, tickerMeta: () => {}, extended: () => false }) }
}
const scales = (s) => [...new Set(s.bars.map((b) => Math.round((b.o / px(new Date(b.t * 1000).toISOString().slice(0, 10)).o) * 1000) / 1000))]
const rowAt = (s, t) => s.bars.find((b) => b.t === t)
const stampOf = (key) => ({ v: 1, key, cacheKey: 'b1:NEWB:D:day', grid: null, historyRev: 3, seriesRev: 9000, adjBasis: null,
  completeThrough: null, verifiedThrough: null, spans: [], gen: 0, sealed: { t: [], h: [] } })

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
    expect(seen[0].reason).toBe('paints')                 // (it read 'stale': the stamp was not written yet)
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

describe('the key press\'s device read and the hydrate', () => {
  it('K1 a deep copy in the mem cache is still found by the decision\'s first look, in the same task', async () => {
    const { store, pf, key } = boot({ device: fakeDevice(DEVICE_D) })
    // a saved server answer in the mem cache; its registry entry is gone (the LRU, a row visited earlier)
    memPutMonotonic('NEWB', 'D', savedRows(50), { savedAt: SAVED_AT, meta: stampOf(key) })
    expect(store.peek(key)).toBe(null)
    pf.deviceWarm('NEWB', 'D')                            // the key press (handoffGroups.primeGroup) ...
    expect(pf.holdsBars('NEWB', 'D')).toBe(true)          // ... then the decision's first look
    expect(store.peek(key).bars.length).toBe(50)
    await vi.advanceTimersByTimeAsync(30)
    const s = store.peek(key)
    expect(s.source).toBe('mem')                          // a stamped answer: the device copy is not consulted
    expect(s.bars.length).toBe(50)
    store.dispose()
  })
})

describe('a saved copy that makes no claim (the universe pack\'s rows) and a fresh device copy', () => {
  // the saved copy is DEEPER than the device's (50 sessions against 40) and one row they share differs
  const SAVED = withRevised(savedRows(50))
  const FIRST = dayUnix(sessions(50)[0])

  it('P1 the saved copy lands FIRST: the device copy joins it (its depth stays) and the device\'s rows win', async () => {
    const { store, pf, key, request } = boot({ device: fakeDevice(DEVICE_D, { delayMs: 5 }), saved: { bars: SAVED, savedAt: SAVED_AT } })
    pf.holdsBars('NEWB', 'D')
    await vi.advanceTimersByTimeAsync(2)
    expect(store.peek(key).source).toBe('idb')            // the saved copy is in, the device read still out
    expect(rowAt(store.peek(key), dayUnix(REVISED)).c).toBe(px(REVISED).c + 3)
    await vi.advanceTimersByTimeAsync(30)
    const s = store.peek(key)
    expect(s.source).toBe('device')
    expect(s.restSeen).toBe(false)
    expect(s.status).toBe(STATUS.CONTEXT)
    expect(s.bars.length).toBe(50)                        // JOINED: the saved copy's older rows are still there
    expect(s.bars[0].t).toBe(FIRST)
    expect(rowAt(s, dayUnix(REVISED)).c).toBe(px(REVISED).c)   // the device's row, not the saved copy's
    expect(scales(s)).toEqual([1])
    expect(store.persist.deviceThroughOf(key)).toBe(THROUGH)
    expect(pf.deviceVerdict('NEWB', 'D')).toMatchObject({ paints: true, reason: 'paints', held: 'device' })
    expect(request).not.toHaveBeenCalled()
    store.dispose()
  })

  it('P2 the saved copy lands AFTER the device copy: the key is still the device\'s and it paints', async () => {
    const { store, pf, key } = boot({ device: fakeDevice(DEVICE_D), saved: { bars: SAVED, savedAt: SAVED_AT }, idbMs: 20 })
    pf.holdsBars('NEWB', 'D')
    await vi.advanceTimersByTimeAsync(5)
    expect(store.peek(key).source).toBe('device')         // the device copy is in, the IndexedDB read still out
    expect(pf.devicePaints('NEWB', 'D')).toBe(true)
    await vi.advanceTimersByTimeAsync(40)
    const s = store.peek(key)
    expect(rowAt(s, dayUnix(REVISED)).c).toBe(px(REVISED).c)   // the device's row again, after the saved copy's landed on it
    expect(s.source).toBe('device')
    expect(s.bars.length).toBe(50)
    expect(s.bars[0].t).toBe(FIRST)
    expect(store.persist.deviceThroughOf(key)).toBe(THROUGH)
    expect(store.persist.savedAtOf(key)).toBe(THROUGH * 1000)
    expect(pf.deviceVerdict('NEWB', 'D')).toMatchObject({ paints: true, reason: 'paints', held: 'device' })
    store.dispose()
  })
})

describe('mid-session: the device copy ends with today\'s forming bar', () => {
  const MID = Date.UTC(2026, 10, 20, 16, 0)               // Fri 2026-11-20 11:00 ET
  const DEV_THROUGH = Math.floor(MID / 1000) - 30         // complete to the last closed minute
  const TODAY = dayUnix(FRI)
  const PACK = savedRows(50, { last: THU })               // the pack: closed sessions only, through yesterday
  const PACK_AT = MID - 6 * 3600 * 1000

  it('M1 the device copy first, the pack\'s rows after: the key, the forming bar and the saved time stay the device\'s', async () => {
    vi.setSystemTime(MID)
    const { store, pf, key } = boot({ device: fakeDevice(DEVICE_D, { through: DEV_THROUGH }), saved: { bars: PACK, savedAt: PACK_AT }, idbMs: 20 })
    pf.holdsBars('NEWB', 'D')
    await vi.advanceTimersByTimeAsync(5)
    expect(store.peek(key).source).toBe('device')
    expect(store.peek(key).developing?.t).toBe(TODAY)
    expect(pf.devicePaints('NEWB', 'D')).toBe(true)       // the switch commits here
    await vi.advanceTimersByTimeAsync(40)                 // ...and the pack's rows land a moment later
    const s = store.peek(key)
    expect(s.source).toBe('device')
    expect(s.developing?.t).toBe(TODAY)
    expect(s.developing.c).toBe(px(FRI).c)
    expect(s.bars.length).toBe(50)                        // 49 closed sessions the pack is deeper by, joined
    expect(store.persist.savedAtOf(key)).toBe(DEV_THROUGH * 1000)
    // what the chart asks before it paints a local daily copy (useBarSnapshotBars): it must not refuse this one
    expect(dailyCachePaintVerdict(FRI, store.persist.savedAtOf(key), { hasSeed: false }, MID)).toBe('ok')
    expect(pf.deviceVerdict('NEWB', 'D')).toMatchObject({ paints: true, held: 'device' })
    store.dispose()
  })

  it('M2 the pack\'s rows first, the device copy after: joined, and its forming bar is the entry\'s', async () => {
    vi.setSystemTime(MID)
    const { store, pf, key } = boot({ device: fakeDevice(DEVICE_D, { through: DEV_THROUGH, delayMs: 5 }), saved: { bars: PACK, savedAt: PACK_AT } })
    pf.holdsBars('NEWB', 'D')
    await vi.advanceTimersByTimeAsync(2)
    expect(store.peek(key).source).toBe('idb')
    expect(store.peek(key).developing).toBeNull()
    await vi.advanceTimersByTimeAsync(30)
    const s = store.peek(key)
    expect(s.source).toBe('device')
    expect(s.developing?.t).toBe(TODAY)
    expect(s.bars[0].t).toBe(dayUnix(sessions(50, THU)[0]))
    expect(store.persist.savedAtOf(key)).toBe(DEV_THROUGH * 1000)
    expect(pf.devicePaints('NEWB', 'D')).toBe(true)
    store.dispose()
  })
})

describe('a device copy that is not fresh never joins a held copy (30m, a seed that stops short of its close)', () => {
  // the held copy holds the 10:00 bucket COMPLETE; the device's copy stops there, and its last row was caught
  // while forming (measured on the published seed: A, 30m 10:00 ET, L 173.76 C 174.29 V 43,567 against
  // 172.23 / 172.34 / 84,444). Its stamp is the start of that row (deviceStore/engine.js _shortOfClose).
  const HELD = [...rth(WED, 30), ...rth(THU, 30), ...rth(FRI, 30, 2)]
  const WHOLE = HELD[HELD.length - 1]
  const PARTIAL = { ...WHOLE, l: WHOLE.l + 0.3, c: WHOLE.c - 0.2, v: 400 }
  const SHORT = [...HELD.slice(0, -1), PARTIAL]
  const short = (o = {}) => fakeDevice(SHORT, { tf: '30', through: PARTIAL.t, ...o })

  it('F1 whichever lands first, the held complete bucket is never replaced by the device\'s last row', async () => {
    // the saved copy first
    const a = boot({ tf: '30', device: short({ delayMs: 5 }), saved: { bars: HELD, savedAt: SAVED_AT } })
    a.pf.peekDisplayable('NEWB', '30')                    // the switch's first look at an intraday key: the hydrate
    await vi.advanceTimersByTimeAsync(30)
    expect(rowAt(a.store.peek(a.key), WHOLE.t).c).toBe(WHOLE.c)
    expect(rowAt(a.store.peek(a.key), WHOLE.t).v).toBe(WHOLE.v)
    expect(a.store.peek(a.key).source).toBe('idb')
    a.store.dispose()
    // the device copy first (it SEEDS the empty entry, and never paints: provisional), then the saved copy
    const b = boot({ tf: '30', device: short(), saved: { bars: HELD, savedAt: SAVED_AT }, idbMs: 20 })
    b.pf.peekDisplayable('NEWB', '30')
    await vi.advanceTimersByTimeAsync(5)
    expect(b.store.peek(b.key).source).toBe('device')
    expect(b.pf.devicePaints('NEWB', '30')).toBe(false)
    await vi.advanceTimersByTimeAsync(40)
    expect(rowAt(b.store.peek(b.key), WHOLE.t).c).toBe(WHOLE.c)   // the saved copy's row won, and stayed
    expect(rowAt(b.store.peek(b.key), WHOLE.t).v).toBe(WHOLE.v)
    expect(b.store.peek(b.key).source).toBe('idb')
    b.store.dispose()
  })

  it('F2 nor through the mem door onto the lake\'s rows (the chart subscribing after the lake landed)', async () => {
    const LAKE = [...rth(WED, 30), ...rth(THU, 30), ...rth(FRI, 30)]
    const { store, pf, key } = boot({ tf: '30', device: short() })
    pf.peekDisplayable('NEWB', '30')
    await vi.advanceTimersByTimeAsync(5)
    expect(store.peek(key).source).toBe('device')
    store.registry.dispatch(key, { type: ACTION.LAKE_HIT, key, payload: { sym: 'NEWB', bars: LAKE } })
    expect(store.peek(key).source).toBe('lake')
    expect(rowAt(store.peek(key), WHOLE.t).c).toBe(WHOLE.c)       // the lake's complete bucket won at the shared row
    store.persist.hydrateMem(key)                         // index.js _start -> persist.hydrate -> hydrateMem
    expect(rowAt(store.peek(key), WHOLE.t).c).toBe(WHOLE.c)
    expect(store.peek(key).source).toBe('lake')
    store.dispose()
  })

  it('L1 a lake-only entry and a FRESH device copy: joined, the key the device\'s, the lake\'s depth kept', async () => {
    const LAKE = [...rth(WED, 30), ...rth(THU, 30)]       // the lake ends a session early
    const FULL = [...rth(THU, 30), ...rth(FRI, 30)]
    const { store, pf, key } = boot({ tf: '30', device: fakeDevice(FULL, { tf: '30' }) })
    store.registry.dispatch(key, { type: ACTION.LAKE_HIT, key, payload: { sym: 'NEWB', bars: LAKE } })
    expect(store.peek(key).source).toBe('lake')
    pf.deviceWarm('NEWB', '30')                           // the key press
    await vi.advanceTimersByTimeAsync(5)
    const s = store.peek(key)
    expect(s.source).toBe('device')
    expect(s.bars.length).toBe(39)
    expect(s.bars[0].t).toBe(etOpen(WED))
    expect(s.bars[s.bars.length - 1].t).toBe(FULL[FULL.length - 1].t)
    expect(pf.deviceVerdict('NEWB', '30', { showExtended: false })).toMatchObject({ paints: true, held: 'device' })
    store.dispose()
  })
})

describe('a held copy whose tail is newer than the device copy\'s last row is never joined (5m, mid-session)', () => {
  const NOW = Date.UTC(2026, 10, 20, 16, 31, 30)          // Fri 11:31:30 ET
  const SAVED_5 = [...rth(THU, 5), ...rth(FRI, 5, 24)]    // an unstamped copy saved at 11:30: through the 11:25 bucket
  const DEV_5 = [...rth(THU, 5), ...rth(FRI, 5, 23)]      // the device: through the 11:20 bucket...
  const DEV_THROUGH = Math.floor(NOW / 1000) - 110        // ...and fresh by its stamp (inside DEVICE_FRESH_MS)
  const TAIL = SAVED_5[SAVED_5.length - 1].t

  it('T1 whichever lands first, the key stays the saved copy\'s (its own behind-the-clock rule applies)', async () => {
    vi.setSystemTime(NOW)
    const a = boot({ tf: '5', device: fakeDevice(DEV_5, { tf: '5', through: DEV_THROUGH, delayMs: 5 }), saved: { bars: SAVED_5, savedAt: NOW - 90_000 } })
    a.pf.peekDisplayable('NEWB', '5')
    await vi.advanceTimersByTimeAsync(30)
    expect(a.store.peek(a.key).source).toBe('idb')
    expect(a.store.peek(a.key).bars.at(-1).t).toBe(TAIL)
    expect(a.pf.devicePaints('NEWB', '5')).toBe(false)
    a.store.dispose()
    const b = boot({ tf: '5', device: fakeDevice(DEV_5, { tf: '5', through: DEV_THROUGH }), saved: { bars: SAVED_5, savedAt: NOW - 90_000 }, idbMs: 20 })
    b.pf.peekDisplayable('NEWB', '5')
    await vi.advanceTimersByTimeAsync(5)
    expect(b.store.peek(b.key).source).toBe('device')
    await vi.advanceTimersByTimeAsync(40)
    expect(b.store.peek(b.key).source).toBe('idb')
    expect(b.store.peek(b.key).bars.at(-1).t).toBe(TAIL)
    expect(b.pf.devicePaints('NEWB', '5')).toBe(false)
    b.store.dispose()
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
    const { store, pf } = boot({ device: fakeDevice(DEVICE_D, { delayMs: 5 }), saved: { bars: savedRows(25), savedAt: SAVED_AT, meta: stampOf(key) } })
    pf.holdsBars('NEWB', 'D')
    await vi.advanceTimersByTimeAsync(30)
    const s = store.peek(key)
    expect(s.cacheKey).toBe('b1:NEWB:D:day')
    expect(s.source).toBe('idb')
    expect(s.bars.length).toBe(25)
    expect(pf.deviceVerdict('NEWB', 'D')).toMatchObject({ paints: false, reason: 'held:idb' })
    store.dispose()
  })

  it('S3 a saved copy holding its OWN forming bar is never joined (mid-session)', async () => {
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
