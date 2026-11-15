// INVARIANT (W-L 2026-11-11, reviews of #1095): THE ONE WRITE RULE. For ANY stored series and
// ANY server answer (full or delta), fuzzed:
//   every answer bar is in the result, unchanged (the server wins every overlap)
//   tail(result) = max(tail(stored), tail(answer))      — never moved backwards
//   FULL: no stored bar survives inside [answer[0].t, answer.tail] unless the answer has it;
//         stored bars before the answer survive only across a clean seam (no >2% mismatch)
//   DELTA: every stored bar survives unless the answer replaced it
//   timestamps strictly ascending; a delta with nothing stored writes nothing.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mergeMonotonic } from './barsMerge'

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) }
function series(r, tag, c) {
  const start = 1_000_000 + Math.floor(r() * 200) * 300
  const n = 1 + Math.floor(r() * 120)
  const out = []
  for (let i = 0, t = start; i < n; i++, t += 300) if (r() > 0.15) out.push({ t, c, tag })
  return out.length ? out : [{ t: start, c, tag }]
}

describe('mergeMonotonic (fuzz, 600 pairs)', () => {
  it('the answer always lands; the tail never moves back; a full answer owns its range; seams are clean', () => {
    const r = rng(1095)
    for (let i = 0; i < 600; i++) {
      const badBasis = r() < 0.3                         // stored set on another price basis
      const cur = series(r, 'cur', badBasis ? 50 : 100), inc = series(r, 'inc', 100)
      const delta = r() < 0.5
      const out = mergeMonotonic(cur, inc, { delta })
      const ts = out.map(b => b.t)
      for (let k = 1; k < ts.length; k++) expect(ts[k]).toBeGreaterThan(ts[k - 1])
      const byT = new Map(out.map(b => [b.t, b]))
      for (const b of inc) expect(byT.get(b.t)).toBe(b)                    // the answer always lands
      expect(out.at(-1).t).toBe(Math.max(cur.at(-1).t, inc.at(-1).t))      // never backwards
      const first = inc[0].t, last = inc.at(-1).t
      const incT = new Set(inc.map(b => b.t))
      for (const b of cur) {
        if (incT.has(b.t)) continue
        const kept = byT.get(b.t) === b
        if (delta) expect(kept).toBe(true)
        else if (b.t > last) expect(kept).toBe(true)
        else if (b.t >= first) expect(kept).toBe(false)                    // full answer owns its range
        else {
          const seamShared = cur.some(x => x.t === first)
          expect(kept).toBe(!(seamShared && badBasis))                     // clean seam only
        }
      }
    }
  })
  it('a set written AFTER the request began keeps its bars on an equal tail', () => {
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
  it('review case: an ETH tail (19:55) stored, an RTH answer correcting 15:00-16:00 — the correction lands, the 19:55 tail stays', () => {
    const cur = [{ t: 900, c: 1 }, { t: 960, c: 1 }, { t: 1195, c: 1 }]          // minutes as t
    const ans = [{ t: 900, c: 2 }, { t: 960, c: 2 }]
    const out = mergeMonotonic(cur, ans)
    expect(out.map(b => b.c)).toEqual([2, 2, 1])
    expect(out.at(-1).t).toBe(1195)
  })
  it('review case: off-grid / stale 30m rows inside the answer window are dropped', () => {
    const cur = [{ t: 0, c: 1 }, { t: 1800, c: 1 }, { t: 2700, c: 1 }, { t: 3600, c: 1 }]   // 2700 is off-grid
    const ans = [{ t: 1800, c: 1 }, { t: 3600, c: 1 }]
    expect(mergeMonotonic(cur, ans).map(b => b.t)).toEqual([0, 1800, 3600])
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
  // Daily bars, ISO-dated (D/W/M validity = DAILY_MAX_AGE_MS since savedAt).
  const days = (n, c, end = '2026-11-10') => {
    const out = []; const e = new Date(end + 'T00:00:00Z')
    for (let i = n - 1; i >= 0; i--) out.push({ t: new Date(e.getTime() - i * 86400000).toISOString().slice(0, 10), o: c, h: c, l: c, c, v: 1 })
    return out
  }
  const HOUR = 3600 * 1000
  it('a warmer write with an OLDER tail cannot roll back what the chart stored meanwhile (answer still wins its overlap)', async () => {
    const rows = installFakeIDB()
    const { idbPutMonotonic, _CACHE_LOGIC_VERSION } = await import('./barsIDB')
    const chart = days(40, 100, '2026-11-10')
    rows.set('ZZ_D', { key: 'ZZ_D', bars: chart, lastT: '2026-11-10', savedAt: Date.now() - HOUR, v: _CACHE_LOGIC_VERSION })
    const answer = days(10, 100.5, '2026-11-07')
    const out = await idbPutMonotonic('ZZ', 'D', answer)
    const got = rows.get('ZZ_D').bars
    expect(out.at(-1).t).toBe('2026-11-10')                              // tail not moved back
    expect(got.find(b => b.t === '2026-11-07').c).toBe(100.5)             // the answer's correction landed
    expect(got[0].t).toBe(chart[0].t)                                     // clean seam: deeper history kept
  })
  it('review HIGH: a CORRUPT pre-split daily entry (past DAILY_MAX_AGE_MS) is REPLACED by a correct full answer', async () => {
    const rows = installFakeIDB()
    const { idbPutMonotonic, _CACHE_LOGIC_VERSION } = await import('./barsIDB')
    // 300 pre-split bars at 4x the price, saved 3 days ago: idbGet reads this as ABSENT.
    rows.set('SPL_D', { key: 'SPL_D', bars: days(300, 400, '2026-11-07'), lastT: '2026-11-07', savedAt: Date.now() - 72 * HOUR, v: _CACHE_LOGIC_VERSION })
    const answer = days(120, 100, '2026-11-10')
    await idbPutMonotonic('SPL', 'D', answer)
    const got = rows.get('SPL_D').bars
    // Before: merged INTO the corrupt entry — 180 old 4x bars kept below the answer (a cliff
    // at the seam) and savedAt re-stamped, so the age eviction could never fire again.
    expect(got.length).toBe(120)
    expect(got.every(b => b.c === 100)).toBe(true)
  })
  it('review MED: a READABLE entry on another basis (fresh savedAt, >2% at the seam) — deeper history dropped, no cliff', async () => {
    const rows = installFakeIDB()
    const { idbPutMonotonic, _CACHE_LOGIC_VERSION } = await import('./barsIDB')
    rows.set('SEA_D', { key: 'SEA_D', bars: days(300, 400, '2026-11-09'), lastT: '2026-11-09', savedAt: Date.now() - HOUR, v: _CACHE_LOGIC_VERSION })
    await idbPutMonotonic('SEA', 'D', days(120, 100, '2026-11-10'))
    const got = rows.get('SEA_D').bars
    expect(got.length).toBe(120)
    expect(got.every(b => b.c === 100)).toBe(true)
  })
  it('a delta merges into the CURRENT entry, not the stale base the warmer read', async () => {
    const rows = installFakeIDB()
    const { idbPutMonotonic, _CACHE_LOGIC_VERSION } = await import('./barsIDB')
    rows.set('YY_D', { key: 'YY_D', bars: days(40, 100, '2026-11-08'), lastT: '2026-11-08', savedAt: Date.now() - HOUR, v: _CACHE_LOGIC_VERSION })
    await idbPutMonotonic('YY', 'D', days(2, 101, '2026-11-10'), { delta: true })
    const got = rows.get('YY_D').bars
    expect(got.length).toBe(42)
    expect(got.at(-1).t).toBe('2026-11-10')
  })
  it('a delta with nothing stored (or nothing READABLE stored) writes nothing', async () => {
    const rows = installFakeIDB()
    const { idbPutMonotonic, _CACHE_LOGIC_VERSION } = await import('./barsIDB')
    expect(await idbPutMonotonic('XX', 'D', days(2, 1), { delta: true })).toBeNull()
    expect(rows.has('XX_D')).toBe(false)
    rows.set('OLD_D', { key: 'OLD_D', bars: days(5, 1), lastT: '2026-11-10', savedAt: Date.now() - 72 * HOUR, v: _CACHE_LOGIC_VERSION })
    expect(await idbPutMonotonic('OLD', 'D', days(1, 2, '2026-11-11'), { delta: true })).toBeNull()
  })
  it('idbGet and the writer share ONE validity rule (_entryReadable)', async () => {
    installFakeIDB()
    const { _entryReadable, _CACHE_LOGIC_VERSION } = await import('./barsIDB')
    const ok = { bars: days(3, 1), lastT: '2026-11-10', savedAt: Date.now(), v: _CACHE_LOGIC_VERSION }
    expect(_entryReadable(ok, 'D')).toBe(true)
    expect(_entryReadable({ ...ok, v: -1 }, 'D')).toBe(false)
    expect(_entryReadable({ ...ok, savedAt: Date.now() - 72 * HOUR }, 'D')).toBe(false)
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
