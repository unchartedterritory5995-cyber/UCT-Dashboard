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
import { WL_COLS_LS } from '../../watchlist/watchlistTemplates'
import { ChartsSymContext } from '../ChartsSymContext'
import { useWorkspace } from '../WorkspaceContext'

const fetcher = url => fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).catch(() => null)

// The scanner keeps its OWN column layouts, independent of the watchlist widgets
// (which share the global WL_COLS_LS key) AND independent PER SCAN — each preset
// remembers its own columns + sort, so e.g. the volume scans stay RVOL-sorted while
// the IPO scan stays newest-IPO-first.
const scanColsKey = (key) => `${WL_COLS_LS}.scanner.${key}`

// Per-scan first-run defaults (applied only until the user edits columns; then their
// saved layout wins). Volume scans lead with RVOL desc; the IPO scan has no RVOL-worthy
// ranking, so it leaves sort NULL — which preserves the backend's newest-IPO-first order.
const VOLUME_DEFAULT_COLS = {
  order: ['flag', 'sym', 'price', 'vol', 'chg', 'rvol'],
  sort: { key: 'rvol', dir: 'desc' },
}
const IPO_DEFAULT_COLS = {
  order: ['flag', 'sym', 'price', 'vol', 'chg', 'rvol'],
  sort: null,   // null → applyColSort preserves input order (server sorts newest IPO first)
}
const SCAN_DEFAULT_COLS = {
  'highest-volume-1y': VOLUME_DEFAULT_COLS,
  'highest-volume-ever': VOLUME_DEFAULT_COLS,
  'ipo-1y': IPO_DEFAULT_COLS,
}

// Per-scan empty-state copy: distinguishes "still building the reference" from
// "genuinely nothing qualifies yet".
const SCAN_EMPTY_TEXT = {
  'highest-volume-1y': { building: 'Building the volume baseline…', none: 'No stocks at a volume high yet today.' },
  'highest-volume-ever': { building: 'Building the volume baseline…', none: 'No stocks at an all-time volume high yet today.' },
  'ipo-1y': { building: 'Finding recent IPOs…', none: 'No recent IPOs trading yet today.' },
}

// scanKey → endpoint. New presets add a line here + one in ScannerPicker's PRESET_SCANS.
const SCAN_ENDPOINTS = {
  'highest-volume-1y': '/api/scans/highest-volume-1y',
  'highest-volume-ever': '/api/scans/highest-volume-ever',
  'ipo-1y': '/api/scans/ipo-1y',
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
  // Distinguish "still building the reference" from "genuinely no qualifiers".
  const emptyCopy = SCAN_EMPTY_TEXT[scanKey] || { building: 'Building…', none: 'No matches yet today.' }
  const scanEmptyText = !data
    ? 'Loading…'
    : data.status === 'computing'
      ? emptyCopy.building
      : emptyCopy.none
  // Per-scan column layout + defaults (each preset remembers its own columns/sort).
  const colStorageKey = scanColsKey(scanKey)
  const defaultColCfg = SCAN_DEFAULT_COLS[scanKey] || VOLUME_DEFAULT_COLS

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
        colStorageKey={colStorageKey}
        scanEmptyText={scanEmptyText}
        defaultColCfg={defaultColCfg}
      />
    </ChartsSymContext.Provider>
  )
}
