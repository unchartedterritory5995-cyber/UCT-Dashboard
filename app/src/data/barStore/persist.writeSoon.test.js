// ⭐ A WARM ANSWER'S WRITE WAITS FOR THE DEBOUNCE AND IDLE, LIKE A WATCHED KEY'S (2026-11-23, live-session CPU profile:
// the bar cache's read-modify-write ran in the window the charts were drawing in). An answer nobody subscribes to (a list
// warm's, through store.ensure) was written AT ONCE (persist.writeOnce: the mem write, then an IDB read of the whole
// stored record, a merge, and a put of it all back), 75-200 ms after the press that sent the warm. It now goes through
// `writeSoon`: the same debounce (PERSIST_DEBOUNCE_MS) and idle as a watched key, coalesced per key, the newest snapshot
// written, at most WRITE_SOON_MAX waiting (the oldest is written at once past that), and flushed on pagehide / hidden.
// The write itself is the same `_put`: the cache's contents, caps and eviction are unchanged.
//   W1 the write waits for the debounce, then idle (persist level; and through store.ensure, the warm's path)
//   W2 flush() writes what waits, at once (pagehide / hidden)
//   W3 two answers inside the debounce: ONE write, of the newest snapshot
//   W4 bounded: past WRITE_SOON_MAX waiting, the oldest is written at once
//   W5 the final cache equals TODAY'S, record for record (review of #2630, MEDIUM-1): today writes an unwatched key at
//      each ANSWER only, so a full answer past the 3,000-row tail record and a delta are written, and a scroll-back that
//      lands inside the debounce (the neighbour hold's deepening, 500 ms after the press; a lake join) is NOT: the pending
//      write is the answer's own snapshot, never the registry's at write time
//   W5b two answers COALESCED inside the debounce (one write, where today made two): the tail record equals today's, and
//      the series the cache gives back (the tail record and its history segment) equals today's. (The @hist record itself
//      can hold one row more than today's: today's second write skipped the segment, the one coalesced write carries the
//      newer series; the extra row is one the tail record holds too.)
//   W6 the app's store flushes on pagehide, on a hidden document and on a hidden desktop desk
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createRegistry } from './registry'
import { createPersist, PERSIST_DEBOUNCE_MS } from './persist'
import { createBarStore } from './index'
import { keyOf, ACTION } from './types'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { etUnix } from './__fixtures__/seededSeries'
import { memClear } from '../../utils/barsMemCache'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

function sessions(days) {
  const dates = []
  for (let d = new Date(Date.UTC(2026, 10, 10)); dates.length < days; d = new Date(d.getTime() - 86400000)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.unshift(d.toISOString().slice(0, 10))
  }
  const out = []
  for (const iso of dates) for (let m = 570; m < 960; m += 5) { const i = out.length; const c = 50 + (i % 37) * 0.01; out.push({ t: etUnix(iso, m), o: c, h: c + 0.05, l: c - 0.05, c, v: 100 + i }) }
  return out
}
const NOW = Date.UTC(2026, 10, 10, 23, 0)                    // Tue 18:00 ET
const ALL = sessions(60)
const full = (key, sym, bars) => ({ type: ACTION.REST_FULL, key, payload: { ticker: sym, tf: '5', bars } })
const spyIO = () => ({ idbPutMonotonic: vi.fn(async () => null), idbPutHistory: vi.fn(async () => null), memPutMonotonic: vi.fn(() => {}) })

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear() })
afterEach(() => { vi.useRealTimers() })

function rig(io) {
  vi.useFakeTimers(); vi.setSystemTime(NOW)
  const registry = createRegistry({ ctx: () => ({ nowMs: NOW }) })
  const idleQ = []
  const persist = createPersist({ registry, io, idle: (fn) => { idleQ.push(fn) } })
  return { registry, persist, idleQ, runIdle: () => { for (const fn of idleQ.splice(0)) fn() } }
}

describe("a warm answer's write waits for the debounce and idle", () => {
  it('W1 the write waits for the debounce, then idle', async () => {
    const io = spyIO()
    const r = rig(io)
    const k = keyOf({ sym: 'AAA', tf: '5' })
    r.registry.dispatch(k, full(k, 'AAA', ALL.slice(-700)))
    expect(r.persist.writeSoon(k)).toBe(true)
    expect(io.memPutMonotonic).not.toHaveBeenCalled()
    expect(io.idbPutMonotonic).not.toHaveBeenCalled()
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS - 1)
    expect(r.idleQ).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(r.idleQ).toHaveLength(1)                            // the debounce ran out: now it waits for idle
    expect(io.idbPutMonotonic).not.toHaveBeenCalled()
    r.runIdle()
    await vi.advanceTimersByTimeAsync(0)
    expect(io.memPutMonotonic).toHaveBeenCalledTimes(1)
    expect(io.idbPutMonotonic).toHaveBeenCalledTimes(1)
  })

  it("W1b the warm's path (store.ensure on a key nobody subscribes to) no longer writes at the answer", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    const io = { ...spyIO(), idbGet: async () => null, idbGetHistoryEntry: async () => null }
    const idleQ = []
    const k = keyOf({ sym: 'AAA', tf: '5' })
    const store = createBarStore({
      request: vi.fn(async () => ({ ticker: 'AAA', tf: '5', bars: ALL.slice(-700) })), io, history: null,
      stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {},
      idle: (fn) => { idleQ.push(fn) },
    })
    const asked = store.ensure(k)
    await vi.advanceTimersByTimeAsync(20)                       // (the network lane's own timers)
    await asked
    expect(store.peek(k).restSeen).toBe(true)
    expect(io.idbPutMonotonic).not.toHaveBeenCalled()          // not in the task that handled the answer
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE_MS)
    for (const fn of idleQ.splice(0)) fn()
    await vi.advanceTimersByTimeAsync(0)
    expect(io.idbPutMonotonic).toHaveBeenCalledTimes(1)
    store.dispose()
  })

  it('W2 flush() writes what waits, at once', async () => {
    const io = spyIO()
    const r = rig(io)
    const k = keyOf({ sym: 'AAA', tf: '5' })
    r.registry.dispatch(k, full(k, 'AAA', ALL.slice(-700)))
    r.persist.writeSoon(k)
    await r.persist.flush()
    expect(io.idbPutMonotonic).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS)
    r.runIdle()
    await vi.advanceTimersByTimeAsync(0)
    expect(io.idbPutMonotonic).toHaveBeenCalledTimes(1)          // and not again
  })

  it('W3 two answers inside the debounce: ONE write, of the newest snapshot', async () => {
    const io = spyIO()
    const r = rig(io)
    const k = keyOf({ sym: 'AAA', tf: '5' })
    r.registry.dispatch(k, full(k, 'AAA', ALL.slice(-700, -1)))
    r.persist.writeSoon(k)
    vi.advanceTimersByTime(500)
    r.registry.dispatch(k, full(k, 'AAA', ALL.slice(-700)))
    r.persist.writeSoon(k)
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS)
    r.runIdle()
    await vi.advanceTimersByTimeAsync(0)
    expect(io.idbPutMonotonic).toHaveBeenCalledTimes(1)
    const rows = io.idbPutMonotonic.mock.calls[0][2]
    expect(rows[rows.length - 1].t).toBe(ALL[ALL.length - 1].t)
  })

  it('W4 bounded: past WRITE_SOON_MAX waiting, the oldest is written at once', async () => {
    const { WRITE_SOON_MAX } = await import('./persist')
    expect(WRITE_SOON_MAX).toBe(32)
    const io = spyIO()
    const r = rig(io)
    for (let i = 0; i < WRITE_SOON_MAX + 8; i++) {
      const k = keyOf({ sym: `S${i}`, tf: '5' })
      r.registry.dispatch(k, full(k, `S${i}`, ALL.slice(-100)))
      r.persist.writeSoon(k)
    }
    await vi.advanceTimersByTimeAsync(0)
    expect(io.idbPutMonotonic).toHaveBeenCalledTimes(8)
    expect(io.idbPutMonotonic.mock.calls.map((c) => c[0])).toEqual(['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'])
    expect(r.persist.stats().soon).toBe(WRITE_SOON_MAX)
  })

  it("W5 the final cache equals TODAY'S, record for record: each answer is written, a scroll-back inside the debounce is not", async () => {
    const k = keyOf({ sym: 'EQL', tf: '5' })
    // [the step, whether it is an ANSWER (store.ensure writes it: today writeOnce, now writeSoon)]
    const steps = [
      [(reg) => reg.dispatch(k, full(k, 'EQL', ALL.slice(-4000, -1))), true],   // past the 3,000-row tail: an @hist too
      [(reg) => reg.dispatch(k, { type: ACTION.REST_DELTA, key: k, payload: { ticker: 'EQL', tf: '5', bars: ALL.slice(-1), since: ALL[ALL.length - 2].t } }), true],
      [(reg) => reg.dispatch(k, { type: ACTION.SCROLL_BACK, key: k, payload: { bars: ALL.slice(0, -3999) } }), false],
    ]
    const records = () => {
      const out = {}
      for (const [key, rec] of fakeDb._rows()) if (key.startsWith('EQL_')) out[key] = { bars: rec.bars.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v]), lastT: rec.lastT }
      return out
    }
    // today's path: written at each answer
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW)
    let reg = createRegistry({ ctx: () => ({ nowMs: NOW }) })
    let p = createPersist({ registry: reg })
    for (const [step, answer] of steps) { step(reg); if (answer) await p.writeOnce(k) }
    const today = records()
    expect(Object.keys(today).sort()).toEqual(['EQL_5', 'EQL_5@hist'])   // the tail record and the @hist segment
    fakeDb._clear(); memClear()
    // writeSoon: coalesced, then flushed
    reg = createRegistry({ ctx: () => ({ nowMs: NOW }) })
    p = createPersist({ registry: reg, idle: () => {} })
    // each answer's debounce runs out before the next answer (flush); the scroll-back lands inside the last one's
    for (const [step, answer] of steps) { if (answer) await p.flush(); step(reg); if (answer) p.writeSoon(k) }
    expect(reg.peek(k).bars.length).toBe(ALL.length)          // (the registry holds the deepened series...)
    await p.flush()
    expect(records()).toEqual(today)                           // (...the cache holds what today's answers wrote)
  })

  it("W5b two answers coalesced inside the debounce: today's tail record, and the series the cache gives back is today's", async () => {
    const k = keyOf({ sym: 'EQL', tf: '5' })
    const steps = [
      [(reg) => reg.dispatch(k, full(k, 'EQL', ALL.slice(-4000, -1))), true],
      [(reg) => reg.dispatch(k, { type: ACTION.REST_DELTA, key: k, payload: { ticker: 'EQL', tf: '5', bars: ALL.slice(-1), since: ALL[ALL.length - 2].t } }), true],
      [(reg) => reg.dispatch(k, { type: ACTION.SCROLL_BACK, key: k, payload: { bars: ALL.slice(0, -3999) } }), false],
    ]
    const tailRec = () => [...fakeDb._rows()].find(([key]) => key === 'EQL_5')?.[1]?.bars.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v])
    const readBack = () => {
      const byT = new Map()
      for (const [key, rec] of fakeDb._rows()) if (key.startsWith('EQL_')) for (const b of rec.bars) byT.set(b.t, [b.t, b.o, b.h, b.l, b.c, b.v])
      return [...byT.values()].sort((a, b) => a[0] - b[0])
    }
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW)
    let reg = createRegistry({ ctx: () => ({ nowMs: NOW }) })
    let p = createPersist({ registry: reg })
    for (const [step, answer] of steps) { step(reg); if (answer) await p.writeOnce(k) }
    const today = { tail: tailRec(), series: readBack() }
    fakeDb._clear(); memClear()
    reg = createRegistry({ ctx: () => ({ nowMs: NOW }) })
    p = createPersist({ registry: reg, idle: () => {} })
    for (const [step, answer] of steps) { step(reg); if (answer) p.writeSoon(k) }   // both answers in one debounce
    await p.flush()
    expect({ tail: tailRec(), series: readBack() }).toEqual(today)
    expect(today.series.length).toBe(4000)                     // (the answers' rows, not the scroll-back's)
  })

  it('W6 the app\'s store flushes on pagehide, on a hidden document and on a hidden desktop desk', async () => {
    const { getBarStore, _resetBarStoreForTests } = await import('./index')
    const { setDeskHidden, __resetDeskVisibility } = await import('../../lib/deskVisibility')
    _resetBarStoreForTests()
    const store = getBarStore()
    const flush = vi.fn(async () => {})
    store.flush = flush
    try {
      window.dispatchEvent(new Event('pagehide'))
      expect(flush).toHaveBeenCalledTimes(1)
      const was = Object.getOwnPropertyDescriptor(document, 'visibilityState')
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
      expect(flush).toHaveBeenCalledTimes(2)
      if (was) Object.defineProperty(document, 'visibilityState', was); else delete document.visibilityState
      setDeskHidden(true)
      expect(flush).toHaveBeenCalledTimes(3)
    } finally {
      __resetDeskVisibility()
      _resetBarStoreForTests()
    }
  })
})
