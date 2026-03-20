// app/src/pages/ThemeTrackerPage.jsx
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import useSWR from 'swr'
import styles from './ThemeTrackerPage.module.css'

const fetcher = (url) => fetch(url).then(r => r.json())

const PERIODS = ['1d', '1w', '1m', '3m', '1y', 'ytd']
const PERIOD_LABELS = { '1d': '1D', '1w': '1W', '1m': '1M', '3m': '3M', '1y': '1Y', 'ytd': 'YTD' }

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

function ThemeGroup({ theme, selectedSym, onSelectSym, activeKey, sortDir, open, onToggle, rowRefs }) {
  const isPortfolio = theme.ticker === 'UCT20'

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
          {isPortfolio && <span className={styles.portfolioBadge}>MANAGED</span>}
          <span className={styles.groupCount}>{theme.holdings.length}</span>
        </span>
        {PERIODS.map(p => {
          const val = groupReturn(theme, p)
          return (
            <span
              key={p}
              className={`${styles.ret} ${p === activeKey ? styles.retActive : ''} ${retClass(val, styles)}`}
            >
              {fmtRet(val)}
            </span>
          )
        })}
      </div>

      {open && sortedHoldings.map(h => {
        const isSelected = h.sym === selectedSym
        return (
          <div
            key={h.sym}
            ref={el => { if (rowRefs) rowRefs.current[h.sym] = el }}
            className={`${styles.stockRow} ${isSelected ? styles.selected : ''}`}
            onClick={() => onSelectSym(h.sym, h.name)}
          >
            <span className={styles.sym}>{h.sym}</span>
            {PERIODS.map(p => {
              const val = h.returns?.[p]
              return (
                <span
                  key={p}
                  className={`${styles.ret} ${p === activeKey ? styles.retActive : ''} ${retClass(val, styles)}`}
                >
                  {fmtRet(val)}
                </span>
              )
            })}
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
  const [activeKey, setActiveKey] = useState('1w')
  const [sortDir, setSortDir] = useState('desc')
  const [openThemes, setOpenThemes] = useState(new Set())
  const [search, setSearch] = useState('')

  const rowRefs = useRef({})

  function handleColClick(key) {
    if (key === activeKey) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setActiveKey(key)
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

  // Flat list for keyboard navigation
  const allStocks = useMemo(() =>
    filteredThemes.flatMap(theme =>
      theme.holdings.map(h => ({ sym: h.sym, name: h.name, themeTicker: theme.ticker }))
    ), [filteredThemes])

  const handleKeyDown = useCallback((e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const idx = allStocks.findIndex(s => s.sym === selectedSym)
    const nextIdx = e.key === 'ArrowDown'
      ? Math.min(idx + 1, allStocks.length - 1)
      : Math.max(idx - 1, 0)
    if (nextIdx < 0 || nextIdx === idx) return
    const stock = allStocks[nextIdx]
    setOpenThemes(prev => {
      if (prev.has(stock.themeTicker)) return prev
      const next = new Set(prev)
      next.add(stock.themeTicker)
      return next
    })
    setSelectedSym(stock.sym)
    setSelectedName(stock.name || stock.sym)
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

        {/* Column headers — click to sort */}
        <div className={styles.tableHeader}>
          <span className={`${styles.colLabel} ${styles.colTheme}`}>Theme</span>
          {PERIODS.map(p => (
            <button
              key={p}
              className={`${styles.colLabel} ${styles.colSort} ${activeKey === p ? styles.colSortActive : ''}`}
              onClick={() => handleColClick(p)}
            >
              {PERIOD_LABELS[p]}{activeKey === p ? (sortDir === 'desc' ? ' ↑' : ' ↓') : ''}
            </button>
          ))}
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
          {filteredThemes.map(theme => (
            <ThemeGroup
              key={theme.ticker}
              theme={theme}
              selectedSym={selectedSym}
              onSelectSym={handleSelect}
              activeKey={activeKey}
              sortDir={sortDir}
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
