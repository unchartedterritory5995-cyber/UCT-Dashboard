import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const preload = vi.fn(() => new Promise(() => {})) // never settles: occupies a slot
vi.mock('swr', () => ({ preload: (...a) => preload(...a) }))
vi.mock('./barsIDB', () => ({
  idbGet: vi.fn(() => Promise.resolve(null)), idbPut: vi.fn(() => Promise.resolve()), idbPutMonotonic: vi.fn(() => Promise.resolve(null)),
  mergeDelta: (a, b) => b,
}))
vi.mock('../hooks/useTickerMeta', () => ({ prefetchTickerMeta: vi.fn() }))

let mod
beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  preload.mockReset(); preload.mockImplementation(() => new Promise(() => {}))
  try { localStorage.clear() } catch { /* ignore */ } // fresh browser: pack NOT ingested
  mod = await import('./prefetchBars')
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
// Microtasks only (the urgent job awaits an IDB probe first): NO timers advanced.
const micro = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

const urls = () => preload.mock.calls.map(c => c[0])
const drain = () => vi.advanceTimersByTimeAsync(2000)

describe('prefetchBars urgent (opt-in cold-start bypass)', () => {
  it('default path stays HELD on a fresh browser: nothing is fetched', async () => {
    expect(mod._holdBackgroundWarm()).toBe(true)
    mod.prefetchBars(['AAA', 'BBB', 'CCC'], 'D')
    await drain()
    expect(preload).not.toHaveBeenCalled()
  })

  it('urgent bypasses the hold for at most 2 symbols per call', async () => {
    // Settling fetches free concurrency slots, so only the per-call cap limits the count.
    preload.mockImplementation(() => Promise.resolve({ bars: [{ t: 1 }] }))
    mod.prefetchBars(['AAA', 'BBB', 'CCC', 'DDD'], 'D', { urgent: true })
    await drain()
    const u = urls()
    expect(u).toHaveLength(2)
    expect(u[0]).toContain('/api/bars/AAA?tf=D&bars=')
    expect(u[0]).not.toContain('warm')
    expect(u[1]).toContain('/api/bars/BBB?tf=D&bars=')
    expect(u.join()).not.toContain('CCC')
    expect(u.join()).not.toContain('DDD')
  })

  it('urgent uses the same URL (bar count) as the normal path', async () => {
    mod.prefetchBars(['AAA'], 'D', { urgent: true })
    await drain()
    localStorage.setItem('barspack.version', 'v1')
    mod.prefetchBars(['ZZZ'], 'D')
    await drain()
    const bars = u => u.match(/bars=(\d+)/)[1]
    expect(bars(urls()[0])).toBe(bars(urls()[1]))
  })

  it('still honours the server 503 backoff', async () => {
    mod._noteWarmResult({ bars: [], error: 'warming' })
    mod.prefetchBars(['AAA', 'BBB'], 'D', { urgent: true })
    await drain()
    expect(preload).not.toHaveBeenCalled()
  })

  it('stays inside the bounded queue (never more than the concurrency cap)', async () => {
    mod.prefetchBars(['AAA', 'BBB'], 'D', { urgent: true })
    mod.prefetchBars(['CCC', 'DDD'], 'D', { urgent: true })
    await drain()
    expect(preload.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('urgent=false (explicit) is identical to the default: held', async () => {
    mod.prefetchBars(['AAA'], 'D', { urgent: false })
    await drain()
    expect(preload).not.toHaveBeenCalled()
  })

  it('urgent starts on the next tick, without waiting for the idle callback or timer', async () => {
    const ric = vi.fn()
    vi.stubGlobal('requestIdleCallback', ric)
    mod.prefetchBars(['AAA', 'BBB'], 'D', { urgent: true })
    await micro()                           // microtasks only: NO timers advanced
    expect(urls().join()).toContain('AAA')
    expect(preload).toHaveBeenCalledTimes(2)
    expect(ric).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('non-urgent warms stay idle-deferred (not started on the next tick)', async () => {
    localStorage.setItem('barspack.version', 'v1')
    mod.prefetchBars(['AAA'], 'D')
    await Promise.resolve()
    expect(preload).not.toHaveBeenCalled()
    await drain()
    expect(preload).toHaveBeenCalledTimes(1)
  })

  it('urgent URL is the chart key (no &warm), and the bars land in the sync mem cache', async () => {
    const { memHas } = await import('./barsMemCache')
    const { FIRST_PAINT_BARS } = await import('./barsBackfill')
    preload.mockImplementation(() => Promise.resolve({ bars: [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }] }))
    mod.prefetchBars(['KEYA'], 'D', { urgent: true })
    await drain()
    // StockChart's primary key: /api/bars/<sym>?tf=<tf>&bars=<n>, no warm flag.
    expect(urls()).toEqual([`/api/bars/KEYA?tf=D&bars=${FIRST_PAINT_BARS}`])
    expect(urls()[0]).toBe(mod._url('KEYA', 'D', false))
    expect(memHas('KEYA', 'D')).toBe(true)
  })

  it('an already-queued background URL for the same symbol is replaced and starts on the next tick', async () => {
    localStorage.setItem('barspack.version', 'v1')
    mod.prefetchBars(['AAA', 'BBB', 'CCC'], 'D')       // FocusScreener-style top-N, idle-deferred
    await Promise.resolve()
    expect(preload).not.toHaveBeenCalled()
    mod.prefetchBars(['AAA', 'BBB'], 'D', { urgent: true })
    await micro()   // microtasks only
    expect(urls().every(u => !u.includes('warm'))).toBe(true)
    expect(urls().join()).toContain('AAA')
    expect(urls().join()).toContain('BBB')
  })

  it('urgent re-promotion of an already-queued chart-key URL pumps on the next tick', async () => {
    // Held by backoff then released: the urgent URL stays queued, a second urgent call must still pump.
    mod._noteWarmResult({ bars: [], error: 'warming' })
    mod.prefetchBars(['AAA'], 'D', { urgent: true })
    await micro()
    expect(preload).not.toHaveBeenCalled()
    mod._noteWarmResult({ bars: [{ t: 1 }] })
    mod.prefetchBars(['AAA'], 'D', { urgent: true })
    await micro()
    expect(preload).toHaveBeenCalledTimes(1)
  })

  it('only the latest urgent call stays urgent (fast walk leaves no stale trail)', async () => {
    preload.mockImplementation(() => Promise.resolve({ bars: [{ t: 1 }] })) // slots free up: stale jobs WOULD run
    mod._noteWarmResult({ bars: [], error: 'warming' })   // park everything in the queue
    for (let i = 0; i < 5; i++) mod.prefetchBars([`R${i}A`, `R${i}B`], 'D', { urgent: true })
    mod._noteWarmResult({ bars: [{ t: 1 }] })
    mod.prefetchBars(['R4A', 'R4B'], 'D', { urgent: true })
    await drain()
    const got = urls().join()
    expect(got).toContain('R4A')
    expect(got).toContain('R4B')
    for (let i = 0; i < 4; i++) expect(got).not.toContain(`R${i}`)
  })

  it('does not re-fetch a key fetched or in mem within the last 30s', async () => {
    preload.mockImplementation(() => Promise.resolve({ bars: [{ t: 1 }] }))
    mod.prefetchBars(['AAA'], 'D', { urgent: true })
    await drain()
    mod.prefetchBars(['AAA'], 'D', { urgent: true })
    await drain()
    expect(preload).toHaveBeenCalledTimes(1)
  })
})

// Rail: the urgent warm is only worth anything if it fills the key the chart reads on first paint.
// StockChart builds that key inline, so pin both sides of the template here.
describe('urgent key matches the chart', () => {
  it('StockChart still requests /api/bars/<sym>?tf=<tf>&bars=<first-paint bars> and urgent builds the same', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('src/components/StockChart.jsx', 'utf8')
    expect(src).toContain('/api/bars/${encodeURIComponent(sym)}?tf=${resolvedTf}&bars=${_primaryBars}${_sessQ}${_sinceParam')
    expect(src).toContain("/api/bars/${encodeURIComponent(sym || '')}?tf=${resolvedTf}&bars=${_primaryBars}${_sessQ}`")
    const { FIRST_PAINT_BARS, firstPaintBarsFor } = await import('./barsBackfill')
    expect(mod._url('AAPL', 'D', false)).toBe(`/api/bars/AAPL?tf=D&bars=${FIRST_PAINT_BARS}`)
    // intraday: the same `&session=` the chart's `_sessQ` appends (barsSessionQuery)
    mod.setPrefetchShowExtended(false)
    expect(mod._url('AAPL', '5', false)).toBe(`/api/bars/AAPL?tf=5&bars=${firstPaintBarsFor('5', false)}&session=rth`)
    mod.setPrefetchShowExtended(true)
    expect(mod._url('AAPL', '60', false)).toBe(`/api/bars/AAPL?tf=60&bars=${firstPaintBarsFor('60', true)}&session=eth`)
    mod.setPrefetchShowExtended(false)
  })
})

describe('one download per row (2026-10-17)', () => {
  it('a row with an urgent job running is not fetched again under &warm=1', async () => {
    mod.prefetchBars(['AAA'], 'D', { urgent: true })          // never settles: stays in flight
    await micro()
    mod.prefetchBarsToIDB(['AAA', 'BBB'], 'D', { priority: true, visible: true })
    await drain()
    const aaa = urls().filter(u => u.includes('/api/bars/AAA'))
    expect(aaa.some(u => !u.includes('warm=1'))).toBe(true)  // the chart's key, once
    expect(aaa.some(u => u.includes('warm=1'))).toBe(false)
    // CONTROL: a row without an urgent job is still warmed into IDB
    expect(urls().some(u => u.includes('/api/bars/BBB') && u.includes('warm=1'))).toBe(true)
  })
})

describe('session-aware warms (2026-11-10)', () => {
  it('with extended hours on, a 60m urgent warm fills the 60e key with the session=eth series', async () => {
    const { memHas } = await import('./barsMemCache')
    const { firstPaintBarsFor } = await import('./barsBackfill')
    preload.mockImplementation(() => Promise.resolve({ bars: [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }], session: 'eth' }))
    mod.setPrefetchShowExtended(true)
    try {
      mod.prefetchBars(['ETHW'], '60', { urgent: true })
      await drain()
      expect(urls()).toEqual([`/api/bars/ETHW?tf=60&bars=${firstPaintBarsFor('60', true)}&session=eth`])
      expect(memHas('ETHW', '60e')).toBe(true)
      expect(memHas('ETHW', '60')).toBe(false)
    } finally { mod.setPrefetchShowExtended(false) }
  })
  it('RTH 60m and every non-60 tf keep their plain key', async () => {
    const { memHas } = await import('./barsMemCache')
    preload.mockImplementation(() => Promise.resolve({ bars: [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }] }))
    mod.prefetchBars(['RTHW'], '60', { urgent: true })
    await drain()
    mod.setPrefetchShowExtended(true)
    try {
      mod.prefetchBars(['EXT5'], '5', { urgent: true })
      await drain()
    } finally { mod.setPrefetchShowExtended(false) }
    expect(urls().some(u => u.startsWith('/api/bars/RTHW?tf=60') && u.endsWith('&session=rth'))).toBe(true)
    expect(memHas('RTHW', '60')).toBe(true)
    expect(memHas('EXT5', '5')).toBe(true)
  })
})

describe('a warm keeps the key it started with (review #1061 F3)', () => {
  it('toggling EXT while an RTH 60m warm is in flight writes the RTH answer under 60, never 60e', async () => {
    const { memHas } = await import('./barsMemCache')
    let resolve
    preload.mockImplementation(() => new Promise((r) => { resolve = r }))
    mod.setPrefetchShowExtended(false)
    try {
      mod.prefetchBars(['FLIPW'], '60', { urgent: true })
      await drain()
      expect(urls()[0]).toContain('session=rth')
      mod.setPrefetchShowExtended(true)                    // member flips EXT mid-flight
      resolve({ bars: [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }] })
      await drain()
      expect(memHas('FLIPW', '60e')).toBe(false)
      mod.setPrefetchShowExtended(false)
      expect(memHas('FLIPW', '60')).toBe(true)
    } finally { mod.setPrefetchShowExtended(false) }
  })
  it('an answer on the other grid than the job key is not written at all', async () => {
    const { memHas } = await import('./barsMemCache')
    preload.mockImplementation(() => Promise.resolve({ bars: [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }], session: 'eth' }))
    mod.prefetchBars(['GRIDX'], '60', { urgent: true })   // RTH job, eth answer
    await drain()
    expect(memHas('GRIDX', '60')).toBe(false)
    expect(memHas('GRIDX', '60e')).toBe(false)
  })
})
