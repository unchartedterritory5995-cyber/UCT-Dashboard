import { useEffect, useState } from 'react'
import { strategyBrokerEnabled } from '../components/chart/engine/strategyBrokerGate'
import { loadStrategyHistoryWindow, strategyHistoryWindowNow } from '../components/chart/engine/strategyWindow'

// W9-T11-F1 — the strategy window a chart hands its broker runs (`ctx.historyWindowBars`), from the
// server (`strategyWindow.js`).
//   · `enabled`: the chart holds a strategy document (r1, review N1). False → nothing is asked.
//   · `bars`: the window, or null (gate off, not asked, not landed, or the ask failed).
//   · `pending` (r1, N3): asked and not answered yet. The binder holds a strategy run back while it is
//     true, so first paint shows no `runtime:strategy-start` refusal; once the ask has FAILED it is
//     false with no window, and the run refuses by name.
// Once set the window never changes for the tab, so a chart load's window is fixed.
export default function useStrategyHistoryWindow(enabled) {
  const [state, setState] = useState(() => {
    const now = strategyHistoryWindowNow()
    return { bars: now, done: now !== null }
  })
  const asking = !!enabled && strategyBrokerEnabled()
  useEffect(() => {
    if (!asking || state.done) return undefined
    let live = true
    loadStrategyHistoryWindow().then((w) => { if (live) setState({ bars: w, done: true }) })
    return () => { live = false }
  }, [asking, state.done])
  return { bars: asking ? state.bars : null, pending: asking && !state.done }
}
