import { useMemo, useState, useEffect } from 'react'
import useRealtimePrices from '../../hooks/useRealtimePrices'
import UIcon from '../../components/ui/UIcon'
import { prefetchBars } from '../../utils/prefetchBars'
import { useIsPhone } from '../../hooks/useBreakpoint'
import { FiltersSheet } from '../../components/mobile'
import useScreenerMeta from './hooks/useScreenerMeta'
import useScreenerScan from './hooks/useScreenerScan'
import FilterPanel from './FilterPanel'
import ResultsTable from './ResultsTable'
import ChartsGallery from './ChartsGallery'
import SaveScreenBar from './SaveScreenBar'
import styles from './ScannerPro.module.css'

const specToFilters = spec =>
  Object.fromEntries((spec?.filters || []).map(({ key, ...rest }) => [key, rest]))

// Full-market screener: server-side filtered against the nightly snapshot,
// live prices overlay the visible rows for display only.
export default function ScannerPro({ embedded = false }) {
  const { meta } = useScreenerMeta()
  const isPhone = useIsPhone()

  const [activeFilters, setActiveFilters] = useState({})
  const [activeTab, setActiveTab] = useState('technical')
  const [view, setView] = useState('overview')
  const [sort, setSort] = useState({ key: 'uct_composite', dir: 'desc' })
  const [showFilters, setShowFilters] = useState(!embedded)
  const [sheetOpen, setSheetOpen] = useState(false)

  const spec = useMemo(() => ({
    filters: Object.entries(activeFilters)
      .filter(([, v]) => v)
      .map(([key, v]) => ({ key, ...v })),
    sort, view, page: 1, page_size: 200,
  }), [activeFilters, sort, view])

  const { result, isLoading } = useScreenerScan(spec)

  const tickers = useMemo(() => (result?.rows ?? []).map(r => r.ticker), [result])
  const { prices } = useRealtimePrices(tickers)
  useEffect(() => { if (tickers.length) prefetchBars(tickers.slice(0, 30), 'D') }, [tickers])

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
  const isEmpty = result && result.total === 0

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
        <SaveScreenBar currentSpec={spec} onApply={applySpec} />
        <span className={styles.statusLine}>
          {isLoading ? 'Scanning…' : `${result?.total ?? 0} matches`}
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
            <span className={styles.resultMeta}>{result?.total ?? 0} results</span>
          </div>
          <ChartsGallery rows={result?.rows ?? []} livePrices={prices} />
        </div>
      ) : (
        <ResultsTable result={result} view={view} setView={setView} views={views}
          sort={sort} setSort={setSort} livePrices={prices} />
      )}
    </div>
  )
}
