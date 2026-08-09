import { useMemo, useCallback, useId } from 'react'
import Watchlists from '../../Watchlists'
import WatchlistPicker from './WatchlistPicker'
import { ChartsSymContext } from '../ChartsSymContext'
import { useWorkspace } from '../WorkspaceContext'

// Default column layout for a prebuilt (curated UCT) list. Prebuilt lists ALWAYS open in
// their default columns and NEVER persist edits (ephemeralCols) — a curated list is a fixed
// view, so any in-session column change is discarded when you leave and reopen it. Per-list
// overrides here; everything else falls back to PREBUILT_COL_FALLBACK.
const PREBUILT_COL_DEFAULTS = {}
const PREBUILT_COL_FALLBACK = { order: ['flag', 'sym', 'chg', 'price', 'dolvol'] }

export default function WatchlistWidget({ color, opts, onOptsChange }) {
  const { groupSyms, setGroupSym, activeWatchlistRef } = useWorkspace()
  // Stable id so this widget can claim "active" (owns arrow keys + its own scroll).
  const widgetId = useId()
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
    // (opts.settings) only — a template never controls the column layout. `watchTab` is
    // the picker tab it came from, so leaving reopens on it + we know if it's prebuilt.
    const next = { ...(opts || {}), watchKey: sel?.key || null, watchName: sel?.name || null, watchTab: sel?.tab || null }
    if (sel?.settings) next.settings = sel.settings
    onOptsChange?.(next)
  }, [opts, onOptsChange])
  const exitPick = useCallback(() => {
    // Keep watchTab so the picker reopens on the section the user was in.
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
    return (
      <WatchlistPicker
        onPick={pick}
        settingsOverride={wlSettingsOverride}
        onSettingsPersist={persistWlSettings}
        initialTab={opts?.watchTab || null}
      />
    )
  }

  // A PREBUILT list (picked from the Prebuilt tab) always opens in its default columns and
  // discards any in-session column edits (ephemeralCols). My Lists / community persist as
  // normal (ephemeralCols=false, global column storage).
  const _isPrebuilt = opts?.watchTab === 'prebuilt'
  const _prebuiltCfg = _isPrebuilt
    ? (PREBUILT_COL_DEFAULTS[opts?.watchName || ''] || PREBUILT_COL_FALLBACK)
    : null
  return (
    <ChartsSymContext.Provider value={scopedSymContext}>
      <Watchlists
        embedded
        pickList={watchKey}
        pickName={opts?.watchName || null}
        onExitPick={exitPick}
        activeRef={activeWatchlistRef}
        widgetKey={widgetId}
        settingsOverride={wlSettingsOverride}
        onSettingsPersist={persistWlSettings}
        defaultColCfg={_prebuiltCfg}
        ephemeralCols={_isPrebuilt}
      />
    </ChartsSymContext.Provider>
  )
}
