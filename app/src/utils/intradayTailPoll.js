// ── Intraday tail repair pacing — ONE policy, imported by StockChart and its rails ──
//
// ⚰️ THIS USED TO LIVE INLINE IN StockChart AND ITS TESTS RAN A HAND-COPIED MIRROR.
// A mirror cannot fail when the real code regresses, so the pacing now lives here and
// both the chart and the rails import it.
//
// ⛔⛔ 2026-09-28: TWO NEW INPUTS, BOTH FROM THE STALE-SUCCESS FIX.
//   • `tailStatus === 'unverified'` — the server says it could NOT repair the tail
//     (heal shed for capacity, provider failed, still running). That is stale even
//     when the client's own classifier has nothing to object to.
//   • `retryAfterSec` — the server's own pacing for that answer. A retry never fires
//     sooner than the server asked.
// The shape is unchanged and still bounded: a few fast tries, then the normal 30 s
// cadence, which CONTINUES — the chart keeps asking until a current tail arrives, it
// just stops hammering. `tailRetriesExhausted` is what turns UPDATING into DELAYED.
import { isIntradayTailStale } from './marketSession'

export const TAIL_CATCHUP_POLL_MS = 1500
export const TAIL_CATCHUP_MAX_TRIES = 5
export const INTRADAY_POLL_MS = 30_000

export function createTailPollState() {
  return { key: '', tries: 0 }
}

/** Next poll delay (ms) for the chart keyed `key` (`${sym}_${tf}`). Mutates `st`. */
export function nextTailPollMs(st, key, { tailT, tf, tailStatus = null, retryAfterSec = null } = {}) {
  if (st.key !== key) { st.key = key; st.tries = 0 }
  const unverified = tailStatus === 'unverified'
  if (!unverified && (!tailT || !isIntradayTailStale(tailT, tf))) { st.tries = 0; return INTRADAY_POLL_MS }
  if (st.tries >= TAIL_CATCHUP_MAX_TRIES) return INTRADAY_POLL_MS
  st.tries += 1
  const ra = Number(retryAfterSec) > 0 ? Number(retryAfterSec) * 1000 : 0
  return Math.min(INTRADAY_POLL_MS, Math.max(TAIL_CATCHUP_POLL_MS, ra))
}

/** The fast budget for THIS key is spent (the chart is DELAYED, still retrying). */
export function tailRetriesExhausted(st, key) {
  return st.key === key && st.tries >= TAIL_CATCHUP_MAX_TRIES
}

// ── The frozen-chart watchdog's pacing ──
// ⚰️ It fired a FULL request every ~8 s for as long as the chart stayed behind — seen
// in production as AVGO `bars=1152` at 15:33:14, :22, :30, :37, :45 … with every answer
// equally stale. Now: 6 s, 12 s, 24 s, 48 s, then once a minute, reset on catch-up.
export const WATCHDOG_BASE_MS = 6000
export const WATCHDOG_MAX_MS = 60_000
export function watchdogGapMs(attempts) {
  const n = Math.max(0, Number(attempts) || 0)
  return Math.min(WATCHDOG_MAX_MS, WATCHDOG_BASE_MS * 2 ** Math.min(n, 10))
}

// ── SWR dedupe while a repair is active ──
// ⚰️⚰️ THE FAST CATCH-UP NEVER REACHED THE NETWORK. StockChart's intraday SWR runs a
// 15 s `dedupingInterval`, and SWR's interval revalidation is DEDUPED — so the 1.5 s
// catch-up tries were silently swallowed and the real retry cadence was ~15 s. Its
// rails tested a hand-copied poller and could not see it; the AVGO browser harness
// did (one repair request in 24 s).
// ⚠️ SWR FIXES THE DEDUPE WINDOW WHEN A REQUEST STARTS, so it must be decided from
// STATE the chart already has at that moment — not from the retry counter, which is
// still 0 on the mount request (that request then locked a 15 s window, and the
// deduped ticks burned the whole fast budget without sending anything). Any tail that
// is not current (classifier behind/gapped, or the server said unverified) runs a 1 s
// window; a current tail keeps 15 s.
export const INTRADAY_DEDUP_MS = 15_000
export const REPAIR_DEDUP_MS = 1000
export function intradayDedupMs({ tailClass = null, tailStatus = null } = {}) {
  return (tailClass === 'behind' || tailClass === 'gapped' || tailStatus === 'unverified')
    ? REPAIR_DEDUP_MS : INTRADAY_DEDUP_MS
}

// ── The LIVE badge: the COMPLETE truth only when feed AND candles agree ──
// Returns 'live' | 'updating' | 'delayed' | 'unavailable' | 'reconnecting' | 'stale'.
// `barCurrentness` null = a timeframe this contract does not govern (D/W/M): the feed
// state is then the badge, exactly as before.
export function liveBadgeState(feedState, barCurrentness) {
  if (feedState !== 'live') return feedState === 'reconnecting' ? 'reconnecting' : 'stale'
  if (barCurrentness == null || barCurrentness === 'current' || barCurrentness === 'no_expectation') return 'live'
  if (barCurrentness === 'delayed') return 'delayed'
  if (barCurrentness === 'unavailable') return 'unavailable'
  return 'updating'
}
