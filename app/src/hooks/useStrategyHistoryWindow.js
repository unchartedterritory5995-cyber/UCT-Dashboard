import { useEffect, useState } from 'react'
import { strategyBrokerEnabled } from '../components/chart/engine/strategyBrokerGate'
import {
  FAILURE_RETRY_MS, loadStrategyHistoryWindow, strategyHistoryWindowNow,
} from '../components/chart/engine/strategyWindow'

// W9-T11-F1 — the strategy window a chart hands its broker runs (`ctx.historyWindowBars`), from the
// server (`strategyWindow.js`).
//   · `enabled`: the chart holds a strategy document (r1, review N1). False → nothing is asked.
//   · `bars`: the window, or null (gate off, not asked, not landed, or the ask failed).
//   · `pending` (r1, N3): asked and not answered yet. The binder holds a strategy run back while it is
//     true, so first paint shows no `runtime:strategy-start` refusal; once the ask has FAILED (an
//     error, a 401, or no answer within `REQUEST_TIMEOUT_MS`, r2 N5) it is false with no window, and the
//     run refuses by name.
//   · r2 (N6): after a failure a MOUNTED chart asks again once the failure period is over, and again
//     after each further failure, with no reload. A retry is quiet: `pending` stays false, so the named
//     refusal stays on screen until a window lands, and never flickers to an empty pane.
// Once set the window never changes for the tab, so a chart load's window is fixed.
export default function useStrategyHistoryWindow(enabled) {
  const [state, setState] = useState(() => {
    const now = strategyHistoryWindowNow()
    return { bars: now, done: now !== null, tries: 0 }
  })
  const asking = !!enabled && strategyBrokerEnabled()
  useEffect(() => {
    if (!asking || (state.done && state.bars !== null)) return undefined
    let live = true
    const ask = () => loadStrategyHistoryWindow().then((w) => {
      if (live) setState((s) => ({ bars: w, done: true, tries: s.tries + 1 }))
    })
    if (!state.done) {
      ask()
      return () => { live = false }
    }
    // failed: ask again when the failure period is over
    const t = setTimeout(ask, FAILURE_RETRY_MS)
    return () => { live = false; clearTimeout(t) }
  }, [asking, state.done, state.bars, state.tries])
  return { bars: asking ? state.bars : null, pending: asking && !state.done }
}
