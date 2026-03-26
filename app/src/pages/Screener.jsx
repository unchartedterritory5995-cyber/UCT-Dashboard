import { useState, useMemo } from 'react'
import useMobileSWR from '../hooks/useMobileSWR'
import useLivePrices from '../hooks/useLivePrices'
import TickerPopup from '../components/TickerPopup'
import CustomScan from './CustomScan'
import { SkeletonTable } from '../components/Skeleton'
import styles from './Screener.module.css'

const fetcher = url => fetch(url).then(r => r.json())

const PAGE_TABS = [
  { key: 'scanner', label: 'Scanner' },
  { key: 'custom',  label: 'Custom Scan' },
]

function LivePrice({ ticker, prices }) {
  const d = prices[ticker]
  if (!d) return null
  const pct = d.change_pct
  const color = pct >= 0 ? 'var(--gain)' : 'var(--loss)'
  const sign = pct >= 0 ? '+' : ''
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{ color: 'var(--text-muted)' }}>${d.price?.toFixed(2)}</span>
      <span style={{ color, minWidth: 48, textAlign: 'right' }}>{sign}{pct?.toFixed(2)}%</span>
    </span>
  )
}

function TickerList({ rows, prices }) {
  if (!rows || rows.length === 0) {
    return (
      <div className={styles.emptyState}>
        No candidates — scanner runs at 7:00 AM CT
      </div>
    )
  }
  return (
    <ul className={styles.tickerList}>
      {rows.map((row, i) => (
        <li key={row.ticker || i} className={styles.tickerItem} style={{ display: 'flex', alignItems: 'center' }}>
          <TickerPopup sym={row.ticker} />
          <LivePrice ticker={row.ticker} prices={prices} />
        </li>
      ))}
    </ul>
  )
}

export default function Screener() {
  const [pageTab, setPageTab] = useState('scanner')

  const { data, error } = useMobileSWR('/api/candidates', fetcher, {
    refreshInterval: 30 * 60 * 1000,
  })

  const candidates   = data?.candidates ?? {}
  const pullbackRows = candidates.pullback_ma  ?? []
  const remountRows  = candidates.remount      ?? []
  const gapperRows   = candidates.gapper_news  ?? []
  const generatedAt  = data?.generated_at      ?? null

  // All candidates pooled for Custom Scan
  const allCandidates = [
    ...pullbackRows,
    ...remountRows,
    ...gapperRows,
  ]

  // Live prices for all visible scanner tickers
  const allTickers = useMemo(() =>
    allCandidates.map(r => r.ticker).filter(Boolean),
    [pullbackRows, remountRows, gapperRows]
  )
  const { prices } = useLivePrices(pageTab === 'scanner' ? allTickers : [])

  return (
    <div className={pageTab === 'custom' ? styles.containerFull : styles.container}>

      <div className={pageTab === 'custom' ? styles.headerFull : styles.header}>
        <h1 className={styles.heading}>Scanner Hub</h1>

        <div className={styles.pageTabs}>
          {PAGE_TABS.map(t => (
            <button
              key={t.key}
              className={`${styles.pageTab} ${pageTab === t.key ? styles.pageTabActive : ''}`}
              onClick={() => setPageTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className={styles.emptyState}>Scanner data unavailable</div>
      ) : !data ? (
        <SkeletonTable rows={8} cols={3} />
      ) : pageTab === 'custom' ? (
        <CustomScan allCandidates={allCandidates} />
      ) : (
        <>
          <div className={styles.columnsGrid}>

            <div className={styles.column}>
              <div className={styles.columnHeader}>
                <span className={styles.columnTitle}>Pullback MA</span>
                {pullbackRows.length > 0 && (
                  <span className={styles.columnCount}>{pullbackRows.length}</span>
                )}
              </div>
              <div className={styles.columnBody}>
                <TickerList rows={pullbackRows} prices={prices} />
              </div>
            </div>

            <div className={styles.column}>
              <div className={styles.columnHeader}>
                <span className={styles.columnTitle}>Remount</span>
                {remountRows.length > 0 && (
                  <span className={styles.columnCount}>{remountRows.length}</span>
                )}
              </div>
              <div className={styles.columnBody}>
                <TickerList rows={remountRows} prices={prices} />
              </div>
            </div>

            <div className={styles.column}>
              <div className={styles.columnHeader}>
                <span className={styles.columnTitle}>Gappers</span>
                {gapperRows.length > 0 && (
                  <span className={styles.columnCount}>{gapperRows.length}</span>
                )}
              </div>
              <div className={styles.columnBody}>
                <TickerList rows={gapperRows} prices={prices} />
              </div>
            </div>

            <div className={`${styles.column} ${styles.columnDim}`}>
              <div className={styles.columnHeader}>
                <span className={styles.columnTitle}>Coming Soon</span>
              </div>
              <div className={styles.columnBodyEmpty} />
            </div>

            <div className={`${styles.column} ${styles.columnDim}`}>
              <div className={styles.columnHeader}>
                <span className={styles.columnTitle}>Coming Soon</span>
              </div>
              <div className={styles.columnBodyEmpty} />
            </div>

          </div>

          {generatedAt && (
            <div className={styles.meta}>
              Generated: {generatedAt}
            </div>
          )}
        </>
      )}
    </div>
  )
}
