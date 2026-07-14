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
import useRealtimePrices from '../hooks/useRealtimePrices'
import useRealtimeBarPrices, { pickFreshPrice } from '../hooks/useRealtimeBarPrices'

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

// Live return for a holding at `periodKey`: (livePrice − periodRef) / periodRef.
// Uses the streamed price + the per-period reference close the backend sends in
// ref_prices. Falls back to the server-computed return when live data is absent.
function liveReturn(h, periodKey, prices) {
  const px = prices?.[h.sym]
  const live = px?.price
  // 1d ("today") uses the live feed's OFFICIAL prev_close — the exact reference
  // brokers and the chart legend use — so the two never disagree. Other periods
  // use the backend's per-period reference close.
  const ref = periodKey === '1d'
    ? (px?.prev_close ?? h.ref_prices?.['1d'])
    : h.ref_prices?.[periodKey]
  if (live != null && Number.isFinite(live) && ref != null && ref !== 0) {
    return ((live - ref) / ref) * 100
  }
  if (periodKey === '1d' && px?.change_pct != null) return px.change_pct  // feed's today %
  return h.returns?.[periodKey] ?? null
}

// Live group return: anchor the server's group value and apply the AVERAGE live
// delta of its holdings, so the header ticks smoothly without jumping when live
// prices engage (server group value may be ETF/NAV-based, not a plain average).
function liveGroupReturn(theme, periodKey, prices) {
  const base = groupReturn(theme, periodKey)
  if (base == null) return null
  let sum = 0, n = 0
  for (const h of theme.holdings) {
    const s = h.returns?.[periodKey]
    const l = liveReturn(h, periodKey, prices)
    if (s != null && l != null) { sum += (l - s); n++ }
  }
  return n > 0 ? base + sum / n : base
}

// A return cell that briefly flashes bold (TC2000-style) whenever its displayed
// value changes — green flash on an uptick, red on a downtick.
function ReturnCell({ value, baseClass }) {
  const [dir, setDir] = useState(null)
  const prevRef = useRef(null)
  useEffect(() => {
    const r = value == null ? null : Math.round(value * 100) / 100
    const p = prevRef.current
    if (r != null && p != null && r !== p) {
      setDir(r > p ? 'up' : 'down')
      prevRef.current = r
      const id = setTimeout(() => setDir(null), 480)
      return () => clearTimeout(id)
    }
    prevRef.current = r
  }, [value])
  const flashCls = dir === 'up' ? styles.flashUp : dir === 'down' ? styles.flashDown : ''
  return (
    <span className={`${baseClass} ${dir ? styles.retFlash : ''} ${flashCls}`}>
      {fmtRet(value)}
    </span>
  )
}

function ThemeGroup({ theme, selectedSym, selectedNavKey, onSelectSym, activeKey, sortDir, open, onToggle, rowRefs, rotationRanking, getTag, tickerActions, onHoverSym, prices }) {
  const isPortfolio = theme.ticker === 'UCT20'
  const groupLive = liveGroupReturn(theme, activeKey, prices)
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
        <ReturnCell value={groupLive} baseClass={`${styles.ret} ${styles.retActive} ${retClass(groupLive, styles)}`} />
      </div>

      {open && sortedHoldings.map(h => {
        const retVal = liveReturn(h, activeKey, prices)
        const rowKey = `${theme.ticker}::${h.sym}`
        // Highlight only the SELECTED instance (by key). Falls back to the bare
        // symbol when no instance key is set (e.g. hub-driven selection).
        const isSelected = selectedNavKey ? selectedNavKey === rowKey : h.sym === selectedSym
        return (
          <div
            key={h.sym}
            ref={el => { if (rowRefs) rowRefs.current[rowKey] = el }}
            className={`${styles.stockRow} ${isSelected ? styles.selected : ''}`}
            onClick={() => onSelectSym(h.sym, h.name, theme.ticker)}
            onMouseEnter={onHoverSym ? () => onHoverSym(h.sym) : undefined}
            onFocus={onHoverSym ? () => onHoverSym(h.sym) : undefined}
            {...(tickerActions ? tickerActions.longPressProps(h.sym) : {})}
          >
            <span className={styles.stockLabel}>
              <span className={styles.stockDot}>•</span>
              {getTag && getTag(h.sym) && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: TAG_BY_KEY[getTag(h.sym)]?.hex, marginRight: 4 }} />}
              <span className={styles.sym}>{h.sym}</span>
            </span>
            <ReturnCell value={retVal} baseClass={`${styles.ret} ${retClass(retVal, styles)}`} />
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
  // Which INSTANCE is selected — `${themeTicker}::${sym}`. A ticker can appear in
  // several open themes, so arrow-nav + row highlight key off this, not the bare
  // symbol (else navigating a duplicate jumps to the other theme's copy).
  const [selectedNavKey, setSelectedNavKey] = useState(null)
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
    // External (hub-driven) selection isn't tied to a specific theme instance,
    // so drop the instance key → highlight/nav fall back to the bare symbol.
    if (hubSym && hubSym !== selectedSym) { setSelectedSym(hubSym); setSelectedNavKey(null) }
  }, [hubSym])  // intentionally do NOT depend on selectedSym (avoid feedback loop)

  function handleSelect(sym, name, themeTicker) {
    setSelectedSym(sym)
    setSelectedNavKey(themeTicker ? `${themeTicker}::${sym}` : null)
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
      return sorted.map(h => ({ sym: h.sym, name: h.name, themeTicker: theme.ticker, key: `${theme.ticker}::${h.sym}` }))
    }), [filteredThemes, activeKey, sortDir])

  // ── Live percentages ── Stream real-time prices for the holdings of EXPANDED
  // themes only (bounded, user-controlled — never the whole ~2k-symbol universe,
  // which would fan out the single-process SSE backend). Each % is recomputed
  // client-side from the live price + the per-period ref close (see liveReturn).
  const expandedSyms = useMemo(() => {
    const s = new Set()
    for (const theme of filteredThemes) {
      if (openThemes.has(theme.ticker)) {
        for (const h of theme.holdings) if (h.sym) s.add(h.sym)
      }
    }
    return [...s]
  }, [filteredThemes, openThemes])

  // Prices come from TWO feeds, merged:
  //   • useRealtimePrices → the official prev_close (REST) + a Finnhub fallback.
  //   • useRealtimeBarPrices → the Massive bars WS tick price (T/A/AM), the SAME
  //     reliable tick-by-tick feed the chart uses. Finnhub drops/rotates symbols
  //     (OKTA sat 400s+ stale), so the bars price is the authoritative live tick.
  const { prices: rtPrices } = useRealtimePrices(expandedSyms)
  const barPrices = useRealtimeBarPrices(expandedSyms)
  const tickPrices = useMemo(() => {
    const now = Date.now()
    const out = {}
    for (const sym of expandedSyms) {
      const rt = rtPrices[sym]
      const bp = barPrices[sym]
      // freshest-wins: recent Massive tick, else fresh Finnhub — so a gap in
      // either feed never freezes the %. prev_close etc. still come from rt.
      const price = pickFreshPrice(bp, rt, now)
      if (price != null) out[sym] = { ...rt, price }
      else if (rt) out[sym] = rt
    }
    return out
  }, [rtPrices, barPrices, expandedSyms])

  const handleKeyDown = useCallback((e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    // Don't hijack arrows while user is typing in the search input,
    // any inline editor, etc.
    const tgt = e.target
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return
    if (!allStocks.length) return
    // Locate by the exact INSTANCE (theme::sym) so navigating a ticker that also
    // lives in another open theme steps to its true neighbor instead of jumping
    // to the other theme's copy. Fall back to the bare symbol (click without a
    // theme, hub sync) — first match, same as before.
    let idx = selectedNavKey ? allStocks.findIndex(s => s.key === selectedNavKey) : -1
    if (idx < 0) idx = allStocks.findIndex(s => s.sym === selectedSym)
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
    setSelectedNavKey(stock.key)
    setSelectedName(stock.name || stock.sym)
    // Publish to hub so a paired Chart widget on the same color group follows.
    setHubSym(stock.sym)
    setTimeout(() => {
      rowRefs.current[stock.key]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 30)
  }, [allStocks, selectedSym, selectedNavKey, setHubSym])

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
            <ThemeGroup key={theme.ticker} theme={theme} selectedSym={selectedSym} selectedNavKey={selectedNavKey} onSelectSym={handleSelect}
              activeKey={activeKey} sortDir={sortDir} open={openThemes.has(theme.ticker)} onToggle={toggleTheme}
              rowRefs={rowRefs} rotationRanking={rotationRankings[theme.ticker]} getTag={getTag}
              tickerActions={tickerActions} onHoverSym={handleHoverSym}
              prices={openThemes.has(theme.ticker) ? tickPrices : null} />
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
