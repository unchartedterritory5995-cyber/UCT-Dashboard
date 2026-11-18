// app/src/components/chart/engine/useRuntimeLists.js
//
// ─── THE CHART'S HALF OF THE RUNTIME LISTS (kill, allow, capability admission, run-half evidence) ──
//
// ⭐⭐ THE SIBLING OF `useServerColumns`, AND DELIBERATELY THE SAME SHAPE. The runtime lane's gates
// (`runtimeKill.js::runtimeNotGradedOf` / `runtimeKillOf`) answer SYNCHRONOUSLY from lists that are
// read over the network, so somebody has to say "they landed, ask again".
//
// ⚰️ MEASURED ON PRODUCTION 2026-11-17 (engine 68): only the member door (`MemberPane`) ever read the
// lists. A chart opened without it — a reload, or RS Rating added from "Your indicators" — never read
// them, so the allowlist stayed empty and RS Rating's rating label and new-high / new-low dots were
// refused `pane:not-graded` for a script the server had graded; and nothing told the chart when a
// read DID land. This hook starts the first read when a chart mounts (only for a member the runtime
// pane is on for: the lists are that lane's and nobody else needs the request) and returns a number
// that changes when they — or a capability verdict — latch.
//
// ⛔ A GENERATION COUNTER, NOT THE DATA: the gates keep reading the latch themselves.
import { useEffect, useState } from 'react'
import { ensureRuntimeListsRead, subscribeRuntimeLists } from './runtimeKill'
import { runtimePaneEnabled } from './runtimePaneGate'

/**
 * A number that changes when the runtime lists (or a capability verdict) latch.
 *
 * Feed it to the dependency array that drives the chart's repaint, beside `serverColumnsGeneration`.
 *
 * @returns {number} monotonically increasing; only the change means anything.
 */
export function useRuntimeLists() {
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    // ⛔ `alive` guards the teardown window, as in `useServerColumns`
    let alive = true
    const unsub = subscribeRuntimeLists(() => { if (alive) setGeneration((n) => n + 1) })
    if (runtimePaneEnabled()) ensureRuntimeListsRead()
    return () => { alive = false; unsub() }
  }, [])
  return generation
}

export default useRuntimeLists
