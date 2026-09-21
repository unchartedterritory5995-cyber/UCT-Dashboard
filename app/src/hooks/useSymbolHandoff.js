// ── ATOMIC SYMBOL HANDOFF ────────────────────────────────────────────────────
//
// ⛔⛔ THE DEFECT. Selecting B tore the canvas down before B's data existed, so
// every switch went A → BLACK → B. Measured on an idle machine: the teardown
// fires on 100% of switches, and the blank window is 16ms when B is already
// warm but 226ms for an hours-behind cache and 274ms cold — plainly visible.
//
// ⭐ THE FIX IS TO STOP SHOWING StockChart A SYMBOL IT CANNOT YET DRAW. If the
// chart keeps rendering A until B is ready, its own teardown never fires
// mid-switch, A stays coherent, and B arrives already paintable. No second
// chart, no snapshot, no overlay — one chart, shown one coherent symbol at a
// time.
//
//   A identity + A chart  →  prepare B off the visible path  →  atomic commit
//                         →  B identity + B current-enough chart
//
// ⛔ THERE IS STILL EXACTLY ONE SYMBOL AUTHORITY. The colour group remains the
// only writable symbol state; `displayedSym` is a RENDER LAG derived from it,
// never persisted, never written back, and it always converges on the request.
// Nothing reads it to decide what to fetch or what to save — it decides only
// what is on screen this frame.
//
// ⚠️ MIXED IDENTITY IS THE FAILURE MODE THIS EXISTS TO PREVENT, so the lag
// covers the WHOLE identity surface (header, company, quote, dock, holdings,
// legend) by being applied at the ChartWidget boundary — above every consumer —
// rather than inside the chart where half of them live outside its tree.

import { useEffect, useRef, useState } from 'react'
import { memPeek } from '../utils/barsMemCache'
import { idbGet } from '../utils/barsIDB'
import { prefetchBarsToIDB } from '../utils/prefetchBars'
import { isCurrentEnoughForPaint } from '../utils/marketSession'
import { isNativeTf, fetchTf } from '../components/chart/timeframes'

const INTRADAY = new Set(['1', '5', '15', '30', '60'])

/** Is a bar series current enough to become the FIRST VISIBLE FRAME for (tf)?
 *  Daily and non-native codes are always eligible — the frontier arithmetic is
 *  intraday bucket maths, and a custom tf resolves through its native base. */
function seriesDisplayable(bars, tf) {
  if (!bars?.length) return false
  if (!INTRADAY.has(String(tf))) return true
  const lastT = bars[bars.length - 1]?.t
  if (typeof lastT !== 'number') return false
  return isCurrentEnoughForPaint(lastT, tf)
}

/** SYNCHRONOUS readiness — the fast path. A neighbour the warmer already
 *  promoted to the mem cache commits in the SAME tick, so a warm switch pays
 *  nothing for this coordinator (measured ~19ms TC, and that must not move). */
export function peekDisplayable(sym, tf) {
  if (!sym || !tf) return false
  // Anything the handoff does not govern is displayable by definition.
  if (!isNativeTf(tf) || !INTRADAY.has(String(tf))) return true
  return seriesDisplayable(memPeek(sym, tf), tf)
}

/**
 * Returns the symbol the chart should actually DISPLAY.
 *
 * Commits `requestedSym` the instant current-enough data for it exists; until
 * then it keeps returning the previous symbol so the visible chart stays whole.
 *
 * @param requestedSym the colour group's symbol — the one authority
 * @param tf           the timeframe the chart is showing
 * @param enabled      false → pass the request straight through (no lag at all)
 */
export default function useSymbolHandoff(requestedSym, tf, { enabled = true } = {}) {
  // Seed with the request so a FIRST mount never lags — there is no previous
  // chart to protect, and lagging here would be a blank chart on page load.
  const [displayedSym, setDisplayedSym] = useState(requestedSym)

  // ⛔ LATEST REQUEST WINS, AND A CANCELLED PREPARE MUST NEVER LATE-COMMIT.
  // Scanning A→B→C→D outruns any single prepare, so every async resolution is
  // checked against the generation that started it. Without this, B's slow IDB
  // read could land after D was requested and commit B over D — a wrong-symbol
  // frame, which is the exact class the whole handoff exists to prevent.
  const genRef = useRef(0)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!enabled || !requestedSym || !tf) { setDisplayedSym(requestedSym); return undefined }
    if (requestedSym === displayedSym) return undefined

    const gen = ++genRef.current
    const commit = () => { if (genRef.current === gen) setDisplayedSym(requestedSym) }

    // FAST PATH — synchronous, same tick, no scheduling latency added.
    // ⛔ THE SYNCHRONOUS setState IS THE POINT, NOT AN OVERSIGHT. A neighbour the
    // warmer already promoted to mem is displayable RIGHT NOW; deferring its
    // commit to a later tick would convert the measured ~19ms warm switch into a
    // scheduling round-trip, which is precisely the regression this coordinator
    // must not cause. One extra render on a switch the member asked for is the
    // cheap half of that trade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (peekDisplayable(requestedSym, tf)) { commit(); return undefined }

    // ⛔ INTRADAY ONLY, AND THAT IS A SCOPE DECISION NOT AN OVERSIGHT.
    //   • D/W/M: the defect is intraday (the frontier maths is bucket
    //     arithmetic over a session), daily already paints from the pack, and
    //     "do not regress global daily chart speed" is an explicit constraint.
    //     A cold daily switch must not start waiting on this coordinator.
    //   • Custom codes (2m, 45m…): the separately-deferred architecture fetches
    //     its own base and this coordinator has no view of it.
    // Both pass straight through, byte-for-byte as before.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isNativeTf(tf) || !INTRADAY.has(String(tf))) { commit(); return undefined }

    let alive = true
    // PREPARE. `prefetchBarsToIDB` is the canonical warm door and now performs
    // the `since=` repair for a behind cache, so this reuses the bounded,
    // idle-deferred, backpressure-guarded, cooldown-gated queue rather than
    // inventing a second fetch path.
    prefetchBarsToIDB([requestedSym], fetchTf(tf), { priority: true, immediate: true })

    // Poll the cache rather than threading a callback through the warm queue:
    // the queue is shared by many callers and giving it per-job subscribers
    // would be a second coordination system. A short interval is cheap (a mem
    // lookup, then one IDB read) and stops the moment it commits.
    let timer = null
    const tick = async () => {
      if (!alive || genRef.current !== gen) return
      if (peekDisplayable(requestedSym, tf)) { commit(); return }
      try {
        const entry = await idbGet(requestedSym, tf)
        if (!alive || genRef.current !== gen) return
        if (seriesDisplayable(entry?.bars, tf)) { commit(); return }
      } catch { /* best-effort; the deadline below still commits */ }
      if (alive && genRef.current === gen) timer = setTimeout(tick, POLL_MS)
    }
    tick()

    // ⛔⛔ A DEADLINE, NOT AN OPEN-ENDED WAIT. If B never becomes current-enough
    // — a dead ticker, a shedding server, an illiquid name with no recent print
    // — holding A on screen forever under A's identity would be a WORSE bug than
    // the blank frame: the member clicked B and the product silently refused.
    // At the deadline we commit B regardless and let StockChart show its own
    // loading state, which is honest about what is happening.
    const deadline = setTimeout(commit, HANDOFF_DEADLINE_MS)

    return () => { alive = false; if (timer) clearTimeout(timer); clearTimeout(deadline) }
    // ⚠️ `displayedSym` IS A DEPENDENCY, NOT A REF READ DURING RENDER. Reading a
    // ref while rendering is unsafe under concurrent rendering (and the lint rule
    // says so). Depending on it re-runs this effect exactly once after a commit,
    // where the first guard immediately returns — so the extra pass costs one
    // comparison and correctly tears down the finished prepare.
  }, [requestedSym, tf, enabled, displayedSym])

  return displayedSym
}

// Fast enough that a repair landing between ticks is not perceptible, slow
// enough that a long prepare costs a handful of cache reads, not hundreds.
const POLL_MS = 25
// Above the measured cold p95 (~410ms) so a genuinely cold symbol still commits
// through the prepared path, but well inside the point where a member decides
// the click was ignored.
const HANDOFF_DEADLINE_MS = 600
