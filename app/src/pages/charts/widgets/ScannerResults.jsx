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
import UIcon from '../../../components/ui/UIcon'
import { WL_COLS_LS } from '../../watchlist/watchlistTemplates'
import { ChartsSymContext } from '../ChartsSymContext'
import { useWorkspace } from '../WorkspaceContext'
import styles from './ScannerResults.module.css'

const fetcher = url => fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).catch(() => null)

// Backend `as_of` (ISO, ET-clock offset) → "1:26 PM" in market (ET) time.
function fmtScanTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString('en-US',
      { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
  } catch { return '' }
}

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
  order: ['flag', 'sym', 'price', 'vol', 'chg', 'ipoDate'],
  sort: { key: 'ipoDate', dir: 'desc' },   // most recent IPO first
}
// Top-Gainers scans show + sort by the matching N-day change column so the biggest
// gainer leads the list by default (until the user re-sorts).
const gainersDefaultCols = (perfKey) => ({
  order: ['flag', 'sym', 'price', 'chg', perfKey],
  sort: { key: perfKey, dir: 'desc' },
})
const SCAN_DEFAULT_COLS = {
  'highest-volume-1y': VOLUME_DEFAULT_COLS,
  'highest-volume-ever': VOLUME_DEFAULT_COLS,
  'ipo-1y': IPO_DEFAULT_COLS,
  'top-gainers-30d': gainersDefaultCols('perf30d'),
  'top-gainers-60d': gainersDefaultCols('perf60d'),
  'top-gainers-90d': gainersDefaultCols('perf90d'),
}
// Gainers scanKey → the perfData period its server-computed N-day return maps to.
const GAINERS_PERIOD = {
  'top-gainers-30d': '30d',
  'top-gainers-60d': '60d',
  'top-gainers-90d': '90d',
}

// One-time migration: the IPO scan's default column changed from RVOL to IPO Date
// (sorted newest-first). Anyone who opened the IPO scan under the old default has a
// saved ipo-1y config carrying rvol; swap rvol→ipoDate and apply the IPO-date sort
// ONCE (idempotent via a flag), preserving any other saved column state. Runs at
// module load, before any scanner reads its config.
const _IPO_COLS_KEY = scanColsKey('ipo-1y')
const _IPO_DATE_MIGRATION_FLAG = `${_IPO_COLS_KEY}.ipodate1`
try {
  if (typeof localStorage !== 'undefined' && !localStorage.getItem(_IPO_DATE_MIGRATION_FLAG)) {
    const raw = localStorage.getItem(_IPO_COLS_KEY)
    if (raw) {
      let cfg = {}
      try { cfg = JSON.parse(raw) || {} } catch { cfg = {} }
      if (cfg && typeof cfg === 'object' && Array.isArray(cfg.order)) {
        const order = cfg.order.map(k => (k === 'rvol' ? 'ipoDate' : k))
        if (!order.includes('ipoDate')) order.push('ipoDate')
        localStorage.setItem(_IPO_COLS_KEY, JSON.stringify({
          ...cfg, order, sort: { key: 'ipoDate', dir: 'desc' },
        }))
      }
    }
    localStorage.setItem(_IPO_DATE_MIGRATION_FLAG, '1')
  }
} catch { /* ignore */ }

// Per-scan empty-state copy: distinguishes "still building the reference" from
// "genuinely nothing qualifies yet".
const SCAN_EMPTY_TEXT = {
  'highest-volume-1y': { building: 'Building the volume baseline…', none: 'No stocks at a volume high yet today.' },
  'highest-volume-ever': { building: 'Building the volume baseline…', none: 'No stocks at an all-time volume high yet today.' },
  'ipo-1y': { building: 'Finding recent IPOs…', none: 'No recent IPOs trading yet today.' },
  'top-gainers-30d': { building: 'Ranking 30-day gainers…', none: 'No gainers to rank yet.' },
  'top-gainers-60d': { building: 'Ranking 60-day gainers…', none: 'No gainers to rank yet.' },
  'top-gainers-90d': { building: 'Ranking 90-day gainers…', none: 'No gainers to rank yet.' },
}

// Per-scan criteria — the read-only list shown in the ⓘ/filter popover, so a user can see
// at a glance what a preset actually screens for.
const SCAN_FLOORS = ['Price Above $1', 'Over $1M Average Daily Dollar Volume']
const SCAN_CRITERIA = {
  'highest-volume-1y': ['Highest Daily Volume In The Last 1-Year', 'US Common Stock', ...SCAN_FLOORS],
  'highest-volume-ever': ['Highest Daily Volume Ever', 'US Common Stock', ...SCAN_FLOORS],
  'ipo-1y': ['Listed Within The Last 1-Year', 'US Common Stock', ...SCAN_FLOORS],
  'top-gainers-30d': ['Top 5% By Percent Change In 30 Trading Days', 'US Common Stock', ...SCAN_FLOORS],
  'top-gainers-60d': ['Top 5% By Percent Change In 60 Trading Days', 'US Common Stock', ...SCAN_FLOORS],
  'top-gainers-90d': ['Top 5% By Percent Change In 90 Trading Days', 'US Common Stock', ...SCAN_FLOORS],
}

// scanKey → endpoint. New presets add a line here + one in ScannerPicker's PRESET_SCANS.
const SCAN_ENDPOINTS = {
  'highest-volume-1y': '/api/scans/highest-volume-1y',
  'highest-volume-ever': '/api/scans/highest-volume-ever',
  'ipo-1y': '/api/scans/ipo-1y',
  'top-gainers-30d': '/api/scans/top-gainers-30d',
  'top-gainers-60d': '/api/scans/top-gainers-60d',
  'top-gainers-90d': '/api/scans/top-gainers-90d',
}

import useLivePrices from '../../../hooks/useLivePrices'

export default function ScannerResults({ scanKey, scanName, color, settingsOverride = null, onSettingsPersist = null, onExit }) {
  const { groupSyms, setGroupSym, activeWatchlistRef } = useWorkspace() || {}
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
  const { data, mutate, isValidating } = useMobileSWR(url, fetcher, {
    refreshInterval: 30_000,
    dedupingInterval: 15_000,
    revalidateOnFocus: false,
  })
  // Stable symbol array keyed by CONTENT, so an identical 30s poll doesn't rebuild
  // the whole table (the scan endpoint returns a fresh object each poll).
  const symKey = (data?.results || []).map(r => r.sym).join(',')
  const symbols = useMemo(() => (symKey ? symKey.split(',') : []), [symKey])
  // Door state: prices ride the SHARED polling store (the wrapped table
  // already polls these symbols — same slice, no extra request).
  const { prices: doorPrices } = useLivePrices(symbols)
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

  // Per-symbol fields the scan itself supplies (the IPO scan returns ipo_date for EVERY
  // result, past the meta batch's 100-ticker cap) — merged over the meta batch in the
  // table so the IPO Date column + its sort see every row. Keyed by content so a 30s
  // poll returning the same rows doesn't rebuild it.
  const metaOverride = useMemo(() => {
    const rows = data?.results || []
    let out = null
    for (const r of rows) {
      if (r && r.ipo_date != null) (out ||= {})[r.sym] = { ipo_date: r.ipo_date }
    }
    return out
  }, [data])

  // Gainers scans compute the N-day return + its reference close server-side for EVERY
  // result. Feed those into the table's perf data so the 30/60/90-Day column shows a
  // value for the WHOLE list (the /api/watchlist-performance batch caps at 100 + can
  // time out) and stays live via the ref close vs the streaming price.
  const perfOverride = useMemo(() => {
    const period = GAINERS_PERIOD[scanKey]
    if (!period) return null
    const rows = data?.results || []
    let out = null
    for (const r of rows) {
      if (!r) continue
      const entry = {}
      if (r.change_nd != null) entry[period] = r.change_nd
      if (r.ref_close != null) entry.refs = { [period]: r.ref_close }
      if (entry[period] != null || entry.refs) (out ||= {})[r.sym] = entry
    }
    return out
  }, [data, scanKey])

  // Footer: how many stocks the scan holds, when it was last computed (ET), and a manual
  // refresh. Prices tick live already; this re-ranks membership on demand instead of
  // waiting for the 30s poll.
  const scanFooter = (
    <div className={styles.scanFooter}>
      <span className={styles.scanCount}>{symbols.length} {symbols.length === 1 ? 'stock' : 'stocks'}</span>
      {data?.as_of && <span className={styles.scanUpdated}>· Updated {fmtScanTime(data.as_of)} ET</span>}
      <button
        type="button"
        className={styles.scanRefresh}
        onClick={() => mutate()}
        title="Refresh scan"
        aria-label="Refresh scan"
      >
        <UIcon name="refresh" size={12} gold={false} className={isValidating ? styles.scanRefreshSpin : undefined} />
      </button>
    </div>
  )

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
        // ⛔⛔ `activeRef` TRAVELS WITH `widgetKey` OR THE WIDGET NEVER LOSES THE KEYBOARD.
        // Watchlists reads them as a PAIR: `isActiveWidget()` is `!activeRef || ...`,
        // so passing the key alone leaves this widget permanently "active" — it answers
        // every Shift+F and every arrow no matter which widget you are actually in — while
        // `markActiveWidget()` (`if (activeRef && widgetKey)`) can never fire, so it cannot
        // claim the lock either. With a scan widget open beside a watchlist, ONE Shift+F
        // flagged in BOTH. WatchlistWidget and ThemesWidget always passed both. 2026-08-29.
        activeRef={activeWatchlistRef}
        widgetKey={widgetId}
        colStorageKey={colStorageKey}
        scanEmptyText={scanEmptyText}
        defaultColCfg={defaultColCfg}
        metaOverride={metaOverride}
        perfOverride={perfOverride}
        scanFooter={scanFooter}
        scanCriteria={SCAN_CRITERIA[scanKey]}
      />
    </ChartsSymContext.Provider>
  )
}
