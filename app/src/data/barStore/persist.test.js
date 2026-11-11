// S8 — persist / hydrate (docs/architecture/barstore.md §Persist).
//   hydrate ∘ persist = base, SEALS INCLUDED, over seeded sessions (pure encode/decode and the
//   REAL write path: barsMemCache.memPutMonotonic + barsIDB.idbPutMonotonic on a fake IDB);
//   every invalidation rule of the provenance envelope; writes only on baseRev, debounced,
//   never for a local-only copy.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { reduce, initialState, isSealedRow } from './reducer'
import { createRegistry } from './registry'
import { createPersist, toCacheRows, encodeMeta, decodeEntry, rowHash, PERSIST_DEBOUNCE_MS } from './persist'
import { forSeeds, simulateIntraday, rng } from './__fixtures__/seededSeries'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { memClear, memPeekEntry, memPutMonotonic } from '../../utils/barsMemCache'
import { idbGet, idbPut } from '../../utils/barsIDB'
import { keyOf } from './types'

const N = Number(globalThis.process?.env?.BARSTORE_SEEDS || 300)
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear() })
afterEach(() => { vi.useRealTimers() })

function check(cond, msg) { if (!cond) throw new Error(typeof msg === 'function' ? msg() : msg) }

/** Run a seeded session's events chronologically to its final state. */
function settledState(sim) {
  const nowMs = sim.nowSec * 1000
  let s = initialState(sim.key, { nowMs })
  for (const e of sim.events) s = reduce(s, e.action, { nowMs, streamLive: true, ...(e.ctx || {}) })
  return reduce(s, sim.settle, { nowMs })
}

const rowsOf = (s) => s.bars.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v])
const sealedOf = (s) => s.bars.filter((b) => isSealedRow(s, b)).map((b) => [b.t, b.o, b.h, b.l, b.c, b.v])

/** S8: the hydrated base equals the persisted one (rows, seals, identity, next delta). */
function checkRoundTrip(s, h) {
  check(JSON.stringify(rowsOf(h)) === JSON.stringify(rowsOf(s)), 'S8 rows differ after hydrate')
  check(JSON.stringify(sealedOf(h)) === JSON.stringify(sealedOf(s)), () => `S8 seals lost: ${sealedOf(h).length}/${sealedOf(s).length}`)
  check(h.cacheKey === s.cacheKey && h.historyRev === s.historyRev && h.seriesRev === s.seriesRev, 'S8 identity differs')
  check(h.completeThrough == null ? s.completeThrough == null || !sealedOf(s).length : h.completeThrough <= s.completeThrough, 'S8 completeThrough claims more than persisted')
  if (sealedOf(s).length) {
    check(h.needsFull === false, 'S8 restored seals must allow a delta')
    // The next request re-reads at least what the persisted state would (never skips a row).
    check(h.deltaFrom != null && h.deltaFrom <= (s.deltaFrom ?? Infinity), 'S8 hydrated delta starts later than the persisted one')
  }
  check(!h.restSeen, 'a hydrated entry is local until the server answers')
}

describe('S8 persist ∘ hydrate (pure envelope)', () => {
  it(`hydrate ∘ persist = base, seals included (${N} seeded sessions, plain + rich)`, () => {
    let withSeals = 0
    forSeeds(N, 70000, (r) => {
      const sim = simulateIntraday(r, { rich: r.chance(0.5) })
      vi.setSystemTime(sim.nowSec * 1000)
      const s = settledState(sim)
      if (!s.restSeen || !s.bars.length) return
      const entry = { bars: toCacheRows(s), meta: encodeMeta(s) }
      const h = reduce(initialState(sim.key, { nowMs: sim.nowSec * 1000 }), { type: 'idb-hit', payload: decodeEntry(sim.key, entry) }, { nowMs: sim.nowSec * 1000 })
      checkRoundTrip(s, h)
      if (sealedOf(s).length) withSeals++
      // ... and once the server answers again, the hydrated entry converges to the same state.
      const again = reduce(h, sim.settle, { nowMs: sim.nowSec * 1000 })
      check(JSON.stringify(sealedOf(again)) === JSON.stringify(sealedOf(s)), 'S8 hydrated + settle diverged from settled')
    })
    expect(withSeals).toBeGreaterThan(N / 4)   // the suite exercises seals, not just rows
  })

  it('D/W/M rows are written in the cache shape (YYYY-MM-DD) and read back to the same unix t', () => {
    const key = keyOf({ sym: 'SIM', tf: 'D' })
    const nowMs = Date.UTC(2026, 10, 11, 21)
    const bars = ['2026-11-06', '2026-11-09', '2026-11-10'].map((d, i) => ({ t: d, o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 100 + i }))
    const s = reduce(initialState(key, { nowMs }), { type: 'rest-full', payload: { bars, contract: 1, grid: 'plain', cache_key: 'b1:SIM:D:plain', series_rev: 5, history_rev: 2, complete_through: null } }, { nowMs })
    const rows = toCacheRows(s)
    expect(rows.map((x) => x.t)).toEqual(['2026-11-06', '2026-11-09', '2026-11-10'])
    expect(rows.every((x) => typeof x.t === 'string')).toBe(true)
    const h = reduce(initialState(key, { nowMs }), { type: 'idb-hit', payload: decodeEntry(key, { bars: rows, meta: encodeMeta(s) }) }, { nowMs })
    expect(rowsOf(h)).toEqual(rowsOf(s))
  })
})

describe('S8 invalidation rules of the provenance envelope', () => {
  const nowMs = Date.UTC(2026, 10, 10, 18, 0)   // 13:00 ET
  const key = keyOf({ sym: 'SIM', tf: '5' })
  const T = (min) => Date.UTC(2026, 10, 10, 14, 30) / 1000 + min * 60   // 09:30 ET + min
  const bar = (t, c = 100) => ({ t, o: c, h: c + 1, l: c - 1, c, v: 10 })
  function sealedState() {
    const bars = [0, 5, 10, 15, 20].map((m) => bar(T(m), 100 + m))
    return reduce(initialState(key, { nowMs }), { type: 'rest-full', payload: {
      bars, contract: 1, grid: 'eth-clock', cache_key: 'b1:SIM:5:eth-clock', series_rev: 9, history_rev: 3,
      complete_through: T(20), verified_through: T(25), tail_status: 'verified', developing: null,
    } }, { nowMs })
  }
  const hydrate = (entry, base = initialState(key, { nowMs })) =>
    reduce(base, { type: 'idb-hit', payload: decodeEntry(key, entry) }, { nowMs })

  it('a stored row changed by another writer cuts the span that covers it', () => {
    const s = sealedState()
    expect(sealedOf(s).length).toBe(4)
    const rows = toCacheRows(s)
    rows[2] = { ...rows[2], c: rows[2].c + 0.5, h: rows[2].h + 0.5 }
    const h = hydrate({ bars: rows, meta: encodeMeta(s) })
    expect(sealedOf(h)).toEqual([])                 // the one span is gone — rows hydrate as local
    expect(h.needsFull).toBe(true)
    expect(h.bars.find((b) => b.t === rows[2].t).c).toBe(rows[2].c)
  })

  it('a sealed row another writer DROPPED (or a row it added) cuts the span', () => {
    const s = sealedState()
    const rows = toCacheRows(s)
    expect(sealedOf(hydrate({ bars: rows.filter((_, i) => i !== 1), meta: encodeMeta(s) }))).toEqual([])
    const extra = [...rows, bar(T(2), 1)].sort((a, b) => a.t - b.t)   // off-grid stray inside the span
    const h = hydrate({ bars: extra, meta: encodeMeta(s) })
    expect(sealedOf(h).length).toBeLessThanOrEqual(4)
  })

  it('a span is clipped to the stored depth (the IDB cap trims the oldest rows)', () => {
    const s = sealedState()
    const rows = toCacheRows(s).slice(2)
    const h = hydrate({ bars: rows, meta: encodeMeta(s) })
    expect(sealedOf(h).map((b) => b[0])).toEqual([T(10), T(15)])
  })

  it('another key, a stale envelope version, or a missing identity → rows only, no seals', () => {
    const s = sealedState()
    const rows = toCacheRows(s)
    expect(sealedOf(hydrate({ bars: rows, meta: { ...encodeMeta(s), key: 'OTHER_5' } }))).toEqual([])
    expect(sealedOf(hydrate({ bars: rows, meta: { ...encodeMeta(s), v: 0 } }))).toEqual([])
    expect(sealedOf(hydrate({ bars: rows, meta: { ...encodeMeta(s), historyRev: null } }))).toEqual([])
  })

  it('a copy of another row series (cache_key) or of OLDER history is discarded whole', () => {
    const s = sealedState()
    const held = reduce(initialState(key, { nowMs }), { type: 'mem-hit', payload: decodeEntry(key, { bars: toCacheRows(s), meta: encodeMeta(s) }) }, { nowMs })
    const otherCk = { bars: toCacheRows(s).map((r) => ({ ...r, c: r.c + 3, h: r.h + 3 })), meta: { ...encodeMeta(s), cacheKey: 'b1:SIM:5:other' } }
    expect(hydrate(otherCk, held)).toBe(held)
    const older = { bars: toCacheRows(s), meta: { ...encodeMeta(s), historyRev: 2 } }
    expect(hydrate(older, held)).toBe(held)
  })

  it('seals are restored only before a server answer (after one, a local copy only adds deeper rows)', () => {
    const s = sealedState()
    const live = reduce(initialState(key, { nowMs }), { type: 'rest-full', payload: { bars: [bar(T(20), 120), bar(T(25), 125)], contract: 1, grid: 'eth-clock', cache_key: 'b1:SIM:5:eth-clock', series_rev: 10, history_rev: 3, complete_through: null } }, { nowMs })
    const h = hydrate({ bars: toCacheRows(s), meta: encodeMeta(s) }, live)
    expect(sealedOf(h)).toEqual([])
    expect(h.bars.length).toBe(live.bars.length + 4)
    expect(h.bars.filter((b) => b.t < T(20)).every((b) => b.src === 'local')).toBe(true)
  })

  it('a hit read before an invalidate is dropped (gen)', () => {
    const s = sealedState()
    const base = initialState(key, { nowMs })
    const inv = reduce(base, { type: 'invalidate', reason: 'test' }, { nowMs })
    const h = reduce(inv, { type: 'idb-hit', gen: base.gen, payload: decodeEntry(key, { bars: toCacheRows(s), meta: encodeMeta(s) }) }, { nowMs })
    expect(h).toBe(inv)
  })

  it('rowHash fingerprints values, not time', () => {
    expect(rowHash({ o: 1, h: 2, l: 0.5, c: 1.5, v: 3 })).toBe(rowHash({ o: 1, h: 2, l: 0.5, c: 1.5, v: 3, t: 99 }))
    expect(rowHash({ o: 1, h: 2, l: 0.5, c: 1.5, v: 3 })).not.toBe(rowHash({ o: 1, h: 2, l: 0.5, c: 1.5, v: 4 }))
  })
})

describe('persist.js — the real write path (barsMemCache + barsIDB on a fake IndexedDB)', () => {
  const flushMicro = async (n = 30) => { for (let i = 0; i < n; i++) await Promise.resolve() }

  function makeWorld(sim) {
    const nowMs = sim.nowSec * 1000
    const registry = createRegistry({ ctx: () => ({ nowMs, streamLive: true }) })
    const timers = []
    const persist = createPersist({
      registry, idle: (fn) => fn(), now: () => nowMs,
      setTimer: (fn, ms) => { const h = { fn, ms }; timers.push(h); return h },
      clearTimer: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1) },
    })
    return { registry, persist, timers, nowMs, fire: () => { for (const h of timers.splice(0)) h.fn() } }
  }

  it(`round trip through memPutMonotonic + idbPutMonotonic keeps seals (60 seeds; mem and IDB)`, async () => {
    let checked = 0
    for (let i = 0; i < 60; i++) {
      memClear(); fakeDb._clear()
      const sim = simulateIntraday(rng(81000 + i), { rich: i % 2 === 0 })
      vi.setSystemTime(sim.nowSec * 1000)
      const w = makeWorld(sim)
      w.persist.attach(sim.key)
      for (const e of sim.events) w.registry.dispatch(sim.key, e.action, e.ctx)
      w.registry.dispatch(sim.key, sim.settle)
      const s = w.registry.getSnapshot(sim.key)
      await w.persist.flush()
      await flushMicro()
      if (!s.restSeen || !s.bars.length) continue
      // mem: the record carries the envelope; a fresh registry hydrates the same base
      const memRec = memPeekEntry('SIM', sim.key.split('_')[1])
      expect(memRec?.meta?.key).toBe(sim.key)
      const w2 = makeWorld(sim)
      await w2.persist.hydrate(sim.key)
      checkRoundTrip(s, w2.registry.getSnapshot(sim.key))
      // IDB alone (a reload: the mem cache is empty)
      memClear()
      const w3 = makeWorld(sim)
      await w3.persist.hydrate(sim.key)
      const stored = await idbGet('SIM', sim.key.split('_')[1])
      if (stored) { checkRoundTrip(s, w3.registry.getSnapshot(sim.key)); checked++ }
    }
    expect(checked).toBeGreaterThan(10)
  })

  it('another writer (blind idbPut / legacy monotonic write) drops the envelope — no stale seals', async () => {
    const sim = simulateIntraday(rng(91001), { tf: '5', session: 'rth' })
    vi.setSystemTime(sim.nowSec * 1000)
    const w = makeWorld(sim)
    w.persist.attach(sim.key)
    for (const e of sim.events) w.registry.dispatch(sim.key, e.action, e.ctx)
    w.registry.dispatch(sim.key, sim.settle)
    await w.persist.flush(); await flushMicro()
    expect((await idbGet('SIM', '5'))?.meta).toBeTruthy()
    const rows = toCacheRows(w.registry.getSnapshot(sim.key))
    await idbPut('SIM', '5', rows)
    expect((await idbGet('SIM', '5'))?.meta).toBeUndefined()
    memPutMonotonic('SIM', '5', rows.map((r) => ({ ...r })))   // a legacy writer, same values
    expect(memPeekEntry('SIM', '5')?.meta ?? null).toBe(null)
  })

  it('writes only on a baseRev change, debounced, and never for a local-only copy', async () => {
    const sim = simulateIntraday(rng(91002), { tf: '1', session: 'eth' })
    vi.setSystemTime(sim.nowSec * 1000)
    const w = makeWorld(sim)
    w.persist.attach(sim.key)
    // a local copy (mem / IDB hit) is never written back
    w.registry.dispatch(sim.key, { type: 'idb-hit', payload: { bars: [{ t: sim.win[0].t, o: 1, h: 1, l: 1, c: 1, v: 1 }] } })
    expect(w.timers.length).toBe(0)
    // many server-backed baseRev changes inside the window → ONE pending write
    let n = 0
    for (const e of sim.events) {
      const before = w.registry.getSnapshot(sim.key).baseRev
      w.registry.dispatch(sim.key, e.action, e.ctx)
      if (w.registry.getSnapshot(sim.key).baseRev !== before && w.registry.getSnapshot(sim.key).restSeen) n++
    }
    expect(w.timers.length).toBeLessThanOrEqual(1)
    if (n) expect(w.timers[0].ms).toBe(PERSIST_DEBOUNCE_MS)
    const puts0 = fakeDb._puts()
    w.fire(); await flushMicro()
    const puts1 = fakeDb._puts()
    expect(puts1 - puts0).toBeLessThanOrEqual(1)
    // a developing-only change (devRev) schedules nothing
    const s = w.registry.getSnapshot(sim.key)
    if (s.developing) {
      w.registry.dispatch(sim.key, { type: 'push-bar', event: { sym: 'SIM', tf: sim.tf, t_s: s.developing.t, bar: { t: s.developing.t * 1000, o: s.developing.o, h: s.developing.h, l: s.developing.l, c: s.developing.c, v: s.developing.v + 1 }, rev: 9e15 } })
      expect(w.registry.getSnapshot(sim.key).baseRev).toBe(s.baseRev)
      expect(w.timers.length).toBe(0)
    }
  })
})
