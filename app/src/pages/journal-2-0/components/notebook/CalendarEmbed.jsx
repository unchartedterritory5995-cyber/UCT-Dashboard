import { useMemo } from 'react'
import { WorkspaceContext } from '../../../charts/WorkspaceContext'
import CalendarWidget from '../../../charts/widgets/CalendarWidget'
import { frozenWorkspaceValue } from './frozenWorkspace'

/**
 * The calendar's journal-embed renderer: the REAL CalendarWidget (one
 * component, two hosts) mounted under the frozen workspace context with the
 * captured day restored. The calendar endpoints are date-parameterized and
 * backfilled, so a March capture re-renders March's calendar LIVE — actuals
 * filled in, exactly the frozen-evidence contract charts already have.
 *
 * - opts carries ONLY what the widget restores (date seam, econStars,
 *   settings); onOptsChange is null so nothing inside the embed can persist
 *   a change (read-only invariant — day navigation inside the embed is
 *   view-only drift, gone on reload).
 * - journalDoor={false}: an embed offering "send to journal" is circular.
 * - Known fidelity residuals (P2 audit): section sort/show-all and the
 *   selected ticker aren't restored, and market-cap ordering uses live caps.
 */
export default function CalendarEmbed({ attrs, height = 320 }) {
  const params = attrs?.params || {}
  const value = useMemo(
    () => frozenWorkspaceValue({ symbol: params.selectedSym || null }),
    [params.selectedSym],
  )
  const opts = useMemo(() => ({
    date: params.date,
    ...(Number.isFinite(params.econStars) ? { econStars: params.econStars } : {}),
    settings: params.settings || null,
  }), [params.date, params.econStars, params.settings])
  return (
    <div style={{ height, overflow: 'hidden' }}>
      <WorkspaceContext.Provider value={value}>
        <CalendarWidget color="A" opts={opts} onOptsChange={null} journalDoor={false} />
      </WorkspaceContext.Provider>
    </div>
  )
}
