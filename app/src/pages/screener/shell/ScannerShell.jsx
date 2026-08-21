import { useEffect, useMemo, useState } from 'react'
import useRealtimePrices from '../../../hooks/useRealtimePrices'
import { prefetchBars } from '../../../utils/prefetchBars'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import { FiltersSheet } from '../../../components/mobile'
import { SkeletonTable } from '../../../components/Skeleton'
import UIcon from '../../../components/ui/UIcon'
import useScreenerMeta from '../hooks/useScreenerMeta'
import useScreenerScan from '../hooks/useScreenerScan'
import FilterChips from '../FilterChips'
import ChartsGallery from '../ChartsGallery'
import SaveScreenBar from '../SaveScreenBar'
import { COLUMN_DEFS } from '../columnDefs'
import useScreenSpec from './useScreenSpec'
import FilterRail from './FilterRail'
import ShellToolbar from './ShellToolbar'
import VirtualResults, { LIVE_WINDOW } from './VirtualResults'
import ResultCards from './ResultCards'
import { exportScreen } from './csvExport'
import { LIVE_SORTABLE } from './liveSort'
import styles from './ScannerShell.module.css'

const densityKey = 'uct.screener.density'

// ScannerShell — the drop-in replacement for ScannerPro (same `embedded` prop).
// Composes every landed shell piece into one orchestrator: honest loading/
// empty/error states (all present at once by construction — no `!data ?
// <spinner> : <table>` binary), the live-sort honesty chip, the loud CSV
// export path, and the desktop-rail / phone-sheet split.
export default function ScannerShell({ embedded = false }) {
  const { meta } = useScreenerMeta()
  const isPhone = useIsPhone()
  const viewColumnsFor = useMemo(() => {
    const map = Object.fromEntries((meta?.views || []).map(v => [v.key, v.columns]))
    return key => map[key] || map.overview || null
  }, [meta])
  const s = useScreenSpec({ viewColumnsFor })
  // Retry must change the spec's JSON or useScreenerScan's key-diff refires
  // nothing. `_retry` rides the spec; Pydantic v2 ignores unknown fields, so
  // the server never sees it as anything but noise. Zero is omitted so the
  // steady-state spec (and the URL codec, which never reads it) is untouched.
  const [retryNonce, setRetryNonce] = useState(0)
  const scanSpec = useMemo(
    () => (retryNonce ? { ...s.scanSpec, _retry: retryNonce } : s.scanSpec),
    [s.scanSpec, retryNonce])
  const { result, isLoading, error } = useScreenerScan(scanSpec)

  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  useEffect(() => {
    if (!result) return
    setTotal(result.total)
    setRows(prev => (result.page === 1 ? result.rows : [...prev, ...result.rows]))
  }, [result])

  const liveTickers = useMemo(() => rows.slice(0, LIVE_WINDOW).map(r => r.ticker), [rows])
  const { prices } = useRealtimePrices(liveTickers)
  useEffect(() => { if (rows.length) prefetchBars(rows.slice(0, 30).map(r => r.ticker), 'D') }, [rows])

  const [density, setDensity] = useState(() => {
    try { return localStorage.getItem(densityKey) || 'compact' } catch { return 'compact' }
  })
  const onDensity = d => { setDensity(d); try { localStorage.setItem(densityKey, d) } catch { /* ok */ } }
  const [liveSortOn, setLiveSortOn] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [exportState, setExportState] = useState({})

  const visibleColumns = s.visibleColumns || ['ticker']
  const allColumns = useMemo(() => {
    const keys = new Set(Object.keys(COLUMN_DEFS))
    for (const v of meta?.views || []) v.columns.forEach(c => keys.add(c))
    for (const f of meta?.filters || []) if (f.column) keys.add(f.column)
    return [...keys].map(k => ({ key: k, label: COLUMN_DEFS[k]?.label || k }))
  }, [meta])

  const handleExport = async () => {
    setExportState({ busy: true })
    try {
      const labels = Object.fromEntries(visibleColumns.map(c => [c, COLUMN_DEFS[c]?.label || c]))
      const out = await exportScreen({ spec: { ...s.baseSpec, columns: visibleColumns },
        columns: visibleColumns, labels, snapshotDate: result?.snapshot_date })
      setExportState({ note: `Exported ${out.rows.toLocaleString()} rows${out.truncated ? ' (capped at 5,000)' : ''}` })
    } catch {
      setExportState({ error: 'Export failed — nothing downloaded. Try again.' })
    } finally {
      setTimeout(() => setExportState({}), 6000)
    }
  }

  const retry = () => setRetryNonce(n => n + 1)
  const isEmpty = result && total === 0
  const hasMore = rows.length < total
  const liveSortEligible = LIVE_SORTABLE.has(s.sort?.key)
  const rail = meta && (
    <FilterRail meta={meta} activeFilters={s.filters} onChange={s.setFilter}
      onClear={s.clearFilters} variant={isPhone ? 'sheet' : 'rail'} />
  )

  return (
    <div className={`${styles.shell} ${embedded ? styles.shellEmbedded : ''}`}>
      {!isPhone && <div className={styles.railSlot}>{rail}</div>}
      <div className={styles.main}>
        <ShellToolbar meta={meta} view={s.view} onView={s.setView}
          visibleColumns={visibleColumns} allColumns={allColumns}
          onColumns={s.setColumns} onResetColumns={() => s.setColumns(null)}
          density={density} onDensity={onDensity}
          snapshot={result?.snapshot} snapshotDate={result?.snapshot_date}
          total={total} shown={rows.length} isLoading={isLoading}
          onExport={handleExport} exportState={exportState}
          saveBar={<SaveScreenBar currentSpec={s.baseSpec} onApply={s.applySpec} />} />
        <div className={styles.underbar}>
          <button type="button" className={styles.railToggle} onClick={() => setSheetOpen(true)}>
            <UIcon name="gear" size={12} /> Filters{Object.keys(s.filters).length ? ` · ${Object.keys(s.filters).length}` : ''}
          </button>
          <FilterChips meta={meta} activeFilters={s.filters}
            onRemove={key => s.setFilter(key, null)} onClear={s.clearFilters} />
          {liveSortEligible && (
            <span className={styles.sortHonesty}>
              {!liveSortOn && <span className={styles.snapChip}>snapshot order</span>}
              <button type="button" className={styles.toolBtn} aria-pressed={liveSortOn}
                onClick={() => setLiveSortOn(v => !v)}>
                <UIcon name="bolt" size={11} /> Re-sort loaded rows live
              </button>
            </span>
          )}
        </div>
        {error && (
          <div className={styles.scanError} role="alert">
            Scan failed — {String(error.message || error)}.
            <button type="button" className={styles.retryBtn} onClick={retry}>Retry</button>
          </div>
        )}
        {!result && isLoading ? (
          <SkeletonTable rows={12} cols={6} />
        ) : isEmpty ? (
          <div className={styles.empty}>
            No stocks match the current filters. Remove a chip above or Reset — the
            toolbar and views stay live.
          </div>
        ) : s.view === 'charts' ? (
          <div className={styles.gridScroll}>
            <ChartsGallery rows={rows} livePrices={prices} />
            {hasMore && (
              <div className={styles.loadMoreRow}>
                <button type="button" className={styles.loadMoreBtn} disabled={isLoading}
                  onClick={s.loadMore}>{isLoading ? 'Loading…' : 'Load more'}</button>
              </div>
            )}
          </div>
        ) : isPhone ? (
          <ResultCards rows={rows} columns={visibleColumns} livePrices={prices}
            hasMore={hasMore} onLoadMore={s.loadMore} isLoading={isLoading} />
        ) : (
          <VirtualResults rows={rows} columns={visibleColumns} sort={s.sort}
            onSort={s.setSort} livePrices={prices} liveSortOn={liveSortOn}
            density={density} view={s.view} hasMore={hasMore}
            onLoadMore={s.loadMore} isLoading={isLoading} />
        )}
      </div>
      <FiltersSheet open={sheetOpen} onClose={() => setSheetOpen(false)}
        onClear={s.clearFilters} onApply={() => setSheetOpen(false)}
        title="Scan Filters" activeCount={Object.keys(s.filters).length}
        applyLabel="Show results">
        {meta && (
          <FilterRail meta={meta} activeFilters={s.filters} onChange={s.setFilter}
            onClear={s.clearFilters} variant="sheet" />
        )}
      </FiltersSheet>
    </div>
  )
}
