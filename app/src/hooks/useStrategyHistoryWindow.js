import { useEffect, useState } from 'react'
import { loadStrategyHistoryWindow, strategyHistoryWindowNow } from '../components/chart/engine/strategyWindow'

// W9-T11-F1 — the strategy window a chart hands its broker runs (`ctx.historyWindowBars`), from the
// server (`strategyWindow.js`). null with the broker gate off (nothing is fetched) or until the
// server answers; a chart strategy run with no window refuses `runtime:strategy-start` by name.
// Once set it never changes for the tab, so a chart load's window is fixed.
export default function useStrategyHistoryWindow() {
  const [win, setWin] = useState(strategyHistoryWindowNow)
  useEffect(() => {
    if (win !== null) return undefined
    let live = true
    loadStrategyHistoryWindow().then((w) => { if (live && w !== null) setWin(w) })
    return () => { live = false }
  }, [win])
  return win
}
