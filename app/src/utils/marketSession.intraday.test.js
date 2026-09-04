// Rails for isIntradayTailStale — the session/weekend/holiday-aware intraday freshness
// that lets the intraday pack paint instantly (the intraday analog of isDailyTailStale).
// Time-mocked: the function reads `now` via expectedLatestDailySessionET().
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isIntradayTailStale } from './marketSession'

const sec = (iso) => Math.floor(Date.parse(iso) / 1000)   // unix seconds for an ISO/UTC instant

describe('isIntradayTailStale', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  describe('Wednesday 11:00 ET (RTH — last closed session is Tuesday)', () => {
    beforeEach(() => vi.setSystemTime(new Date('2026-08-19T15:00:00Z')))  // Wed 11:00 EDT

    it('FRESH: tail = Tuesday 15:55 close (the pre-seeded pack; today rides live)', () => {
      expect(isIntradayTailStale(sec('2026-08-18T19:55:00Z'), '5')).toBe(false)
    })
    it('STALE: tail = Monday (missing the whole Tuesday session)', () => {
      expect(isIntradayTailStale(sec('2026-08-17T19:55:00Z'), '5')).toBe(true)
    })
    it("FRESH: tail = today 10:57 (current session, within the 15min 5m recency gate)", () => {
      expect(isIntradayTailStale(sec('2026-08-19T14:57:00Z'), '5')).toBe(false)
    })
    it('STALE: tail = today 09:35 (current session, ~85min behind → intra-session hole)', () => {
      expect(isIntradayTailStale(sec('2026-08-19T13:35:00Z'), '5')).toBe(true)
    })
    it('60m tolerates a wider recency gate than 5m for the current session', () => {
      // ~2h behind: stale for 5m (max(15min)) but fresh for 60m (max(3h))
      const tail = sec('2026-08-19T13:00:00Z')  // today 09:00 ET, 2h behind
      expect(isIntradayTailStale(tail, '5')).toBe(true)
      expect(isIntradayTailStale(tail, '60')).toBe(false)
    })
  })

  describe('Monday 11:00 ET (RTH — last closed session is FRIDAY across the weekend)', () => {
    beforeEach(() => vi.setSystemTime(new Date('2026-08-17T15:00:00Z')))  // Mon 11:00 EDT

    it("FRESH: tail = Friday 15:55 close — 65h old but the last closed session (THE bug the old 26h/2-day gates killed)", () => {
      expect(isIntradayTailStale(sec('2026-08-14T19:55:00Z'), '5')).toBe(false)
    })
    it('STALE: tail = Thursday (missing the whole Friday session)', () => {
      expect(isIntradayTailStale(sec('2026-08-13T19:55:00Z'), '5')).toBe(true)
    })
  })

  it('non-numeric / missing tail is stale', () => {
    vi.setSystemTime(new Date('2026-08-19T15:00:00Z'))
    expect(isIntradayTailStale(null, '5')).toBe(true)
    expect(isIntradayTailStale(undefined, '5')).toBe(true)
    expect(isIntradayTailStale(NaN, '5')).toBe(true)
  })
})

// ── Phase 1 (intraday integrity): the SESSION-COMPLETENESS fix, gated ──────────
// A tail dated == the last closed session must REACH that session's close, not just
// carry its date. Catches "chart missing the last hours of the day on first open after
// close." Gate ON via localStorage 'uct.intradayComplete.enabled'='1'.
describe('isIntradayTailStale — session completeness (gate ON)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    try { localStorage.setItem('uct.intradayComplete.enabled', '1') } catch { /* jsdom */ }
  })
  afterEach(() => {
    vi.useRealTimers()
    try { localStorage.removeItem('uct.intradayComplete.enabled') } catch { /* jsdom */ }
  })

  describe('after close (Wed 17:00 ET) — expected session is today (Wed), now closed', () => {
    beforeEach(() => vi.setSystemTime(new Date('2026-08-19T21:00:00Z')))  // Wed 17:00 EDT

    it('STALE: tail = today 13:30 (mid-session partial — THE missing-afternoon bug)', () => {
      expect(isIntradayTailStale(sec('2026-08-19T17:30:00Z'), '5')).toBe(true)
    })
    it('FRESH: tail = today 15:55 (last RTH 5m bucket — complete session)', () => {
      expect(isIntradayTailStale(sec('2026-08-19T19:55:00Z'), '5')).toBe(false)
    })
    it('FRESH: tail = today 18:00 (post-market — beyond RTH close)', () => {
      expect(isIntradayTailStale(sec('2026-08-19T22:00:00Z'), '5')).toBe(false)
    })
    it('60m: FRESH at last RTH hourly bucket (15:00), STALE before it (13:00)', () => {
      expect(isIntradayTailStale(sec('2026-08-19T19:00:00Z'), '60')).toBe(false) // 15:00 ET
      expect(isIntradayTailStale(sec('2026-08-19T17:00:00Z'), '60')).toBe(true)  // 13:00 ET
    })
  })

  describe('during RTH (Wed 11:00 ET) — no false positive on the live session', () => {
    beforeEach(() => vi.setSystemTime(new Date('2026-08-19T15:00:00Z')))  // Wed 11:00 EDT

    it('FRESH: tail = today 10:57 (current session — recency gate owns it, not completeness)', () => {
      expect(isIntradayTailStale(sec('2026-08-19T14:57:00Z'), '5')).toBe(false)
    })
    it('FRESH: tail = Tuesday 15:55 (complete prior session — the pre-seed still paints)', () => {
      expect(isIntradayTailStale(sec('2026-08-18T19:55:00Z'), '5')).toBe(false)
    })
    it('STALE: tail = Tuesday 13:30 (INCOMPLETE prior session — now caught)', () => {
      expect(isIntradayTailStale(sec('2026-08-18T17:30:00Z'), '5')).toBe(true)
    })
  })
})

describe('isIntradayTailStale — completeness gate OFF (default) is byte-identical', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    try { localStorage.removeItem('uct.intradayComplete.enabled') } catch { /* jsdom */ }
    vi.setSystemTime(new Date('2026-08-19T21:00:00Z'))  // Wed 17:00 EDT (after close)
  })
  afterEach(() => vi.useRealTimers())

  it('FRESH: a today 13:30 mid-session partial stays fresh with the gate off (old behavior)', () => {
    expect(isIntradayTailStale(sec('2026-08-19T17:30:00Z'), '5')).toBe(false)
  })
})
