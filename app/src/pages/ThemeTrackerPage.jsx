// app/src/pages/ThemeTrackerPage.jsx
import { useState } from 'react'
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

function dotClass(val, styles) {
  if (val === null || val === undefined) return styles.dotFlat
  if (val > 0) return styles.dotPos
  if (val < 0) return styles.dotNeg
  return styles.dotFlat
}

function ThemeGroup({ theme, selectedSym, onSelectSym }) {
  const [open, setOpen] = useState(true)

  return (
    <>
      <div className={styles.groupRow} onClick={() => setOpen(o => !o)}>
        <span className={styles.groupName}>
          <span className={styles.groupCaret}>{open ? '▾' : '▸'}</span>
          {theme.name}
          <span className={styles.groupCount}>{theme.holdings.length}</span>
        </span>
        {PERIODS.map(p => (
          <span key={p} className={`${styles.ret} ${styles.retFlat}`} />
        ))}
      </div>

      {open && theme.holdings.map(h => {
        const ret1d = h.returns?.['1d']
        const isSelected = h.sym === selectedSym
        return (
          <div
            key={h.sym}
            className={`${styles.stockRow} ${isSelected ? styles.selected : ''}`}
            onClick={() => onSelectSym(h.sym, h.name)}
          >
            <span className={styles.stockName}>
              <span className={`${styles.dot} ${dotClass(ret1d, styles)}`} />
              <span className={styles.sym}>{h.sym}</span>
            </span>
            {PERIODS.map(p => (
              <span
                key={p}
                className={`${styles.ret} ${retClass(h.returns?.[p], styles)}`}
              >
                {fmtRet(h.returns?.[p])}
              </span>
            ))}
          </div>
        )
      })}
    </>
  )
}

export default function ThemeTrackerPage() {
  const { data, isLoading } = useSWR('/api/theme-performance', fetcher, {
    refreshInterval: 900_000, // 15 min — matches server cache TTL
  })

  const [selectedSym, setSelectedSym] = useState(null)
  const [selectedName, setSelectedName] = useState('')

  function handleSelect(sym, name) {
    setSelectedSym(sym)
    setSelectedName(name || sym)
  }

  const tvUrl = selectedSym
    ? `https://s.tradingview.com/widgetembed/?frameElementId=tv_theme&symbol=${selectedSym}&interval=D&theme=dark&style=1&locale=en&toolbar_bg=161b22&enable_publishing=false&hide_top_toolbar=false&save_image=false&hide_legend=false&hide_volume=false`
    : null

  return (
    <div className={styles.page}>
      {/* ── Left panel ── */}
      <div className={styles.leftPanel}>
        <div className={styles.tableHeader}>
          <span className={styles.colLabel}>Theme</span>
          {PERIODS.map(p => (
            <span key={p} className={styles.colLabel}>{PERIOD_LABELS[p]}</span>
          ))}
        </div>

        <div className={styles.tableBody}>
          {isLoading && (
            <p className={styles.loading}>Loading theme data…</p>
          )}
          {!isLoading && (!data || data.themes?.length === 0) && (
            <p className={styles.loading}>No theme data — run the morning wire engine to populate.</p>
          )}
          {data?.themes?.map(theme => (
            <ThemeGroup
              key={theme.ticker}
              theme={theme}
              selectedSym={selectedSym}
              onSelectSym={handleSelect}
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
