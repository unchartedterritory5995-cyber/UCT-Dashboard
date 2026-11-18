// W-D (2026-11-10) — prefetch rails for intraday load correctness. Real SWR `preload`
// (not mocked): the defects live in how its promise table interacts with the warmer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const idb = vi.hoisted(() => ({ entries: new Map(), puts: [] }))
vi.mock('./barsIDB', async (orig) => {
  const real = await orig()
  return {
    ...real,
    idbGet: vi.fn(async (sym, tf) => idb.entries.get(`${sym}_${tf}`) ?? null),
    idbPut: vi.fn(async (sym, tf, bars) => { idb.puts.push(`${sym}_${tf}`); idb.entries.set(`${sym}_${tf}`, { bars, lastT: bars[bars.length - 1].t, savedAt: Date.now() }) }),
    idbPutMonotonic: vi.fn(async (sym, tf, bars, opts) => {
      const key = `${sym}_${tf}`
      const next = real.mergeMonotonic(idb.entries.get(key)?.bars ?? null, bars, opts)
      if (!next?.length) return null
      idb.puts.push(key); idb.entries.set(key, { bars: next, lastT: next[next.length - 1].t, savedAt: Date.now() })
      return next
    }),
  }
})
vi.mock('../hooks/useTickerMeta', () => ({ prefetchTickerMeta: vi.fn() }))

const { prefetchBars, prefetchBarOnIntent, warmMemFromIDB, _url, setPrefetchShowExtended, joinPendingBars } = await import('./prefetchBars')
const { memPeek, memClear, memPut } = await import('./barsMemCache')
const { firstPaintBarsFor } = await import('./barsBackfill')

// Tue 2026-09-15 13:17 ET
const NOW = new Date('2026-09-15T17:17:00Z').getTime()
const et = (h, m) => Math.floor(Date.UTC(2026, 8, 15, h + 4, m) / 1000)
const bars5 = (fromH, fromM, toH, toM) => {
  const out = []
  for (let t = et(fromH, fromM); t <= et(toH, toM); t += 300) out.push({ t, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 })
  return out
}
const flush = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)) }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW)
  idb.entries.clear(); idb.puts.length = 0; memClear()
  try { localStorage.setItem('barspack.version', '2026-09-14') } catch { /* */ }
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); setPrefetchShowExtended(false) })

describe('D10 — an error body is never data', () => {
  it('a 404 warm writes nothing to mem or IDB (the old r.json() handed {detail} back as bars)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, headers: { get: () => null }, json: async () => ({ detail: 'nope' }), clone() { return this } })))
    prefetchBarOnIntent('ZZZ', '5', { delay: 0 })
    await new Promise(r => setTimeout(r, 5)); await flush()
    expect(memPeek('ZZZ', '5')).toBeNull()
    expect(idb.puts).toEqual([])
  })
})

describe('warm promises are not replayed', () => {
  it('a second warm of the same URL after the first SETTLED goes to the network again', async () => {
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async () => { n++; return { ok: true, status: 200, json: async () => ({ ticker: 'AAA', tf: '5', bars: bars5(9, 30, 13, 10) }) } }))
    prefetchBarOnIntent('AAA', '5', { delay: 0 })
    await new Promise(r => setTimeout(r, 5)); await flush()
    expect(n).toBe(1)
    memClear(); idb.entries.clear()
    prefetchBarOnIntent('AAA', '5', { delay: 0 })
    await new Promise(r => setTimeout(r, 5)); await flush()
    // Before: SWR's preload table returned the FIRST (settled) promise forever.
    expect(n).toBe(2)
    expect(joinPendingBars(_url('AAA', '5', false))).toBeNull()
  })
})

describe('mem promotion obeys the chart paint rule', () => {
  it('a 3h-behind intraday IDB entry is NOT promoted to mem (the chart would refuse it)', async () => {
    idb.entries.set('BBB_5', { bars: bars5(9, 30, 10, 0), lastT: et(10, 0), savedAt: NOW })
    warmMemFromIDB(['BBB'], ['5'])
    await flush()
    expect(memPeek('BBB', '5')).toBeNull()
  })
  it('a current entry (within one bucket) IS promoted', async () => {
    idb.entries.set('CCC_5', { bars: bars5(9, 30, 13, 5), lastT: et(13, 5), savedAt: NOW })
    warmMemFromIDB(['CCC'], ['5'])
    await flush()
    expect(memPeek('CCC', '5')?.length).toBeGreaterThan(0)
  })
  it('a stale MEM entry no longer short-circuits the urgent warm (it used to count as usable)', async () => {
    memPut('DDD', '5', bars5(9, 30, 10, 0))
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async () => { n++; return { ok: true, status: 200, json: async () => ({ ticker: 'DDD', tf: '5', bars: bars5(9, 30, 13, 10) }) } }))
    prefetchBars(['DDD'], '5', { urgent: true })
    await new Promise(r => setTimeout(r, 5)); await flush(60)
    expect(n).toBe(1)
    const m = memPeek('DDD', '5')
    expect(m[m.length - 1].t).toBe(et(13, 10))
  })
})

describe('extended-hours bar count follows the chart', () => {
  it('warms the SAME bars= the chart requests in each session mode', () => {
    setPrefetchShowExtended(true)
    expect(_url('X', '5', false)).toContain(`bars=${firstPaintBarsFor('5', true)}`)
    setPrefetchShowExtended(false)
    expect(_url('X', '5', false)).toContain(`bars=${firstPaintBarsFor('5', false)}`)
    expect(firstPaintBarsFor('5', true)).not.toBe(firstPaintBarsFor('5', false))
  })
})
