// app/src/components/chart/engine/secondaryBars.deeperServes.test.js
//
// ─── A SHALLOWER WINDOW IS SERVED BY A DEEPER ONE THAT HOLDS ALL ITS ROWS (2026-11-26, Fred RS load time) ──────────
//
// Production (ecc0bb94, AGL): a 1D -> 1W switch took 1,223 ms to draw Fred RS, and SP:SPX was fetched again. The 1D chart
// holds `/api/bars/SPX?tf=D&bars=20000` (12,500 rows: every session the store has); the 1W chart asks SPX's daily rows at
// `heldDepthOf` (`bars=12500`). The shallower window is the same answer, so it is served from the held entry:
//   S1 no request: the 1W ask after the 1D ask fetches nothing and answers the very same entry object
//   S2 never a FILLED deeper entry with more rows than asked (a slice would be a new answer): that one is fetched
//   S3 never across symbol, timeframe or session; never from an entry that is not AVAILABLE
//   S4 the live tail keeps the SERVING entry current (`refreshSecondaryTail` merges into the deeper entry)
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ensureSecondaryBars, cachedBars, clearSecondaryBars, servingUrlOf, refreshSecondaryTail, SOURCE_STATUS,
} from './secondaryBars'

const days = (n, from = Date.UTC(1976, 0, 2)) => Array.from({ length: n }, (_, i) => {
  const iso = new Date(from + i * 86400000).toISOString().slice(0, 10)
  return { t: iso, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 1000 }
})
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)) }
/** A route that answers the newest `min(bars, held)` rows of a series of `held` rows, and counts its requests. */
function routeOf(held) {
  const rows = days(held)
  const calls = []
  const fetcher = vi.fn((url) => {
    calls.push(url)
    const m = String(url).match(/[?&]bars=(\d+)/)
    const n = m ? Number(m[1]) : 200
    return Promise.resolve({ bars: rows.slice(Math.max(0, rows.length - n)) })
  })
  return { fetcher, calls, rows }
}

afterEach(() => { clearSecondaryBars() })

describe('a shallower native window is served by a deeper entry that holds all its rows', () => {
  it('S1 the 1W held ask after the 1D ask: no request, the same entry object', async () => {
    const r = routeOf(12500)
    ensureSecondaryBars('SPX', 'D', 20000, r.fetcher)
    await settle()
    const deep = cachedBars('SPX', 'D', 20000)
    expect(deep.status).toBe(SOURCE_STATUS.AVAILABLE)
    expect(deep.bars.length).toBe(12500)
    const shallow = ensureSecondaryBars('SPX', 'D', 12500, r.fetcher)
    await settle()
    expect(r.calls).toEqual(['/api/bars/SPX?tf=D&bars=20000'])
    expect(shallow).toBe(deep)
    expect(cachedBars('SPX', 'D', 12500)).toBe(deep)
    expect(servingUrlOf('SPX', 'D', 12500)).toBe('/api/bars/SPX?tf=D&bars=20000')
  })

  it('S2 a FILLED deeper entry with more rows than asked is not used: the window is fetched', async () => {
    const r = routeOf(30000)
    ensureSecondaryBars('SPX', 'D', 20000, r.fetcher)
    await settle()
    expect(cachedBars('SPX', 'D', 20000).bars.length).toBe(20000)
    expect(cachedBars('SPX', 'D', 12500)).toBe(null)
    ensureSecondaryBars('SPX', 'D', 12500, r.fetcher)
    await settle()
    expect(r.calls).toEqual(['/api/bars/SPX?tf=D&bars=20000', '/api/bars/SPX?tf=D&bars=12500'])
    expect(cachedBars('SPX', 'D', 12500).bars.length).toBe(12500)
  })

  it('S2b a shallower entry never serves a deeper window', async () => {
    const r = routeOf(12500)
    ensureSecondaryBars('SPX', 'D', 5000, r.fetcher)
    await settle()
    expect(cachedBars('SPX', 'D', 20000)).toBe(null)
  })

  it('S3 never across symbol, timeframe or an entry that is not AVAILABLE', async () => {
    const r = routeOf(12500)
    ensureSecondaryBars('SPX', 'D', 20000, r.fetcher)
    await settle()
    expect(cachedBars('SPY', 'D', 12500)).toBe(null)
    expect(cachedBars('SPX', 'W', 12500)).toBe(null)
    const empty = vi.fn(() => Promise.resolve({ bars: [] }))
    ensureSecondaryBars('QQQ', 'D', 20000, empty)
    await settle()
    expect(cachedBars('QQQ', 'D', 20000).status).toBe(SOURCE_STATUS.NO_DATA)
    expect(cachedBars('QQQ', 'D', 12500)).toBe(null)
  })

  it('S4 the live tail of the shallower window keeps the serving entry current', async () => {
    const r = routeOf(12500)
    ensureSecondaryBars('SPX', 'D', 20000, r.fetcher)
    await settle()
    const deep = cachedBars('SPX', 'D', 20000)
    const last = deep.bars[deep.bars.length - 1]
    const tail = vi.fn(() => Promise.resolve({ bars: [{ ...last, c: last.c + 7 }], newest_bar_is_forming: true }))
    expect(refreshSecondaryTail('SPX', 'D', 12500, tail)).toBe(true)
    await settle()
    expect(tail).toHaveBeenCalledWith('/api/bars/SPX?tf=D&bars=10')
    const now = cachedBars('SPX', 'D', 20000)
    expect(now).not.toBe(deep)
    expect(now.bars[now.bars.length - 1].c).toBe(last.c + 7)
    expect(cachedBars('SPX', 'D', 12500)).toBe(now)
  })
})
