import { useMemo, useRef } from 'react'
import ThemeTrackerPage from '../../ThemeTrackerPage'
import { ChartsSymContext } from '../ChartsSymContext'
import { useWorkspace } from '../WorkspaceContext'

export default function ThemesWidget({ color, opts }) {
  const { groupSyms, setGroupSym, activeWatchlistRef } = useWorkspace()
  // Scoped context: routes the wrapped ThemeTrackerPage's useChartsSym calls
  // into THIS widget's color group, not Group A.
  const scopedSymContext = useMemo(() => ({
    sym: groupSyms[color],
    setSym: (s) => setGroupSym(color, s),
  }), [groupSyms, color, setGroupSym])

  // Share the SAME active-nav ref the Watchlist widgets use, so clicking into a
  // theme tracker locks arrow-key scanning here (and out of the watchlist) — and
  // vice versa. Stable per-widget key.
  const widgetIdRef = useRef(null)
  if (!widgetIdRef.current) widgetIdRef.current = `th${Math.random().toString(36).slice(2, 9)}`

  return (
    <ChartsSymContext.Provider value={scopedSymContext}>
      <ThemeTrackerPage embedded activeRef={activeWatchlistRef} widgetKey={widgetIdRef.current} />
    </ChartsSymContext.Provider>
  )
}
