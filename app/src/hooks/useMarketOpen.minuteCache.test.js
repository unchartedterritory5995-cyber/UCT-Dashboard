// ⚡ (2026-11-26, the board switch) ONE SESSION READ PER WALL-CLOCK MINUTE. Every chart pane, header clock and session
// badge mounts its own useMarketOpen, and each read the NYSE calendar on mount (sessionState: ET parts, the day's
// boundaries, its boundary events): 2.1 ms of a board switch on production's build. The session changes only on a
// minute boundary, so the state read in a minute IS that minute's state: computed once, shared.
//   M1 (red first) ten hooks mounting within one minute read the calendar once
//   M2 the next minute is read again, and a session boundary (09:29 -> 09:30) flips every hook at its next tick
//   M3 the state is the calendar's own answer, field for field, at every minute of a day (pre, open, close, post)
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const C = vi.hoisted(() => ({ reads: 0 }))
vi.mock('../lib/marketClock/marketClock', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, sessionState: (...a) => { C.reads += 1; return real.sessionState(...a) } }
})

let useMarketOpen
let realSession
beforeEach(async () => {
  vi.resetModules()
  C.reads = 0
  useMarketOpen = (await import('./useMarketOpen')).default
  realSession = (await vi.importActual('../lib/marketClock/marketClock')).sessionState
})
afterEach(() => { vi.useRealTimers() })

describe('useMarketOpen: one calendar read per minute', () => {
  it('M1 (red first) ten hooks mounting within one minute read the calendar once', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T15:00:05Z'))   // a regular Thursday, 10:00:05 ET
    for (let i = 0; i < 10; i++) renderHook(() => useMarketOpen())
    expect(C.reads, `${C.reads} calendar reads for ten mounts in one minute`).toBe(1)
  })

  it('M2 the next minute is read again, and the 09:30 boundary flips every hook at its next tick', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T14:29:00Z'))   // 09:29:00 ET: pre-market
    const hooks = Array.from({ length: 3 }, () => renderHook(() => useMarketOpen()))
    for (const h of hooks) expect(h.result.current).toMatchObject({ isOpen: false, isPremarket: true })
    const before = C.reads
    act(() => { vi.advanceTimersByTime(60_000) })          // 09:30:00 ET: every hook's interval ticks
    expect(C.reads - before, 'the new minute was not read again (or read per hook)').toBe(1)
    for (const h of hooks) expect(h.result.current).toMatchObject({ isOpen: true, isPremarket: false })
  })

  it('M3 the state is the calendar\'s own answer at every minute of a day: pre, the open, the close, post, overnight', () => {
    vi.useFakeTimers()
    const day = Date.parse('2026-11-27T05:00:00Z')        // the day after Thanksgiving, an early close (13:00 ET)
    const minutes = new Set([...Array.from({ length: 206 }, (_, i) => i * 7), 239, 240, 569, 570, 779, 780, 1199, 1200])
    for (const m of minutes) {
      for (const s of [0, 31, 59]) {
        const at = day + m * 60_000 + s * 1000
        vi.setSystemTime(new Date(at))
        const { result, unmount } = renderHook(() => useMarketOpen())
        const want = realSession(new Date(at))
        expect(result.current, new Date(at).toISOString()).toEqual({
          isOpen: want.isOpen, isPremarket: want.isPremarket, isExtended: want.isExtended, isHalfDay: want.isHalfDay,
        })
        unmount()
      }
    }
  })
})
