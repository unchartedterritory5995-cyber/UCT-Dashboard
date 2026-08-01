import { useMemo, useCallback, useRef } from 'react'
import Watchlists from '../../Watchlists'
import WatchlistPicker from './WatchlistPicker'
import { ChartsSymContext } from '../ChartsSymContext'
import { useWorkspace } from '../WorkspaceContext'
import { applyTemplateColumns } from '../../watchlist/watchlistTemplates'

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
    // Creating a list from a saved look Template seeds the widget's appearance
    // (opts.settings) and applies its column layout (shared localStorage config).
    if (sel?.cols) applyTemplateColumns(sel.cols)
    const next = { ...(opts || {}), watchKey: sel?.key || null, watchName: sel?.name || null }
    if (sel?.settings) next.settings = sel.settings
    onOptsChange?.(next)
  }, [opts, onOptsChange])
  const exitPick = useCallback(() => {
    onOptsChange?.({ ...(opts || {}), watchKey: null, watchName: null })
  }, [opts, onOptsChange])

  // Per-widget appearance settings: this widget's own blob (null = inherit the
  // global default until edited). Persisting writes it into THIS widget's opts,
  // so changing one watchlist's canvas/colors never touches another.
  const wlSettingsOverride = opts?.settings || null
  const persistWlSettings = useCallback((next) => {
    onOptsChange?.({ ...(opts || {}), settings: next })
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
        settingsOverride={wlSettingsOverride}
        onSettingsPersist={persistWlSettings}
      />
    </ChartsSymContext.Provider>
  )
}
