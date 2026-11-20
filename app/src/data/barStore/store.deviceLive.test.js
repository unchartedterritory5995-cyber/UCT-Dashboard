// DURING THE SESSION a device copy current to the last closed minute (the seed's window + today's bars
// from the minute frames, data/deviceStore/live.js) is a WHOLE first paint. Contract, through the real
// store (registry + reducer + persist + network) and the real prefetch facade:
//   L1 mid-session, a never-opened symbol's device copy (complete buckets only, complete through the
//      last closed minute) is displayable in the same call, CONTEXT (no request), and the handoff's
//      device rule accepts it although the lake's depth is still due
//   L2 the server's answer then changes NONE of the bars the device copy painted (same values on every
//      bar); it only adds what the device did not hold (the forming bucket, pre-market bars)
//   L3 an extended view of a key both sessions share is never painted from the regular-session copy,
//      by the device rule OR by the regular status rule
//   L4 a device copy behind the session (yesterday's seed alone) is not; nor is a saved copy (not the
//      device's), however current
//   L5 a device copy whose stamp is older than 2 minutes is not, until the switch re-reads the device and
//      finds a newer one (a copy warmed long ago never paints its old bars)
//   L6 D / W / M never paint from the device mid-session (today's daily bar is not complete); outside the
//      session a copy complete through the last session does
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createBarStore } from './index'
import { createPrefetch } from './prefetch'
import { keyOf, STATUS, ACTION } from './types'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { memClear } from '../../utils/barsMemCache'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const OPEN = Date.UTC(2026, 10, 18, 14, 30) / 1000        // Wed 2026-11-18 09:30 ET
const NOW = (OPEN + 2 * 3600 + 60) * 1000                  // 11:31:00 ET: the 11:30 minute just closed
const DAY = 86400
const bar = (t, k, i) => { const o = Math.round((50 + ((i * 7) % 13) / 4) * 100) / 100 * k; return { t, o, h: o + 0.5 * k, l: o - 0.5 * k, c: o + 0.25 * k, v: 1000 + i } }
const session = (open, upto, k = 1) => { const out = []; for (let i = 0; i < 78 && open + i * 300 <= upto; i++) out.push(bar(open + i * 300, k, i)); return out }
// seed: yesterday's session; live overlay: today 09:30 ... 11:25, the last bucket COMPLETE at 11:31:00
const DEVICE = [...session(OPEN - DAY, Infinity), ...session(OPEN, OPEN + 2 * 3600 - 300)]
const THROUGH = OPEN + 2 * 3600 + 60                       // the end of the 11:30 minute
const YESTERDAY = session(OPEN - DAY, Infinity)

function answer() {
  // what /api/bars sends: the same regular-session bars, the pre-market ones too (the key is shared by
  // both sessions), and the forming 11:30 bucket with the trades of the minute in progress
  const pre = [{ t: OPEN - 3600, o: 49, h: 49.5, l: 48.5, c: 49.25, v: 10 }]
  const closed = DEVICE
  const forming = { ...bar(OPEN + 2 * 3600, 1, 24), rev: 9001 }
  const bars = [...closed.slice(0, 78), ...pre, ...closed.slice(78)]
  return {
    ticker: 'NEWB', tf: '5', bars, contract: 1, grid: 'eth-clock', session: 'rth', cache_key: 'b1:NEWB:5:eth-clock',
    series_rev: 9000, history_rev: 1, verified_through: Math.floor(NOW / 1000), complete_through: OPEN + 2 * 3600,
    tail_status: 'verified', developing: forming,
  }
}

/** A device source holding `rows` complete through `through` for (NEWB, tf); `swap` replaces them. */
const fakeDevice = (rows, { cached = true, through = THROUGH, tf = '5' } = {}) => {
  let hit = { rows, through, savedAt: through * 1000 }
  return {
    swap: (r, th) => { hit = { rows: r, through: th, savedAt: th * 1000 } },
    peek: vi.fn((s, t) => (cached && s === 'NEWB' && t === tf ? hit : null)),
    read: vi.fn(async (s, t) => (s === 'NEWB' && t === tf ? hit : null)),
  }
}

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

function boot({ device, request = vi.fn(() => new Promise(() => {})) }) {
  const store = createBarStore({
    request, device, io: { idbGet: async () => null, idbGetHistoryEntry: async () => null, idbPutMonotonic: async () => {}, memPutMonotonic: () => {} },
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
    // a lake that carries the key: its whole depth is DUE for a never-opened symbol
    history: { olderBars: vi.fn(() => new Promise(() => {})), prime: vi.fn(), hasSymbol: vi.fn(async () => true) },
  })
  return { store, request, pf: createPrefetch({ store, tickerMeta: () => {}, extended: () => false }), key: keyOf({ sym: 'NEWB', tf: '5' }) }
}

describe('a device copy current to the last closed minute', () => {
  it('L1 is displayable at once, CONTEXT, and the device rule paints it with the lake depth still due', () => {
    const { store, pf, key, request } = boot({ device: fakeDevice(DEVICE) })
    expect(pf.peekDisplayable('NEWB', '5')).toBe(true)
    const s = store.peek(key)
    expect(s.source).toBe('device')
    expect(s.status).toBe(STATUS.CONTEXT)
    expect(s.developing).toBeNull()                                   // no unfinished bucket from the device
    expect(store.persist.savedAtOf(key)).toBe(THROUGH * 1000)         // its age: complete through 11:31:00
    expect(pf.lakePending('NEWB', '5')).toBe(true)
    expect(pf.devicePaints('NEWB', '5', { showExtended: false })).toBe(true)
    expect(request).not.toHaveBeenCalled()
    store.dispose()
  })

  it('L2 the server\'s answer changes none of the bars the device copy painted', async () => {
    let release
    const request = vi.fn(() => new Promise((r) => { release = () => r(answer()) }))
    const { store, key } = boot({ device: fakeDevice(DEVICE), request })
    const off = store.subscribe(key, () => {})
    await vi.advanceTimersByTimeAsync(1)
    const painted = store.getSnapshot(key).bars.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v])
    expect(painted.length).toBe(DEVICE.length)
    release()
    await vi.advanceTimersByTimeAsync(20)
    const s = store.getSnapshot(key)
    expect(s.restSeen).toBe(true)
    const byT = new Map(s.bars.map((b) => [b.t, [b.t, b.o, b.h, b.l, b.c, b.v]]))
    for (const row of painted) expect(byT.get(row[0])).toEqual(row)  // value for value
    expect(byT.has(OPEN - 3600)).toBe(true)                           // the pre-market bar is only ADDED
    off()
    store.dispose()
  })

  it('L3 an extended view of the shared 5m key is never painted from the regular-session copy', () => {
    const { pf } = boot({ device: fakeDevice(DEVICE) })
    expect(pf.peekDisplayable('NEWB', '5', { showExtended: true })).toBe(false)
    expect(pf.devicePaints('NEWB', '5', { showExtended: true })).toBe(false)
    expect(pf.peekDisplayable('NEWB', '5', { showExtended: false })).toBe(true)   // the same copy, RTH view
  })

  it('L4 behind the session (yesterday alone), or a saved copy however current: not the device rule', () => {
    const a = boot({ device: fakeDevice(YESTERDAY) })
    expect(a.pf.peekDisplayable('NEWB', '5')).toBe(false)
    expect(a.store.peek(a.key).status).toBe(STATUS.PROVISIONAL)
    expect(a.pf.devicePaints('NEWB', '5')).toBe(false)
    a.store.dispose()
    const b = boot({ device: null })
    b.store.registry.acquire(b.key)
    b.store.registry.dispatch(b.key, { type: ACTION.IDB_HIT, key: b.key, payload: { bars: DEVICE } })
    expect(b.store.peek(b.key).status).toBe(STATUS.CONTEXT)
    expect(b.pf.devicePaints('NEWB', '5')).toBe(false)
    b.store.dispose()
  })
  it('L5 a copy older than 2 minutes does not paint until the switch re-reads a newer one', () => {
    const early = DEVICE.slice(0, -1)                                    // through the 11:20 bucket
    const dev = fakeDevice(early, { through: OPEN + 116 * 60 })          // complete through 11:26
    const { store, pf, key } = boot({ device: dev })
    expect(pf.peekDisplayable('NEWB', '5')).toBe(true)                   // current by status (one bucket)
    expect(pf.devicePaints('NEWB', '5')).toBe(false)                     // but 5 minutes old: not by stamp
    dev.swap(DEVICE, THROUGH)                                            // the device has moved on
    expect(pf.devicePaints('NEWB', '5')).toBe(true)                      // re-read on the switch, in the same call
    expect(store.peek(key).bars.length).toBe(DEVICE.length)
    store.dispose()
  })

  it('L6 D/W/M: never from the device mid-session; outside it, a copy complete through the last session', () => {
    const days = (n, end) => Array.from({ length: n }, (_, i) => ({ t: end - (n - 1 - i) * DAY, o: 10, h: 11, l: 9, c: 10.5, v: 100 }))
    const D_END = Date.UTC(2026, 10, 17) / 1000                          // yesterday (Tue)
    const mid = boot({ device: fakeDevice(days(60, D_END), { tf: 'D', through: THROUGH }) })
    mid.pf.peekBars('NEWB', 'D')
    expect(mid.pf.devicePaints('NEWB', 'D')).toBe(false)
    mid.store.dispose()
    vi.setSystemTime(Date.UTC(2026, 10, 19, 13, 0))                      // Thu 08:00 ET, before the open
    const pre = boot({ device: fakeDevice(days(60, Date.UTC(2026, 10, 18) / 1000), { tf: 'D', through: Date.UTC(2026, 10, 19) / 1000 }) })
    pre.pf.peekBars('NEWB', 'D')
    expect(pre.pf.devicePaints('NEWB', 'D')).toBe(true)
    pre.store.dispose()
    // Wednesday's bar held (current by status) but stamped 15:00 ET Wednesday: not known complete
    const old = boot({ device: fakeDevice(days(60, Date.UTC(2026, 10, 18) / 1000), { tf: 'D', through: Date.UTC(2026, 10, 18, 20, 0) / 1000 }) })
    old.pf.peekBars('NEWB', 'D')
    expect(old.store.peek(keyOf({ sym: 'NEWB', tf: 'D' })).status).toBe(STATUS.CONTEXT)
    expect(old.pf.devicePaints('NEWB', 'D')).toBe(false)
    old.store.dispose()
  })
  it('L10 deviceVerdict names the rule devicePaints answers with, and what the store holds', async () => {
    const both = (pf, opts) => { const v = pf.deviceVerdict('NEWB', '5', opts); expect(pf.devicePaints('NEWB', '5', opts)).toBe(v.paints); return v }
    const a = boot({ device: fakeDevice(DEVICE) })
    a.pf.peekDisplayable('NEWB', '5')
    expect(both(a.pf, { showExtended: false })).toEqual({ paints: true, reason: 'paints', held: 'device' })
    expect(both(a.pf, { showExtended: true })).toEqual({ paints: false, reason: 'ext-hours', held: 'device' })
    a.store.dispose()
    const old = boot({ device: fakeDevice(DEVICE.slice(0, -1), { through: OPEN + 116 * 60 }) })
    old.pf.peekDisplayable('NEWB', '5')
    expect(both(old.pf).reason).toBe('stale')
    old.store.dispose()
    const y = boot({ device: fakeDevice(YESTERDAY) })
    y.pf.peekDisplayable('NEWB', '5')
    expect(both(y.pf).reason).toBe(`status:${STATUS.PROVISIONAL}`)
    y.store.dispose()
    const none = boot({ device: null })
    expect(both(none.pf)).toEqual({ paints: false, reason: 'none', held: 'none' })
    none.store.registry.acquire(none.key)
    none.store.registry.dispatch(none.key, { type: ACTION.IDB_HIT, key: none.key, payload: { bars: DEVICE } })
    const other = both(none.pf)
    expect(other.reason).toBe(`held:${none.store.peek(none.key).source}`)
    expect(other.held).not.toBe('device')
    none.store.dispose()
    let release
    const request = vi.fn(() => new Promise((r) => { release = () => r(answer()) }))
    const s = boot({ device: fakeDevice(DEVICE), request })
    const off = s.store.subscribe(s.key, () => {})
    await vi.advanceTimersByTimeAsync(1)
    release()
    await vi.advanceTimersByTimeAsync(20)
    expect(both(s.pf)).toEqual({ paints: false, reason: 'held:rest', held: 'rest' })   // the answer re-sources the key
    off()
    s.store.dispose()
  })

  // ⭐ TODAY'S FORMING BAR IN THE DEVICE COPY (deviceStore/forming.js, off until the evidence): the store needs
  // nothing new. The copy's last row is a bucket the clock says has not ended, so it is the entry's developing
  // bar (a local one); the device rule paints it with the rest, and the server's answer, whose developing bar
  // equals it, changes no bar of that first frame.
  it('L11 a copy ending with the forming bucket: the first frame holds it, and an equal answer changes nothing', async () => {
    const FORMING = bar(OPEN + 2 * 3600, 1, 24)                       // 11:30, the bucket in progress
    let release
    const request = vi.fn(() => new Promise((r) => { release = () => r(answer()) }))
    const { store, pf, key } = boot({ device: fakeDevice([...DEVICE, FORMING]), request })
    expect(pf.peekDisplayable('NEWB', '5')).toBe(true)
    expect(pf.devicePaints('NEWB', '5', { showExtended: false })).toBe(true)
    const s0 = store.peek(key)
    expect(s0.source).toBe('device')
    expect(s0.developing && [s0.developing.t, s0.developing.o, s0.developing.h, s0.developing.l, s0.developing.c, s0.developing.v])
      .toEqual([FORMING.t, FORMING.o, FORMING.h, FORMING.l, FORMING.c, FORMING.v])
    const off = store.subscribe(key, () => {})
    await vi.advanceTimersByTimeAsync(1)
    const row = (b) => [b.t, b.o, b.h, b.l, b.c, b.v]
    // what the chart draws: the sealed rows, then the developing bar (adapter.legacyBars)
    const drawn = (snap) => [...snap.bars, ...(snap.developing ? [snap.developing] : [])].map(row)
    const painted = drawn(store.getSnapshot(key))
    expect(painted.at(-1)).toEqual(row(FORMING))                       // the first frame ends with it
    release()
    await vi.advanceTimersByTimeAsync(20)
    const after = new Map(drawn(store.getSnapshot(key)).map((r) => [r[0], r]))
    for (const r of painted) expect(after.get(r[0])).toEqual(r)        // every painted bar, the forming one too
    off()
    store.dispose()
  })

  it('L12 D mid-session: a copy ending with today\'s forming bar paints (without it, it does not: L6)', () => {
    const days = (n, end) => Array.from({ length: n }, (_, i) => ({ t: end - (n - 1 - i) * DAY, o: 10, h: 11, l: 9, c: 10.5, v: 100 }))
    const TODAY = Date.UTC(2026, 10, 18) / 1000
    const rows = [...days(60, TODAY - DAY), { t: TODAY, o: 10.4, h: 10.9, l: 10.1, c: 10.6, v: 5e6 }]
    const { store, pf } = boot({ device: fakeDevice(rows, { tf: 'D', through: THROUGH }) })
    pf.peekBars('NEWB', 'D')
    const s = store.peek(keyOf({ sym: 'NEWB', tf: 'D' }))
    expect(s.developing && s.developing.t).toBe(TODAY)
    expect(pf.devicePaints('NEWB', 'D')).toBe(true)
    store.dispose()
  })

  // ⭐ THE VOLUME TOLERANCE (deviceStore/forming.js, the intraday evidence): the vendor truncates minute volumes, so the
  // server's bucket volume may be ABOVE the rollup of its minutes by less than 1 share per minute in the bucket. Its
  // prices equal the rollup's. So the answer may lift the painted forming bar's volume by that much, never its prices.
  it("L13 the forming bar's volume may trail the server's by < 1 share per minute in the bucket: the answer lifts only the volume", async () => {
    vi.setSystemTime(NOW + 2 * 60000)                                // 11:33:00: the 11:30 bucket holds 3 closed minutes
    const MINUTES = 3
    const FORMING = bar(OPEN + 2 * 3600, 1, 24)
    const ans = answer()
    ans.verified_through = Math.floor((NOW + 2 * 60000) / 1000)
    ans.developing = { ...ans.developing, v: FORMING.v + (MINUTES - 1) }   // the server above by < 1 share a minute
    let release
    const request = vi.fn(() => new Promise((r) => { release = () => r(ans) }))
    const { store, pf, key } = boot({ device: fakeDevice([...DEVICE, FORMING], { through: THROUGH + 120 }), request })
    expect(pf.peekDisplayable('NEWB', '5')).toBe(true)
    expect(pf.devicePaints('NEWB', '5', { showExtended: false })).toBe(true)
    const off = store.subscribe(key, () => {})
    await vi.advanceTimersByTimeAsync(1)
    const before = store.getSnapshot(key).developing
    expect(before.v).toBe(FORMING.v)
    release()
    await vi.advanceTimersByTimeAsync(20)
    const after = store.getSnapshot(key).developing
    expect([after.t, after.o, after.h, after.l, after.c]).toEqual([before.t, before.o, before.h, before.l, before.c])
    expect(after.v).toBe(ans.developing.v)                            // the server's volume wins...
    expect(after.v - before.v).toBeGreaterThanOrEqual(0)
    expect(after.v - before.v).toBeLessThan(MINUTES)                  // ...and it was within the tolerance
    off()
    store.dispose()
  })

  it('L7 the same device copy seen again is not dispatched again (the switch polls every 25 ms)', () => {
    const { store, pf } = boot({ device: fakeDevice(DEVICE) })
    pf.peekDisplayable('NEWB', '5')
    const dispatch = vi.spyOn(store.registry, 'dispatch')
    for (let i = 0; i < 5; i++) { pf.peekDisplayable('NEWB', '5'); pf.devicePaints('NEWB', '5') }
    expect(dispatch).not.toHaveBeenCalled()
    store.dispose()
  })

  it('L8 the prepare never reports a regular-session device copy as current for an extended view', async () => {
    const run = async (showExtended) => {
      const { store, pf } = boot({ device: fakeDevice(DEVICE) })
      let outcome = 'pending'
      pf.prepareForDisplay('NEWB', '5', { showExtended }).then((o) => { outcome = o })
      await vi.advanceTimersByTimeAsync(1500)
      store.dispose()
      return outcome
    }
    expect(await run(false)).toBe('current')
    expect(await run(true)).toBe('pending')                              // it waits for the server instead
  })
  it('L9 once a saved copy joins the device copy, the entry is no longer the device copy: the rule stops', () => {
    const { store, pf, key } = boot({ device: fakeDevice(DEVICE) })
    pf.peekDisplayable('NEWB', '5')
    expect(pf.devicePaints('NEWB', '5')).toBe(true)
    store.registry.dispatch(key, { type: ACTION.IDB_HIT, key, payload: { bars: DEVICE.slice(0, 80) } })
    expect(store.peek(key).source).toBe('idb')
    expect(pf.devicePaints('NEWB', '5')).toBe(false)                     // its stamp describes the device copy only
    store.dispose()
  })
})
