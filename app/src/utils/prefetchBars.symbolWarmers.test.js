// Companion warmers (2026-11-12). Every bars warm knows which symbols a member is about to
// open; a lane with its own per-symbol data (the server-computed indicator columns) registers
// here and is told the same list. Measured before this existed: candles in ~40 ms, the RS
// panes 1.2 to 2.0 s after them, on every first visit of a list scan.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const idb = vi.hoisted(() => ({ entries: new Map() }))
vi.mock('./barsIDB', async (orig) => {
  const real = await orig()
  return {
    ...real,
    idbGet: vi.fn(async (sym, tf) => idb.entries.get(`${sym}_${tf}`) ?? null),
    idbPutMonotonic: vi.fn(async (sym, tf, bars, opts) => {
      const key = `${sym}_${tf}`
      const next = real.mergeMonotonic(idb.entries.get(key)?.bars ?? null, bars, opts)
      if (!next?.length) return null
      idb.entries.set(key, { bars: next, lastT: next[next.length - 1].t, savedAt: Date.now() })
      return next
    }),
  }
})
vi.mock('../hooks/useTickerMeta', () => ({ prefetchTickerMeta: vi.fn() }))

const {
  registerSymbolWarmer, prefetchBars, prefetchBar, prefetchBarsToIDB, prefetchAllTimeframes,
  prewarmVisibleList, prefetchBarOnIntent, warmTypedSymbol, __resetTypedWarm,
} = await import('./prefetchBars')
const { memClear, memPut } = await import('./barsMemCache')

const flush = async (n = 30) => { for (let i = 0; i < n; i++) await Promise.resolve() }
const dailyBars = (lastIso = '2026-09-14') => [{ t: '2026-09-11', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }, { t: lastIso, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }]

let told, off
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-15T14:00:00Z'))            // Tue 10:00 ET
  idb.entries.clear(); memClear(); __resetTypedWarm()
  told = []
  off = registerSymbolWarmer((syms, tf, opts) => told.push({ syms: [...syms], tf, opts: { ...opts } }))
  try { localStorage.setItem('barspack.version', '2026-09-14') } catch { /* */ }
  vi.stubGlobal('fetch', vi.fn(async (u) => ({ ok: true, status: 200, json: async () => ({ ticker: String(u).split('/api/bars/')[1]?.split('?')[0], tf: 'D', bars: dailyBars('2026-09-15') }) })))
})
afterEach(() => { off(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('every bars warm tells the registered warmers which symbols are next', () => {
  it('⭐ the scan neighbours (prefetchBarsToIDB, priority): same list, same order, same timeframe, and the rank', () => {
    prefetchBarsToIDB(['NVDA', 'AAPL', 'MSFT'], 'D', { priority: true })
    expect(told).toEqual([{ syms: ['NVDA', 'AAPL', 'MSFT'], tf: 'D', opts: { priority: true, visible: false } }])
  })

  it('⛔ a symbol whose BARS are already warm is still told: bars are durable, the companion data is per page load', async () => {
    idb.entries.set('NVDA_D', { bars: dailyBars('2026-09-15'), lastT: '2026-09-15', savedAt: Date.now() })
    memPut('NVDA', 'D', dailyBars('2026-09-15'))
    prefetchBarsToIDB(['NVDA'], 'D', { priority: true })
    prefetchBarsToIDB(['NVDA'], 'D', { priority: true })          // the 60 s "recently seen" skip is the bars' own
    await flush()
    expect(told.map((t) => t.syms)).toEqual([['NVDA'], ['NVDA']])
    expect(globalThis.fetch, 'and the bars themselves needed no request').not.toHaveBeenCalled()
  })

  it('a list that just opened: its on-screen rows are marked visible, the rest of it is not', () => {
    const list = Array.from({ length: 40 }, (_, i) => `S${i}`)
    prewarmVisibleList(list, { chartTf: 'D', memTop: 24 })
    expect(told.length).toBe(2)
    expect(told[0]).toEqual({ syms: list.slice(0, 24), tf: 'D', opts: { priority: true, visible: true } })
    expect(told[1]).toEqual({ syms: list.slice(24), tf: 'D', opts: { priority: true, visible: false } })
  })

  it('prefetchBars and prefetchBar (the in-memory warms) tell them too', () => {
    prefetchBars(['NVDA', 'AAPL'], '5', { priority: true })
    prefetchBars(['TSLA'], 'D', { urgent: true })
    prefetchBars(['AMD'], 'D')
    prefetchBar('MSFT', 'W')
    expect(told).toEqual([
      { syms: ['NVDA', 'AAPL'], tf: '5', opts: { priority: true } },
      { syms: ['TSLA'], tf: 'D', opts: { priority: true } },
      { syms: ['AMD'], tf: 'D', opts: { priority: false } },
      { syms: ['MSFT'], tf: 'W', opts: { priority: true } },
    ])
  })

  it('every timeframe of a selected symbol is announced at its own timeframe', () => {
    prefetchAllTimeframes('NVDA')
    expect(told.every((t) => t.syms.length === 1 && t.syms[0] === 'NVDA')).toBe(true)
    expect(told.map((t) => t.tf)).toContain('D')
    expect(new Set(told.map((t) => t.tf)).size).toBe(told.length)
    expect(told.length).toBeGreaterThanOrEqual(5)
  })

  it('empties and falsy rows are not announced', () => {
    prefetchBarsToIDB([], 'D', { priority: true })
    prefetchBarsToIDB([null, '', undefined], 'D')
    prefetchBars([null], 'D')
    prefetchBar('', 'D')
    expect(told).toEqual([])
    prefetchBarsToIDB(['NVDA', null, 'AAPL'], 'D')
    expect(told[0].syms).toEqual(['NVDA', 'AAPL'])
  })
})

describe('an intent (hover / keyboard focus)', () => {
  it('⭐ is announced after the debounce EVEN WHEN the bars are already in memory', async () => {
    memPut('NVDA', 'D', dailyBars('2026-09-15'))
    prefetchBarOnIntent('NVDA', 'D')
    expect(told, 'not in the pointer\'s frame').toEqual([])
    await vi.advanceTimersByTimeAsync(119)
    expect(told).toEqual([])
    await vi.advanceTimersByTimeAsync(2)
    expect(told).toEqual([{ syms: ['NVDA'], tf: 'D', opts: { priority: true } }])
  })

  it('with NO warmer registered, bars already in memory still mean no work at all (not even a timer)', () => {
    off()
    memPut('NVDA', 'D', dailyBars('2026-09-15'))
    const before = vi.getTimerCount()
    prefetchBarOnIntent('NVDA', 'D')
    expect(vi.getTimerCount()).toBe(before)
  })

  it('brushing across the same row again inside the debounce announces it once', async () => {
    for (let i = 0; i < 5; i++) prefetchBarOnIntent('NVDA', 'D')
    await vi.advanceTimersByTimeAsync(200)
    expect(told.length).toBe(1)
    prefetchBarOnIntent('NVDA', 'D')
    await vi.advanceTimersByTimeAsync(200)
    expect(told.length, 'a later intent is a new one').toBe(2)
  })
})

describe('a typed ticker', () => {
  it('⛔ a PREFIX is not a ticker: text with no cached set (pack stamped) announces nothing', async () => {
    expect(await warmTypedSymbol('GOO', 'D')).toBe('unknown')
    expect(told).toEqual([])
  })

  it('a name with a cached set is announced, whether or not its bars then need a request', async () => {
    idb.entries.set('GOOG_D', { bars: dailyBars('2026-09-14'), lastT: '2026-09-14', savedAt: Date.now() })
    await warmTypedSymbol('goog', 'D')
    expect(told).toEqual([{ syms: ['GOOG'], tf: 'D', opts: { priority: true } }])
  })

  it('a name whose bars are in memory and current is announced without any bars work', () => {
    memPut('NVDA', 'D', dailyBars('2026-09-15'))
    expect(warmTypedSymbol('NVDA', 'D')).toBeNull()
    expect(told).toEqual([{ syms: ['NVDA'], tf: 'D', opts: { priority: true } }])
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('a new member (no pack): a name the server confirms is announced once its bars land', async () => {
    localStorage.removeItem('barspack.version')
    expect(await warmTypedSymbol('NVDA', 'D')).toBe('network')
    expect(told).toEqual([{ syms: ['NVDA'], tf: 'D', opts: { priority: true } }])
  })
})

describe('the registry itself', () => {
  it('a warmer that throws cannot break a bars warm, or the warmers after it', () => {
    const after = []
    const offBad = registerSymbolWarmer(() => { throw new Error('a bad companion') })
    const offGood = registerSymbolWarmer((syms) => after.push(...syms))
    expect(() => prefetchBarsToIDB(['NVDA'], 'D', { priority: true })).not.toThrow()
    expect(after).toEqual(['NVDA'])
    offBad(); offGood()
  })

  it('unregistering stops the announcements; a non-function is refused', () => {
    off()
    prefetchBarsToIDB(['NVDA'], 'D')
    expect(told).toEqual([])
    expect(() => registerSymbolWarmer(null)()).not.toThrow()
    prefetchBarsToIDB(['AAPL'], 'D')
    expect(told).toEqual([])
  })
})
