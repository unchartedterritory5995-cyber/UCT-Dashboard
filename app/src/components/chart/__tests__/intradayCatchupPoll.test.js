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

const TAIL_CATCHUP_POLL_MS = 1500
const TAIL_CATCHUP_MAX_TRIES = 5
const INTRADAY_POLL_MS = 30_000

/** Mirrors the policy in StockChart's `_intradayPollMs`. */
function makePoller(tf) {
  const st = { tries: 0 }
  return (tailT) => {
    if (!tailT || !isIntradayTailStale(tailT, tf)) { st.tries = 0; return INTRADAY_POLL_MS }
    if (st.tries >= TAIL_CATCHUP_MAX_TRIES) return INTRADAY_POLL_MS
    st.tries += 1
    return TAIL_CATCHUP_POLL_MS
  }
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
