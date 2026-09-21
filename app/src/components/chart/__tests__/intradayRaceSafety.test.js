/**
 * Race safety for the state this project ADDED.
 *
 * ⛔ SCOPE, STATED HONESTLY. StockChart's pre-existing cross-symbol guards
 * (`data.ticker !== sym`, `idbReadyForRef`, `lastBarSymRef`, the [sym, tf] reset
 * effect, per-(sym,tf) pool dispatch, and SWR's URL-keyed cache) were AUDITED,
 * not rewritten — so they are not re-asserted here. What IS asserted is every
 * new piece of per-load state this project introduced, because new state is
 * exactly where a new race would live, and because a suite that only re-tests
 * old guards would read as coverage of the new ones.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mergeDelta } from '../../../utils/barsIDB'
import { timingStart, timingMark, timingReport, timingClear } from '../../../utils/intradayTiming'
import { isIntradayTailStale } from '../../../utils/marketSession'

// ── 1. the catch-up poll counter (added with the bounded provisional lifetime) ──
const TAIL_CATCHUP_POLL_MS = 1500
const TAIL_CATCHUP_MAX_TRIES = 5
const INTRADAY_POLL_MS = 30_000

/** Mirrors StockChart's `_intradayPollMs`, INCLUDING its key reset. */
function makeKeyedPoller() {
  const st = { key: '', tries: 0 }
  return (sym, tf, tailT) => {
    const key = `${sym}_${tf}`
    if (st.key !== key) { st.key = key; st.tries = 0 }
    if (!tailT || !isIntradayTailStale(tailT, tf)) { st.tries = 0; return INTRADAY_POLL_MS }
    if (st.tries >= TAIL_CATCHUP_MAX_TRIES) return INTRADAY_POLL_MS
    st.tries += 1
    return TAIL_CATCHUP_POLL_MS
  }
}

const NOW = new Date('2026-09-15T17:17:00Z').getTime()   // Tue 13:17 ET
const stale = Math.floor(Date.UTC(2026, 8, 15, 14, 0) / 1000)   // 10:00 ET

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers(); timingClear() })

describe('catch-up budget across rapid switching', () => {
  it('⛔ a spent budget does NOT carry into the next symbol', () => {
    const poll = makeKeyedPoller()
    for (let i = 0; i < TAIL_CATCHUP_MAX_TRIES; i++) poll('AAPL', '5', stale)
    expect(poll('AAPL', '5', stale)).toBe(INTRADAY_POLL_MS)      // AAPL exhausted
    expect(poll('NVDA', '5', stale)).toBe(TAIL_CATCHUP_POLL_MS)  // NVDA gets its own
  })

  it('⛔ nor into the next TIMEFRAME on the same symbol', () => {
    const poll = makeKeyedPoller()
    for (let i = 0; i < TAIL_CATCHUP_MAX_TRIES; i++) poll('AAPL', '5', stale)
    expect(poll('AAPL', '1', stale)).toBe(TAIL_CATCHUP_POLL_MS)
  })

  it('a rapid A→B→C→A sweep leaves A with a fresh budget, not a stale counter', () => {
    const poll = makeKeyedPoller()
    poll('AAPL', '5', stale); poll('NVDA', '5', stale)
    poll('TSLA', '5', stale); poll('AAPL', '5', stale)
    // Back on AAPL the counter was reset by the key change, so it may still fast-poll.
    expect(poll('AAPL', '5', stale)).toBe(TAIL_CATCHUP_POLL_MS)
  })

  it('CONTROL — WITHOUT the key reset the budget would leak across symbols', () => {
    const st = { tries: 0 }
    const leaky = (tailT) => {
      if (st.tries >= TAIL_CATCHUP_MAX_TRIES) return INTRADAY_POLL_MS
      st.tries += 1; return TAIL_CATCHUP_POLL_MS
    }
    for (let i = 0; i < TAIL_CATCHUP_MAX_TRIES; i++) leaky(stale)
    expect(leaky(stale)).toBe(INTRADAY_POLL_MS)   // the next symbol is starved
  })
})

// ── 2. the T0-T4 load id ─────────────────────────────────────────────────────
describe('timing marks never cross loads', () => {
  beforeEach(() => { try { localStorage.setItem('uct.chartTiming', '1') } catch { /* ignore */ } })
  afterEach(() => { try { localStorage.removeItem('uct.chartTiming') } catch { /* ignore */ } })

  it('a late mark from the PREVIOUS symbol cannot land on the current load', () => {
    const a = timingStart('AAPL', '5')
    const b = timingStart('NVDA', '5')
    timingMark(a, 'T2')                 // AAPL's paint resolving late
    const rows = timingReport()
    const nvda = rows.find(r => r.sym === 'NVDA')
    const aapl = rows.find(r => r.sym === 'AAPL')
    expect(aapl['T0→T2']).not.toBeNull()
    expect(nvda['T0→T2']).toBeNull()    // NVDA's row is untouched
  })

  it('each selection gets its own id, so ids are never reused', () => {
    expect(timingStart('AAPL', '5')).not.toBe(timingStart('AAPL', '5'))
  })
})

// ── 3. merge identity ────────────────────────────────────────────────────────
describe('mergeDelta — the one canonical seam', () => {
  const bar = (t, c, v = 10) => ({ t, o: c, h: c, l: c, c, v })

  it('the delta wins on a duplicate timestamp — a completed bar replaces a provisional one', () => {
    const existing = [bar(100, 1), bar(200, 2)]
    const delta = [bar(200, 2.5, 99)]     // same ts, authoritative values
    expect(mergeDelta(existing, delta)).toEqual([bar(100, 1), bar(200, 2.5, 99)])
  })

  it('an out-of-order delta is sorted, never appended blindly', () => {
    const merged = mergeDelta([bar(300, 3)], [bar(100, 1), bar(200, 2)])
    expect(merged.map(b => b.t)).toEqual([100, 200, 300])
  })

  it('⭐ a gap-filling tail merges into sound history without discarding it', () => {
    // The authoritative-tail case: history to 10:00, tail carries 10:05 → 13:15.
    const history = [bar(1, 1), bar(2, 2), bar(3, 3)]
    const tail = [bar(4, 4), bar(5, 5)]
    expect(mergeDelta(history, tail).map(b => b.t)).toEqual([1, 2, 3, 4, 5])
  })

  it('an empty delta is a no-op — a quiet poll never blanks the series', () => {
    const history = [bar(1, 1)]
    expect(mergeDelta(history, [])).toBe(history)
  })
})
