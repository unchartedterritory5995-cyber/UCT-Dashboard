// BarStore reducer — targeted contract tests (the general invariants live in
// barStore.property.test.js). Synthetic prices only.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { reduce, initialState, normT, bucketEnd, isSealedRow } from './reducer'
import { keyOf, dateLabelToUnix } from './types'
import { etUnix } from './__fixtures__/seededSeries'

const DAY = '2026-11-10'
const T = (min) => etUnix(DAY, min)            // ET minute of day → unix s
const bar = (t, o = 100, h = 101, l = 99, c = 100.5, v = 10) => ({ t, o, h, l, c, v })
const NOW = T(10 * 60 + 12) * 1000              // 10:12 ET
const ctx = { nowMs: NOW, streamLive: true }
const K5 = keyOf({ sym: 'SIM', tf: '5' })

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

const contract = (bars, extra = {}) => ({
  bars, contract: 1, grid: 'eth-clock', session: 'rth', cache_key: 'b1:SIM:5:eth-clock',
  series_rev: 1000, history_rev: 5, verified_through: T(611) - 5, tail_status: 'verified', ...extra,
})

describe('BarStore reducer', () => {
  it('rest-full (contract): bars exclude the developing duplicate; seal = complete_through', () => {
    const rows = [bar(T(595)), bar(T(600)), bar(T(605)), bar(T(610))]
    const s = reduce(initialState(K5, ctx), { type: 'rest-full', payload: contract(rows, {
      complete_through: T(605), developing: { ...bar(T(610)), rev: 1000 },
    }) }, ctx)
    expect(s.bars.map((b) => b.t)).toEqual([T(595), T(600), T(605)])
    expect(s.developing.t).toBe(T(610))
    expect(s.completeThrough).toBe(T(605))
    expect(isSealedRow(s, s.bars[1])).toBe(true)
    expect(isSealedRow(s, s.bars[2])).toBe(false)     // closed, not sealed (P1 I3)
    expect(s.deltaFrom).toBe(T(605))                   // the first unsealed row
    expect(s.status).toBe('current')
    expect(s.restSeen).toBe(true)
    expect(s.needsFull).toBe(false)
  })

  it('legacy answer (no contract): forming bar by clock, seal by a LATER bucket (I8), unverified ⇒ context', () => {
    const rows = [bar(T(595)), bar(T(600)), bar(T(605)), bar(T(610))]
    const s = reduce(initialState(K5, ctx), { type: 'rest-full', payload: { bars: rows } }, ctx)
    expect(s.developing.t).toBe(T(610))
    expect(s.completeThrough).toBe(bucketEnd(T(605), s))
    expect(s.verifiedThrough).toBeNull()
    expect(s.status).toBe('context')
  })

  it('rest-delta whose history_rev rose invalidates and demands a full read', () => {
    const s1 = reduce(initialState(K5, ctx), { type: 'rest-full', payload: contract([bar(T(600)), bar(T(605))], { complete_through: T(605) }) }, ctx)
    const s2 = reduce(s1, { type: 'rest-delta', payload: contract([bar(T(605))], { since: T(605), history_rev: 6, series_rev: 2000 }) }, ctx)
    expect(s2.bars).toHaveLength(0)
    expect(s2.needsFull).toBe(true)
    expect(s2.invalidatedFor).toBe('history_rev')
    expect(s2.completeThrough).toBeNull()
    expect(s2.baseRev).toBeGreaterThan(s1.baseRev)
  })

  it('rest-full with a new history_rev or cache_key replaces the series wholesale', () => {
    const s1 = reduce(initialState(K5, ctx), { type: 'rest-full', payload: contract([bar(T(595)), bar(T(600)), bar(T(605))], { complete_through: T(605) }) }, ctx)
    const s2 = reduce(s1, { type: 'rest-full', payload: contract([bar(T(600), 90, 91, 89, 90)], { history_rev: 6, complete_through: T(605) }) }, ctx)
    expect(s2.bars.map((b) => [b.t, b.o])).toEqual([[T(600), 90]])
    expect(s2.invalidatedFor).toBe('history_rev')
  })

  it('contract answer with complete_through null (pre-first-repair, D/W/M) falls back to I8', () => {
    const rows = [bar(T(595)), bar(T(600)), bar(T(605)), bar(T(610))]
    const s = reduce(initialState(K5, ctx), { type: 'rest-full', payload: contract(rows, {
      complete_through: null, developing: { ...bar(T(610)), rev: 1000 },
    }) }, ctx)
    expect(s.completeThrough).toBe(bucketEnd(T(605), s))
    expect(s.developing.t).toBe(T(610))
  })

  it('a seal is claimed only over rows the answer carries (an empty answer claims nothing)', () => {
    const s = reduce(initialState(K5, ctx), { type: 'rest-full', payload: contract([], { complete_through: T(605) }) }, ctx)
    expect(s.completeThrough).toBeNull()
    expect(s.sealedSpans).toHaveLength(0)
  })

  it('sealed rows are immutable: a later push frame / straggler never rewrites them', () => {
    const s1 = reduce(initialState(K5, ctx), { type: 'rest-full', payload: contract([bar(T(600)), bar(T(605))], { complete_through: T(605) }) }, ctx)
    const ghost = { type: 'push-bar', event: { bar: { ...bar(T(600), 100, 140, 99, 100.5, 10), t: T(600) * 1000 }, rev: 9e15 } }
    expect(reduce(s1, ghost, ctx)).toBe(s1)
    const fin = { type: 'push-final', event: { bar: { ...bar(T(600), 100, 140, 99, 100.5, 10), t: T(600) * 1000 }, rev: 9e15 } }
    expect(reduce(s1, fin, ctx)).toBe(s1)
  })

  it('push frames: same bucket merges (H↑ L↓ open-once), a later bucket closes the developing bar, old rev ignored', () => {
    let s = initialState(K5, ctx)
    const f = (t, o, h, l, c, v, rev, final = false) => ({ type: final ? 'push-final' : 'push-bar', event: { sym: 'SIM', tf: '5', bar: { t: t * 1000, o, h, l, c, v, final }, rev } })
    s = reduce(s, f(T(610), 100, 101, 99.5, 100.2, 5, 10), ctx)
    s = reduce(s, f(T(610), 100, 102, 99.8, 101, 9, 20), ctx)
    expect([s.developing.o, s.developing.h, s.developing.l, s.developing.c, s.developing.v]).toEqual([100, 102, 99.5, 101, 9])
    expect(reduce(s, f(T(610), 100, 103, 99, 99, 12, 15), ctx)).toBe(s)    // rev ≤ held
    s = reduce(s, f(T(615), 101, 101, 101, 101, 1, 30), ctx)
    expect(s.bars.map((b) => b.t)).toEqual([T(610)])
    expect(s.developing.t).toBe(T(615))
    // A FINAL for the earlier bucket corrects the closed row in place (by rev).
    s = reduce(s, f(T(610), 100, 102.5, 99.5, 100.9, 11, 25, true), ctx)
    expect([s.bars[0].h, s.bars[0].c, s.bars[0].v, s.bars[0].fin]).toEqual([102.5, 100.9, 11, true])
    expect(s.developing.t).toBe(T(615))
  })

  it('push frame whose trade lies outside its bucket is dropped (I4 by trade time)', () => {
    const s0 = initialState(K5, ctx)
    const ev = { type: 'push-bar', event: { bar: { ...bar(T(610)), t: T(610) * 1000, trade_ts: T(616) * 1000 }, rev: 1 } }
    expect(reduce(s0, ev, ctx)).toBe(s0)
  })

  it('tick-fallback: only while the stream is down; opens provisional, a frame replaces it', () => {
    const s1 = reduce(initialState(K5, ctx), { type: 'rest-full', payload: contract([bar(T(600)), bar(T(605))], { complete_through: T(605) }) }, ctx)
    const tick = { type: 'tick-fallback', event: { price: 100.4, ts: NOW } }
    expect(reduce(s1, tick, ctx)).toBe(s1)
    const down = { nowMs: NOW, streamLive: false }
    const s2 = reduce(s1, tick, down)
    expect(s2.developing).toMatchObject({ t: T(610), o: 100.4, src: 'tick', provisional: true })
    expect(s2.bars).toBe(s1.bars)
    const s3 = reduce(s2, { type: 'push-bar', event: { bar: { ...bar(T(610), 100.1, 100.6, 100, 100.3), t: T(610) * 1000 }, rev: 5 } }, ctx)
    expect([s3.developing.o, s3.developing.provisional, s3.developing.src]).toEqual([100.1, undefined, 'push'])
    // 100x phantom refused (this symbol's own baselines)
    expect(reduce(s2, { type: 'tick-fallback', event: { price: 10040, ts: NOW } }, down)).toBe(s2)
  })

  it('local hits: before a server answer they seed; after one they only add deeper history', () => {
    const local = { bars: [bar(T(590)), bar(T(595)), bar(T(600))] }
    const s1 = reduce(initialState(K5, ctx), { type: 'idb-hit', payload: local }, ctx)
    expect(s1.source).toBe('idb')
    expect(s1.restSeen).toBe(false)
    expect(['provisional', 'context']).toContain(s1.status)
    const s2 = reduce(s1, { type: 'rest-full', payload: contract([bar(T(600), 100, 101, 99, 100.7), bar(T(605))], { complete_through: T(605) }) }, ctx)
    expect(s2.bars.find((b) => b.t === T(600)).c).toBe(100.7)       // the server row replaced the local one
    const s3 = reduce(s2, { type: 'mem-hit', payload: { bars: [bar(T(580)), bar(T(600), 1, 2, 0.5, 1)] } }, ctx)
    expect(s3.bars.map((b) => b.t)).toEqual([T(580), T(590), T(595), T(600), T(605)])
    expect(s3.bars.find((b) => b.t === T(600)).c).toBe(100.7)       // never over a server row
    // a copy of another row series is discarded whole (S8)
    expect(reduce(s2, { type: 'mem-hit', payload: { cache_key: 'b1:SIM:5:other', bars: [bar(T(570))] } }, ctx)).toBe(s2)
  })

  it('scroll-back prepends older history only', () => {
    const s1 = reduce(initialState(K5, ctx), { type: 'rest-full', payload: contract([bar(T(600)), bar(T(605))], { complete_through: T(605) }) }, ctx)
    const s2 = reduce(s1, { type: 'scroll-back', payload: { bars: [bar(T(590)), bar(T(595)), bar(T(600), 1, 2, 0.5, 1)] } }, ctx)
    expect(s2.bars.map((b) => b.t)).toEqual([T(590), T(595), T(600), T(605)])
    expect(s2.bars[2]).toBe(s1.bars[0])
  })

  it('off-grid strays are folded once at ingest (offGridBars)', () => {
    const s = reduce(initialState(K5, ctx), { type: 'rest-full', payload: { bars: [bar(T(600)), bar(T(600) + 37), bar(T(605))] } }, ctx)
    expect([...s.bars, s.developing].filter(Boolean).every((b) => b.t % 300 === 0)).toBe(true)
  })

  it('invalidate resets to empty with needsFull; subscribers keep the key', () => {
    const s1 = reduce(initialState(K5, ctx), { type: 'rest-full', payload: contract([bar(T(600))], { complete_through: T(605) }) }, ctx)
    const s2 = reduce(s1, { type: 'invalidate', reason: 'split' }, ctx)
    expect([s2.key, s2.bars.length, s2.status, s2.needsFull, s2.invalidatedFor]).toEqual([K5, 0, 'empty', true, 'split'])
  })

  it('rest-error no_data is terminal: unavailable', () => {
    const s = reduce(initialState(K5, ctx), { type: 'rest-error', payload: { error: 'no_data' } }, ctx)
    expect(s.status).toBe('unavailable')
  })

  it('60m keys bucket on their own grid (rth session grid vs eth clock grid)', () => {
    const k60 = keyOf({ sym: 'SIM', tf: '60' }), k60e = keyOf({ sym: 'SIM', tf: '60', session: 'eth' })
    const tick = { type: 'tick-fallback', event: { price: 100, ts: T(10 * 60 + 12) } }
    const down = { nowMs: NOW, streamLive: false }
    const a = reduce(reduce(initialState(k60, down), { type: 'rest-full', payload: { bars: [bar(T(570))] } }, down), tick, down)
    const b = reduce(reduce(initialState(k60e, down), { type: 'rest-full', payload: { bars: [bar(T(540))] } }, down), tick, down)
    expect(a.developing.t).toBe(T(570))   // 09:30 bucket (TradingView RTH)
    expect(b.developing.t).toBe(T(600))   // 10:00 clock hour
    expect(bucketEnd(T(15 * 60 + 30), a)).toBe(T(16 * 60))  // 15:30 half bar
  })

  it('D/W/M: date labels become 00:00 UTC unix; t from ms or unix is normalized', () => {
    expect(normT('2026-11-10', 'D')).toBe(dateLabelToUnix('2026-11-10'))
    expect(normT(dateLabelToUnix('2026-11-10') * 1000, 'D')).toBe(dateLabelToUnix('2026-11-10'))
    expect(normT(T(600), 'D')).toBe(dateLabelToUnix('2026-11-10'))
    const kd = keyOf({ sym: 'SIM', tf: 'D' })
    const s = reduce(initialState(kd, ctx), { type: 'rest-full', payload: { bars: [{ ...bar(0), t: '2026-11-09' }, { ...bar(0), t: '2026-11-10' }] } }, ctx)
    expect(s.bars[0].t).toBe(dateLabelToUnix('2026-11-09'))
    expect(s.developing.t).toBe(dateLabelToUnix('2026-11-10'))
  })

  it('depth cap trims the oldest bars', () => {
    const rows = Array.from({ length: 10 }, (_, i) => bar(T(560 + 5 * i)))
    const s = reduce(initialState(K5, ctx), { type: 'rest-full', payload: contract(rows, { complete_through: T(600) }) }, { ...ctx, depthCap: 4 })
    expect(s.bars).toHaveLength(4)
    expect(s.bars[0].t).toBe(rows[rows.length - 4].t)
  })
})
