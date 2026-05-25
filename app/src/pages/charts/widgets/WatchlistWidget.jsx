import { useMemo } from 'react'
import Watchlists from '../../Watchlists'
import { ChartsSymContext } from '../ChartsSymContext'
import { useWorkspace } from '../WorkspaceContext'

export default function WatchlistWidget({ color, opts }) {
  const { groupSyms, setGroupSym } = useWorkspace()
  // Scoped context: routes the wrapped Watchlists' useChartsSym calls
  // into THIS widget's color group, not Group A.
  const scopedSymContext = useMemo(() => ({
    sym: groupSyms[color],
    setSym: (s) => setGroupSym(color, s),
  }), [groupSyms, color, setGroupSym])

  return (
    <ChartsSymContext.Provider value={scopedSymContext}>
      <Watchlists embedded />
    </ChartsSymContext.Provider>
  )
}
