import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const preload = vi.fn(() => new Promise(() => {})) // never settles: occupies a slot
vi.mock('swr', () => ({ preload: (...a) => preload(...a) }))
vi.mock('./barsIDB', () => ({
  idbGet: vi.fn(() => Promise.resolve(null)), idbPut: vi.fn(() => Promise.resolve()),
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
    expect(src).toContain('/api/bars/${encodeURIComponent(sym)}?tf=${resolvedTf}&bars=${_primaryBars}${_sinceParam')
    const { FIRST_PAINT_BARS } = await import('./barsBackfill')
    expect(mod._url('AAPL', 'D', false)).toBe(`/api/bars/AAPL?tf=D&bars=${FIRST_PAINT_BARS}`)
  })
})
