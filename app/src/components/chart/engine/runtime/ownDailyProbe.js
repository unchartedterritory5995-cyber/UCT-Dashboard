// app/src/components/chart/engine/runtime/ownDailyProbe.js
//
// ─── ⭐⭐ THE OWN-DAILY QUESTION, ANSWERED IN A WORKER (switch smoothness, 2026-11-20) ─────────────────
//
// The worker half of `ownDailyAsync.js`. `runtimeWorker.js` hands a message of kind `OWN_DAILY_ASK` here and
// posts back what this returns. ⛔ ONE COMPUTATION, NOT A SECOND: the answer is `runtimeReadsOwnDaily` itself,
// the function the chart's thread runs, on the same arguments (the source, the timeframe, the symbol as the run
// binds it, `runtimeColumns.js::runtimeOwnDailyQuestion`), so the two threads cannot disagree; railed in
// `ownDailyOffThread.rail.test.js` through the real worker module.
import { runtimeReadsOwnDaily } from './runtimeColumns.js'

/** The message kind a probe is asked with (every other message to `runtimeWorker.js` is a run). */
export const OWN_DAILY_ASK = 'own-daily'

/** The reply to one probe: `{id, kind, ownDaily}`. ⛔ A throw answers NEEDED, the predicate's own rule (a
 *  predicate that cannot answer never says no). */
export function ownDailyReplyOf(msg) {
  const m = msg || {}
  let yes = true
  try { yes = runtimeReadsOwnDaily(m.source, m.tf, m.symbol || null) === true } catch { yes = true }
  return { id: m.id, kind: OWN_DAILY_ASK, ownDaily: yes }
}
