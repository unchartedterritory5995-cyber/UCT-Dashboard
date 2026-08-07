// Results view for a selected preset scan. Fetches the scan's qualifying symbols
// (live, all day) and renders them through the REAL watchlist table in read-only
// "scan" mode — so the list behaves exactly like the watchlist widget (all 18
// columns, drag-to-resize gridlines, right-click column menu, sort, flag-star,
// live prices, per-widget appearance) EXCEPT you can't add/remove/reorder symbols
// (membership comes from the scan). Clicking a row publishes the ticker to this
// widget's color group so a paired chart follows.
import { useMemo, useCallback, useId } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import Watchlists from '../../Watchlists'
import { ChartsSymContext } from '../ChartsSymContext'
import { useWorkspace } from '../WorkspaceContext'

const fetcher = url => fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).catch(() => null)

// scanKey → endpoint. New presets add a line here + one in ScannerPicker's PRESET_SCANS.
const SCAN_ENDPOINTS = {
  'highest-volume-1y': '/api/scans/highest-volume-1y',
}

export default function ScannerResults({ scanKey, scanName, color, settingsOverride = null, onSettingsPersist = null, onExit }) {
  const { groupSyms, setGroupSym } = useWorkspace() || {}
  // Stable per-instance key for the wrapped watchlist table (arrow-nav / active id).
  const widgetId = useId()

  // Scoped sym context: a row click / selection routes into THIS widget's color
  // group (not Group A), so a paired chart follows — same wiring as WatchlistWidget.
  const setSym = useCallback((s) => { if (color) setGroupSym?.(color, s) }, [color, setGroupSym])
  const scopedSymContext = useMemo(
    () => ({ sym: color ? groupSyms?.[color] : null, setSym }),
    [groupSyms, color, setSym],
  )

  const url = SCAN_ENDPOINTS[scanKey] || null
  // Live all day: poll every 30s (the server recomputes at most ~once/min).
  const { data } = useMobileSWR(url, fetcher, {
    refreshInterval: 30_000,
    dedupingInterval: 15_000,
    revalidateOnFocus: false,
  })
  // Stable symbol array keyed by CONTENT, so an identical 30s poll doesn't rebuild
  // the whole table (the scan endpoint returns a fresh object each poll).
  const symKey = (data?.results || []).map(r => r.sym).join(',')
  const symbols = useMemo(() => (symKey ? symKey.split(',') : []), [symKey])

  return (
    <ChartsSymContext.Provider value={scopedSymContext}>
      <Watchlists
        embedded
        pickList="__scan__"
        scanSymbols={symbols}
        pickName={scanName || 'Scan'}
        backLabel="‹ Scanners"
        onExitPick={onExit}
        settingsOverride={settingsOverride}
        onSettingsPersist={onSettingsPersist}
        widgetKey={widgetId}
      />
    </ChartsSymContext.Provider>
  )
}
