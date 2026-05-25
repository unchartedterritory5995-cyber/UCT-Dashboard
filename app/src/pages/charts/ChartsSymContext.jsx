import { createContext, useContext } from 'react'
import { useWorkspace } from './WorkspaceContext'

// V1 context kept for explicit per-widget overrides (e.g., WatchlistWidget
// passes its own provider so the wrapped Watchlists publishes into the
// widget's chosen color group, not Group A).
export const ChartsSymContext = createContext(null)

/**
 * V1-compatible hook. Resolution order:
 *   1) Explicit ChartsSymContext.Provider (per-widget scoping)
 *   2) WorkspaceContext Group A (V1 callers like Watchlists/ThemeTrackerPage
 *      adapters that haven't been migrated to color-group-aware widgets)
 *   3) Null-safe fallback ({ sym: null, setSym: () => {} })
 */
export function useChartsSym() {
  const explicit = useContext(ChartsSymContext)
  const workspace = useWorkspace()
  if (explicit) return explicit
  return {
    sym: workspace.groupSyms.A,
    setSym: (s) => workspace.setGroupSym('A', s),
  }
}
