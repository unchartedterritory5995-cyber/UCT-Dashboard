/**
 * A provisional intraday tail must have a TINY, DETERMINISTIC lifetime.
 *
 * ⚰️ The reported symptom: at 13:00 the chart opens ending around 10:00 and only
 * catches up 20-30 s later. That delay was not a repair mechanism — it was the
 * 30 s SWR poll, the earliest moment anything re-asked. Two paths put that tail on
 * screen (the `_idbProvisional` instant paint, and a server payload shed at
 * `_bounded_delta`'s deadline), and both are the right trade for latency only if
 * the stale frame is measured in seconds.
 *
 * This rails the pacing decision in isolation. The policy is a pure function of
 * (tail instant, tf, attempt count), so it is tested as one rather than through a
 * full StockChart mount — the mount would prove the wiring and hide the bound.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isIntradayTailStale } from '../../../utils/marketSession'
// ⭐ THE REAL POLICY (2026-09-28). This file used to exercise a hand-copied mirror of
// StockChart's inline pacing, which could not fail when StockChart regressed.
import {
  TAIL_CATCHUP_POLL_MS, TAIL_CATCHUP_MAX_TRIES, INTRADAY_POLL_MS,
  createTailPollState, nextTailPollMs, tailRetriesExhausted,
  intradayDedupMs, REPAIR_DEDUP_MS, INTRADAY_DEDUP_MS, liveBadgeState, watchdogGapMs,
} from '../../../utils/intradayTailPoll'

function makePoller(tf, key = `X_${tf}`) {
  const st = createTailPollState()
  const poll = (tailT, extra = {}) => nextTailPollMs(st, key, { tailT, tf, ...extra })
  poll.state = st
  return poll
}

// 13:00 ET on Tue 2026-09-15 — mid-session, the exact shape of the report.
const NOW = new Date('2026-09-15T17:00:00Z').getTime()
const etToday = (h, m) => Math.floor(Date.UTC(2026, 8, 15, h + 4, m) / 1000)

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

describe('intraday catch-up poll', () => {
  it('CONTROL — a 10:00 tail at 13:00 really is stale, so the pacing test is not vacuous', () => {
    expect(isIntradayTailStale(etToday(10, 0), '5')).toBe(true)
  })

  it('polls fast while the painted tail is behind the market', () => {
    expect(makePoller('5')(etToday(10, 0))).toBe(TAIL_CATCHUP_POLL_MS)
  })

  it('bounds the stale frame to a few seconds, not 30', () => {
    const poll = makePoller('5')
    let elapsed = 0
    for (let i = 0; i < TAIL_CATCHUP_MAX_TRIES; i++) elapsed += poll(etToday(10, 0))
    expect(elapsed).toBeLessThanOrEqual(8000)
    expect(elapsed).toBeLessThan(INTRADAY_POLL_MS)
  })

  it('⛔ STOPS after the cap — an illiquid symbol that never prints must not fast-poll forever', () => {
    const poll = makePoller('5')
    for (let i = 0; i < TAIL_CATCHUP_MAX_TRIES; i++) poll(etToday(10, 0))
    expect(poll(etToday(10, 0))).toBe(INTRADAY_POLL_MS)
    expect(poll(etToday(10, 0))).toBe(INTRADAY_POLL_MS)
  })

  it('a current tail polls at the normal cadence and costs nothing extra', () => {
    expect(makePoller('5')(etToday(12, 55))).toBe(INTRADAY_POLL_MS)
  })

  it('catching up RESETS the budget, so the next gap gets a full allowance', () => {
    const poll = makePoller('5')
    for (let i = 0; i < TAIL_CATCHUP_MAX_TRIES; i++) poll(etToday(10, 0))
    expect(poll(etToday(12, 55))).toBe(INTRADAY_POLL_MS)   // caught up → reset
    expect(poll(etToday(10, 0))).toBe(TAIL_CATCHUP_POLL_MS)
  })

  it('never fast-polls an absent tail', () => {
    expect(makePoller('5')(null)).toBe(INTRADAY_POLL_MS)
    expect(makePoller('5')(0)).toBe(INTRADAY_POLL_MS)
  })

  it('⛔ does NOT fast-poll a closed market — a Friday tail read on Sunday is complete', () => {
    vi.setSystemTime(new Date('2026-09-20T21:00:00Z').getTime())   // Sun 17:00 ET
    const fridayClose = Math.floor(Date.UTC(2026, 8, 18, 19, 55) / 1000)
    expect(makePoller('5')(fridayClose)).toBe(INTRADAY_POLL_MS)
  })
})

describe("⛔⛔ the server's verdict (2026-09-28 stale-success fix)", () => {
  it('an UNVERIFIED answer keeps the catch-up going even when the classifier sees nothing wrong', () => {
    // 12:55 at 13:00 is current by the client's own reading…
    expect(makePoller('5')(etToday(12, 55))).toBe(INTRADAY_POLL_MS)
    // …but if the server says it could not verify, the chart keeps asking.
    expect(makePoller('5')(etToday(12, 55), { tailStatus: 'unverified' })).toBe(TAIL_CATCHUP_POLL_MS)
  })
  it("never retries sooner than the server's Retry-After", () => {
    expect(makePoller('5')(etToday(10, 0), { tailStatus: 'unverified', retryAfterSec: 3 })).toBe(3000)
  })
  it('Retry-After is still capped at the normal cadence', () => {
    expect(makePoller('5')(etToday(10, 0), { retryAfterSec: 600 })).toBe(INTRADAY_POLL_MS)
  })
  it('the spent fast budget is what DELAYED means — and polling continues at the cadence', () => {
    const poll = makePoller('5', 'AVGO_5')
    for (let i = 0; i < TAIL_CATCHUP_MAX_TRIES; i++) poll(etToday(10, 0), { tailStatus: 'unverified' })
    expect(tailRetriesExhausted(poll.state, 'AVGO_5')).toBe(true)
    expect(poll(etToday(10, 0), { tailStatus: 'unverified' })).toBe(INTRADAY_POLL_MS)   // still asking
    expect(tailRetriesExhausted(poll.state, 'NVDA_5')).toBe(false)                       // per key
  })
  it('a verified/current answer resets the budget (recovery is automatic)', () => {
    const poll = makePoller('5', 'AVGO_5')
    for (let i = 0; i < TAIL_CATCHUP_MAX_TRIES; i++) poll(etToday(10, 0))
    poll(etToday(12, 55), { tailStatus: 'current' })
    expect(tailRetriesExhausted(poll.state, 'AVGO_5')).toBe(false)
  })
  it('CONTROL — isIntradayTailStale import is still the classifier the policy reads', () => {
    expect(isIntradayTailStale(etToday(10, 0), '5')).toBe(true)
  })
})

describe('⚰️⚰️ the dedupe that swallowed every catch-up try', () => {
  it('a not-current tail runs a dedupe window shorter than any catch-up delay', () => {
    expect(intradayDedupMs({ tailClass: 'behind' })).toBe(REPAIR_DEDUP_MS)
    expect(intradayDedupMs({ tailClass: 'gapped' })).toBe(REPAIR_DEDUP_MS)
    expect(intradayDedupMs({ tailClass: 'fresh', tailStatus: 'unverified' })).toBe(REPAIR_DEDUP_MS)
    expect(REPAIR_DEDUP_MS).toBeLessThan(TAIL_CATCHUP_POLL_MS)
  })
  it('it is decided from STATE, so the very first (mount) request already gets it', () => {
    // No poller has run yet — the counter is 0 — and the window must still be short.
    expect(intradayDedupMs({ tailClass: 'behind', tailStatus: null })).toBe(REPAIR_DEDUP_MS)
  })
  it('CONTROL — the normal 15 s window really would swallow a catch-up try', () => {
    expect(INTRADAY_DEDUP_MS).toBeGreaterThan(TAIL_CATCHUP_POLL_MS)
    expect(intradayDedupMs({ tailClass: 'fresh', tailStatus: 'current' })).toBe(INTRADAY_DEDUP_MS)
    expect(intradayDedupMs({})).toBe(INTRADAY_DEDUP_MS)
  })
})

describe('⛔⛔ LIVE requires the feed AND the candles', () => {
  it('a live feed over non-current bars is NEVER live', () => {
    for (const c of ['updating', 'delayed', 'unavailable']) expect(liveBadgeState('live', c)).not.toBe('live')
    expect(liveBadgeState('live', 'updating')).toBe('updating')
    expect(liveBadgeState('live', 'delayed')).toBe('delayed')
  })
  it('a live feed over current bars is live', () => {
    expect(liveBadgeState('live', 'current')).toBe('live')
    expect(liveBadgeState('live', 'no_expectation')).toBe('live')
  })
  it('D/W/M (no currentness verdict) keep the feed-only badge exactly as before', () => {
    expect(liveBadgeState('live', null)).toBe('live')
    expect(liveBadgeState('reconnecting', null)).toBe('reconnecting')
    expect(liveBadgeState('stale', null)).toBe('stale')
  })
  it('a broken feed never reads live whatever the bars', () => {
    expect(liveBadgeState('reconnecting', 'current')).toBe('reconnecting')
    expect(liveBadgeState('stale', 'current')).toBe('stale')
  })
})

describe('watchdog backoff', () => {
  it('6 s, 12 s, 24 s, 48 s, then once a minute', () => {
    expect([0, 1, 2, 3, 4, 9].map(watchdogGapMs)).toEqual([6000, 12000, 24000, 48000, 60000, 60000])
  })
})
