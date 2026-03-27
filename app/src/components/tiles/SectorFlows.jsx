// app/src/components/tiles/SectorFlows.jsx
import useMobileSWR from '../../hooks/useMobileSWR'
import TileCard from '../TileCard'
import ErrorState from '../ErrorState'
import { SkeletonTable } from '../Skeleton'
import styles from './SectorFlows.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function fmtDollarVol(val) {
  if (!val) return '—'
  if (val >= 1e9) return `$${(val / 1e9).toFixed(1)}B`
  if (val >= 1e6) return `$${(val / 1e6).toFixed(0)}M`
  return `$${(val / 1e3).toFixed(0)}K`
}

function FlowBar({ ratio }) {
  // Normalize: 0.5 → full red, 1.0 → center, 1.5 → full green
  // Bar goes from center outward in the appropriate direction
  const clamped = Math.max(0.5, Math.min(1.5, ratio))
  const pct = ((clamped - 0.5) / 1.0) * 100  // 0..100
  const isPositive = ratio >= 1.0

  return (
    <div className={styles.flowBarTrack}>
      {/* Center line */}
      <div className={styles.flowBarCenter} />
      {isPositive ? (
        <div
          className={`${styles.flowBarFill} ${styles.flowBarGreen}`}
          style={{ left: '50%', width: `${pct - 50}%` }}
        />
      ) : (
        <div
          className={`${styles.flowBarFill} ${styles.flowBarRed}`}
          style={{ right: '50%', width: `${50 - pct}%` }}
        />
      )}
    </div>
  )
}

export default function SectorFlows() {
  const { data, error, mutate } = useMobileSWR('/api/sector-flow', fetcher, {
    refreshInterval: 900_000,  // 15 min
    marketHoursOnly: true,
  })

  const rows = Array.isArray(data) ? data : []

  return (
    <TileCard title="Sector Flows">
      {error ? (
        <ErrorState compact message="Failed to load sector flows" onRetry={() => mutate()} />
      ) : !data ? (
        <SkeletonTable rows={6} cols={4} />
      ) : rows.length === 0 ? (
        <p className={styles.empty}>No data available</p>
      ) : (
        <div className={styles.table}>
          <div className={styles.headerRow}>
            <span className={styles.colSector}>SECTOR</span>
            <span className={styles.colFlow}>FLOW</span>
            <span className={styles.colReturn}>5D RET</span>
            <span className={styles.colBadge}>TREND</span>
          </div>
          <div className={styles.body}>
            {rows.map(row => {
              const retClass = row.return_5d > 0 ? styles.gain : row.return_5d < 0 ? styles.loss : ''
              const sign = row.return_5d > 0 ? '+' : ''
              const badgeClass = row.flow_trend === 'inflow'
                ? styles.badgeInflow
                : row.flow_trend === 'outflow'
                  ? styles.badgeOutflow
                  : styles.badgeNeutral

              return (
                <div key={row.etf} className={styles.row}>
                  <div className={styles.colSector}>
                    <span className={styles.sectorName}>{row.sector}</span>
                    <span className={styles.etfTicker}>{row.etf}</span>
                  </div>
                  <div className={styles.colFlow}>
                    <FlowBar ratio={row.flow_ratio} />
                    <span className={styles.ratioLabel}>{row.flow_ratio.toFixed(2)}x</span>
                  </div>
                  <span className={`${styles.colReturn} ${retClass}`}>
                    {sign}{row.return_5d.toFixed(1)}%
                  </span>
                  <span className={`${styles.colBadge} ${badgeClass}`}>
                    {row.flow_trend === 'inflow' ? 'INFLOW' : row.flow_trend === 'outflow' ? 'OUTFLOW' : 'NEUTRAL'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </TileCard>
  )
}
