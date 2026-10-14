import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const preload = vi.fn(() => new Promise(() => {})) // never settles: occupies a slot
vi.mock('swr', () => ({ preload: (...a) => preload(...a) }))
vi.mock('../hooks/useTickerMeta', () => ({ prefetchTickerMeta: vi.fn() }))

let mod
beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  preload.mockReset(); preload.mockImplementation(() => new Promise(() => {}))
  try { localStorage.clear() } catch { /* ignore */ } // fresh browser: pack NOT ingested
  mod = await import('./prefetchBars')
})
afterEach(() => { vi.useRealTimers() })

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
})
