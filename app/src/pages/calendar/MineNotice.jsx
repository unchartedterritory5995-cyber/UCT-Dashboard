// `CAL MINE` (wave 3 lane 13, product item #6): the line above the week that says the calendar is
// scoped to the member's own names, how that set is built, and the way back to everyone. The
// filter itself is the calendar's own `audience: 'mine'` (filterLogic.js) applied for this panel
// only -- the saved filter preference is never written.
import { MineEmpty, mineStyles } from '../../components/terminal/MineChip'
import { usePanelRerun } from '../../components/terminal/terminalPanel'
import { myNamesExplainer } from '../../hooks/useMyTickers'

export default function MineNotice({ view, shown, sources, loading }) {
  const rerun = usePanelRerun()
  const explainer = myNamesExplainer(sources)
  const showAll = rerun
    ? <button type="button" className={mineStyles.chip} onClick={() => rerun('CAL')} data-testid="cal-mine-all">Show everyone</button>
    : null
  if (view === 'wire' || view === 'month') {
    return (
      <div className={mineStyles.note} role="status" data-testid="cal-mine-view">
        <span className={mineStyles.noteTitle}>MINE narrows the Feed and Board views.</span>
        <span>Switch to Feed or Board to see only your names.</span>
      </div>
    )
  }
  if (loading) return <MineEmpty state="loading" testId="cal-mine-empty" />
  if (!shown) {
    return (
      <MineEmpty state="ready" what="reports this week" explainer={explainer} testId="cal-mine-empty">
        {showAll}
      </MineEmpty>
    )
  }
  return (
    <div className={mineStyles.row} role="status" data-testid="cal-mine-on" title={explainer}>
      <span>Only your names: {shown} reporting this week.</span>
      {showAll}
    </div>
  )
}
