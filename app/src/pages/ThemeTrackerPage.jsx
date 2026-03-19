// app/src/pages/ThemeTrackerPage.jsx
import { useState, useMemo } from 'react'
import useSWR from 'swr'
import styles from './ThemeTrackerPage.module.css'

const fetcher = (url) => fetch(url).then(r => r.json())

const PERIODS = ['1d', '1w', '1m', '3m', '1y', 'ytd']
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

function dotClass(val, styles) {
  if (val === null || val === undefined) return styles.dotFlat
  if (val > 0) return styles.dotPos
  if (val < 0) return styles.dotNeg
  return styles.dotFlat
}

function avgReturn(holdings, periodKey) {
  const vals = holdings.map(h => h.returns?.[periodKey]).filter(v => v != null)
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function ThemeGroup({ theme, selectedSym, onSelectSym, activeKey }) {
  const [open, setOpen] = useState(false)
  const groupAvg = avgReturn(theme.holdings, activeKey)

  return (
    <>
      <div className={styles.groupRow} onClick={() => setOpen(o => !o)}>
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
            className={`${styles.stockRow} ${isSelected ? styles.selected : ''}`}
            onClick={() => onSelectSym(h.sym, h.name)}
          >
            <span className={styles.stockName}>
              <span className={`${styles.dot} ${dotClass(retVal, styles)}`} />
              <span className={styles.sym}>{h.sym}</span>
            </span>
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
    // SWR passes latest data to refreshInterval fn — poll fast while computing
    refreshInterval: (d) => d?.status === 'computing' ? 15_000 : 900_000,
    dedupingInterval: 10_000,
    revalidateOnFocus: false,
  })
  const isComputing = data?.status === 'computing'

  const [selectedSym, setSelectedSym] = useState(null)
  const [selectedName, setSelectedName] = useState('')
  const [activeTab, setActiveTab] = useState('1W')

  const activeKey = RANK_TO_KEY[activeTab]

  function handleSelect(sym, name) {
    setSelectedSym(sym)
    setSelectedName(name || sym)
  }

  const sortedThemes = useMemo(() => {
    if (!data?.themes) return []
    return [...data.themes].sort((a, b) => {
      const aAvg = avgReturn(a.holdings, activeKey) ?? -Infinity
      const bAvg = avgReturn(b.holdings, activeKey) ?? -Infinity
      return bAvg - aAvg
    })
  }, [data, activeKey])

  const tvUrl = selectedSym
    ? `https://s.tradingview.com/widgetembed/?frameElementId=tv_theme&symbol=${selectedSym}&interval=D&theme=dark&style=1&locale=en&toolbar_bg=161b22&enable_publishing=false&hide_top_toolbar=false&save_image=false&hide_legend=false&hide_volume=false`
    : null

  return (
    <div className={styles.page}>
      {/* ── Left panel ── */}
      <div className={styles.leftPanel}>
        {/* Period rank tabs */}
        <div className={styles.periodBar}>
          {RANK_TABS.map(tab => (
            <button
              key={tab}
              className={`${styles.periodTab} ${activeTab === tab ? styles.periodTabActive : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
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
