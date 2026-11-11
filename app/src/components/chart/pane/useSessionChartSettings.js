import { useCallback, useRef, useState } from 'react'

// ⭐ A WRITE SINK FOR A CHART THAT HAS NO PERSISTENT HOME (owner ruling
// 2026-11-02, policy A: "changes to an individual chart should remain scoped to
// that chart unless the user explicitly requests a global change").
//
// Some charts render a fixed look through StockChart's `settingsOverride` and own
// no stored settings anywhere — a study exhibit, a review pane. Without a sink,
// StockChart writes every edit the override does not cover into the member's
// GLOBAL chart_settings (an indicator hidden on an exhibit vanished from every
// chart they own). This keeps the edit on THAT mounted chart for the session:
// the edited blob becomes the chart's override until `resetKey` changes (a new
// item), and nothing is written anywhere.
//
// Returns `{ settingsOverride, onSettingsPersist }` to spread onto StockChart.
// Both are identity-stable across renders with unchanged inputs (StockChart
// keys memos and effects off them).
export default function useSessionChartSettings(baseOverride, resetKey = null) {
  const [edit, setEdit] = useState(null)   // { key, settings }
  const keyRef = useRef(resetKey)
  keyRef.current = resetKey
  const own = edit && edit.key === resetKey ? edit.settings : null
  const onSettingsPersist = useCallback((next) => {
    setEdit(next && typeof next === 'object' ? { key: keyRef.current, settings: next } : null)
  }, [])
  return { settingsOverride: own || baseOverride, onSettingsPersist }
}
