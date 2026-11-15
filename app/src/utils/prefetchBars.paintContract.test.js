// INVARIANT (W-L 2026-11-11): THE WARMER AND THE PAINTER GIVE ONE ANSWER.
//
//   For every cached intraday series, every clock time and both sessions:
//   the warmer promotes it to the chart's sync cache  <=>  the chart would paint it as current
//   (`isCacheCurrentForView`, the call StockChart's mem/IDB gates make).
//
// Where these disagreed, a scanned row was "warm" and the switch still waited on the network
// (extended view pre-market: 96/96 switches; RTH view whose cache ends pre-market: 96/96 first
// frames two buckets stale). Fuzzed over seeded random caches and clocks, not one scenario.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const idb = vi.hoisted(() => ({ entries: new Map() }))
vi.mock('./barsIDB', async (orig) => {
  const real = await orig()
  return { ...real, idbGet: vi.fn(async (sym, tf) => idb.entries.get(`${sym}_${tf}`) ?? null), idbPut: vi.fn(async () => {}), idbPutMonotonic: vi.fn(async () => null) }
})
vi.mock('../hooks/useTickerMeta', () => ({ prefetchTickerMeta: vi.fn() }))

const { warmMemFromIDB, setPrefetchShowExtended } = await import('./prefetchBars')
const { memPeek, memClear } = await import('./barsMemCache')
const { isCacheCurrentForView, viewTailT, etMinutesOfUnix } = await import('./marketSession')

// Mon 2026-11-09 .. Wed 2026-11-11 (EST, UTC-5)
const et = (day, h, m) => Math.floor(Date.UTC(2026, 10, day, h + 5, m) / 1000)
const flush = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)) }
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) }
// Extended-hours 5m bars from `fromDay 04:00` to `end` with random holes (thin names).
function series(r, end, sparse) {
  const out = []
  for (let day = 9; day <= 11; day++) {
    for (let m = 240; m < 1200; m += 5) {
      const t = et(day, Math.floor(m / 60), m % 60)
      if (t > end) return out
      if (sparse && r() < 0.6) continue
      out.push({ t, o: 1, h: 2, l: 0.5, c: 1.5, v: 1 })
    }
  }
  return out
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); idb.entries.clear(); memClear() })
afterEach(() => { vi.useRealTimers(); setPrefetchShowExtended(false) })

describe('warmer promotion == chart paint verdict (fuzz)', () => {
  it('holds for 250 random (clock, cache tail, density, session) cases', async () => {
    const r = rng(20261111)
    let promoted = 0, refused = 0
    for (let i = 0; i < 250; i++) {
      const nowMin = 240 + Math.floor(r() * 960)                        // 04:00..20:00 on Wed
      const now = et(11, Math.floor(nowMin / 60), nowMin % 60) + Math.floor(r() * 60)
      vi.setSystemTime(now * 1000)
      const end = now - Math.floor(r() * 40 * 3600)                       // tail up to ~40 h old
      const bars = series(r, end, r() < 0.3)
      if (!bars.length) continue
      const ext = r() < 0.5
      setPrefetchShowExtended(ext)
      const sym = `S${i}`
      const lastT = bars[bars.length - 1].t
      idb.entries.set(`${sym}_5`, { bars, lastT, savedAt: now * 1000 })
      warmMemFromIDB([sym], ['5'])
      await flush()
      const chart = isCacheCurrentForView(bars, lastT, '5', { session: ext ? 'extended' : 'rth' })
      const warm = !!memPeek(sym, '5')
      expect({ i, warm }).toEqual({ i, warm: chart })
      if (warm) promoted++; else refused++
      memClear()
    }
    // The fuzz must exercise both outcomes, or it proves nothing.
    expect(promoted).toBeGreaterThan(20)
    expect(refused).toBeGreaterThan(20)
  }, 60_000)
})

describe('the view tail is the newest bar the view DRAWS', () => {
  it('RTH: the newest bar inside 09:30-close; extended: the raw tail (fuzz)', () => {
    const r = rng(7)
    for (let i = 0; i < 200; i++) {
      const end = et(11, 4, 0) + Math.floor(r() * 16 * 3600)
      const bars = series(r, end, r() < 0.5)
      if (!bars.length) continue
      const lastT = bars[bars.length - 1].t
      const rth = bars.filter(b => { const m = etMinutesOfUnix(b.t); return m >= 570 && m < 960 })
      expect(viewTailT(bars, lastT, { session: 'rth' })).toBe(rth.length ? rth[rth.length - 1].t : lastT)
      expect(viewTailT(bars, lastT, { session: 'extended' })).toBe(lastT)
    }
  })
})

describe('one owner: no second copy of the paint rule in the warmers or the chart gates', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  it('prefetchBars never calls isCurrentEnoughForPaint directly', () => {
    const src = readFileSync(join(here, 'prefetchBars.js'), 'utf8')
    expect(src).not.toMatch(/isCurrentEnoughForPaint\s*\(/)
    expect(src).toMatch(/isCacheCurrentForView\(/)
  })
  it("StockChart's mem and IDB first-frame gates call isCacheCurrentForView", () => {
    const src = readFileSync(join(here, '..', 'components', 'StockChart.jsx'), 'utf8')
    const mem = src.slice(src.indexOf('const _memIntradayRefused'), src.indexOf('const _memBars ='))
    const idbGate = src.slice(src.indexOf('const _idbNotCurrent'), src.indexOf('// Daily staleness gate'))
    expect(mem).toMatch(/isCacheCurrentForView\(/)
    expect(idbGate).toMatch(/isCacheCurrentForView\(/)
    expect(mem).not.toMatch(/isCurrentEnoughForPaint\(/)
    expect(idbGate).not.toMatch(/isCurrentEnoughForPaint\(/)
  })
})
