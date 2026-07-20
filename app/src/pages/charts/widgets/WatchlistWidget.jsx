import { useMemo, useCallback } from 'react'
import Watchlists from '../../Watchlists'
import WatchlistPicker from './WatchlistPicker'
import { ChartsSymContext } from '../ChartsSymContext'
import { useWorkspace } from '../WorkspaceContext'

export default function WatchlistWidget({ color, opts, onOptsChange }) {
  const { groupSyms, setGroupSym } = useWorkspace()
  // Scoped context: routes the wrapped Watchlists' useChartsSym calls
  // into THIS widget's color group, not Group A.
  const scopedSymContext = useMemo(() => ({
    sym: groupSyms[color],
    setSym: (s) => setGroupSym(color, s),
  }), [groupSyms, color, setGroupSym])

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
      />
    </ChartsSymContext.Provider>
  )
}
