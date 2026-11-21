// ⛔ (2026-11-20) The neighbour-frames caches (chart times, derived values) are bounded by RECENCY, and the
// recency list must hold its sources WEAKLY: it held them strongly, so the last SOURCES_KEPT source arrays (a
// row's whole bars, up to 56,000 of them) stayed alive after the bar store had let them go (old revisions,
// symbols long switched away from). A real collection decides here: the list must not be what keeps a source.
import v8 from 'node:v8'
import vm from 'node:vm'
import { describe, it, expect, beforeEach } from 'vitest'
import { chartTimesFor, deriveFrom, hasDerived, SOURCES_KEPT, __resetDerivedForTests } from './neighborFrames'

const gcNow = (() => { try { v8.setFlagsFromString('--expose-gc'); return vm.runInNewContext('gc') } catch { return null } })()
const settle = () => new Promise((res) => setTimeout(res, 0))
const rows = (k, n = 500) => Array.from({ length: n }, (_, i) => ({ t: 1_700_000_000 + i * 60, o: k, h: k + 1, l: k - 1, c: k, v: i }))
const adjust = (t) => t

beforeEach(() => __resetDerivedForTests())

describe('the neighbour-frames recency list holds its sources weakly', () => {
  it('sources nothing else holds are collected, chart times and derived values with them', async () => {
    expect(typeof gcNow).toBe('function')
    const refs = []
    for (let k = 0; k < 5; k++) {   // fewer than SOURCES_KEPT: the bound alone would keep them all
      const src = rows(k)
      chartTimesFor(src, adjust)
      deriveFrom(src, 'closes', 'v1', () => src.map((b) => b.c))
      refs.push(new globalThis.WeakRef(src))
    }
    expect(refs.length).toBeLessThan(SOURCES_KEPT)
    await settle()
    gcNow(); await settle(); gcNow()
    expect(refs.map((r) => (r.deref() ? 'alive' : 'collected'))).toEqual(refs.map(() => 'collected'))
  })

  it('a source still held elsewhere keeps its values; the recency bound still evicts the oldest', () => {
    const kept = Array.from({ length: SOURCES_KEPT + 2 }, (_, k) => rows(k, 50))
    for (const src of kept) deriveFrom(src, 'closes', 'v1', () => src.map((b) => b.c))
    // the newest SOURCES_KEPT keep their derived values, the two oldest lost theirs
    expect(kept.map((src) => hasDerived(src, 'closes', 'v1'))).toEqual(kept.map((_, i) => i >= 2))
    const times = chartTimesFor(kept[kept.length - 1], adjust)
    expect(chartTimesFor(kept[kept.length - 1], adjust)).toBe(times)
  })
})
