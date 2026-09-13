import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ensureTodayPack, getTodayBar, touchTodayPack, __resetForTest } from './todayPackClient'

const PACK = { d: '2026-09-11', n: 2, bars: { AAPL: [100, 105, 99, 104, 1234], 'BRK-B': [1, 2, 1, 2, 3] } }

function mockFetch(payload, ok = true) {
  return vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(payload) }))
}

beforeEach(() => { __resetForTest(); vi.useRealTimers() })
afterEach(() => { __resetForTest(); vi.restoreAllMocks() })

describe('todayPackClient', () => {
  it('serves today\'s bar after a load', async () => {
    global.fetch = mockFetch(PACK)
    await ensureTodayPack()
    expect(getTodayBar('AAPL')).toEqual({ o: 100, h: 105, l: 99, c: 104, v: 1234 })
    expect(getTodayBar('aapl')).toBeTruthy()          // case-insensitive
    expect(getTodayBar('BRK-B')).toBeTruthy()         // app hyphen form, as the server sends
  })

  it('returns null for an unknown symbol and before any load', () => {
    expect(getTodayBar('AAPL')).toBeNull()
  })

  it('shares ONE request across concurrent callers', async () => {
    // A workspace mounts many charts at once; N charts must not be N requests.
    global.fetch = mockFetch(PACK)
    await Promise.all([ensureTodayPack(), ensureTodayPack(), ensureTodayPack()])
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('degrades to null on a failed fetch — never throws', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('offline')))
    await expect(ensureTodayPack()).resolves.toBeFalsy()
    expect(getTodayBar('AAPL')).toBeNull()
  })

  it('an EMPTY pack (session not open) yields no seed', async () => {
    // The server sends an empty pack outside an open session on purpose — seeding
    // the provider's pre-open staleness is what caused the duplicate candle.
    global.fetch = mockFetch({ d: '', n: 0, bars: {} })
    await ensureTodayPack()
    expect(getTodayBar('AAPL')).toBeNull()
  })

  it('refuses a malformed or non-positive row rather than painting it', async () => {
    global.fetch = mockFetch({ d: '2026-09-11', bars: { ZERO: [0, 0, 0, 0, 0], SHORT: [1, 2], NOPE: 'x' } })
    await ensureTodayPack()
    expect(getTodayBar('ZERO')).toBeNull()
    expect(getTodayBar('SHORT')).toBeNull()
    expect(getTodayBar('NOPE')).toBeNull()
  })

  it('stops serving a pack that has gone stale', async () => {
    global.fetch = mockFetch(PACK)
    await ensureTodayPack()
    expect(getTodayBar('AAPL')).toBeTruthy()
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60_000)   // past MAX_AGE_MS
    expect(getTodayBar('AAPL')).toBeNull()
  })

  it('a refresh is skipped while the pack is fresh, and taken once it is not', async () => {
    // Demand-driven: scanning keeps it hot, idling costs nothing. No timer.
    global.fetch = mockFetch(PACK)
    await touchTodayPack()
    await touchTodayPack()
    expect(global.fetch).toHaveBeenCalledTimes(1)          // still fresh → no refetch
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 50_000)
    await touchTodayPack()
    expect(global.fetch).toHaveBeenCalledTimes(2)          // past REFRESH_MS → refetched
  })

  it('a pack too stale to trust does not seed, even though it is still held', async () => {
    // ⚠️ A stale price would paint today's candle at the wrong level and visibly
    // correct when /api/bars lands — worse than the missing candle we are fixing.
    global.fetch = mockFetch(PACK)
    await ensureTodayPack()
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 100_000)   // past MAX_SEED_AGE_MS
    expect(getTodayBar('AAPL')).toBeNull()
  })
})
