// TYPE-TO-SEARCH WARM (2026-11-11): while the member types, the typed D/W/M symbol's cache is
// promoted to memory, and the network is asked ONLY when the chart's own paint authority
// (`dailyCachePaintVerdict`) would refuse that cache as a first frame. By Enter the set the
// chart will paint is in memory; an answer still in flight is joined by the handoff and by
// the chart's SWR key. Real SWR on purpose: what matters is what the chart's own key receives.
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import useSWR from 'swr'
import { pinWallClock } from '../testing/pinnedWallClock'

const world = vi.hoisted(() => ({ idb: {}, packUsable: false, packBars: {} }))
vi.mock('./barsIDB', () => ({
  idbGet: vi.fn(async (s, tf) => world.idb[`${s}_${tf}`] || null),
  idbPut: vi.fn(async () => {}),
  mergeDelta: (a, b) => {
    const m = new Map(a.map((x) => [x.t, x])); for (const x of b) m.set(x.t, x)
    return [...m.values()].sort((x, y) => (x.t < y.t ? -1 : 1))
  },
}))
vi.mock('../hooks/useTickerMeta', () => ({ prefetchTickerMeta: vi.fn() }))
vi.mock('../lib/todayPackClient', () => ({
  todayPackUsable: () => world.packUsable,
  getTodayBar: (s) => world.packBars[s] || null,
}))

// Wed 2026-11-11 11:05 ET — inside RTH. Today = 2026-11-11, the last closed session = 11-10.
const clock = pinWallClock('2026-11-11T16:05:00Z')
afterAll(() => clock.restore())

const { warmTypedSymbol, prepareDailyForDisplay, _noteWarmResult } = await import('./prefetchBars')
const { memClear, memPeek, memPeekSavedAt, memPut } = await import('./barsMemCache')
const { dailyCachePaintVerdict } = await import('./marketSession')

const URL_FOR = (s) => `/api/bars/${s}?tf=D&bars=600`
const bar = (t, c = 1.5) => ({ t, o: 1, h: 2, l: 0.5, c, v: 1 })
const NET = [bar('2026-11-10'), bar('2026-11-11', 1.8)]
const answer = (s, bars = NET) => ({ ok: true, status: 200, json: async () => ({ ticker: s, tf: 'D', bars }) })
const PACK_ENTRY = { bars: [bar('2026-11-06'), bar('2026-11-09'), bar('2026-11-10')], savedAt: Date.now() - 3 * 3600_000 }
const SEED = { o: 1, h: 2, l: 0.5, c: 1.6, v: 1 }

beforeEach(() => {
  memClear()
  _noteWarmResult({ bars: [{ t: 1 }] })
  world.idb = {}; world.packUsable = false; world.packBars = {}
  try { localStorage.removeItem('barspack.version') } catch { /* jsdom */ }
})
afterEach(() => { vi.unstubAllGlobals() })

describe('warmTypedSymbol', () => {
  it("an uncached name: fetches the chart's own daily URL, leaves a network-fresh set in memory", async () => {
    const f = vi.fn(async () => answer('NVDA'))
    vi.stubGlobal('fetch', f)
    const t0 = Date.now()
    await expect(warmTypedSymbol('nvda', 'D')).resolves.toBe('network')
    expect(f).toHaveBeenCalledTimes(1)
    expect(String(f.mock.calls[0][0])).toBe(URL_FOR('NVDA'))
    expect(memPeek('NVDA', 'D')).toHaveLength(2)
    expect(memPeekSavedAt('NVDA', 'D')).toBeGreaterThanOrEqual(t0)   // stamped NOW
  })

  it('on a browser holding the pack, uncached text is a PREFIX, not a ticker: no request', async () => {
    const f = vi.fn(async () => answer('GOO'))
    vi.stubGlobal('fetch', f)
    localStorage.setItem('barspack.version', '2026-11-10')
    await expect(warmTypedSymbol('GOO', 'D')).resolves.toBe('unknown')
    expect(f).not.toHaveBeenCalled()
    expect(memPeek('GOO', 'D')).toBeNull()
  })

  it('a pack-seeded name WITH a today seed: promoted to memory, NO request', async () => {
    const f = vi.fn(async () => answer('AAPL'))
    vi.stubGlobal('fetch', f)
    world.idb.AAPL_D = PACK_ENTRY
    world.packUsable = true; world.packBars.AAPL = SEED
    await expect(warmTypedSymbol('AAPL', 'D')).resolves.toBe('cache')
    expect(f).not.toHaveBeenCalled()
    expect(memPeek('AAPL', 'D')).toHaveLength(3)
    expect(memPeekSavedAt('AAPL', 'D')).toBe(PACK_ENTRY.savedAt)       // its OWN stamp, never now
  })

  it('a pack-seeded name WITHOUT a seed (today-pack aged out): promoted AND fetched', async () => {
    const f = vi.fn(async () => answer('MU'))
    vi.stubGlobal('fetch', f)
    world.idb.MU_D = PACK_ENTRY
    await expect(warmTypedSymbol('MU', 'D')).resolves.toBe('network')
    expect(f).toHaveBeenCalledTimes(1)
    // The deeper promoted history is kept; the server wins the overlap and adds today.
    expect(memPeek('MU', 'D').map((b) => b.t)).toEqual(['2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11'])
  })

  it('a tail sessions behind is fetched even with a seed (it cannot paint)', async () => {
    const f = vi.fn(async () => answer('INTC'))
    vi.stubGlobal('fetch', f)
    world.idb.INTC_D = { bars: [bar('2026-11-05')], savedAt: Date.now() - 86400_000 }
    world.packUsable = true; world.packBars.INTC = SEED
    await expect(warmTypedSymbol('INTC', 'D')).resolves.toBe('network')
    expect(f).toHaveBeenCalledTimes(1)
  })

  // ⭐ INVARIANT: the warm asks the network EXACTLY when the chart's paint authority would
  // refuse the cache it holds — over every tail age x seed x write time, never its own rule.
  it('INVARIANT: network <=> the paint authority refuses the cached set', async () => {
    const tails = ['2026-11-11', '2026-11-10', '2026-11-09', '2026-11-06', '2026-10-30']
    const writes = [Date.now() - 30_000, Date.now() - 3 * 3600_000, null]
    let n = 0
    for (const t of tails) for (const savedAt of writes) for (const seed of [false, true]) {
      memClear()
      const S = `Z${++n}`
      const f = vi.fn(async () => answer(S))
      vi.stubGlobal('fetch', f)
      world.idb = { [`${S}_D`]: { bars: [bar('2026-10-01'), bar(t)], savedAt } }
      world.packUsable = seed; world.packBars = seed ? { [S]: SEED } : {}
      const out = await warmTypedSymbol(S, 'D')
      const paints = dailyCachePaintVerdict(t, savedAt, { hasSeed: seed }) === 'ok'
      expect({ t, savedAt, seed, out }).toEqual({ t, savedAt, seed, out: paints ? 'cache' : 'network' })
      expect(f).toHaveBeenCalledTimes(paints ? 0 : 1)
    }
  })

  it('an answer still in flight is joined by the chart (one request, not two)', async () => {
    let release
    const f = vi.fn(() => new Promise((r) => { release = () => r(answer('AMD')) }))
    vi.stubGlobal('fetch', f)
    const warm = warmTypedSymbol('AMD', 'D')
    await waitFor(() => expect(f).toHaveBeenCalled())
    const own = vi.fn(async () => ({ ticker: 'AMD', bars: [] }))
    // `data` read DURING render, as the chart does (SWR re-renders only for fields read).
    const { result } = renderHook(() => { const r = useSWR(URL_FOR('AMD'), own); return { data: r.data } })
    release()
    await warm
    await waitFor(() => expect(result.current.data?.bars?.length).toBe(2))
    expect(own).not.toHaveBeenCalled()
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('...and by the handoff on Enter (prepareDailyForDisplay joins, never repeats)', async () => {
    let release
    const f = vi.fn(() => new Promise((r) => { release = () => r(answer('TSLA')) }))
    vi.stubGlobal('fetch', f)
    const warm = warmTypedSymbol('TSLA', 'D')
    await waitFor(() => expect(f).toHaveBeenCalled())
    const prep = prepareDailyForDisplay('TSLA', 'D')
    release()
    await warm
    await expect(prep).resolves.toBe('current')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('skips a symbol whose set in memory is already network-fresh', async () => {
    const f = vi.fn(async () => answer('MU'))
    vi.stubGlobal('fetch', f)
    memPut('MU', 'D', NET)                                   // written now
    expect(warmTypedSymbol('MU', 'D')).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('stores nothing from a shed, a wrong-symbol or a delta answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, headers: new Headers(), clone() { return this }, json: async () => ({ error: 'warming' }) })))
    await expect(warmTypedSymbol('SOFI', 'D')).resolves.toBe(false)
    vi.stubGlobal('fetch', vi.fn(async () => answer('OTHER')))
    await expect(warmTypedSymbol('COIN', 'D')).resolves.toBe(false)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ticker: 'PLTR', delta: true, bars: NET }) })))
    await expect(warmTypedSymbol('PLTR', 'D')).resolves.toBe(false)
    expect(memPeek('SOFI', 'D')).toBeNull()
    expect(memPeek('COIN', 'D')).toBeNull()
    expect(memPeek('PLTR', 'D')).toBeNull()
  })

  it('does nothing for intraday, odd text or an empty symbol', () => {
    const f = vi.fn(async () => answer('X'))
    vi.stubGlobal('fetch', f)
    expect(warmTypedSymbol('AAPL', '5')).toBeNull()
    expect(warmTypedSymbol('$IDX:ai', 'D')).toBeNull()
    expect(warmTypedSymbol('', 'D')).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})
