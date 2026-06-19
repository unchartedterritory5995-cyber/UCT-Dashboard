import { useMemo, useState, useEffect } from 'react'
import useRealtimePrices from '../../hooks/useRealtimePrices'
import UIcon from '../../components/ui/UIcon'
import { prefetchBars } from '../../utils/prefetchBars'
import { useIsPhone } from '../../hooks/useBreakpoint'
import { FiltersSheet } from '../../components/mobile'
import useScreenerMeta from './hooks/useScreenerMeta'
import useScreenerScan from './hooks/useScreenerScan'
import FilterPanel from './FilterPanel'
import FilterChips from './FilterChips'
import ResultsTable from './ResultsTable'
import ChartsGallery from './ChartsGallery'
import SaveScreenBar from './SaveScreenBar'
import styles from './ScannerPro.module.css'

const PAGE_SIZE = 100

const specToFilters = spec =>
  Object.fromEntries((spec?.filters || []).map(({ key, ...rest }) => [key, rest]))

// Full-market screener: server-side filtered against the nightly snapshot,
// live prices overlay the visible rows for display only. Results paginate
// (Load more) and accumulate client-side.
export default function ScannerPro({ embedded = false }) {
  const { meta } = useScreenerMeta()
  const isPhone = useIsPhone()

  const [activeFilters, setActiveFilters] = useState({})
  const [activeTab, setActiveTab] = useState('technical')
  const [view, setView] = useState('overview')
  const [sort, setSort] = useState({ key: 'uct_composite', dir: 'desc' })
  const [showFilters, setShowFilters] = useState(!embedded)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [page, setPage] = useState(1)

  const baseSpec = useMemo(() => ({
    filters: Object.entries(activeFilters).filter(([, v]) => v).map(([key, v]) => ({ key, ...v })),
    sort, view,
  }), [activeFilters, sort, view])
  const baseKey = JSON.stringify(baseSpec)

  // Any filter/sort/view change resets to the first page.
  useEffect(() => { setPage(1) }, [baseKey])

  const spec = useMemo(() => ({ ...baseSpec, page, page_size: PAGE_SIZE }), [baseSpec, page])
  const { result, isLoading } = useScreenerScan(spec)

  // Accumulate pages: page 1 replaces, later pages append.
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  useEffect(() => {
    if (!result) return
    setTotal(result.total)
    setRows(prev => result.page === 1 ? result.rows : [...prev, ...result.rows])
  }, [result])

  const liveTickers = useMemo(() => rows.slice(0, 300).map(r => r.ticker), [rows])
  const { prices } = useRealtimePrices(liveTickers)
  useEffect(() => { if (rows.length) prefetchBars(rows.slice(0, 30).map(r => r.ticker), 'D') }, [rows])

  const onChange = (key, s) =>
    setActiveFilters(prev => {
      const n = { ...prev }
      if (s) n[key] = s
      else delete n[key]
      return n
    })

  const applySpec = s => {
    setActiveFilters(specToFilters(s))
    if (s?.view) setView(s.view)
    if (s?.sort) setSort(s.sort)
  }

  const reset = () => setActiveFilters({})
  const views = meta?.views ?? []
  const activeCount = Object.keys(activeFilters).length
  const isEmpty = result && total === 0
  const hasMore = rows.length < total
  const onLoadMore = () => setPage(p => p + 1)
  const displayResult = result && {
    view_columns: result.view_columns, snapshot_date: result.snapshot_date, rows, total,
  }

  const panel = meta && (
    <FilterPanel meta={meta} activeFilters={activeFilters} onChange={onChange}
      activeTab={activeTab} setActiveTab={setActiveTab} />
  )

  return (
    <div className={`${styles.wrap} ${embedded ? styles.embedded : ''}`}>
      <div className={styles.controlBar}>
        {!embedded && <h1 className={styles.heading}>Scanner</h1>}
        {isPhone ? (
          <button type="button" className={styles.filterToggle} onClick={() => setSheetOpen(true)}>
            <UIcon name="gear" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Filters{activeCount ? ` · ${activeCount}` : ''}
          </button>
        ) : (
          <button type="button" className={styles.filterToggle} onClick={() => setShowFilters(v => !v)}>
            Filters {activeCount ? `· ${activeCount}` : ''}
          </button>
        )}
        <button type="button" className={styles.resetBtn} onClick={reset}>Reset</button>
        <SaveScreenBar currentSpec={baseSpec} onApply={applySpec} />
        <span className={styles.statusLine}>
          {isLoading && page === 1 ? 'Scanning…' : `${total.toLocaleString()} matches`}
          {result?.snapshot_date ? ` · snapshot ${result.snapshot_date}` : ''}
        </span>
      </div>

      {!isPhone && showFilters && panel}

      {isPhone && (
        <FiltersSheet open={sheetOpen} onClose={() => setSheetOpen(false)}
          onClear={reset} onApply={() => setSheetOpen(false)}
          title="Scan Filters" activeCount={activeCount} applyLabel="Show results">
          {panel}
        </FiltersSheet>
      )}

      <FilterChips meta={meta} activeFilters={activeFilters}
        onRemove={key => onChange(key, null)} onClear={reset} />

      {isEmpty ? (
        <div className={styles.empty}>No stocks match the current filters</div>
      ) : view === 'charts' ? (
        <div className={styles.resultsWrap}>
          <div className={styles.viewBar}>
            {views.map(v => (
              <button key={v.key} type="button"
                className={`${styles.viewTab} ${view === v.key ? styles.viewTabOn : ''}`}
                onClick={() => setView(v.key)}>{v.label}</button>
            ))}
            <span className={styles.resultMeta}>{rows.length.toLocaleString()} of {total.toLocaleString()}</span>
          </div>
          <ChartsGallery rows={rows} livePrices={prices} />
          {hasMore && (
            <div className={styles.loadMoreRow}>
              <button type="button" className={styles.loadMoreBtn} onClick={onLoadMore}>
                {isLoading ? 'Loading…' : `Load more (${rows.length.toLocaleString()} of ${total.toLocaleString()})`}
              </button>
            </div>
          )}
        </div>
      ) : (
        <ResultsTable result={displayResult} view={view} setView={setView} views={views}
          sort={sort} setSort={setSort} livePrices={prices} spec={baseSpec}
          hasMore={hasMore} onLoadMore={onLoadMore} isLoading={isLoading} />
      )}
    </div>
  )
}
