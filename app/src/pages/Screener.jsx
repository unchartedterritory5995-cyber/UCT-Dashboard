import { useState } from 'react'
import useSWR from 'swr'
import TickerPopup from '../components/TickerPopup'
import CustomScan from './CustomScan'
import styles from './Screener.module.css'

const fetcher = url => fetch(url).then(r => r.json())

const PAGE_TABS = [
  { key: 'scanner', label: 'Scanner' },
  { key: 'custom',  label: 'Custom Scan' },
]

function TickerList({ rows }) {
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
        <li key={row.ticker || i} className={styles.tickerItem}>
          <TickerPopup sym={row.ticker} />
        </li>
      ))}
    </ul>
  )
}

export default function Screener() {
  const [pageTab, setPageTab] = useState('scanner')

  const { data, error } = useSWR('/api/candidates', fetcher, {
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
        <div className={styles.emptyState}>Loading scanner data...</div>
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
                <TickerList rows={pullbackRows} />
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
                <TickerList rows={remountRows} />
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
                <TickerList rows={gapperRows} />
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
