import { useMemo, useCallback, useRef } from 'react'
import Watchlists from '../../Watchlists'
import WatchlistPicker from './WatchlistPicker'
import { ChartsSymContext } from '../ChartsSymContext'
import { useWorkspace } from '../WorkspaceContext'

export default function WatchlistWidget({ color, opts, onOptsChange }) {
  const { groupSyms, setGroupSym, activeWatchlistRef } = useWorkspace()
  // Stable id so this widget can claim "active" (owns arrow keys + its own scroll).
  const widgetIdRef = useRef(null)
  if (!widgetIdRef.current) widgetIdRef.current = `wl${Math.random().toString(36).slice(2, 9)}`
  // Scoped context: routes the wrapped Watchlists' useChartsSym calls
  // into THIS widget's color group, not Group A. setSym is a STABLE callback (not
  // re-created when groupSyms changes) so the memoized watchlist rows' select handler
  // stays stable across selection changes.
  const setSym = useCallback((s) => setGroupSym(color, s), [color, setGroupSym])
  const scopedSymContext = useMemo(() => ({
    sym: groupSyms[color],
    setSym,
  }), [groupSyms, color, setSym])

  const watchKey = opts?.watchKey || null
  const pick = useCallback((sel) => {
    onOptsChange?.({ ...(opts || {}), watchKey: sel?.key || null, watchName: sel?.name || null })
  }, [opts, onOptsChange])
  const exitPick = useCallback(() => {
    onOptsChange?.({ ...(opts || {}), watchKey: null, watchName: null })
  }, [opts, onOptsChange])

  // No list chosen yet (freshly added) → show the picker menu instead of the
  // full list view. Once a list is picked, the widget scopes to that single list.
  if (!watchKey) {
    return <WatchlistPicker onPick={pick} />
  }

  return (
    <ChartsSymContext.Provider value={scopedSymContext}>
      <Watchlists
        embedded
        pickList={watchKey}
        pickName={opts?.watchName || null}
        onExitPick={exitPick}
        activeRef={activeWatchlistRef}
        widgetKey={widgetIdRef.current}
      />
    </ChartsSymContext.Provider>
  )
}
