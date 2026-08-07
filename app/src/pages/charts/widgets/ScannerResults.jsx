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

// The scanner keeps its OWN column layout, independent of the watchlist widgets
// (which share the global WL_COLS_LS key).
const SCANNER_COLS_KEY = `${WL_COLS_LS}.scanner`
// First-run defaults for the scanner: RVOL shown + the list sorted by RVOL desc.
// Applied only until the user edits columns (then their saved layout wins).
const SCANNER_DEFAULT_COLS = {
  order: ['flag', 'sym', 'price', 'vol', 'chg', 'rvol'],
  sort: { key: 'rvol', dir: 'desc' },
}

// One-time migration: anyone who opened the scanner BEFORE RVOL existed has a saved
// column layout (SCANNER_COLS_KEY) that predates it, so the RVOL default never
// applied. Seed RVOL into their order + apply the RVOL sort ONCE (idempotent via a
// flag), preserving any other saved column state. A later user change persists over
// it and the flag prevents re-adding. Runs at module load — before any scanner
// renders + reads its config.
const _RVOL_MIGRATION_FLAG = `${SCANNER_COLS_KEY}.rvol1`
try {
  if (typeof localStorage !== 'undefined' && !localStorage.getItem(_RVOL_MIGRATION_FLAG)) {
    let cfg = {}
    try { cfg = JSON.parse(localStorage.getItem(SCANNER_COLS_KEY)) || {} } catch { cfg = {} }
    if (!cfg || typeof cfg !== 'object') cfg = {}
    const order = Array.isArray(cfg.order) && cfg.order.length ? cfg.order : [...SCANNER_DEFAULT_COLS.order]
    const nextOrder = order.includes('rvol') ? order : [...order, 'rvol']
    localStorage.setItem(SCANNER_COLS_KEY, JSON.stringify({
      ...cfg, order: nextOrder, sort: cfg.sort || SCANNER_DEFAULT_COLS.sort,
    }))
    localStorage.setItem(_RVOL_MIGRATION_FLAG, '1')
  }
} catch { /* ignore */ }

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
  // Distinguish "still building the reference" from "genuinely no qualifiers".
  const scanEmptyText = !data
    ? 'Loading…'
    : data.status === 'computing'
      ? 'Building the 1-year volume baseline…'
      : 'No stocks at a 1-year volume high yet today.'

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
        colStorageKey={SCANNER_COLS_KEY}
        scanEmptyText={scanEmptyText}
        defaultColCfg={SCANNER_DEFAULT_COLS}
      />
    </ChartsSymContext.Provider>
  )
}
