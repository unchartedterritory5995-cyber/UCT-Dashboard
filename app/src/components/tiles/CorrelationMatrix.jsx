// app/src/components/tiles/CorrelationMatrix.jsx
import { useState, useMemo } from 'react'
import useSWR from 'swr'
import { SkeletonTable } from '../Skeleton'
import styles from './CorrelationMatrix.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function getCellColor(val) {
  if (val === 1) return 'var(--bg-elevated)'
  if (val >= 0.8) return 'rgba(74,222,128,0.55)'
  if (val >= 0.6) return 'rgba(74,222,128,0.30)'
  if (val >= 0.4) return 'rgba(74,222,128,0.15)'
  if (val >= 0.2) return 'rgba(74,222,128,0.06)'
  if (val >= -0.2) return 'transparent'
  if (val >= -0.4) return 'rgba(248,113,113,0.10)'
  if (val >= -0.6) return 'rgba(248,113,113,0.20)'
  if (val >= -0.8) return 'rgba(248,113,113,0.35)'
  return 'rgba(248,113,113,0.55)'
}

function getCellTextColor(val) {
  if (val === 1) return 'var(--text-muted)'
  if (val >= 0.8) return '#fff'
  if (val <= -0.6) return '#fca5a5'
  return 'var(--text)'
}

export default function CorrelationMatrix() {
  const { data, error, isLoading } = useSWR('/api/correlation', fetcher, {
    refreshInterval: 3600000,
    revalidateOnFocus: false,
  })
  const [hoveredCell, setHoveredCell] = useState(null)

  const tickers = data?.tickers ?? []
  const matrix = data?.matrix ?? []
  const highCorr = data?.high_correlations ?? []
  const n = tickers.length

  if (isLoading) return <SkeletonTable rows={6} cols={6} />
  if (error) return <p className={styles.empty}>Failed to load correlation data.</p>
  if (!tickers.length) return <p className={styles.empty}>No leadership data available for correlation analysis.</p>

  return (
    <div className={styles.wrapper}>
      {/* Matrix grid */}
      <div className={styles.scrollContainer}>
        <table className={styles.matrix}>
          <thead>
            <tr>
              <th className={styles.cornerCell} />
              {tickers.map(t => (
                <th key={t} className={styles.colHeader}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tickers.map((rowTicker, i) => (
              <tr key={rowTicker}>
                <td className={styles.rowHeader}>{rowTicker}</td>
                {matrix[i]?.map((val, j) => {
                  const isDiag = i === j
                  const isHovered = hoveredCell && (hoveredCell[0] === i || hoveredCell[1] === j)
                  return (
                    <td
                      key={j}
                      className={`${styles.cell} ${isDiag ? styles.diagCell : ''} ${isHovered ? styles.cellHighlight : ''}`}
                      style={{
                        background: getCellColor(val),
                        color: getCellTextColor(val),
                      }}
                      onMouseEnter={() => setHoveredCell([i, j])}
                      onMouseLeave={() => setHoveredCell(null)}
                      title={`${rowTicker} / ${tickers[j]}: ${val.toFixed(2)}`}
                    >
                      {val.toFixed(2)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* High correlation pairs */}
      {highCorr.length > 0 && (
        <div className={styles.highCorr}>
          <div className={styles.highCorrHeader}>
            <span className={styles.warnIcon}>&#9888;</span>
            <span className={styles.highCorrTitle}>High Correlation Pairs</span>
            <span className={styles.highCorrSubtitle}>Portfolio concentration risk (&gt;0.80)</span>
          </div>
          <div className={styles.pairList}>
            {highCorr.map((item, i) => (
              <div key={i} className={styles.pairRow}>
                <span className={styles.pairTickers}>
                  {item.pair[0]} &mdash; {item.pair[1]}
                </span>
                <span className={styles.pairVal}>{item.correlation.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
