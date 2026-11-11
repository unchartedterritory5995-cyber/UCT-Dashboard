// INVARIANT (W-L 2026-11-11, review of #1095): a background write never moves a cache
// backwards. For ANY stored series and ANY incoming series (full or delta):
//   tail(result) = max(tail(stored), tail(incoming))
//   every timestamp of both is in the result, strictly ascending, no duplicates
//   on a shared timestamp the source with the NEWER tail supplies the bar
//   a delta with nothing stored writes nothing.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mergeMonotonic } from './barsMerge'

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) }
function series(r, tag) {
  const start = 1_000_000 + Math.floor(r() * 200) * 300
  const n = 1 + Math.floor(r() * 120)
  const out = []
  for (let i = 0, t = start; i < n; i++, t += 300) if (r() > 0.15) out.push({ t, c: tag })
  return out.length ? out : [{ t: start, c: tag }]
}

describe('mergeMonotonic (fuzz, 600 pairs)', () => {
  it('never an older tail, never a lost bar, newer tail wins overlaps', () => {
    const r = rng(1095)
    for (let i = 0; i < 600; i++) {
      const cur = series(r, 'cur'), inc = series(r, 'inc')
      const delta = r() < 0.5
      const out = mergeMonotonic(cur, inc, { delta })
      const ct = cur.at(-1).t, it = inc.at(-1).t
      expect(out.at(-1).t).toBe(Math.max(ct, it))
      const ts = out.map(b => b.t)
      for (let k = 1; k < ts.length; k++) expect(ts[k]).toBeGreaterThan(ts[k - 1])
      const have = new Set(ts)
      for (const b of [...cur, ...inc]) expect(have.has(b.t)).toBe(true)
      const winner = it >= ct ? 'inc' : 'cur'
      const shared = new Set(cur.map(b => b.t).filter(t => inc.some(b => b.t === t)))
      for (const b of out) if (shared.has(b.t)) expect(b.c).toBe(winner)
    }
  })
  it('equal tails: the incoming answer wins unless the stored set was written after it was requested', () => {
    const cur = [{ t: 1, c: 'cur' }, { t: 2, c: 'cur' }]
    const inc = [{ t: 2, c: 'inc' }]
    expect(mergeMonotonic(cur, inc).at(-1).c).toBe('inc')
    expect(mergeMonotonic(cur, inc, { curIsNewer: true }).at(-1).c).toBe('cur')
  })
  it('a delta with nothing stored is not a chart; a full set with nothing stored is stored as is', () => {
    expect(mergeMonotonic(null, [{ t: 1 }], { delta: true })).toBeNull()
    const full = [{ t: 1 }, { t: 2 }]
    expect(mergeMonotonic(null, full)).toBe(full)
    expect(mergeMonotonic(full, [])).toBe(full)
  })
})

// ── the IndexedDB compare-and-write (one readwrite transaction) ──────────────
function installFakeIDB() {
  const rows = new Map()
  const later = (fn) => setTimeout(fn, 0)
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => {
      const tx = {}
      let pending = 0
      const settle = () => { if (--pending === 0) later(() => tx.oncomplete?.()) }
      tx.objectStore = () => ({
        get(key) { pending++; const r = {}; later(() => { r.result = rows.get(key); r.onsuccess?.(); settle() }); return r },
        put(v) { pending++; later(() => { rows.set(v.key, structuredClone(v)); settle() }); return {} },
      })
      return tx
    },
  }
  vi.stubGlobal('indexedDB', { open: () => { const r = {}; later(() => { r.result = db; r.onsuccess?.({ target: r }) }); return r } })
  return rows
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('idbPutMonotonic', () => {
  const bars = (from, to, c) => { const o = []; for (let t = from; t <= to; t += 300) o.push({ t, o: 1, h: 1, l: 1, c, v: 1 }); return o }
  it('a warmer write with an OLDER tail cannot roll back what the chart stored meanwhile', async () => {
    const rows = installFakeIDB()
    const { idbPutMonotonic, _CACHE_LOGIC_VERSION } = await import('./barsIDB')
    const chart = bars(3000, 9000, 2)
    rows.set('ZZ_5', { key: 'ZZ_5', bars: chart, lastT: 9000, savedAt: 1, v: _CACHE_LOGIC_VERSION })
    const out = await idbPutMonotonic('ZZ', '5', bars(1500, 6000, 1))
    expect(rows.get('ZZ_5').lastT).toBe(9000)
    expect(out.at(-1).t).toBe(9000)
    expect(rows.get('ZZ_5').bars.find(b => b.t === 6000).c).toBe(2)   // the newer source won the overlap
    expect(rows.get('ZZ_5').bars[0].t).toBe(1500)                       // and nothing got shallower
  })
  it('a delta merges into the CURRENT entry, not the stale base the warmer read', async () => {
    const rows = installFakeIDB()
    const { idbPutMonotonic, _CACHE_LOGIC_VERSION } = await import('./barsIDB')
    rows.set('YY_5', { key: 'YY_5', bars: bars(0, 9000, 2), lastT: 9000, savedAt: 1, v: _CACHE_LOGIC_VERSION })
    await idbPutMonotonic('YY', '5', bars(9300, 9600, 3), { delta: true })
    const got = rows.get('YY_5').bars
    expect(got[0].t).toBe(0)
    expect(got.at(-1).t).toBe(9600)
  })
  it('a delta with nothing stored writes nothing', async () => {
    const rows = installFakeIDB()
    const { idbPutMonotonic } = await import('./barsIDB')
    expect(await idbPutMonotonic('XX', '5', bars(0, 600, 1), { delta: true })).toBeNull()
    expect(rows.has('XX_5')).toBe(false)
  })
})

describe('memPutMonotonic', () => {
  it('never replaces a newer held series with an older one; keeps the held stamp when it supplies the tail', async () => {
    const { memPut, memPeek, memPeekSavedAt, memPutMonotonic, memClear } = await import('./barsMemCache')
    memClear()
    memPut('MM', '5', [{ t: 1 }, { t: 2 }, { t: 3 }], { savedAt: 111 })
    memPutMonotonic('MM', '5', [{ t: 0 }, { t: 1 }, { t: 2 }], { savedAt: 99 })
    expect(memPeek('MM', '5').map(b => b.t)).toEqual([0, 1, 2, 3])
    expect(memPeekSavedAt('MM', '5')).toBe(111)
  })
})
