// app/src/pages/ThemeTrackerPage.jsx
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import useMobileSWR from '../hooks/useMobileSWR'
import { SkeletonTileContent } from '../components/Skeleton'
import styles from './ThemeTrackerPage.module.css'
import StockChart from '../components/StockChart'
import SymbolSearch from '../components/chart/SymbolSearch'
import { useFlagged } from '../hooks/useFlagged'
import useTickerTags from '../hooks/useTickerTags'
import { TAG_BY_KEY } from '../constants/tagColors'
import { prefetchBar, prefetchBars, prefetchAllTimeframes, prefetchBarOnIntent } from '../utils/prefetchBars'
import TickerActionsMenu, { useTickerActions } from '../components/TickerActions'
import UIcon from '../components/ui/UIcon'
import { useChartsSym } from './charts/ChartsSymContext'

const fetcher = (url) => fetch(url).then(r => r.json())

function RotationBadge({ delta }) {
  if (delta == null) return null
  if (delta >= 20) return <span className={styles.rotBadgeIn}>IN {delta > 0 ? '+' : ''}{delta.toFixed(0)}</span>
  if (delta <= -20) return <span className={styles.rotBadgeOut}>OUT {delta.toFixed(0)}</span>
  return null
}

const PERIOD_LABELS = { '1d': '1D', '1w': '1W', '1m': '1M', '3m': '3M', '1y': '1Y', 'ytd': 'YTD' }
const RANK_TABS = ['Today', '1W', '1M', '3M', '1Y', 'YTD']
const RANK_TO_KEY = { 'Today': '1d', '1W': '1w', '1M': '1m', '3M': '3m', '1Y': '1y', 'YTD': 'ytd' }

function fmtRet(val) {
  if (val === null || val === undefined) return '—'
  const sign = val >= 0 ? '+' : ''
  return `${sign}${val.toFixed(2)}%`
}

function retClass(val, styles) {
  if (val === null || val === undefined) return styles.retFlat
  if (val > 0) return styles.retPos
  if (val < 0) return styles.retNeg
  return styles.retFlat
}

function avgReturn(holdings, periodKey) {
  const vals = holdings.map(h => h.returns?.[periodKey]).filter(v => v != null)
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function groupReturn(theme, periodKey) {
  return (theme.group_return?.[periodKey] != null)
    ? theme.group_return[periodKey]
    : avgReturn(theme.holdings, periodKey)
}

function ThemeGroup({ theme, selectedSym, onSelectSym, activeKey, sortDir, open, onToggle, rowRefs, rotationRanking, getTag, tickerActions, onHoverSym }) {
  const isPortfolio = theme.ticker === 'UCT20'
  const groupAvg = groupReturn(theme, activeKey)
  const momentumDelta = rotationRanking?.momentum_delta

  const sortedHoldings = useMemo(() => {
    return [...theme.holdings].sort((a, b) => {
      const av = a.returns?.[activeKey] ?? (sortDir === 'desc' ? -Infinity : Infinity)
      const bv = b.returns?.[activeKey] ?? (sortDir === 'desc' ? -Infinity : Infinity)
      return sortDir === 'desc' ? bv - av : av - bv
    })
  }, [theme.holdings, activeKey, sortDir])

  return (
    <>
      <div className={styles.groupRow} onClick={() => onToggle(theme.ticker)}>
        <span className={styles.groupName}>
          <span className={styles.groupCaret}>{open ? '▾' : '▸'}</span>
          {theme.name}
          {isPortfolio && <span className={styles.portfolioBadge}><UIcon name="star-fill" size={13} /></span>}
          <span className={styles.groupCount}>{theme.holdings.length}</span>
        </span>
        <span className={`${styles.ret} ${styles.retActive} ${retClass(groupAvg, styles)}`}>
          {fmtRet(groupAvg)}
        </span>
      </div>

      {open && sortedHoldings.map(h => {
        const retVal = h.returns?.[activeKey]
        const isSelected = h.sym === selectedSym
        return (
          <div
            key={h.sym}
            ref={el => { if (rowRefs) rowRefs.current[h.sym] = el }}
            className={`${styles.stockRow} ${isSelected ? styles.selected : ''}`}
            onClick={() => onSelectSym(h.sym, h.name)}
            onMouseEnter={onHoverSym ? () => onHoverSym(h.sym) : undefined}
            onFocus={onHoverSym ? () => onHoverSym(h.sym) : undefined}
            {...(tickerActions ? tickerActions.longPressProps(h.sym) : {})}
          >
            <span className={styles.stockDot}>•</span>
            {getTag && getTag(h.sym) && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: TAG_BY_KEY[getTag(h.sym)]?.hex, marginRight: 4 }} />}
            <span className={styles.sym}>{h.sym}</span>
            <span className={`${styles.ret} ${retClass(retVal, styles)}`}>
              {fmtRet(retVal)}
            </span>
          </div>
        )
      })}
    </>
  )
}

export default function ThemeTrackerPage({ embedded = false }) {
  const [activeTab, setActiveTab] = useState('1W')
  const { data, isLoading } = useMobileSWR('/api/theme-performance', fetcher, {
    refreshInterval: (d) => d?.status === 'computing' ? 15_000 : 30_000,
    dedupingInterval: 10_000,
    revalidateOnFocus: false,
  })
  const isComputing = data?.status === 'computing'

  const { data: rotationData } = useMobileSWR('/api/theme-rotation', fetcher, {
    refreshInterval: 900_000,   // 15 min — matches backend cache
    dedupingInterval: 60_000,
    revalidateOnFocus: false,
  })
  const rotationRankings = rotationData?.rankings || {}

  const { sym: hubSym, setSym: setHubSym } = useChartsSym()
  const [selectedSym, setSelectedSym] = useState(null)
  const [selectedName, setSelectedName] = useState('')
  const [sortDir, setSortDir] = useState('desc')
  const [openThemes, setOpenThemes] = useState(new Set())
  const [search, setSearch] = useState('')
  // chartPeriod is declared up here (not later in the file) because
  // toggleTheme + handleHoverSym below close over it; a `const` declared
  // *after* those would be in the temporal dead zone at render time.
  const [chartPeriod, setChartPeriod] = useState('D')
  const [flagToast, setFlagToast] = useState(null)

  const rowRefs = useRef({})
  const activeKey = RANK_TO_KEY[activeTab]

  function handleTabClick(tab) {
    if (tab === activeTab) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setActiveTab(tab)
      setSortDir('desc')
    }
  }

  function toggleTheme(ticker) {
    setOpenThemes(prev => {
      const next = new Set(prev)
      if (next.has(ticker)) {
        next.delete(ticker)
      } else {
        next.add(ticker)
        // Bulk-warm bars + ticker-meta for every holding in the just-opened
        // group so any click within it lands on a populated SWR cache. Server
        // disk cache makes this cheap (~10ms each, parallelised by the
        // browser), and prefetchBars dedups against in-flight requests.
        const theme = data?.themes?.find(t => t.ticker === ticker)
        if (theme?.holdings?.length) {
          prefetchBars(theme.holdings.map(h => h.sym), chartPeriod)
        }
      }
      return next
    })
  }

  // Row-hover prefetch: by the time the click commits (~200ms of mouse-down
  // latency on average), the bars are already in flight or cached.
  const handleHoverSym = useCallback(sym => {
    prefetchBarOnIntent(sym, chartPeriod)
  }, [chartPeriod])

  const chartRef = useRef(null)

  useEffect(() => {
    if (hubSym && hubSym !== selectedSym) setSelectedSym(hubSym)
  }, [hubSym])  // intentionally do NOT depend on selectedSym (avoid feedback loop)

  function handleSelect(sym, name) {
    setSelectedSym(sym)
    setHubSym(sym)
    setSelectedName(name || sym)
    // On mobile (stacked layout), scroll chart into view after selection
    if (window.innerWidth <= 900) {
      setTimeout(() => {
        chartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    }
  }

  const sortedThemes = useMemo(() => {
    if (!data?.themes) return []
    return [...data.themes].sort((a, b) => {
      const av = groupReturn(a, activeKey) ?? (sortDir === 'desc' ? -Infinity : Infinity)
      const bv = groupReturn(b, activeKey) ?? (sortDir === 'desc' ? -Infinity : Infinity)
      return sortDir === 'desc' ? bv - av : av - bv
    })
  }, [data, activeKey, sortDir])

  const filteredThemes = useMemo(() => {
    if (!search.trim()) return sortedThemes
    const q = search.trim().toLowerCase()
    return sortedThemes.filter(theme =>
      theme.name.toLowerCase().includes(q) ||
      theme.ticker.toLowerCase().includes(q) ||
      (theme.sector || '').toLowerCase().includes(q) ||
      theme.holdings.some(h => h.sym.toLowerCase().includes(q))
    )
  }, [sortedThemes, search])

  // Auto-expand themes that contain a matching holding
  useEffect(() => {
    if (!search.trim() || !sortedThemes.length) return
    const q = search.trim().toLowerCase()
    setOpenThemes(prev => {
      const next = new Set(prev)
      let changed = false
      sortedThemes.forEach(theme => {
        if (!next.has(theme.ticker) && theme.holdings.some(h => h.sym.toLowerCase().includes(q))) {
          next.add(theme.ticker)
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [search, sortedThemes])

  // Flat list for keyboard navigation — must match visual sort order
  const allStocks = useMemo(() =>
    filteredThemes.flatMap(theme => {
      const sorted = [...theme.holdings].sort((a, b) => {
        const av = a.returns?.[activeKey] ?? (sortDir === 'desc' ? -Infinity : Infinity)
        const bv = b.returns?.[activeKey] ?? (sortDir === 'desc' ? -Infinity : Infinity)
        return sortDir === 'desc' ? bv - av : av - bv
      })
      return sorted.map(h => ({ sym: h.sym, name: h.name, themeTicker: theme.ticker }))
    }), [filteredThemes, activeKey, sortDir])

  const handleKeyDown = useCallback((e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    // Don't hijack arrows while user is typing in the search input,
    // any inline editor, etc.
    const tgt = e.target
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return
    if (!allStocks.length) return
    const idx = allStocks.findIndex(s => s.sym === selectedSym)
    // If selection is not in THIS widget's universe, don't fight another
    // widget's arrow handler (e.g., a Watchlist widget on the same page).
    if (idx < 0 && selectedSym) return
    e.preventDefault()
    const nextIdx = idx < 0
      ? (e.key === 'ArrowDown' ? 0 : allStocks.length - 1)
      : (e.key === 'ArrowDown'
          ? Math.min(idx + 1, allStocks.length - 1)
          : Math.max(idx - 1, 0))
    if (nextIdx === idx) return
    const stock = allStocks[nextIdx]
    setOpenThemes(prev => {
      if (prev.has(stock.themeTicker)) return prev
      const next = new Set(prev)
      next.add(stock.themeTicker)
      return next
    })
    setSelectedSym(stock.sym)
    setSelectedName(stock.name || stock.sym)
    // Publish to hub so a paired Chart widget on the same color group follows.
    setHubSym(stock.sym)
    setTimeout(() => {
      rowRefs.current[stock.sym]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 30)
  }, [allStocks, selectedSym, setHubSym])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Prefetch all timeframes for current ticker + adjacent tickers for active TF
  useEffect(() => {
    if (!selectedSym || !allStocks.length) return
    prefetchAllTimeframes(selectedSym)
    const idx = allStocks.findIndex(s => s.sym === selectedSym)
    if (idx < 0) return
    const upcoming = allStocks.slice(idx + 1, idx + 6).map(s => s.sym)
    prefetchBars(upcoming, chartPeriod)
  }, [selectedSym, allStocks, chartPeriod])
  const { isFlagged, toggle: toggleFlag } = useFlagged()
  const { getTag } = useTickerTags()
  const tickerActions = useTickerActions()

  // Clear flag toast after 1.5s
  useEffect(() => {
    if (!flagToast) return
    const t = setTimeout(() => setFlagToast(null), 1500)
    return () => clearTimeout(t)
  }, [flagToast])

  // Shift+F to flag selected ticker
  useEffect(() => {
    if (!selectedSym) return
    const handler = (e) => {
      if (e.shiftKey && e.key === 'F') {
        const willFlag = !isFlagged(selectedSym)
        toggleFlag(selectedSym)
        setFlagToast(willFlag ? 'added' : 'removed')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedSym, isFlagged, toggleFlag])

  return (
    <div className={`${styles.page} ${embedded ? styles.pageEmbedded : ''}`}>
      {/* ── Left panel ── */}
      <div className={styles.leftPanel}>

        {/* Period tabs */}
        <div className={styles.periodBar}>
          {RANK_TABS.map(tab => (
            <button
              key={tab}
              className={`${styles.periodTab} ${activeTab === tab ? styles.periodTabActive : ''}`}
              onClick={() => handleTabClick(tab)}
            >
              {tab}{activeTab === tab ? (sortDir === 'desc' ? ' ↑' : ' ↓') : ''}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className={styles.searchBar}>
          <input
            className={styles.searchInput}
            placeholder="Search themes or tickers…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className={styles.searchClear} onClick={() => setSearch('')}>×</button>
          )}
        </div>

        <div className={styles.tableHeader}>
          <span className={styles.colLabel}>Theme</span>
          <button
            type="button"
            className={`${styles.colLabel} ${styles.colLabelActive} ${styles.sortBtn}`}
            onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
            title={sortDir === 'desc' ? 'Sorted high → low (click for low → high)' : 'Sorted low → high (click for high → low)'}
          >
            {PERIOD_LABELS[activeKey]}
            <span className={styles.sortCaret}>{sortDir === 'desc' ? '▼' : '▲'}</span>
          </button>
        </div>

        <div className={styles.tableBody}>
          {(isLoading || isComputing) && (
            isComputing
              ? <p className={styles.loading}>Computing returns… ready in ~30s</p>
              : <SkeletonTileContent lines={6} />
          )}
          {!isLoading && !isComputing && (!data || data.themes?.length === 0) && (
            <p className={styles.loading}>No theme data — run the morning wire engine to populate.</p>
          )}
          {filteredThemes.map(theme => (
            <ThemeGroup key={theme.ticker} theme={theme} selectedSym={selectedSym} onSelectSym={handleSelect}
              activeKey={activeKey} sortDir={sortDir} open={openThemes.has(theme.ticker)} onToggle={toggleTheme}
              rowRefs={rowRefs} rotationRanking={rotationRankings[theme.ticker]} getTag={getTag}
              tickerActions={tickerActions} onHoverSym={handleHoverSym} />
          ))}
        </div>
      </div>

      {/* ── Right panel — hidden in embedded mode ── */}
      {!embedded && (
        <div className={styles.rightPanel} ref={chartRef}>
          {selectedSym ? (
            <>
              <div className={styles.chartHeader}>
                <SymbolSearch sym={selectedSym} onSymbolChange={(s) => { setSelectedSym(s); setSelectedName('') }} />
                <span className={styles.chartName}>{selectedName}</span>
                {flagToast && (
                  <span className={`${styles.flagToast} ${flagToast === 'added' ? styles.flagToastAdded : styles.flagToastRemoved}`}>
                    {flagToast === 'added' ? <><UIcon name="flag" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Flagged</> : <><UIcon name="flag" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Removed</>}
                  </span>
                )}
                <button
                  className={`${styles.flagBtn}${isFlagged(selectedSym) ? ' ' + styles.flagBtnActive : ''}`}
                  onClick={() => { const willFlag = !isFlagged(selectedSym); toggleFlag(selectedSym); setFlagToast(willFlag ? 'added' : 'removed') }}
                  title={isFlagged(selectedSym) ? 'Remove from Flagged (Shift+F)' : 'Add to Flagged (Shift+F)'}
                ><UIcon name="flag" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />{isFlagged(selectedSym) ? 'Flagged' : 'Flag'}</button>
                <div className={styles.chartPeriodTabs}>
                  {[['1', '1min'], ['5', '5min'], ['15', '15min'], ['30', '30min'], ['60', '1hr'], ['D', 'Daily'], ['W', 'Weekly'], ['M', 'Monthly']].map(([p, label]) => (
                    <button
                      key={p}
                      className={`${styles.chartPeriodBtn} ${chartPeriod === p ? styles.chartPeriodBtnActive : ''}`}
                      onClick={() => setChartPeriod(p)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <StockChart sym={selectedSym} tf={chartPeriod} onSymbolChange={(s) => { setSelectedSym(s); setSelectedName('') }} onTfChange={setChartPeriod} />
              <div className={styles.newsLabel}>News — {selectedSym}</div>
            </>
          ) : (
            <div className={styles.chartEmpty}>
              Select a ticker to view chart
            </div>
          )}
        </div>
      )}
      {tickerActions.menu && <TickerActionsMenu menu={tickerActions.menu} onClose={tickerActions.closeMenu} />}
    </div>
  )
}
