/**
 * SMOOTHNESS PART 2, ITEM (1): A ROW'S BUCKET END, COMPUTED ONLY WHEN IT DECIDES (2026-11-26).
 *
 * Trace (local dist 4bc325e4ae, 5m+60m board, 5 traced switches): the bar store's `_applyLocal` was 18 ms a flip of the
 * main-thread tasks over 16 ms in the second after both charts showed the new symbol; 6.6 of it was `_inSpans` computing
 * `bucketEnd` for every row a copy brought (on the 60m session grid an ET minute-of-day and a session close each), and
 * 3.3 was `basisVerdict` searching the held rows once per copied row. A bucket at a finite `t` ends by `t + room` (one
 * whole bucket: `_bucketRoom`), so a row that far inside a span is inside it whatever its grid, and a row before a span
 * is outside it whatever its end; a row outside the held rows' first..last `t` pairs with none of them.
 *   R1 `inSealedSpan` / `isSealedRow` answer what they did (the reference below is `_inSpans` as it was, ed7605b405)
 *      for every timeframe and 60m grid, spans ending on, inside and off bucket ends, a half-day (13:00 close), both DST
 *      changes, fractional and non-finite times
 *   R2 a row a whole bucket inside a sealed span, or before every span, computes no bucket end (red before the change)
 *   R3 a server answer sealing N 60m rows computes a handful of bucket ends, not 2N (red before the change)
 *   R4 basisVerdict over one of the store's own held arrays: a copy entirely older than it reads two held rows, not a
 *      search per row and a scan (red before the change), with the same verdict as the Map
 *   R5 (review of #2782) any OTHER array, even frozen, is read again every time: a frozen array whose rows' `t` changed
 *      between two calls gets the Map's answer both times (red when every frozen array's order was kept)
 *   R6 the store marks its own bars arrays (finalize) and nothing else
 */
import { describe, it, expect, vi } from 'vitest'

// count the bucket-end computations the reducer asks for (the real function underneath)
vi.mock('../../components/chart/liveBuckets', async (importOriginal) => {
  const m = await importOriginal()
  return { ...m, bucketEndUnix: vi.fn(m.bucketEndUnix) }
})

import { bucketEndUnix } from '../../components/chart/liveBuckets'
import { inSealedSpan, isSealedRow, bucketEnd, reduce, initialState, basisVerdict, markStoreBars, isStoreBars } from './reducer'
import { keyOf } from './types'
import { etUnix } from './__fixtures__/seededSeries'

// the reference: _inSpans as it was (ed7605b405), over the module's own exported bucketEnd
function refInSpans(state, t) {
  const sp = state.sealedSpans
  if (!sp || !sp.length) return false
  const e = bucketEnd(t, state)
  for (const [a, c] of sp) if (t >= a && e <= c) return true
  return false
}
const answer = (fn) => { try { return fn() } catch (e) { return `throws ${e?.constructor?.name}` } }

const ET = (day, h, m = 0) => etUnix(day, h * 60 + m)
const DAYS = ['2026-11-24', '2026-11-27', '2026-03-06', '2026-03-09', '2026-10-30', '2026-11-02']   // a regular day, a half-day, both sides of both DST changes
const FRAMES = [
  { tf: '1', grid: 'eth-clock' }, { tf: '5', grid: 'eth-clock' }, { tf: '15', grid: 'rth-tv' }, { tf: '30', grid: 'rth-tv' },
  { tf: '60', grid: 'rth-tv' }, { tf: '60', grid: 'eth-clock' }, { tf: '60' }, { tf: 'D' }, { tf: 'W' }, { tf: 'M' },
]

function spansFor(day) {
  return [
    [[ET(day, 4), ET(day, 20)]],                               // the whole extended day
    [[ET(day, 9, 30), ET(day, 16)]],                           // the regular session
    [[ET(day, 9, 30), ET(day, 13)]],                           // to a half-day's close
    [[ET(day, 9, 30), ET(day, 12, 45)]],                       // ending mid-bucket
    [[ET(day, 4), ET(day, 10, 30)], [ET(day, 11), ET(day, 15, 59)]],   // two spans, a hole between
    [[ET(day, 9, 30) + 17, ET(day, 14, 30) + 0.5]],             // off every grid
  ]
}

describe('a row\'s bucket end, computed only when it decides', () => {
  it('R1 inSealedSpan and isSealedRow answer as before (every frame, span shape, day; odd times)', () => {
    let n = 0
    for (const fr of FRAMES) {
      const key = keyOf({ sym: 'SIM', tf: fr.tf, session: fr.grid === 'eth-clock' ? 'eth' : 'rth' })
      const date = fr.tf === 'D' || fr.tf === 'W' || fr.tf === 'M'
      for (const day of DAYS) {
        const shapes = date ? [[[ET(day, 0) - 40 * 86400, ET(day, 0) + 3 * 86400 + 7]], [[ET(day, 0), ET(day, 0) + 86400]]] : spansFor(day)
        for (const sealedSpans of shapes) {
          bucketEndUnix.mockClear()                      // (the spy keeps every call: keep its record small)
          const state = { key, tf: fr.tf, ...(fr.grid ? { grid: fr.grid } : {}), sealedSpans }
          const lo = sealedSpans[0][0] - (date ? 35 * 86400 : 3 * 3600), hi = sealedSpans[sealedSpans.length - 1][1] + (date ? 35 * 86400 : 3 * 3600)
          const step = date ? 3 * 3600 + 17 : 60
          const ts = []
          for (let t = lo; t <= hi; t += step) ts.push(t)
          ts.push(lo + 0.25, hi - 0.5, NaN, Infinity, -Infinity, 9e12, -9e12)
          for (const t of ts) {
            const got = answer(() => inSealedSpan(state, t))
            const want = answer(() => refInSpans(state, t))
            if (got !== want) expect([fr, day, sealedSpans, t, got]).toEqual([fr, day, sealedSpans, t, want])
            const row = { t, src: 'rest' }
            const gotRow = answer(() => isSealedRow(state, row))
            const wantRow = answer(() => row.src === 'rest' && refInSpans(state, row.t))
            if (gotRow !== wantRow) expect([fr, day, sealedSpans, t, 'row', gotRow]).toEqual([fr, day, sealedSpans, t, 'row', wantRow])
            n += 1
          }
        }
      }
    }
    expect(n).toBeGreaterThan(50_000)
  })

  it('R2 a row a whole bucket inside a sealed span, or before every span, computes no bucket end', () => {
    const day = '2026-11-24'
    const state = { key: keyOf({ sym: 'SIM', tf: '60' }), tf: '60', grid: 'rth-tv', sealedSpans: [[ET(day, 9, 30), ET(day, 16)], [ET(day, 17), ET(day, 20)]] }
    const inside = [ET(day, 9, 30), ET(day, 10, 30), ET(day, 11, 30), ET(day, 12, 30), ET(day, 13, 30), ET(day, 14, 30)]
    const before = [ET(day, 4), ET(day, 5), ET(day, 8), ET(day, 9), ET('2026-11-23', 15, 30)]
    bucketEndUnix.mockClear()
    for (const t of inside) expect(inSealedSpan(state, t)).toBe(true)
    for (const t of before) expect(inSealedSpan(state, t)).toBe(false)
    expect(bucketEndUnix.mock.calls.length).toBe(0)
    // the decisive rows still compute it: the last regular bucket (15:30, ends AT the span's end) and one past it
    expect(inSealedSpan(state, ET(day, 15, 30))).toBe(true)
    expect(inSealedSpan(state, ET(day, 16))).toBe(false)
    expect(bucketEndUnix.mock.calls.length).toBeGreaterThan(0)
  })

  it('R3 a server answer sealing N 60m rows computes a handful of bucket ends, not 2N', () => {
    const K = keyOf({ sym: 'SIM', tf: '60' })
    const rows = []
    for (let d = Date.UTC(2026, 9, 26); d <= Date.UTC(2026, 10, 24); d += 86400000) {   // 2026-10-26 .. 11-24, a DST change inside
      const day = new Date(d).toISOString().slice(0, 10)
      if ([0, 6].includes(new Date(d).getUTCDay())) continue
      for (let h = 9; h <= 15; h += 1) rows.push({ t: ET(day, h, 30), o: 100, h: 101, l: 99, c: 100.5, v: 10 })
    }
    expect(rows.length).toBe(22 * 7)
    const last = rows[rows.length - 1].t
    const ctx = { nowMs: (last + 86400) * 1000, streamLive: false }
    bucketEndUnix.mockClear()
    const s = reduce(initialState(K, ctx), { type: 'rest-full', payload: {
      bars: rows, contract: 1, grid: 'rth-tv', session: 'rth', cache_key: 'b1:SIM:60:rth-tv',
      series_rev: 1000, history_rev: 5, complete_through: ET('2026-11-24', 16), tail_status: 'verified',
    } }, ctx)
    const asked = bucketEndUnix.mock.calls.length
    expect(s.bars).toHaveLength(rows.length)
    expect(s.bars.every((b) => isSealedRow(s, b))).toBe(true)
    expect(asked).toBeLessThan(rows.length / 4)          // was at least 2 per row (the seal, then the span's absences)
  })

  it('R4 basisVerdict over a store-held array: an older copy reads two held rows, same verdict as the Map', () => {
    const DAY = 86400
    const row = (t, c) => Object.freeze({ t, o: c * 0.99, h: c * 1.01, l: c * 0.98, c, v: 1000 })
    const held = Object.freeze(Array.from({ length: 4000 }, (_, i) => row(1_700_000_000 + i * DAY, 100 + (i % 13))))
    const older = Array.from({ length: 3000 }, (_, i) => row(1_400_000_000 + i * DAY, 50 + (i % 7)))
    const asMap = new Map(held.map((r) => [r.t, r]))
    expect(basisVerdict(older, held)).toBe(basisVerdict(older, asMap))   // 'unknown': no row in common
    expect(basisVerdict(held.slice(-300), held)).toBe('same')
    const reads = new Set()
    const trap = markStoreBars(new Proxy(held, { get(target, k, recv) { if (typeof k === 'string' && /^\d+$/.test(k)) reads.add(k); return Reflect.get(target, k, recv) } }))
    basisVerdict(older, trap)                            // its first sight of `trap`: the scan may read every row once
    reads.clear()
    expect(basisVerdict(older, trap)).toBe('unknown')    // again: a frozen array is not scanned again, nothing searched
    expect(reads.size).toBeLessThanOrEqual(2)
  })

  it("R5 any other array, even frozen, is read again: rows whose t changed get the Map's answer", () => {
    const DAY = 86400
    const rows = Array.from({ length: 1000 }, (_, i) => ({ t: 1_700_000_000 + i * DAY, o: 99, h: 101, l: 98, c: 100, v: 1000 }))
    const held = Object.freeze(rows)                      // frozen, but NOT the store's: its rows are plain objects
    const asMap = () => new Map(held.map((r) => [r.t, r]))
    const local = [{ ...rows[900] }]
    expect(basisVerdict(local, held)).toBe('same')        // sorted: read as sorted
    rows[100].t = 1_700_000_000 + 900 * DAY + 1           // a row's t moves: the array is no longer in order
    const moved = [{ ...rows[100] }]
    expect(basisVerdict(moved, asMap())).toBe('same')     // the Map finds it ...
    expect(basisVerdict(moved, held)).toBe('same')        // ... and so does the array, read again (a kept order: 'unknown')
    expect(isStoreBars(held)).toBe(false)
  })

  it('R6 the store marks its own bars arrays (finalize), and nothing else', () => {
    const K = keyOf({ sym: 'SIM', tf: '5' })
    const t0 = ET('2026-11-24', 10)
    const ctx = { nowMs: (t0 + 86400) * 1000, streamLive: false }
    const rows = Array.from({ length: 30 }, (_, i) => ({ t: t0 + i * 300, o: 100, h: 101, l: 99, c: 100.5, v: 10 }))
    const s = reduce(initialState(K, ctx), { type: 'rest-full', payload: {
      bars: rows, contract: 1, grid: 'eth-clock', session: 'rth', cache_key: 'b1:SIM:5:eth-clock',
      series_rev: 1000, history_rev: 5, complete_through: t0 + 30 * 300, tail_status: 'verified',
    } }, ctx)
    expect(s.bars).toHaveLength(30)
    expect(Object.isFrozen(s.bars)).toBe(true)
    expect(isStoreBars(s.bars)).toBe(true)
    expect(isStoreBars(rows)).toBe(false)
    expect(isStoreBars(Object.freeze([...s.bars]))).toBe(false)   // a frozen copy is not the store's
  })
})
