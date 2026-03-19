// app/src/pages/ThemeTrackerPage.jsx
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import useSWR from 'swr'
import styles from './ThemeTrackerPage.module.css'

const fetcher = (url) => fetch(url).then(r => r.json())

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

function ThemeGroup({ theme, selectedSym, onSelectSym, activeKey, open, onToggle, rowRefs }) {
  const groupAvg = avgReturn(theme.holdings, activeKey)

  return (
    <>
      <div className={styles.groupRow} onClick={() => onToggle(theme.ticker)}>
        <span className={styles.groupName}>
          <span className={styles.groupCaret}>{open ? '▾' : '▸'}</span>
          {theme.name}
          <span className={styles.groupCount}>{theme.holdings.length}</span>
        </span>
        <span className={`${styles.ret} ${styles.retActive} ${retClass(groupAvg, styles)}`}>
          {fmtRet(groupAvg)}
        </span>
      </div>

      {open && theme.holdings.map(h => {
        const retVal = h.returns?.[activeKey]
        const isSelected = h.sym === selectedSym
        return (
          <div
            key={h.sym}
            ref={el => { if (rowRefs) rowRefs.current[h.sym] = el }}
            className={`${styles.stockRow} ${isSelected ? styles.selected : ''}`}
            onClick={() => onSelectSym(h.sym, h.name)}
          >
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

export default function ThemeTrackerPage() {
  const { data, isLoading } = useSWR('/api/theme-performance', fetcher, {
    refreshInterval: (d) => d?.status === 'computing' ? 15_000 : 900_000,
    dedupingInterval: 10_000,
    revalidateOnFocus: false,
  })
  const isComputing = data?.status === 'computing'

  const [selectedSym, setSelectedSym] = useState(null)
  const [selectedName, setSelectedName] = useState('')
  const [activeTab, setActiveTab] = useState('1W')
  const [sortDir, setSortDir] = useState('desc')
  const [openThemes, setOpenThemes] = useState(new Set())

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
      if (next.has(ticker)) next.delete(ticker)
      else next.add(ticker)
      return next
    })
  }

  function handleSelect(sym, name) {
    setSelectedSym(sym)
    setSelectedName(name || sym)
  }

  const sortedThemes = useMemo(() => {
    if (!data?.themes) return []
    return [...data.themes].sort((a, b) => {
      const aAvg = avgReturn(a.holdings, activeKey) ?? (sortDir === 'desc' ? -Infinity : Infinity)
      const bAvg = avgReturn(b.holdings, activeKey) ?? (sortDir === 'desc' ? -Infinity : Infinity)
      return sortDir === 'desc' ? bAvg - aAvg : aAvg - bAvg
    })
  }, [data, activeKey, sortDir])

  // Flat list of all stocks across all themes (for keyboard nav)
  const allStocks = useMemo(() =>
    sortedThemes.flatMap(theme =>
      theme.holdings.map(h => ({ sym: h.sym, name: h.name, themeTicker: theme.ticker }))
    ), [sortedThemes])

  // Arrow key navigation
  const handleKeyDown = useCallback((e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()

    const idx = allStocks.findIndex(s => s.sym === selectedSym)
    const nextIdx = e.key === 'ArrowDown'
      ? Math.min(idx + 1, allStocks.length - 1)
      : Math.max(idx - 1, 0)

    if (nextIdx < 0 || nextIdx === idx) return
    const stock = allStocks[nextIdx]

    // Auto-open the group containing the next stock
    setOpenThemes(prev => {
      if (prev.has(stock.themeTicker)) return prev
      const next = new Set(prev)
      next.add(stock.themeTicker)
      return next
    })

    setSelectedSym(stock.sym)
    setSelectedName(stock.name || stock.sym)

    // Scroll the row into view after render
    setTimeout(() => {
      rowRefs.current[stock.sym]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 30)
  }, [allStocks, selectedSym])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const tvUrl = selectedSym
    ? `https://s.tradingview.com/widgetembed/?frameElementId=tv_theme&symbol=${selectedSym}&interval=D&theme=dark&style=1&locale=en&toolbar_bg=161b22&enable_publishing=false&hide_top_toolbar=false&save_image=false&hide_legend=false&hide_volume=false`
    : null

  return (
    <div className={styles.page}>
      {/* ── Left panel ── */}
      <div className={styles.leftPanel}>
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

        <div className={styles.tableHeader}>
          <span className={styles.colLabel}>Theme</span>
          <span className={`${styles.colLabel} ${styles.colLabelActive}`}>
            {PERIOD_LABELS[activeKey]}
          </span>
        </div>

        <div className={styles.tableBody}>
          {(isLoading || isComputing) && (
            <p className={styles.loading}>
              {isComputing ? 'Computing returns… ready in ~30s' : 'Loading theme data…'}
            </p>
          )}
          {!isLoading && !isComputing && (!data || data.themes?.length === 0) && (
            <p className={styles.loading}>No theme data — run the morning wire engine to populate.</p>
          )}
          {sortedThemes.map(theme => (
            <ThemeGroup
              key={theme.ticker}
              theme={theme}
              selectedSym={selectedSym}
              onSelectSym={handleSelect}
              activeKey={activeKey}
              open={openThemes.has(theme.ticker)}
              onToggle={toggleTheme}
              rowRefs={rowRefs}
            />
          ))}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className={styles.rightPanel}>
        {selectedSym ? (
          <>
            <div className={styles.chartHeader}>
              <span className={styles.chartSym}>{selectedSym}</span>
              <span className={styles.chartName}>{selectedName}</span>
            </div>
            <iframe
              key={selectedSym}
              src={tvUrl}
              className={styles.chartFrame}
              title={`${selectedSym} chart`}
              allowFullScreen
            />
            <div className={styles.newsLabel}>News — {selectedSym}</div>
          </>
        ) : (
          <div className={styles.chartEmpty}>
            Select a ticker to view chart
          </div>
        )}
      </div>
    </div>
  )
}
