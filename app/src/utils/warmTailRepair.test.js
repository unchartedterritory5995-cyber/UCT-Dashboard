// ── The likely-next symbol must be CURRENT, not merely CACHED ────────────────
//
// ⚰️⚰️ THE REGRESSION THIS PINS. `_idbWarmOne` used to carry the comment
// "Intraday is already handled: idbGet returns null for a stale-intraday entry
// → `have` is null", and its early return leaned on exactly that. When `idbGet`
// was correctly changed to hand BEHIND entries back (they are sound repair
// bases — discarding them is what forced re-downloading thousands of bars to
// recover today's last twenty), that comment silently stopped being true and
// the early return became "an hours-stale intraday cache is already warm, do
// nothing". The warmer stopped repairing precisely the caches that needed it,
// and the next click painted 10:00 at 15:55.
//
// Nothing caught it: the eviction was the staleness signal for THREE consumers
// and removing it broke two of them without touching a line either one owned.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const preloadMock = vi.fn()
vi.mock('swr', () => ({ preload: (...a) => preloadMock(...a) }))

const idbState = { entry: undefined, put: vi.fn(async () => {}) }
vi.mock('./barsIDB', () => ({
  idbGet: vi.fn(async () => idbState.entry),
  idbPut: (...a) => idbState.put(...a),
  // The real mergeDelta prepends history and lets the newer rows win; for this
  // test all that matters is that BOTH halves reach the write.
  mergeDelta: (a, b) => [...a, ...b],
}))
vi.mock('../hooks/useTickerMeta', () => ({ prefetchTickerMeta: vi.fn() }))

import { prefetchBarsToIDB, _noteWarmResult, _resetRepairCooldown } from './prefetchBars'
import { memClear } from './barsMemCache'

// A Wednesday mid-session, so there IS a frontier to be behind.
const NOW = new Date('2026-09-16T15:55:00-04:00').getTime()
const unix = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return Math.floor(new Date(`2026-09-16T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00-04:00`).getTime() / 1000)
}
const barsEnding = (tSec, n = 50) =>
  Array.from({ length: n }, (_, i) => ({ t: tSec - (n - 1 - i) * 300, o: 1, h: 2, l: 0, c: 1, v: 9 }))

const urls = () => preloadMock.mock.calls.map(c => c[0])

describe('_idbWarmOne — an hours-behind intraday cache is REPAIRED, not skipped', () => {
  beforeEach(() => {
    memClear()
    preloadMock.mockReset()
    preloadMock.mockResolvedValue({ bars: barsEnding(unix('15:50'), 5), delta: true })
    idbState.entry = undefined
    idbState.put.mockClear()
    try {
      localStorage.clear()
      localStorage.setItem('barspack.version', '2026-09-01')
    } catch { /* ignore */ }
    _noteWarmResult({ bars: [{ t: 1 }] })   // clear any 503 backoff from a prior test
    _resetRepairCooldown()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => { vi.useRealTimers() })

  const drain = async () => {
    await vi.advanceTimersByTimeAsync(3000)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(100)
  }

  it('⛔⛔ issues a since= TAIL request for a cache stuck at 10:00', async () => {
    idbState.entry = { bars: barsEnding(unix('10:00')), lastT: unix('10:00') }
    prefetchBarsToIDB(['MU'], '5', { priority: true, immediate: true })
    await drain()
    const u = urls().filter(x => x.includes('/api/bars/MU'))
    expect(u.length).toBe(1)
    expect(u[0]).toContain('since=')
    // ⭐ THE TAIL, NOT THE WINDOW. Production-measured, the tail is 8.5 KB / 59 ms
    // against 81 KB / 111 ms — repairing must not cost what refetching costs, or
    // it cannot run for the ±6 neighbours on every scan step.
    expect(u[0]).toContain('tf=5')
    // Shed-able like every other background warm.
    expect(u[0]).toContain('warm=1')
  })

  it('merges the tail and writes the repaired series back to IDB + mem', async () => {
    idbState.entry = { bars: barsEnding(unix('10:00')), lastT: unix('10:00') }
    prefetchBarsToIDB(['MU'], '5', { priority: true, immediate: true })
    await drain()
    expect(idbState.put).toHaveBeenCalledTimes(1)
    const [sym, tf, merged] = idbState.put.mock.calls[0]
    expect(sym).toBe('MU')
    expect(tf).toBe('5')
    // The repaired series must end at the tail the server returned, not at 10:00.
    expect(merged[merged.length - 1].t).toBe(unix('15:50'))
  })

  it('a cache ALREADY at the frontier costs no request at all', async () => {
    idbState.entry = { bars: barsEnding(unix('15:50')), lastT: unix('15:50') }
    prefetchBarsToIDB(['MU'], '5', { priority: true, immediate: true })
    await drain()
    expect(urls().filter(x => x.includes('/api/bars/MU'))).toHaveLength(0)
    expect(idbState.put).not.toHaveBeenCalled()
  })

  it('⚠️ one bucket behind is WITHIN tolerance — no request, no churn', async () => {
    // Otherwise every illiquid name with no print in the newest bucket would be
    // re-requested on every single scan step, forever.
    idbState.entry = { bars: barsEnding(unix('15:45')), lastT: unix('15:45') }
    prefetchBarsToIDB(['MU'], '5', { priority: true, immediate: true })
    await drain()
    expect(urls().filter(x => x.includes('/api/bars/MU'))).toHaveLength(0)
  })

  it('a COLD entry still takes the FULL path, not the tail path', async () => {
    idbState.entry = undefined
    prefetchBarsToIDB(['MU'], '5', { priority: true, immediate: true })
    await drain()
    const u = urls().filter(x => x.includes('/api/bars/MU'))
    expect(u.length).toBe(1)
    expect(u[0]).not.toContain('since=')
  })

  it('⛔⛔ REPAIRING THE SAME SYMBOL AGAIN INSIDE ONE BUCKET COSTS NOTHING', async () => {
    // useNeighborWarm re-enqueues all ±6 neighbours on EVERY selection, and
    // `priority` deliberately bypasses the `_idbSeen` skip — so without a
    // cooldown a fast scan would fan out ~12 tail requests PER CLICK. A repaired
    // cache cannot go stale again faster than one bar closes, so a second repair
    // inside the same bucket cannot buy a single fresher bar.
    idbState.entry = { bars: barsEnding(unix('10:00')), lastT: unix('10:00') }
    for (let i = 0; i < 5; i++) {
      prefetchBarsToIDB(['MU'], '5', { priority: true, immediate: true })
      await drain()
    }
    expect(urls().filter(x => x.includes('/api/bars/MU'))).toHaveLength(1)
  })

  it('…but a DIFFERENT symbol is never blocked by another symbol’s cooldown', async () => {
    idbState.entry = { bars: barsEnding(unix('10:00')), lastT: unix('10:00') }
    prefetchBarsToIDB(['MU'], '5', { priority: true, immediate: true })
    await drain()
    prefetchBarsToIDB(['MP'], '5', { priority: true, immediate: true })
    await drain()
    expect(urls().filter(x => x.includes('/api/bars/MU'))).toHaveLength(1)
    expect(urls().filter(x => x.includes('/api/bars/MP'))).toHaveLength(1)
  })

  it('DAILY is untouched by the intraday repair path', async () => {
    idbState.entry = { bars: [{ t: '2026-09-16', o: 1, h: 2, l: 0, c: 1, v: 9 }], lastT: '2026-09-16' }
    prefetchBarsToIDB(['MU'], 'D', { priority: true, immediate: true })
    await drain()
    expect(urls().filter(x => x.includes('since='))).toHaveLength(0)
  })

  it('every native intraday timeframe repairs, so the rule is not 5m-only', async () => {
    for (const tf of ['1', '15', '30', '60']) {
      preloadMock.mockReset()
      preloadMock.mockResolvedValue({ bars: barsEnding(unix('15:50'), 3), delta: true })
      idbState.entry = { bars: barsEnding(unix('10:00')), lastT: unix('10:00') }
      prefetchBarsToIDB([`T${tf}`], tf, { priority: true, immediate: true })
      await drain()
      expect(urls().filter(x => x.includes('since='))).not.toHaveLength(0)
    }
  })
})
