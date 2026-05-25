import { useMemo } from 'react'
import Screener from '../../Screener'
import { ChartsSymContext } from '../ChartsSymContext'
import { useWorkspace } from '../WorkspaceContext'

export default function ScannerWidget({ color, opts }) {
  const { groupSyms, setGroupSym } = useWorkspace()
  // Scoped context: routes any wrapped useChartsSym calls into THIS
  // widget's color group, not Group A. (Screener itself doesn't currently
  // call useChartsSym, but its CustomScan sub-tab does via StockChart,
  // so this future-proofs the widget for chart-on-right behavior.)
  const scopedSymContext = useMemo(() => ({
    sym: groupSyms[color],
    setSym: (s) => setGroupSym(color, s),
  }), [groupSyms, color, setGroupSym])

  return (
    <ChartsSymContext.Provider value={scopedSymContext}>
      <Screener embedded />
    </ChartsSymContext.Provider>
  )
}
