import { useMemo } from 'react'
import ThemeTrackerPage from '../../ThemeTrackerPage'
import { ChartsSymContext } from '../ChartsSymContext'
import { useWorkspace } from '../WorkspaceContext'

export default function ThemesWidget({ color, opts }) {
  const { groupSyms, setGroupSym } = useWorkspace()
  // Scoped context: routes the wrapped ThemeTrackerPage's useChartsSym calls
  // into THIS widget's color group, not Group A.
  const scopedSymContext = useMemo(() => ({
    sym: groupSyms[color],
    setSym: (s) => setGroupSym(color, s),
  }), [groupSyms, color, setGroupSym])

  return (
    <ChartsSymContext.Provider value={scopedSymContext}>
      <ThemeTrackerPage embedded />
    </ChartsSymContext.Provider>
  )
}
