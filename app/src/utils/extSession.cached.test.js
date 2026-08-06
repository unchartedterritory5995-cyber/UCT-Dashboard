import { describe, it, expect, vi, afterEach } from 'vitest'
import { getExtSession, getExtSessionCached } from './extSession'

// getExtSessionCached is the render-path variant. Two properties matter and neither is
// about speed for its own sake:
//   1. It agrees with getExtSession() — a cache that answers differently is a bug.
//   2. Its returned object IDENTITY is stable while the session is unchanged, because
//      callers put it in memo/effect dependency lists. A fresh object per call is what
//      turned "cheap recompute" into "re-run the expensive downstream work anyway".

afterEach(() => { vi.useRealTimers() })

describe('getExtSessionCached', () => {
  it('returns the same value as the uncached function', () => {
    const cached = getExtSessionCached()
    const direct = getExtSession()
    expect(cached.session).toBe(direct.session)
    expect(cached.anchorDate).toBe(direct.anchorDate)
  })

  it('returns a STABLE object identity across repeated calls', () => {
    const a = getExtSessionCached()
    for (let i = 0; i < 500; i++) expect(getExtSessionCached()).toBe(a)
  })

  it('keeps the SAME identity across a cache expiry when the session has not changed', () => {
    vi.useFakeTimers()
    // ⛔ THE SYSTEM TIME IS PINNED, AND IT IS THE WHOLE POINT OF THIS CASE.
    // `useFakeTimers()` alone freezes at the REAL wall clock, and the next line
    // advances a full minute — so run this within 60 seconds of an ET session
    // boundary (04:00 / 09:30 / 16:00 / 20:00) and the session legitimately
    // CHANGES across the advance, the identity legitimately changes with it, and
    // the assertion fails on correct behaviour. Roughly four minutes a weekday.
    // MEASURED: 2 failures in 10 consecutive full-suite runs, 2026-08-03.
    //
    // The case's own name says "when the session has not changed" — that is a
    // PRECONDITION, and until now it was merely usually true. 14:00 UTC is
    // 10:00 ET, mid-regular-hours, five and a half hours from the nearest
    // boundary in either direction, so a 60-second advance cannot cross one.
    // The sibling cases below already pin the clock for exactly this reason.
    vi.setSystemTime(new Date('2026-07-29T14:00:00Z'))
    const a = getExtSessionCached()
    vi.advanceTimersByTime(60_000)   // well past the 5s TTL
    // Recomputed, but content-identical → same object, so dependency arrays stay put.
    expect(getExtSessionCached()).toBe(a)
    // …and the precondition really did hold, so this is not vacuously green.
    expect(a.session, 'the pinned instant is not mid-RTH — the case proves nothing').toBe('rth')
  })

  it('picks up a real session change (identity changes only then)', () => {
    vi.useFakeTimers()
    // Wednesday 2026-07-29, 09:00 ET = 13:00 UTC → pre-market.
    vi.setSystemTime(new Date('2026-07-29T13:00:00Z'))
    const pre = getExtSessionCached()
    expect(pre.session).toBe('pre')

    // 10:00 ET = 14:00 UTC → regular hours.
    vi.setSystemTime(new Date('2026-07-29T14:00:00Z'))
    const rth = getExtSessionCached()
    expect(rth.session).toBe('rth')
    expect(rth).not.toBe(pre)

    // And it settles again on the new value.
    expect(getExtSessionCached()).toBe(rth)

    // 15:59 ET — still regular.
    vi.setSystemTime(new Date('2026-07-29T19:59:00Z'))
    expect(getExtSessionCached().session).toBe('rth')
    // 16:01 ET — post opens.
    vi.setSystemTime(new Date('2026-07-29T20:01:00Z'))
    expect(getExtSessionCached().session).toBe('post')
  })

  it('does not wedge when the clock jumps BACKWARD (NTP correction / VM resume)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-29T20:01:00Z'))   // 16:01 ET → post
    expect(getExtSessionCached().session).toBe('post')
    // A naive `now - cachedAt < TTL` reads a negative delta as "still fresh" and the
    // cache would never expire again for the life of the tab.
    vi.setSystemTime(new Date('2026-07-29T14:00:00Z'))   // 10:00 ET → rth
    expect(getExtSessionCached().session).toBe('rth')
  })
})
